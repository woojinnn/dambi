//! Aerodrome Slipstream `SwapRouter` swap adapters for `policy-engine`.
//!
//! Slipstream is a Uniswap V3-shape concentrated-liquidity DEX deployed on
//! Base. It diverges from Uniswap V3 in one structural way: pools are keyed
//! on `int24 tickSpacing` instead of `uint24 fee`. tickSpacing is NOT a fee
//! — pool swap fees are stored on the pool contract and are fully decoupled
//! from tickSpacing.
//!
//! For this reason, every Slipstream swap emits `DexFacts::max_fee_bps =
//! None`. The decoded tickSpacing values are recorded in `DexTrace::steps`
//! for audit. Cedar policies that gate on `context has maxFeeBps` (e.g.
//! `policies/dex/max-fee-bps-100.cedar`) correctly do not fire for these
//! swaps, since the field is absent.
//!
//! ```text
//!   src/
//!     ├── lib.rs                   ← module declarations + re-exports
//!     ├── common.rs                ← shared: SWAP_ROUTER address, TokenLookup,
//!     │                              decode_slipstream_path, merge_dex_actions
//!     ├── exact_input_single.rs    ← `Adapter_` + `Params` + encode/decode
//!     ├── exact_input.rs
//!     ├── exact_output_single.rs
//!     └── exact_output.rs
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

pub use common::{
    decode_slipstream_path, DecodeError, TokenLookup, AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE,
};

// ---- Per-function re-exports ----------------------------------------------

pub use exact_input_single::Adapter_ as AerodromeSlipstreamExactInputSingleAdapter;
pub use exact_input_single::{
    decode as decode_exact_input_single, encode as encode_exact_input_single,
    Params as ExactInputSingleParams, SELECTOR as SELECTOR_EXACT_INPUT_SINGLE,
};

pub use exact_input::Adapter_ as AerodromeSlipstreamExactInputAdapter;
pub use exact_input::{
    decode as decode_exact_input, encode as encode_exact_input, Params as ExactInputParams,
    SELECTOR as SELECTOR_EXACT_INPUT,
};

pub use exact_output_single::Adapter_ as AerodromeSlipstreamExactOutputSingleAdapter;
pub use exact_output_single::{
    decode as decode_exact_output_single, encode as encode_exact_output_single,
    Params as ExactOutputSingleParams, SELECTOR as SELECTOR_EXACT_OUTPUT_SINGLE,
};

pub use exact_output::Adapter_ as AerodromeSlipstreamExactOutputAdapter;
pub use exact_output::{
    decode as decode_exact_output, encode as encode_exact_output, Params as ExactOutputParams,
    SELECTOR as SELECTOR_EXACT_OUTPUT,
};
