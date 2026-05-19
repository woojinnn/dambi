//! `swap` action schema.
//!
//! Mirrors the v1 `SwapContext` declared in
//! `schema/policy-schema/actions/DEX/swap.cedarschema` plus the manifest-driven
//! `SwapCustomContext` extension shape exemplified by
//! `schema/policy-schema/extensions/DEX/swap.policy-rpc.json`.
//!
//! Composite record fields (`inputToken`, `outputToken`, `totalInputUsd`,
//! `validity`, `windowStats`) are flattened into dotted leaf paths so each
//! addressable comparison gets its own [`FieldSpec`].
//!
//! Each field is tagged `is_custom = true` when it is manifest-enriched and
//! lives under `context.custom`, and `false` when it is calldata-derived and
//! lives directly under `context`. The generator and parser key off this flag.
//!
//! `allowed_values` is **not declared inline here** — it is sourced at build
//! time from the upstream action-schema JSON via [`super::generated`]. The
//! `enum_for` helper below does the lookup so a JSON edit (e.g. adding a new
//! swap mode) flows into this schema on the next `cargo build` with no
//! hand-editing. Fields without a JSON enum get `None` automatically.
//!
//! `scale` is set on the token-native amount fields (`inputAmountNano`,
//! `outputAmountNano`) so the policy builder accepts user input in the
//! "0.5 ETH"/"100 USDC" form a DEX UI shows and emits the matching Long
//! literal (`500000000` / `100000000000`). The manifest enrichment is
//! responsible for pre-multiplying the raw on-chain amount by
//! `10^(9 - decimals)` before the engine sees it, so the same policy applies
//! identically to any token regardless of its decimals.

use super::generated::action_field_enum;
use crate::types::{ActionSchema, CedarType, FieldSpec};
use std::collections::BTreeMap;

const ACTION: &str = "swap";

/// Decimal-point exponent used by `*AmountNano` custom fields. The manifest
/// rescales raw on-chain `amount.value` by `10^(9 - decimals)` so the
/// resulting Long is in the same Gwei-style unit regardless of the token's
/// own decimals. Matched here so policy builder literal rendering uses the
/// same shift.
const AMOUNT_NANO_SCALE: u8 = 9;

/// Look up the build-time-generated enum list for a path under this action.
/// Returns `None` for free-form fields (no JSON enum constraint), matching
/// the `FieldSpec::allowed_values` semantics.
fn enum_for(path: &str) -> Option<Vec<String>> {
    action_field_enum(ACTION, path).map(|s| s.iter().map(|v| (*v).to_string()).collect())
}

