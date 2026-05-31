use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::primitives::{Address, U256};
use simulation_state::token::TokenRef;

/// Direction of an ERC20 allowance adjustment.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "snake_case")]
pub enum Erc20AllowanceAdjustment {
    /// Increase the current allowance by `amount_delta`.
    Increase,
    /// Decrease the current allowance by `amount_delta`.
    Decrease,
}

/// `ERC20` `increaseAllowance` / `decreaseAllowance` — adjusts an existing allowance.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Erc20AdjustAllowanceAction {
    /// Token whose allowance is being adjusted.
    pub token: TokenRef,
    /// Address authorized to spend.
    #[tsify(type = "string")]
    pub spender: Address,
    /// Amount added to or removed from the current allowance.
    #[tsify(type = "string")]
    pub amount_delta: U256,
    /// Whether the current allowance is increased or decreased.
    pub direction: Erc20AllowanceAdjustment,
}
