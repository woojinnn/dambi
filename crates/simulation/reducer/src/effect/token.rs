//! `TokenAction` reducers — `ERC20` / `ERC721` / `ERC1155` / `Permit2` ops.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::token::{
    Erc20ApproveAction, Erc20PermitAction, Erc20TransferAction, NftApproveAction,
    NftSetForAllAction, NftTransferAction, Permit2ApproveAction, Permit2SignAction,
    RevokeApprovalAction, TokenAction,
};
use crate::apply::Reducer;
use crate::error::ReducerResult;

impl Reducer for TokenAction {
    fn apply(&self, state: &WalletState, ctx: &EvalContext) -> ReducerResult<StateDelta> {
        match self {
            Self::Erc20Approve(a) => a.apply(state, ctx),
            Self::Erc20Permit(a) => a.apply(state, ctx),
            Self::Permit2Approve(a) => a.apply(state, ctx),
            Self::Permit2SignAllowance(a) => a.apply(state, ctx),
            Self::Erc20Transfer(a) => a.apply(state, ctx),
            Self::NftApprove(a) => a.apply(state, ctx),
            Self::NftSetApprovalForAll(a) => a.apply(state, ctx),
            Self::NftTransfer(a) => a.apply(state, ctx),
            Self::RevokeApproval(a) => a.apply(state, ctx),
        }
    }
}

impl Reducer for Erc20ApproveAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for Erc20PermitAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for Permit2ApproveAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for Permit2SignAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for Erc20TransferAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for NftApproveAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for NftSetForAllAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for NftTransferAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}

impl Reducer for RevokeApprovalAction {
    fn apply(&self, _state: &WalletState, _ctx: &EvalContext) -> ReducerResult<StateDelta> {
        todo!()
    }
}
