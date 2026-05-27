//! `simulation-reducer` — pure function that applies an `Action` to a `WalletState`.
//!
//! No external IO (no DB, no RPC, no clock). Inputs: `state` + `action` + `eval`.
//! Output: `(newState, StateDelta)`. wasm-buildable.

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

pub mod action;
pub mod error;

pub use action::{
    Action, ActionBody, ActionMeta, ActionNature, AirdropAction, AmmAction, Bytes, Eip712Domain,
    LaunchpadAction, LendingAction, PerpAction, TokenAction,
};
