//! `PlaceLimitOrderAction` reducer — submit a limit order to a perp venue's orderbook.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::PlaceLimitOrderAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for PlaceLimitOrderAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
