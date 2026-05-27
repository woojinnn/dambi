//! `ChangeMarginModeAction` reducer — toggle between cross and isolated margin.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::ChangeMarginModeAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for ChangeMarginModeAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
