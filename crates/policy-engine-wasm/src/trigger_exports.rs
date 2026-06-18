//! `#[wasm_bindgen]` trigger pre-filter export.
//!
//! The host calls [`evaluate_triggers_json`] AFTER decoding a transaction into
//! a `policy_transition::action::ActionBody` but BEFORE any policy-rpc call,
//! to learn which installed policies' triggers match — so only those policies'
//! enrichment runs and only they are evaluated.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

use policy_engine::policy_rpc::{
    evaluate_trigger, scope_matches_position, ManifestV2, TxView, MAX_POLICY_RPC_V2_MANIFESTS,
};
use policy_transition::action::ActionBody;

use crate::exports::check_input_size;

/// Input: the installed manifests (v2), the decoded action, and tx metadata.
#[derive(Deserialize)]
struct EvaluateTriggersInput {
    manifests: Vec<ManifestV2>,
    action: ActionBody,
    tx: TxInput,
}

impl EvaluateTriggersInput {
    /// 트리거의 tx.from/tx.to eq/in 비교도 엔진 표기(소문자) 기준 — checksum
    /// 케이스 입력을 정규화한다 (action_eval_exports::TxInput::normalize와 동일).
    fn normalize(&mut self) {
        self.tx.from = self.tx.from.to_lowercase();
        self.tx.to = self.tx.to.to_lowercase();
    }
}

/// Transaction-level trigger fields.
#[derive(Deserialize)]
struct TxInput {
    chain_id: String,
    from: String,
    to: String,
}

/// Output: ids of the manifests whose trigger matched.
#[derive(Serialize)]
struct EvaluateTriggersOutput {
    matched_ids: Vec<String>,
}

/// Return the ids of the manifests whose [`Trigger`](policy_engine::policy_rpc::Trigger)
/// matches the decoded action.
///
/// Scope handling mirrors the v2 evaluation tree: every multicall batch position
/// is tested for `outer`, while every non-multicall leaf position is tested for
/// `inner` (default). A manifest matches if any eligible position in the tree
/// matches its trigger. Returns `{"matched_ids":[...]}` or `{"error":"..."}`.
#[wasm_bindgen]
#[must_use]
pub fn evaluate_triggers_json(input_json: String) -> String {
    match run(&input_json) {
        Ok(out) => serde_json::to_string(&out)
            .unwrap_or_else(|e| error_json(&format!("serialize output: {e}"))),
        Err(e) => error_json(&e),
    }
}

fn run(input_json: &str) -> Result<EvaluateTriggersOutput, String> {
    check_input_size(input_json, "evaluate_triggers_json").map_err(|e| e.message)?;
    let mut input: EvaluateTriggersInput =
        serde_json::from_str(input_json).map_err(|e| format!("invalid input json: {e}"))?;
    if input.manifests.len() > MAX_POLICY_RPC_V2_MANIFESTS {
        return Err(format!(
            "evaluate_triggers_json manifest count {} exceeds {MAX_POLICY_RPC_V2_MANIFESTS} item limit",
            input.manifests.len()
        ));
    }
    input.normalize();
    let tx = TxView {
        chain_id: &input.tx.chain_id,
        from: &input.tx.from,
        to: &input.tx.to,
    };
    let matched_ids = input
        .manifests
        .iter()
        .filter(|m| manifest_matches(m, &input.action, &tx))
        .map(|m| m.id.clone())
        .collect();
    Ok(EvaluateTriggersOutput { matched_ids })
}

fn manifest_matches(manifest: &ManifestV2, action: &ActionBody, tx: &TxView<'_>) -> bool {
    let view = action.view();
    if scope_matches_position(manifest.trigger.scope, &view)
        && evaluate_trigger(&manifest.trigger, &view, tx)
    {
        return true;
    }
    if let ActionBody::Multicall { actions } = action {
        return actions
            .iter()
            .any(|child| manifest_matches(manifest, child, tx));
    }
    false
}

