//! Compound V3 (`Comet`) venue math — single base asset per market.
//!
//! Pure functions called from per-action reducers (`supply.rs`, `borrow.rs`, ...)
//! after dispatch on `LendingVenue::CompoundV3`. Not a `Reducer` impl.
//!
//! In Compound V3 each market has a single base asset; suppliers earn interest
//! on the base while collateral assets do not. Both supply and borrow balances
//! are tracked as principal amounts that accrue via per-market indices.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::{Decimal, U256};

use crate::action::lending::ReserveState;
use crate::error::ReducerResult;

/// Scale a stored principal balance by the current supply/borrow index to
/// obtain the present-value amount denominated in the base asset.
pub(super) fn principal_to_present_value(
    _reserve: &ReserveState,
    _principal_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Inverse of [`principal_to_present_value`].
pub(super) fn present_value_to_principal(
    _reserve: &ReserveState,
    _present_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Compute the per-second supply rate on the base asset given current
/// utilization.
pub(super) fn current_supply_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}

/// Compute the per-second borrow rate on the base asset given current
/// utilization.
pub(super) fn current_borrow_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}
