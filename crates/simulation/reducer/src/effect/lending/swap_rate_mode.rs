//! `SwapRateModeAction` reducer — `Aave` switch between `Variable` and `Stable` debt.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::SwapRateModeAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for SwapRateModeAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
