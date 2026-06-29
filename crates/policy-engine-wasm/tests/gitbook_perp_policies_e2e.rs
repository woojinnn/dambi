//! Live-doc verification harness for Wallet Guardians GitBook PERP policies.
//!
//! This test intentionally reads the GitBook-exported policy bundle JSON and
//! Hyperliquid official endpoint snapshots from `/tmp`, because the source of
//! truth under verification is the published GitBook page, not checked-in test
//! fixtures. Generate these files before running:
//! - `/tmp/dambi-gitbook-perp/perp-policies.json`
//! - `/tmp/dambi-hl-meta.json`
//! - `/tmp/dambi-hl-allmids.json`
//!
//! The verdict path is the literal extension/WASM boundary:
//! `evaluate_action_v2_json({ action, meta, tx, bundles, results, ... })`.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::too_many_lines,
    clippy::unwrap_used
)]

use std::collections::BTreeMap;
use std::fs;

use policy_engine_wasm::evaluate_action_v2_json;
use serde::Deserialize;
use serde_json::{json, Value};

const POLICIES_PATH: &str = "/tmp/dambi-gitbook-perp/perp-policies.json";
const HL_META_PATH: &str = "/tmp/dambi-hl-meta.json";
const HL_MIDS_PATH: &str = "/tmp/dambi-hl-allmids.json";

#[derive(Debug, Deserialize)]
struct GitbookPolicy {
    ids: Vec<String>,
    policy: String,
    manifest: Value,
}

fn policies() -> Vec<GitbookPolicy> {
    serde_json::from_str(&fs::read_to_string(POLICIES_PATH).expect("read GitBook policy export"))
        .expect("GitBook policy export parses")
}

fn bundle(policy: &GitbookPolicy) -> Value {
    json!({ "policy": policy.policy, "manifest": policy.manifest })
}

fn by_id<'a>(policies: &'a [GitbookPolicy], id: &str) -> &'a GitbookPolicy {
    policies
        .iter()
        .find(|policy| policy.ids.iter().any(|candidate| candidate == id))
        .unwrap_or_else(|| panic!("missing GitBook policy id {id}"))
}

fn hl_meta() -> Value {
    serde_json::from_str(&fs::read_to_string(HL_META_PATH).expect("read HL meta snapshot"))
        .expect("HL meta snapshot parses")
}

fn hl_mids() -> BTreeMap<String, String> {
    serde_json::from_str(&fs::read_to_string(HL_MIDS_PATH).expect("read HL allMids snapshot"))
        .expect("HL allMids snapshot parses")
}

fn asset(meta: &Value, symbol: &str) -> (usize, i64) {
    let universe = meta["universe"]
        .as_array()
        .expect("HL meta.universe is an array");
    let (index, row) = universe
        .iter()
        .enumerate()
        .find(|(_, row)| row["name"].as_str() == Some(symbol))
        .unwrap_or_else(|| panic!("HL meta snapshot missing {symbol}"));
    let max_leverage = row["maxLeverage"]
        .as_i64()
        .unwrap_or_else(|| panic!("HL meta {symbol}.maxLeverage missing"));
    (index, max_leverage)
}

fn price(mids: &BTreeMap<String, String>, symbol: &str) -> String {
    mids.get(symbol)
        .unwrap_or_else(|| panic!("HL allMids snapshot missing {symbol}"))
        .clone()
}

fn meta() -> Value {
    json!({
        "submitted_at": 1_738_000_000u64,
        "submitter": "0x1111111111111111111111111111111111111111",
        "nature": {
            "kind": "offchain_sig",
            "domain": { "name": "Hyperliquid", "version": "1" },
            "deadline": 1_738_000_600u64
        }
    })
}

