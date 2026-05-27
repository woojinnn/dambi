//! `WithdrawAction` reducer — withdraw a previously supplied asset.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::WithdrawAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for WithdrawAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
