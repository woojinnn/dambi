//! LIVE server-data-plane e2e for the HL `session-loss-circuit-breaker`
//! enrichment methods (`perp.equity_drawdown_bps` + `perp.session_fill_stats`).
//!
//! This is the **Procedure C** (real `/evaluate` data plane) proof for the
//! server-state package: a real axum server + real PostgreSQL persist a crafted
//! HL account (anchors + fill window) through the genuine `WalletStore` serde
//! path, then a real HTTP `/evaluate` request — keyed by the MASTER wallet, the
//! identity the SW prereq forwards — reads it back through the genuine handler
//! and returns the method outputs the Cedar atoms threshold on.
//!
//! What this closes beyond the in-process handler tests (`handler.rs`):
//!   * real PostgreSQL JSONB round-trip of the NEW state fields
//!     (`EquityAnchor`, `HlFillSummary`) — unit tests use `InMemoryWalletStore`;
//!   * real HTTP transport through `evaluate_handler` (auth → derive_user_id →
//!     load state by `wallet_id.address` → `execute_call_specs`).
//!
//! Run (Postgres on :5433, schema pre-applied):
//!   TEST_DATABASE_URL=postgres://dambi:dambi@127.0.0.1:5433/dambi \
//!     cargo test -p policy-server --test perp_server_state_e2e -- --ignored --nocapture

use std::fs;
use std::str::FromStr;
use std::sync::Arc;

use policy_db::{GlobalDb, MultiUserStore};
use policy_engine_wasm::{evaluate_action_v2_json, plan_action_rpc_v2_json};
use policy_server::app::{build_router, AppState};
use policy_server::auth::jwt::{issue, TokenType};
use policy_server::events::{EventBus, LocalEventPublisher};
use policy_state::live_field::DataSource;
use policy_state::position::{EquityAnchor, HlAccount, HlFillSummary, Position, PositionKind};
use policy_state::primitives::{Address, ChainId, Decimal, Time};
use policy_state::{ProtocolRef, WalletId, WalletState, WalletStore};
use policy_sync::{Orchestrator, SyncConfig};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

const TEST_SECRET: &str = "test-secret-only-do-not-use-in-production-2026-05-31";
const GITBOOK_PERP_POLICIES_PATH: &str = "/tmp/scopeball-gitbook-perp/perp-policies.json";

fn ensure_jwt_secret() {
    std::env::set_var("JWT_SECRET", TEST_SECRET);
}

fn mint_token(user_id: &str) -> String {
    ensure_jwt_secret();
    issue(user_id, "test@example.com", TokenType::Access, None).unwrap()
}

async fn spawn_server() -> (
    std::net::SocketAddr,
    MultiUserStore,
    tempfile::TempDir,
    String,
    String,
) {
    let tmp = tempfile::tempdir().unwrap();
    let global_db = GlobalDb::open(tmp.path().join("global.db")).unwrap();
    // Globally unique email per spawn keeps repeated runs against the shared
    // integration DB from inheriting wallet rows from an earlier process.
    let suffix = Uuid::new_v4();
    let user_id = global_db
        .upsert_user(&format!("perp-e2e-{suffix}@example.com"), "test")
        .await
        .unwrap();
    let multi_user = MultiUserStore::new(tmp.path().join("users"));
    let event_bus = EventBus::new();
    let state = AppState {
        multi_user: multi_user.clone(),
        global_db,
        event_bus: event_bus.clone(),
        publisher: Arc::new(LocalEventPublisher::new(event_bus)),
        orchestrator: Arc::new(Orchestrator::from_sync_config(&SyncConfig::default()).unwrap()),
        etherscan: None,
        coingecko: policy_sync::CoinGeckoClient::new(),
        coordinator: Arc::new(policy_server::coordination::NoopCoordinator),
        sync_lock_ttl: std::time::Duration::from_secs(120),
    };
    let router = build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let token = mint_token(&user_id);
    (addr, multi_user, tmp, token, user_id)
}

/// The MASTER wallet the venue order resolves to (the identity the SW prereq
/// forwards as `walletAddress` and the server loads state for).
const MASTER: &str = "0x1111111111111111111111111111111111111111";
/// A second wallet whose HL account has neither an equity baseline nor any
/// fills — both methods must skip it (fail-open / dormant), never fabricate.
const CONTROL: &str = "0x2222222222222222222222222222222222222222";

fn hl_position(account: HlAccount, synced_at: u64) -> Position {
    Position {
        id: "hyperliquid/account".into(),
        protocol: ProtocolRef::new("hyperliquid"),
        chain: None,
        kind: PositionKind::HyperliquidAccount(account),
        primitives_synced_at: Time::from_unix(synced_at),
        primitives_source: DataSource::VenueApi {
            endpoint: "https://api.hyperliquid.xyz/info".into(),
            parser_id: "hl_account".into(),
            auth: None,
        },
    }
}

