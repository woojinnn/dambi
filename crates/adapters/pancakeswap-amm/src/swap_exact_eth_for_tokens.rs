//! PancakeSwap V2 Router `swapExactETHForTokens(uint256 amountOutMin,
//! address[] path, address to, uint256 deadline)`. Payable — `amountIn` is
//! `msg.value`, and the input token is native BNB on BSC.
//!
//! The Solidity function name preserves Uniswap V2's "ETH" wording even on
//! BSC, where the native asset is BNB. Our adapter emits `Token{symbol:"BNB"}`
//! for the input side.

#[cfg(test)]
use crate::common::PANCAKESWAP_V2_ROUTER_BSC;
use crate::common::{
    dex_swap_action, native_bnb, path_endpoints, router_address, static_adapter_id, DecodeError,
    TokenLookup,
};
use alloy_primitives::{Address as AlloyAddress, U256};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] amounts);
}

/// Selector for `swapExactETHForTokens`.
pub const SELECTOR: [u8; 4] = swapExactETHForTokensCall::SELECTOR;

/// Decoded `swapExactETHForTokens` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Minimum acceptable output token amount.
    pub amount_out_min: U256,
    /// Ordered token path, starting with WBNB and ending with output token.
    pub path: Vec<AlloyAddress>,
    /// Recipient address.
    pub to: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
}

/// ABI-encode `swapExactETHForTokens` calldata.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    swapExactETHForTokensCall {
        amountOutMin: p.amount_out_min,
        path: p.path.clone(),
        to: p.to,
        deadline: p.deadline,
    }
    .abi_encode()
}

/// Decode `swapExactETHForTokens` calldata.
///
/// # Errors
///
/// Returns an error when calldata is too short, has the wrong selector, fails
/// ABI decoding, or contains a path with fewer than two tokens.
pub fn decode(calldata: &[u8]) -> Result<Params, DecodeError> {
    if calldata.len() < 4 {
        return Err(DecodeError::TooShort {
            need: 4,
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
    let call = swapExactETHForTokensCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    if call.path.len() < 2 {
        return Err(DecodeError::EmptyPath(call.path.len()));
    }
    Ok(Params {
        amount_out_min: call.amountOutMin,
        path: call.path,
        to: call.to,
        deadline: call.deadline,
    })
}

/// Adapter for `swapExactETHForTokens`.
#[derive(Debug)]
pub struct Adapter_ {
    chain_targets: Vec<(ChainId, Address)>,
    tokens: TokenLookup,
}

impl Adapter_ {
    /// Construct an adapter with BSC PancakeSwap V2 Router and default token metadata.
    #[must_use]
    pub fn new() -> Self {
        Self {
            chain_targets: vec![(56, router_address())],
            tokens: TokenLookup::with_bsc_defaults(),
        }
    }
}

impl Default for Adapter_ {
    fn default() -> Self {
        Self::new()
    }
}

impl Adapter for Adapter_ {
    fn id(&self) -> AdapterId {
        static_adapter_id("pancakeswap-amm/swapExactETHForTokens@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| MatchKey::exact(*chain, target.clone(), SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let (_, token_out) = path_endpoints(&p.path)?;
        let token_out_addr = Address::from_alloy(token_out);
        let recipient_addr = Address::from_alloy(p.to);

        let input_token = native_bnb(tx.chain_id);
        let output_token = self.tokens.get(tx.chain_id, &token_out_addr);

        Ok(dex_swap_action(
            tx,
            "pancakeswap-amm",
            input_token,
            output_token,
            tx.value_wei.clone(),
            Some(p.amount_out_min.to_string()),
            &recipient_addr,
            Some(25),
            "pancakeswap-amm/swapExactETHForTokens",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sample_params() -> Params {
        Params {
            amount_out_min: U256::ZERO,
            path: vec![
                AlloyAddress::from_str("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c").unwrap(),
                AlloyAddress::from_str("0x55d398326f99059fF775485246999027B3197955").unwrap(),
            ],
            to: AlloyAddress::from_str("0x1111111111111111111111111111111111111111").unwrap(),
            deadline: U256::from(9_999_999_999u64),
        }
    }

    #[test]
    fn round_trip() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn selector_pin() {
        assert_eq!(SELECTOR, [0x7f, 0xf3, 0x6a, 0xb5]);
    }

    #[test]
    fn build_treats_msg_value_as_native_bnb_input() {
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(PANCAKESWAP_V2_ROUTER_BSC).unwrap(),
            value_wei: "1000000000000000000".into(), // 1 BNB
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["pancakeswap-amm".to_string()]);
                assert!(d.facts.input_tokens[0].is_native);
                assert_eq!(d.facts.input_tokens[0].symbol, "BNB");
                assert_eq!(d.facts.output_tokens[0].symbol, "USDT");
                assert_eq!(d.facts.max_fee_bps, Some(25));
                assert_eq!(d.oracle_requirements[0].raw_amount, "1000000000000000000");
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
