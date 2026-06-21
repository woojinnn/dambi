//! Mutating endpoints — add wallets + trigger sync refresh.
//! These are the counterpart to `read_handlers`. They take an
//! authenticated user, mutate that user's PostgreSQL-backed wallet state, and (where
//! applicable) trigger the sync orchestrator to fetch live data over
//! RPC/oracles defined in `dambi-sync.toml`.
//! Sync completion fires a `wallet_synced` event on the per-user SSE
//! stream so a dashboard or extension subscribed to the activity feed
//! sees the refresh in real time.

use std::collections::BTreeSet;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};

use policy_db::PostgresWalletMetadata;
use policy_state::live_field::{DataSource, LiveField, OracleProvider};
use policy_state::pending::{PendingKind, PendingTx};
use policy_state::primitives::{Address, ChainId, Duration, Price, Time, U256};
use policy_state::token::{Balance, TokenHolding, TokenKey, TokenKind, TokenRef};
use policy_state::{EvalContext, PendingChange, RequestKind, WalletId, WalletState, WalletStore};
use policy_sync::{discovery, CoinGeckoClient, DiscoveredToken, Orchestrator, RpcRouter};
use policy_transition::action::token::{
    Erc20PermitAction, Permit2SignAction, Permit2SignTransferAction, TokenAction,
};
use policy_transition::{apply, Action, ActionBody, ActionMeta, ActionNature, Eip712Domain};

use crate::app::AppState;
use crate::auth::AuthUser;
use crate::coordination::{Coordinator, LockToken};
use crate::events::types::{Event, WalletSync};

/// User-supplied explicit chain sets drive synchronous discovery/sync work.
/// Keep this comfortably above supported production networks, but low enough
/// that one request cannot fan out across an arbitrary CAIP-2 list.
const MAX_EXPLICIT_WALLET_CHAINS: usize = 16;
/// Active wallets are a recurring sync/dashboard workload, not just one DB row.
/// Keep the product cap high enough for power users while bounding per-user
/// background work and unpaginated wallet views.
const MAX_ACTIVE_WALLETS_PER_USER: usize = 128;
const MAX_WALLET_LABEL_CHARS: usize = 80;
const MAX_PERMIT_WITNESS_TYPE_CHARS: usize = 128;
const MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET: usize = 256;
const ADD_WALLET_DISCOVERY_PUBLIC_ERROR: &str = "wallet discovery failed; retry sync later";
const ADD_WALLET_SYNC_PUBLIC_ERROR: &str = "wallet sync failed; retry sync later";

/// `POST /wallets` body.
#[derive(Debug, Deserialize)]
pub struct AddWalletReq {
    /// 0x address (case-insensitive — we store lower-cased internally).
    pub address: String,
    /// CAIP-2 chain ids (e.g. `["eip155:1", "eip155:42161"]`).
    /// Optional. When omitted or empty the server tracks the wallet
    /// against **every** chain the sync config (`dambi-sync.toml`)
    /// has an RPC provider for. Multicall keeps the per-chain RPC
    /// cost flat (2 calls per chain regardless of token count), so
    /// "all chains" is cheap and matches the typical user mental
    /// model of an EVM address being shared across chains.
    #[serde(default)]
    pub chains: Vec<String>,
    /// Optional human-friendly label.
    #[serde(default)]
    pub label: Option<String>,
}

/// `POST /wallets` response.
#[derive(Debug, Serialize)]
pub struct AddWalletResp {
    pub wallet_id: WalletId,
    /// True when the auto-sync after add succeeded; false if it was
    /// skipped (no orchestrator) or errored (logged in `error`).
    pub synced: bool,
    /// How many `TokenHolding` rows were seeded for a brand-new wallet
    /// (0 for an already-tracked wallet, also 0 when discovery fails).
    #[serde(default)]
    pub discovered: usize,
    /// Non-fatal sync error message — caller can retry with /sync.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `POST /wallets` — start tracking a new wallet for the authenticated
/// user. Creates an empty `WalletState` row and immediately triggers a
/// best-effort sync so the dashboard sees real data within one tick.
pub async fn add_wallet(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<AddWalletReq>,
) -> Response {
    let lock = match acquire_user_wallet_lock(
        &*state.coordinator,
        state.sync_lock_ttl,
        &user.user_id,
        "wallet operation already running for this user",
        "wallet add lock",
    )
    .await
    {
        Ok(lock) => lock,
        Err(response) => return response,
    };

    let response = add_wallet_locked(state.clone(), user, req).await;
    if let Err(e) = state.coordinator.release_lock(lock).await {
        let safe_error = crate::logging::redact_sensitive_log_text(&e);
        tracing::warn!(error = %safe_error, "failed to release wallet add lock");
    }
    response
}

async fn add_wallet_locked(state: AppState, user: AuthUser, req: AddWalletReq) -> Response {
    let label = match normalize_add_wallet_label(req.label.clone()) {
        Ok(label) => label,
        Err(e) => return bad_request(&e),
    };

    let id = match build_wallet_id(&req, &state) {
        Ok(id) => id,
        Err(e) => return *e,
    };

    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };

    let id_address = format!("{:#x}", id.address);
    let active_wallets = match store.list_wallet_metadata().await {
        Ok(wallets) => wallets,
        Err(e) => return internal(&format!("list_wallet_metadata: {e}")),
    };
    if active_wallet_quota_exceeded(&active_wallets, &id_address) {
        return (
            StatusCode::CONFLICT,
            format!("too many active wallets: max {MAX_ACTIVE_WALLETS_PER_USER}"),
        )
            .into_response();
    }

    // Seed: if the wallet is brand-new, discover what it holds (native
    // gas + ERC-20s via Etherscan when configured) and pre-populate the
    // state so the orchestrator's price refresh has something to walk.
    // For already-known wallets this is a no-op — the existing holdings
    // stay put.
    let existing = match store.load(&id).await {
        Ok(s) => s,
        Err(e) => return internal(&format!("load: {e}")),
    };
    let base_state = if existing.wallet_id == id {
        existing
    } else {
        // A soft-deleted wallet can be re-added with a different explicit chain
        // set. The add request is the new tracking contract, so do not resurrect
        // stale chain metadata from the archived state snapshot.
        WalletState::new(id.clone())
    };
    let is_new = base_state == WalletState::new(id.clone());
    let mut discovery_failed = false;
    let discovered_count = if is_new {
        let mut seeded = base_state.clone();
        let n = match seed_holdings(&mut seeded, &id, &state).await {
            Ok(n) => n,
            Err(e) => {
                // Discovery is best-effort. Save the empty state, but still
                // continue into `run_sync`: venue snapshots such as
                // Hyperliquid are independent from token discovery and should
                // be visible immediately after adding a wallet.
                if let Err(save_err) = store.reactivate_wallet(&base_state).await {
                    return internal(&format!("save: {save_err}"));
                }
                let safe_error = crate::logging::redact_sensitive_log_text(&e);
                tracing::warn!(error = %safe_error, "add wallet discovery failed");
                discovery_failed = true;
                0
            }
        };
        if let Err(e) = store.reactivate_wallet(&seeded).await {
            return internal(&format!("save: {e}"));
        }
        n
    } else {
        // Re-adding a previously deleted (soft-archived) wallet. `load` reads
        // `wallet_states`, which has no archived filter, so an archived row
        // looks "not new" here. Reactivate explicitly before the label write —
        // plain state saves preserve `archived` so in-flight syncs cannot
        // resurrect a user-deleted wallet.
        if let Err(e) = store.reactivate_wallet(&base_state).await {
            return internal(&format!("reactivate wallet: {e}"));
        }
        0
    };

    if label.is_some() {
        match store
            .update_wallet_metadata(&format!("{:#x}", id.address), Some(label.clone()), None)
            .await
        {
            Ok(true) => {}
            // The row was just saved/un-archived above, so a `false` here means
            // the wallet genuinely isn't present — surface it instead of
            // silently keeping a stale label.
            Ok(false) => {
                return internal("update wallet metadata: wallet not found after save");
            }
            Err(e) => return internal(&format!("update wallet metadata: {e}")),
        }
    }

    // Best-effort sync. Failures here aren't fatal — the caller can
    // POST /sync later, and stale state is better than no wallet row.
    let (synced, sync_failed) = match run_sync(&*store, &id, &state.orchestrator).await {
        Ok(counts) => {
            state
                .publisher
                .publish(
                    user.user_id.clone(),
                    Event::WalletSynced(WalletSync {
                        wallet: format!("{:#x}", id.address),
                        fields_updated: counts.fields_updated,
                        fields_failed: counts.fields_failed,
                        synced_at: unix_now(),
                    }),
                )
                .await;
            (true, None)
        }
        Err(e) => {
            let safe_error = crate::logging::redact_sensitive_log_text(&e);
            tracing::warn!(error = %safe_error, "add wallet initial sync failed");
            (false, Some(()))
        }
    };

    let error = add_wallet_public_error(discovery_failed, sync_failed.is_some());

