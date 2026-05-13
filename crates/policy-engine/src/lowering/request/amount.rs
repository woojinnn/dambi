//! Shared Cedar JSON serialization for amount-shaped context fields.

use crate::context_keys::{
    AS_OF_TS, EXTN_ARG, EXTN_DECIMAL, EXTN_FN, EXTN_KEY, SOURCES, STALE_SEC, VALUE,
};
use crate::core::UsdValuation;
use serde_json::{Map, Value};

pub(super) fn decimal_json(value: &str) -> Value {
    let mut extension = Map::new();
    extension.insert(EXTN_FN.into(), Value::from(EXTN_DECIMAL));
    extension.insert(EXTN_ARG.into(), Value::from(value));

    let mut out = Map::new();
    out.insert(EXTN_KEY.into(), Value::Object(extension));
    Value::Object(out)
}

pub(super) fn usd_valuation_json(valuation: &UsdValuation) -> Value {
    let mut out = Map::new();
    out.insert(VALUE.into(), decimal_json(&valuation.value));
    out.insert(
        AS_OF_TS.into(),
        Value::from(cedar_long_u64(valuation.as_of_ts)),
    );
    out.insert(
        STALE_SEC.into(),
        Value::from(cedar_long_u64(valuation.stale_sec)),
    );
    out.insert(
        SOURCES.into(),
        Value::Array(
            valuation
                .sources
                .iter()
                .map(|source| Value::from(source.as_str()))
                .collect(),
        ),
    );
    Value::Object(out)
}

fn cedar_long_u64(value: u64) -> i64 {
    let narrowed = i64::try_from(value).unwrap_or(i64::MAX);
    debug_assert!(
        i64::try_from(value).is_ok() || cfg!(test),
        "cedar Long narrowing clamped u64 value {value} to i64::MAX"
    );
    narrowed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decimal_json_uses_cedar_extension_keys() {
        assert_eq!(
            decimal_json("12.34"),
            json!({ "__extn": { "fn": "decimal", "arg": "12.34" } })
        );
    }
}
