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
//! - [`protocols`] — per-protocol parsers (e.g. Uniswap V3 packed path,
//!   Universal Router opcode table).
//! - [`recurse`] — Cat A: recognise multicall-style wrappers and extract the
//!   inner sub-calldata so the orchestrator can recurse with the same
//!   resolver.
//! - [`opcode_stream`] — Cat B: dispatch the parallel `(commands, inputs)`
//!   shape used by the Uniswap / Pancake Universal Routers and the V4
//!   PositionManager.
//!
//! Generic engine pieces for the remaining categories (enum-tagged
//! discriminators, hook-data fallbacks) will live alongside as they're
//! filled in.

pub mod opcode_stream;
pub mod protocols;
pub mod recurse;