    Json(AddWalletResp {
        wallet_id: id,
        synced,
        discovered: discovered_count,
        error,
    })
    .into_response()
}

/// Discover what tokens this wallet holds and seed empty
/// `TokenHolding` rows for each. The orchestrator's price refresh
/// fills in USD prices in a subsequent pass.
///
/// Order per chain:
///   1. Native gas balance via `eth_getBalance` (always, no key needed).
///   2. ERC-20 balances via Etherscan V2 when `etherscan` is set.
///
/// Returns the total count of newly-seeded holdings.
async fn seed_holdings(
    state_out: &mut WalletState,
    id: &WalletId,
    app: &AppState,
) -> Result<usize, String> {
    let router = app
        .orchestrator
        .router_arc()
        .ok_or_else(|| "orchestrator has no RpcRouter (sync config missing?)".to_string())?;

    let mut count = 0usize;
    for chain in &id.chains {
        // 1. Native gas balance.
        match discovery::fetch_native_balance(&router, chain, id.address).await {
            Ok(tok) => {
                tracing::info!(
                    chain = %chain,
                    address = %format!("{:#x}", id.address),
                    "seed: native balance ok"
                );
                state_out
                    .tokens
                    .insert(tok.key.clone(), discovered_to_holding(tok, chain));
                count += 1;
            }
            Err(e) => {
                let safe_error = crate::logging::redact_sensitive_log_text(&e);
                tracing::warn!(
                    chain = %chain,
                    address = %format!("{:#x}", id.address),
                    error = %safe_error,
                    "seed: native balance failed"
                );
                return Err(format!("native {chain}: {e}"));
            }
        }

        // 2. ERC-20 — try Etherscan first when a key is configured
        //    (comprehensive). If it 4xx's (no Pro tier, rate-limit, banned IP,
        //    etc.) fall back to the hardcoded top-N catalog via Multicall so
        //    free-tier users still see major stablecoins + WETH/WBTC/UNI/LINK.
        //    Listing every ERC-20 a wallet holds is a Pro-only endpoint at
        //    Etherscan as of 2026 — the fallback is therefore the common path.
        let mut erc20s = Vec::new();
        let mut source: &'static str = "top-tokens";
        let mut etherscan_failed: Option<String> = None;

        if let Some(es) = app.etherscan.as_ref() {
            match es.list_erc20_balances(chain, id.address).await {
                Ok(v) => {
                    source = "etherscan";
                    erc20s = v;
                }
                Err(e) => {
                    etherscan_failed = Some(format!("{e}"));
                }
            }
        }
        // Fallback path — no etherscan, or etherscan errored.
        if etherscan_failed.is_some() || app.etherscan.is_none() {
            match discovery::discover_top_tokens(&router, chain, id.address).await {
                Ok(v) => {
                    erc20s = v;
                    source = if etherscan_failed.is_some() {
                        "top-tokens (etherscan-fallback)"
                    } else {
                        "top-tokens"
                    };
                    if let Some(es_err) = &etherscan_failed {
                        let safe_error = crate::logging::redact_sensitive_log_text(es_err);
                        tracing::warn!(
                            chain = %chain,
                            etherscan_error = %safe_error,
                            "seed: etherscan failed, falling back to top-tokens multicall"
                        );
                    }
                }
                Err(top_err) => {
                    let safe_etherscan_error = crate::logging::redact_sensitive_log_text(
                        etherscan_failed.as_deref().unwrap_or("(no etherscan)"),
                    );
                    let safe_top_tokens_error = crate::logging::redact_sensitive_log_text(&top_err);
                    tracing::warn!(
                        chain = %chain,
                        etherscan_error = %safe_etherscan_error,
                        top_tokens_error = %safe_top_tokens_error,
                        "seed: both erc20 paths failed — keeping wallet without tokens"
                    );
                    continue;
                }
            }
        }

        tracing::info!(
            chain = %chain,
            candidates = erc20s.len(),
            source,
            "seed: erc20 candidates fetched"
        );
        let mut nonzero = 0usize;
        for tok in erc20s {
            if tok.balance.is_zero() {
                continue;
            }
            state_out
                .tokens
                .insert(tok.key.clone(), discovered_to_holding(tok, chain));
            count += 1;
            nonzero += 1;
        }
        tracing::info!(
            chain = %chain,
            inserted = nonzero,
            "seed: erc20 non-zero balances inserted"
        );

        seed_approvals_for_chain(state_out, id, &router, chain).await;
    }
    tracing::info!(
        address = %format!("{:#x}", id.address),
        total = count,
        "seed: completed"
    );

    // Best-effort CoinGecko metadata backfill. Capped by `MAX_METADATA_LOOKUPS`
    // so a wallet with 100+ tokens doesn't burn 100 sequential HTTP calls
    // synchronously — the orchestrator can fill the rest on next sync.
    backfill_metadata(state_out, &app.coingecko).await;
    Ok(count)
}

/// Discover current ERC-20 allowances for tokens already present in the wallet
/// state, then merge non-zero rows into primitive approval state.
async fn seed_approvals_for_chain(
    state: &mut WalletState,
    id: &WalletId,
    router: &Arc<RpcRouter>,
    chain: &ChainId,
) -> usize {
    let erc20_addrs = held_erc20_addresses(state, chain);
    if erc20_addrs.is_empty() {
        return 0;
    }

    match discovery::discover_approvals(router, chain, id.address, &erc20_addrs).await {
        Ok(found) => {
            let discovered = found.len();
            let inserted = seed_approvals(state, found);
            tracing::info!(
                chain = %chain,
                discovered,
                inserted,
                "seed: approvals discovered"
            );
            inserted
        }
        Err(e) => {
            let safe_error = crate::logging::redact_sensitive_log_text(&e);
            tracing::warn!(
                chain = %chain,
                error = %safe_error,
                "seed: approval discovery failed (best-effort)"
            );
            0
        }
    }
}

fn held_erc20_addresses(state: &WalletState, chain: &ChainId) -> Vec<Address> {
    state
        .tokens
        .keys()
        .filter_map(|key| match key {
            TokenKey::Erc20 {
                chain: token_chain,
                address,
            } if token_chain == chain => Some(*address),
            _ => None,
        })
        .collect()
}

/// Merge discovered non-zero allowances into `state.approvals.erc20`.
fn seed_approvals(state: &mut WalletState, found: Vec<policy_sync::DiscoveredApproval>) -> usize {
    use policy_state::approval::AllowanceSpec;

    let now = Time::from_unix(unix_now_u64());
    let mut inserted = 0usize;
    for row in found {
        if row.amount.is_zero() {
            continue;
        }
        state
            .approvals
            .erc20
            .entry((row.chain, row.token))
            .or_default()
            .insert(row.spender, AllowanceSpec::new(row.amount, now));
        inserted += 1;
    }
    inserted
}

/// Hit `CoinGecko` for every token in the seeded state that lacks
/// metadata. Caps at `MAX_METADATA_LOOKUPS` calls per request so the
/// caller doesn't wait too long on free-tier rate limits (~30 req/min).
async fn backfill_metadata(state: &mut WalletState, cg: &CoinGeckoClient) {
    const MAX_METADATA_LOOKUPS: usize = 12;

    let needs: Vec<(TokenKey, ChainId, Address)> = state
        .tokens
        .iter()
        .filter(|(_, h)| h.metadata.is_none())
        .filter_map(|(key, _)| match key {
            TokenKey::Erc20 { chain, address } => Some((key.clone(), chain.clone(), *address)),
            _ => None,
        })
        .take(MAX_METADATA_LOOKUPS)
        .collect();

    for (key, chain, address) in needs {
        if let Some(md) = cg.fetch_metadata(&chain, address).await {
            if let Some(h) = state.tokens.get_mut(&key) {
                h.metadata = Some(md);
            }
        }
    }
}

/// Convert a `DiscoveredToken` into a `TokenHolding` ready to land in
/// `WalletState.tokens`. Two source pointers are set:
///   - `primitives_source` → on-chain balance (`eth_getBalance` for
///     native, `balanceOf(address)` for ERC-20). The orchestrator's
///     refresh loop uses this to keep `balance` current.
///   - `price_usd: LiveField<Price>` → Chainlink USD feed when the
///     symbol maps to a known feed (USDC, ETH, WBTC, …). `synced_at`
///     starts at unix epoch 0 so the orchestrator picks it up on the
///     next refresh and fills in a real price. Unknown symbols get
///     `None` (the orchestrator skips them).
fn discovered_to_holding(tok: DiscoveredToken, chain: &ChainId) -> TokenHolding {
    let primitives_source = match &tok.key {
        TokenKey::Native { .. } => DataSource::OnchainView {
            chain: chain.clone(),
            contract: Address::ZERO,
            function: "eth_getBalance".into(),
            decoder_id: "eth_balance".into(),
        },
        TokenKey::Erc20 { address, .. } => DataSource::OnchainView {
            chain: chain.clone(),
            contract: *address,
            function: "balanceOf(address)".into(),
            decoder_id: "erc20_balance".into(),
        },
        _ => DataSource::UserSupplied,
    };
    let price_usd = chainlink_feed_for(&tok.symbol).map(|feed_id| {
        LiveField::new(
            Price::new("0"),
            DataSource::OracleFeed {
                provider: OracleProvider::Chainlink,
                feed_id: feed_id.to_string(),
            },
            Time::from_unix(0), // never synced — orchestrator picks up on first tick
        )
        .with_ttl(Duration::from_secs(60))
    });
    TokenHolding {
        key: tok.key,
        kind: TokenKind::Unknown,
        symbol: tok.symbol,
        decimals: tok.decimals,
        balance: Balance::fungible(tok.balance),
        committed: Balance::zero_fungible(),
        approved_to: None,
        price_usd,
        metadata: None,
        value_usd: None,
        last_synced_at: Time::from_unix(unix_now_u64()),
        primitives_source,
    }
}

