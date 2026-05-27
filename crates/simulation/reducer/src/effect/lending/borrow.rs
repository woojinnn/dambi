//! `BorrowAction` reducer — borrow an asset against existing collateral.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::BorrowAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for BorrowAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
