//! PoC: a Hyperliquid `/exchange` order, once converted to the v2 `ActionBody`
//! model and lowered, is actually BLOCKED (`Verdict::Fail`) by a deny policy.
//!
//! This exercises the exact computation the extension's v2 path
//! (`evaluate_action_v2_json`) performs internally, minus the JSON/WASM
//! marshalling and (deliberately) minus policy-RPC enrichment — the deny
//! conditions read only base context fields lowered directly from the action
//! (`context.venue.name`, `context.side`, `context.market.symbol`), so no
//! external facts and no `results` map are required.
//!
//! Pipeline mirrored here (see `policy-engine-wasm/src/action_eval_exports.rs`):
//!   HL order JSON
//!     → `hl_order_to_action_body` (the converter under test)
//!     → `lower_action(body, meta, TxMeta{from, to})`  (principal/action/resource/context)
//!     → `compose_per_policy(manifest)`                 (per-policy Cedar schema)
//!     → `PolicyEngine::build_from_per_policy([(deny_policy, schema)])`
//!     → `engine.evaluate(principal, action_uid, resource, [], context)`
//!     → `Verdict::Fail`  ⟺  the dApp's fetch would be rejected.
#![allow(clippy::all, clippy::pedantic, clippy::nursery, missing_docs)]

use serde_json::{json, Value};

use policy_engine::policy::{PolicyEngine, Verdict};
use policy_engine::policy_rpc::ManifestV2;
use policy_engine::schema::compose_per_policy;
use policy_engine::lowering_v2::{lower_action, TxMeta};

use simulation_reducer::action::perp::{
    PerpAccountState, PerpAction, PerpVenue, PlaceLimitLiveInputs, PlaceLimitOrderAction, SizeSpec,
    TimeInForce,
};
use simulation_reducer::action::{ActionBody, ActionMeta, ActionNature, Eip712Domain};
use simulation_state::live_field::{DataSource, LiveField};
use simulation_state::position::PerpSide;
use simulation_state::primitives::{
    Address, ChainId, MarketRef, Price, Time, VenueRef, U256,
};

use std::str::FromStr;

