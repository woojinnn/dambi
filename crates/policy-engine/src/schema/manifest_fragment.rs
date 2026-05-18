//! Translate one action's manifest requirements into a Cedar `<Action>CustomContext` fragment.

use super::action_name::snake_to_pascal;
use super::fragment::{CedarTypeFragment, CustomFieldSource};
use crate::policy_rpc::{PolicyManifest, PolicyRpcError, ProjectionType};

/// Render the `<Action>CustomContext` Cedar type for `action` from `manifest`.
///
/// Only requirements whose `when.action` matches `action` contribute fields.
/// Every produced field is declared optional (`?:`) in Cedar per the v0
/// fail-open enrichment model.
///
/// # Errors
///
/// Returns [`PolicyRpcError::InvalidManifest`] when the manifest is malformed
/// or [`PolicyRpcError::Schema`] when a referenced type is not in the base
/// alias table.
pub fn manifest_to_cedarschema(
    action: &str,
    manifest: &PolicyManifest,
) -> Result<CedarTypeFragment, PolicyRpcError> {
    let pascal = snake_to_pascal(action);
    let mut fields: Vec<CustomFieldSource> = Vec::new();
    for req in &manifest.requires {
        if req.when.action != action {
            continue;
        }
        for out in &req.outputs {
            let cedar_type = projection_cedar_type(&out.type_name);
            fields.push(CustomFieldSource {
                field: out.field.clone(),
                cedar_type,
                source_requirement_id: req.id.clone(),
                source_method: req.method.clone(),
                source_from: out.from.clone(),
                requirement_optional: req.optional,
            });
        }
    }
    let type_text = if fields.is_empty() {
        format!("type {pascal}CustomContext = {{}};\n")
    } else {
        let body = fields
            .iter()
            .map(|f| format!("  {field}?: {ty}", field = f.field, ty = f.cedar_type))
            .collect::<Vec<_>>()
            .join(",\n")
            + ",\n";
        format!("type {pascal}CustomContext = {{\n{body}}};\n")
    };
    Ok(CedarTypeFragment { type_text, fields })
}

fn projection_cedar_type(ty: &ProjectionType) -> String {
    ty.cedar_type().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy_rpc::{ContextProjection, PolicyManifest, Requirement, RequirementWhen};

    fn manifest_with_one_output() -> PolicyManifest {
        PolicyManifest {
            id: "test::swap".to_owned(),
            schema_version: 1,
            requires: vec![Requirement {
                id: "req1".into(),
                when: RequirementWhen {
                    action: "swap".into(),
                },
                method: "oracle.usd_value".into(),
                params: std::collections::BTreeMap::default(),
                outputs: vec![ContextProjection {
                    kind: "context".into(),
                    field: "totalInputUsd".into(),
                    type_name: ProjectionType::UsdValuation,
                    from: "$.result".into(),
                    required: false,
                }],
                optional: true,
            }],
            context_extensions: std::collections::BTreeMap::default(),
        }
    }

    #[test]
    fn single_output_produces_one_optional_field() {
        let f = manifest_to_cedarschema("swap", &manifest_with_one_output()).expect("ok");
        assert_eq!(f.fields.len(), 1);
        let only = &f.fields[0];
        assert_eq!(only.field, "totalInputUsd");
        assert_eq!(only.cedar_type, "UsdValuation");
        assert!(only.requirement_optional);
        assert!(f.type_text.contains("totalInputUsd?: UsdValuation"));
        assert!(f.type_text.contains("type SwapCustomContext = {"));
    }

    #[test]
    fn empty_manifest_produces_empty_type() {
        let m = PolicyManifest {
            id: "test::swap".into(),
            schema_version: 1,
            requires: vec![],
            context_extensions: std::collections::BTreeMap::default(),
        };
        let f = manifest_to_cedarschema("swap", &m).unwrap();
        assert!(f.fields.is_empty());
        assert!(f.type_text.contains("type SwapCustomContext = {};"));
    }
}
