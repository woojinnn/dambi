//! `YieldAction` — yield-tokenization protocols (Pendle V2): PT/YT trading,
//! market liquidity, PT+YT mint/redeem, SY wrap/unwrap, and interest/reward
//! claim.
//!
//! New domain (extension-guide axis 1). Mirrors the `liquid_staking` layout: a
//! venue enum (`YieldVenue`) + per-action structs + `action_tag()` /
//! `venue_name()`. Pendle is market-centric and one-sided: calldata carries the
//! `market` (or `yt`/`sy`) locator + the plain external token + amounts +
//! recipient, while the PT/YT/SY counter-instruments and maturity are derived
//! from the market — those are deferred to the §4d enrichment pass (P1c), so the
//! P1a structs are faithful static decodes with no `LiveField`.
//!
//! Action tags are deliberately Pendle/yield-specific (`pt_swap`, `yt_swap`,
//! `add_market_liquidity`, …) rather than the generic `swap`/`add_liquidity`:
//! `REGISTERED_ACTIONS` requires globally-unique bare tags (composer/
//! manifest_fragment look up by bare name), and the unique names are also more
//! user-legible ("buy PT to maturity" ≠ a generic AMM trade).

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::primitives::ChainId;

pub mod add_market_liquidity;
pub mod claim_yield;
pub mod mint_py;
pub mod mint_sy;
pub mod pt_swap;
pub mod redeem_py;
pub mod redeem_sy;
pub mod remove_market_liquidity;
pub mod yt_swap;

pub use self::add_market_liquidity::*;
pub use self::claim_yield::*;
pub use self::mint_py::*;
pub use self::mint_sy::*;
pub use self::pt_swap::*;
pub use self::redeem_py::*;
pub use self::redeem_sy::*;
pub use self::remove_market_liquidity::*;
pub use self::yt_swap::*;

/// User-level yield-tokenization actions across supported venues (Pendle V2).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum YieldAction {
    /// Swap a token/SY into PT or PT back into a token/SY (the PT side of the
    /// market). Covers `swapExact{Token,Sy}ForPt` / `swapExactPtFor{Token,Sy}`.
    PtSwap(PtSwapAction),
    /// Swap a token/SY into YT or YT back into a token/SY (the YT side).
    /// Covers `swapExact{Token,Sy}ForYt` / `swapExactYtFor{Token,Sy}`.
    YtSwap(YtSwapAction),
    /// Add liquidity to a Pendle market (mint LP). Covers all `addLiquidity*`.
    AddMarketLiquidity(AddMarketLiquidityAction),
    /// Remove liquidity from a Pendle market (burn LP). Covers `removeLiquidity*`.
    RemoveMarketLiquidity(RemoveMarketLiquidityAction),
    /// Split a token/SY into the PT+YT pair (`mintPyFrom{Token,Sy}`).
    MintPy(MintPyAction),
    /// Recombine the PT+YT pair back into a token/SY (`redeemPyTo{Token,Sy}`).
    RedeemPy(RedeemPyAction),
    /// Wrap a token into its SY (`mintSyFromToken`).
    MintSy(MintSyAction),
    /// Unwrap an SY back into a token (`redeemSyToToken`).
    RedeemSy(RedeemSyAction),
    /// Claim accrued interest + rewards (`redeemDueInterestAndRewards`).
    ClaimYield(ClaimYieldAction),
}

impl YieldAction {
    /// The action's `serde` `action` tag (e.g. `"pt_swap"`, `"mint_py"`).
    ///
    /// Matches the `#[serde(tag = "action", rename_all = "snake_case")]`
    /// discriminant exactly; verified against `serde_json` output in tests.
    #[must_use]
    pub const fn action_tag(&self) -> &'static str {
        match self {
            Self::PtSwap(_) => "pt_swap",
            Self::YtSwap(_) => "yt_swap",
            Self::AddMarketLiquidity(_) => "add_market_liquidity",
            Self::RemoveMarketLiquidity(_) => "remove_market_liquidity",
            Self::MintPy(_) => "mint_py",
            Self::RedeemPy(_) => "redeem_py",
            Self::MintSy(_) => "mint_sy",
            Self::RedeemSy(_) => "redeem_sy",
            Self::ClaimYield(_) => "claim_yield",
        }
    }

    /// The venue `name` of the wrapped action. Every yield action carries a venue.
    #[must_use]
    pub const fn venue_name(&self) -> Option<&'static str> {
        match self {
            Self::PtSwap(a) => Some(a.venue.name()),
            Self::YtSwap(a) => Some(a.venue.name()),
            Self::AddMarketLiquidity(a) => Some(a.venue.name()),
            Self::RemoveMarketLiquidity(a) => Some(a.venue.name()),
            Self::MintPy(a) => Some(a.venue.name()),
            Self::RedeemPy(a) => Some(a.venue.name()),
            Self::MintSy(a) => Some(a.venue.name()),
            Self::RedeemSy(a) => Some(a.venue.name()),
            Self::ClaimYield(a) => Some(a.venue.name()),
        }
    }
}

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

/// Yield-tokenization venue identifier. Carries protocol + chain identity only;
/// the specific market / YT / SY contract is an action field (the locator
/// varies per action — market for swaps/liquidity, YT for PY mint/redeem, SY for
/// SY mint/redeem).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum YieldVenue {
    /// `Pendle V2` deployment on a given chain (Router V4 / markets / SY set).
    PendleV2 {
        /// Chain hosting the `Pendle V2` deployment.
        chain: ChainId,
    },
}

impl YieldVenue {
    /// The venue's `serde` `name` tag (e.g. `"pendle_v2"`).
    ///
    /// Matches the `#[serde(tag = "name", rename_all = "snake_case")]`
    /// discriminant exactly and is verified against `serde_json` output in tests.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::PendleV2 { .. } => "pendle_v2",
        }
    }
}