/// Seed a crafted HL account that trips all four circuit-breaker atoms:
///   * equity 10000 → 9500  ⇒ dayDrawdownBps 500  (daily-loss-limit ≥ 500)
///   * HWM 10326.09 → 9500   ⇒ peakDrawdownBps 800  (max-drawdown ≥ 800)
///   * 3 most-recent closes negative ⇒ lossStreak 3 (loss-streak-cooldown ≥ 3)
///   * 16 fills today          ⇒ tradesToday 16     (overtrading > 15)
async fn seed_tripping(mu: &MultiUserStore, user_id: &str, now_secs: i64) {
    let store = mu.for_user(user_id).unwrap();
    let id = WalletId::new(
        Address::from_str(MASTER).unwrap(),
        [ChainId::ethereum_mainnet()],
    );
    let mut s = WalletState::new(id);

    let day_start_ms = (now_secs / 86_400) * 86_400 * 1000;
    let base = day_start_ms + 100_000;
    // Newest-first by realized PnL: [-10,-20,-30, +50, then 12×+5]. The +50 at
    // position 4 stops the streak at 3. All 16 land inside today's UTC window.
    // Σ closedPnl = -60 + 50 + 60 = 50.
    let pnls = [
        "-10", "-20", "-30", "50", "5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "5", "5",
    ];
    let fills: Vec<HlFillSummary> = pnls
        .iter()
        .enumerate()
        .map(|(i, pnl)| HlFillSummary {
            tid: 1_000 + i as u64,
            // i=0 → largest time (newest); strictly descending, all > day_start.
            time: (base + (16 - i as i64) * 1_000) as u64,
            coin: "BTC".into(),
            closed_pnl: Decimal::new(*pnl),
            px: Decimal::new("100"),
            sz: Decimal::new("1"),
        })
        .collect();

    s.positions.push(hl_position(
        HlAccount {
            perp_account_value_usd: Some(Decimal::new("9500")),
            equity_baseline: Some(EquityAnchor {
                value: Decimal::new("10000"),
                anchored_at: Time::from_unix((now_secs - 40_000) as u64),
                trusted: true,
            }),
            equity_hwm: Some(Decimal::new("10326.09")),
            fill_window: fills,
            ..HlAccount::default()
        },
        now_secs as u64,
    ));
    store.save(&s).await.unwrap();
}

/// Seed a control HL account: present (so `find_hl_account` matches) but with no
/// baseline and an empty fill window — both methods return `None`.
async fn seed_control(mu: &MultiUserStore, user_id: &str, now_secs: i64) {
    let store = mu.for_user(user_id).unwrap();
    let id = WalletId::new(
        Address::from_str(CONTROL).unwrap(),
        [ChainId::ethereum_mainnet()],
    );
    let mut s = WalletState::new(id);
    s.positions.push(hl_position(
        HlAccount {
            perp_account_value_usd: Some(Decimal::new("1000")),
            // equity_baseline: None, equity_hwm: None, fill_window: empty
            ..HlAccount::default()
        },
        now_secs as u64,
    ));
    store.save(&s).await.unwrap();
}

/// Seed an account whose raw equity is down BUT the drop is entirely a capital
/// withdrawal (`cumulative_net_flow` −500): raw 9500, flow-neutral 9500−(−500) =
/// 10000 = the peak/baseline → drawdown must read 0. Exercises the Postgres
/// JSONB round-trip of `cumulative_net_flow` and the method's flow netting.
async fn seed_flow_neutral(mu: &MultiUserStore, user_id: &str, now_secs: i64) {
    let store = mu.for_user(user_id).unwrap();
    let id = WalletId::new(
        Address::from_str(MASTER).unwrap(),
        [ChainId::ethereum_mainnet()],
    );
    let mut s = WalletState::new(id);
    s.positions.push(hl_position(
        HlAccount {
            perp_account_value_usd: Some(Decimal::new("9500")),
            equity_baseline: Some(EquityAnchor {
                value: Decimal::new("10000"),
                anchored_at: Time::from_unix((now_secs - 40_000) as u64),
                trusted: true,
            }),
            equity_hwm: Some(Decimal::new("10000")),
            cumulative_net_flow: Decimal::new("-500"),
            ledger_cursor_ms: 1_781_000_000_000,
            ..HlAccount::default()
        },
        now_secs as u64,
    ));
    store.save(&s).await.unwrap();
}

async fn save_hl_account(
    mu: &MultiUserStore,
    user_id: &str,
    address: &str,
    account: HlAccount,
    now_secs: i64,
) {
    let store = mu.for_user(user_id).unwrap();
    let id = WalletId::new(
        Address::from_str(address).unwrap(),
        [ChainId::ethereum_mainnet()],
    );
    let mut state = WalletState::new(id);
    state.positions.push(hl_position(account, now_secs as u64));
    store.save(&state).await.unwrap();
}

