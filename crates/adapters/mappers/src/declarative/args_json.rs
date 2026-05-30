//! v1-free JSON view of decoded calldata args.
//!
//! Extracted from the (deleted) v1 `eval.rs` so the v3 declarative route
//! (`policy-engine-wasm::declarative_exports::declarative_route_request_v3_json`)
//! can keep using `args_to_json` / `decoded_value_to_json` without dragging in
//! the v1 `Mapper` / `MapContext` machinery.
//!
//! These helpers depend only on `abi_resolver` (the decoded-value model),
//! `alloy_primitives`, `hex`, and `serde_json` — no `crate::mapper`.

use abi_resolver::{DecodedCall, DecodedValue};
use alloy_primitives::{I256, U256};

/// Convert a single [`DecodedValue`] into a `serde_json::Value` view.
///
/// Encoding rules:
///   * `Address` → JSON string `"0x.."` (lowercased by `Address::to_string`).
///   * `Uint` / `Int` → JSON string of the base-10 representation. This keeps
///     `uint256` values lossless (JS numbers lose precision beyond 2^53), and
///     matches how `DecimalString` parses.
///   * `Bool` → JSON boolean.
///   * `Bytes` → JSON string `"0x.." + hex`.
///   * `String` → JSON string.
///   * `Array` / `Tuple` → JSON array of recursively-encoded values.
pub fn decoded_value_to_json(value: &DecodedValue) -> serde_json::Value {
    match value {
        DecodedValue::Address(address) => serde_json::Value::String(address.to_string()),
        DecodedValue::Uint(value) => serde_json::Value::String(u256_to_decimal_string(*value)),
        DecodedValue::Int(value) => serde_json::Value::String(i256_to_decimal_string(*value)),
        DecodedValue::Bool(value) => serde_json::Value::Bool(*value),
        DecodedValue::Bytes(bytes) => {
            serde_json::Value::String(format!("0x{}", hex::encode(bytes)))
        }
        DecodedValue::String(string) => serde_json::Value::String(string.clone()),
        DecodedValue::Array(values) | DecodedValue::Tuple(values) => {
            serde_json::Value::Array(values.iter().map(decoded_value_to_json).collect())
        }
    }
}

fn u256_to_decimal_string(value: U256) -> String {
    value.to_string()
}

fn i256_to_decimal_string(value: I256) -> String {
    value.to_string()
}

/// Build the `args` map used by JsonPath evaluation.
///
/// Each [`abi_resolver::DecodedArg`] becomes one key in a JSON object, indexed
/// by argument name. This shape matches `$.args.<name>` selectors in the
/// bundle's `ValueExpr` entries.
#[must_use]
pub fn args_to_json(decoded: &DecodedCall) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    for arg in &decoded.args {
        obj.insert(arg.name.clone(), decoded_value_to_json(&arg.value));
    }
    serde_json::Value::Object(obj)
}

#[cfg(test)]
mod tests {
    use super::*;
    use abi_resolver::{DecodedArg, DecoderId};

    fn sample_decoded() -> DecodedCall {
        DecodedCall {
            decoder_id: DecoderId::new("test"),
            function_signature: "fn(uint256,bytes,bool)".into(),
            args: vec![
                DecodedArg {
                    name: "amountIn".into(),
                    abi_type: "uint256".into(),
                    value: DecodedValue::Uint(U256::from(1_000_u64)),
                },
                DecodedArg {
                    name: "path".into(),
                    abi_type: "bytes".into(),
                    value: DecodedValue::Bytes(vec![0xab, 0xcd]),
                },
                DecodedArg {
                    name: "flag".into(),
                    abi_type: "bool".into(),
                    value: DecodedValue::Bool(true),
                },
            ],
            nested: vec![],
        }
    }

    #[test]
    fn args_to_json_indexes_by_name() {
        let json = args_to_json(&sample_decoded());
        assert_eq!(json["amountIn"], serde_json::json!("1000"));
        assert_eq!(json["path"], serde_json::json!("0xabcd"));
        assert_eq!(json["flag"], serde_json::json!(true));
    }

    #[test]
    fn decoded_value_uint_is_decimal_string() {
        assert_eq!(
            decoded_value_to_json(&DecodedValue::Uint(U256::from(42_u64))),
            serde_json::json!("42")
        );
    }

    #[test]
    fn decoded_value_array_recurses() {
        let arr = DecodedValue::Array(vec![
            DecodedValue::Uint(U256::from(1_u64)),
            DecodedValue::Uint(U256::from(2_u64)),
        ]);
        assert_eq!(decoded_value_to_json(&arr), serde_json::json!(["1", "2"]));
    }
}
