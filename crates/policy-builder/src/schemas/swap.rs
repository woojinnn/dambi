//! `swap` action schema.
//!
//! Mirrors the `SwapContext` declared in `policy-schema/actions/DEX/swap.cedarschema`.
//! Composite record fields (`tokenIn`, `tokenOut`, `amountIn`, `amountOut`,
//! `totalInputUsd`, `validity`, `windowStats`) are flattened into dotted
//! leaf paths so each addressable comparison gets its own [`FieldSpec`].
//!
//! Cedar can access record fields directly (`context.tokenIn.address ==
//! "0x…"`), so the parallel-set approach earlier exploration considered is
//! no longer needed: a Token is a single record, not a `Set<Token>`.

use crate::types::{ActionSchema, CedarType, FieldSpec};
use std::collections::BTreeMap;

/// Build the `swap` schema. Called once by [`crate::schemas::registry`].
///
/// The body is a sequence of straight-line `insert` calls — one per leaf
/// field — so it grows linearly with the schema. Splitting into helper
/// functions would obscure the field-to-spec mapping without buying anything.
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn schema() -> ActionSchema {
    let mut fields = BTreeMap::new();

    // ── required top-level leaves ─────────────────────────────────────────
    insert(
        &mut fields,
        FieldSpec {
            path: "swapMode".into(),
            cedar_type: CedarType::String,
            optional: false,
            parent_path: None,
            parent_optional: false,
            label: Some("Swap mode".into()),
        },
    );
    insert(
        &mut fields,
        FieldSpec {
            path: "recipient".into(),
            cedar_type: CedarType::String,
            optional: false,
            parent_path: None,
            parent_optional: false,
            label: Some("Recipient address".into()),
        },
    );

    // ── tokenIn / tokenOut (required AssetRef records) ────────────────────
    // AssetRef matches the runtime lowering shape declared in
    // core.cedarschema: `{chainId, address, symbol, decimals, isNative}`.
    // All leaves are required; the parent record is required too, so no
    // `has` guards are emitted for these.
    for (parent, parent_label) in [
        ("tokenIn", "Input token"),
        ("tokenOut", "Output token"),
    ] {
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.chainId"),
                cedar_type: CedarType::Long,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} chain id")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.address"),
                cedar_type: CedarType::String,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} address")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.symbol"),
                cedar_type: CedarType::String,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} symbol")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.decimals"),
                cedar_type: CedarType::Long,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} decimals")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.isNative"),
                cedar_type: CedarType::Bool,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} is native asset")),
            },
        );
    }

    // ── amountIn / amountOut (required AmountConstraint records) ──────────
    // AmountConstraint has required leaf `kind` and optional leaf `value`.
    for (parent, parent_label) in [
        ("amountIn", "Amount-in"),
        ("amountOut", "Amount-out"),
    ] {
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.kind"),
                cedar_type: CedarType::String,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} kind")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.value"),
                cedar_type: CedarType::String,
                optional: true,
                parent_path: Some(parent.into()),
                parent_optional: false,
                label: Some(format!("{parent_label} value")),
            },
        );
    }

    // ── optional Long top-level leaves ────────────────────────────────────
    // Fields tracked by the bundled `policy-schema/actions/swap.cedarschema`.
    // Aspirational fields living under `policy-schema/actions/DEX/` are not
    // yet wired into the schema composer; surfacing them here would let
    // users author rules that fail validation at install time.
    for (path, label) in [
        ("feeBps", "Fee (bps)"),
        ("validityDeltaSec", "Validity delta (sec)"),
    ] {
        insert(
            &mut fields,
            FieldSpec {
                path: path.into(),
                cedar_type: CedarType::Long,
                optional: true,
                parent_path: None,
                parent_optional: false,
                label: Some(label.into()),
            },
        );
    }

    // ── optional Bool top-level leaf ──────────────────────────────────────
    insert(
        &mut fields,
        FieldSpec {
            path: "allowancesCoverInputs".into(),
            cedar_type: CedarType::Bool,
            optional: true,
            parent_path: None,
            parent_optional: false,
            label: Some("Allowances cover inputs".into()),
        },
    );

    // ── validity (optional Validity record, required inner leaves) ────────
    insert(
        &mut fields,
        FieldSpec {
            path: "validity.expiresAt".into(),
            cedar_type: CedarType::String,
            optional: false,
            parent_path: Some("validity".into()),
            parent_optional: true,
            label: Some("Expires at".into()),
        },
    );
    insert(
        &mut fields,
        FieldSpec {
            path: "validity.source".into(),
            cedar_type: CedarType::String,
            optional: false,
            parent_path: Some("validity".into()),
            parent_optional: true,
            label: Some("Validity source".into()),
        },
    );

    // ── USD valuations (optional record, four required inner leaves) ──────
    // UsdValuation is declared in core.cedarschema with required leaves
    // `value`, `asOfTs`, `staleSec`, `sources`. Each is addressable
    // independently once the parent `has` guard fires.
    for (parent, parent_label) in [
        ("totalInputUsd", "Total input USD"),
        ("totalMinOutputUsd", "Total min-output USD"),
    ] {
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.value"),
                cedar_type: CedarType::Decimal,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: true,
                label: Some(parent_label.into()),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.staleSec"),
                cedar_type: CedarType::Long,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: true,
                label: Some(format!("{parent_label} staleness (sec)")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.asOfTs"),
                cedar_type: CedarType::Long,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: true,
                label: Some(format!("{parent_label} oracle timestamp")),
            },
        );
        insert(
            &mut fields,
            FieldSpec {
                path: format!("{parent}.sources"),
                cedar_type: CedarType::SetOfString,
                optional: false,
                parent_path: Some(parent.into()),
                parent_optional: true,
                label: Some(format!("{parent_label} oracle sources")),
            },
        );
    }

    ActionSchema {
        action: "swap".into(),
        principal_type: "Wallet".into(),
        resource_type: "Protocol".into(),
        fields,
    }
}

fn insert(map: &mut BTreeMap<String, FieldSpec>, spec: FieldSpec) {
    map.insert(spec.path.clone(), spec);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_includes_required_and_nested_fields() {
        let s = schema();
        assert_eq!(s.action, "swap");
        assert!(s.fields.contains_key("swapMode"));
        assert!(s.fields.contains_key("tokenIn.address"));
        assert!(s.fields.contains_key("tokenIn.symbol"));
        assert!(s.fields.contains_key("amountIn.value"));
        assert!(s.fields.contains_key("totalInputUsd.value"));
        assert!(s.fields.contains_key("allowancesCoverInputs"));
    }

    #[test]
    fn token_field_has_required_parent_no_guard() {
        let s = schema();
        let f = s.fields.get("tokenIn.address").unwrap();
        assert_eq!(f.parent_path.as_deref(), Some("tokenIn"));
        assert!(!f.parent_optional);
    }

    #[test]
    fn token_fields_carry_required_parent() {
        let s = schema();
        let f = s.fields.get("tokenIn.isNative").unwrap();
        assert!(!f.optional);
        assert!(!f.parent_optional);
        assert_eq!(f.parent_path.as_deref(), Some("tokenIn"));
    }

    #[test]
    fn usd_valuation_parent_is_optional() {
        let s = schema();
        let f = s.fields.get("totalInputUsd.value").unwrap();
        assert_eq!(f.parent_path.as_deref(), Some("totalInputUsd"));
        assert!(f.parent_optional);
    }
}
