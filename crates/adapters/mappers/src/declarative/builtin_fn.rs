//! Built-in functions invoked by `ValueExpr::Transform`.
//!
//! Phase 1A: only `select_address` is implemented. Spec §5.3.1 ("WhitelistedFn").
//!
//! All built-ins operate over `serde_json::Value` — the interpreter normalises
//! `DecodedValue` to JSON in [`super::eval`] and then walks JSON paths /
//! invokes built-ins on the JSON view. This keeps the interpreter generic
//! across argument types at the cost of one normalisation pass per call.

use std::str::FromStr as _;

use policy_engine::action::Address;
use thiserror::Error;

/// Error variants for built-in evaluation.
#[derive(Debug, Error)]
pub enum FnError {
    #[error("select_address: argument is not an array (got {0})")]
    NotArray(&'static str),
    #[error("select_address: index out of bounds (idx={idx}, len={len})")]
    IndexOutOfBounds { idx: i64, len: usize },
    #[error("select_address: element {idx} is not an address (value={value})")]
    NotAddress {
        idx: i64,
        value: serde_json::Value,
    },
    #[error("select_address: invalid address {value}: {message}")]
    InvalidAddress { value: String, message: String },
}

/// `select_address(arr: address[], idx: i64) -> AddressRef` (spec §5.3.1).
///
/// `idx` semantics:
///   * `idx >= 0` — pick `arr[idx]`.
///   * `idx <  0` — pick `arr[arr.len() + idx]` (e.g. `-1` = last element).
///
/// Out-of-bounds yields [`FnError::IndexOutOfBounds`].
pub fn select_address(arr: &serde_json::Value, idx: i64) -> Result<Address, FnError> {
    let elements = arr.as_array().ok_or(FnError::NotArray(
        "select_address expects address[] (json array)",
    ))?;

    let len = elements.len();
    let resolved = resolve_index(idx, len)?;
    let element = &elements[resolved];

    let raw = element.as_str().ok_or_else(|| FnError::NotAddress {
        idx,
        value: element.clone(),
    })?;

    Address::from_str(raw).map_err(|message| FnError::InvalidAddress {
        value: raw.to_owned(),
        message,
    })
}

fn resolve_index(idx: i64, len: usize) -> Result<usize, FnError> {
    if idx >= 0 {
        let resolved = usize::try_from(idx).map_err(|_| FnError::IndexOutOfBounds { idx, len })?;
        if resolved >= len {
            return Err(FnError::IndexOutOfBounds { idx, len });
        }
        Ok(resolved)
    } else {
        let abs_negative =
            usize::try_from(-idx).map_err(|_| FnError::IndexOutOfBounds { idx, len })?;
        if abs_negative > len {
            return Err(FnError::IndexOutOfBounds { idx, len });
        }
        Ok(len - abs_negative)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn addrs() -> serde_json::Value {
        json!([
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            "0x3333333333333333333333333333333333333333",
        ])
    }

    #[test]
    fn select_address_idx_zero_picks_first() {
        let address = select_address(&addrs(), 0).unwrap();
        assert_eq!(
            address.to_string(),
            "0x1111111111111111111111111111111111111111"
        );
    }

    #[test]
    fn select_address_idx_neg_one_picks_last() {
        let address = select_address(&addrs(), -1).unwrap();
        assert_eq!(
            address.to_string(),
            "0x3333333333333333333333333333333333333333"
        );
    }

    #[test]
    fn select_address_idx_neg_two_picks_second_from_last() {
        let address = select_address(&addrs(), -2).unwrap();
        assert_eq!(
            address.to_string(),
            "0x2222222222222222222222222222222222222222"
        );
    }

    #[test]
    fn select_address_idx_oob_pos_errors() {
        let err = select_address(&addrs(), 3).unwrap_err();
        assert!(matches!(err, FnError::IndexOutOfBounds { .. }));
    }

    #[test]
    fn select_address_idx_oob_neg_errors() {
        let err = select_address(&addrs(), -4).unwrap_err();
        assert!(matches!(err, FnError::IndexOutOfBounds { .. }));
    }

    #[test]
    fn select_address_non_array_errors() {
        let err = select_address(&json!("0x1234"), 0).unwrap_err();
        assert!(matches!(err, FnError::NotArray(_)));
    }
}
