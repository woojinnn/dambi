//! Wrap action.

use serde::{Deserialize, Serialize};

use crate::action::common::{Address, AssetRefWithAmountConstraint};

/// Wrap a native asset into its ERC-20 representation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrapAction {
    /// Native asset being wrapped.
    pub native_asset: AssetRefWithAmountConstraint,
    /// Wrapped ERC-20 asset being minted.
    pub wrapped_asset: AssetRefWithAmountConstraint,
    /// Recipient of the wrapped asset.
    pub recipient: Address,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::misc::test_support::{
        address, amount, assert_json_roundtrip, erc20, native,
    };
    use serde_json::json;

    #[test]
    fn test_wrap_action_serde_roundtrip_minimal() {
        assert_json_roundtrip::<WrapAction>(json!({
            "nativeAsset": {
                "asset": native("ETH"),
                "amount": amount("exact", "1000")
            },
            "wrappedAsset": {
                "asset": erc20("WETH"),
                "amount": amount("exact", "1000")
            },
            "recipient": address(0x30)
        }));
    }

    #[test]
    fn test_wrap_action_serde_roundtrip_full() {
        assert_json_roundtrip::<WrapAction>(json!({
            "nativeAsset": {
                "asset": native("ETH"),
                "amount": amount("exact", "2000")
            },
            "wrappedAsset": {
                "asset": erc20("WETH"),
                "amount": amount("min", "1990")
            },
            "recipient": address(0x31)
        }));
    }
}
