//! Uniswap V4 swap math — concentrated liquidity with hook framework.
//!
//! Pure functions called from `swap.rs` after dispatch on `AmmVenue::UniswapV4`.
//! Math shape mirrors V3 (tick-traversal on a `Concentrated` `PoolState`), but
//! hooks may override fees or curves on `beforeSwap` / `afterSwap`.
//!
//! TODO: hook dispatch — resolve `PoolKey.hooks` address against a known-hook
//! registry and run the matching pre/post callbacks before falling through to
//! the default V3-style math.
//!
//! Not a `Reducer` impl since `AmmVenue` is not an `Action`.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::U256;
use simulation_state::{EvalContext, WalletState};

use crate::action::amm::{PoolState, SwapAction};
use crate::error::ReducerResult;

/// Quote a single hop on a Uniswap V4 pool given its `Concentrated` `PoolState`
/// snapshot. Returns the hop's output amount; caller is responsible for fee
/// accounting and balance changes. Hook callbacks (if any) are resolved
/// internally before the V3-style tick math runs.
pub(super) fn quote_swap_hop(
    _state: &WalletState,
    _ctx: &EvalContext,
    _swap: &SwapAction,
    _pool_state: &PoolState,
    _amount_in: U256,
) -> ReducerResult<U256> {
    todo!()
}