/// Map a token symbol to its canonical Chainlink USD feed id. Returns
/// `None` for symbols without a wired feed — the orchestrator's
/// Chainlink registry decides per-chain availability separately.
fn chainlink_feed_for(symbol: &str) -> Option<&'static str> {
    // Wrapper tokens share the underlying asset's feed.
    match symbol.to_uppercase().as_str() {
        "ETH" | "WETH" | "STETH" | "WSTETH" => Some("ETH/USD"),
        "BTC" | "WBTC" => Some("WBTC/USD"),
        "USDC" | "USDC.E" | "USDBC" => Some("USDC/USD"),
        "USDT" => Some("USDT/USD"),
        "DAI" => Some("DAI/USD"),
        _ => None,
    }
}

/// `PATCH /wallets/:address` body.
#[allow(clippy::option_option)]
#[derive(Debug, Deserialize)]
pub struct PatchWalletReq {
    /// Display label. `None` (omitted) leaves the field untouched;
    /// explicit `null` clears it.
    #[serde(default, deserialize_with = "serde_helpers::deserialize_present")]
    pub label: Option<Option<String>>,
    /// Owned vs watch-only.
    #[serde(default)]
    pub is_owned: Option<bool>,
}

mod serde_helpers {
    use serde::{Deserialize, Deserializer};

    /// Distinguishes `{}` (field omitted → `Option::None`) from `{"label":
    /// null}` (field present-but-null → `Option::Some(None)`). PATCH
    /// semantics need that distinction.
    #[allow(clippy::option_option)]
    pub fn deserialize_present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(d).map(Some)
    }
}

/// `PATCH /wallets/:address` — update mutable display fields (label,
/// `is_owned`). Body is a partial JSON object; absent fields stay put.
pub async fn patch_wallet(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
    Json(req): Json<PatchWalletReq>,
) -> Response {
    let addr = match Address::from_str(&address) {
        Ok(a) => a,
        Err(e) => return bad_request(&format!("invalid address `{address}`: {e}")),
    };

    let lock = match acquire_user_wallet_lock(
        &*state.coordinator,
        state.sync_lock_ttl,
        &user.user_id,
        "wallet metadata update already running for this user",
        "wallet patch lock",
    )
    .await
    {
        Ok(lock) => lock,
        Err(response) => return response,
    };

    let response = patch_wallet_locked(state.clone(), user, addr, req).await;
    if let Err(e) = state.coordinator.release_lock(lock).await {
        let safe_error = crate::logging::redact_sensitive_log_text(&e);
        tracing::warn!(error = %safe_error, "failed to release wallet patch lock");
    }
    response
}

async fn patch_wallet_locked(
    state: AppState,
    user: AuthUser,
    addr: Address,
    req: PatchWalletReq,
) -> Response {
    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };
    let addr_str = format!("{addr:#x}");
    let label = match normalize_patch_wallet_label(req.label) {
        Ok(label) => label,
        Err(e) => return bad_request(&e),
    };
    let is_owned = req.is_owned;
    match store
        .update_wallet_metadata(&addr_str, label, is_owned)
        .await
    {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("wallet not tracked for this user"),
        Err(e) => internal(&format!("patch_wallet: {e}")),
    }
}

/// `DELETE /wallets/:address` — archive the wallet (soft delete).
/// Subsequent `GET /wallets` won't list it; the holdings rows stay so a
/// future un-archive could restore the snapshot.
pub async fn delete_wallet(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    let addr = match Address::from_str(&address) {
        Ok(a) => a,
        Err(e) => return bad_request(&format!("invalid address `{address}`: {e}")),
    };

    let lock = match acquire_user_wallet_lock(
        &*state.coordinator,
        state.sync_lock_ttl,
        &user.user_id,
        "wallet delete already running for this user",
        "wallet delete lock",
    )
    .await
    {
        Ok(lock) => lock,
        Err(response) => return response,
    };

    let response = delete_wallet_locked(state.clone(), user, addr).await;
    if let Err(e) = state.coordinator.release_lock(lock).await {
        let safe_error = crate::logging::redact_sensitive_log_text(&e);
        tracing::warn!(error = %safe_error, "failed to release wallet delete lock");
    }
    response
}

async fn delete_wallet_locked(state: AppState, user: AuthUser, addr: Address) -> Response {
    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };
    let addr_str = format!("{addr:#x}");
    let now = unix_now();
    match store.archive_wallet(&addr_str, now).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("wallet not tracked or already archived"),
        Err(e) => internal(&format!("delete_wallet: {e}")),
    }
}

/// `POST /wallets/:address/sync` — force a refresh against live RPC/oracle
/// sources. Caller blocks until the orchestrator finishes (or errors).
pub async fn sync_wallet(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    let addr = match Address::from_str(&address) {
        Ok(a) => a,
        Err(e) => return bad_request(&format!("invalid address `{address}`: {e}")),
    };

    let lock = match acquire_user_wallet_lock(
        &*state.coordinator,
        state.sync_lock_ttl,
        &user.user_id,
        "wallet sync already running for this user",
        "sync lock",
    )
    .await
    {
        Ok(lock) => lock,
        Err(response) => return response,
    };

    let response = sync_wallet_locked(state.clone(), user, addr).await;
    if let Err(e) = state.coordinator.release_lock(lock).await {
        let safe_error = crate::logging::redact_sensitive_log_text(&e);
        tracing::warn!(error = %safe_error, "failed to release sync lock");
    }
    response
}

async fn sync_wallet_locked(state: AppState, user: AuthUser, addr: Address) -> Response {
    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };

    // Find the wallet's chain set from the stored row.
    let known = match store.list_wallets().await {
        Ok(w) => w,
        Err(e) => return internal(&format!("list_wallets: {e}")),
    };
    let Some(id) = known.into_iter().find(|w| w.address == addr) else {
        return not_found("wallet not tracked for this user");
    };

    // Re-run discovery if (a) the wallet has no holdings at all, or
    // (b) it has only native gas balances and zero ERC-20s. The latter
    // means the original Etherscan discovery silently bailed out and
    let mut pre = match store.load(&id).await {
        Ok(s) => s,
        Err(e) => return internal(&format!("pre-sync load: {e}")),
    };
    pre.wallet_id = id.clone();
    let has_any_erc20 = pre
        .tokens
        .keys()
        .any(|k| matches!(k, policy_state::TokenKey::Erc20 { .. }));
    if pre.tokens.is_empty() || !has_any_erc20 {
        tracing::info!(
            address = %format!("{:#x}", id.address),
            had_total = pre.tokens.len(),
            had_erc20 = has_any_erc20,
            "sync: missing ERC-20 holdings — re-running discovery"
        );
        let mut seeded = pre.clone();
        match seed_holdings(&mut seeded, &id, &state).await {
            Ok(n) => {
                tracing::info!(seeded = n, "sync: discovery seeded N holdings");
                if let Err(e) = store.save(&seeded).await {
                    return internal(&format!("save after seed: {e}"));
                }
            }
            Err(e) => {
                let safe_error = crate::logging::redact_sensitive_log_text(&e);
                tracing::warn!(error = %safe_error, "sync: discovery failed — proceeding with previous wallet");
            }
        }
    } else if let Some(router) = state.orchestrator.router_arc() {
        let mut seeded = pre.clone();
        let mut inserted = 0usize;
        for chain in &id.chains {
            inserted += seed_approvals_for_chain(&mut seeded, &id, &router, chain).await;
        }
        if inserted > 0 {
            tracing::info!(
                inserted,
                "sync: approval discovery seeded allowances for existing ERC-20 holdings"
            );
            if let Err(e) = store.save(&seeded).await {
                return internal(&format!("save after approval discovery: {e}"));
            }
        }
    } else {
        tracing::warn!("sync: approval discovery skipped — orchestrator has no RpcRouter");
    }
    let counts = match run_sync(&*store, &id, &state.orchestrator).await {
        Ok(c) => c,
        Err(e) => return internal(&e),
    };
    state
        .publisher
        .publish(
            user.user_id.clone(),
            Event::WalletSynced(WalletSync {
                wallet: format!("{:#x}", id.address),
                fields_updated: counts.fields_updated,
                fields_failed: counts.fields_failed,
                synced_at: unix_now(),
            }),
        )
        .await;
    StatusCode::NO_CONTENT.into_response()
}

