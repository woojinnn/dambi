//! `LaunchpadAction` reducers — `Commit` / `ClaimAllocation` / `ClaimVested` /
//! `Refund` / `WithdrawCommit`.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::launchpad::{
    ClaimAllocationAction, ClaimVestedAction, CommitAction, LaunchpadAction, RefundAction,
    WithdrawCommitAction,
};
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for LaunchpadAction {
    fn apply(&self, state: &WalletState, ctx: &EvalContext) -> ReducerResult<StateDelta> {
        match self {
            Self::Commit(a) => a.apply(state, ctx),
            Self::ClaimAllocation(a) => a.apply(state, ctx),
            Self::ClaimVested(a) => a.apply(state, ctx),
            Self::Refund(a) => a.apply(state, ctx),
            Self::WithdrawCommit(a) => a.apply(state, ctx),
        }
    }
}

impl Reducer for CommitAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for ClaimAllocationAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for ClaimVestedAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for RefundAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for WithdrawCommitAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
