//! `SushiSwap V2` swap math.
//!
//! Math identical to `uniswap_v2`; kept separate for explicit venue dispatch
//! on `AmmVenue::SushiV2` so per-venue fee schedules and pool registries can
//! diverge later without touching the V2 file.
//!
//! Not a `Reducer` impl since `AmmVenue` is not an `Action`.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::U256;
use simulation_state::{EvalContext, WalletState};

use crate::action::amm::{PoolState, SwapAction};
use crate::error::ReducerResult;

/// Quote a single hop on a `SushiSwap V2` pool given its `XyConstant` `PoolState`
/// snapshot. Returns the hop's output amount; caller is responsible for fee
/// accounting and balance changes.
pub(super) fn quote_swap_hop(
    _state: &WalletState,
    _ctx: &EvalContext,
    _swap: &SwapAction,
    _pool_state: &PoolState,
    _amount_in: U256,
) -> ReducerResult<U256> {
    todo!()
}
