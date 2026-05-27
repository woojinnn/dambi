//! Balancer V3 swap math.
//!
//! Same pool types as V2 (`Weighted` / `Stable` / `ComposableStable` /
//! `MetaStable` / `LiquidityBootstrapping` / `Linear`), but V3 introduces a
//! hook framework, a unified router, and buffer-based ERC-4626 wrappers — the
//! V3 dispatch must therefore resolve hooks before falling through to the
//! per-pool-type math, analogous to `uniswap_v4`.
//!
//! A single `quote_swap_hop` entry point internally dispatches on
//! `BalancerPoolType`.
//!
//! Not a `Reducer` impl since `AmmVenue` is not an `Action`.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::U256;
use simulation_state::{EvalContext, WalletState};

use crate::action::amm::{PoolState, SwapAction};
use crate::error::ReducerResult;

/// Quote a single hop on a Balancer V3 pool given its `PoolState` snapshot.
/// Internally dispatches on `BalancerPoolType` after running any registered
/// V3 hooks. Returns the hop's output amount; caller is responsible for fee
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
