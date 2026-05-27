//! `SupplyAction` reducer — supply (`deposit`) an asset into a lending market.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::SupplyAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for SupplyAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
