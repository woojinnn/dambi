//! `single_emit` strategy execution (spec §5.2.1).
//!
//! For Phase 1A only `category="dex" / action="swap"` is supported. The
//! interpreter:
//!
//!  1. Builds the JSON view of `decoded.args` ([`super::eval::args_to_json`]).
//!  2. Evaluates every `(field_path, ValueExpr)` entry into a JSON value.
//!  3. Materialises a nested `serde_json::Value` tree by splitting each
//!     `field_path` on `.` (so `inputToken.asset.address` becomes
//!     `{ inputToken: { asset: { address: <value> } } }`).
//!  4. Maps that tree into a [`SwapAction`] via §5.6 rules (inputToken /
//!     outputToken / recipient / validity).
//!
//! The intermediate JSON tree is deliberately ignorant of policy-engine types,
//! and conversion happens only at the SwapAction boundary. This keeps the
//! interpreter generic for when category/action expand beyond swap.
//!
//! `fee_bps` is intentionally `None` — Phase 1A's bundle does not emit it.
//! The equivalence test asserts this gap explicitly (the static V2 mapper
//! returns `Some(30)` while declarative returns `None`).

use std::collections::BTreeMap;
use std::str::FromStr as _;

use abi_resolver::DecodedCall;
use policy_engine::action::dex::{SwapAction, SwapMode};
use policy_engine::action::{
    Action, ActionEnvelope, Address, AmountConstraint, AmountKind, AssetKind, AssetRef,
    AssetRefWithAmountConstraint, Category, DecimalString, Validity, ValiditySource,
};

use crate::mapper::{MapContext, MapperError};

use super::eval::{args_to_json, evaluate};
use super::types::{EmitRule, ValueExpr};

/// Execute a `single_emit` rule against the given decoded call.
///
/// Only `category="dex"` / `action="swap"` is implemented in Phase 1A. Any
/// other combination yields [`MapperError::Internal`].
pub fn execute(
    ctx: &MapContext<'_>,
    decoded: &DecodedCall,
    rule: &EmitRule,
) -> Result<ActionEnvelope, MapperError> {
    let (category, action, fields) = match rule {
        EmitRule::SingleEmit {
            category,
            action,
            fields,
        } => (category.as_str(), action.as_str(), fields),
        other => {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "single_emit::execute called with non-single_emit rule: {other:?}"
            )))
        }
    };

    let args_json = args_to_json(decoded);
    let tree = build_field_tree(ctx, &args_json, fields)?;

    match (category, action) {
        ("dex", "swap") => Ok(build_swap_envelope(&tree)?),
        (c, a) => Err(MapperError::Internal(anyhow::anyhow!(
            "single_emit category/action {c:?}/{a:?} not implemented in Phase 1A \
             (only dex/swap)"
        ))),
    }
}

/// Evaluate each `ValueExpr`, then merge the dot-paths into a nested JSON tree.
fn build_field_tree(
    ctx: &MapContext<'_>,
    args_json: &serde_json::Value,
    fields: &BTreeMap<String, ValueExpr>,
) -> Result<serde_json::Value, MapperError> {
    let mut root = serde_json::Value::Object(serde_json::Map::new());
    for (path, expr) in fields {
        let value = evaluate(ctx, args_json, expr)?;
        set_nested(&mut root, path, value)?;
    }
    Ok(root)
}

/// `set_nested(root, "a.b.c", v)` mutates `root` so `root.a.b.c == v`.
///
/// Each path segment must be a non-empty bareword (no array indexing). The
/// function refuses to overwrite a non-object intermediate (which would
/// indicate two fields disagreeing about the type of a parent).
fn set_nested(
    root: &mut serde_json::Value,
    path: &str,
    value: serde_json::Value,
) -> Result<(), MapperError> {
    let segments: Vec<&str> = path.split('.').collect();
    if segments.iter().any(|s| s.is_empty()) {
        return Err(MapperError::Internal(anyhow::anyhow!(
            "field path {path:?} contains empty segment"
        )));
    }
    if segments.is_empty() {
        return Err(MapperError::Internal(anyhow::anyhow!(
            "field path is empty"
        )));
    }

    let mut cursor = root;
    for (index, segment) in segments.iter().enumerate() {
        let is_last = index == segments.len() - 1;
        let map = cursor.as_object_mut().ok_or_else(|| {
            MapperError::Internal(anyhow::anyhow!(
                "field path {path:?}: ancestor at segment {} is not an object",
                index
            ))
        })?;
        if is_last {
            map.insert((*segment).to_owned(), value);
            return Ok(());
        }
        cursor = map
            .entry((*segment).to_owned())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    }
    unreachable!("loop returns on the last segment");
}

