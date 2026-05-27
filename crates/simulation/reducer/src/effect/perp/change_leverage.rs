//! `ChangeLeverageAction` reducer — update the leverage multiplier on a position or account.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::ChangeLeverageAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for ChangeLeverageAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
