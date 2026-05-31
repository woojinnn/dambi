//! `ClaimRewardsAction` — mint/claim accrued reward tokens (Curve `Minter`).

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::primitives::Address;
use simulation_state::token::TokenRef;

use super::StakeVenue;

/// Mint accrued reward tokens for one or more gauges.
///
/// Models Curve `Minter.mint(address gauge)`, `mint_for(address gauge, address _for)`
/// and `mint_many(address[8] gauges)`. `gauges` holds the gauge address(es) the
/// rewards are minted from; `on_behalf_of` is the beneficiary (`mint_for._for`),
/// omitted ⇒ the submitter mints for themselves. The reward token is CRV.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimRewardsAction {
    /// Staking venue (e.g. Curve `Minter`).
    pub venue: StakeVenue,
    /// Reward token minted (CRV).
    pub reward_token: TokenRef,
    /// Gauge address(es) the rewards are minted from (one or many).
    #[tsify(type = "string[]")]
    pub gauges: Vec<Address>,
    /// Beneficiary receiving the minted rewards (`mint_for._for`); omitted ⇒ submitter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub on_behalf_of: Option<Address>,
}