/// Build the `swap` schema. Called once by [`crate::schemas::registry`].
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn schema() -> ActionSchema {
    let mut fields = BTreeMap::new();

    // ─── BASE FIELDS (calldata-derived, addressed as `context.<path>`) ────

    // Required top-level leaves.
    insert(
        &mut fields,
        FieldSpec {
            path: "swapMode".into(),
            cedar_type: CedarType::String,
            optional: false,
            parent_path: None,
            parent_optional: false,
            label: Some("Swap mode".into()),
            is_custom: false,
            allowed_values: enum_for("swapMode"),
            scale: None,
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
            is_custom: false,
            allowed_values: None,
            scale: None,
        },
    );

    // inputToken / outputToken (required AssetRefWithAmountConstraint).
    for (parent, parent_label) in [
        ("inputToken", "Input token"),
        ("outputToken", "Output token"),
    ] {
        insert_asset_with_amount(&mut fields, parent, parent_label);
    }

    // feeBps (optional Long, base — declared inline in SwapContext).
    insert(
        &mut fields,
        FieldSpec {
            path: "feeBps".into(),
            cedar_type: CedarType::Long,
            optional: true,
            parent_path: None,
            parent_optional: false,
            label: Some("Fee (bps)".into()),
            is_custom: false,
            allowed_values: None,
            scale: None,
        },
    );

    // validity (optional Validity record, required inner leaves) — base.
    insert(
        &mut fields,
        FieldSpec {
            path: "validity.expiresAt".into(),
            cedar_type: CedarType::String,
            optional: false,
            parent_path: Some("validity".into()),
            parent_optional: true,
            label: Some("Expires at".into()),
            is_custom: false,
            allowed_values: None,
            scale: None,
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
            is_custom: false,
            allowed_values: enum_for("validity.source"),
            scale: None,
        },
    );

    // ─── CUSTOM FIELDS (enrichment, addressed as `context.custom.<path>`) ─

    // Token-native normalized amount (Long with implicit 10⁻⁹ scale). The
    // manifest rescales raw on-chain amount so users write "0.5" / "100" /
    // "0.00003" — the same number they see on a DEX UI — regardless of the
    // token's decimals.
    for (path, label) in [
        ("inputAmountNano", "Input amount (token-native)"),
        ("outputAmountNano", "Output amount (token-native)"),
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
                is_custom: true,
                allowed_values: None,
                scale: Some(AMOUNT_NANO_SCALE),
            },
        );
    }

    // Optional Long enrichment leaves (top-level under SwapCustomContext).
    for (path, label) in [
        ("effectiveRateVsOracleBps", "Effective rate vs oracle (bps)"),
        (
            "totalInputFractionOfPortfolioBps",
            "Input fraction of portfolio (bps)",
        ),
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
                is_custom: true,
                allowed_values: None,
                scale: None,
            },
        );
    }

    // Optional Bool enrichment leaf.
    insert(
        &mut fields,
        FieldSpec {
            path: "recipientIsContract".into(),
            cedar_type: CedarType::Bool,
            optional: true,
            parent_path: None,
            parent_optional: false,
            label: Some("Recipient is contract".into()),
            is_custom: true,
            allowed_values: None,
            scale: None,
        },
    );

    // USD valuations (optional UsdValuation records, four required inner
    // leaves each). UsdValuation is declared in core.cedarschema with required
    // leaves `value`, `asOfTs`, `staleSec`, `sources`. Each is addressable
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
                is_custom: true,
                allowed_values: None,
                scale: None,
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
                is_custom: true,
                allowed_values: None,
                scale: None,
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
                is_custom: true,
                allowed_values: None,
                scale: None,
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
                is_custom: true,
                allowed_values: None,
                scale: None,
            },
        );
    }

    // windowStats (optional WindowStats record, optional inner leaves).
    insert(
        &mut fields,
        FieldSpec {
            path: "windowStats.swapVolumeUsd24h".into(),
            cedar_type: CedarType::Decimal,
            optional: true,
            parent_path: Some("windowStats".into()),
            parent_optional: true,
            label: Some("24h swap volume USD".into()),
            is_custom: true,
            allowed_values: None,
            scale: None,
        },
    );
    insert(
        &mut fields,
        FieldSpec {
            path: "windowStats.swapCount24h".into(),
            cedar_type: CedarType::Long,
            optional: true,
            parent_path: Some("windowStats".into()),
            parent_optional: true,
            label: Some("24h swap count".into()),
            is_custom: true,
            allowed_values: None,
            scale: None,
        },
    );

    ActionSchema {
        action: "swap".into(),
        principal_type: "Wallet".into(),
        resource_type: "Protocol".into(),
        fields,
    }
}

