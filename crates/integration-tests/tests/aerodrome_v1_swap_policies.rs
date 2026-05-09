//! Aerodrome V1 — DEX policy battery.
//!
//! Exercises three frozen Cedar policies against the new `aerodrome-v1`
//! adapter, including separate cases for stable-pool and volatile-pool
//! routes (which yield different `max_fee_bps` heuristics).

use alloy_primitives::{Address as AlloyAddress, U256};
use policy_engine::{
    Address, HostCapabilities, MockAdapterRegistry, MockOracle, Pipeline, PolicyEngine, Token,
    TransactionRequest, Verdict,
};
use policy_engine_adapter_aerodrome_v1::{
    encode_swap_exact_tokens_for_tokens, AerodromeV1SwapExactTokensForTokensAdapter, Route,
    SwapExactTokensForTokensParams, AERODROME_V1_ROUTER_BASE,
};
use std::str::FromStr;
use std::sync::Arc;

const POLICY_FEE_CAP: &str = include_str!("../../../policies/dex/max-fee-bps-100.cedar");
const POLICY_ALLOWLIST: &str = include_str!("../../../policies/dex/uniswap-only-allowlist.cedar");
const POLICY_USD_CAP: &str = include_str!("../../../policies/dex/max-input-usd-100.cedar");

const USDC_BASE: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE: &str = "0x4200000000000000000000000000000000000006";
const FACTORY: &str = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
const RECIPIENT: &str = "0x1111111111111111111111111111111111111111";

fn usdc_token() -> Token {
    Token {
        chain_id: 8453,
        address: Address::new(USDC_BASE).unwrap(),
        symbol: "USDC".into(),
        decimals: 6,
        is_native: false,
    }
}

fn weth_token() -> Token {
    Token {
        chain_id: 8453,
        address: Address::new(WETH_BASE).unwrap(),
        symbol: "WETH".into(),
        decimals: 18,
        is_native: false,
    }
}

fn full_oracle() -> MockOracle {
    MockOracle::new()
        .with_simple_price(&usdc_token(), "1.0000", 5)
        .with_simple_price(&weth_token(), "3000.0000", 5)
}

fn registry() -> MockAdapterRegistry {
    MockAdapterRegistry::new().with_adapter(Arc::new(
        AerodromeV1SwapExactTokensForTokensAdapter::new(),
    ))
}

fn volatile_route_tx(amount_in: U256, amount_out_min: U256) -> TransactionRequest {
    let params = SwapExactTokensForTokensParams {
        amount_in,
        amount_out_min,
        routes: vec![Route {
            from: AlloyAddress::from_str(USDC_BASE).unwrap(),
            to: AlloyAddress::from_str(WETH_BASE).unwrap(),
            stable: false, // volatile → 30 bps estimate
            factory: AlloyAddress::from_str(FACTORY).unwrap(),
        }],
        to: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
    };
    TransactionRequest {
        chain_id: 8453,
        from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
        to: Address::new(AERODROME_V1_ROUTER_BASE).unwrap(),
        value_wei: "0".into(),
        data: encode_swap_exact_tokens_for_tokens(&params),
        gas: None,
        nonce: None,
    }
}

fn stable_route_tx(amount_in: U256, amount_out_min: U256) -> TransactionRequest {
    let params = SwapExactTokensForTokensParams {
        amount_in,
        amount_out_min,
        routes: vec![Route {
            from: AlloyAddress::from_str(USDC_BASE).unwrap(),
            to: AlloyAddress::from_str(WETH_BASE).unwrap(),
            stable: true, // stable → 5 bps estimate
            factory: AlloyAddress::from_str(FACTORY).unwrap(),
        }],
        to: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
    };
    TransactionRequest {
        chain_id: 8453,
        from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
        to: Address::new(AERODROME_V1_ROUTER_BASE).unwrap(),
        value_wei: "0".into(),
        data: encode_swap_exact_tokens_for_tokens(&params),
        gas: None,
        nonce: None,
    }
}

#[test]
fn usd_cap_passes_50_usdc_swap() {
    let engine = PolicyEngine::from_sources([POLICY_USD_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // 50 USDC (6 decimals on Base).
    let tx = volatile_route_tx(U256::from(50_000_000u64), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn usd_cap_denies_200_usdc_swap() {
    let engine = PolicyEngine::from_sources([POLICY_USD_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = volatile_route_tx(U256::from(200_000_000u64), U256::from(1u64));
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn uniswap_only_allowlist_denies_aerodrome_v1() {
    let engine = PolicyEngine::from_sources([POLICY_ALLOWLIST]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = volatile_route_tx(U256::from(1_000_000u64), U256::from(1u64));
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn fee_cap_passes_aerodrome_volatile_30_bps_estimate() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // Volatile route → 30 bps estimate, well under cap.
    let tx = volatile_route_tx(U256::from(1_000_000u64), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn fee_cap_passes_aerodrome_stable_5_bps_estimate() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // Stable route → 5 bps estimate.
    let tx = stable_route_tx(U256::from(1_000_000u64), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}
