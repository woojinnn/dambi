//! E2E: a Hyperliquid `/exchange` order is BLOCKED through the **literal
//! extension entry point** — `evaluate_action_v2_json`.
//!
//! Unlike `policy-engine/tests/hl_exchange_deny_poc.rs` (which calls the engine
//! pieces directly), this test feeds the EXACT JSON envelope the browser
//! extension's service worker sends — `{ action, meta, tx, bundles, results }` —
//! into `evaluate_action_v2_json(input_json) -> String` and parses the returned
//! `{ ok, data: { verdict } }` envelope. That function is the same symbol the
//! WASM bridge calls (`wasm-bridge.ts: exports.evaluate_action_v2_json(...)`),
//! so this is the highest-fidelity reproducible proof that "an extension deny
//! policy actually denies a Hyperliquid order" without needing a browser.
//!
//! Run: `cargo test -p policy-engine-wasm --test hl_exchange_deny_e2e`
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]

use serde_json::{json, Value};

use policy_engine_wasm::evaluate_action_v2_json;

use simulation_reducer::action::perp::{
    PerpAccountState, PerpAction, PerpVenue, PlaceLimitLiveInputs, PlaceLimitOrderAction, SizeSpec,
    TimeInForce,
};
use simulation_reducer::action::{ActionBody, ActionMeta, ActionNature, Eip712Domain};
use simulation_state::live_field::{DataSource, LiveField};
use simulation_state::position::PerpSide;
use simulation_state::primitives::{Address, ChainId, MarketRef, Price, Time, VenueRef, U256};

use std::str::FromStr;

// ── HL /exchange order JSON → v2 ActionBody (same converter logic as the TS
//    `hl-order-to-action.ts` and the policy-engine PoC). ──────────────────────
fn hl_order_to_action_body(order: &Value, symbol: &str) -> ActionBody {
    let is_buy = order["b"].as_bool().expect("order.b (isBuy) bool");
    let side = if is_buy { PerpSide::Long } else { PerpSide::Short };

    let price = Price::new(order["p"].as_str().expect("order.p (price) string"));
    let size_str = order["s"].as_str().expect("order.s (size) string");
    let reduce_only = order["r"].as_bool().unwrap_or(false);

    let size_units: u128 = size_str
        .split('.')
        .next()
        .and_then(|whole| whole.parse::<u128>().ok())
        .unwrap_or(0);
    let size = SizeSpec::BaseAmount {
        amount: U256::from(size_units),
    };

    let tif = order["t"]["limit"]["tif"].as_str().unwrap_or("Gtc");
    let time_in_force = match tif {
        "Ioc" => TimeInForce::Ioc,
        "Alo" => TimeInForce::PostOnly,
        _ => TimeInForce::Gtc,
    };

    let venue = PerpVenue::Hyperliquid {
        chain: ChainId::new("hl-mainnet"),
    };
    let market = MarketRef {
        symbol: symbol.to_owned(),
        venue: VenueRef::new("hyperliquid"),
    };

    let src = DataSource::UserSupplied;
    let now = Time::from_unix(0);
    let live_inputs = PlaceLimitLiveInputs {
        mark_price: LiveField::new(price.clone(), src.clone(), now),
        best_bid_ask: LiveField::new((Price::new("0"), Price::new("0")), src.clone(), now),
        open_orders_count: LiveField::new(0u32, src.clone(), now),
        user_account_state: LiveField::new(
            PerpAccountState {
                total_collateral_usd: U256::ZERO,
                used_margin_usd: U256::ZERO,
                free_margin_usd: U256::ZERO,
                open_positions: vec![],
            },
            src,
            now,
        ),
    };

    ActionBody::Perp(PerpAction::PlaceLimitOrder(PlaceLimitOrderAction {
        venue,
        market,
        side,
        size,
        price,
        time_in_force,
        reduce_only,
        live_inputs,
    }))
}

fn hl_meta() -> ActionMeta {
    ActionMeta {
        submitted_at: Time::from_unix(1_738_000_000),
        submitter: Address::from_str("0x000000000000000000000000000000000000a01c").unwrap(),
        nature: ActionNature::OffchainSig {
            domain: Eip712Domain {
                name: "Hyperliquid".to_owned(),
                version: Some("1".to_owned()),
                chain_id: None,
                verifying_contract: None,
                salt: None,
            },
            deadline: Time::from_unix(1_738_000_600),
            nonce_key: None,
        },
    }
}

// A perp `place_limit_order` manifest with no policy-RPC calls (the deny reads
// only base context fields, so no host enrichment is needed).
fn perp_manifest() -> Value {
    json!({
        "id": "hl-perp-guard",
        "schema_version": 2,
        "trigger": { "where": { "action.tag": { "eq": "place_limit_order" } } },
        "policy_rpc": [],
        "custom_context": { "fields": {} }
    })
}

