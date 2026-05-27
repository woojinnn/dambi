//! Top-level entry point and the `Reducer` trait.
//!
//! The simulator's contract is:
//!
//! ```ignore
//! apply(state, action, ctx) -> ReducerResult<StateDelta>
//! ```
//!
//! Pure function: `state` is read-only and the returned `StateDelta` describes
//! what *would* change. Use `helpers::delta::apply_delta` to advance the state.

use simulation_state::{EvalContext, StateDelta, WalletState};

use crate::action::{Action, ActionBody};
use crate::error::{ReducerError, ReducerResult};

/// A reducer applies itself (typically an `Action` subtree) to a wallet state
/// and returns the resulting `StateDelta`. Composable: outer `Reducer`s
/// `match` on their variants and delegate to inner ones.
pub trait Reducer {
    /// Compute the `StateDelta` produced when `self` is applied to `state`
    /// under the evaluation context `ctx`.
    ///
    /// The implementation must NOT mutate `state`. All change information
    /// lives in the returned delta.
    fn apply(&self, state: &WalletState, ctx: &EvalContext) -> ReducerResult<StateDelta>;
}

/// Public entry point — call this from the caller's side.
///
/// Mirrors `Reducer::apply` but takes `state` first so the caller-side
/// reading order is `(state, action, ctx)`.
pub fn apply(state: &WalletState, action: &Action, ctx: &EvalContext) -> ReducerResult<StateDelta> {
    action.body.apply(state, ctx)
}

impl Reducer for ActionBody {
    fn apply(&self, state: &WalletState, ctx: &EvalContext) -> ReducerResult<StateDelta> {
        match self {
            Self::Token(a) => a.apply(state, ctx),
            Self::Amm(a) => a.apply(state, ctx),
            Self::Lending(a) => a.apply(state, ctx),
            Self::Airdrop(a) => a.apply(state, ctx),
            Self::Launchpad(a) => a.apply(state, ctx),
            Self::Perp(a) => a.apply(state, ctx),
            Self::Multicall { actions } => apply_multicall(state, ctx, actions),
            Self::Unknown { target, .. } => Err(ReducerError::UnknownAction(format!(
                "unidentified call to {target:?}"
            ))),
        }
    }
}

/// Sequentially apply each child action, advancing the state with each
/// child's delta before applying the next, and accumulate into a single
/// `StateDelta`.
fn apply_multicall(
    _state: &WalletState,
    _ctx: &EvalContext,
    _actions: &[ActionBody],
) -> ReducerResult<StateDelta> {
    todo!("walk children; apply each against advancing state; merge deltas")
}
