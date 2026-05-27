//! Aave V3 venue math — interest index, aToken ratio, health-factor recompute.
//!
//! Pure functions called from per-action reducers (`supply.rs`, `borrow.rs`, ...)
//! after dispatch on `LendingVenue::AaveV3`. Not a `Reducer` impl.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::{Decimal, U256};
use simulation_state::{EvalContext, WalletState};

use crate::action::lending::ReserveState;
use crate::error::ReducerResult;

/// Convert an asset amount into the equivalent `aToken` amount using the
/// current liquidity index.
pub(super) fn asset_to_atokens(
    _state: &WalletState,
    _ctx: &EvalContext,
    _reserve: &ReserveState,
    _asset_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Inverse of [`asset_to_atokens`].
pub(super) fn atokens_to_asset(
    _state: &WalletState,
    _ctx: &EvalContext,
    _reserve: &ReserveState,
    _atoken_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Compute the per-second borrow rate on a reserve given its current
/// utilization.
pub(super) fn current_borrow_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}
