//! Delta utilities — forward-apply a `StateDelta` to a `WalletState`, merge
//! deltas, and check internal consistency.

use simulation_state::{StateDelta, WalletState};

use crate::error::ReducerResult;

/// Apply `delta` to `state` and return the resulting new state.
///
/// Inverse of the `Reducer::apply` direction: where `Reducer` produces a
/// delta from `(state, action)`, this consumes a delta to advance `state`.
/// Used by `apply_multicall` and by callers that want the final state.
pub fn apply_delta(_state: &WalletState, _delta: &StateDelta) -> ReducerResult<WalletState> {
    todo!()
}

/// Merge `b` into `a` such that applying the merged delta is equivalent to
/// applying `a` then `b` in sequence. Coalesces duplicate token / position /
/// pending change entries.
pub fn merge_delta(_a: StateDelta, _b: StateDelta) -> ReducerResult<StateDelta> {
    todo!()
}
