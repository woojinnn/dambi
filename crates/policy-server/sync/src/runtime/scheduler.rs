use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::watch;

use policy_state::{Time, WalletId, WalletStore};

use crate::error::SyncError;
use crate::orchestrator::{Orchestrator, RefreshReport};

const WALLET_SYNC_SOURCE: &str = "wallet_sync";

#[derive(Clone, Debug)]
pub struct SchedulerConfig {
    pub tick_interval: Duration,
    pub max_wallets_per_tick: usize,
    /// Refresh plain facts such as block heights, balances, and allowances.
    pub sync_primitives: bool,
    /// Refresh Hyperliquid account snapshots from the venue API.
    pub sync_hyperliquid_accounts: bool,
    /// Refresh `UniswapX` (and other intent-venue) order status.
    pub sync_intent_orders: bool,
    /// Refresh stale `LiveField` values.
    pub refresh_live_fields: bool,
    /// Run the HL long-tail sync (staking/vaults/borrow-lend/agents) once every
    /// N ticks; the fast core sync runs every tick. Values below 1 act as 1.
    pub hl_longtail_every: u64,
    /// Minimum interval before the same wallet is eligible for another
    /// background sync. Set to zero in tests or one-shot callers that need every
    /// `tick_once` to process the same wallet immediately.
    pub wallet_min_sync_interval: Duration,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            tick_interval: Duration::from_secs(15),
            max_wallets_per_tick: 100,
            sync_primitives: true,
            sync_hyperliquid_accounts: true,
            sync_intent_orders: true,
            refresh_live_fields: true,
            hl_longtail_every: 10,
            wallet_min_sync_interval: Duration::from_secs(30),
        }
    }
}

/// Per-wallet refresh summary surfaced from a tick so callers can emit a real
/// `wallet_synced` payload instead of zeros.
#[derive(Debug, Clone)]
pub struct WalletSyncCounts {
    pub wallet: WalletId,
    pub fields_updated: usize,
    pub fields_failed: usize,
}

#[derive(Debug, Default, Clone)]
pub struct TickReport {
    pub wallets_processed: usize,
    pub total_primitives_updated: usize,
    pub total_primitive_errors: usize,
    pub total_hyperliquid_accounts_updated: usize,
    pub total_hyperliquid_errors: usize,
    pub total_fields_updated: usize,
    pub total_fields_failed: usize,
    pub errors: Vec<String>,
    /// Per-wallet refresh summaries for wallets persisted this tick. Surfaced
    /// (beyond the aggregate counters) so the caller can emit one real-time
    /// `wallet_synced` event per wallet with real counts.
    pub synced_wallets: Vec<WalletSyncCounts>,
}

pub struct Scheduler {
    orchestrator: Arc<Orchestrator>,
    store: Arc<dyn WalletStore>,
    config: SchedulerConfig,
    stop: watch::Sender<bool>,
    /// Monotonic tick counter for sub-cadence scheduling (e.g. HL long-tail).
    tick_index: AtomicU64,
    /// Round-robin cursor into the stable wallet list. This prevents the first
    /// `max_wallets_per_tick` wallets from monopolizing every tick.
    wallet_cursor: Mutex<Option<String>>,
    /// Process-local mirror of per-wallet due times. Durable stores also persist
    /// the same due time so DB-side selection can avoid scanning every wallet.
    wallet_next_due: Mutex<HashMap<WalletId, u64>>,
}

impl Scheduler {
    pub fn new(
        orchestrator: Arc<Orchestrator>,
        store: Arc<dyn WalletStore>,
        config: SchedulerConfig,
    ) -> Self {
        let (stop, _) = watch::channel(false);
        Self {
            orchestrator,
            store,
            config,
            stop,
            tick_index: AtomicU64::new(0),
            wallet_cursor: Mutex::new(None),
            wallet_next_due: Mutex::new(HashMap::new()),
        }
    }