fn tx() -> Value {
    json!({
        "chain_id": "hl-mainnet",
        "from": "0x1111111111111111111111111111111111111111",
        "to": "0x0000000000000000000000000000000000000000"
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

fn rpc_result(policy_id: &str, call_id: &str, result: Value) -> Value {
    json!({ format!("{policy_id}::{call_id}"): result })
}

fn run(
    action: Value,
    policy: &GitbookPolicy,
    account_leverage: Value,
    order_enrichment: Value,
    results: Value,
) -> Value {
    let input = json!({
        "action": action,
        "meta": meta(),
        "tx": tx(),
        "bundles": [bundle(policy)],
        "results": results,
        "account_leverage": account_leverage,
        "order_enrichment": order_enrichment
    });
    serde_json::from_str(&evaluate_action_v2_json(input.to_string()))
        .expect("evaluate_action_v2_json returns JSON")
}

fn assert_verdict(out: &Value, expected_kind: &str, policy_id: &str) {
    assert_eq!(out["ok"], true, "engine envelope error: {out}");
    assert_eq!(
        out["data"]["verdict"]["kind"], expected_kind,
        "unexpected verdict for {policy_id}: {out}"
    );
    let matched = out["data"]["verdict"]["matched"]
        .as_array()
        .unwrap_or_else(|| panic!("verdict missing matched array for {policy_id}: {out}"));
    assert!(
        matched
            .iter()
            .any(|entry| entry["policy_id"].as_str() == Some(policy_id)),
        "expected {policy_id} to match, got: {out}"
    );
}

#[test]
#[ignore = "requires local /tmp GitBook policy export + HL meta/mids fixtures; run with `--ignored` after seeding them"]
fn gitbook_perp_single_policies_reach_expected_verdicts() {
    let policies = policies();
    assert_eq!(
        policies.len(),
        22,
        "GitBook PERP export should contain 22 pages"
    );

    let meta_snapshot = hl_meta();
    let mids = hl_mids();
    let (_, btc_max_lev) = asset(&meta_snapshot, "BTC");
    let (_, atom_max_lev) = asset(&meta_snapshot, "ATOM");
    let (_, doge_max_lev) = asset(&meta_snapshot, "DOGE");
    assert!(btc_max_lev > 10, "BTC should be a high-tier HL market");
    assert!(atom_max_lev <= 10, "ATOM should be a low-tier HL market");

    let btc_price = price(&mids, "BTC");
    let atom_price = price(&mids, "ATOM");
    let doge_price = price(&mids, "DOGE");

    struct Case {
        id: &'static str,
        expected: &'static str,
        action: Value,
        account_leverage: Value,
        order_enrichment: Value,
        results: Value,
    }

    let cases = vec![
        Case {
            id: "update-leverage-cap-warn",
            expected: "warn",
            action: change_leverage("BTC", 11),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: json!({}),
        },
        Case {
            id: "order-leverage-high-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({ "BTC": 11 }),
            order_enrichment: json!({}),
            results: json!({}),
        },
        Case {
            id: "order-leverage-at-market-max-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({ "BTC": btc_max_lev }),
            order_enrichment: market_enrichment("BTC", json!({ "max_leverage": btc_max_lev })),
            results: json!({}),
        },
        Case {
            id: "order-alt-leverage-warn",
            expected: "warn",
            action: place_order("ATOM", "long", false, "10", &atom_price),
            account_leverage: json!({ "ATOM": 6 }),
            order_enrichment: json!({}),
            results: json!({}),
        },
        Case {
            id: "order-cross-margin-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "leverage_type": "cross" })),
            results: json!({}),
        },
        Case {
            id: "isolated-margin-remove-warn",
            expected: "warn",
            action: adjust_margin("BTC", "-1000"),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: json!({}),
        },
        Case {
            id: "order-notional-usd-cap-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "1", &btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "notional_usd": 10001 })),
            results: json!({}),
        },
        Case {
            id: "order-symbol-not-allowlisted-warn",
            expected: "warn",
            action: place_order("ATOM", "long", false, "10", &atom_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: json!({}),
        },
        Case {
            id: "order-illiquid-market-warn",
            expected: "warn",
            action: place_order("ATOM", "long", false, "10", &atom_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("ATOM", json!({ "max_leverage": atom_max_lev })),
            results: json!({}),
        },
        Case {
            id: "order-no-new-short-warn",
            expected: "warn",
            action: place_order("BTC", "short", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: json!({}),
        },
        Case {
            id: "order-position-stacking-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "has_open_position": true })),
            results: json!({}),
        },
        Case {
            id: "order-adding-to-loser-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment(
                "BTC",
                json!({ "has_open_position": true, "position_roe_bps": -2001 }),
            ),
            results: json!({}),
        },
        Case {
            id: "order-margin-health-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: market_account_enrichment(
                "BTC",
                json!({ "max_leverage": btc_max_lev }),
                json!({ "margin_used_ratio_bps": 5001 }),
            ),
            results: json!({}),
        },
        Case {
            id: "order-liquidation-proximity-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("BTC", json!({ "liquidation_distance_bps": 999 })),
            results: json!({}),
        },
        Case {
            id: "order-max-drawdown-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: rpc_result(
                "order-max-drawdown-warn",
                "equity-drawdown",
                json!({ "peakDrawdownBps": 800 }),
            ),
        },
        Case {
            id: "order-loss-streak-cooldown-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: rpc_result(
                "order-loss-streak-cooldown-warn",
                "session-fill-stats",
                json!({ "lossStreak": 3 }),
            ),
        },
        Case {
            id: "order-overtrading-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: rpc_result(
                "order-overtrading-warn",
                "session-fill-stats",
                json!({ "tradesToday": 16 }),
            ),
        },
        Case {
            id: "order-daily-loss-count-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: rpc_result(
                "order-daily-loss-count-warn",
                "session-fill-stats",
                json!({ "lossesToday": 5 }),
            ),
        },
        Case {
            id: "order-daily-loss-limit-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: rpc_result(
                "order-daily-loss-limit-warn",
                "equity-drawdown",
                json!({ "dayDrawdownBps": 500 }),
            ),
        },
        Case {
            id: "order-daily-realized-loss-warn",
            expected: "warn",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: rpc_result(
                "order-daily-realized-loss-warn",
                "session-fill-stats",
                json!({ "realizedPnlTodayUsd": -500 }),
            ),
        },
        Case {
            id: "order-symbol-denylisted-deny",
            expected: "fail",
            action: place_order("DOGE", "long", false, "100", &doge_price),
            account_leverage: json!({}),
            order_enrichment: market_enrichment("DOGE", json!({ "max_leverage": doge_max_lev })),
            results: json!({}),
        },
        Case {
            id: "order-reduce-only-lockdown-deny",
            expected: "fail",
            action: place_order("BTC", "long", false, "0.10", &btc_price),
            account_leverage: json!({}),
            order_enrichment: json!({}),
            results: json!({}),
        },
    ];

    assert_eq!(
        cases.len(),
        22,
        "test table should cover every GitBook PERP id"
    );

    for case in cases {
        let policy = by_id(&policies, case.id);
        let out = run(
            case.action,
            policy,
            case.account_leverage,
            case.order_enrichment,
            case.results,
        );
        assert_verdict(&out, case.expected, case.id);
    }
}