// ── Hyperliquid /exchange order → v2 ActionBody converter (the unit under test) ──
//
// The real `/exchange` POST body is:
//   { "action": { "type":"order",
//                 "orders":[{ "a":<assetIndex u32>, "b":<isBuy bool>,
//                             "p":"<price>", "s":"<size>", "r":<reduceOnly bool>,
//                             "t":{"limit":{"tif":"Gtc"|"Ioc"|"Alo"}}, "c":"<cloid?>" }],
//                 "grouping":"na" },
//     "nonce":<ms>, "signature":{...}, "vaultAddress":<addr?> }
//
// `a` is a numeric asset index; the symbol is NOT in the body. A real deployment
// resolves `a → symbol` from a cached `{"type":"meta"}.universe[a].name` map
// (perp) / `spotMeta` (+10000 offset for spot). For the PoC the caller supplies
// the resolved `symbol`, isolating "does the policy block?" from "can we name
// the asset?" (the latter is a sync-cache concern, tracked separately).
fn hl_order_to_action_body(order: &Value, symbol: &str) -> ActionBody {
    let is_buy = order["b"].as_bool().expect("order.b (isBuy) bool");
    let side = if is_buy { PerpSide::Long } else { PerpSide::Short };

    let price = Price::new(order["p"].as_str().expect("order.p (price) string"));
    let size_str = order["s"].as_str().expect("order.s (size) string");
    let reduce_only = order["r"].as_bool().unwrap_or(false);

    // Hyperliquid sizes are human decimal strings ("0.1"); the ActionBody size is
    // a base-unit U256. For the PoC we carry the integer part; precise decimal
    // scaling is a converter refinement, irrelevant to the side/venue/symbol deny.
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
        "Alo" => TimeInForce::PostOnly, // Add-Liquidity-Only == post-only
        _ => TimeInForce::Gtc,
    };

    // Hyperliquid is an off-chain L1 venue: no settlement chain / contract `to`.
    let venue = PerpVenue::Hyperliquid {
        chain: ChainId::new("hl-mainnet"),
    };
    let market = MarketRef {
        symbol: symbol.to_owned(),
        venue: VenueRef::new("hyperliquid"),
    };

    // Live inputs are not needed by the deny conditions; fill with placeholders
    // sourced as user-supplied so the lowering produces a schema-conformant
    // context. (A real run would populate these from the venue API.)
    let src = || DataSource::UserSupplied;
    let now = Time::from_unix(0);
    let live_inputs = PlaceLimitLiveInputs {
        mark_price: LiveField::new(price.clone(), src(), now),
        best_bid_ask: LiveField::new((Price::new("0"), Price::new("0")), src(), now),
        open_orders_count: LiveField::new(0u32, src(), now),
        user_account_state: LiveField::new(
            PerpAccountState {
                total_collateral_usd: U256::ZERO,
                used_margin_usd: U256::ZERO,
                free_margin_usd: U256::ZERO,
                open_positions: vec![],
            },
            src(),
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

// Off-chain-sig meta for a Hyperliquid order (agent-signed, no on-chain tx).
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

// Wallet (principal) + sentinel resource `to` (HL orders have no on-chain `to`;
// perp policies bind on context.venue/market/side, not on `resource`).
const FROM: &str = "0x1111111111111111111111111111111111111111";
const TO_SENTINEL: &str = "0x0000000000000000000000000000000000000000";

// A minimal v2 manifest: trigger matches perp `place_limit_order`, no policy-RPC
// calls, no custom context. `compose_per_policy` synthesizes the per-policy Cedar
// schema (base `Perp::PlaceLimitOrderContext`) from it.
fn perp_manifest() -> ManifestV2 {
    serde_json::from_value(json!({
        "id": "hl-perp-guard",
        "schema_version": 2,
        "trigger": { "where": { "action.tag": { "eq": "place_limit_order" } } },
        "policy_rpc": [],
        "custom_context": { "fields": {} }
    }))
    .expect("ManifestV2 deserializes")
}

// The deny policy under test: block SHORT limit orders on Hyperliquid.
// Pure string-equality on base context fields — no decimal/has guards needed.
const DENY_SHORT_ON_HL: &str = "\
@id(\"hl/no-short\")\n\
@severity(\"deny\")\n\
@reason(\"Short perp orders on Hyperliquid are blocked by policy\")\n\
forbid(principal, action == Perp::Action::\"PlaceLimitOrder\", resource)\n\
when { context.venue.name == \"hyperliquid\" && context.side == \"short\" };\n";

// Run the full deny pipeline for one converted order, return the Verdict.
fn evaluate_order(body: &ActionBody, policy: &str) -> Verdict {
    let meta = hl_meta();
    let tx = TxMeta {
        from: FROM,
        to: TO_SENTINEL,
    };
    let lowered = lower_action(body, &meta, &tx).expect("lower_action");

    let manifest = perp_manifest();
    let schema = compose_per_policy(&manifest).expect("compose_per_policy");
    let engine = PolicyEngine::build_from_per_policy(&[(policy.to_owned(), schema)])
        .expect("build_from_per_policy");

    engine
        .evaluate(
            &lowered.principal,
            &lowered.action_uid,
            &lowered.resource,
            &json!([]),
            &lowered.context,
        )
        .expect("evaluate")
}

/// THE PROOF: a Hyperliquid short limit order is BLOCKED.
///
/// `/exchange` body for "sell 0.1 BTC @ 60000, GTC" (b=false ⇒ short) →
/// converted → lowered → evaluated against the deny policy ⇒ `Verdict::Fail`,
/// carrying the deny rule's id. In the extension this Fail makes the fetch hook
/// reject the POST, so the order never reaches Hyperliquid.
#[test]
fn hyperliquid_short_order_is_denied() {
    let exchange_body = json!({
        "action": {
            "type": "order",
            "orders": [{
                "a": 0,            // perp asset index → resolved to "BTC-USD"
                "b": false,        // isBuy=false ⇒ SHORT
                "p": "60000",
                "s": "0.1",
                "r": false,
                "t": { "limit": { "tif": "Gtc" } }
            }],
            "grouping": "na"
        },
        "nonce": 1_738_000_000_000u64
    });
    let order = &exchange_body["action"]["orders"][0];
    let body = hl_order_to_action_body(order, "BTC-USD");

    let verdict = evaluate_order(&body, DENY_SHORT_ON_HL);

    match verdict {
        Verdict::Fail(matched) => {
            assert!(
                matched.iter().any(|m| m.policy_id == "hl/no-short"),
                "expected the hl/no-short deny rule to match, got: {matched:?}"
            );
        }
        other => panic!("expected Verdict::Fail (blocked), got {other:?}"),
    }
}

/// CONTROL 1 — selectivity: a LONG order (b=true) on Hyperliquid is NOT blocked
/// by the short-only deny. Proves the deny is conditional, not a blanket fail.
#[test]
fn hyperliquid_long_order_passes() {
    let order = json!({ "a": 0, "b": true, "p": "60000", "s": "0.1", "r": false,
                        "t": { "limit": { "tif": "Gtc" } } });
    let body = hl_order_to_action_body(&order, "BTC-USD");
    assert_eq!(
        evaluate_order(&body, DENY_SHORT_ON_HL),
        Verdict::Pass,
        "a long order must pass the short-only deny"
    );
}

/// CONTROL 2 — coin-scoped deny: "block any order on DOGE-USD" blocks a DOGE
/// short but lets a BTC short through, proving market.symbol scoping works.
#[test]
fn coin_scoped_deny_is_symbol_selective() {
    const DENY_DOGE: &str = "\
@id(\"hl/no-doge\")\n@severity(\"deny\")\n@reason(\"DOGE trading blocked\")\n\
forbid(principal, action == Perp::Action::\"PlaceLimitOrder\", resource)\n\
when { context.market.symbol == \"DOGE-USD\" };\n";

    let doge = hl_order_to_action_body(
        &json!({ "a": 7, "b": false, "p": "0.1", "s": "100", "r": false,
                 "t": { "limit": { "tif": "Gtc" } } }),
        "DOGE-USD",
    );
    let btc = hl_order_to_action_body(
        &json!({ "a": 0, "b": false, "p": "60000", "s": "0.1", "r": false,
                 "t": { "limit": { "tif": "Gtc" } } }),
        "BTC-USD",
    );

    assert!(
        matches!(evaluate_order(&doge, DENY_DOGE), Verdict::Fail(_)),
        "DOGE order must be blocked by the DOGE deny"
    );
    assert_eq!(
        evaluate_order(&btc, DENY_DOGE),
        Verdict::Pass,
        "BTC order must pass the DOGE-only deny"
    );
}

/// CONTROL 3 — no policy installed ⇒ baseline Pass (the engine does not block
/// by default; blocking requires an explicit deny). Guards against a false-green
/// where everything "fails" regardless of policy.
#[test]
fn no_deny_policy_passes_baseline() {
    let order = json!({ "a": 0, "b": false, "p": "60000", "s": "0.1", "r": false,
                        "t": { "limit": { "tif": "Gtc" } } });
    let body = hl_order_to_action_body(&order, "BTC-USD");
    const ALLOW_ALL: &str =
        "@id(\"noop\")\n@severity(\"warn\")\npermit(principal, action, resource);\n";
    // A permit-only set yields Pass (no deny matched).
    assert_eq!(evaluate_order(&body, ALLOW_ALL), Verdict::Pass);
}
