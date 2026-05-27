//! Position helpers — upsert / remove / mutate `Position` entries.

use simulation_state::position::{Position, PositionId};
use simulation_state::{StateDelta, WalletState};

use crate::error::ReducerResult;

/// Insert a new `Position` and emit `PositionChange::Open`.
pub fn open_position(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _position: Position,
) -> ReducerResult<()> {
    todo!()
}

/// Mutate the existing `LendingAccount` position for a venue, or create one.
///
/// Emits `PositionChange::Update` (existing) or `PositionChange::Open` (new).
/// Used by all `LendingAction` reducers.
pub fn upsert_lending_account<F>(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _position_id: &PositionId,
    _mutate: F,
) -> ReducerResult<()>
where
    F: FnOnce(&mut Position),
{
    todo!()
}

/// Same shape as `upsert_lending_account` but for `PerpPosition`.
pub fn upsert_perp_position<F>(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _position_id: &PositionId,
    _mutate: F,
) -> ReducerResult<()>
where
    F: FnOnce(&mut Position),
{
    todo!()
}

/// Remove a position and emit `PositionChange::Close`.
pub fn close_position(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _position_id: &PositionId,
) -> ReducerResult<()> {
    todo!()
}
