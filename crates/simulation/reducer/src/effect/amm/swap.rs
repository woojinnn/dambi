//! `SwapAction` reducer — single-pool or routed token-for-token swap.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::amm::SwapAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for SwapAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
