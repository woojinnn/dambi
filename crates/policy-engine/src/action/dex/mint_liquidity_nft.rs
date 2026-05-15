//! Mint-liquidity-NFT action for concentrated-liquidity positions.

use serde::{Deserialize, Serialize};

use crate::action::common::{Address, AssetRefWithAmountConstraint, Validity};

use super::{PoolRef, TickRange};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Mint a concentrated-liquidity position NFT.
pub struct MintLiquidityNftAction {
    /// Target pool.
    pub pool: PoolRef,
    /// Pool fee in basis points.
    #[serde(rename = "feeBps")]
    pub fee_tier_bps: u32,
    /// Minted position tick range.
    pub tick_range: TickRange,
    /// Position token pair with amount constraints.
    #[serde(rename = "inputTokens")]
    pub inputs: Vec<AssetRefWithAmountConstraint>,
    /// Recipient of the minted NFT.
    pub recipient: Address,
    /// Validity window, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validity: Option<Validity>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::common::AmountKind;
    use crate::action::dex::test_support::{
        address, assert_roundtrip, asset_amount_pair, pool, validity,
    };

    #[test]
    fn test_mint_liquidity_nft_action_serde_roundtrip_minimal() {
        let action = MintLiquidityNftAction {
            pool: pool(),
            fee_tier_bps: 5,
            tick_range: TickRange {
                lower: -60,
                upper: 60,
            },
            inputs: asset_amount_pair(AmountKind::Min, AmountKind::Min),
            recipient: address("0x2222222222222222222222222222222222222222"),
            validity: None,
        };

        assert_roundtrip(&action);
    }

    #[test]
    fn test_mint_liquidity_nft_action_serde_roundtrip_full() {
        let action = MintLiquidityNftAction {
            pool: pool(),
            fee_tier_bps: 30,
            tick_range: TickRange {
                lower: -120,
                upper: 120,
            },
            inputs: asset_amount_pair(AmountKind::Min, AmountKind::Min),
            recipient: address("0x2222222222222222222222222222222222222222"),
            validity: Some(validity()),
        };

        assert_roundtrip(&action);
    }
}