// ---------- permit ingest ----------

/// `POST /wallets/:address/permits` body — a decoded off-chain permit /
/// permit2 signature the extension holds *after* routing the EIP-712 payload.
///
/// Trust model (Phase 3, decided): client-asserted ingest. The server does
/// NOT verify the wallet signature and does NOT store the raw EIP-712 sig —
/// only the decoded params the reconciler needs (nonce / deadline / spender /
/// amount). The reducer turns these into a `SignedEIP2612` / `SignedPermit2` /
/// `SignedPermit2Transfer` pending entry; the sync reconciler later retires it.
///
/// The `kind` tag selects the variant; per-kind fields differ:
/// * `eip2612`           — EIP-2612 token `permit`: `deadline` + scalar nonce.
/// * `permit2_allowance` — Permit2 signed allowance: `expires_at` (+
///   `sig_deadline`) and a `(word, bit)` bitmap nonce.
/// * `permit2_transfer`  — Permit2 `SignatureTransfer`: `owner` + `sig_deadline`
///   + `(word, bit)` nonce + optional `witness_type`.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IngestPermitReq {
    /// EIP-2612 token `permit` signature.
    Eip2612 {
        /// ERC-20 token contract whose `permit` was signed.
        token: String,
        /// Address authorized to spend.
        spender: String,
        /// Allowance amount (decimal string).
        amount: String,
        /// Signature/permit deadline (unix secs).
        deadline: u64,
        /// Owner-level token nonce (decimal string).
        nonce: String,
        /// CAIP-2 chain id the token lives on (e.g. `"eip155:1"`).
        chain_id: String,
    },
    /// Permit2 signed allowance (`PermitSingle`).
    Permit2Allowance {
        /// Underlying token whose allowance is delegated through Permit2.
        token: String,
        /// Address authorized to spend.
        spender: String,
        /// Allowance amount (decimal string).
        amount: String,
        /// Allowance expiration (unix secs).
        expires_at: u64,
        /// Signature deadline (unix secs).
        sig_deadline: u64,
        /// Permit2 unordered-nonce word (decimal string).
        nonce_word: String,
        /// Permit2 unordered-nonce bit within the word (0..=255).
        nonce_bit: u8,
        /// CAIP-2 chain id the token lives on.
        chain_id: String,
    },
    /// Permit2 `SignatureTransfer` (`PermitTransferFrom` / witness variant).
    Permit2Transfer {
        /// Token whose one-time spend was authorized.
        token: String,
        /// Token owner / signer (must equal the path wallet address).
        owner: String,
        /// One-time spender named in the signature.
        spender: String,
        /// Maximum transfer amount (decimal string).
        amount: String,
        /// `SignatureTransfer` deadline (unix secs).
        sig_deadline: u64,
        /// Permit2 unordered-nonce word (decimal string).
        nonce_word: String,
        /// Permit2 unordered-nonce bit within the word (0..=255).
        nonce_bit: u8,
        /// Optional `PermitWitnessTransferFrom` witness type name.
        #[serde(default)]
        witness_type: Option<String>,
        /// CAIP-2 chain id the token lives on.
        chain_id: String,
    },
}

/// `POST /wallets/:address/permits` response — the resulting pending id(s).
#[derive(Debug, Serialize)]
pub struct IngestPermitResp {
    /// Deterministic pending id(s) the permit produced. Re-POSTing the same
    /// permit is idempotent (no duplicate), so this is always the canonical id.
    pub pending_ids: Vec<String>,
}

/// `POST /wallets/:address/permits` — record an off-chain permit / permit2
/// signature the extension just observed as a `PendingTx` in the wallet state.
///
/// Reuses the same `policy_transition` reducer the verdict path uses: it builds
/// the matching `ActionBody::Token(...)`, runs `apply()` to get the
/// `PendingChange::Add`, then upserts that pending entry into `state.pending`
/// **by id** and `save`s. Unlike `/evaluate`, this DOES persist — the signature
/// is real-world authoritative the moment the user signs, and the only place it
/// is observable is here (the extension at sign-time). Ids are deterministic
/// (`pending_id_for_*` in `effect/token.rs`), so a re-POST is a true no-op.
pub async fn ingest_permit(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
    Json(req): Json<IngestPermitReq>,
) -> Response {
    let addr = match Address::from_str(&address) {
        Ok(a) => a,
        Err(e) => return bad_request(&format!("invalid address `{address}`: {e}")),
    };

    let lock = match acquire_user_wallet_lock(
        &*state.coordinator,
        state.sync_lock_ttl,
        &user.user_id,
        "wallet permit ingest already running for this user",
        "permit ingest lock",
    )
    .await
    {
        Ok(lock) => lock,
        Err(response) => return response,
    };

    let response = ingest_permit_locked(state.clone(), user, addr, req).await;
    if let Err(e) = state.coordinator.release_lock(lock).await {
        let safe_error = crate::logging::redact_sensitive_log_text(&e);
        tracing::warn!(error = %safe_error, "failed to release permit ingest lock");
    }
    response
}

async fn ingest_permit_locked(
    state: AppState,
    user: AuthUser,
    addr: Address,
    req: IngestPermitReq,
) -> Response {
    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };

    // Resolve the canonical (multi-chain) WalletId by address — never key the
    // store by the permit's single chain, which would risk a load-miss /
    // clobber the stored chain set. Signed permits are ownership-bearing state:
    // a watch-only wallet may be synced/read, but it must not accept a locally
    // asserted permit report.
    let metadata = match store.list_wallet_metadata().await {
        Ok(w) => w,
        Err(e) => return internal(&format!("list_wallet_metadata: {e}")),
    };
    let id = match owned_wallet_id(metadata, addr) {
        Ok(id) => id,
        Err(e) => return e,
    };

    // Build the matching off-chain-sig action, run the reducer, and pull the
    // single pending Add it emits. The permit reducers read only `body` +
    // `ctx.now`, so the meta is synthetic (mirrors handler.rs test fixtures).
    let now = Time::from_unix(unix_now_u64());
    let action = match build_permit_action(&req, addr, now) {
        Ok(a) => a,
        Err(e) => return bad_request(&e),
    };
    let permit_chain = action_chain(&action);
    if let Err(e) = ensure_wallet_tracks_chain(&id, &permit_chain) {
        return bad_request(&e);
    }
    let ctx = EvalContext::new(permit_chain, now, RequestKind::Transaction);
    let delta = match apply(&WalletState::new(id.clone()), &action, &ctx) {
        Ok(d) => d,
        Err(e) => return unprocessable(&format!("reducer rejected permit: {e}")),
    };

    let mut loaded = match store.load(&id).await {
        Ok(s) => s,
        Err(e) => return internal(&format!("load: {e}")),
    };
    loaded.wallet_id = id.clone();

    let pending_ids = match upsert_pending_from_delta(&mut loaded, &delta) {
        Ok(ids) => ids,
        Err(e) => return (StatusCode::CONFLICT, e).into_response(),
    };

    if let Err(e) = store.save(&loaded).await {
        return internal(&format!("save: {e}"));
    }

    (StatusCode::OK, Json(IngestPermitResp { pending_ids })).into_response()
}

async fn acquire_user_wallet_lock(
    coordinator: &dyn Coordinator,
    ttl: std::time::Duration,
    user_id: &str,
    busy_message: &'static str,
    error_context: &'static str,
) -> Result<LockToken, Response> {
    let lock_key = format!("sync:user:{user_id}");
    match coordinator.try_lock(&lock_key, ttl).await {
        Ok(Some(lock)) => Ok(lock),
        Ok(None) => Err((StatusCode::CONFLICT, busy_message).into_response()),
        Err(e) => Err(internal(&format!("{error_context}: {e}"))),
    }
}

/// The chain the action's token lives on (for the `EvalContext`). Permit
/// reducers don't read the ctx chain, but a real value keeps the context honest.
fn action_chain(action: &Action) -> ChainId {
    match &action.body {
        ActionBody::Token(TokenAction::Erc20Permit(p)) => p.token.key.chain().clone(),
        ActionBody::Token(TokenAction::Permit2SignAllowance(p)) => p.token.key.chain().clone(),
        ActionBody::Token(TokenAction::Permit2SignTransfer(p)) => p.token.key.chain().clone(),
        _ => ChainId::ethereum_mainnet(),
    }
}

fn ensure_wallet_tracks_chain(id: &WalletId, chain: &ChainId) -> Result<(), String> {
    if id.chains.contains(chain) {
        Ok(())
    } else {
        Err("permit chain is not tracked for this wallet".to_owned())
    }
}

