//! `RepayAction` reducer — repay an outstanding debt position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::RepayAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for RepayAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
