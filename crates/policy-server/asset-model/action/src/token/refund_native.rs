use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use policy_state::primitives::Address;
use policy_state::token::TokenRef;

/// Native-currency refund from a protocol/router balance back to the caller.
///
/// Uniswap V3 periphery `refundETH()` has no amount argument: it transfers the
/// contract's remaining native balance to `msg.sender`. Keep this distinct from
/// `Erc20TransferAction` so the decoder does not invent an exact amount.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RefundNativeAction {
    /// Native gas asset being refunded.
    pub token: TokenRef,
    /// Recipient of the refund. For Uniswap V3 `refundETH()`, this is `tx.from`.
    #[tsify(type = "string")]
    pub recipient: Address,
}
