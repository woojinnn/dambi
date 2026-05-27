//! `SignIntentOrderAction` / `CancelIntentOrderAction` reducers —
//! EIP-712 intent flows (`UniswapX` / `CowSwap` / `1inch Fusion`, ...).

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::amm::{CancelIntentOrderAction, SignIntentOrderAction};
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for SignIntentOrderAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for CancelIntentOrderAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
