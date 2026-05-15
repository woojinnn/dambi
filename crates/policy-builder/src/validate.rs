//! Rule validation against an action schema.
//!
//! Runs before [`crate::generator::compile`] to surface user errors with
//! field-level paths intact, rather than letting them turn into low-level
//! emit failures further down.

use crate::operators;
use crate::types::{ActionSchema, PolicyRule, PredicateValue};
use thiserror::Error;

/// Validation failure modes. Each variant identifies which predicate index
/// and which field/op was at fault so a UI can highlight the offending row.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    /// Rule referenced an action no registered schema describes.
    #[error("unknown action: {0}")]
    UnknownAction(String),
    /// Rule's `id` is empty — required for policy identification.
    #[error("rule id must not be empty")]
    EmptyId,
    /// Predicate referenced a field path absent from the schema.
    #[error("predicate {index}: unknown field path: {field}")]
    UnknownField {
        /// Position in `rule.predicates`.
        index: usize,
        /// The bad path.
        field: String,
    },
    /// Operator id isn't defined for the field's Cedar type.
    #[error("predicate {index}: operator {op} not valid for field {field}")]
    UnknownOperator {
        /// Position in `rule.predicates`.
        index: usize,
        /// The bad operator id.
        op: String,
        /// Field path the operator was applied to.
        field: String,
    },
    /// Value shape didn't match the operator's arity (e.g. `Single` for `containsAny`).
    #[error("predicate {index}: operator {op} expects {expected}, got {got}")]
    ArityMismatch {
        /// Position in `rule.predicates`.
        index: usize,
        /// Operator id.
        op: String,
        /// Expected arity description.
        expected: &'static str,
        /// Actual arity description.
        got: &'static str,
    },
    /// `Multi` value list was empty for an operator that needs ≥1 operand.
    #[error("predicate {index}: operator {op} requires a non-empty list of operands")]
    EmptyOperandList {
        /// Position in `rule.predicates`.
        index: usize,
        /// Operator id.
        op: String,
    },
}

/// Verify `rule` is internally consistent with `schema`.
///
/// Does not emit Cedar text — that's [`crate::generator::compile`]'s job.
///
/// # Errors
///
/// Returns the first [`ValidationError`] encountered. Validation is single-pass
/// and short-circuits.
pub fn validate(rule: &PolicyRule, schema: &ActionSchema) -> Result<(), ValidationError> {
    if rule.id.trim().is_empty() {
        return Err(ValidationError::EmptyId);
    }
    if rule.action != schema.action {
        return Err(ValidationError::UnknownAction(rule.action.clone()));
    }

    for (index, predicate) in rule.predicates.iter().enumerate() {
        let field_spec =
            schema
                .fields
                .get(&predicate.field)
                .ok_or_else(|| ValidationError::UnknownField {
                    index,
                    field: predicate.field.clone(),
                })?;

        let op = operators::find(field_spec.cedar_type, &predicate.op).ok_or_else(|| {
            ValidationError::UnknownOperator {
                index,
                op: predicate.op.clone(),
                field: predicate.field.clone(),
            }
        })?;

        // Cheap arity check up-front so we don't fall through to escape-level
        // errors with vague messages.
        let got = value_shape(&predicate.value);
        let arity_ok = matches!(
            (op.arity, &predicate.value),
            (operators::OperatorArity::One, PredicateValue::Single(_))
                | (operators::OperatorArity::Many, PredicateValue::Multi(_))
                | (operators::OperatorArity::None, PredicateValue::None)
        );
        if !arity_ok {
            return Err(ValidationError::ArityMismatch {
                index,
                op: predicate.op.clone(),
                expected: arity_label(op.arity),
                got,
            });
        }

        if let PredicateValue::Multi(values) = &predicate.value {
            if values.is_empty() {
                return Err(ValidationError::EmptyOperandList {
                    index,
                    op: predicate.op.clone(),
                });
            }
        }
    }

    Ok(())
}

const fn value_shape(value: &PredicateValue) -> &'static str {
    match value {
        PredicateValue::Single(_) => "single",
        PredicateValue::Multi(_) => "multi",
        PredicateValue::None => "none",
    }
}

const fn arity_label(arity: operators::OperatorArity) -> &'static str {
    match arity {
        operators::OperatorArity::One => "single",
        operators::OperatorArity::Many => "multi",
        operators::OperatorArity::None => "none",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schemas::swap;
    use crate::types::{Predicate, Severity};

    fn base_rule(predicates: Vec<Predicate>) -> PolicyRule {
        PolicyRule {
            id: "test/rule".into(),
            action: "swap".into(),
            severity: Severity::Deny,
            reason: "test".into(),
            predicates,
        }
    }

    #[test]
    fn valid_long_predicate_passes() {
        let schema = swap::schema();
        let rule = base_rule(vec![Predicate {
            field: "feeBps".into(),
            op: "gt".into(),
            value: PredicateValue::Single("100".into()),
        }]);
        assert!(validate(&rule, &schema).is_ok());
    }

    #[test]
    fn empty_id_rejected() {
        let schema = swap::schema();
        let mut rule = base_rule(vec![]);
        rule.id = String::new();
        assert_eq!(validate(&rule, &schema), Err(ValidationError::EmptyId));
    }

    #[test]
    fn action_mismatch_rejected() {
        let schema = swap::schema();
        let mut rule = base_rule(vec![]);
        rule.action = "approve".into();
        assert!(matches!(
            validate(&rule, &schema),
            Err(ValidationError::UnknownAction(_))
        ));
    }

    #[test]
    fn unknown_field_rejected() {
        let schema = swap::schema();
        let rule = base_rule(vec![Predicate {
            field: "nonexistent".into(),
            op: "gt".into(),
            value: PredicateValue::Single("1".into()),
        }]);
        assert!(matches!(
            validate(&rule, &schema),
            Err(ValidationError::UnknownField { .. })
        ));
    }

    #[test]
    fn wrong_operator_for_type_rejected() {
        let schema = swap::schema();
        let rule = base_rule(vec![Predicate {
            field: "swapMode".into(), // String — `gt` not valid
            op: "gt".into(),
            value: PredicateValue::Single("x".into()),
        }]);
        assert!(matches!(
            validate(&rule, &schema),
            Err(ValidationError::UnknownOperator { .. })
        ));
    }

    #[test]
    fn arity_mismatch_rejected() {
        let schema = swap::schema();
        let rule = base_rule(vec![Predicate {
            field: "feeBps".into(),
            op: "gt".into(),
            value: PredicateValue::Multi(vec!["1".into()]),
        }]);
        assert!(matches!(
            validate(&rule, &schema),
            Err(ValidationError::ArityMismatch { .. })
        ));
    }

    #[test]
    fn empty_multi_operand_rejected() {
        let schema = swap::schema();
        let rule = base_rule(vec![Predicate {
            field: "totalInputUsd.sources".into(),
            op: "containsAny".into(),
            value: PredicateValue::Multi(vec![]),
        }]);
        assert!(matches!(
            validate(&rule, &schema),
            Err(ValidationError::EmptyOperandList { .. })
        ));
    }
}
