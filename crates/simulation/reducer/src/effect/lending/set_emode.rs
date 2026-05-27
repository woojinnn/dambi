//! `SetEModeAction` reducer — `Aave V3` e-mode category selection.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::lending::SetEModeAction;
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for SetEModeAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
