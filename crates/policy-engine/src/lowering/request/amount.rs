//! Shared Cedar JSON serialization for amount-shaped context fields.

use crate::core::{Token, UsdValuation};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
struct DecimalValue<'a> {
    #[serde(rename = "__extn")]
    extn: DecimalExtn<'a>,
}

#[derive(Serialize)]
struct DecimalExtn<'a> {
    #[serde(rename = "fn")]
    function: &'static str,
    arg: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenContext<'a> {
    chain_id: i64,
    address: &'a str,
    symbol: &'a str,
    decimals: i64,
    is_native: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsdValuationContext<'a> {
    value: DecimalValue<'a>,
    as_of_ts: i64,
    stale_sec: i64,
    sources: &'a [String],
}

pub(crate) fn decimal_json(value: &str) -> Value {
    serde_json::to_value(decimal_value(value)).expect("decimal context serializes")
}

pub(crate) fn token_json(token: &Token) -> Value {
    serde_json::to_value(TokenContext {
        chain_id: token.chain_id as i64,
        address: token.address.as_str(),
        symbol: &token.symbol,
        decimals: token.decimals as i64,
        is_native: token.is_native,
    })
    .expect("token context serializes")
}

pub(crate) fn usd_valuation_json(valuation: &UsdValuation) -> Value {
    serde_json::to_value(UsdValuationContext {
        value: decimal_value(&valuation.value),
        as_of_ts: valuation.as_of_ts as i64,
        stale_sec: valuation.stale_sec as i64,
        sources: &valuation.sources,
    })
    .expect("usd valuation context serializes")
}

fn decimal_value(value: &str) -> DecimalValue<'_> {
    DecimalValue {
        extn: DecimalExtn {
            function: "decimal",
            arg: value,
        },
    }
}
