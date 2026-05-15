//! Shared Cedar JSON serialization for amount-shaped context fields.

use crate::action::{AmountConstraint, AmountKind};
use crate::context_keys::VALUE;
use serde_json::{Map, Value};

pub(crate) fn amount_constraint_json(amount: &AmountConstraint) -> Value {
    let mut out = Map::new();
    out.insert("kind".into(), Value::from(amount_kind_str(&amount.kind)));
    if let Some(value) = &amount.value {
        out.insert(VALUE.into(), Value::from(value.to_string()));
    }
    Value::Object(out)
}

pub(crate) const fn amount_kind_str(kind: &AmountKind) -> &'static str {
    match kind {
        AmountKind::Exact => "exact",
        AmountKind::Min => "min",
        AmountKind::Max => "max",
        AmountKind::Unlimited => "unlimited",
        AmountKind::Portion => "portion",
        AmountKind::Estimated => "estimated",
        AmountKind::Unknown => "unknown",
    }
}
