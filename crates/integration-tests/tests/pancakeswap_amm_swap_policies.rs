//! PancakeSwap V2 (AMM) — DEX policy battery.
//!
//! Exercises three frozen Cedar policies under
//! `policies/dex/` against the new `pancakeswap-amm` adapter:
//!
//! 1. `max-input-usd-100.cedar` — denies swaps whose USD-denominated input
//!    exceeds $100. Pass at $50, fail at $200.
//! 2. `uniswap-only-allowlist.cedar` — denies swaps whose `protocol_ids` are
//!    not on the Uniswap allowlist. PancakeSwap is intentionally NOT on the
//!    allowlist, so this is a regression test for the cross-protocol gate.
//! 3. `max-fee-bps-100.cedar` — denies swaps whose `maxFeeBps > 100`. The
//!    PancakeSwap V2 adapter emits a constant 25 bps, well under the cap.

use alloy_primitives::{Address as AlloyAddress, U256};
use policy_engine::{
    Address, HostCapabilities, MockAdapterRegistry, MockOracle, Pipeline, PolicyEngine, Token,
    TransactionRequest, Verdict,
};
use policy_engine_adapter_pancakeswap_amm::{
    encode_swap_exact_tokens_for_tokens, PancakeSwapAMMSwapExactTokensForTokensAdapter,
    SwapExactTokensForTokensParams, PANCAKESWAP_V2_ROUTER_BSC,
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
    MockAdapterRegistry::new().with_adapter(Arc::new(
        PancakeSwapAMMSwapExactTokensForTokensAdapter::new(),
    ))
}

fn swap_tx(amount_in: U256, amount_out_min: U256) -> TransactionRequest {
    let params = SwapExactTokensForTokensParams {
        amount_in,
        amount_out_min,
        path: vec![
            AlloyAddress::from_str(USDT_BSC).unwrap(),
            AlloyAddress::from_str(WBNB).unwrap(),
        ],
        to: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
    };
    TransactionRequest {
        chain_id: 56,
        from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
        to: Address::new(PANCAKESWAP_V2_ROUTER_BSC).unwrap(),
        value_wei: "0".into(),
        data: encode_swap_exact_tokens_for_tokens(&params),
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

    // 50 USDT (18 decimals on BSC).
    let tx = swap_tx(U256::from(50_000_000_000_000_000_000_u128), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn usd_cap_denies_200_usdt_swap() {
    let engine = PolicyEngine::from_sources([POLICY_USD_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(U256::from(200_000_000_000_000_000_000_u128), U256::from(1u64));
    assert!(matches!(pipe.evaluate(&tx).unwrap(), Verdict::Fail(_)));
}

#[test]
fn uniswap_only_allowlist_denies_pancakeswap_amm() {
    let engine = PolicyEngine::from_sources([POLICY_ALLOWLIST]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    let tx = swap_tx(U256::from(1_000_000_000_000_000_000_u128), U256::from(1u64));
    match pipe.evaluate(&tx).unwrap() {
        Verdict::Fail(matched) => {
            assert!(matched
                .iter()
                .any(|m| m.policy_id == "user/uniswap-only-allowlist"));
        }
        v => panic!("expected Verdict::Fail (PancakeSwap is not on allowlist), got {v:?}"),
    }
}

#[test]
fn fee_cap_passes_pancakeswap_amm_at_25_bps() {
    let engine = PolicyEngine::from_sources([POLICY_FEE_CAP]).unwrap();
    let registry = registry();
    let oracle = full_oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &engine);

    // PancakeSwap AMM emits constant 25 bps, well under the 100 bps cap.
    let tx = swap_tx(U256::from(1_000_000_000_000_000_000_u128), U256::from(1u64));
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}
