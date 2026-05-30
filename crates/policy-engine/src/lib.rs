//! Web3 wallet transaction policy engine — runtime crate.
//!
//! This crate hosts the pieces an end-to-end pipeline needs at runtime:
//!
//! - **`action`**: shared scalar newtypes (`Address`, `DecimalString`, …) plus
//!   the v3 `ActionBody` bridge (`action::v3`).
//! - **`core`**: shared domain types (`Address`, `Token`, `AmountSpec`,
//!   `UsdValuation`, `TransactionRequest`, `SignatureRequest`) consumed by
//!   adapters and Policy RPC integrations.
//! - **`policy`**: `PolicyEngine` (Cedar wrapper) and the `PolicyRequest`
//!   shape that lowering produces and the engine consumes.
//! - **`lowering_v2`**: [`lower_action`] — the bridge from the v3 `ActionBody`
//!   to a `LoweredAction`.
//! - **`prelude`**: the curated import surface
//!   (`use policy_engine::prelude::*;`).
//! - **`schema`**: bundled Cedar schema composition.

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
// `unreachable_pub` already catches over-broad visibility; `pub(crate)` in a
// private module is the more honest spelling for crate-internal helpers.
#![allow(clippy::redundant_pub_crate)]
#![cfg_attr(not(test), warn(clippy::expect_used))]
#![cfg_attr(not(test), warn(clippy::panic))]
#![cfg_attr(not(test), warn(clippy::unwrap_used))]

pub mod action;
pub mod cedar_json;
pub mod context_keys;
pub mod core;
pub mod lowering_v2;
pub mod policy;
pub mod policy_rpc;
pub mod prelude;
pub mod schema;

pub use action::{
    Address as ActionAddress, AmountConstraint, AmountKind, AssetKind, AssetRef,
    AssetRefWithAmountConstraint, DecimalString, Hex, Validity, ValiditySource,
};
pub use core::{Address, AmountSpec, SignatureRequest, Token, TransactionRequest, UsdValuation};
pub use lowering_v2::{lower_action, LoweredAction};
pub use policy::{
    MatchedPolicy, PolicyEngine, PolicyEngineBuilder, PolicyError, PolicyRequest,
    PolicyRequestOrigin, Severity, Verdict,
};
pub use schema::PolicySchemaComposer;
