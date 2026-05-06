//! Curated import surface for **adapter authors**.
//!
//! ```ignore
//! use policy_engine::prelude::*;
//! ```
//!
//! This module re-exports the trait surface and supporting types an
//! adapter implementation typically needs: the `Adapter` trait, `AdapterId`,
//! `AdapterError`, `MatchKey`, the domain types (`Action`, `Token`,
//! `TransactionRequest`, `AmountSpec`, `UsdValuation`, `DexAction`), and
//! the `Oracle` trait + `PolicyRequest` (used by the policy evaluator surface).
//!
//! `alloy_primitives` and `alloy_sol_types` are *not* re-exported. The
//! `sol!` macro hard-codes its expanded code's paths to `::alloy_sol_types`,
//! so adapter crates must depend on those crates directly anyway; an
//! intermediate re-export would only mislead callers.

pub use crate::adapter::{
    ActionKind, Adapter, AdapterDescriptor, AdapterError, AdapterFactory, AdapterId, AdapterKind,
    ContractTarget, MatchKey, SolidityFunction, SolidityFunctionSpec, StaticAdapterFactory,
    TypedAdapter,
};
pub use crate::core::{
    Action, Address, AmountSpec, ChainId, DexAction, DexFacts, DexTrace, OracleRequirement,
    OracleRequirementKind, OtherAction, Token, TransactionRequest, UsdValuation,
    WindowStatsContext,
};
pub use crate::host::HostCapabilities;
pub use crate::host::Oracle;
pub use crate::host::{Approvals, ApprovalsError, MockApprovals};
pub use crate::host::{
    MockPortfolio, Portfolio, PortfolioError, StatDelta, StatKey, StatValue, StatWindows,
};
pub use crate::lowering::{
    compute_dex_window_deltas, enrich_dex_action, enrich_dex_action_base, enrich_dex_window_stats,
    requests_from_actions,
};
pub use crate::policy::PolicyRequest;
