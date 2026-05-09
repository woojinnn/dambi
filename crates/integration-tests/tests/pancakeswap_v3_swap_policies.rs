//! PancakeSwap V3 — DEX policy battery.
//!
//! Exercises three frozen Cedar policies against the new `pancakeswap-v3`
//! adapter (`exactInputSingle` entry).

use alloy_primitives::{Address as AlloyAddress, U256};
use policy_engine::{
    Address, HostCapabilities, MockAdapterRegistry, MockOracle, Pipeline, PolicyEngine, Token,
    TransactionRequest, Verdict,
};
use policy_engine_adapter_pancakeswap_v3::{
    encode_exact_input_single, ExactInputSingleParams, PancakeSwapV3ExactInputSingleAdapter,
    PANCAKESWAP_V3_SWAP_ROUTER_BSC,
};
use std::str::FromStr;
use std::sync::Arc;

const POLICY_FEE_CAP: &str = include_str!("../../../policies/dex/max-fee-bps-100.cedar");
const POLICY_ALLOWLIST: &str = include_str!("../../../policies/dex/uniswap-only-allowlist.cedar");
const POLICY_USD_CAP: &str = include_str!("../../../policies/dex/max-input-usd-100.cedar");

const USDT_BSC: &str = "0x55d398326f99059fF775485246999027B3197955";
const WBNB: &str = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const RECIPIENT: &str = "0x1111111111111111111111111111111111111111";

fn usdt_bsc_token() -> Token {
    Token {
        chain_id: 56,
        address: Address::new(USDT_BSC).unwrap(),
        symbol: "USDT".into(),
        decimals: 18,
        is_native: false,
    }
}

fn wbnb_token() -> Token {
    Token {
        chain_id: 56,
        address: Address::new(WBNB).unwrap(),
        symbol: "WBNB".into(),
        decimals: 18,
        is_native: false,
    }
}

fn full_oracle() -> MockOracle {
    MockOracle::new()
        .with_simple_price(&usdt_bsc_token(), "1.0000", 5)
        .with_simple_price(&wbnb_token(), "300.0000", 5)
}

fn registry() -> MockAdapterRegistry {
    MockAdapterRegistry::new().with_adapter(Arc::new(PancakeSwapV3ExactInputSingleAdapter::new()))
}

fn swap_tx(fee: u32, amount_in: U256, amount_out_min: U256) -> TransactionRequest {
    let params = ExactInputSingleParams {
        token_in: AlloyAddress::from_str(USDT_BSC).unwrap(),
        token_out: AlloyAddress::from_str(WBNB).unwrap(),
        fee,
        recipient: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
        amount_in,
        amount_out_minimum: amount_out_min,
        sqrt_price_limit_x96: U256::ZERO,
    };
    TransactionRequest {
        chain_id: 56,
        from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
        to: Address::new(PANCAKESWAP_V3_SWAP_ROUTER_BSC).unwrap(),
        value_wei: "0".into(),
        data: encode_exact_input_single(&params),
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

    let tx = swap_tx(
        2500,
        U256::from(50_000_000_000_000_000_000_u128),
        U256::from(1u64),
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
        2500,
        U256::from(200_000_000_000_000_000_000_u128),
        U256::from(1u64),
    );
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn uniswap_only_allowlist_denies_pancakeswap_v3() {
    let engine = PolicyEngine::from_sources([POLICY_ALLOWLIST]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(
        2500,
        U256::from(1_000_000_000_000_000_000_u128),
        U256::from(1u64),
    );
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn fee_cap_passes_pancakeswap_v3_at_25_bps_tier() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // PancakeSwap V3 fee tier 2500 (raw) → 25 bps. Under cap.
    let tx = swap_tx(
        2500,
        U256::from(1_000_000_000_000_000_000_u128),
        U256::from(1u64),
    );
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn fee_cap_passes_pancakeswap_v3_at_max_100_bps_tier() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // PancakeSwap V3 fee tier 10000 (raw) → 100 bps == cap (forbid is `> 100`).
    let tx = swap_tx(
        10_000,
        U256::from(1_000_000_000_000_000_000_u128),
        U256::from(1u64),
    );
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}
