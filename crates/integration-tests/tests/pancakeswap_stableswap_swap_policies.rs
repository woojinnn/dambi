//! PancakeSwap StableSwap — DEX policy battery.
//!
//! Exercises three frozen Cedar policies against the new
//! `pancakeswap-stableswap` adapter. The adapter targets the seeded BSC
//! 2-pool (USDT/USDC) for these tests.

use alloy_primitives::U256;
use policy_engine::{
    Address, HostCapabilities, MockAdapterRegistry, MockOracle, Pipeline, PolicyEngine, Token,
    TransactionRequest, Verdict,
};
use policy_engine_adapter_pancakeswap_stableswap::{
    encode_exchange, seeded_bsc_pools, ExchangeParams, PancakeSwapStableSwapExchangeAdapter,
};
use std::sync::Arc;

const POLICY_FEE_CAP: &str = include_str!("../../../policies/dex/max-fee-bps-100.cedar");
const POLICY_ALLOWLIST: &str = include_str!("../../../policies/dex/uniswap-only-allowlist.cedar");
const POLICY_USD_CAP: &str = include_str!("../../../policies/dex/max-input-usd-100.cedar");

const USDT_BSC: &str = "0x55d398326f99059fF775485246999027B3197955";
const USDC_BSC: &str = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

fn usdt_bsc_token() -> Token {
    Token {
        chain_id: 56,
        address: Address::new(USDT_BSC).unwrap(),
        symbol: "USDT".into(),
        decimals: 18,
        is_native: false,
    }
}

fn usdc_bsc_token() -> Token {
    Token {
        chain_id: 56,
        address: Address::new(USDC_BSC).unwrap(),
        symbol: "USDC".into(),
        decimals: 18,
        is_native: false,
    }
}

fn full_oracle() -> MockOracle {
    MockOracle::new()
        .with_simple_price(&usdt_bsc_token(), "1.0000", 5)
        .with_simple_price(&usdc_bsc_token(), "1.0000", 5)
}

fn registry() -> MockAdapterRegistry {
    MockAdapterRegistry::new()
        .with_adapter(Arc::new(PancakeSwapStableSwapExchangeAdapter::new()))
}

fn pool_address() -> Address {
    seeded_bsc_pools().into_iter().next().unwrap().address
}

fn swap_tx(dx: U256, min_dy: U256) -> TransactionRequest {
    let params = ExchangeParams {
        i: U256::from(0u64), // USDT
        j: U256::from(1u64), // USDC
        dx,
        min_dy,
    };
    TransactionRequest {
        chain_id: 56,
        from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
        to: pool_address(),
        value_wei: "0".into(),
        data: encode_exchange(&params),
        gas: None,
        nonce: None,
    }
}

#[test]
fn usd_cap_passes_50_usdt_swap() {
    let engine = PolicyEngine::from_sources([POLICY_USD_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // 50 USDT (18 decimals on BSC) — under the $100 cap.
    let tx = swap_tx(
        U256::from(50_000_000_000_000_000_000_u128),
        U256::from(49_500_000_000_000_000_000_u128),
    );
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn usd_cap_denies_200_usdt_swap() {
    let engine = PolicyEngine::from_sources([POLICY_USD_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(
        U256::from(200_000_000_000_000_000_000_u128),
        U256::from(199_000_000_000_000_000_000_u128),
    );
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn uniswap_only_allowlist_denies_pancakeswap_stableswap() {
    let engine = PolicyEngine::from_sources([POLICY_ALLOWLIST]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(
        U256::from(1_000_000_000_000_000_000_u128),
        U256::from(990_000_000_000_000_000_u64),
    );
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn fee_cap_passes_pancakeswap_stableswap_at_4_bps_estimate() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // The adapter emits Some(4) as a conservative estimate, well under the
    // 100 bps cap.
    let tx = swap_tx(
        U256::from(1_000_000_000_000_000_000_u128),
        U256::from(990_000_000_000_000_000_u64),
    );
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}
