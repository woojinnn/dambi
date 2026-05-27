//! `LiquidateAction` reducer — liquidate an unhealthy borrower position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::LiquidateAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for LiquidateAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
