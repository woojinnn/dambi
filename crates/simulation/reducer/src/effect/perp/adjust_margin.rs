//! `AdjustMarginAction` reducer — add or remove collateral on an isolated position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::AdjustMarginAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for AdjustMarginAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
