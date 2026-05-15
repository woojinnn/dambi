//! Transfer action.

use serde::{Deserialize, Serialize};

use crate::action::common::{Address, AssetRefWithAmountConstraint};

/// Transfer a token directly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferAction {
    /// Token and amount being transferred.
    pub token: AssetRefWithAmountConstraint,
    /// Account sending the token.
    pub from: Address,
    /// Account receiving the token.
    pub recipient: Address,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::misc::test_support::{address, amount, assert_json_roundtrip, erc20};
    use serde_json::json;

    #[test]
    fn test_transfer_action_serde_roundtrip_minimal() {
        assert_json_roundtrip::<TransferAction>(json!({
            "token": {
                "asset": erc20("USDC"),
                "amount": amount("exact", "1000")
            },
            "from": address(0x50),
            "recipient": address(0x51)
        }));
    }

    #[test]
    fn test_transfer_action_serde_roundtrip_full() {
        assert_json_roundtrip::<TransferAction>(json!({
            "token": {
                "asset": {
                    "kind": "erc721",
                    "address": address(0x11),
                    "tokenId": "42",
                    "symbol": "NFT"
                },
                "amount": amount("exact", "1")
            },
            "from": address(0x50),
            "recipient": address(0x51)
        }));
    }
}
