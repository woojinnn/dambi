//! Restaking action schema types.

use serde::{Deserialize, Serialize};

use crate::action::common::{Address, Hex};

mod claim_restake_withdrawal;
mod request_restake_withdrawal;
mod restake;

pub use claim_restake_withdrawal::ClaimRestakeWithdrawalAction;
pub use request_restake_withdrawal::RequestRestakeWithdrawalAction;
pub use restake::RestakeAction;

/// Restaking strategy or vault reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyRef {
    /// Strategy or vault contract address, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<Address>,
    /// Strategy or vault identifier, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Hex>,
    /// Human-readable strategy label, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[cfg(test)]
pub(super) mod test_support {
    use serde_json::{json, Value};

    pub(crate) use crate::action::test_support::{
        address, amount, assert_json_roundtrip, erc20, erc721, hex32, native,
    };

    pub(crate) fn strategy() -> Value {
        json!({
            "address": address(0x20),
            "id": hex32(0x21),
            "label": "Example Strategy"
        })
    }

    pub(crate) fn ticket() -> Value {
        json!({
            "nft": erc721("WITHDRAWAL"),
            "tokenId": "42",
            "id": hex32(0x22)
        })
    }
}