/// Build a decoded permit body into the off-chain-sig `Action` the reducer
/// consumes. `owner` for the transfer variant is forced to the path wallet
/// address — `Permit2SignTransferAction::apply` no-ops silently when
/// `owner != state.wallet_id.address`, so a mismatched body would be dropped.
fn build_permit_action(
    req: &IngestPermitReq,
    wallet: Address,
    now: Time,
) -> Result<Action, String> {
    let (body, deadline) = match req {
        IngestPermitReq::Eip2612 {
            token,
            spender,
            amount,
            deadline,
            nonce,
            chain_id,
        } => {
            let token_ref = erc20_token_ref(chain_id, token)?;
            let spender = parse_addr("spender", spender)?;
            let amount = parse_u256("amount", amount)?;
            let nonce = parse_u256("nonce", nonce)?;
            let deadline = Time::from_unix(*deadline);
            let body = ActionBody::Token(TokenAction::Erc20Permit(Erc20PermitAction {
                token: token_ref,
                spender,
                amount,
                deadline,
                nonce: LiveField::new(nonce, DataSource::UserSupplied, now),
            }));
            (body, deadline)
        }
        IngestPermitReq::Permit2Allowance {
            token,
            spender,
            amount,
            expires_at,
            sig_deadline,
            nonce_word,
            nonce_bit,
            chain_id,
        } => {
            let token_ref = erc20_token_ref(chain_id, token)?;
            let spender = parse_addr("spender", spender)?;
            let amount = parse_u256("amount", amount)?;
            let word = parse_u256("nonce_word", nonce_word)?;
            let sig_deadline = Time::from_unix(*sig_deadline);
            let body = ActionBody::Token(TokenAction::Permit2SignAllowance(Permit2SignAction {
                token: token_ref,
                spender,
                amount,
                expires_at: Time::from_unix(*expires_at),
                sig_deadline,
                nonce: LiveField::new((word, *nonce_bit), DataSource::UserSupplied, now),
            }));
            (body, sig_deadline)
        }
        IngestPermitReq::Permit2Transfer {
            token,
            owner,
            spender,
            amount,
            sig_deadline,
            nonce_word,
            nonce_bit,
            witness_type,
            chain_id,
        } => {
            let token_ref = erc20_token_ref(chain_id, token)?;
            // The body carries an `owner`, but the reducer only emits a pending
            // when it equals the wallet owner. The signer IS the path wallet, so
            // force it — and reject an explicit mismatch as a client error
            // rather than silently dropping the report.
            let body_owner = parse_addr("owner", owner)?;
            if body_owner != wallet {
                return Err(format!(
                    "permit2_transfer owner {body_owner:#x} does not match wallet {wallet:#x}"
                ));
            }
            let spender = parse_addr("spender", spender)?;
            let amount = parse_u256("amount", amount)?;
            let word = parse_u256("nonce_word", nonce_word)?;
            let sig_deadline = Time::from_unix(*sig_deadline);
            let witness_type = validate_witness_type(witness_type.as_deref())?;
            let body = ActionBody::Token(TokenAction::Permit2SignTransfer(
                Permit2SignTransferAction {
                    token: token_ref,
                    owner: wallet,
                    spender,
                    amount,
                    nonce: LiveField::new((word, *nonce_bit), DataSource::UserSupplied, now),
                    sig_deadline,
                    witness_type,
                },
            ));
            (body, sig_deadline)
        }
    };

    Ok(Action {
        meta: ActionMeta {
            submitted_at: now,
            submitter: wallet,
            nature: ActionNature::OffchainSig {
                domain: Eip712Domain {
                    name: "Permit".to_owned(),
                    version: None,
                    chain_id: None,
                    verifying_contract: None,
                    salt: None,
                },
                deadline,
                nonce_key: None,
            },
        },
        body,
    })
}

/// Upsert every `PendingChange::Add` in `delta` into `state.pending`, keyed by
/// the deterministic pending id. `apply_delta`'s `PendingChange::Add` blind-
/// pushes (no dedup), so re-applying the same permit would duplicate — instead
/// match by id and SKIP if already present (true idempotent no-op), else append.
/// Mirrors `orchestrator::upsert_intent_orders`. Returns the upserted id(s).
fn upsert_pending_from_delta(
    state: &mut WalletState,
    delta: &policy_state::StateDelta,
) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    for change in &delta.pending_changes {
        let PendingChange::Add { pending } = change else {
            continue;
        };
        ids.push(pending.id.clone());
        if !state.pending.iter().any(|p| p.id == pending.id) {
            if is_signed_permit_pending(pending)
                && signed_permit_pending_count(state) >= MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET
            {
                return Err(format!(
                    "too many signed permit pendings: max {MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET}"
                ));
            }
            state.pending.push((**pending).clone());
        }
    }
    Ok(ids)
}

fn signed_permit_pending_count(state: &WalletState) -> usize {
    state
        .pending
        .iter()
        .filter(|pending| is_signed_permit_pending(pending))
        .count()
}

fn is_signed_permit_pending(pending: &PendingTx) -> bool {
    matches!(
        &pending.kind,
        PendingKind::SignedEIP2612 { .. }
            | PendingKind::SignedPermit2 { .. }
            | PendingKind::SignedPermit2Transfer { .. }
    )
}

fn validate_witness_type(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Err("witness_type must not be blank".to_owned());
    }
    if raw.chars().count() > MAX_PERMIT_WITNESS_TYPE_CHARS {
        return Err(format!(
            "witness_type must be at most {MAX_PERMIT_WITNESS_TYPE_CHARS} characters"
        ));
    }
    if raw.chars().any(char::is_control) {
        return Err("witness_type must not contain control characters".to_owned());
    }
    Ok(Some(raw.to_owned()))
}

fn erc20_token_ref(chain_id: &str, token: &str) -> Result<TokenRef, String> {
    let address = parse_addr("token", token)?;
    Ok(TokenRef {
        key: TokenKey::Erc20 {
            chain: parse_eip155_chain_id(chain_id)?,
            address,
        },
    })
}

fn parse_addr(field: &str, raw: &str) -> Result<Address, String> {
    Address::from_str(raw).map_err(|e| format!("invalid {field} `{raw}`: {e}"))
}

fn parse_u256(field: &str, raw: &str) -> Result<U256, String> {
    U256::from_str(raw).map_err(|e| format!("invalid {field} `{raw}`: {e}"))
}

fn unprocessable(reason: &str) -> Response {
    (StatusCode::UNPROCESSABLE_ENTITY, reason.to_owned()).into_response()
}

#[allow(clippy::result_large_err)]
fn owned_wallet_id(
    metadata: Vec<PostgresWalletMetadata>,
    addr: Address,
) -> Result<WalletId, Response> {
    let addr_str = format!("{addr:#x}");
    let Some(row) = metadata.into_iter().find(|w| w.address == addr_str) else {
        return Err(not_found("wallet not tracked for this user"));
    };
    if !row.owned {
        return Err(forbidden(
            "signed permits can only be recorded for owned wallets",
        ));
    }
    Ok(WalletId::new(addr, row.chains))
}

// ---------- internals ----------

/// Load the wallet state, perform authoritative venue/RPC sync, refresh stale
/// live fields, and persist the result. Execution reports are reconciled only
/// after an authoritative source updates the wallet snapshot; a local preflight
/// or extension report is never treated as final state by itself.
async fn run_sync(
    store: &dyn WalletStore,
    id: &WalletId,
    orchestrator: &Arc<Orchestrator>,
) -> Result<SyncCounts, String> {
    let mut state = store
        .load(id)
        .await
        .map_err(|e| format!("load before sync: {e}"))?;
    state.wallet_id = id.clone();
    let now = Time::from_unix(unix_now_u64());

    let prim = orchestrator
        .sync_primitives(&mut state, now)
        .await
        .map_err(|e| format!("orchestrator.sync_primitives: {e}"))?;

    // Split HL sync into core (rolls equity_baseline/equity_hwm drawdown anchors)
    // + long-tail (ledger reconciliation → cumulative_net_flow / fill_window), so
    // the /wallets + /wallets/:address/sync paths populate the fields the perp
    // equity-drawdown circuit-breaker reads — verifiable locally, not only via the
    // background sync worker.
    let hl_core = orchestrator
        .sync_hyperliquid_core(&mut state, now)
        .await
        .map_err(|e| format!("orchestrator.sync_hyperliquid_core: {e}"))?;
    let hl_longtail = orchestrator
        .sync_hyperliquid_longtail(&mut state, now)
        .await
        .map_err(|e| format!("orchestrator.sync_hyperliquid_longtail: {e}"))?;

    let intent = orchestrator
        .sync_intent_orders(&mut state, now)
        .await
        .map_err(|e| format!("orchestrator.sync_intent_orders: {e}"))?;

    // Separate step from intent reconciliation: retire signed permit/permit2
    // pendings that have expired or been consumed (a distinct lifecycle).
    let permits = orchestrator
        .reconcile_permits(&mut state, now)
        .await
        .map_err(|e| format!("orchestrator.reconcile_permits: {e}"))?;

    let refresh = orchestrator
        .refresh(&mut state, now)
        .await
        .map_err(|e| format!("orchestrator.refresh: {e}"))?;
    store
        .save(&state)
        .await
        .map_err(|e| format!("save after sync: {e}"))?;

    let prim_updated = prim.block_heights_updated
        + prim.native_balances_updated
        + prim.erc20_balances_updated
        + prim.approvals_updated;
    Ok(SyncCounts {
        fields_updated: prim_updated
            + usize::from(hl_core.account_updated)
            + usize::from(hl_longtail.account_updated)
            + intent.orders_updated
            + permits.permits_retired
            + refresh.fields_updated,
        fields_failed: prim.errors.len()
            + hl_core.errors.len()
            + hl_longtail.errors.len()
            + intent.errors.len()
            + permits.errors.len()
            + refresh.fields_failed,
    })
}

