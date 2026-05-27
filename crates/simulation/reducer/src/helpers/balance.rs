//! Balance manipulation primitives: `debit`, `credit`, `transfer`.

use simulation_state::primitives::U256;
use simulation_state::token::TokenKey;
use simulation_state::{StateDelta, WalletState};

use crate::error::ReducerResult;

/// Decrease the effective fungible balance of `key` by `amount` and emit a
/// matching `TokenChange::BalanceDelta` into `delta`. Errors on underflow,
/// missing holding, or non-fungible balance form.
pub fn debit(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _key: &TokenKey,
    _amount: U256,
) -> ReducerResult<()> {
    todo!()
}

/// Increase the effective fungible balance of `key` by `amount` and emit a
/// matching `TokenChange::BalanceDelta` into `delta`.
pub fn credit(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _key: &TokenKey,
    _amount: U256,
) -> ReducerResult<()> {
    todo!()
}

/// `debit(from)` then `credit(to)` of `amount` on the same `key` —
/// idiomatic ERC20 transfer between two holdings of the same token.
pub fn transfer(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _from_key: &TokenKey,
    _to_key: &TokenKey,
    _amount: U256,
) -> ReducerResult<()> {
    todo!()
}
