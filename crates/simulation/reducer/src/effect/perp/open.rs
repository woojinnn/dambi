//! `OpenPerpAction` reducer — open a new perpetual futures position.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::OpenPerpAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for OpenPerpAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
