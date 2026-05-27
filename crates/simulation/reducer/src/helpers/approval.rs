//! Approval helpers — `ERC20` allowance, `setApprovalForAll`, per-NFT `approve`, `Permit2`.

use simulation_state::primitives::{Address, ChainId, Spender, U256};
use simulation_state::token::{TokenKey, TokenRef};
use simulation_state::{StateDelta, WalletState};

use crate::error::ReducerResult;

/// Set the `ERC20` allowance of `(token, spender)` to `amount`, emitting a
/// `TokenChange::ApprovalSet`. `U256::MAX` is recorded as `is_unlimited`.
pub fn set_erc20_allowance(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _token: &TokenRef,
    _spender: Address,
    _amount: U256,
) -> ReducerResult<()> {
    todo!()
}

/// Revoke an `ERC20` allowance (`approve(spender, 0)`).
pub fn revoke_erc20_allowance(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _token: &TokenRef,
    _spender: Address,
) -> ReducerResult<()> {
    todo!()
}

/// Toggle `setApprovalForAll(spender, approved)` on an `ERC721` / `ERC1155`
/// contract.
pub fn set_for_all(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _chain: &ChainId,
    _contract: Address,
    _spender: Address,
    _approved: bool,
) -> ReducerResult<()> {
    todo!()
}

/// Set a single-NFT `approve(spender)` on a specific `Erc721` token id.
pub fn set_nft_approve(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _nft_key: &TokenKey,
    _spender: Address,
) -> ReducerResult<()> {
    todo!()
}

/// Upsert a `Permit2` on-chain allowance entry (`Permit2.approve`).
pub fn upsert_permit2_allowance(
    _state: &WalletState,
    _delta: &mut StateDelta,
    _token: &TokenRef,
    _spender: Spender,
    _amount: U256,
    _expires_at: simulation_state::primitives::Time,
) -> ReducerResult<()> {
    todo!()
}
