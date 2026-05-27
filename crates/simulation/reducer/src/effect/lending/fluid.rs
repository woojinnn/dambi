//! Fluid venue math — smart debt / smart collateral.
//!
//! Pure functions called from per-action reducers (`supply.rs`, `borrow.rs`, ...)
//! after dispatch on `LendingVenue::Fluid`. Not a `Reducer` impl.
//!
//! Fluid uses unified vault state combining supply and borrow.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::{Decimal, U256};

// `ReserveState` is reused here as a stand-in until a Fluid-specific vault
// state struct is added in Phase 2.
use crate::action::lending::ReserveState;
use crate::error::ReducerResult;

/// Convert an asset amount into the equivalent Fluid share amount using the
/// current vault exchange rate.
pub(super) fn asset_to_fluid_shares(
    _vault_state: &ReserveState,
    _asset_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Inverse of [`asset_to_fluid_shares`].
pub(super) fn fluid_shares_to_asset(
    _vault_state: &ReserveState,
    _share_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Compute the per-second borrow rate on a vault given its current
/// utilization.
pub(super) fn current_borrow_rate(_vault_state: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}
