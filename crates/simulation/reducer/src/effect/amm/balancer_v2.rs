//! Balancer V2 swap math — vault-based, multi-curve.
//!
//! Pure functions called from `swap.rs` after dispatch on `AmmVenue::BalancerV2`.
//! A single `quote_swap_hop` entry point internally dispatches on
//! `BalancerPoolType` (`Weighted` / `Stable` / `ComposableStable` / `MetaStable`
//! / `LiquidityBootstrapping` / `Linear`).
//!
//! Not a `Reducer` impl since `AmmVenue` is not an `Action`.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::U256;
use simulation_state::{EvalContext, WalletState};

use crate::action::amm::{PoolState, SwapAction};
use crate::error::ReducerResult;

/// Quote a single hop on a Balancer V2 pool given its `PoolState` snapshot.
/// Internally dispatches on `BalancerPoolType` to select the matching curve
/// (weighted product, stableswap, etc.). Returns the hop's output amount;
/// caller is responsible for fee accounting and balance changes.
pub(super) fn quote_swap_hop(
    _state: &WalletState,
    _ctx: &EvalContext,
    _swap: &SwapAction,
    _pool_state: &PoolState,
    _amount_in: U256,
) -> ReducerResult<U256> {
    todo!()
}