/// Per-wallet refresh counts surfaced from [`run_sync`] so the sync paths can
/// emit a real `wallet_synced` payload instead of zeros.
struct SyncCounts {
    fields_updated: usize,
    fields_failed: usize,
}

fn build_wallet_id(req: &AddWalletReq, state: &AppState) -> Result<WalletId, Box<Response>> {
    let address = Address::from_str(&req.address).map_err(|e| {
        Box::new(bad_request(&format!(
            "invalid address `{}`: {e}",
            req.address
        )))
    })?;
    let chains: Vec<ChainId> = if req.chains.is_empty() {
        // Default — every chain the sync config has an RPC for. Better
        // UX than asking the user for CAIP-2 strings, and Multicall
        // keeps the per-chain cost flat.
        match state.orchestrator.router_arc() {
            Some(router) => router.chains().cloned().collect(),
            None => Vec::new(),
        }
    } else {
        let supported = state
            .orchestrator
            .router_arc()
            .map(|router| router.chains().cloned().collect::<BTreeSet<_>>());
        match resolve_explicit_wallet_chains(&req.chains, supported.as_ref()) {
            Ok(chains) => chains,
            Err(e) => return Err(Box::new(bad_request(&e))),
        }
    };
    if chains.is_empty() {
        return Err(Box::new(bad_request(
            "no chains configured on the server — set up dambi-sync.toml or pass `chains` explicitly",
        )));
    }
    Ok(WalletId::new(address, chains))
}

fn resolve_explicit_wallet_chains(
    raw_chains: &[String],
    supported: Option<&BTreeSet<ChainId>>,
) -> Result<Vec<ChainId>, String> {
    if raw_chains.len() > MAX_EXPLICIT_WALLET_CHAINS {
        return Err(format!("too many chains: max {MAX_EXPLICIT_WALLET_CHAINS}"));
    }

    let mut chains = Vec::with_capacity(raw_chains.len());
    let mut seen = BTreeSet::new();
    for raw in raw_chains {
        let chain = parse_eip155_chain_id(raw)?;
        if let Some(supported) = supported {
            if !supported.is_empty() && !supported.contains(&chain) {
                return Err(format!("unsupported chain `{raw}`"));
            }
        }
        if seen.insert(chain.clone()) {
            chains.push(chain);
        }
    }
    Ok(chains)
}

fn parse_eip155_chain_id(raw: &str) -> Result<ChainId, String> {
    let Some(rest) = raw.strip_prefix("eip155:") else {
        return Err(format!("unsupported chain `{raw}`: expected eip155:<id>"));
    };
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("invalid chain `{raw}`: expected eip155:<id>"));
    }
    let id = rest
        .parse::<u64>()
        .map_err(|_| format!("invalid chain `{raw}`: eip155 id is too large"))?;
    if raw != format!("eip155:{id}") {
        return Err(format!("invalid chain `{raw}`: non-canonical eip155 id"));
    }
    Ok(ChainId::new(raw.to_owned()))
}

fn normalize_add_wallet_label(label: Option<String>) -> Result<Option<String>, String> {
    label.map(|raw| normalize_wallet_label(&raw)).transpose()
}

#[allow(clippy::option_option)]
fn normalize_patch_wallet_label(
    label: Option<Option<String>>,
) -> Result<Option<Option<String>>, String> {
    match label {
        None => Ok(None),
        Some(None) => Ok(Some(None)),
        Some(Some(raw)) => normalize_wallet_label(&raw).map(|label| Some(Some(label))),
    }
}

fn normalize_wallet_label(raw: &str) -> Result<String, String> {
    let label = raw.trim();
    if label.is_empty() {
        return Err("wallet label must not be blank".to_owned());
    }
    if label.chars().count() > MAX_WALLET_LABEL_CHARS {
        return Err(format!(
            "wallet label must be at most {MAX_WALLET_LABEL_CHARS} characters"
        ));
    }
    Ok(label.to_owned())
}

fn active_wallet_quota_exceeded(active_wallets: &[PostgresWalletMetadata], address: &str) -> bool {
    active_wallets.len() >= MAX_ACTIVE_WALLETS_PER_USER
        && !active_wallets
            .iter()
            .any(|wallet| wallet.address.eq_ignore_ascii_case(address))
}

fn add_wallet_public_error(discovery_failed: bool, sync_failed: bool) -> Option<String> {
    match (discovery_failed, sync_failed) {
        (true, true) => Some(format!(
            "{ADD_WALLET_DISCOVERY_PUBLIC_ERROR}; {ADD_WALLET_SYNC_PUBLIC_ERROR}"
        )),
        (true, false) => Some(ADD_WALLET_DISCOVERY_PUBLIC_ERROR.to_owned()),
        (false, true) => Some(ADD_WALLET_SYNC_PUBLIC_ERROR.to_owned()),
        (false, false) => None,
    }
}

fn bad_request(reason: &str) -> Response {
    (StatusCode::BAD_REQUEST, reason.to_owned()).into_response()
}

fn not_found(reason: &str) -> Response {
    (StatusCode::NOT_FOUND, reason.to_owned()).into_response()
}

fn forbidden(reason: &str) -> Response {
    (StatusCode::FORBIDDEN, reason.to_owned()).into_response()
}

