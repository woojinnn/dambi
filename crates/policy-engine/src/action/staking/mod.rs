//! Staking action schema types.

use serde::{Deserialize, Serialize};

use crate::action::common::{AssetRef, DecimalString, Hex};

mod claim_unstake;
mod request_unstake;
mod stake;

pub use claim_unstake::ClaimUnstakeAction;
pub use request_unstake::RequestUnstakeAction;
pub use stake::StakeAction;

/// Claim ticket for a delayed unstake.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketRef {
    /// Ticket NFT collection, when the claim right is represented as an NFT.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nft: Option<AssetRef>,
    /// Ticket token id or sequence id, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<DecimalString>,
    /// Bytes identifier, when the ticket is hash-based.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Hex>,
}

#[cfg(test)]
pub(super) mod test_support {
    use serde_json::{json, Value};

    pub(crate) use crate::action::test_support::{
        address, amount, assert_json_roundtrip, erc20, erc721, hex32, native,
    };

    pub(crate) fn ticket() -> Value {
        json!({
            "nft": erc721("WITHDRAWAL"),
            "tokenId": "42",
            "id": hex32(0x20)
        })
    }
}