    pub async fn tick_once(&self) -> Result<TickReport, SyncError> {
        let mut report = TickReport::default();
        let now_unix = unix_now();
        let now = Time::from_unix(now_unix);
        let limit = self.config.max_wallets_per_tick;
        let tick = self.tick_index.fetch_add(1, Ordering::Relaxed);
        let cursor_after = self
            .wallet_cursor
            .lock()
            .expect("scheduler wallet_cursor mutex poisoned")
            .clone();
        let wallets = self
            .store
            .list_wallets_for_sync(WALLET_SYNC_SOURCE, now_unix, limit, cursor_after)
            .await?;
        let selected_wallets = self.select_wallets_for_tick(wallets, limit, now_unix);
        let mut block_cache = HashMap::new();

        for wid in selected_wallets {
            let mut state = match self.store.load(&wid).await {
                Ok(state) => state,
                Err(e) => {
                    report.errors.push(format!("load {}: {}", wid.address, e));
                    continue;
                }
            };
            state.wallet_id = wid.clone();

            let mut w_updated: usize = 0;
            let mut w_failed: usize = 0;

            if self.config.sync_primitives {
                match self
                    .orchestrator
                    .sync_primitives_with_block_cache(&mut state, now, &mut block_cache)
                    .await
                {
                    Ok(pr) => {
                        let updated = pr.block_heights_updated
                            + pr.native_balances_updated
                            + pr.erc20_balances_updated
                            + pr.approvals_updated;
                        report.total_primitives_updated += updated;
                        w_updated += updated;
                        report.total_primitive_errors += pr.errors.len();
                        report.errors.extend(
                            pr.errors
                                .into_iter()
                                .map(|e| format!("primitives {}: {e}", wid.address)),
                        );
                    }
                    Err(e) => {
                        report.total_primitive_errors += 1;
                        w_failed += 1;
                        report
                            .errors
                            .push(format!("primitives {}: {}", wid.address, e));
                    }
                }
            }

            if self.config.sync_hyperliquid_accounts {
                // Core (fast): every tick.
                match self
                    .orchestrator
                    .sync_hyperliquid_core(&mut state, now)
                    .await
                {
                    Ok(hr) => {
                        if hr.account_updated {
                            report.total_hyperliquid_accounts_updated += 1;
                            w_updated += 1;
                        }
                        w_failed += hr.errors.len();
                        report.total_hyperliquid_errors += hr.errors.len();
                        report.errors.extend(
                            hr.errors
                                .into_iter()
                                .map(|e| format!("hyperliquid core {}: {e}", wid.address)),
                        );
                    }
                    Err(e) => {
                        report.total_hyperliquid_errors += 1;
                        w_failed += 1;
                        report
                            .errors
                            .push(format!("hyperliquid core {}: {}", wid.address, e));
                    }
                }

                // Long-tail (slow): every Nth tick (initial tick included).
                if tick.is_multiple_of(self.config.hl_longtail_every.max(1)) {
                    match self
                        .orchestrator
                        .sync_hyperliquid_longtail(&mut state, now)
                        .await
                    {
                        Ok(hr) => {
                            report.total_hyperliquid_errors += hr.errors.len();
                            report.errors.extend(
                                hr.errors
                                    .into_iter()
                                    .map(|e| format!("hyperliquid longtail {}: {e}", wid.address)),
                            );
                        }
                        Err(e) => {
                            report.total_hyperliquid_errors += 1;
                            report
                                .errors
                                .push(format!("hyperliquid longtail {}: {}", wid.address, e));
                        }
                    }
                }
            }

            if self.config.sync_intent_orders {
                match self.orchestrator.sync_intent_orders(&mut state, now).await {
                    Ok(ir) => {
                        w_updated += ir.orders_updated;
                        w_failed += ir.errors.len();
                        report.errors.extend(
                            ir.errors
                                .into_iter()
                                .map(|e| format!("intent {}: {e}", wid.address)),
                        );
                    }
                    Err(e) => {
                        w_failed += 1;
                        report.errors.push(format!("intent {}: {}", wid.address, e));
                    }
                }
            }

            // Permit/permit2 lifecycle reconciliation runs alongside intent
            // sync (a separate step, gated on the same flag) so signed permits
            // are retired on the same cadence as venue orders.
            if self.config.sync_intent_orders {
                match self.orchestrator.reconcile_permits(&mut state, now).await {
                    Ok(pr) => {
                        w_updated += pr.permits_retired;
                        w_failed += pr.errors.len();
                        report.errors.extend(
                            pr.errors
                                .into_iter()
                                .map(|e| format!("permit {}: {e}", wid.address)),
                        );
                    }
                    Err(e) => {
                        w_failed += 1;
                        report.errors.push(format!("permit {}: {}", wid.address, e));
                    }
                }
            }

            if self.config.refresh_live_fields {
                match self.orchestrator.refresh(&mut state, now).await {
                    Ok(rr) => {
                        report.total_fields_updated += rr.fields_updated;
                        report.total_fields_failed += rr.fields_failed;
                        w_updated += rr.fields_updated;
                        w_failed += rr.fields_failed;
                        report.errors.extend(
                            rr.errors
                                .into_iter()
                                .map(|e| format!("refresh {}: {e}", wid.address)),
                        );
                    }
                    Err(e) => report
                        .errors
                        .push(format!("refresh {}: {}", wid.address, e)),
                }
            }

            match self.store.save(&state).await {
                Ok(()) => {
                    if let Err(e) = self.mark_wallet_synced(&wid, now_unix).await {
                        report
                            .errors
                            .push(format!("mark sync due {}: {}", wid.address, e));
                    }
                    report.wallets_processed += 1;
                    report.synced_wallets.push(WalletSyncCounts {
                        wallet: wid,
                        fields_updated: w_updated,
                        fields_failed: w_failed,
                    });
                }
                Err(e) => report.errors.push(format!("save {}: {}", wid.address, e)),
            }
        }
        Ok(report)
    }

