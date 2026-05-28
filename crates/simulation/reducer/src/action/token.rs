//! `TokenAction` — cross-cutting token operations (`ERC20`/`ERC721`/`ERC1155`
//! approve/permit/transfer, etc.). See spec §4.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::primitives::{Address, ChainId, Time, U256};
use simulation_state::token::{TokenKey, TokenRef};
use simulation_state::LiveField;

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

/// `ERC20` `approve(spender, amount)` — grants `spender` allowance up to `amount` of `token`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Erc20ApproveAction {
    /// Token being approved.
    pub token: TokenRef,
    /// Address authorized to spend.
    #[tsify(type = "string")]
    pub spender: Address,
    /// Allowance amount; `U256::MAX` means unlimited.
    #[tsify(type = "string")]
    pub amount: U256,
    // No `live_inputs` — fully deterministic.
}

/// `ERC20` `EIP-2612` `permit` — gasless allowance granted via off-chain signature.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Erc20PermitAction {
    /// Token whose `permit` is being signed.
    pub token: TokenRef,
    /// Address authorized to spend.
    #[tsify(type = "string")]
    pub spender: Address,
    /// Allowance amount.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Signature expiration timestamp.
    pub deadline: Time,
    /// Current `permit` nonce on the token contract.
    #[tsify(type = "LiveField<string>")]
    pub nonce: LiveField<U256>,
}

/// `Uniswap` `Permit2` on-chain `approve` — sets allowance on the `Permit2` contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Permit2ApproveAction {
    /// Underlying token whose allowance is delegated through `Permit2`.
    pub token: TokenRef,
    /// Address authorized to spend.
    #[tsify(type = "string")]
    pub spender: Address,
    /// Allowance amount.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Timestamp at which the allowance expires.
    pub expires_at: Time,
}

/// `Uniswap` `Permit2` signed allowance — off-chain signature consumed by `Permit2`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Permit2SignAction {
    /// Underlying token whose allowance is delegated through `Permit2`.
    pub token: TokenRef,
    /// Address authorized to spend.
    #[tsify(type = "string")]
    pub spender: Address,
    /// Allowance amount.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Timestamp at which the allowance expires.
    pub expires_at: Time,
    /// Timestamp at which the signature itself expires.
    pub sig_deadline: Time,
    /// `(word, bit)` pair — `Permit2` nonce bitmap coordinates.
    #[tsify(type = "LiveField<[string, number]>")]
    pub nonce: LiveField<(U256, u8)>,
}

/// `ERC20` `transfer(recipient, amount)` — direct token transfer from the actor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct Erc20TransferAction {
    /// Token being transferred.
    pub token: TokenRef,
    /// Address receiving the tokens.
    #[tsify(type = "string")]
    pub recipient: Address,
    /// Amount to transfer.
    #[tsify(type = "string")]
    pub amount: U256,
}

/// `ERC721`/`ERC1155` single-token `approve` — grants `spender` rights to a single NFT.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct NftApproveAction {
    /// `TokenKey::Erc721 { .., token_id }` (or `ERC1155` equivalent).
    pub nft_key: TokenKey,
    /// Address authorized to operate the NFT.
    #[tsify(type = "string")]
    pub spender: Address,
}

/// `ERC721`/`ERC1155` `setApprovalForAll` — toggles operator status across an entire collection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct NftSetForAllAction {
    /// Chain on which the collection lives.
    pub chain: ChainId,
    /// `ERC721` or `ERC1155` contract address.
    #[tsify(type = "string")]
    pub contract: Address,
    /// Operator being granted or revoked.
    #[tsify(type = "string")]
    pub spender: Address,
    /// When `false`, encodes `setApprovalForAll(false)` (revoke).
    pub approved: bool,
}

/// `ERC721`/`ERC1155` transfer of a specific token id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct NftTransferAction {
    /// `TokenKey::Erc721` or `TokenKey::Erc1155`.
    pub nft_key: TokenKey,
    /// `ERC1155` quantity; `None` for `ERC721` (implicitly `1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub amount: Option<U256>,
    /// Address receiving the NFT.
    #[tsify(type = "string")]
    pub recipient: Address,
}

/// Revoke a previously granted approval, scoped via `RevokeScope`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RevokeApprovalAction {
    /// Which approval to revoke.
    pub scope: RevokeScope,
}

/// Target scope of a `RevokeApprovalAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RevokeScope {
    /// Revoke an `ERC20` allowance for `spender` on `token`.
    Erc20 {
        /// Token whose allowance is being revoked.
        token: TokenRef,
        /// Spender losing the allowance.
        #[tsify(type = "string")]
        spender: Address,
    },
    /// Revoke approval on a single `ERC721`/`ERC1155` token id.
    NftSingleToken {
        /// `TokenKey` identifying the specific NFT.
        nft_key: TokenKey,
    },
    /// Revoke a collection-wide `setApprovalForAll` operator grant.
    NftSetForAll {
        /// Chain on which the collection lives.
        chain: ChainId,
        /// `ERC721`/`ERC1155` contract address.
        #[tsify(type = "string")]
        contract: Address,
        /// Operator losing approval.
        #[tsify(type = "string")]
        spender: Address,
    },
    /// `Permit2` lockdown — revoke a `spender`'s rights on the `Uniswap` `Permit2` contract.
    Permit2Lockdown {
        /// Underlying token whose `Permit2` allowance is being revoked.
        token: TokenRef,
        /// Spender losing the `Permit2` allowance.
        #[tsify(type = "string")]
        spender: Address,
    },
}