fn acct_equity(value: &str, baseline: &str, hwm: &str, now_secs: i64) -> HlAccount {
    HlAccount {
        perp_account_value_usd: Some(Decimal::new(value)),
        equity_baseline: Some(EquityAnchor {
            value: Decimal::new(baseline),
            anchored_at: Time::from_unix((now_secs - 40_000) as u64),
            trusted: true,
        }),
        equity_hwm: Some(Decimal::new(hwm)),
        ..HlAccount::default()
    }
}

fn acct_fills(pnls: &[&str], now_secs: i64) -> HlAccount {
    let day_start_ms = (now_secs / 86_400) * 86_400 * 1000;
    let base = day_start_ms + 100_000;
    let n = pnls.len() as i64;
    let fills: Vec<HlFillSummary> = pnls
        .iter()
        .enumerate()
        .map(|(i, pnl)| HlFillSummary {
            tid: 9_000 + i as u64,
            time: (base + (n - i as i64) * 1_000) as u64,
            coin: "BTC".into(),
            closed_pnl: Decimal::new(*pnl),
            px: Decimal::new("100"),
            sz: Decimal::new("1"),
        })
        .collect();

    HlAccount {
        perp_account_value_usd: Some(Decimal::new("10000")),
        equity_baseline: Some(EquityAnchor {
            value: Decimal::new("10000"),
            anchored_at: Time::from_unix((now_secs - 40_000) as u64),
            trusted: true,
        }),
        equity_hwm: Some(Decimal::new("10000")),
        fill_window: fills,
        ..HlAccount::default()
    }
}

#[derive(Debug, Deserialize)]
struct GitbookPolicy {
    ids: Vec<String>,
    policy: String,
    manifest: Value,
}

fn gitbook_perp_policies() -> Vec<GitbookPolicy> {
    serde_json::from_str(
        &fs::read_to_string(GITBOOK_PERP_POLICIES_PATH)
            .unwrap_or_else(|err| panic!("read {GITBOOK_PERP_POLICIES_PATH}: {err}")),
    )
    .unwrap_or_else(|err| panic!("{GITBOOK_PERP_POLICIES_PATH} parses: {err}"))
}

fn gitbook_policy<'a>(policies: &'a [GitbookPolicy], id: &str) -> &'a GitbookPolicy {
    policies
        .iter()
        .find(|policy| policy.ids.iter().any(|candidate| candidate == id))
        .unwrap_or_else(|| panic!("missing GitBook Perp policy {id}"))
}

fn gitbook_bundle(policy: &GitbookPolicy) -> Value {
    json!({ "policy": policy.policy, "manifest": policy.manifest })
}

/// Build the venue-shaped `/evaluate` request. The envelope body is irrelevant
/// to these methods (they read persisted state, not the body) — mirror a known
/// well-formed body and attach the two perp call_specs.
fn evaluate_req(address: &str, now_secs: i64) -> serde_json::Value {
    json!({
        // Mirrors the extension's HL venue `/evaluate` wire: the request chain is
        // the off-chain HL venue id, while Postgres state lookup is keyed by
        // user+address and returns the stored EVM wallet snapshot.
        "wallet_id": { "address": address, "chains": ["hl-mainnet"] },
        "envelopes": [{
            "meta": {
                "nature": {
                    "kind": "onchain_tx", "chain": "eip155:1", "nonce": 0,
                    "value": "0x0", "gas_limit": "0x0",
                    "gas_price": {
                        "source": { "kind": "oracle_feed", "provider": "pyth", "feed_id": "gas/eip155:1" },
                        "synced_at": now_secs, "value": "0x0"
                    }
                },
                "submitted_at": now_secs, "submitter": address
            },
            "body": {
                "domain": "staking", "action": "stake", "amount": "0xde0b6b3a7640000",
                "recipient": "0x00000000000000000000000000000000deadbeef",
                "venue": { "chain": "eip155:1", "name": "ethena_staked_usde", "vault": "0x9d39a5de30e57443bff2a8307a4256c8797a3497" }
            }
        }],
        "eval_context": { "chain": "eip155:1", "now": now_secs, "action_index": 0, "request_kind": "transaction", "simulation": "preview" },
        "call_specs": [
            { "manifest_id": "perp-daily-loss", "call_id": "dd::s", "method": "perp.equity_drawdown_bps", "params": { "chain_id": "hl-mainnet" }, "outputs": [], "optional": true },
            { "manifest_id": "perp-fills", "call_id": "fs::s", "method": "perp.session_fill_stats", "params": { "chain_id": "hl-mainnet", "now": now_secs }, "outputs": [], "optional": true }
        ]
    })
}

/// Same as [`evaluate_req`] but sets the `session_fill_stats` `min_loss_usd` band
/// param (a manifest literal) so the test can exercise per-policy threshold
/// configuration over the genuine HTTP + Postgres path.
fn evaluate_req_min_loss(address: &str, now_secs: i64, min_loss_usd: &str) -> serde_json::Value {
    let mut req = evaluate_req(address, now_secs);
    req["call_specs"][1]["params"]["min_loss_usd"] = json!(min_loss_usd);
    req
}

