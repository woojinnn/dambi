//! Shared `#[cfg(test)]` helpers for action serde roundtrip tests.
//!
//! The four JSON-fixture-driven categories (lending, misc, staking,
//! restaking) all need the same building blocks for tests: a generic
//! `assert_json_roundtrip`, deterministic `address`/`hex32` generators, and
//! the same minimal asset / amount / native shapes. Pull them here so each
//! `<category>/mod.rs` only carries its own category-specific helpers
//! (e.g. lending's `market`, restaking's `strategy`).
//!
//! The DEX category builds typed Rust values directly rather than JSON
//! fixtures, so it has its own helpers in `dex/mod.rs::test_support` and
//! does not consume this module.

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::fmt::Debug;

#[allow(clippy::needless_pass_by_value)]
pub(crate) fn assert_json_roundtrip<T>(fixture: Value)
where
    T: Serialize + DeserializeOwned + PartialEq + Debug,
{
    let action = serde_json::from_value::<T>(fixture.clone()).unwrap();
    let serialized = serde_json::to_value(action).unwrap();
    assert_eq!(serialized, fixture);
}

pub(crate) fn address(value: u8) -> String {
    format!("0x{value:040x}")
}

pub(crate) fn hex32(value: u8) -> String {
    format!("0x{}", format!("{value:02x}").repeat(32))
}

pub(crate) fn native(symbol: &str) -> Value {
    json!({
        "kind": "native",
        "symbol": symbol,
        "decimals": 18
    })
}

pub(crate) fn erc20(symbol: &str) -> Value {
    json!({
        "kind": "erc20",
        "address": address(0x10),
        "symbol": symbol,
        "decimals": 18
    })
}

pub(crate) fn erc721(symbol: &str) -> Value {
    json!({
        "kind": "erc721",
        "address": address(0x11),
        "tokenId": "1",
        "symbol": symbol
    })
}

pub(crate) fn amount(kind: &str, value: &str) -> Value {
    json!({ "kind": kind, "value": value })
}
