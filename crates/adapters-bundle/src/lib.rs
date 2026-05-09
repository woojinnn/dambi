//! Aggregator crate: turns the directory of internal adapter crates
//! (`crates/adapters/*`) into a single `MockAdapterRegistry` that pipeline
//! tests/examples can use as a drop-in "virtual registry".
//!
//! Adding a new internal adapter is a two-step:
//! 1. Create a new crate under `crates/adapters/<name>/` and add it to the
//!    workspace `members` list.
//! 2. Add a `policy-engine-adapter-<name>` dependency here and one
//!    `.with_adapter(...)` line in [`default_registry`].

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
#![cfg_attr(not(test), warn(clippy::expect_used))]
#![cfg_attr(not(test), warn(clippy::panic))]
#![cfg_attr(not(test), warn(clippy::unwrap_used))]

use policy_engine::{MockAdapterRegistry, MockSignatureRegistry, TypedAdapter};
use std::sync::Arc;

// All first-party adapter crates are re-exported under their module name so
// downstream code (tests, examples) doesn't need to depend on each one.
pub use policy_engine_adapter_aerodrome_slipstream as aerodrome_slipstream;
pub use policy_engine_adapter_aerodrome_v1 as aerodrome_v1;
pub use policy_engine_adapter_eip2612 as eip2612;
pub use policy_engine_adapter_pancakeswap_amm as pancakeswap_amm;
pub use policy_engine_adapter_pancakeswap_stableswap as pancakeswap_stableswap;
pub use policy_engine_adapter_pancakeswap_v3 as pancakeswap_v3;
pub use policy_engine_adapter_permit2 as permit2;
pub use policy_engine_adapter_uniswap_v2 as uniswap_v2;
pub use policy_engine_adapter_uniswap_v3 as uniswap_v3;
pub use policy_engine_adapter_universal_router as universal_router;

/// Build a `MockAdapterRegistry` populated with every first-party swap
/// adapter shipped in this workspace.
///
/// Tests or examples that want all known adapters installed should call this.
/// Tests that want a narrower setup should build the registry by hand.
#[must_use]
pub fn default_registry() -> MockAdapterRegistry {
    MockAdapterRegistry::new()
        // Uniswap Universal Router
        .with_factory(universal_router::Adapter_::factory())
        // Uniswap V3 SwapRouter
        .with_factory(uniswap_v3::UniswapV3ExactInputSingleAdapter::factory())
        .with_adapter(Arc::new(uniswap_v3::UniswapV3ExactInputAdapter::new()))
        .with_adapter(Arc::new(
            uniswap_v3::UniswapV3ExactOutputSingleAdapter::new(),
        ))
        .with_adapter(Arc::new(uniswap_v3::UniswapV3ExactOutputAdapter::new()))
        .with_adapter(Arc::new(uniswap_v3::UniswapV3MulticallAdapter::new()))
        // Uniswap V2 Router02
        .with_adapter(Arc::new(
            uniswap_v2::UniswapV2SwapExactTokensForTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            uniswap_v2::UniswapV2SwapTokensForExactTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            uniswap_v2::UniswapV2SwapExactETHForTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            uniswap_v2::UniswapV2SwapETHForExactTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            uniswap_v2::UniswapV2SwapExactTokensForETHAdapter::new(),
        ))
        .with_adapter(Arc::new(
            uniswap_v2::UniswapV2SwapTokensForExactETHAdapter::new(),
        ))
        // PancakeSwap V2 (AMM) Router on BSC
        .with_adapter(Arc::new(
            pancakeswap_amm::PancakeSwapAMMSwapExactTokensForTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            pancakeswap_amm::PancakeSwapAMMSwapTokensForExactTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            pancakeswap_amm::PancakeSwapAMMSwapExactETHForTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            pancakeswap_amm::PancakeSwapAMMSwapETHForExactTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            pancakeswap_amm::PancakeSwapAMMSwapExactTokensForETHAdapter::new(),
        ))
        .with_adapter(Arc::new(
            pancakeswap_amm::PancakeSwapAMMSwapTokensForExactETHAdapter::new(),
        ))
        // PancakeSwap V3 SwapRouter on BSC
        .with_factory(pancakeswap_v3::PancakeSwapV3ExactInputSingleAdapter::factory())
        .with_adapter(Arc::new(pancakeswap_v3::PancakeSwapV3ExactInputAdapter::new()))
        .with_adapter(Arc::new(
            pancakeswap_v3::PancakeSwapV3ExactOutputSingleAdapter::new(),
        ))
        .with_adapter(Arc::new(pancakeswap_v3::PancakeSwapV3ExactOutputAdapter::new()))
        .with_adapter(Arc::new(pancakeswap_v3::PancakeSwapV3MulticallAdapter::new()))
        // PancakeSwap StableSwap (per-pool exchange) on BSC
        .with_adapter(Arc::new(
            pancakeswap_stableswap::PancakeSwapStableSwapExchangeAdapter::new(),
        ))
        // Aerodrome V1 (Solidly fork) Router on Base
        .with_adapter(Arc::new(
            aerodrome_v1::AerodromeV1SwapExactTokensForTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            aerodrome_v1::AerodromeV1SwapExactETHForTokensAdapter::new(),
        ))
        .with_adapter(Arc::new(
            aerodrome_v1::AerodromeV1SwapExactTokensForETHAdapter::new(),
        ))
        // Aerodrome Slipstream SwapRouter on Base
        .with_factory(
            aerodrome_slipstream::AerodromeSlipstreamExactInputSingleAdapter::factory(),
        )
        .with_adapter(Arc::new(
            aerodrome_slipstream::AerodromeSlipstreamExactInputAdapter::new(),
        ))
        .with_adapter(Arc::new(
            aerodrome_slipstream::AerodromeSlipstreamExactOutputSingleAdapter::new(),
        ))
        .with_adapter(Arc::new(
            aerodrome_slipstream::AerodromeSlipstreamExactOutputAdapter::new(),
        ))
}

/// Build a `MockSignatureRegistry` populated with first-party signature
/// adapters.
#[must_use]
pub fn default_signature_registry() -> MockSignatureRegistry {
    MockSignatureRegistry::new()
        .with_adapter(Arc::new(permit2::Permit2Adapter::new()))
        .with_adapter(Arc::new(eip2612::Eip2612Adapter::new()))
}
