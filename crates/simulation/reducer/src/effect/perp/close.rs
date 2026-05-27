//! `ClosePerpAction` reducer — fully close an existing perpetual position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::ClosePerpAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for ClosePerpAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
