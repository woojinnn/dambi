use alloy_primitives::{Address as AlloyAddress, U256};
use alloy_sol_types::SolValue;
use policy_engine::{
    Address, HostCapabilities, MockAdapterRegistry, MockOracle, Pipeline, PolicyEngine, RequestKind,
    Token, TransactionRequest, Verdict,
};
use policy_engine_adapters_bundle::{default_registry, uniswap_v2, uniswap_v3, universal_router};
use std::str::FromStr;

const POLICY_TX_CAP: &str = include_str!("../../../policies/tx/tx-total-input-usd-cap-500.cedar");
const POLICY_TX_BLOCKLIST: &str = include_str!("../../../policies/tx/tx-blocklist.cedar");
const POLICY_LEAF_FEE_BPS: &str = include_str!("../../../policies/swap/max-swap-fee-bps-100.cedar");

const POLICY_TX_SHAPE: &str = r#"
@id("user/tx-shape-check")
@severity("deny")
@reason("send_tx context mismatch")
forbid (principal, action == Action::"send_tx", resource)
when {
    !(context.chainId == 1
    && context.from == "0x0000000000000000000000000000000000000001"
    && context.to == "0x7a250d5630b4cf539739df2c5dacb4c659f2488d"
    && context.valueWei == "0"
    && context.selector == "0x38ed1739"
    && context.childCount == 1
    && context.kinds == ["swap"]
    && context.protocolsUsed == ["uniswap-v2"]
    && context.hasApprove == false
    && context.hasUnknown == false
    && context.distinctRecipients == 1
    && context has "totalInputUsd")
};
"#;

const POLICY_TX_WARNING: &str = r#"
@id("user/tx-warning-input")
@severity("warn")
@reason("Transaction should warn on any tx input")
forbid (principal, action == Action::"send_tx", resource)
when {
  context has "totalInputUsd" && context.totalInputUsd.greaterThan(decimal("0.00"))
};
"#;

const POLICY_TX_ALLOW_REVERT: &str = r#"
@id("user/tx-allow-revert-count")
@severity("deny")
@reason("Transaction has allowRevert leaves")
forbid (principal, action == Action::"send_tx", resource)
when {
  context has "allowRevertCount" && context.allowRevertCount == 1
};
"#;

const V2_ROUTER: &str = uniswap_v2::UNISWAP_V2_ROUTER_MAINNET;
const V3_ROUTER: &str = uniswap_v3::SWAP_ROUTER_MAINNET;
const UNIVERSAL_ROUTER: &str = universal_router::common::UNIVERSAL_ROUTER_MAINNET;

const USDT: &str = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH: &str = "0xC02aaA39b223FE8D0a0e5C4F27eAD9083C756Cc2";
const RECIPIENT: &str = "0x1111111111111111111111111111111111111111";
const FROM: &str = "0x0000000000000000000000000000000000000001";

fn usdt() -> Token {
    Token {
        chain_id: 1,
        address: Address::new(USDT).unwrap(),
        symbol: "USDT".into(),
        decimals: 6,
        is_native: false,
    }
}

fn weth() -> Token {
    Token {
        chain_id: 1,
        address: Address::new(WETH).unwrap(),
        symbol: "WETH".into(),
        decimals: 18,
        is_native: false,
    }
}

fn oracle() -> MockOracle {
    MockOracle::new()
        .with_simple_price(&usdt(), "1.0000", 5)
        .with_simple_price(&weth(), "3000.0000", 8)
}

fn v2_swap_tx(amount_in: u64) -> TransactionRequest {
    let params = uniswap_v2::SwapExactTokensForTokensParams {
        amount_in: U256::from(amount_in),
        amount_out_min: U256::ZERO,
        path: vec![
            AlloyAddress::from_str(USDT).unwrap(),
            AlloyAddress::from_str(WETH).unwrap(),
        ],
        to: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
    };
    TransactionRequest {
        chain_id: 1,
        from: Address::new(FROM).unwrap(),
        to: Address::new(V2_ROUTER).unwrap(),
        value_wei: "0".into(),
        data: uniswap_v2::encode_swap_exact_tokens_for_tokens(&params),
        gas: None,
        nonce: None,
    }
}

