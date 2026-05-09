//! Sub-decoders for non-standard ABI payloads.
//!
//! [`crate::decode`] handles the standard ABI portion of calldata. Many DeFi
//! protocols additionally pack a sub-format *inside* a `bytes` argument — for
//! example, the Uniswap V3 packed swap path inside `exactInput.params.path`.
//! This module holds parsers for those sub-formats so callers can produce a
//! structurally complete decode without each caller re-implementing the same
//! parser.
//!
//! Layout:
//!
//! - [`protocols`] — per-protocol parsers (e.g. Uniswap V3 packed path).
//!
//! Generic engine pieces (recursion controllers, opcode-stream dispatchers,
//! enum-tagged discriminators) will live alongside as the corresponding
//! categories are filled in.

pub mod protocols;
