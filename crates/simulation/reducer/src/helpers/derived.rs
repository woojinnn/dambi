//! Recompute `LiveField`s whose `source: DataSource::DerivedFrom { .. }` —
//! values computed from other on-chain primitives rather than fetched.
//!
//! Sync orchestrator calls these for `DerivedFrom` `LiveField`s it discovers
//! during state walks. Reducers call them inline when a write to a primitive
//! invalidates a derived value (e.g. supplying USDC to Aave changes the
//! account's `health_factor`).

use simulation_state::position::{LendingAccount, PerpPosition};
use simulation_state::primitives::{Decimal, Price, SignedI256, Time};

use crate::error::ReducerResult;

/// Recompute `LendingAccount::health_factor` from its `collaterals` and
/// `debts` plus current oracle prices.
pub fn recompute_health_factor(_account: &LendingAccount, _now: Time) -> ReducerResult<Decimal> {
    todo!()
}

/// Recompute `PerpPosition::unrealized_pnl` from entry / mark / size.
pub fn recompute_perp_pnl(
    _position: &PerpPosition,
    _mark_price: Price,
    _now: Time,
) -> ReducerResult<SignedI256> {
    todo!()
}

/// Recompute `PerpPosition::liq_price` from collateral, size, and venue
/// margin params.
pub fn recompute_liq_price(_position: &PerpPosition, _now: Time) -> ReducerResult<Option<Price>> {
    todo!()
}

/// Recompute `LendingAccount::ltv` from current collateral / debt USD.
pub fn recompute_ltv(_account: &LendingAccount, _now: Time) -> ReducerResult<Decimal> {
    todo!()
}
