//! `AirdropAction` — `Claim`, `Delegate`. See spec §7.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

/// `ClaimAirdropAction` and related claim-target / live-input types.
pub mod claim;
/// `DelegateGovernanceAction` and related live-input types.
pub mod delegate;

pub use self::claim::*;
pub use self::delegate::*;

/// Airdrop-related actions: claiming a one-time distribution or delegating governance voting power.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AirdropAction {
    /// Claim eligibility for a one-time airdrop (Merkle, signature, or staking-based).
    Claim(ClaimAirdropAction),
    /// Delegate governance voting power for a governance token (e.g. UNI, COMP, ENS).
    Delegate(DelegateGovernanceAction),
}
