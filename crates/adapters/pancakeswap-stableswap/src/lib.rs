//! PancakeSwap StableSwap pool adapters for `policy-engine`.
//!
//! StableSwap is a Curve-style constant-sum-flavoured AMM. Each pool is its
//! own contract (no central router) and exposes:
//!
//! ```solidity
//! function exchange(
//!     uint256 i,
//!     uint256 j,
//!     uint256 dx,
//!     uint256 min_dy
//! ) external payable;
//! ```
//!
//! `i`/`j` are indices into the pool's immutable `coins[N_COINS]` array. The
//! adapter ships with a `PoolRegistry` of known PancakeSwap StableSwap
//! pools on BSC (v0.1 hardcode; production drives this from the manifest).
//! `(pool, i, j)` resolves to concrete `Token` metadata; unknown pools or
//! out-of-range indices fall back to `UNKNOWN[i]` placeholder tokens so the
//! adapter still emits a structurally valid `Action::Dex` for audit.
//!
//! Calldata does not carry the pool's swap fee. The adapter emits
//! `Some(4)` (a conservative upper-bound estimate for PancakeSwap
//! StableSwap pools) and notes `fee_estimate=4bps` in trace. Hosts that
//! need precise fee enforcement must introduce a fee oracle.
//!
//! ```text
//!   src/
//!     ├── lib.rs                ← module index + re-exports
//!     ├── common.rs             ← PoolRegistry, fee estimate constant,
//!     │                          DecodeError, token resolution helpers
//!     └── exchange.rs           ← `Adapter_` + `Params` + encode/decode
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
pub mod exchange;

pub use common::{
    seeded_bsc_pools, DecodeError, PoolEntry, PoolRegistry, STABLESWAP_FEE_ESTIMATE_BPS,
};

pub use exchange::Adapter_ as PancakeSwapStableSwapExchangeAdapter;
pub use exchange::{
    decode as decode_exchange, encode as encode_exchange, Params as ExchangeParams,
    SELECTOR as SELECTOR_EXCHANGE,
};