fn v3_exact_input_single(amount_in: u64, fee: u32) -> TransactionRequest {
    let params = uniswap_v3::ExactInputSingleParams {
        token_in: AlloyAddress::from_str(USDT).unwrap(),
        token_out: AlloyAddress::from_str(WETH).unwrap(),
        fee,
        recipient: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
        amount_in: U256::from(amount_in),
        amount_out_minimum: U256::ZERO,
        sqrt_price_limit_x96: U256::ZERO,
    };
    v3_exact_input_single_tx(params)
}

fn v3_exact_input_single_tx(params: uniswap_v3::ExactInputSingleParams) -> TransactionRequest {
    TransactionRequest {
        chain_id: 1,
        from: Address::new(FROM).unwrap(),
        to: Address::new(V3_ROUTER).unwrap(),
        value_wei: "0".into(),
        data: uniswap_v3::encode_exact_input_single(&params),
        gas: None,
        nonce: None,
    }
}

fn v3_multicall_tx() -> TransactionRequest {
    let input = v3_exact_input_single_tx_data(260_000_000, 3000);
    let input2 = v3_exact_input_single_tx_data(260_000_000, 3000);

    TransactionRequest {
        chain_id: 1,
        from: Address::new(FROM).unwrap(),
        to: Address::new(V3_ROUTER).unwrap(),
        value_wei: "0".into(),
        data: uniswap_v3::encode_multicall_deadline(
            U256::from(9_999_999_999u64),
            vec![input, input2],
        ),
        gas: None,
        nonce: None,
    }
}

fn v3_exact_input_single_tx_data(amount_in: u64, fee: u32) -> Vec<u8> {
    let params = uniswap_v3::ExactInputSingleParams {
        token_in: AlloyAddress::from_str(USDT).unwrap(),
        token_out: AlloyAddress::from_str(WETH).unwrap(),
        fee,
        recipient: AlloyAddress::from_str(RECIPIENT).unwrap(),
        deadline: U256::from(9_999_999_999u64),
        amount_in: U256::from(amount_in),
        amount_out_minimum: U256::ZERO,
        sqrt_price_limit_x96: U256::ZERO,
    };
    uniswap_v3::encode_exact_input_single(&params)
}

fn v3_path(token_a: &str, fee: u32, token_b: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(AlloyAddress::from_str(token_a).unwrap().as_slice());
    out.extend_from_slice(&fee.to_be_bytes()[1..4]);
    out.extend_from_slice(AlloyAddress::from_str(token_b).unwrap().as_slice());
    out
}

#[test]
fn single_v2_swap_under_cap_passes_and_shape_is_valid() {
    let registry = default_registry();
    let policies = PolicyEngine::from_sources([POLICY_TX_SHAPE, POLICY_TX_CAP]).unwrap();
    let oracle = oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &policies);

    let tx = v2_swap_tx(50_000_000);
    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn multicall_v3_with_two_leaves_exceeds_tx_total_input_and_fails_on_tx_origin() {
    let registry = default_registry();
    let policies = PolicyEngine::from_sources([POLICY_TX_CAP]).unwrap();
    let oracle = oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &policies);

    let verdict = pipe.evaluate(&v3_multicall_tx()).unwrap();
    match verdict {
        Verdict::Fail(matched) => {
            assert_eq!(matched.len(), 1);
            assert_eq!(matched[0].policy_id, "user/tx-total-input-usd-cap-500");
            assert!(matches!(matched[0].origin, RequestKind::Tx));
        }
        _ => panic!("expected Verdict::Fail, got {verdict:?}"),
    }
}

