//! PancakeSwap V3 SwapRouter swap adapters for `policy-engine`.
//!
//! PancakeSwap V3 on BSC is an ABI-level fork of Uniswap V3 SwapRouter at
//! `0x1b81D678ffb9C0263b24A97847620C99d213eB14`. The
//! `ExactInputSingleParams` / `ExactInputParams` / `ExactOutputSingleParams` /
//! `ExactOutputParams` struct definitions are byte-identical, so all four
//! core selectors plus both `multicall` overloads match Uniswap V3's. This
//! crate emits `protocol_ids = vec!["pancakeswap-v3"]` and a `max_fee_bps`
//! decoded from each call's `fee` field (`fee / 100`, with 100/500/2500/10000
//! → 1/5/25/100 bps).
//!
//! ```text
//!   src/
//!     ├── lib.rs                   ← module declarations + re-exports
//!     ├── common.rs                ← shared: SWAP_ROUTER address, TokenLookup,
//!     │                              decode_v3_path, merge_dex_actions
//!     ├── exact_input_single.rs    ← `Adapter_` + `Params` + encode/decode
//!     ├── exact_input.rs
//!     ├── exact_output_single.rs
//!     ├── exact_output.rs
//!     └── multicall.rs
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
pub mod exact_input;
pub mod exact_input_single;
pub mod exact_output;
pub mod exact_output_single;
pub mod multicall;

pub use common::{decode_v3_path, DecodeError, TokenLookup, PANCAKESWAP_V3_SWAP_ROUTER_BSC};

// ---- Per-function re-exports ----------------------------------------------

pub use exact_input_single::Adapter_ as PancakeSwapV3ExactInputSingleAdapter;
pub use exact_input_single::{
    decode as decode_exact_input_single, encode as encode_exact_input_single,
    Params as ExactInputSingleParams, SELECTOR as SELECTOR_EXACT_INPUT_SINGLE,
};

pub use exact_input::Adapter_ as PancakeSwapV3ExactInputAdapter;
pub use exact_input::{
    decode as decode_exact_input, encode as encode_exact_input, Params as ExactInputParams,
    SELECTOR as SELECTOR_EXACT_INPUT,
};

pub use exact_output_single::Adapter_ as PancakeSwapV3ExactOutputSingleAdapter;
pub use exact_output_single::{
    decode as decode_exact_output_single, encode as encode_exact_output_single,
    Params as ExactOutputSingleParams, SELECTOR as SELECTOR_EXACT_OUTPUT_SINGLE,
};

pub use exact_output::Adapter_ as PancakeSwapV3ExactOutputAdapter;
pub use exact_output::{
    decode as decode_exact_output, encode as encode_exact_output, Params as ExactOutputParams,
    SELECTOR as SELECTOR_EXACT_OUTPUT,
};

pub use multicall::Adapter_ as PancakeSwapV3MulticallAdapter;
pub use multicall::{
    decode as decode_multicall, encode_deadline as encode_multicall_deadline,
    encode_no_deadline as encode_multicall_no_deadline, Params as MulticallParams,
    SELECTOR_DEADLINE as SELECTOR_MULTICALL_DEADLINE,
    SELECTOR_NO_DEADLINE as SELECTOR_MULTICALL_NO_DEADLINE,
};
