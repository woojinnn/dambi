//! Request builders for leaf actions and transaction-summary evaluations.
//!
//! `request_from_action` preserves per-leaf shape for action-level checks.
//! `request_for_tx` builds a transaction summary request that aggregates leaf
//! traits (kinds, recipients, protocols, totals) while preserving allowRevert
//! data carried in leaf request context.

use std::collections::HashSet;

use crate::context_keys::{
    ALLOW_REVERT, ALLOW_REVERT_COUNT, CHAIN_ID, CHILD_COUNT, CHILD_KINDS, DISTINCT_RECIPIENTS,
    EXTN_ARG, EXTN_DECIMAL, EXTN_FN, EXTN_KEY, FEE_BIPS, FROM, HAS_APPROVE, HAS_UNKNOWN, HUMAN,
    INPUT_AMOUNT, KINDS, MIN_OUTPUT_AMOUNT, PROTOCOLS_USED, PROTOCOL_ID, RAW, RECIPIENT, SELECTOR,
    STALE_SEC, TARGET, TO, TOKEN_SYMBOL, TOTAL_INPUT_USD, USD, VALUE, VALUE_WEI,
};
use crate::core::{Action, AmountSpec, TransactionRequest};
use crate::policy::PolicyRequest;
use serde_json::{json, Value};

use super::decimal::add_decimal_strings;

