//! `PlaceStopOrderAction` reducer — submit a stop-loss or take-profit trigger order.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::PlaceStopOrderAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for PlaceStopOrderAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
