//! `IncreasePerpAction` reducer — add size to an existing perpetual position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::IncreasePerpAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for IncreasePerpAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