fn hl_order_action() -> Value {
    json!({
        "domain": "perp",
        "action": "place_order",
        "venue": { "name": "hyperliquid", "chain": "hyperliquid:mainnet" },
        "market": { "symbol": "BTC", "venue": { "name": "hyperliquid" } },
        "side": "long",
        "size": { "kind": "base_decimal", "amount": "0.10" },
        "reduce_only": false,
        "order_type": {
            "kind": "limit",
            "price": "65000",
            "time_in_force": { "kind": "gtc" }
        }
    })
}

fn place_order(symbol: &str, side: &str, reduce_only: bool, size: &str, price: &str) -> Value {
    json!({
        "domain": "perp",
        "action": "place_order",
        "venue": { "name": "hyperliquid", "chain": "hyperliquid:mainnet" },
        "market": { "symbol": symbol, "venue": { "name": "hyperliquid" } },
        "side": side,
        "size": { "kind": "base_decimal", "amount": size },
        "reduce_only": reduce_only,
        "order_type": {
            "kind": "limit",
            "price": price,
            "time_in_force": { "kind": "gtc" }
        }
    })
}

fn change_leverage(symbol: &str, leverage: i64) -> Value {
    json!({
        "domain": "perp",
        "action": "change_leverage",
        "venue": { "name": "hyperliquid", "chain": "hyperliquid:mainnet" },
        "market": { "symbol": symbol, "venue": { "name": "hyperliquid" } },
        "new_leverage": leverage.to_string()
    })
}

fn adjust_margin(symbol: &str, delta: &str) -> Value {
    json!({
        "domain": "perp",
        "action": "adjust_margin",
        "venue": { "name": "hyperliquid", "chain": "hyperliquid:mainnet" },
        "market": { "symbol": symbol, "venue": { "name": "hyperliquid" } },
        "side": "long",
        "delta": delta
    })
}

fn market_enrichment(symbol: &str, fields: Value) -> Value {
    json!({ "markets": { symbol: fields } })
}

fn market_account_enrichment(symbol: &str, market: Value, account: Value) -> Value {
    json!({ "markets": { symbol: market }, "account": account })
}

fn hl_order_meta(now_secs: i64) -> Value {
    json!({
        "submitted_at": now_secs,
        "submitter": MASTER,
        "nature": {
            "kind": "offchain_sig",
            "domain": { "name": "Hyperliquid", "version": "1" },
            "deadline": now_secs + 600
        }
    })
}

fn hl_order_tx() -> Value {
    json!({
        "chain_id": "hl-mainnet",
        "from": MASTER,
        "to": "0x0000000000000000000000000000000000000000"
    })
}

fn daily_loss_bundle() -> Value {
    json!({
        "policy": r#"@id("order-daily-loss-limit-warn")
@severity("warn")
@reason("Hyperliquid daily loss limit reached")
forbid(principal, action == Perp::Action::"PlaceOrder", resource)
when {
    context.venue.name == "hyperliquid" &&
    context.reduceOnly == false &&
    context has custom &&
    context.custom has dayDrawdownBps &&
    context.custom.dayDrawdownBps >= 500
};
"#,
        "manifest": {
            "id": "order-daily-loss-limit-warn",
            "schema_version": 2,
            "trigger": { "where": { "action.tag": { "eq": "place_order" } } },
            "policy_rpc": [{
                "id": "equity-drawdown",
                "method": "perp.equity_drawdown_bps",
                "params": { "chain_id": "$.root.chain_id" },
                "outputs": [{
                    "kind": "context",
                    "field": "dayDrawdownBps",
                    "type": "Long",
                    "from": "$.result.dayDrawdownBps"
                }],
                "optional": true
            }],
            "custom_context": { "fields": { "dayDrawdownBps": "Long" } }
        }
    })
}

fn loss_streak_bundle() -> Value {
    json!({
        "policy": r#"@id("order-loss-streak-cooldown-warn")
@severity("warn")
@reason("Hyperliquid loss streak cooldown reached")
forbid(principal, action == Perp::Action::"PlaceOrder", resource)
when {
    context.venue.name == "hyperliquid" &&
    context.reduceOnly == false &&
    context has custom &&
    context.custom has lossStreak &&
    context.custom.lossStreak >= 3
};
"#,
        "manifest": {
            "id": "order-loss-streak-cooldown-warn",
            "schema_version": 2,
            "trigger": { "where": { "action.tag": { "eq": "place_order" } } },
            "policy_rpc": [{
                "id": "session-fill-stats",
                "method": "perp.session_fill_stats",
                "params": { "chain_id": "$.root.chain_id", "min_loss_usd": "1" },
                "outputs": [{
                    "kind": "context",
                    "field": "lossStreak",
                    "type": "Long",
                    "from": "$.result.lossStreak"
                }],
                "optional": true
            }],
            "custom_context": { "fields": { "lossStreak": "Long" } }
        }
    })
}

