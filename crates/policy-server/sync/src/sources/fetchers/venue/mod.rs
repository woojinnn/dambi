use async_trait::async_trait;

use policy_state::pending::PendingTx;
use policy_state::primitives::{Address, Time};

use crate::error::SyncError;

pub mod hyperliquid;
pub mod ttl_cache;
pub mod uniswap;

pub use hyperliquid::HyperliquidFetcher;
pub use uniswap::UniswapFetcher;

pub mod cow_swap;
pub mod one_inch_fusion;
pub mod uniswap_x;

pub use cow_swap::CowSwapFetcher;
pub use one_inch_fusion::OneInchFusionFetcher;
pub use uniswap_x::{UniswapXFetcher, UniswapXOrder};

// pub mod gmx;           // GM token, position state
// pub mod dydx;          // perpetual market + order indexer

/// Off-chain intent-order discovery for a single venue.
///
/// Each implementor owns its own request loop, response parsing, and projection
/// into the canonical `PendingTx` shape, so the orchestrator can dispatch over a
/// heterogeneous set of venues (`UniswapX`, `CowSwap`, `1inch Fusion`, …)
/// uniformly. `fetch_orders` returns the swapper's currently-discoverable orders
/// projected into `PendingTx`. Terminal-order pruning and upsert-by-id are
/// handled by the orchestrator's `upsert_intent_orders`, not the fetcher.
#[async_trait]
pub trait IntentFetcher: Send + Sync {
    async fn fetch_orders(&self, swapper: &Address, now: Time)
        -> Result<Vec<PendingTx>, SyncError>;
}
