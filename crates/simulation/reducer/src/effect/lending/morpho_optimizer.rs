//! Morpho Optimizer venue math — peer-to-peer layer on top of Aave / Compound.
//!
//! Pure functions called from per-action reducers (`supply.rs`, `borrow.rs`, ...)
//! after dispatch on `LendingVenue::MorphoOptimizer`. Not a `Reducer` impl.
//!
//! Sits on top of Aave / Compound; rates blend p2p and pool. When matched p2p
//! liquidity is unavailable, positions fall through to the underlying pool at
//! that pool's prevailing rate.

// Phase 2 stubs: callers (per-action reducers) are still `todo!()` so these
// functions look unused. Lift this allow when the first caller wires up.
#![allow(dead_code)]

use simulation_state::primitives::{Decimal, U256};

// `ReserveState` is reused here as a stand-in until an Optimizer-specific
// market state struct is added in Phase 2.
use crate::action::lending::ReserveState;
use crate::error::ReducerResult;

/// Compute the blended p2p supply rate given the p2p index and the current
/// pool supply rate fallback.
pub(super) fn p2p_supply_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}

/// Compute the blended p2p borrow rate given the p2p index and the current
/// pool borrow rate fallback.
pub(super) fn p2p_borrow_rate(_reserve: &ReserveState) -> ReducerResult<Decimal> {
    todo!()
}

/// Convert an asset amount into the equivalent Optimizer share amount using
/// the current p2p/pool index split.
pub(super) fn asset_to_optimizer_shares(
    _reserve: &ReserveState,
    _asset_amount: U256,
) -> ReducerResult<U256> {
    todo!()
}
