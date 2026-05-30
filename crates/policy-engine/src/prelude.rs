//! Curated import surface for adapter authors and pipeline integrators.
//!
//! ```ignore
//! use policy_engine::prelude::*;
//! ```
//!
//! Re-exports the shared action scalar newtypes, the surviving `core` domain
//! types, the v3 `ActionBody` lowering bridge, and the `PolicyEngine` /
//! `PolicyRequest` / `Verdict` evaluation surface.

pub use crate::action::{
    Address as ActionAddress, AmountConstraint, AmountKind, AssetKind, AssetRef,
    AssetRefWithAmountConstraint, DecimalString, Hex, Validity, ValiditySource,
};
pub use crate::core::{
    Address, AmountSpec, SignatureRequest, Token, TransactionRequest, UsdValuation,
};
pub use crate::lowering_v2::{lower_action, LoweredAction};
pub use crate::policy::{
    MatchedPolicy, PolicyEngine, PolicyEngineBuilder, PolicyError, PolicyRequest,
    PolicyRequestOrigin, Severity, Verdict,
};