// ───────────────────────────────────────────────────────────────────────────
// JSON tree → SwapAction
// ───────────────────────────────────────────────────────────────────────────

fn build_swap_envelope(tree: &serde_json::Value) -> Result<ActionEnvelope, MapperError> {
    let input_token = read_asset_with_amount(tree, "inputToken")?;
    let output_token = read_asset_with_amount(tree, "outputToken")?;
    let recipient = read_address(tree, "recipient")?;
    let validity = read_validity(tree)?;
    let swap_mode = derive_swap_mode(&input_token.amount.kind, &output_token.amount.kind);

    let action = SwapAction {
        swap_mode,
        input_token,
        output_token,
        recipient,
        validity,
        fee_bps: None,
    };
    Ok(ActionEnvelope {
        category: Category::Dex,
        action: Action::Swap(action),
    })
}

fn derive_swap_mode(input: &AmountKind, output: &AmountKind) -> SwapMode {
    match (input, output) {
        (AmountKind::Exact, AmountKind::Min) => SwapMode::ExactIn,
        (AmountKind::Max, AmountKind::Exact) => SwapMode::ExactOut,
        _ => SwapMode::Unknown,
    }
}

fn read_asset_with_amount(
    tree: &serde_json::Value,
    field: &str,
) -> Result<AssetRefWithAmountConstraint, MapperError> {
    let token = required_object(tree, field)?;
    let asset = read_asset(token, field)?;
    let amount = read_amount(token, field)?;
    Ok(AssetRefWithAmountConstraint { asset, amount })
}

fn read_asset(token: &serde_json::Value, parent: &str) -> Result<AssetRef, MapperError> {
    let asset = required_object(token, "asset").map_err(|_| missing_field(parent, "asset"))?;
    let kind_str = required_string(asset, "kind").map_err(|_| missing_field(parent, "asset.kind"))?;
    let kind = parse_asset_kind(kind_str)
        .ok_or_else(|| MapperError::Internal(anyhow::anyhow!(
            "{parent}.asset.kind {kind_str:?} not recognised in Phase 1A"
        )))?;
    let address = match asset.get("address") {
        Some(serde_json::Value::String(s)) => Some(
            Address::from_str(s).map_err(|message| MapperError::Internal(anyhow::anyhow!(
                "{parent}.asset.address {s:?}: {message}"
            )))?,
        ),
        Some(serde_json::Value::Null) | None => None,
        Some(other) => {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "{parent}.asset.address: expected string, got {other}"
            )));
        }
    };
    Ok(AssetRef {
        kind,
        address,
        token_id: None,
        symbol: None,
        decimals: None,
    })
}

fn parse_asset_kind(kind: &str) -> Option<AssetKind> {
    match kind {
        "erc20" => Some(AssetKind::Erc20),
        "erc721" => Some(AssetKind::Erc721),
        "erc1155" => Some(AssetKind::Erc1155),
        "native" => Some(AssetKind::Native),
        "unknown" => Some(AssetKind::Unknown),
        _ => None,
    }
}

fn read_amount(
    token: &serde_json::Value,
    parent: &str,
) -> Result<AmountConstraint, MapperError> {
    let amount =
        required_object(token, "amount").map_err(|_| missing_field(parent, "amount"))?;
    let kind_str = required_string(amount, "kind")
        .map_err(|_| missing_field(parent, "amount.kind"))?;
    let kind = parse_amount_kind(kind_str).ok_or_else(|| {
        MapperError::Internal(anyhow::anyhow!(
            "{parent}.amount.kind {kind_str:?} not recognised in Phase 1A"
        ))
    })?;
    let value = match amount.get("value") {
        Some(serde_json::Value::String(s)) => Some(
            DecimalString::from_str(s).map_err(|message| MapperError::Internal(anyhow::anyhow!(
                "{parent}.amount.value {s:?}: {message}"
            )))?,
        ),
        Some(serde_json::Value::Null) | None => None,
        Some(other) => {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "{parent}.amount.value: expected decimal string, got {other}"
            )));
        }
    };
    Ok(AmountConstraint { kind, value })
}

