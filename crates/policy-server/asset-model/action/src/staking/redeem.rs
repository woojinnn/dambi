//! `Redeem` action — withdraw the underlying from a safety module post-cooldown.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use policy_state::primitives::{Address, U256};
use policy_state::token::TokenRef;

use super::StakeVenue;

/// Unit represented by [`RedeemAction::amount`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "snake_case")]
pub enum RedeemAmountDenomination {
    /// Amount is denominated in vault/staked-token shares (`redeem(shares, ...)`).
    Shares,
    /// Amount is denominated in underlying assets (`withdraw(assets, ...)`).
    Assets,
}

/// Redeem a safety-module stake: burn the staked derivative and withdraw the
/// underlying token to `recipient` (Aave `StakedTokenV3.redeem(to, amount)`).
/// Requires the cooldown window to have elapsed. The underlying token is
/// implied by legacy safety-module venues, and explicit for ERC4626-style
/// Umbrella / sGHO exits.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RedeemAction {
    /// Staking venue (`StakeVenue::AaveSafetyModule { chain, module }`).
    pub venue: StakeVenue,
    /// Redeemed underlying token when the vault/stake-token surface exposes it.
    /// Omitted for legacy safety modules where the asset is implied by venue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub asset: Option<TokenRef>,
    /// Amount of staked-derivative shares redeemed (`amount`, wei), U256 hex.
    /// `type(uint256).max` redeems the full balance. ERC4626 `withdraw`
    /// surfaces set `amount_denomination = assets`; ERC4626 `redeem` surfaces
    /// set `amount_denomination = shares`.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Unit represented by `amount`. Omitted for legacy safety modules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub amount_denomination: Option<RedeemAmountDenomination>,
    /// Account whose shares are burned (`owner` on ERC4626 redeem/withdraw).
    /// Omitted ⇒ submitter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub owner: Option<Address>,
    /// Recipient of the withdrawn underlying (`to`). Omitted ⇒ submitter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub recipient: Option<Address>,
}