fn error_json(message: &str) -> String {
    // `message` is plain text; serialize it as a JSON string for safe quoting.
    let quoted = serde_json::to_string(message).unwrap_or_else(|_| "\"error\"".to_owned());
    format!("{{\"error\":{quoted}}}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use policy_state::primitives::{Address, ChainId, U256};
    use policy_state::token::{TokenKey, TokenRef};
    use policy_transition::action::token::{Erc20ApproveAction, TokenAction};
    use serde_json::{json, Value};
    use std::str::FromStr;

    fn approve() -> ActionBody {
        let token = TokenRef {
            key: TokenKey::Erc20 {
                chain: ChainId::ethereum_mainnet(),
                address: Address::from_str("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48").unwrap(),
            },
        };
        ActionBody::Token(TokenAction::Erc20Approve(Erc20ApproveAction {
            token,
            spender: Address::from_str("0x00000000000000000000000000000000deadbeef").unwrap(),
            amount: U256::from(1u64),
        }))
    }

    fn matched(input: Value) -> Vec<String> {
        let out = evaluate_triggers_json(input.to_string());
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("error").is_none(), "unexpected error: {out}");
        v["matched_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_owned())
            .collect()
    }

    fn tx() -> Value {
        json!({ "chain_id": "eip155:1", "from": "0x01", "to": "0x02" })
    }

    #[test]
    fn matches_by_action_tag_and_filters_others() {
        let ids = matched(json!({
            "manifests": [
                { "id": "approve-policy", "schema_version": 2,
                  "trigger": { "where": { "action.tag": { "eq": "erc20_approve" } } } },
                { "id": "swap-policy", "schema_version": 2,
                  "trigger": { "where": { "action.tag": { "eq": "swap" } } } }
            ],
            "action": approve(),
            "tx": tx(),
        }));
        assert_eq!(ids, vec!["approve-policy".to_owned()]);
    }

    #[test]
    fn empty_trigger_always_matches() {
        let ids = matched(json!({
            "manifests": [ { "id": "always", "schema_version": 2 } ],
            "action": approve(),
            "tx": tx(),
        }));
        assert_eq!(ids, vec!["always".to_owned()]);
    }

    #[test]
    fn inner_scope_multicall_matches_if_any_child_matches() {
        let action = ActionBody::Multicall {
            actions: vec![approve()],
        };
        let ids = matched(json!({
            "manifests": [
                { "id": "approve-policy", "schema_version": 2,
                  "trigger": { "where": { "action.tag": { "eq": "erc20_approve" } } } },
                { "id": "swap-policy", "schema_version": 2,
                  "trigger": { "where": { "action.tag": { "eq": "swap" } } } }
            ],
            "action": action,
            "tx": tx(),
        }));
        assert_eq!(ids, vec!["approve-policy".to_owned()]);
    }

    #[test]
    fn inner_scope_multicall_matches_nested_leaf() {
        let action = ActionBody::Multicall {
            actions: vec![ActionBody::Multicall {
                actions: vec![approve()],
            }],
        };
        let ids = matched(json!({
            "manifests": [
                { "id": "approve-policy", "schema_version": 2,
                  "trigger": { "where": { "action.tag": { "eq": "erc20_approve" } } } },
                { "id": "inner-multicall", "schema_version": 2,
                  "trigger": { "where": { "action.domain": { "eq": "multicall" } } } }
            ],
            "action": action,
            "tx": tx(),
        }));
        assert_eq!(ids, vec!["approve-policy".to_owned()]);
    }

    #[test]
    fn outer_scope_matches_multicall_domain() {
        let action = ActionBody::Multicall {
            actions: vec![approve()],
        };
        let ids = matched(json!({
            "manifests": [
                { "id": "bundle-watch", "schema_version": 2,
                  "trigger": { "scope": "outer",
                               "where": { "action.domain": { "eq": "multicall" } } } },
                // inner-scope domain==multicall never matches (children aren't multicall)
                { "id": "inner-multicall", "schema_version": 2,
                  "trigger": { "where": { "action.domain": { "eq": "multicall" } } } }
            ],
            "action": action,
            "tx": tx(),
        }));
        assert_eq!(ids, vec!["bundle-watch".to_owned()]);
    }

    #[test]
    fn invalid_input_returns_error_json() {
        let out = evaluate_triggers_json("not json".to_owned());
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["error"].as_str().unwrap().contains("invalid input json"));
    }

    #[test]
    fn oversized_input_returns_error_json_before_parse() {
        let out = evaluate_triggers_json("x".repeat(crate::exports::MAX_WASM_INPUT_JSON_LEN + 1));
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["error"].as_str().unwrap().contains("input json length"));
        assert!(v["error"]
            .as_str()
            .unwrap()
            .contains("evaluate_triggers_json"));
    }

    #[test]
    fn too_many_manifests_returns_error_json() {
        let manifests: Vec<Value> = (0..=MAX_POLICY_RPC_V2_MANIFESTS)
            .map(|i| json!({ "id": format!("m{i}"), "schema_version": 2 }))
            .collect();
        let out = evaluate_triggers_json(
            json!({
                "manifests": manifests,
                "action": approve(),
                "tx": tx(),
            })
            .to_string(),
        );
        let v: Value = serde_json::from_str(&out).unwrap();

        assert!(v["error"].as_str().unwrap().contains("manifest count"));
        assert!(v["error"]
            .as_str()
            .unwrap()
            .contains("evaluate_triggers_json"));
    }
}