/// Build a `PolicyRequest` from a fully-enriched `Action`. This is the public
/// "Action → Cedar request" conversion used by `Pipeline` lowering.
pub fn request_from_action(action: &Action) -> PolicyRequest {
    let principal = format!(r#"Wallet::"{}""#, action.actor().as_str());
    let action_uid = format!(r#"Action::"{}""#, action.kind());
    let resource = match action {
        Action::Swap(s) => format!(r#"Protocol::"{}""#, s.protocol_id),
        Action::Multi(_) => String::from(r#"Protocol::"multi""#),
        Action::Other { .. } => String::from(r#"Protocol::"unknown""#),
    };
    let entities = action_entities(action);
    let context = action_context(action);
    PolicyRequest::new(principal, action_uid, resource, entities, context)
}

pub fn request_for_tx(
    tx: &TransactionRequest,
    leaves: &[Action],
    leaf_requests: &[PolicyRequest],
) -> PolicyRequest {
    let principal = format!(r#"Wallet::"{}""#, tx.from.as_str());
    let action = r#"Action::"send_tx""#.to_string();
    let resource = format!(r#"Address_::"{}""#, tx.to.as_str());

    let allow_revert_count = leaf_requests
        .iter()
        .filter_map(|req| req.context.get(ALLOW_REVERT).and_then(Value::as_bool))
        .filter(|v| *v)
        .count() as i64;

    #[derive(Default)]
    struct LeafSummary {
        kinds: Vec<String>,
        protocols: Vec<String>,
        distinct_recipients: HashSet<String>,
        has_approve: bool,
        has_unknown: bool,
        total_input_usd: Option<String>,
    }

    let mut summary = LeafSummary::default();
    for action in leaves {
        let kind = action.kind();
        summary.kinds.push(kind.to_string());
        match kind {
            "approve" => summary.has_approve = true,
            "other" => summary.has_unknown = true,
            _ => {}
        }

        if let Action::Swap(s) = action {
            summary.protocols.push(s.protocol_id.clone());
            summary
                .distinct_recipients
                .insert(s.recipient.as_str().to_string());
            if let Some(usd) = &s.input_amount.usd {
                summary.total_input_usd = Some(match summary.total_input_usd {
                    Some(prev) => add_decimal_strings(&prev, &usd.value),
                    None => usd.value.clone(),
                });
            }
        }
    }
    summary.protocols.sort_unstable();
    summary.protocols.dedup();

    let mut context = serde_json::Map::new();
    context.insert(CHAIN_ID.into(), Value::from(tx.chain_id as i64));
    context.insert(FROM.into(), Value::from(tx.from.as_str()));
    context.insert(TO.into(), Value::from(tx.to.as_str()));
    context.insert(VALUE_WEI.into(), Value::from(tx.value_wei.clone()));
    context.insert(
        SELECTOR.into(),
        Value::from(tx.selector_hex().unwrap_or_else(|| "0x".into())),
    );
    context.insert(CHILD_COUNT.into(), Value::from(leaves.len() as i64));
    context.insert(
        KINDS.into(),
        Value::Array(
            summary
                .kinds
                .iter()
                .map(|kind| Value::from(kind.clone()))
                .collect(),
        ),
    );
    context.insert(
        PROTOCOLS_USED.into(),
        Value::Array(
            summary
                .protocols
                .iter()
                .map(|protocol| Value::from(protocol.as_str()))
                .collect(),
        ),
    );
    context.insert(HAS_APPROVE.into(), Value::from(summary.has_approve));
    context.insert(HAS_UNKNOWN.into(), Value::from(summary.has_unknown));
    context.insert(
        DISTINCT_RECIPIENTS.into(),
        Value::from(summary.distinct_recipients.len() as i64),
    );
    context.insert(ALLOW_REVERT_COUNT.into(), Value::from(allow_revert_count));

    if let Some(total_input_usd) = summary.total_input_usd {
        let mut extn_inner = serde_json::Map::new();
        extn_inner.insert(EXTN_FN.into(), Value::from(EXTN_DECIMAL));
        extn_inner.insert(EXTN_ARG.into(), Value::from(total_input_usd));
        let mut total_input = serde_json::Map::new();
        total_input.insert(EXTN_KEY.into(), Value::Object(extn_inner));

        context.insert(TOTAL_INPUT_USD.into(), Value::Object(total_input));
    }

    let entities = json!([
        { "uid": { "type": "Wallet", "id": tx.from.as_str() }, "attrs": {}, "parents": [] },
        { "uid": { "type": "Address_", "id": tx.to.as_str() }, "attrs": {}, "parents": [] },
    ]);
    PolicyRequest::new(
        principal,
        action,
        resource,
        entities,
        Value::Object(context),
    )
}

/// Build one or more leaf `PolicyRequest`s from an action tree. `Multi`
/// actions are structural: their children are evaluated individually so
/// existing leaf policies such as `action == Action::"swap"` keep working
/// without policy edits.
pub fn requests_from_action(action: &Action) -> Vec<PolicyRequest> {
    match action {
        Action::Multi(m) => requests_from_actions(&m.children),
        Action::Swap(_) | Action::Other { .. } => vec![request_from_action(action)],
    }
}

pub fn requests_from_actions(actions: &[Action]) -> Vec<PolicyRequest> {
    actions.iter().flat_map(requests_from_action).collect()
}

pub(super) fn action_entities(action: &Action) -> Value {
    let resource_id = match action {
        Action::Swap(s) => s.protocol_id.clone(),
        Action::Multi(_) => "multi".into(),
        Action::Other { .. } => "unknown".into(),
    };
    let actor_id = action.actor().as_str();
    json!([
        { "uid": { "type": "Wallet",   "id": actor_id },   "attrs": {}, "parents": [] },
        { "uid": { "type": "Protocol", "id": resource_id },   "attrs": {}, "parents": [] },
    ])
}

pub(super) fn action_context(action: &Action) -> Value {
    // Optional fields are *omitted* (not set to null) — Cedar has no null
    // type, and policies guard with `context has "field"`.
    match action {
        Action::Swap(s) => {
            let mut m = serde_json::Map::new();
            m.insert(INPUT_AMOUNT.into(), amount_json(&s.input_amount));
            if let Some(min) = &s.min_output_amount {
                m.insert(MIN_OUTPUT_AMOUNT.into(), amount_json(min));
            }
            if let Some(fee) = s.fee_bips {
                m.insert(FEE_BIPS.into(), Value::from(fee as i64));
            }
            m.insert(TARGET.into(), Value::from(s.target.as_str()));
            m.insert(RECIPIENT.into(), Value::from(s.recipient.as_str()));
            m.insert(PROTOCOL_ID.into(), Value::from(s.protocol_id.clone()));
            Value::Object(m)
        }
        Action::Multi(multi) => {
            let mut m = serde_json::Map::new();
            m.insert(CHILD_COUNT.into(), Value::from(multi.children.len() as i64));
            m.insert(
                CHILD_KINDS.into(),
                Value::Array(
                    multi
                        .children
                        .iter()
                        .map(|a| Value::from(a.kind()))
                        .collect(),
                ),
            );
            Value::Object(m)
        }
        Action::Other {
            selector, target, ..
        } => {
            let mut m = serde_json::Map::new();
            m.insert(SELECTOR.into(), Value::from(selector.as_str()));
            m.insert(TARGET.into(), Value::from(target.as_str()));
            Value::Object(m)
        }
    }
}

pub(super) fn amount_json(a: &AmountSpec) -> Value {
    let mut m = serde_json::Map::new();
    m.insert(TOKEN_SYMBOL.into(), Value::from(a.token.symbol.clone()));
    m.insert(RAW.into(), Value::from(a.raw.clone()));
    if let Some(h) = &a.human {
        m.insert(HUMAN.into(), Value::from(h.clone()));
    }
    if let Some(u) = &a.usd {
        let mut value_extn = serde_json::Map::new();
        let mut extn = serde_json::Map::new();
        extn.insert(EXTN_FN.into(), Value::from(EXTN_DECIMAL));
        extn.insert(EXTN_ARG.into(), Value::from(u.value.clone()));
        value_extn.insert(EXTN_KEY.into(), Value::Object(extn));
        let mut usd = serde_json::Map::new();
        usd.insert(VALUE.into(), Value::Object(value_extn));
        usd.insert(STALE_SEC.into(), Value::from(u.stale_sec as i64));
        m.insert(USD.into(), Value::Object(usd));
    }
    Value::Object(m)
}