    fn select_wallets_for_tick(
        &self,
        wallets: Vec<WalletId>,
        limit: usize,
        now_unix: u64,
    ) -> Vec<WalletId> {
        if wallets.is_empty() || limit == 0 {
            return Vec::new();
        }

        let next_due = self
            .wallet_next_due
            .lock()
            .expect("scheduler wallet_next_due mutex poisoned");
        let mut selected = Vec::with_capacity(limit.min(wallets.len()));

        for wid in &wallets {
            let due = next_due
                .get(wid)
                .copied()
                .is_none_or(|due_at| due_at <= now_unix);
            if !due {
                continue;
            }
            selected.push(wid.clone());
            if selected.len() == limit {
                break;
            }
        }
        selected
    }

    async fn mark_wallet_synced(
        &self,
        wid: &WalletId,
        now_unix: u64,
    ) -> Result<(), policy_state::StoreError> {
        let due_at = now_unix.saturating_add(self.config.wallet_min_sync_interval.as_secs());
        *self
            .wallet_cursor
            .lock()
            .expect("scheduler wallet_cursor mutex poisoned") = Some(wallet_order_key(wid));
        self.wallet_next_due
            .lock()
            .expect("scheduler wallet_next_due mutex poisoned")
            .insert(wid.clone(), due_at);
        self.store
            .mark_wallet_sync_due_at(wid, WALLET_SYNC_SOURCE, due_at)
            .await
    }

    pub async fn run_forever(&self) -> Result<(), SyncError> {
        let mut stop_rx = self.stop.subscribe();
        loop {
            tokio::select! {
                () = tokio::time::sleep(self.config.tick_interval) => {
                    let _ = self.tick_once().await;
                }
                changed = stop_rx.changed() => {
                    if changed.is_ok() && *stop_rx.borrow() {
                        return Ok(());
                    }
                }
            }
        }
    }

