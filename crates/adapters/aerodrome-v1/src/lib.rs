//! Aerodrome V1 (Solidly-fork) Router swap adapters for `policy-engine`.
//!
//! Aerodrome V1 is a Solidly-style ve(3,3) AMM deployed on Base at
//! `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`. Compared to Uniswap V2 it
//! introduces:
//!
//! - A `Route { from, to, stable, factory }` struct array in place of
//!   `address[] path`. The `stable` flag toggles between a constant-sum
//!   stable curve and a constant-product volatile curve at the per-leg pool.
//! - Per-pool fees stored on the factory; calldata does not carry the fee.
//!   The adapter records a coarse heuristic (`stable ? 5 : 30` bps per leg,
//!   leg-wise max) and notes `fee_bps_estimate=N` in trace.
//!
//! Out of scope: the Aerodrome `Gauge` and `Voter` contracts (gauge voting
//! and emissions); those would be a separate adapter crate.
//!
//! ```text
//!   src/
//!     ├── lib.rs                              ← module index + re-exports
//!     ├── common.rs                           ← shared: ROUTER, Route, TokenLookup,
//!     │                                         route_endpoints, native_eth
//!     ├── swap_exact_tokens_for_tokens.rs
//!     ├── swap_exact_eth_for_tokens.rs        (payable)
//!     └── swap_exact_tokens_for_eth.rs
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
pub mod swap_exact_eth_for_tokens;
pub mod swap_exact_tokens_for_eth;
pub mod swap_exact_tokens_for_tokens;

pub use common::{
    native_eth, DecodeError, Route, TokenLookup, AERODROME_V1_ROUTER_BASE, NATIVE_ETH_SENTINEL,
};

// ---- Per-function re-exports ----------------------------------------------

pub use swap_exact_tokens_for_tokens::Adapter_ as AerodromeV1SwapExactTokensForTokensAdapter;
pub use swap_exact_tokens_for_tokens::{
    decode as decode_swap_exact_tokens_for_tokens, encode as encode_swap_exact_tokens_for_tokens,
    Params as SwapExactTokensForTokensParams, SELECTOR as SELECTOR_SWAP_EXACT_TOKENS_FOR_TOKENS,
};

pub use swap_exact_eth_for_tokens::Adapter_ as AerodromeV1SwapExactETHForTokensAdapter;
pub use swap_exact_eth_for_tokens::{
    decode as decode_swap_exact_eth_for_tokens, encode as encode_swap_exact_eth_for_tokens,
    Params as SwapExactETHForTokensParams, SELECTOR as SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
};

pub use swap_exact_tokens_for_eth::Adapter_ as AerodromeV1SwapExactTokensForETHAdapter;
pub use swap_exact_tokens_for_eth::{
    decode as decode_swap_exact_tokens_for_eth, encode as encode_swap_exact_tokens_for_eth,
    Params as SwapExactTokensForETHParams, SELECTOR as SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
};
