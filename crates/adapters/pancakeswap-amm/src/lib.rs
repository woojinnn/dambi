//! PancakeSwap V2 (AMM) Router swap adapters for `policy-engine`.
//!
//! PancakeSwap V2 is an ABI-level fork of Uniswap V2 Router02 deployed on BSC
//! at `0x10ED43C718714eb63d5aA57B78B54704E256024E`. All six core swap
//! selectors are byte-identical to Uniswap V2's. This crate emits
//! `protocol_ids = vec!["pancakeswap-amm"]` (so policies can distinguish it
//! from Uniswap V2 even though the on-chain calldata shape is the same) and
//! a constant `max_fee_bps = Some(25)` (PancakeSwap V2's protocol-level fee).
//!
//! Module layout mirrors the Uniswap V2 crate: one file per swap function,
//! with shared helpers in `common.rs`.
//!
//! ```text
//!   src/
//!     ├── lib.rs                              ← module index + re-exports
//!     ├── common.rs                           ← shared: ROUTER, TokenLookup,
//!     │                                         native_bnb
//!     ├── swap_exact_tokens_for_tokens.rs
//!     ├── swap_tokens_for_exact_tokens.rs
//!     ├── swap_exact_eth_for_tokens.rs        (payable)
//!     ├── swap_eth_for_exact_tokens.rs        (payable)
//!     ├── swap_exact_tokens_for_eth.rs
//!     └── swap_tokens_for_exact_eth.rs
//! ```

#![deny(unsafe_code)]
#![deny(unused_must_use)]
#![deny(rustdoc::bare_urls)]
#![deny(rustdoc::broken_intra_doc_links)]
#![warn(missing_docs)]
#![warn(unreachable_pub)]
#![warn(rust_2018_idioms)]
#![warn(rust_2021_compatibility)]
#![warn(missing_debug_implementations)]
#![warn(clippy::all)]
#![warn(clippy::pedantic)]
#![warn(clippy::nursery)]
#![warn(clippy::dbg_macro)]
#![warn(clippy::todo)]
#![cfg_attr(not(test), warn(clippy::expect_used))]
#![cfg_attr(not(test), warn(clippy::panic))]
#![cfg_attr(not(test), warn(clippy::unwrap_used))]

pub mod common;
pub mod swap_eth_for_exact_tokens;
pub mod swap_exact_eth_for_tokens;
pub mod swap_exact_tokens_for_eth;
pub mod swap_exact_tokens_for_tokens;
pub mod swap_tokens_for_exact_eth;
pub mod swap_tokens_for_exact_tokens;

pub use common::{
    native_bnb, DecodeError, TokenLookup, NATIVE_BNB_SENTINEL, PANCAKESWAP_V2_ROUTER_BSC,
};

// ---- Per-function re-exports ----------------------------------------------

pub use swap_exact_tokens_for_tokens::Adapter_ as PancakeSwapAMMSwapExactTokensForTokensAdapter;
pub use swap_exact_tokens_for_tokens::{
    decode as decode_swap_exact_tokens_for_tokens, encode as encode_swap_exact_tokens_for_tokens,
    Params as SwapExactTokensForTokensParams, SELECTOR as SELECTOR_SWAP_EXACT_TOKENS_FOR_TOKENS,
};

pub use swap_tokens_for_exact_tokens::Adapter_ as PancakeSwapAMMSwapTokensForExactTokensAdapter;
pub use swap_tokens_for_exact_tokens::{
    decode as decode_swap_tokens_for_exact_tokens, encode as encode_swap_tokens_for_exact_tokens,
    Params as SwapTokensForExactTokensParams, SELECTOR as SELECTOR_SWAP_TOKENS_FOR_EXACT_TOKENS,
};

pub use swap_exact_eth_for_tokens::Adapter_ as PancakeSwapAMMSwapExactETHForTokensAdapter;
pub use swap_exact_eth_for_tokens::{
    decode as decode_swap_exact_eth_for_tokens, encode as encode_swap_exact_eth_for_tokens,
    Params as SwapExactETHForTokensParams, SELECTOR as SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
};

pub use swap_eth_for_exact_tokens::Adapter_ as PancakeSwapAMMSwapETHForExactTokensAdapter;
pub use swap_eth_for_exact_tokens::{
    decode as decode_swap_eth_for_exact_tokens, encode as encode_swap_eth_for_exact_tokens,
    Params as SwapETHForExactTokensParams, SELECTOR as SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
};

pub use swap_exact_tokens_for_eth::Adapter_ as PancakeSwapAMMSwapExactTokensForETHAdapter;
pub use swap_exact_tokens_for_eth::{
    decode as decode_swap_exact_tokens_for_eth, encode as encode_swap_exact_tokens_for_eth,
    Params as SwapExactTokensForETHParams, SELECTOR as SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
};

pub use swap_tokens_for_exact_eth::Adapter_ as PancakeSwapAMMSwapTokensForExactETHAdapter;
pub use swap_tokens_for_exact_eth::{
    decode as decode_swap_tokens_for_exact_eth, encode as encode_swap_tokens_for_exact_eth,
    Params as SwapTokensForExactETHParams, SELECTOR as SELECTOR_SWAP_TOKENS_FOR_EXACT_ETH,
};
