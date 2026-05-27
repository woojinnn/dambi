//! Maverick V2 swap math — directional (mode-aware) liquidity.
//!
//! Pure functions called from `swap.rs` after dispatch on `AmmVenue::MaverickV2`.
//! Not a `Reducer` impl since `AmmVenue` is not an `Action`.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::U256;
use simulation_state::{EvalContext, WalletState};

use crate::action::amm::{PoolState, SwapAction};
use crate::error::ReducerResult;

/// Quote a single hop on a Maverick V2 pool given its `Maverick` `PoolState`
/// snapshot. Returns the hop's output amount; caller is responsible for fee
/// accounting and balance changes. Directional liquidity modes (Static / Right
/// / Left / Both) are resolved internally.
pub(super) fn quote_swap_hop(
    _state: &WalletState,
    _ctx: &EvalContext,
    _swap: &SwapAction,
    _pool_state: &PoolState,
    _amount_in: U256,
) -> ReducerResult<U256> {
    todo!()
}