fn parse_amount_kind(kind: &str) -> Option<AmountKind> {
    match kind {
        "exact" => Some(AmountKind::Exact),
        "min" => Some(AmountKind::Min),
        "max" => Some(AmountKind::Max),
        "unlimited" => Some(AmountKind::Unlimited),
        "estimated" => Some(AmountKind::Estimated),
        "unknown" => Some(AmountKind::Unknown),
        "portion" => Some(AmountKind::Portion),
        _ => None,
    }
}

fn read_address(tree: &serde_json::Value, field: &str) -> Result<Address, MapperError> {
    let raw = required_string(tree, field).map_err(|_| missing_field("$", field))?;
    Address::from_str(raw).map_err(|message| {
        MapperError::Internal(anyhow::anyhow!("{field} {raw:?}: {message}"))
    })
}

fn read_validity(tree: &serde_json::Value) -> Result<Option<Validity>, MapperError> {
    let Some(validity) = tree.get("validity") else {
        return Ok(None);
    };
    let object = validity.as_object().ok_or_else(|| {
        MapperError::Internal(anyhow::anyhow!(
            "validity must be an object, got {validity}"
        ))
    })?;
    let expires_at_str =
        required_string(validity, "expiresAt").map_err(|_| missing_field("validity", "expiresAt"))?;
    let expires_at = DecimalString::from_str(expires_at_str).map_err(|message| {
        MapperError::Internal(anyhow::anyhow!(
            "validity.expiresAt {expires_at_str:?}: {message}"
        ))
    })?;
    let source_str =
        required_string(validity, "source").map_err(|_| missing_field("validity", "source"))?;
    let source = parse_validity_source(source_str).ok_or_else(|| {
        MapperError::Internal(anyhow::anyhow!(
            "validity.source {source_str:?} not recognised in Phase 1A"
        ))
    })?;
    let _ = object; // suppress unused warning if validators expand
    Ok(Some(Validity { expires_at, source }))
}

fn parse_validity_source(source: &str) -> Option<ValiditySource> {
    match source {
        "tx-deadline" => Some(ValiditySource::TxDeadline),
        "signature-deadline" => Some(ValiditySource::SignatureDeadline),
        "grant-expiration" => Some(ValiditySource::GrantExpiration),
        _ => None,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSON helpers
// ───────────────────────────────────────────────────────────────────────────

fn required_object<'a>(
    tree: &'a serde_json::Value,
    field: &str,
) -> Result<&'a serde_json::Value, MapperError> {
    let value = tree
        .get(field)
        .ok_or_else(|| MapperError::MissingArgument(field.to_owned()))?;
    if !value.is_object() {
        return Err(MapperError::Internal(anyhow::anyhow!(
            "{field}: expected object, got {value}"
        )));
    }
    Ok(value)
}

fn required_string<'a>(
    tree: &'a serde_json::Value,
    field: &str,
) -> Result<&'a str, MapperError> {
    tree.get(field)
        .and_then(|v| v.as_str())
        .ok_or_else(|| MapperError::MissingArgument(field.to_owned()))
}

fn missing_field(parent: &str, field: &str) -> MapperError {
    MapperError::MissingArgument(format!("{parent}.{field}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_nested_builds_dot_path_tree() {
        let mut root = serde_json::Value::Object(serde_json::Map::new());
        set_nested(&mut root, "a.b.c", json!(1)).unwrap();
        set_nested(&mut root, "a.b.d", json!(2)).unwrap();
        set_nested(&mut root, "a.e", json!(3)).unwrap();
        assert_eq!(
            root,
            json!({
                "a": {
                    "b": { "c": 1, "d": 2 },
                    "e": 3
                }
            })
        );
    }

    #[test]
    fn set_nested_rejects_empty_segment() {
        let mut root = serde_json::Value::Object(serde_json::Map::new());
        let err = set_nested(&mut root, "a..c", json!(1)).unwrap_err();
        assert!(err.to_string().contains("empty segment"));
    }
}
