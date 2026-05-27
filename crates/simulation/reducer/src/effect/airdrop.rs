//! `AirdropAction` reducers — `Claim` / `Delegate`.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::airdrop::{AirdropAction, ClaimAirdropAction, DelegateGovernanceAction};
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for AirdropAction {
    fn apply(&self, state: &WalletState, ctx: &EvalContext) -> ReducerResult<StateDelta> {
        match self {
            Self::Claim(a) => a.apply(state, ctx),
            Self::Delegate(a) => a.apply(state, ctx),
        }
    }
}

impl Reducer for ClaimAirdropAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for DelegateGovernanceAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
