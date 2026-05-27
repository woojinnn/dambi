//! Per-action `Reducer` trait implementations.
//!
//! Cross-cutting / low-fanout domains live as single files:
//!   - [`token`]     — `Erc20Approve` / `Permit` / `Transfer` / NFT ops
//!   - [`airdrop`]   — `Claim` / `Delegate`
//!   - [`launchpad`] — `Commit` / `ClaimAllocation` / `ClaimVested` / ...
//!
//! Protocol-rich domains use a subdirectory with one file per action and one
//! file per venue's math (Phase 2 starts with one venue per domain; the rest
//! are added by following the same pattern):
//!   - [`amm`]     — swap / add+remove liquidity / ... + `uniswap_v3`
//!   - [`lending`] — supply / borrow / repay / ... + `aave_v3`
//!   - [`perp`]    — open / close / `place_order` / ... + `hyperliquid`

pub mod airdrop;
pub mod amm;
pub mod launchpad;
pub mod lending;
pub mod perp;
pub mod token;
