//! `ClaimFundingAction` reducer — settle accrued funding payments to the wallet.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::perp::ClaimFundingAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for ClaimFundingAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
