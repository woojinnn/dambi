//! PancakeSwap V2 (AMM) Router `swapExactTokensForTokens(uint256 amountIn,
//! uint256 amountOutMin, address[] path, address to, uint256 deadline)`.
//!
//! ABI-identical to Uniswap V2 Router02's same function. The differences are
//! the deployed router address (BSC), the protocol id emitted into
//! `DexFacts.protocol_ids`, and the constant 25-bps swap fee charged by
//! PancakeSwap V2.

#[cfg(test)]
use crate::common::PANCAKESWAP_V2_ROUTER_BSC;
use crate::common::{
    dex_swap_action, path_endpoints, router_address, static_adapter_id, DecodeError, TokenLookup,
};
use alloy_primitives::{Address as AlloyAddress, U256};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    ) external returns (uint256[] amounts);
}

/// Selector for `swapExactTokensForTokens`.
pub const SELECTOR: [u8; 4] = swapExactTokensForTokensCall::SELECTOR;

/// Decoded `swapExactTokensForTokens` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Exact input token amount.
    pub amount_in: U256,
    /// Minimum acceptable output token amount.
    pub amount_out_min: U256,
    /// Ordered token path from input to output.
    pub path: Vec<AlloyAddress>,
    /// Recipient address.
    pub to: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
}

/// ABI-encode `swapExactTokensForTokens` calldata.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    swapExactTokensForTokensCall {
        amountIn: p.amount_in,
        amountOutMin: p.amount_out_min,
        path: p.path.clone(),
        to: p.to,
        deadline: p.deadline,
    }
    .abi_encode()
}

/// Decode `swapExactTokensForTokens` calldata.
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
    let call = swapExactTokensForTokensCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    if call.path.len() < 2 {
        return Err(DecodeError::EmptyPath(call.path.len()));
    }
    Ok(Params {
        amount_in: call.amountIn,
        amount_out_min: call.amountOutMin,
        path: call.path,
        to: call.to,
        deadline: call.deadline,
    })
}

/// Adapter for `swapExactTokensForTokens`.
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
        static_adapter_id("pancakeswap-amm/swapExactTokensForTokens@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| MatchKey::exact(*chain, target.clone(), SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let (token_in, token_out) = path_endpoints(&p.path)?;
        let token_in_addr = Address::from_alloy(token_in);
        let token_out_addr = Address::from_alloy(token_out);
        let recipient_addr = Address::from_alloy(p.to);

        let input_token = self.tokens.get(tx.chain_id, &token_in_addr);
        let output_token = self.tokens.get(tx.chain_id, &token_out_addr);

        Ok(dex_swap_action(
            tx,
            "pancakeswap-amm",
            input_token,
            output_token,
            p.amount_in.to_string(),
            Some(p.amount_out_min.to_string()),
            &recipient_addr,
            Some(25),
            "pancakeswap-amm/swapExactTokensForTokens",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sample_params() -> Params {
        Params {
            amount_in: U256::from(1_000_000_000_000_000_000_u128),
            amount_out_min: U256::ZERO,
            path: vec![
                AlloyAddress::from_str("0x55d398326f99059fF775485246999027B3197955").unwrap(),
                AlloyAddress::from_str("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c").unwrap(),
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
    fn selector_pin_matches_uniswap_v2() {
        // Identical 4-byte selector to Uniswap V2's same function — PancakeSwap V2
        // is an ABI-level fork.
        assert_eq!(SELECTOR, [0x38, 0xed, 0x17, 0x39]);
    }

    #[test]
    fn empty_path_rejected() {
        let mut p = sample_params();
        p.path.clear();
        assert!(matches!(
            decode(&encode(&p)).unwrap_err(),
            DecodeError::EmptyPath(0)
        ));
    }

    #[test]
    fn build_emits_dex_with_pancakeswap_amm_protocol_id_and_25bp_fee() {
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(PANCAKESWAP_V2_ROUTER_BSC).unwrap(),
            value_wei: "0".into(),
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["pancakeswap-amm".to_string()]);
                assert_eq!(d.facts.input_tokens[0].symbol, "USDT");
                assert_eq!(d.facts.input_tokens[0].decimals, 18); // BSC USDT is 18 dec
                assert_eq!(d.facts.output_tokens[0].symbol, "WBNB");
                assert_eq!(d.facts.max_fee_bps, Some(25));
                assert!(d.facts.has_zero_min_output);
                assert_eq!(d.oracle_requirements[0].kind, OracleRequirementKind::Input);
                assert_eq!(d.oracle_requirements[0].raw_amount, "1000000000000000000");
                assert_eq!(
                    d.oracle_requirements[1].kind,
                    OracleRequirementKind::MinOutput
                );
                assert_eq!(d.oracle_requirements[1].raw_amount, "0");
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
