//! Aerodrome Slipstream — DEX policy battery.
//!
//! Exercises three frozen Cedar policies against the new
//! `aerodrome-slipstream` adapter. Slipstream emits `max_fee_bps = None`,
//! so the fee-cap policy is exercised in its skip-when-absent form (the
//! `context has maxFeeBps` guard short-circuits and the `forbid` does not
//! fire).

use alloy_primitives::{Address as AlloyAddress, U256};
use policy_engine::{
    Address, HostCapabilities, MockAdapterRegistry, MockOracle, Pipeline, PolicyEngine, Token,
    TransactionRequest, Verdict,
};
use policy_engine_adapter_aerodrome_slipstream::{
    encode_exact_input_single, AerodromeSlipstreamExactInputSingleAdapter, ExactInputSingleParams,
    AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE,
};
use std::str::FromStr;
use std::sync::Arc;

const POLICY_FEE_CAP: &str = include_str!("../../../policies/dex/max-fee-bps-100.cedar");
const POLICY_ALLOWLIST: &str = include_str!("../../../policies/dex/uniswap-only-allowlist.cedar");
const POLICY_USD_CAP: &str = include_str!("../../../policies/dex/max-input-usd-100.cedar");

const USDC_BASE: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE: &str = "0x4200000000000000000000000000000000000006";
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
        AerodromeSlipstreamExactInputSingleAdapter::new(),
    ))
}

fn swap_tx(tick_spacing: i32, amount_in: U256, amount_out_min: U256) -> TransactionRequest {
    let params = ExactInputSingleParams {
        token_in: AlloyAddress::from_str(USDC_BASE).unwrap(),
        token_out: AlloyAddress::from_str(WETH_BASE).unwrap(),
        tick_spacing,
        recipient: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
        amount_in,
        amount_out_minimum: amount_out_min,
        sqrt_price_limit_x96: U256::ZERO,
    };
    TransactionRequest {
        chain_id: 8453,
        from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
        to: Address::new(AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE).unwrap(),
        value_wei: "0".into(),
        data: encode_exact_input_single(&params),
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

    let tx = swap_tx(200, U256::from(50_000_000u64), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn usd_cap_denies_200_usdc_swap() {
    let engine = PolicyEngine::from_sources([POLICY_USD_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(200, U256::from(200_000_000u64), U256::from(1u64));
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn uniswap_only_allowlist_denies_aerodrome_slipstream() {
    let engine = PolicyEngine::from_sources([POLICY_ALLOWLIST]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(200, U256::from(1_000_000u64), U256::from(1u64));
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

/// Slipstream emits `max_fee_bps = None`, so the fee-cap policy's
/// `context has maxFeeBps` guard short-circuits and the `forbid` clause
/// never fires. This is the documented design — `tickSpacing` is not a
/// fee, so the policy intentionally cannot enforce a cap on Slipstream
/// swaps without a fee oracle.
#[test]
fn fee_cap_does_not_apply_when_facts_have_no_fee() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(200, U256::from(1_000_000u64), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}
