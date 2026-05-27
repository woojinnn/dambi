//! `SetCollateralAction` reducer — handles both `EnableCollateral` and
//! `DisableCollateral` variants via a free function disambiguated by `enable`.
//!
//! The two `LendingAction` variants wrap the same `SetCollateralAction` struct,
//! so a single `Reducer` impl cannot distinguish them. Dispatch in `mod.rs`
//! calls this function with `enable = true` / `false` instead.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::SetCollateralAction;
use crate::error::ReducerResult;

/// Apply an enable-or-disable-collateral action against `state`.
///
/// `enable = true` corresponds to `LendingAction::EnableCollateral`;
/// `enable = false` corresponds to `LendingAction::DisableCollateral`.
pub(super) fn apply(
    _action: &SetCollateralAction,
    _state: &WalletState,
    _ctx: &EvalContext,
    _enable: bool,
) -> ReducerResult<StateDelta> {
    todo!()
}
