//! Offline verdict coverage for the Hyperliquid CORE *confirm/deny* policies
//! that the live extension path cannot exercise (a production `/exchange` POST
//! would place a real order). Each test constructs the `HyperliquidCoreAction`
//! a `/exchange` body decodes into, lowers it, and evaluates it against the
//! REAL shipped catalog policy (`fixtures/policy_catalog_v2/protocol/hyperliquid`)
//! — proving the protocol→venue-corrected, condition-bearing HL CORE policies
//! fire (warn/deny) and their controls pass. Complements `hl_exchange_deny_poc`
//! (no-short / reduce-only / twap / withdraw-confirm / high-leverage).
#![allow(clippy::all, clippy::pedantic, clippy::nursery, missing_docs)]

use std::str::FromStr;

use serde_json::json;

use policy_engine::lowering_v2::{lower_action, TxMeta};
use policy_engine::policy::{PolicyEngine, Verdict};
use policy_engine::policy_rpc::ManifestV2;
use policy_engine::schema::compose_per_policy;

use policy_state::primitives::{Address, Decimal, Time};
use policy_transition::action::hyperliquid_core::{
    HlCWithdrawAction, HlSendAssetAction, HlSendToEvmWithDataAction, HlSpotSendAction,
    HlTokenDelegateAction, HyperliquidCoreAction,
};
use policy_transition::action::{ActionBody, ActionMeta, ActionNature, Eip712Domain};

const FROM: &str = "0x1111111111111111111111111111111111111111";
const TO_SENTINEL: &str = "0x0000000000000000000000000000000000000000";

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

fn manifest(tag: &str) -> ManifestV2 {
    serde_json::from_value(json!({
        "id": format!("{tag}-guard"),
        "schema_version": 2,
        "trigger": { "where": { "action.tag": { "eq": tag } } },
        "policy_rpc": [],
        "custom_context": { "fields": {} }
    }))
    .expect("ManifestV2 deserializes")
}

/// Load a shipped catalog policy's cedar text verbatim (CWD = crate root).
fn fixture(id: &str) -> String {
    let path = format!("tests/fixtures/policy_catalog_v2/protocol/hyperliquid/{id}/policy.cedar");
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

fn evaluate(body: &ActionBody, tag: &str, policy: &str) -> Verdict {
    let meta = hl_meta();
    let tx = TxMeta {
        from: FROM,
        to: TO_SENTINEL,
    };
    let lowered = lower_action(body, &meta, &tx).expect("lower_action");
    let schema = compose_per_policy(&manifest(tag)).expect("compose_per_policy");
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

fn addr(a: &str) -> Address {
    Address::from_str(a).unwrap()
}
fn dec(d: &str) -> Decimal {
    Decimal::new(d)
}

fn warned(v: &Verdict, id: &str) -> bool {
    matches!(v, Verdict::Warn(m) if m.iter().any(|x| x.policy_id == id))
}
fn denied(v: &Verdict, id: &str) -> bool {
    matches!(v, Verdict::Fail(m) if m.iter().any(|x| x.policy_id == id))
}

// ── hl-spot-send-confirm (static warn; SpotSend → Token::Erc20Transfer) ──
#[test]
fn hl_spot_send_confirms() {
    let body = ActionBody::HyperliquidCore(HyperliquidCoreAction::SpotSend(HlSpotSendAction {
        destination: addr("0x000000000000000000000000000000000000dEaD"),
        token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054".to_owned(),
        amount: dec("250.5"),
    }));
    let v = evaluate(&body, "hl_spot_send", &fixture("hl-spot-send-confirm"));
    assert!(
        warned(&v, "hl-spot-send-confirm"),
        "expected warn, got {v:?}"
    );
}

// ── hl-send-asset-cross-dex-confirm (warn iff sourceDex != destinationDex) ──
#[test]
fn hl_send_asset_cross_dex_warns_same_dex_passes() {
    let mk = |src: &str, dst: &str| {
        ActionBody::HyperliquidCore(HyperliquidCoreAction::SendAsset(HlSendAssetAction {
            destination: addr("0x2222222222222222222222222222222222222222"),
            source_dex: src.to_owned(),
            destination_dex: dst.to_owned(),
            token: "USDC".to_owned(),
            amount: dec("1000"),
        }))
    };
    let cedar = fixture("hl-send-asset-cross-dex-confirm");
    let cross = evaluate(&mk("perp", "spot"), "hl_send_asset", &cedar);
    assert!(
        warned(&cross, "hl-send-asset-cross-dex-confirm"),
        "cross-dex must warn, got {cross:?}"
    );
    let same = evaluate(&mk("perp", "perp"), "hl_send_asset", &cedar);
    assert_eq!(same, Verdict::Pass, "same-dex must pass, got {same:?}");
}

// ── hl-send-to-evm-with-data-deny (deny iff calldata != "0x") ──
#[test]
fn hl_send_to_evm_with_calldata_denies_empty_passes() {
    let mk = |data: &str| {
        ActionBody::HyperliquidCore(HyperliquidCoreAction::SendToEvmWithData(
            HlSendToEvmWithDataAction {
                token: "USDC".to_owned(),
                amount: dec("500"),
                source_dex: "perp".to_owned(),
                destination_recipient: addr("0x3333333333333333333333333333333333333333"),
                data: data.to_owned(),
            },
        ))
    };
    let cedar = fixture("hl-send-to-evm-with-data-deny");
    let with = evaluate(&mk("0xdeadbeef"), "hl_send_to_evm_with_data", &cedar);
    assert!(
        denied(&with, "hl-send-to-evm-with-data-deny"),
        "non-empty calldata must deny, got {with:?}"
    );
    let empty = evaluate(&mk("0x"), "hl_send_to_evm_with_data", &cedar);
    assert_eq!(
        empty,
        Verdict::Pass,
        "empty calldata must pass, got {empty:?}"
    );
}

// ── hl-token-delegate-confirm (warn iff isUndelegate == false) ──
#[test]
fn hl_token_delegate_warns_undelegate_passes() {
    let mk = |undelegate: bool| {
        ActionBody::HyperliquidCore(HyperliquidCoreAction::TokenDelegate(
            HlTokenDelegateAction {
                validator: addr("0x4444444444444444444444444444444444444444"),
                is_undelegate: undelegate,
                wei: dec("100"),
            },
        ))
    };
    let cedar = fixture("hl-token-delegate-confirm");
    let delegate = evaluate(&mk(false), "hl_token_delegate", &cedar);
    assert!(
        warned(&delegate, "hl-token-delegate-confirm"),
        "delegate must warn, got {delegate:?}"
    );
    let undelegate = evaluate(&mk(true), "hl_token_delegate", &cedar);
    assert_eq!(
        undelegate,
        Verdict::Pass,
        "undelegate must pass, got {undelegate:?}"
    );
}

// ── hl-c-withdraw-staking-confirm (static warn; CWithdraw → Staking::Redeem) ──
#[test]
fn hl_c_withdraw_staking_confirms() {
    let body = ActionBody::HyperliquidCore(HyperliquidCoreAction::CWithdraw(HlCWithdrawAction {
        wei: dec("42.0"),
    }));
    let v = evaluate(
        &body,
        "hl_c_withdraw",
        &fixture("hl-c-withdraw-staking-confirm"),
    );
    assert!(
        warned(&v, "hl-c-withdraw-staking-confirm"),
        "expected warn, got {v:?}"
    );
}
