//! Aggregator cross-cutting concerns (1inch / 0x / Paraswap / Kyberswap / Odos /
//! OKX / `Uniswap Universal Router` / `CoW` solver).
//!
//! Aggregators have no pool math of their own — each hop in their `SwapRoute`
//! delegates to an underlying single-pool venue (`uniswap_v3`, `curve_v2`, ...).
//! This file holds the *aggregator-specific* hooks the swap reducer must call
//! when `AmmVenue::AggregatorRoute` is dispatched.

// Phase 2 stubs.
#![allow(dead_code)]

use simulation_state::{StateDelta, WalletState};

use crate::action::amm::AggregatorMeta;
use crate::error::ReducerResult;

/// Verify that the aggregator's executor contract is on a known-safe allow
/// list. Returns `Err` for unknown or fake executors.
pub(super) fn verify_executor(_meta: &AggregatorMeta) -> ReducerResult<()> {
    todo!()
}

/// Verify that the calldata hash recorded in `meta` matches what would be
/// generated from the user's signed intent (replay / audit guard).
pub(super) fn verify_calldata_hash(_meta: &AggregatorMeta) -> ReducerResult<()> {
    todo!()
}

/// When `meta.permit_bundled == true`, apply the bundled `permit` step
/// (allowance grant) before the swap proceeds. Emits an
/// `ApprovalSet` change to `delta`.
pub(super) fn apply_permit_bundle(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _meta: &AggregatorMeta,
) -> ReducerResult<()> {
    todo!()
}
