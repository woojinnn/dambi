//! Structural decoded representation of a single contract call.
//!
//! Mirrors the shape of `crates/adapters/abi-resolver::DecodedCall` but is
//! deliberately minimal — adapters emit this; the host translates into the
//! engine's richer `Action` types during lowering.

use crate::primitives::{Address, ChainId, Selector};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodedCall {
    pub chain_id: ChainId,
    pub target: Address,
    pub selector: Selector,
    pub function: String,
    pub args: Vec<DecodedArg>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nested: Vec<DecodedCall>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecodedArg {
    pub name: String,
    pub value: DecodedValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum DecodedValue {
    Address(Address),
    Uint(String),
    Int(String),
    Bool(bool),
    Bytes(String),
    String(String),
    Tuple(Vec<DecodedValue>),
    Array(Vec<DecodedValue>),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::primitives::Address;
    use std::str::FromStr;

    #[test]
    fn decoded_call_json_round_trip() {
        let dc = DecodedCall {
            chain_id: 1,
            target: Address::from_str("0xab5801a7d398351b8be11c439e05c5b3259aec9b").unwrap(),
            selector: Selector([0xa9, 0x05, 0x9c, 0xbb]),
            function: "transfer".into(),
            args: vec![
                DecodedArg {
                    name: "to".into(),
                    value: DecodedValue::Address(
                        Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
                    ),
                },
                DecodedArg {
                    name: "amount".into(),
                    value: DecodedValue::Uint("1000".into()),
                },
            ],
            nested: vec![],
        };
        let s = serde_json::to_string(&dc).unwrap();
        let back: DecodedCall = serde_json::from_str(&s).unwrap();
        assert_eq!(dc, back);
    }

    #[test]
    fn decoded_value_uses_snake_case_tag() {
        let v = DecodedValue::Uint("42".into());
        assert_eq!(serde_json::to_string(&v).unwrap(), r#"{"type":"uint","value":"42"}"#);
    }
}