fn unmatched_deny_bundle() -> Value {
    json!({
        "policy": r#"@id("unmatched-perp-deny")
@severity("deny")
@reason("This policy must be skipped by trigger matching")
forbid(principal, action == Perp::Action::"PlaceOrder", resource)
when { true };
"#,
        "manifest": {
            "id": "unmatched-perp-deny",
            "schema_version": 2,
            "trigger": { "where": { "action.tag": { "eq": "change_leverage" } } },
            "policy_rpc": [],
            "custom_context": { "fields": {} }
        }
    })
}

fn bundle_manifests(bundles: &[Value]) -> Vec<Value> {
    bundles
        .iter()
        .map(|bundle| bundle["manifest"].clone())
        .collect()
}

fn plan_calls(action: &Value, meta: &Value, tx: &Value, manifests: Vec<Value>) -> Vec<Value> {
    let out: Value = serde_json::from_str(&plan_action_rpc_v2_json(
        json!({
            "action": action,
            "meta": meta,
            "tx": tx,
            "manifests": manifests
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(out["ok"], true, "plan failed: {out}");
    out["data"]["planned"].as_array().unwrap().clone()
}

fn evaluate_with_results(
    action: &Value,
    meta: &Value,
    tx: &Value,
    bundles: &[Value],
    results: &Value,
) -> Value {
    let out: Value = serde_json::from_str(&evaluate_action_v2_json(
        json!({
            "action": action,
            "meta": meta,
            "tx": tx,
            "bundles": bundles,
            "results": results
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(out["ok"], true, "evaluate failed: {out}");
    out
}

fn evaluate_with_full_inputs(
    action: Value,
    meta: &Value,
    tx: &Value,
    bundle: Value,
    results: Value,
    account_leverage: Value,
    order_enrichment: Value,
) -> Value {
    let out: Value = serde_json::from_str(&evaluate_action_v2_json(
        json!({
            "action": action,
            "meta": meta,
            "tx": tx,
            "bundles": [bundle],
            "results": results,
            "account_leverage": account_leverage,
            "order_enrichment": order_enrichment
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(out["ok"], true, "evaluate failed: {out}");
    out
}

fn matched_policy_ids(verdict: &Value) -> Vec<String> {
    verdict["data"]["verdict"]["matched"]
        .as_array()
        .unwrap_or_else(|| panic!("missing matched policies: {verdict}"))
        .iter()
        .map(|entry| entry["policy_id"].as_str().unwrap().to_owned())
        .collect()
}

fn assert_policy_verdict(out: &Value, expected_kind: &str, policy_id: &str) {
    assert_eq!(
        out["data"]["verdict"]["kind"], expected_kind,
        "unexpected verdict for {policy_id}: {out}"
    );
    let matched = matched_policy_ids(out);
    assert!(
        matched.contains(&policy_id.to_owned()),
        "expected {policy_id} to match, got: {out}"
    );
}

fn evaluate_req_with_call_specs(address: &str, now_secs: i64, call_specs: Vec<Value>) -> Value {
    let mut req = evaluate_req(address, now_secs);
    req["call_specs"] = Value::Array(call_specs);
    req
}

async fn post_evaluate(
    addr: std::net::SocketAddr,
    token: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    reqwest::Client::new()
        .post(format!("http://{addr}/evaluate"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn perp_methods_served_over_http_from_postgres() {
    let (addr, mu, _tmp, token, user_id) = spawn_server().await;
    // Fixed UTC instant: day 20700, mid-day. Drives both the seed and the request.
    let now_secs: i64 = 20_700 * 86_400 + 50_000;
    seed_tripping(&mu, &user_id, now_secs).await;

    let resp = post_evaluate(addr, &token, evaluate_req(MASTER, now_secs)).await;
    let results = &resp["policyRequest"]["results"];
    eprintln!("LIVE /evaluate results = {results}");

    let dd = &results["dd::s"];
    assert_eq!(dd["dayDrawdownBps"], 500, "10000→9500 = 5% = 500bps");
    assert_eq!(
        dd["peakDrawdownBps"], 800,
        "HWM 10326.09→9500 = 8% = 800bps"
    );
    assert_eq!(dd["baselineTrusted"], true, "anchor labelled trusted");

    let fs = &results["fs::s"];
    assert_eq!(fs["lossStreak"], 3, "3 most-recent closes negative");
    assert_eq!(fs["lossesToday"], 3, "3 losing trades today (all >= $1)");
    assert_eq!(
        fs["tradesToday"], 16,
        "all 16 fills inside today's UTC window"
    );
    assert_eq!(fs["realizedPnlTodayUsd"], 50, "Σ -60 + 50 + 60 = 50");

    // The $1 band flows as a real manifest literal param: at min_loss_usd = 25
    // only the -$30 close is "meaningful", so the streak and loss-count collapse
    // to 1 — proving param → method over the genuine HTTP + Postgres path.
    let banded = post_evaluate(addr, &token, evaluate_req_min_loss(MASTER, now_secs, "25")).await;
    let bfs = &banded["policyRequest"]["results"]["fs::s"];
    assert_eq!(bfs["lossStreak"], 1, "at $25 band only -30 is meaningful");
    assert_eq!(bfs["lossesToday"], 1, "at $25 band only -30 counts");
    assert_eq!(bfs["tradesToday"], 16, "band does not affect frequency");
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn perp_methods_absent_without_anchors_or_fills() {
    let (addr, mu, _tmp, token, user_id) = spawn_server().await;
    let now_secs: i64 = 20_700 * 86_400 + 50_000;
    seed_control(&mu, &user_id, now_secs).await;

    let resp = post_evaluate(addr, &token, evaluate_req(CONTROL, now_secs)).await;
    let results = &resp["policyRequest"]["results"];
    eprintln!(
        "CONTROL /evaluate results = {results}, diagnostics = {}",
        resp["diagnostics"]
    );

    // No baseline / empty window → methods return None → call_ids absent from the
    // results map (fail-open: the Cedar `context has <field>` guard stays dormant).
    assert!(
        results.get("dd::s").is_none(),
        "no baseline → drawdown absent"
    );
    assert!(results.get("fs::s").is_none(), "empty fills → stats absent");

    // …and each skip is surfaced as a top-level diagnostic naming the method.
    let diags = resp["diagnostics"].as_array().cloned().unwrap_or_default();
    let joined = diags
        .iter()
        .map(std::string::ToString::to_string)
        .collect::<String>();
    assert!(
        joined.contains("perp.equity_drawdown_bps"),
        "diag names drawdown: {joined}"
    );
    assert!(
        joined.contains("perp.session_fill_stats"),
        "diag names fills: {joined}"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn perp_drawdown_is_flow_neutral_over_http() {
    let (addr, mu, _tmp, token, user_id) = spawn_server().await;
    let now_secs: i64 = 20_700 * 86_400 + 50_000;
    seed_flow_neutral(&mu, &user_id, now_secs).await;

    let resp = post_evaluate(addr, &token, evaluate_req(MASTER, now_secs)).await;
    let dd = &resp["policyRequest"]["results"]["dd::s"];
    eprintln!("FLOW-NEUTRAL /evaluate dd = {dd}");
    // Raw equity 9500 vs a 10000 peak would read 500 bps — but the −500 is a
    // pure withdrawal, so the flow-neutral drawdown is 0 end-to-end (proves the
    // Postgres JSONB round-trip of cumulative_net_flow + the method's netting).
    assert_eq!(
        dd["dayDrawdownBps"], 0,
        "withdrawal must not read as a daily loss"
    );
    assert_eq!(
        dd["peakDrawdownBps"], 0,
        "withdrawal must not read as drawdown"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn perp_peak_drawdown_survives_zero_day_baseline_over_http() {
    let (addr, mu, _tmp, token, user_id) = spawn_server().await;
    let now_secs: i64 = 20_700 * 86_400 + 50_000;
    save_hl_account(
        &mu,
        &user_id,
        MASTER,
        acct_equity("0", "0", "189.448501", now_secs),
        now_secs,
    )
    .await;

    let resp = post_evaluate(addr, &token, evaluate_req(MASTER, now_secs)).await;
    let dd = &resp["policyRequest"]["results"]["dd::s"];
    eprintln!("ZERO-BASELINE /evaluate dd = {dd}");
    assert!(
        dd.get("dayDrawdownBps").is_none(),
        "zero day baseline must leave daily drawdown unset"
    );
    assert!(
        dd.get("baselineTrusted").is_none(),
        "baselineTrusted is only meaningful when day baseline is usable"
    );
    assert_eq!(
        dd["peakDrawdownBps"], 10_000,
        "positive HWM to zero equity is a 100% peak drawdown"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn perp_policy_match_to_method_call_to_verdict_over_http() {
    let (addr, mu, _tmp, token, user_id) = spawn_server().await;
    let now_secs: i64 = 20_700 * 86_400 + 50_000;
    seed_tripping(&mu, &user_id, now_secs).await;

    let action = hl_order_action();
    let meta = hl_order_meta(now_secs);
    let tx = hl_order_tx();
    let bundles = vec![
        daily_loss_bundle(),
        loss_streak_bundle(),
        unmatched_deny_bundle(),
    ];

    let planned = plan_calls(&action, &meta, &tx, bundle_manifests(&bundles));
    eprintln!("PLAN matched call_specs = {}", json!(planned));
    assert_eq!(
        planned.len(),
        2,
        "only the two place_order bundles plan calls"
    );
    assert_eq!(
        planned[0]["call_id"],
        "order-daily-loss-limit-warn::equity-drawdown"
    );
    assert_eq!(planned[0]["method"], "perp.equity_drawdown_bps");
    assert_eq!(planned[0]["params"]["chain_id"], "hl-mainnet");
    assert_eq!(
        planned[1]["call_id"],
        "order-loss-streak-cooldown-warn::session-fill-stats"
    );
    assert_eq!(planned[1]["method"], "perp.session_fill_stats");
    assert_eq!(planned[1]["params"]["chain_id"], "hl-mainnet");
    assert_eq!(planned[1]["params"]["min_loss_usd"], "1");

    let resp = post_evaluate(
        addr,
        &token,
        evaluate_req_with_call_specs(MASTER, now_secs, planned),
    )
    .await;
    let results = &resp["policyRequest"]["results"];
    eprintln!("SERVER method results = {results}");
    assert_eq!(
        results["order-daily-loss-limit-warn::equity-drawdown"]["dayDrawdownBps"],
        500
    );
    assert_eq!(
        results["order-loss-streak-cooldown-warn::session-fill-stats"]["lossStreak"],
        3
    );

    let verdict = evaluate_with_results(&action, &meta, &tx, &bundles, results);
    eprintln!("FINAL verdict = {verdict}");
    assert_eq!(verdict["data"]["verdict"]["kind"], "warn");
    let matched = matched_policy_ids(&verdict);
    assert!(
        matched.contains(&"order-daily-loss-limit-warn".to_owned()),
        "daily loss policy did not match: {verdict}"
    );
    assert!(
        matched.contains(&"order-loss-streak-cooldown-warn".to_owned()),
        "loss streak policy did not match: {verdict}"
    );
    assert!(
        !matched.contains(&"unmatched-perp-deny".to_owned()),
        "trigger-mismatched deny policy must not be evaluated: {verdict}"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL and /tmp/scopeball-gitbook-perp/perp-policies.json"]
async fn gitbook_perp_22_policies_threshold_hit_with_server_stateful_methods() {
    let policies = gitbook_perp_policies();
    assert_eq!(policies.len(), 22, "GitBook/Policy Hub Perp export size");

    let (addr, mu, _tmp, token, user_id) = spawn_server().await;
    let now_secs: i64 = 20_700 * 86_400 + 50_000;

    const DLIM_FIRE: &str = "0xe2e0000000000000000000000000000000000001";
    const MDD_FIRE: &str = "0xe2e0000000000000000000000000000000000003";
    const STREAK_FIRE: &str = "0xe2e0000000000000000000000000000000000005";
    const OVER_FIRE: &str = "0xe2e0000000000000000000000000000000000007";
    const COUNT_FIRE: &str = "0xe2e0000000000000000000000000000000000009";
    const REAL_FIRE: &str = "0xe2e000000000000000000000000000000000000b";

    save_hl_account(
        &mu,
        &user_id,
        DLIM_FIRE,
        acct_equity("9500", "10000", "10000", now_secs),
        now_secs,
    )
    .await;
    save_hl_account(
        &mu,
        &user_id,
        MDD_FIRE,
        acct_equity("9200", "0", "10000", now_secs),
        now_secs,
    )
    .await;
    save_hl_account(
        &mu,
        &user_id,
        STREAK_FIRE,
        acct_fills(&["-10", "-20", "-30"], now_secs),
        now_secs,
    )
    .await;
    save_hl_account(
        &mu,
        &user_id,
        OVER_FIRE,
        acct_fills(&["5"; 16], now_secs),
        now_secs,
    )
    .await;
    save_hl_account(
        &mu,
        &user_id,
        COUNT_FIRE,
        acct_fills(
            &["-10", "5", "-10", "5", "-10", "5", "-10", "5", "-10"],
            now_secs,
        ),
        now_secs,
    )
    .await;
    save_hl_account(
        &mu,
        &user_id,
        REAL_FIRE,
        acct_fills(&["-500"], now_secs),
        now_secs,
    )
    .await;

    struct StatefulExpected {
        wallet: &'static str,
        call_suffix: &'static str,
        field: &'static str,
        expected: Value,
    }

    struct Case {
        id: &'static str,
        expected_verdict: &'static str,
        action: Value,
        account_leverage: Value,
        order_enrichment: Value,
        stateful: Option<StatefulExpected>,
    }

    let btc_price = "65000";
    let atom_price = "5";
    let doge_price = "0.15";
    let btc_max_lev = 40;
    let atom_max_lev = 10;
    let doge_max_lev = 10;

    let cases = vec![
        Case {
            id: "update-leverage-cap-warn",
            expected_verdict: "warn",
            action: change_leverage("BTC", 11),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: None,
        },
        Case {
            id: "order-leverage-high-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({ "BTC": 11 }),
            order_enrichment: json!({}),
            stateful: None,
        },
        Case {
            id: "order-leverage-at-market-max-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({ "BTC": btc_max_lev }),
            order_enrichment: market_enrichment("BTC", json!({ "max_leverage": btc_max_lev })),
            stateful: None,
        },
        Case {
            id: "order-alt-leverage-warn",
            expected_verdict: "warn",
            action: place_order("ATOM", "long", false, "10", atom_price),
            account_leverage: json!({ "ATOM": 6 }),
            order_enrichment: json!({}),
            stateful: None,
        },
        Case {
            id: "order-cross-margin-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "leverage_type": "cross" })),
            stateful: None,
        },
        Case {
            id: "isolated-margin-remove-warn",
            expected_verdict: "warn",
            action: adjust_margin("BTC", "-1000"),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: None,
        },
        Case {
            id: "order-notional-usd-cap-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "1", btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "notional_usd": 10001 })),
            stateful: None,
        },
        Case {
            id: "order-symbol-not-allowlisted-warn",
            expected_verdict: "warn",
            action: place_order("ATOM", "long", false, "10", atom_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: None,
        },
        Case {
            id: "order-illiquid-market-warn",
            expected_verdict: "warn",
            action: place_order("ATOM", "long", false, "10", atom_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("ATOM", json!({ "max_leverage": atom_max_lev })),
            stateful: None,
        },
        Case {
            id: "order-no-new-short-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "short", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: None,
        },
        Case {
            id: "order-position-stacking-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "has_open_position": true })),
            stateful: None,
        },
        Case {
            id: "order-adding-to-loser-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment(
                "BTC",
                json!({ "has_open_position": true, "position_roe_bps": -2001 }),
            ),
            stateful: None,
        },
        Case {
            id: "order-margin-health-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: market_account_enrichment(
                "BTC",
                json!({ "max_leverage": btc_max_lev }),
                json!({ "margin_used_ratio_bps": 5001 }),
            ),
            stateful: None,
        },
        Case {
            id: "order-liquidation-proximity-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "liquidation_distance_bps": 999 })),
            stateful: None,
        },
        Case {
            id: "order-max-drawdown-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: Some(StatefulExpected {
                wallet: MDD_FIRE,
                call_suffix: "equity-drawdown",
                field: "peakDrawdownBps",
                expected: json!(800),
            }),
        },
        Case {
            id: "order-loss-streak-cooldown-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: Some(StatefulExpected {
                wallet: STREAK_FIRE,
                call_suffix: "session-fill-stats",
                field: "lossStreak",
                expected: json!(3),
            }),
        },
        Case {
            id: "order-overtrading-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: Some(StatefulExpected {
                wallet: OVER_FIRE,
                call_suffix: "session-fill-stats",
                field: "tradesToday",
                expected: json!(16),
            }),
        },
        Case {
            id: "order-daily-loss-count-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: Some(StatefulExpected {
                wallet: COUNT_FIRE,
                call_suffix: "session-fill-stats",
                field: "lossesToday",
                expected: json!(5),
            }),
        },
        Case {
            id: "order-daily-loss-limit-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: Some(StatefulExpected {
                wallet: DLIM_FIRE,
                call_suffix: "equity-drawdown",
                field: "dayDrawdownBps",
                expected: json!(500),
            }),
        },
        Case {
            id: "order-daily-realized-loss-warn",
            expected_verdict: "warn",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: Some(StatefulExpected {
                wallet: REAL_FIRE,
                call_suffix: "session-fill-stats",
                field: "realizedPnlTodayUsd",
                expected: json!(-500),
            }),
        },
        Case {
            id: "order-symbol-denylisted-deny",
            expected_verdict: "fail",
            action: place_order("DOGE", "long", false, "100", doge_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("DOGE", json!({ "max_leverage": doge_max_lev })),
            stateful: None,
        },
        Case {
            id: "order-reduce-only-lockdown-deny",
            expected_verdict: "fail",
            action: place_order("BTC", "long", false, "0.10", btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            stateful: None,
        },
    ];
    assert_eq!(cases.len(), 22, "test table covers every Perp policy");

    let meta = hl_order_meta(now_secs);
    let tx = hl_order_tx();
    for case in cases {
        let policy = gitbook_policy(&policies, case.id);
        let bundle = gitbook_bundle(policy);
        let planned = plan_calls(&case.action, &meta, &tx, vec![policy.manifest.clone()]);

        let results = if let Some(expected) = case.stateful {
            assert_eq!(
                planned.len(),
                1,
                "{} should plan exactly one stateful call: {}",
                case.id,
                json!(planned)
            );
            let response = post_evaluate(
                addr,
                &token,
                evaluate_req_with_call_specs(expected.wallet, now_secs, planned),
            )
            .await;
            let results = response["policyRequest"]["results"].clone();
            let call_id = format!("{}::{}", case.id, expected.call_suffix);
            assert_eq!(
                results[&call_id][expected.field], expected.expected,
                "{} server method result mismatch: {}",
                case.id, results
            );
            results
        } else {
            assert!(
                planned.is_empty(),
                "{} should not require policy-server stateful calls: {}",
                case.id,
                json!(planned)
            );
            json!({})
        };

        let verdict = evaluate_with_full_inputs(
            case.action,
            &meta,
            &tx,
            bundle,
            results,
            case.account_leverage,
            case.order_enrichment,
        );
        assert_policy_verdict(&verdict, case.expected_verdict, case.id);
        eprintln!("{} => {}", case.id, case.expected_verdict);
    }
}
