//! E2E (option-2 convergence): our `approval.allowance` fact's output shape
//! (`{ hasExisting: bool }`) drives main's shipped `approve-existing-allowance`
//! policy through the literal extension entry point `evaluate_action_v2_json`.
//!
//! Proves the convergence CONTRACT end-to-end: manifest `from: $.result.hasExisting`
//! projects the fact result onto `context.custom.hasExistingAllowance`, and the
//! main-vocab policy WARNs on `== true`. The fact itself is unit-tested in
//! policy-server (`facts::approval::allowance`); here we replay its output via
//! `results`, the same envelope the service worker sends after the server runs
//! the fact.
//!
//! Run: `cargo test -p policy-engine-wasm --test approval_allowance_e2e`
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::str::FromStr;

use policy_state::live_field::{DataSource, LiveField};
use policy_state::primitives::{Address, ChainId, Time, U256};
use policy_state::token::{TokenKey, TokenRef};
use policy_transition::action::token::Erc20ApproveAction;
use policy_transition::action::{ActionBody, ActionMeta, ActionNature, TokenAction};
use serde_json::{json, Value};

use policy_engine_wasm::evaluate_action_v2_json;

/// The planned call id main's planner derives: `<manifest_id>::<spec_id>`.
const CALL_ID: &str = "approve-existing-allowance::existing-allowance";

fn now() -> Time {
    Time::from_unix(1_738_000_000)
}
fn user() -> Address {
    Address::from_str("0x000000000000000000000000000000000000a01c").unwrap()
}
fn spender() -> Address {
    Address::from_str("0x00000000000000000000000000000000deadbeef").unwrap()
}
fn usdc() -> TokenRef {
    TokenRef {
        key: TokenKey::Erc20 {
            chain: ChainId::ethereum_mainnet(),
            address: Address::from_str("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48").unwrap(),
        },
    }
}
fn gas_price() -> LiveField<U256> {
    LiveField::new(
        U256::from(20_000_000_000u64),
        DataSource::OnchainView {
            chain: ChainId::ethereum_mainnet(),
            contract: Address::from([0u8; 20]),
            function: "gasPrice()".into(),
            decoder_id: "stub".into(),
        },
        now(),
    )
}

/// `ActionBody` JSON for an `Erc20Approve` (unlimited) — built TYPED then
/// serialized so serde drift fails here, not silently at runtime.
fn approve_body() -> Value {
    let body = ActionBody::Token(TokenAction::Erc20Approve(Erc20ApproveAction {
        token: usdc(),
        spender: spender(),
        amount: U256::MAX,
    }));
    serde_json::to_value(body).unwrap()
}

fn onchain_meta() -> Value {
    let meta = ActionMeta {
        submitted_at: now(),
        submitter: user(),
        nature: ActionNature::OnchainTx {
            chain: ChainId::ethereum_mainnet(),
            nonce: 0,
            gas_limit: U256::from(100_000u64),
            gas_price: gas_price(),
            value: U256::from(0u64),
        },
    };
    serde_json::to_value(meta).unwrap()
}

/// The shipped `approve-existing-allowance` bundle, read verbatim from the
/// policy_catalog_v2 corpus.
fn bundle() -> Value {
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("policy-engine")
        .join("tests")
        .join("fixtures")
        .join("policy_catalog_v2")
        .join("action")
        .join("approval")
        .join("approve-existing-allowance");
    let policy = std::fs::read_to_string(dir.join("policy.cedar")).expect("read policy.cedar");
    let manifest: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).unwrap())
            .expect("manifest.json parses");
    json!({ "policy": policy, "manifest": manifest })
}

fn run(results: Value) -> Value {
    let input = json!({
        "action": approve_body(),
        "meta": onchain_meta(),
        "tx": {
            "chain_id": "eip155:1",
            "from": "0x000000000000000000000000000000000000a01c",
            "to": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        },
        "bundles": [bundle()],
        "results": results,
    });
    serde_json::from_str(&evaluate_action_v2_json(input.to_string()))
        .expect("entry point returns JSON")
}

/// THE PROOF: fact `hasExisting=true` → `context.custom.hasExistingAllowance=true`
/// → `approve-existing-allowance` WARNs through the entry point.
#[test]
fn existing_allowance_warns_through_entry_point() {
    let parsed = run(json!({ CALL_ID: { "hasExisting": true } }));
    assert_eq!(parsed["ok"], true, "envelope ok: {parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "warn",
        "an existing allowance must WARN: {parsed}"
    );
    assert_eq!(
        parsed["data"]["verdict"]["matched"][0]["policy_id"], "approve-existing-allowance",
        "the convergence policy must be the matched one: {parsed}"
    );
}

/// CONTROL: fact `hasExisting=false` → policy `== true` is false → PASS.
#[test]
fn no_existing_allowance_passes() {
    let parsed = run(json!({ CALL_ID: { "hasExisting": false } }));
    assert_eq!(parsed["ok"], true, "{parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "pass",
        "no existing allowance must PASS: {parsed}"
    );
}

/// CONTROL: the call is `optional`; an absent result leaves the field unset, so
/// the `context.custom has hasExistingAllowance` guard is false → fail-open PASS.
#[test]
fn absent_optional_result_fails_open_to_pass() {
    let parsed = run(json!({}));
    assert_eq!(parsed["ok"], true, "{parsed}");
    assert_eq!(
        parsed["data"]["verdict"]["kind"], "pass",
        "absent optional enrichment must fail-open to PASS: {parsed}"
    );
}
