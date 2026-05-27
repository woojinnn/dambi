//! `DecreasePerpAction` reducer — partially reduce an existing perpetual position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::DecreasePerpAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for DecreasePerpAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
