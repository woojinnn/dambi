//! PancakeSwap V3 `SwapRouter` `exactInputSingle`.
//!
//! The Solidity struct, selector, and ABI layout are byte-identical to
//! Uniswap V3's; only the deployed router address, default chain, and
//! emitted protocol id differ.

#[cfg(test)]
use crate::common::PANCAKESWAP_V3_SWAP_ROUTER_BSC;
use crate::common::{dex_swap_action, swap_router_address, DecodeError, TokenLookup};
use alloy_primitives::{
    aliases::{U160, U24},
    Address as AlloyAddress, U256,
};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    #[derive(Debug)]
    struct SolExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(SolExactInputSingleParams params) external payable returns (uint256 amountOut);
}

/// Selector for `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))`.
pub const SELECTOR: [u8; 4] = exactInputSingleCall::SELECTOR;

/// Public-facing decoded parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Input token address.
    pub token_in: AlloyAddress,
    /// Output token address.
    pub token_out: AlloyAddress,
    /// Pool fee tier in hundredths of a bip (PancakeSwap V3 supports 100 / 500 / 2500 / 10000).
    pub fee: u32,
    /// Recipient address.
    pub recipient: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
    /// Exact input amount.
    pub amount_in: U256,
    /// Minimum acceptable output amount.
    pub amount_out_minimum: U256,
    /// Optional sqrt price limit (uint160 widened to U256).
    pub sqrt_price_limit_x96: U256,
}

/// ABI-encode the call.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    let sqrt_limit_u160 = if p.sqrt_price_limit_x96 > U256::from(U160::MAX) {
        U160::MAX
    } else {
        U160::from_be_slice(&p.sqrt_price_limit_x96.to_be_bytes::<32>()[12..])
    };
    let call = exactInputSingleCall {
        params: SolExactInputSingleParams {
            tokenIn: p.token_in,
            tokenOut: p.token_out,
            fee: U24::from(p.fee),
            recipient: p.recipient,
            deadline: p.deadline,
            amountIn: p.amount_in,
            amountOutMinimum: p.amount_out_minimum,
            sqrtPriceLimitX96: sqrt_limit_u160,
        },
    };
    call.abi_encode()
}

/// ABI-decode calldata that begins with the `exactInputSingle` selector.
///
/// # Errors
///
/// Returns an error when calldata is too short, has the wrong selector, fails
/// ABI decoding, or contains an out-of-range fee.
pub fn decode(calldata: &[u8]) -> Result<Params, DecodeError> {
    const NEED: usize = 4 + 8 * 32;
    if calldata.len() < 4 {
        return Err(DecodeError::TooShort {
            need: NEED,
            got: calldata.len(),
        });
    }
    let selector: [u8; 4] = [calldata[0], calldata[1], calldata[2], calldata[3]];
    if selector != SELECTOR {
        return Err(DecodeError::BadSelector {
            got: hex::encode(selector),
            want: hex::encode(SELECTOR),
        });
    }
    if calldata.len() < NEED {
        return Err(DecodeError::TooShort {
            need: NEED,
            got: calldata.len(),
        });
    }
    let call = exactInputSingleCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    let fee_u32 = u32::try_from(call.params.fee)
        .map_err(|_| DecodeError::FeeOutOfRange(call.params.fee.to_string()))?;
    Ok(Params {
        token_in: call.params.tokenIn,
        token_out: call.params.tokenOut,
        fee: fee_u32,
        recipient: call.params.recipient,
        deadline: call.params.deadline,
        amount_in: call.params.amountIn,
        amount_out_minimum: call.params.amountOutMinimum,
        sqrt_price_limit_x96: U256::from(call.params.sqrtPriceLimitX96),
    })
}

/// Adapter for PancakeSwap V3 `exactInputSingle`.
#[derive(Debug)]
pub struct Adapter_ {
    chain_targets: Vec<(ChainId, Address)>,
    tokens: TokenLookup,
}

