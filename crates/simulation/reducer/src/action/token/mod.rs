//! `TokenAction` — cross-cutting token operations (`ERC20`/`ERC721`/`ERC1155`
//! approve/permit/transfer, etc.). See spec §4.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

/// `ERC20` `approve` action.
pub mod erc20_approve;
/// `ERC20` `EIP-2612` `permit` action.
pub mod erc20_permit;
/// `ERC20` `transfer` action.
pub mod erc20_transfer;
/// `ERC721`/`ERC1155` single-token `approve` action.
pub mod nft_approve;
/// `ERC721`/`ERC1155` `setApprovalForAll` action.
pub mod nft_set_for_all;
/// `ERC721`/`ERC1155` transfer action.
pub mod nft_transfer;
/// `Uniswap` `Permit2` on-chain `approve` action.
pub mod permit2_approve;
/// `Uniswap` `Permit2` signed allowance action.
pub mod permit2_sign;
/// Revoke-approval action and its scope enum.
pub mod revoke;

pub use self::erc20_approve::*;
pub use self::erc20_permit::*;
pub use self::erc20_transfer::*;
pub use self::nft_approve::*;
pub use self::nft_set_for_all::*;
pub use self::nft_transfer::*;
pub use self::permit2_approve::*;
pub use self::permit2_sign::*;
pub use self::revoke::*;

/// Domain-agnostic, token-level actions that can occur anywhere.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TokenAction {
    /// `ERC20` `approve(spender, amount)`.
    Erc20Approve(Erc20ApproveAction),
    /// `ERC20` `EIP-2612` `permit` — gasless allowance via signature.
    Erc20Permit(Erc20PermitAction),
    /// `Uniswap` `Permit2` on-chain `approve` call.
    Permit2Approve(Permit2ApproveAction),
    /// `Uniswap` `Permit2` signed allowance (off-chain signature).
    Permit2SignAllowance(Permit2SignAction),
    /// `ERC20` `transfer(recipient, amount)`.
    Erc20Transfer(Erc20TransferAction),
    /// `ERC721`/`ERC1155` single-token `approve`.
    NftApprove(NftApproveAction),
    /// `ERC721`/`ERC1155` `setApprovalForAll` toggle.
    NftSetApprovalForAll(NftSetForAllAction),
    /// `ERC721`/`ERC1155` transfer.
    NftTransfer(NftTransferAction),
    /// Revoke a previously granted approval (any scope).
    RevokeApproval(RevokeApprovalAction),
}