    #[must_use]
    pub fn stop_handle(&self) -> watch::Sender<bool> {
        self.stop.clone()
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn wallet_order_key(wid: &WalletId) -> String {
    format!("{:#x}", wid.address)
}

#[allow(dead_code)]
fn _refresh_report_keep() -> RefreshReport {
    RefreshReport::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicU64 as TestAtomicU64;
    use std::sync::Mutex;

    use crate::fetchers::rpc::{BlockTag, EthCallRequest, RpcProvider, TxReceipt};
    use async_trait::async_trait;
    use policy_state::store::StoreError;
    use policy_state::{Address, ChainId, WalletId, WalletState, U256};

    struct CountingBlockProvider {
        chain: ChainId,
        block_calls: Arc<TestAtomicU64>,
        block_number: u64,
    }

    #[async_trait]
    impl RpcProvider for CountingBlockProvider {
        fn name(&self) -> &'static str {
            "counting"
        }

        fn chain(&self) -> &ChainId {
            &self.chain
        }

        async fn health_check(&self) -> Result<(), SyncError> {
            Ok(())
        }

        async fn eth_call(&self, _req: EthCallRequest) -> Result<Vec<u8>, SyncError> {
            Err(unsupported_counting_method("eth_call"))
        }

        async fn eth_balance(
            &self,
            _address: Address,
            _block: BlockTag,
        ) -> Result<U256, SyncError> {
            Err(unsupported_counting_method("eth_balance"))
        }

        async fn eth_block_number(&self) -> Result<u64, SyncError> {
            self.block_calls.fetch_add(1, Ordering::Relaxed);
            Ok(self.block_number)
        }

        async fn eth_gas_price(&self) -> Result<U256, SyncError> {
            Err(unsupported_counting_method("eth_gas_price"))
        }

        async fn eth_get_transaction_receipt(
            &self,
            _tx_hash: &str,
        ) -> Result<Option<TxReceipt>, SyncError> {
            Err(unsupported_counting_method("eth_get_transaction_receipt"))
        }
    }

    fn unsupported_counting_method(method: &str) -> SyncError {
        SyncError::FetchFailed {
            source_id: "counting".into(),
            reason: format!("{method} unsupported in scheduler test"),
        }
    }

    struct MemStore {
        wallets: Mutex<HashMap<WalletId, WalletState>>,
    }

    struct OrderedMemStore {
        wallets: Vec<WalletId>,
        states: Mutex<HashMap<WalletId, WalletState>>,
    }

    #[async_trait]
    impl WalletStore for MemStore {
        async fn list_wallets(&self) -> Result<Vec<WalletId>, StoreError> {
            Ok(self.wallets.lock().unwrap().keys().cloned().collect())
        }
        async fn load(&self, id: &WalletId) -> Result<WalletState, StoreError> {
            self.wallets
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or_else(|| StoreError::NotFound(id.clone()))
        }
        async fn save(&self, state: &WalletState) -> Result<(), StoreError> {
            self.wallets
                .lock()
                .unwrap()
                .insert(state.wallet_id.clone(), state.clone());
            Ok(())
        }
    }

    #[async_trait]
    impl WalletStore for OrderedMemStore {
        async fn list_wallets(&self) -> Result<Vec<WalletId>, StoreError> {
            Ok(self.wallets.clone())
        }
        async fn load(&self, id: &WalletId) -> Result<WalletState, StoreError> {
            self.states
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or_else(|| StoreError::NotFound(id.clone()))
        }
        async fn save(&self, state: &WalletState) -> Result<(), StoreError> {
            self.states
                .lock()
                .unwrap()
                .insert(state.wallet_id.clone(), state.clone());
            Ok(())
        }
    }

    fn mk_scheduler() -> Scheduler {
        mk_scheduler_with_config(SchedulerConfig {
            sync_primitives: false,
            sync_hyperliquid_accounts: false,
            ..SchedulerConfig::default()
        })
    }

    fn mk_scheduler_with_config(config: SchedulerConfig) -> Scheduler {
        let toml = r#"
[chains."eip155:1"]
multicall_addr = "0xcA11bde05977b3631167028862bE2a173976CA11"
[[chains."eip155:1".providers]]
name = "publicnode"
kind = "public"
url = "https://ethereum-rpc.publicnode.com"
priority = 1
"#;
        let cfg = crate::RpcConfig::load_str(toml).unwrap();
        let router = Arc::new(crate::RpcRouter::from_config(cfg).unwrap());
        let orch = Arc::new(Orchestrator::from_rpc_router(router));

        let wid = WalletId::new(Address::ZERO, [ChainId::ethereum_mainnet()]);
        let state = WalletState::new(wid.clone());
        let mut map = HashMap::new();
        map.insert(wid, state);

        let store = Arc::new(MemStore {
            wallets: Mutex::new(map),
        });

        Scheduler::new(orch, store, config)
    }

    #[tokio::test]
    async fn tick_processes_wallets() {
        let s = mk_scheduler();
        let report = s.tick_once().await.unwrap();
        assert_eq!(report.wallets_processed, 1);
        assert_eq!(report.total_fields_updated, 0); // empty state
    }

    #[tokio::test]
    async fn tick_records_synced_wallets() {
        // The background worker needs to know *which* wallets a tick refreshed
        // so it can emit one `wallet_synced` event per wallet. The aggregate
        // counters can't carry that, so the tick surfaces the wallet ids that
        // were successfully loaded, refreshed, and saved.
        let s = mk_scheduler();
        let report = s.tick_once().await.unwrap();
        assert_eq!(report.wallets_processed, 1);
        assert_eq!(report.synced_wallets.len(), 1);
        assert_eq!(report.synced_wallets[0].wallet.address, Address::ZERO);
    }

    #[tokio::test]
    async fn tick_rotates_wallet_cursor_when_limited() {
        let toml = r#"
[chains."eip155:1"]
[[chains."eip155:1".providers]]
name = "publicnode"
kind = "public"
url = "https://ethereum-rpc.publicnode.com"
priority = 1
"#;
        let cfg = crate::RpcConfig::load_str(toml).unwrap();
        let router = Arc::new(crate::RpcRouter::from_config(cfg).unwrap());
        let orch = Arc::new(Orchestrator::from_rpc_router(router));
        let chain = ChainId::ethereum_mainnet();
        let wallets: Vec<_> = (1..=5)
            .map(|n| WalletId::new(Address::from([n; 20]), [chain.clone()]))
            .collect();
        let states = wallets
            .iter()
            .cloned()
            .map(|wid| {
                let state = WalletState::new(wid.clone());
                (wid, state)
            })
            .collect();
        let store = Arc::new(OrderedMemStore {
            wallets: wallets.clone(),
            states: Mutex::new(states),
        });

        let scheduler = Scheduler::new(
            orch,
            store,
            SchedulerConfig {
                max_wallets_per_tick: 2,
                sync_primitives: false,
                sync_hyperliquid_accounts: false,
                sync_intent_orders: false,
                refresh_live_fields: false,
                wallet_min_sync_interval: Duration::ZERO,
                ..SchedulerConfig::default()
            },
        );

        let first = scheduler.tick_once().await.unwrap();
        let second = scheduler.tick_once().await.unwrap();
        let third = scheduler.tick_once().await.unwrap();

        let processed: Vec<_> = first
            .synced_wallets
            .iter()
            .chain(second.synced_wallets.iter())
            .chain(third.synced_wallets.iter())
            .map(|w| w.wallet.address)
            .collect();
        assert_eq!(
            processed,
            vec![
                wallets[0].address,
                wallets[1].address,
                wallets[2].address,
                wallets[3].address,
                wallets[4].address,
                wallets[0].address,
            ]
        );
    }

    #[tokio::test]
    async fn tick_reuses_block_number_per_chain_for_wallets_in_same_tick() {
        let chain = ChainId::ethereum_mainnet();
        let block_calls = Arc::new(TestAtomicU64::new(0));
        let provider = Arc::new(CountingBlockProvider {
            chain: chain.clone(),
            block_calls: block_calls.clone(),
            block_number: 19_000_000,
        });
        let router = Arc::new(crate::RpcRouter::from_test_providers(vec![provider]));
        let orch = Arc::new(Orchestrator::from_rpc_router(router));
        let wallets: Vec<_> = (1..=2)
            .map(|n| WalletId::new(Address::from([n; 20]), [chain.clone()]))
            .collect();
        let states = wallets
            .iter()
            .cloned()
            .map(|wid| {
                let state = WalletState::new(wid.clone());
                (wid, state)
            })
            .collect();
        let store = Arc::new(OrderedMemStore {
            wallets,
            states: Mutex::new(states),
        });

        let scheduler = Scheduler::new(
            orch,
            store,
            SchedulerConfig {
                max_wallets_per_tick: 2,
                sync_hyperliquid_accounts: false,
                sync_intent_orders: false,
                refresh_live_fields: false,
                wallet_min_sync_interval: Duration::ZERO,
                ..SchedulerConfig::default()
            },
        );

        let report = scheduler.tick_once().await.unwrap();

        assert_eq!(report.wallets_processed, 2);
        assert_eq!(report.total_primitive_errors, 0);
        assert_eq!(report.total_primitives_updated, 2);
        assert_eq!(block_calls.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn tick_skips_wallet_until_next_due_time() {
        let scheduler = mk_scheduler_with_config(SchedulerConfig {
            sync_primitives: false,
            sync_hyperliquid_accounts: false,
            sync_intent_orders: false,
            refresh_live_fields: false,
            wallet_min_sync_interval: Duration::from_mins(1),
            ..SchedulerConfig::default()
        });

        let first = scheduler.tick_once().await.unwrap();
        let second = scheduler.tick_once().await.unwrap();

        assert_eq!(first.wallets_processed, 1);
        assert_eq!(second.wallets_processed, 0);
    }

    #[tokio::test]
    async fn tick_runs_primitives_and_hyperliquid_sync_before_livefield_refresh() {
        let toml = r#"
[chains."eip155:1"]
[[chains."eip155:1".providers]]
name = "publicnode"
kind = "public"
url = "https://ethereum-rpc.publicnode.com"
priority = 1
"#;
        let cfg = crate::RpcConfig::load_str(toml).unwrap();
        let router = Arc::new(crate::RpcRouter::from_config(cfg).unwrap());
        let orch = Arc::new(Orchestrator::new(crate::fetchers::OnchainViewFetcher::new(
            router,
        )));

        let wid = WalletId::new(Address::ZERO, [ChainId::ethereum_mainnet()]);
        let state = WalletState::new(wid.clone());
        let mut map = HashMap::new();
        map.insert(wid, state);
        let store = Arc::new(MemStore {
            wallets: Mutex::new(map),
        });

        let s = Scheduler::new(orch, store, SchedulerConfig::default());
        let report = s.tick_once().await.unwrap();

        assert_eq!(report.wallets_processed, 1);
        assert_eq!(report.total_primitive_errors, 1);
        // Unconfigured HL on tick 0: core + long-tail both report "not configured".
        assert_eq!(report.total_hyperliquid_errors, 2);
        assert!(report
            .errors
            .iter()
            .any(|e| e.contains("hyperliquid fetcher is not configured")));
    }
}