fn insert_asset_with_amount(
    map: &mut BTreeMap<String, FieldSpec>,
    parent: &str,
    parent_label: &str,
) {
    let asset_parent = format!("{parent}.asset");
    for (leaf, cedar_type, optional, label) in [
        ("kind", CedarType::String, false, "asset kind"),
        ("address", CedarType::String, false, "asset address"),
        ("tokenId", CedarType::String, true, "asset token id"),
        ("symbol", CedarType::String, false, "asset symbol"),
        ("decimals", CedarType::Long, false, "asset decimals"),
    ] {
        let path = format!("{asset_parent}.{leaf}");
        let allowed_values = enum_for(&path);
        insert(
            map,
            FieldSpec {
                path,
                cedar_type,
                optional,
                parent_path: Some(asset_parent.clone()),
                parent_optional: false,
                label: Some(format!("{parent_label} {label}")),
                is_custom: false,
                allowed_values,
                scale: None,
            },
        );
    }

    let amount_parent = format!("{parent}.amount");
    let amount_kind_path = format!("{amount_parent}.kind");
    let amount_kind_enum = enum_for(&amount_kind_path);
    insert(
        map,
        FieldSpec {
            path: amount_kind_path,
            cedar_type: CedarType::String,
            optional: false,
            parent_path: Some(amount_parent.clone()),
            parent_optional: false,
            label: Some(format!("{parent_label} amount kind")),
            is_custom: false,
            allowed_values: amount_kind_enum,
            scale: None,
        },
    );
    insert(
        map,
        FieldSpec {
            path: format!("{amount_parent}.value"),
            cedar_type: CedarType::String,
            optional: true,
            parent_path: Some(amount_parent),
            parent_optional: false,
            label: Some(format!("{parent_label} amount value")),
            is_custom: false,
            allowed_values: None,
            scale: None,
        },
    );
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
        assert!(s.fields.contains_key("inputToken.asset.address"));
        assert!(s.fields.contains_key("inputToken.asset.symbol"));
        assert!(s.fields.contains_key("inputToken.amount.value"));
        assert!(s.fields.contains_key("outputToken.asset.address"));
        assert!(s.fields.contains_key("totalInputUsd.value"));
        assert!(s.fields.contains_key("recipientIsContract"));
        assert!(s.fields.contains_key("windowStats.swapCount24h"));
    }

    #[test]
    fn token_field_has_required_parent_no_guard() {
        let s = schema();
        let f = s.fields.get("inputToken.asset.address").unwrap();
        assert_eq!(f.parent_path.as_deref(), Some("inputToken.asset"));
        assert!(!f.parent_optional);
    }

    #[test]
    fn token_fields_carry_required_parent() {
        let s = schema();
        let f = s.fields.get("inputToken.asset.decimals").unwrap();
        assert!(!f.optional);
        assert!(!f.parent_optional);
        assert_eq!(f.parent_path.as_deref(), Some("inputToken.asset"));
    }

    #[test]
    fn usd_valuation_parent_is_optional() {
        let s = schema();
        let f = s.fields.get("totalInputUsd.value").unwrap();
        assert_eq!(f.parent_path.as_deref(), Some("totalInputUsd"));
        assert!(f.parent_optional);
    }

    #[test]
    fn base_field_is_not_custom() {
        let s = schema();
        for path in [
            "swapMode",
            "recipient",
            "feeBps",
            "inputToken.asset.address",
            "outputToken.amount.value",
            "validity.expiresAt",
        ] {
            let f = s
                .fields
                .get(path)
                .unwrap_or_else(|| panic!("missing {path}"));
            assert!(!f.is_custom, "expected base (not custom) for {path}");
        }
    }

    #[test]
    fn enrichment_fields_are_custom() {
        let s = schema();
        for path in [
            "totalInputUsd.value",
            "totalInputUsd.staleSec",
            "totalInputUsd.sources",
            "totalMinOutputUsd.value",
            "validityDeltaSec",
            "effectiveRateVsOracleBps",
            "totalInputFractionOfPortfolioBps",
            "recipientIsContract",
            "windowStats.swapCount24h",
            "windowStats.swapVolumeUsd24h",
            "inputAmountNano",
            "outputAmountNano",
        ] {
            let f = s
                .fields
                .get(path)
                .unwrap_or_else(|| panic!("missing {path}"));
            assert!(f.is_custom, "expected custom for {path}");
        }
    }

    #[test]
    fn swap_mode_has_enum() {
        let s = schema();
        let f = s.fields.get("swapMode").unwrap();
        let allowed = f.allowed_values.as_ref().expect("swapMode must be enum");
        assert_eq!(
            allowed,
            &vec![
                "exact_in".to_string(),
                "exact_out".to_string(),
                "market".to_string(),
                "unknown".to_string(),
            ]
        );
    }

    #[test]
    fn asset_kind_has_enum_on_both_tokens() {
        let s = schema();
        for path in ["inputToken.asset.kind", "outputToken.asset.kind"] {
            let f = s.fields.get(path).unwrap();
            let allowed = f
                .allowed_values
                .as_ref()
                .unwrap_or_else(|| panic!("{path} must be enum"));
            assert!(allowed.contains(&"erc20".to_string()));
            assert!(allowed.contains(&"native".to_string()));
        }
    }

    #[test]
    fn amount_kind_has_enum_on_both_tokens() {
        let s = schema();
        for path in ["inputToken.amount.kind", "outputToken.amount.kind"] {
            let f = s.fields.get(path).unwrap();
            let allowed = f
                .allowed_values
                .as_ref()
                .unwrap_or_else(|| panic!("{path} must be enum"));
            assert!(allowed.contains(&"exact".to_string()));
            assert!(allowed.contains(&"unlimited".to_string()));
        }
    }

    #[test]
    fn validity_source_has_enum() {
        let s = schema();
        let f = s.fields.get("validity.source").unwrap();
        let allowed = f
            .allowed_values
            .as_ref()
            .expect("validity.source must be enum");
        assert!(allowed.contains(&"tx-deadline".to_string()));
    }

    #[test]
    fn free_form_fields_have_no_enum() {
        let s = schema();
        for path in [
            "recipient",
            "feeBps",
            "inputToken.asset.address",
            "inputToken.amount.value",
            "validity.expiresAt",
            "totalInputUsd.value",
        ] {
            let f = s.fields.get(path).unwrap();
            assert!(
                f.allowed_values.is_none(),
                "{path} should not be a closed enum"
            );
        }
    }

    #[test]
    fn nano_amount_fields_are_scaled_longs() {
        let s = schema();
        for path in ["inputAmountNano", "outputAmountNano"] {
            let f = s
                .fields
                .get(path)
                .unwrap_or_else(|| panic!("missing {path}"));
            assert!(matches!(f.cedar_type, CedarType::Long));
            assert!(f.is_custom);
            assert_eq!(f.scale, Some(AMOUNT_NANO_SCALE));
            assert!(f.optional, "manifest enrichment is optional");
        }
    }

    #[test]
    fn non_scaled_fields_have_none_scale() {
        let s = schema();
        // Spot-check a representative cross-section.
        for path in [
            "swapMode",
            "feeBps",
            "inputToken.amount.value",
            "totalInputUsd.value",
            "validityDeltaSec",
        ] {
            let f = s.fields.get(path).unwrap();
            assert!(f.scale.is_none(), "{path} should not have a scale");
        }
    }
}
