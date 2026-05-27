//! `CancelOrderAction` reducer — cancel a previously placed limit or stop order.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::CancelOrderAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for CancelOrderAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