const DENY_SHORT_ON_HL: &str = "\
@id(\"hl/no-short\")\n\
@severity(\"deny\")\n\
@reason(\"Short perp orders on Hyperliquid are blocked by policy\")\n\
forbid(principal, action == Perp::Action::\"PlaceLimitOrder\", resource)\n\
when { context.venue.name == \"hyperliquid\" && context.side == \"short\" };\n";

// Assemble the EXACT `EvaluateActionInput` envelope the extension sends and run
// it through `evaluate_action_v2_json`. Returns the parsed output envelope.
fn run_entry_point(body: &ActionBody, policy: &str) -> Value {
    let input = json!({
        "action": serde_json::to_value(body).unwrap(),
        "meta": serde_json::to_value(hl_meta()).unwrap(),
        "tx": {
            // HL is off-chain; the SW supplies a sentinel `to`. chain_id is the
            // CAIP-2 string the v2 path expects.
            "chain_id": "hl-mainnet",
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x0000000000000000000000000000000000000000"
        },
        "bundles": [{ "policy": policy, "manifest": perp_manifest() }],
        "results": {}
    });

    let out = evaluate_action_v2_json(input.to_string());
    serde_json::from_str(&out).expect("entry point returns JSON")
}

/// THE PROOF (extension entry point): a Hyperliquid SHORT order returns a
/// `fail` verdict from `evaluate_action_v2_json`. In the extension this `fail`
/// drives `decideMessage` → `ok:false` → the fetch hook rejects the `/exchange`
/// POST, so the order never reaches Hyperliquid, and `openVerdictWindow` shows
/// the deny popup.
#[test]
fn hyperliquid_short_order_denied_through_entry_point() {
    let order = json!({ "a": 0, "b": false, "p": "60000", "s": "0.1", "r": false,
                        "t": { "limit": { "tif": "Gtc" } } });
    let body = hl_order_to_action_body(&order, "BTC-USD");

    let parsed = run_entry_point(&body, DENY_SHORT_ON_HL);

    assert_eq!(parsed["ok"], true, "envelope ok: {parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "fail",
        "short order must be DENIED: {parsed}"
    );
    assert_eq!(
        parsed["data"]["verdict"]["matched"][0]["policy_id"], "hl/no-short",
        "the deny rule must be the matched policy: {parsed}"
    );
    assert_eq!(
        parsed["data"]["verdict"]["matched"][0]["severity"], "deny",
        "severity must be deny: {parsed}"
    );
}

/// CONTROL — selectivity: a LONG order passes the short-only deny (proves the
/// verdict is conditional on the order, not a blanket fail).
#[test]
fn hyperliquid_long_order_passes_through_entry_point() {
    let order = json!({ "a": 0, "b": true, "p": "60000", "s": "0.1", "r": false,
                        "t": { "limit": { "tif": "Gtc" } } });
    let body = hl_order_to_action_body(&order, "BTC-USD");

    let parsed = run_entry_point(&body, DENY_SHORT_ON_HL);

    assert_eq!(parsed["ok"], true, "{parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "pass",
        "a long order must PASS the short-only deny: {parsed}"
    );
}

/// CONTROL — no deny bundle ⇒ baseline pass (blocking requires an explicit
/// policy; the engine does not deny by default).
#[test]
fn no_bundle_passes_baseline_through_entry_point() {
    let order = json!({ "a": 0, "b": false, "p": "60000", "s": "0.1", "r": false,
                        "t": { "limit": { "tif": "Gtc" } } });
    let body = hl_order_to_action_body(&order, "BTC-USD");

    let input = json!({
        "action": serde_json::to_value(&body).unwrap(),
        "meta": serde_json::to_value(hl_meta()).unwrap(),
        "tx": {
            "chain_id": "hl-mainnet",
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x0000000000000000000000000000000000000000"
        },
        "bundles": [],
        "results": {}
    });
    let parsed: Value =
        serde_json::from_str(&evaluate_action_v2_json(input.to_string())).unwrap();

    assert_eq!(parsed["ok"], true, "{parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "pass",
        "no bundle ⇒ baseline pass: {parsed}"
    );
}


