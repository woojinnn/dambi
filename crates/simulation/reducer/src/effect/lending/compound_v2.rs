//! Compound V2 venue math — classic `cToken` exchange-rate model.
//!
//! Pure functions called from per-action reducers (`supply.rs`, `borrow.rs`, ...)
//! after dispatch on `LendingVenue::CompoundV2`. Not a `Reducer` impl.
//!
//! Suppliers receive `cToken`s whose exchange rate against the underlying
//! grows over time as interest accrues to the market.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::{Decimal, U256};

use crate::action::lending::ReserveState;
use crate::error::ReducerResult;

/// Convert an underlying asset amount into the equivalent `cToken` amount
/// using the current exchange rate.
pub(super) fn underlying_to_ctoken(
    _reserve: &ReserveState,
    _underlying_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Inverse of [`underlying_to_ctoken`].
pub(super) fn ctoken_to_underlying(
    _reserve: &ReserveState,
    _ctoken_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Compute the per-block borrow rate on a market given its current
/// utilization.
pub(super) fn current_borrow_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}

/// Compute the per-block supply rate on a market given its current
/// utilization and reserve factor.
pub(super) fn current_supply_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}
