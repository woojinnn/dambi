//! `DelegateBorrowAction` reducer — `Aave` credit delegation.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::DelegateBorrowAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for DelegateBorrowAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