impl Adapter_ {
    /// Construct an adapter with BSC PancakeSwap V3 SwapRouter and default token metadata.
    #[must_use]
    pub fn new() -> Self {
        Self {
            chain_targets: vec![(56, swap_router_address())],
            tokens: TokenLookup::with_bsc_defaults(),
        }
    }

    /// Returns this adapter after adding `token` to its lookup.
    #[must_use]
    pub fn with_token(mut self, token: Token) -> Self {
        self.tokens.add(token);
        self
    }
}

impl Default for Adapter_ {
    fn default() -> Self {
        Self::new()
    }
}

impl TypedAdapter for Adapter_ {
    const ADAPTER_ID: &'static str = "pancakeswap-v3/exactInputSingle@0.1.0";
    const PROTOCOL_ID: &'static str = "pancakeswap-v3";
    const KIND: AdapterKind = AdapterKind::Function;
    const FUNCTIONS: &'static [SolidityFunctionSpec] = &[SolidityFunctionSpec::new(
        "exactInputSingle",
        "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
        SELECTOR,
    )];
    const EMITTED_ACTIONS: &'static [ActionKind] = &[ActionKind::Dex];

    fn contract_targets(&self) -> Vec<ContractTarget> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| ContractTarget::new(*chain, target.clone()))
            .collect()
    }

    fn build_action(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let token_in_addr = Address::from_alloy(p.token_in);
        let token_out_addr = Address::from_alloy(p.token_out);
        let recipient_addr = Address::from_alloy(p.recipient);

        let input_token = self.tokens.get(tx.chain_id, &token_in_addr);
        let output_token = self.tokens.get(tx.chain_id, &token_out_addr);

        Ok(dex_swap_action(
            tx,
            Self::PROTOCOL_ID,
            input_token,
            output_token,
            p.amount_in.to_string(),
            Some(p.amount_out_minimum.to_string()),
            &recipient_addr,
            Some(p.fee / 100),
            "exactInputSingle",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sample_params() -> Params {
        Params {
            token_in: AlloyAddress::from_str("0x55d398326f99059fF775485246999027B3197955").unwrap(),
            token_out: AlloyAddress::from_str("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")
                .unwrap(),
            fee: 2500, // PancakeSwap V3 has a 25-bps tier (vs Uniswap V3's 30 bps)
            recipient: AlloyAddress::from_str("0x1111111111111111111111111111111111111111")
                .unwrap(),
            deadline: U256::from(9_999_999_999u64),
            amount_in: U256::from(1_000_000_000_000_000_000_u128),
            amount_out_minimum: U256::ZERO,
            sqrt_price_limit_x96: U256::ZERO,
        }
    }

    #[test]
    fn round_trip() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn selector_pin() {
        // Same selector as Uniswap V3 exactInputSingle (PancakeSwap V3 is an
        // ABI fork).
        assert_eq!(SELECTOR, [0x41, 0x4b, 0xf3, 0x89]);
    }

    #[test]
    fn build_emits_pancakeswap_v3_with_25bp_fee_tier() {
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(PANCAKESWAP_V3_SWAP_ROUTER_BSC).unwrap(),
            value_wei: "0".into(),
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build_action(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["pancakeswap-v3"]);
                assert_eq!(d.facts.input_tokens[0].symbol, "USDT");
                assert_eq!(d.facts.output_tokens[0].symbol, "WBNB");
                // 2500 / 100 = 25 bps
                assert_eq!(d.facts.max_fee_bps, Some(25));
                assert!(d.facts.has_zero_min_output);
                assert_eq!(d.trace.steps, vec!["exactInputSingle"]);
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }

    #[test]
    fn build_with_max_tier_yields_100bps() {
        let adapter = Adapter_::new();
        let mut p = sample_params();
        p.fee = 10000; // 100 bps tier (highest in PancakeSwap V3)
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(PANCAKESWAP_V3_SWAP_ROUTER_BSC).unwrap(),
            value_wei: "0".into(),
            data: encode(&p),
            gas: None,
            nonce: None,
        };
        match adapter.build_action(&tx).unwrap() {
            Action::Dex(d) => assert_eq!(d.facts.max_fee_bps, Some(100)),
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