/// CONTRACT: the EXACT JSON the TS converter (`hl-order-to-action.ts`) emits —
/// hand-written here with the TS field shapes (decimal U256 amounts, no `c`) —
/// must deserialize into `ActionBody` and DENY through `evaluate_action_v2_json`
/// with `hl/no-short` (NOT a `__system__`/`__engine` parse-failure deny). This
/// pins the cross-language wire contract: if alloy U256 stops accepting the TS
/// number form, this fails loudly instead of silently fail-closing.
#[test]
fn ts_converter_json_shape_denies_through_entry_point() {
    // Mirrors `hlOrderToAction(shortBtc())` output byte-for-byte (see
    // browser-extension `__tests__/hl-order-to-action.test.ts` CANONICAL_ACTION).
    let action = json!({
        "domain": "perp",
        "action": "place_limit_order",
        "venue": { "name": "hyperliquid", "chain": "hl-mainnet" },
        "market": { "symbol": "BTC-USD", "venue": { "name": "hyperliquid" } },
        "side": "short",
        "size": { "kind": "base_amount", "amount": "0" },
        "price": "60000",
        "time_in_force": { "kind": "gtc" },
        "reduce_only": false,
        "live_inputs": {
            "mark_price": { "value": "60000", "source": { "kind": "user_supplied" }, "synced_at": 0 },
            "best_bid_ask": { "value": ["0", "0"], "source": { "kind": "user_supplied" }, "synced_at": 0 },
            "open_orders_count": { "value": 0, "source": { "kind": "user_supplied" }, "synced_at": 0 },
            "user_account_state": {
                "value": {
                    "total_collateral_usd": "0",
                    "used_margin_usd": "0",
                    "free_margin_usd": "0",
                    "open_positions": []
                },
                "source": { "kind": "user_supplied" },
                "synced_at": 0
            }
        }
    });
    let meta = json!({
        "submitted_at": 1_738_000_000u64,
        "submitter": "0x000000000000000000000000000000000000a01c",
        "nature": {
            "kind": "offchain_sig",
            "domain": { "name": "Hyperliquid", "version": "1" },
            "deadline": 1_738_000_600u64
        }
    });
    let input = json!({
        "action": action,
        "meta": meta,
        "tx": {
            "chain_id": "hl-mainnet",
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x0000000000000000000000000000000000000000"
        },
        "bundles": [{ "policy": DENY_SHORT_ON_HL, "manifest": perp_manifest() }],
        "results": {}
    });

    let parsed: Value =
        serde_json::from_str(&evaluate_action_v2_json(input.to_string())).unwrap();

    assert_eq!(parsed["ok"], true, "{parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "fail",
        "TS-shaped JSON must DENY: {parsed}"
    );
    assert_eq!(
        parsed["data"]["verdict"]["matched"][0]["policy_id"], "hl/no-short",
        "must deny via the policy, NOT a parse-failure __system__/__engine: {parsed}"
    );
}

/// SHIPPED-SEED PROOF: the actual default policy bundle that ships in the
/// extension (`crates/policy-engine/tests/fixtures/default_policies_v2/
/// hl-no-short-perp/{policy.cedar,manifest.json}`, copied verbatim into
/// `public/default-policies/policy-set-v2.json` by `copy-default-policies.js`)
/// DENIES a Hyperliquid short order through `evaluate_action_v2_json`. This is
/// the end-to-end artifact the SW's `getDefaultPolicyBundlesV2()` feeds inline,
/// so it proves the *shipped* deny — not just a test-local policy string.
#[test]
fn shipped_seed_policy_denies_hyperliquid_short() {
    let seed_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("policy-engine")
        .join("tests")
        .join("fixtures")
        .join("default_policies_v2")
        .join("hl-no-short-perp");
    let policy = std::fs::read_to_string(seed_dir.join("policy.cedar"))
        .expect("read shipped seed policy.cedar");
    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(seed_dir.join("manifest.json"))
            .expect("read shipped seed manifest.json"),
    )
    .expect("seed manifest.json parses");

    let body = hl_order_to_action_body(
        &json!({ "a": 0, "b": false, "p": "60000", "s": "0.1", "r": false,
                 "t": { "limit": { "tif": "Gtc" } } }),
        "BTC-USD",
    );
    let input = json!({
        "action": serde_json::to_value(&body).unwrap(),
        "meta": serde_json::to_value(hl_meta()).unwrap(),
        "tx": {
            "chain_id": "hl-mainnet",
            "from": "0x1111111111111111111111111111111111111111",
            "to": "0x0000000000000000000000000000000000000000"
        },
        "bundles": [{ "policy": policy, "manifest": manifest }],
        "results": {}
    });

    let parsed: Value =
        serde_json::from_str(&evaluate_action_v2_json(input.to_string())).unwrap();

    assert_eq!(parsed["ok"], true, "{parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "fail",
        "the SHIPPED seed policy must DENY a HL short: {parsed}"
    );
    assert_eq!(
        parsed["data"]["verdict"]["matched"][0]["policy_id"], "hl-no-short-perp",
        "matched policy must be the shipped seed id: {parsed}"
    );
}
