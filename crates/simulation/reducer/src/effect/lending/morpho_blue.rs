//! Morpho Blue venue math — immutable per-market lending primitive.
//!
//! Pure functions called from per-action reducers (`supply.rs`, `borrow.rs`, ...)
//! after dispatch on `LendingVenue::MorphoBlue`. Not a `Reducer` impl.
//!
//! Per-market state; `market_id = keccak((loan, collat, oracle, irm, lltv))`.
//! The interest-rate model (IRM) is a separate contract whose state lives
//! outside the market itself.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::{Decimal, U256};

// `ReserveState` is reused here as a stand-in until a Morpho-Blue-specific
// market state struct is added in Phase 2.
use crate::action::lending::ReserveState;
use crate::error::ReducerResult;

/// Convert a share balance into the equivalent asset amount using the market's
/// current total assets and total shares.
pub(super) fn shares_to_assets(
    _market_total_assets: U256,
    _market_total_shares: U256,
    _shares: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Inverse of [`shares_to_assets`].
pub(super) fn assets_to_shares(
    _market_total_assets: U256,
    _market_total_shares: U256,
    _assets: U256,
) -> ReducerResult<U256> {
    todo!()
}

/// Query the market's IRM contract for the current per-second borrow rate.
/// `irm_state` is the externally-supplied IRM contract state; the actual call
/// will be stubbed in Phase 2.
pub(super) fn current_borrow_rate(_irm_state: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}