fn internal(reason: &str) -> Response {
    let safe_reason = crate::logging::redact_sensitive_log_text(reason);
    tracing::error!(error = %safe_reason, "write handler internal error");
    (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
}

fn unix_now() -> i64 {
    i64::try_from(unix_now_u64()).unwrap_or(0)
}

fn unix_now_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use policy_state::U256;

    #[derive(Clone)]
    struct BusyCoordinator {
        seen_key: Arc<Mutex<Option<String>>>,
    }

    #[async_trait::async_trait]
    impl Coordinator for BusyCoordinator {
        async fn try_lock(
            &self,
            key: &str,
            _ttl: std::time::Duration,
        ) -> Result<Option<LockToken>, crate::coordination::CoordinationError> {
            *self.seen_key.lock().expect("busy coordinator mutex") = Some(key.to_owned());
            Ok(None)
        }

        async fn release_lock(
            &self,
            _token: LockToken,
        ) -> Result<(), crate::coordination::CoordinationError> {
            Ok(())
        }

        async fn mark_idempotent(
            &self,
            _key: &str,
            _ttl: std::time::Duration,
        ) -> Result<bool, crate::coordination::CoordinationError> {
            Ok(false)
        }
    }

    fn busy_app_state(seen_key: Arc<Mutex<Option<String>>>) -> AppState {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.keep();
        let global_db = policy_db::GlobalDb::open(root.join("global.db")).unwrap();
        let multi_user = policy_db::MultiUserStore::new(root.join("users"));
        let event_bus = crate::events::EventBus::new();
        AppState {
            multi_user,
            global_db,
            event_bus: event_bus.clone(),
            publisher: Arc::new(crate::events::LocalEventPublisher::new(event_bus)),
            orchestrator: Arc::new(
                Orchestrator::from_sync_config(&policy_sync::SyncConfig::default()).unwrap(),
            ),
            etherscan: None,
            coingecko: CoinGeckoClient::new(),
            coordinator: Arc::new(BusyCoordinator { seen_key }),
            sync_lock_ttl: std::time::Duration::from_mins(2),
        }
    }

    fn auth_user(id: &str) -> AuthUser {
        AuthUser {
            user_id: id.to_owned(),
            email: format!("{id}@example.com"),
        }
    }

    #[tokio::test]
    async fn internal_errors_do_not_echo_reason() {
        let response = internal("store password=secret");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert_eq!(text, "Internal server error");
        assert!(!text.contains("secret"), "body leaked: {text}");
    }

    #[tokio::test]
    async fn permit_ingest_uses_user_wallet_lock_before_state_mutation() {
        let seen_key = Arc::new(Mutex::new(None));
        let state = busy_app_state(seen_key.clone());
        let req = IngestPermitReq::Eip2612 {
            token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48".into(),
            spender: "0x00000000000000000000000000000000deadbeef".into(),
            amount: "1".into(),
            deadline: 1_700_003_600,
            nonce: "1".into(),
            chain_id: "eip155:1".into(),
        };

        let response = ingest_permit(
            axum::extract::State(state),
            axum::Extension(auth_user("u_lock")),
            axum::extract::Path("0x000000000000000000000000000000000000a01c".to_owned()),
            axum::Json(req),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert_eq!(text, "wallet permit ingest already running for this user");
        assert_eq!(
            seen_key.lock().expect("busy coordinator mutex").as_deref(),
            Some("sync:user:u_lock")
        );
    }

    #[tokio::test]
    async fn patch_wallet_uses_user_wallet_lock_before_metadata_mutation() {
        let seen_key = Arc::new(Mutex::new(None));
        let state = busy_app_state(seen_key.clone());

        let response = patch_wallet(
            axum::extract::State(state),
            axum::Extension(auth_user("u_patch")),
            axum::extract::Path("0x000000000000000000000000000000000000a01c".to_owned()),
            axum::Json(PatchWalletReq {
                label: Some(Some("renamed".to_owned())),
                is_owned: Some(false),
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert_eq!(text, "wallet metadata update already running for this user");
        assert_eq!(
            seen_key.lock().expect("busy coordinator mutex").as_deref(),
            Some("sync:user:u_patch")
        );
    }

    #[tokio::test]
    async fn delete_wallet_uses_user_wallet_lock_before_archive_mutation() {
        let seen_key = Arc::new(Mutex::new(None));
        let state = busy_app_state(seen_key.clone());

        let response = delete_wallet(
            axum::extract::State(state),
            axum::Extension(auth_user("u_delete")),
            axum::extract::Path("0x000000000000000000000000000000000000a01c".to_owned()),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert_eq!(text, "wallet delete already running for this user");
        assert_eq!(
            seen_key.lock().expect("busy coordinator mutex").as_deref(),
            Some("sync:user:u_delete")
        );
    }

    #[test]
    fn explicit_wallet_chains_reject_excessive_request_fanout() {
        let chains = (0..=MAX_EXPLICIT_WALLET_CHAINS)
            .map(|i| format!("eip155:{}", i + 1))
            .collect::<Vec<_>>();

        let err = resolve_explicit_wallet_chains(&chains, None).unwrap_err();

        assert!(err.contains("too many chains"), "got: {err}");
    }

    #[test]
    fn explicit_wallet_chains_reject_non_evm_or_noncanonical_ids() {
        for raw in ["solana:mainnet", "eip155:", "eip155:abc", "eip155:01"] {
            let err = parse_eip155_chain_id(raw).unwrap_err();
            assert!(err.contains("chain"), "got: {err}");
        }
    }

    #[test]
    fn explicit_wallet_chains_reject_unsupported_configured_chain() {
        let supported = BTreeSet::from([ChainId::ethereum_mainnet()]);
        let chains = vec!["eip155:42161".to_owned()];

        let err = resolve_explicit_wallet_chains(&chains, Some(&supported)).unwrap_err();

        assert!(err.contains("unsupported chain"), "got: {err}");
    }

    #[test]
    fn explicit_wallet_chains_allow_supported_and_empty_router_sets() {
        let chains = vec!["eip155:1".to_owned(), "eip155:42161".to_owned()];
        let supported = BTreeSet::from([ChainId::ethereum_mainnet(), ChainId::arbitrum()]);

        let resolved = resolve_explicit_wallet_chains(&chains, Some(&supported))
            .expect("configured chains should pass");
        assert_eq!(resolved.len(), 2);

        let empty = BTreeSet::new();
        assert!(
            resolve_explicit_wallet_chains(&chains, Some(&empty)).is_ok(),
            "empty router configs are accepted for local compatibility"
        );
    }

    #[test]
    fn explicit_wallet_chains_deduplicate_repeated_ids_before_sync_fanout() {
        let chains = vec![
            "eip155:1".to_owned(),
            "eip155:1".to_owned(),
            "eip155:42161".to_owned(),
            "eip155:42161".to_owned(),
        ];
        let resolved =
            resolve_explicit_wallet_chains(&chains, None).expect("duplicates should normalize");

        assert_eq!(
            resolved,
            vec![ChainId::ethereum_mainnet(), ChainId::arbitrum()]
        );
    }

    #[test]
    fn wallet_label_normalization_trims_and_preserves_clear_semantics() {
        assert_eq!(
            normalize_add_wallet_label(Some("  main wallet  ".to_owned())).unwrap(),
            Some("main wallet".to_owned())
        );
        assert_eq!(
            normalize_patch_wallet_label(Some(None)).unwrap(),
            Some(None)
        );
        assert_eq!(normalize_patch_wallet_label(None).unwrap(), None);
    }

    #[test]
    fn wallet_label_normalization_rejects_blank_and_too_long_values() {
        assert!(normalize_add_wallet_label(Some("   ".to_owned())).is_err());

        let too_long = "a".repeat(MAX_WALLET_LABEL_CHARS + 1);
        let err = normalize_patch_wallet_label(Some(Some(too_long))).unwrap_err();
        assert!(err.contains("at most"), "got: {err}");
    }

    #[test]
    fn add_wallet_public_error_messages_do_not_echo_internal_reasons() {
        assert_eq!(
            add_wallet_public_error(true, false),
            Some("wallet discovery failed; retry sync later".to_owned())
        );
        assert_eq!(
            add_wallet_public_error(false, true),
            Some("wallet sync failed; retry sync later".to_owned())
        );
        let both = add_wallet_public_error(true, true).expect("combined error");
        assert!(both.contains("wallet discovery failed"), "got: {both}");
        assert!(both.contains("wallet sync failed"), "got: {both}");
        for leaked in ["http", "secret", "api", "postgres", "rpc"] {
            assert!(
                !both.to_ascii_lowercase().contains(leaked),
                "leaked {leaked}: {both}"
            );
        }
    }

    #[test]
    fn seed_approvals_writes_allowances_to_primitive_state() {
        let owner = Address::from([0x01; 20]);
        let chain = ChainId::new("eip155:1");
        let token = Address::from([0x02; 20]);
        let spender = Address::from([0x03; 20]);
        let amount = U256::from(123u64);
        let mut state = WalletState::new(WalletId::new(owner, [chain.clone()]));

        let inserted = seed_approvals(
            &mut state,
            vec![policy_sync::DiscoveredApproval {
                chain: chain.clone(),
                token,
                spender,
                amount,
            }],
        );

        assert_eq!(inserted, 1);
        let allowance = state
            .approvals
            .erc20
            .get(&(chain, token))
            .and_then(|spenders| spenders.get(&spender))
            .expect("approval should be stored under (chain, token) and spender");
        assert_eq!(allowance.amount, amount);
        assert!(!allowance.is_unlimited);
        assert!(allowance.last_set_at.as_unix() > 0);
    }

    #[test]
    fn seed_approvals_skips_zero_allowances() {
        let owner = Address::from([0x01; 20]);
        let chain = ChainId::new("eip155:1");
        let token = Address::from([0x02; 20]);
        let spender = Address::from([0x03; 20]);
        let mut state = WalletState::new(WalletId::new(owner, [chain.clone()]));

        let inserted = seed_approvals(
            &mut state,
            vec![policy_sync::DiscoveredApproval {
                chain: chain.clone(),
                token,
                spender,
                amount: U256::ZERO,
            }],
        );

        assert_eq!(inserted, 0);
        assert!(state.approvals.erc20.is_empty());
    }

    // ---------- permit ingest ----------

    use policy_state::pending::PendingKind;

    fn wallet_addr() -> Address {
        Address::from_str("0x000000000000000000000000000000000000a01c").unwrap()
    }

    fn spender_hex() -> &'static str {
        "0x00000000000000000000000000000000deadbeef"
    }

    fn usdc_hex() -> &'static str {
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    }

    fn wallet_metadata(
        address: Address,
        owned: bool,
        chains: Vec<ChainId>,
    ) -> PostgresWalletMetadata {
        PostgresWalletMetadata {
            address: format!("{address:#x}"),
            chains,
            label: None,
            owned,
            archived: false,
        }
    }

    #[test]
    fn permit_ingest_wallet_resolution_rejects_untracked_wallet() {
        let response = owned_wallet_id(Vec::new(), wallet_addr()).unwrap_err();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn permit_ingest_wallet_resolution_rejects_watch_only_wallet() {
        let response = owned_wallet_id(
            vec![wallet_metadata(
                wallet_addr(),
                false,
                vec![ChainId::ethereum_mainnet()],
            )],
            wallet_addr(),
        )
        .unwrap_err();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn permit_ingest_wallet_resolution_preserves_stored_chain_set() {
        let chains = vec![ChainId::ethereum_mainnet(), ChainId::new("eip155:42161")];
        let id = owned_wallet_id(
            vec![wallet_metadata(wallet_addr(), true, chains.clone())],
            wallet_addr(),
        )
        .expect("owned tracked wallet");

        assert_eq!(id.address, wallet_addr());
        assert_eq!(id.chains.len(), chains.len());
        for chain in chains {
            assert!(id.chains.contains(&chain));
        }
    }

    #[test]
    fn permit_ingest_rejects_untracked_chain() {
        let id = WalletId::new(wallet_addr(), [ChainId::ethereum_mainnet()]);
        let err = ensure_wallet_tracks_chain(&id, &ChainId::arbitrum()).unwrap_err();

        assert_eq!(err, "permit chain is not tracked for this wallet");
    }

    #[test]
    fn permit_token_ref_requires_canonical_eip155_chain() {
        for raw in ["1", "solana:mainnet", "eip155:01"] {
            let err = erc20_token_ref(raw, usdc_hex()).unwrap_err();
            assert!(err.contains("chain"), "got: {err}");
        }
    }

    /// Mirror `ingest_permit`'s core: build the action, run the reducer, upsert
    /// the resulting pending into a fresh state.
    fn ingest_into_result(
        state: &mut WalletState,
        req: &IngestPermitReq,
    ) -> Result<Vec<String>, String> {
        let now = Time::from_unix(1_700_000_000);
        let action = build_permit_action(req, wallet_addr(), now).expect("build action");
        let ctx = EvalContext::new(action_chain(&action), now, RequestKind::Transaction);
        let delta =
            apply(&WalletState::new(state.wallet_id.clone()), &action, &ctx).expect("apply");
        upsert_pending_from_delta(state, &delta)
    }

    fn ingest_into(state: &mut WalletState, req: &IngestPermitReq) -> Vec<String> {
        ingest_into_result(state, req).expect("upsert pending")
    }

    fn fresh_state() -> WalletState {
        WalletState::new(WalletId::new(wallet_addr(), [ChainId::ethereum_mainnet()]))
    }

    #[test]
    fn ingest_eip2612_adds_signed_eip2612_pending_and_is_idempotent() {
        let req = IngestPermitReq::Eip2612 {
            token: usdc_hex().into(),
            spender: spender_hex().into(),
            amount: "1000000000".into(),
            deadline: 1_700_003_600,
            nonce: "7".into(),
            chain_id: "eip155:1".into(),
        };
        let mut state = fresh_state();

        let ids = ingest_into(&mut state, &req);
        assert_eq!(ids.len(), 1);
        assert_eq!(state.pending.len(), 1);
        assert!(matches!(
            state.pending[0].kind,
            PendingKind::SignedEIP2612 { .. }
        ));
        assert_eq!(state.pending[0].id, ids[0]);

        // Re-ingest the SAME permit → deterministic id → no duplicate.
        let ids2 = ingest_into(&mut state, &req);
        assert_eq!(ids2, ids, "re-POST returns the same canonical id");
        assert_eq!(state.pending.len(), 1, "re-POST must be idempotent");
    }

    #[test]
    fn ingest_permit2_allowance_adds_signed_permit2_pending_and_is_idempotent() {
        let req = IngestPermitReq::Permit2Allowance {
            token: usdc_hex().into(),
            spender: spender_hex().into(),
            amount: "2000000".into(),
            expires_at: 1_700_090_000,
            sig_deadline: 1_700_003_600,
            nonce_word: "3".into(),
            nonce_bit: 7,
            chain_id: "eip155:1".into(),
        };
        let mut state = fresh_state();

        let ids = ingest_into(&mut state, &req);
        assert_eq!(state.pending.len(), 1);
        assert!(matches!(
            state.pending[0].kind,
            PendingKind::SignedPermit2 { .. }
        ));

        let ids2 = ingest_into(&mut state, &req);
        assert_eq!(ids2, ids);
        assert_eq!(state.pending.len(), 1);
    }

    #[test]
    fn ingest_permit2_transfer_adds_signed_transfer_pending_and_is_idempotent() {
        let req = IngestPermitReq::Permit2Transfer {
            token: usdc_hex().into(),
            // Owner MUST match the wallet — `Permit2SignTransferAction::apply`
            // silently no-ops otherwise.
            owner: format!("{:#x}", wallet_addr()),
            spender: spender_hex().into(),
            amount: "4000000".into(),
            sig_deadline: 1_700_003_600,
            nonce_word: "9".into(),
            nonce_bit: 12,
            witness_type: Some("PermitTransferFrom".into()),
            chain_id: "eip155:1".into(),
        };
        let mut state = fresh_state();

        let ids = ingest_into(&mut state, &req);
        assert_eq!(ids.len(), 1, "transfer must emit a pending (owner matched)");
        assert_eq!(state.pending.len(), 1);
        assert!(matches!(
            state.pending[0].kind,
            PendingKind::SignedPermit2Transfer { .. }
        ));

        let ids2 = ingest_into(&mut state, &req);
        assert_eq!(ids2, ids);
        assert_eq!(state.pending.len(), 1);
    }

    #[test]
    fn ingest_permit2_transfer_owner_mismatch_is_client_error() {
        let req = IngestPermitReq::Permit2Transfer {
            token: usdc_hex().into(),
            owner: "0x0000000000000000000000000000000000000bad".into(),
            spender: spender_hex().into(),
            amount: "4000000".into(),
            sig_deadline: 1_700_003_600,
            nonce_word: "9".into(),
            nonce_bit: 12,
            witness_type: None,
            chain_id: "eip155:1".into(),
        };
        let now = Time::from_unix(1_700_000_000);
        let err = build_permit_action(&req, wallet_addr(), now).unwrap_err();
        assert!(err.contains("does not match wallet"), "got: {err}");
    }

    #[test]
    fn ingest_permit2_transfer_rejects_oversized_or_control_witness_type() {
        let mut req = IngestPermitReq::Permit2Transfer {
            token: usdc_hex().into(),
            owner: format!("{:#x}", wallet_addr()),
            spender: spender_hex().into(),
            amount: "4000000".into(),
            sig_deadline: 1_700_003_600,
            nonce_word: "9".into(),
            nonce_bit: 12,
            witness_type: Some("x".repeat(MAX_PERMIT_WITNESS_TYPE_CHARS + 1)),
            chain_id: "eip155:1".into(),
        };
        let now = Time::from_unix(1_700_000_000);
        let err = build_permit_action(&req, wallet_addr(), now).unwrap_err();
        assert!(err.contains("witness_type"), "got: {err}");

        if let IngestPermitReq::Permit2Transfer { witness_type, .. } = &mut req {
            *witness_type = Some("Permit\nWitness".to_owned());
        }
        let err = build_permit_action(&req, wallet_addr(), now).unwrap_err();
        assert!(err.contains("control characters"), "got: {err}");
    }

    #[test]
    fn ingest_signed_permit_pending_cap_rejects_new_entries_only() {
        let mut state = fresh_state();
        let mut first_req = None;
        let mut first_ids = None;
        for i in 0..MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET {
            let req = IngestPermitReq::Eip2612 {
                token: usdc_hex().into(),
                spender: spender_hex().into(),
                amount: "1".into(),
                deadline: 1_700_003_600,
                nonce: i.to_string(),
                chain_id: "eip155:1".into(),
            };
            let ids = ingest_into(&mut state, &req);
            if i == 0 {
                first_req = Some(req);
                first_ids = Some(ids);
            }
        }
        assert_eq!(
            signed_permit_pending_count(&state),
            MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET
        );

        let duplicate = ingest_into_result(&mut state, &first_req.expect("first req"))
            .expect("duplicate idempotent upsert should remain allowed");
        assert_eq!(duplicate, first_ids.expect("first ids"));
        assert_eq!(
            signed_permit_pending_count(&state),
            MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET
        );

        let extra = IngestPermitReq::Eip2612 {
            token: usdc_hex().into(),
            spender: spender_hex().into(),
            amount: "1".into(),
            deadline: 1_700_003_600,
            nonce: MAX_SIGNED_PERMIT_PENDINGS_PER_WALLET.to_string(),
            chain_id: "eip155:1".into(),
        };
        let err = ingest_into_result(&mut state, &extra).unwrap_err();
        assert!(
            err.contains("too many signed permit pendings"),
            "got: {err}"
        );
    }

    #[test]
    fn ingest_two_distinct_permits_coexist() {
        let mut state = fresh_state();
        ingest_into(
            &mut state,
            &IngestPermitReq::Eip2612 {
                token: usdc_hex().into(),
                spender: spender_hex().into(),
                amount: "1".into(),
                deadline: 1_700_003_600,
                nonce: "1".into(),
                chain_id: "eip155:1".into(),
            },
        );
        ingest_into(
            &mut state,
            &IngestPermitReq::Eip2612 {
                token: usdc_hex().into(),
                spender: spender_hex().into(),
                amount: "1".into(),
                deadline: 1_700_003_600,
                nonce: "2".into(), // different nonce → different id
                chain_id: "eip155:1".into(),
            },
        );
        assert_eq!(state.pending.len(), 2);
    }
}