#[test]
fn tx_level_warning_and_leaf_deny_report_distinct_origins() {
    let registry = default_registry();
    let policies = PolicyEngine::from_sources([POLICY_TX_WARNING, POLICY_LEAF_FEE_BPS]).unwrap();
    let oracle = oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &policies);

    let verdict = pipe.evaluate(&v3_exact_input_single(200_000_000u64, 30_000)).unwrap();
    match verdict {
        Verdict::Fail(matched) => {
            assert_eq!(matched.len(), 2);
            assert!(matched
                .iter()
                .any(|m| matches!(m.origin, RequestKind::Leaf { index: 0 })));        
            assert!(matched
                .iter()
                .any(|m| matches!(m.origin, RequestKind::Leaf { index: 0 })
                    && m.policy_id == "user/max-swap-fee-bps-100"));
            assert!(matched
                .iter()
                .any(|m| matches!(m.origin, RequestKind::Tx)
                    && m.policy_id == "user/tx-warning-input"));
        }
        _ => panic!("expected Verdict::Fail, got {verdict:?}"),
    }
}

#[test]
fn no_match_tx_generates_other_and_tx_requests_and_allows_when_no_policies() {
    let registry = MockAdapterRegistry::new();
    let policies = PolicyEngine::from_sources(Vec::<&str>::new()).unwrap();
    let oracle = oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &policies);

    let tx = TransactionRequest {
        chain_id: 1,
        from: Address::new(FROM).unwrap(),
        to: Address::new("0x000000000000000000000000000000000000beef").unwrap(),
        value_wei: "0".into(),
        data: vec![0xde, 0xad, 0xbe, 0xef],
        gas: None,
        nonce: None,
    };

    assert_eq!(pipe.evaluate(&tx).unwrap(), Verdict::Pass);
}

#[test]
fn pure_eth_transfer_without_selector_is_blocklisted_by_tx_resource() {
    let registry = MockAdapterRegistry::new();
    let policies = PolicyEngine::from_sources([POLICY_TX_BLOCKLIST]).unwrap();
    let oracle = oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &policies);

    let tx = TransactionRequest {
        chain_id: 1,
        from: Address::new(FROM).unwrap(),
        to: Address::new("0x000000000000000000000000000000000000dead").unwrap(),
        value_wei: "1230000000000000000".into(),
        data: vec![],
        gas: None,
        nonce: None,
    };

    match pipe.evaluate(&tx).unwrap() {
        Verdict::Fail(matched) => {
            assert_eq!(matched.len(), 1);
            assert_eq!(matched[0].policy_id, "user/tx-blocklist");
            assert!(matches!(matched[0].origin, RequestKind::Tx));
        }
        v => panic!("expected Verdict::Fail, got {v:?}"),
    }
}

#[test]
fn universal_router_execute_allow_revert_metadata_is_counted_on_tx_request() {
    let registry = default_registry();
    let policies = PolicyEngine::from_sources([POLICY_TX_ALLOW_REVERT]).unwrap();
    let oracle = oracle();
    let pipe = Pipeline::new(&registry, HostCapabilities::new(&oracle), &policies);

    let input = (
        AlloyAddress::from_str(RECIPIENT).unwrap(),
        U256::from(50_000_000u64),
        U256::ZERO,
        v3_path(USDT, 3000, WETH),
        true,
        Vec::<U256>::new(),
    )
        .abi_encode_sequence();

    let tx = TransactionRequest {
        chain_id: 1,
        from: Address::new(FROM).unwrap(),
        to: Address::new(UNIVERSAL_ROUTER).unwrap(),
        value_wei: "0".into(),
        data: universal_router::encode_execute(vec![0x80], vec![input]),
        gas: None,
        nonce: None,
    };

    match pipe.evaluate(&tx).unwrap() {
        Verdict::Fail(matched) => {
            assert_eq!(matched.len(), 1);
            assert_eq!(matched[0].policy_id, "user/tx-allow-revert-count");
            assert!(matches!(matched[0].origin, RequestKind::Tx));
        }
        v => panic!("expected Verdict::Fail, got {v:?}"),
    }
}
