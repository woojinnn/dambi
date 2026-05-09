//! Aerodrome V1 Router `swapExactETHForTokens(uint256 amountOutMin,
//! Route[] routes, address to, uint256 deadline)`. Payable — `amountIn` is
//! `msg.value`, and the input token is native ETH on Base.

#[cfg(test)]
use crate::common::AERODROME_V1_ROUTER_BASE;
use crate::common::{
    dex_swap_action, native_eth, route_endpoints, router_address, static_adapter_id, DecodeError,
    Route, TokenLookup,
};
use alloy_primitives::{Address as AlloyAddress, U256};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    #[derive(Debug)]
    struct SolRoute {
        address from;
        address to;
        bool    stable;
        address factory;
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        SolRoute[] routes,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] amounts);
}

const fn route_to_sol(r: &Route) -> SolRoute {
    SolRoute {
        from: r.from,
        to: r.to,
        stable: r.stable,
        factory: r.factory,
    }
}

const fn route_from_sol(r: &SolRoute) -> Route {
    Route {
        from: r.from,
        to: r.to,
        stable: r.stable,
        factory: r.factory,
    }
}

/// Selector for `swapExactETHForTokens` (Aerodrome V1's `Route[]` overload).
pub const SELECTOR: [u8; 4] = swapExactETHForTokensCall::SELECTOR;

/// Decoded `swapExactETHForTokens` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Minimum acceptable output token amount.
    pub amount_out_min: U256,
    /// Aerodrome route legs (first leg's `from` is WETH).
    pub routes: Vec<Route>,
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
        routes: p.routes.iter().map(route_to_sol).collect(),
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
/// ABI decoding, or contains an empty routes array.
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
    if call.routes.is_empty() {
        return Err(DecodeError::EmptyRoutes(0));
    }
    Ok(Params {
        amount_out_min: call.amountOutMin,
        routes: call.routes.iter().map(route_from_sol).collect(),
        to: call.to,
        deadline: call.deadline,
    })
}

/// Adapter for Aerodrome V1 `swapExactETHForTokens`.
#[derive(Debug)]
pub struct Adapter_ {
    chain_targets: Vec<(ChainId, Address)>,
    tokens: TokenLookup,
}

impl Adapter_ {
    /// Construct an adapter with Base Aerodrome V1 Router and default token metadata.
    #[must_use]
    pub fn new() -> Self {
        Self {
            chain_targets: vec![(8453, router_address())],
            tokens: TokenLookup::with_base_defaults(),
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
        static_adapter_id("aerodrome-v1/swapExactETHForTokens@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| MatchKey::exact(*chain, target.clone(), SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let (_, token_out) = route_endpoints(&p.routes)?;
        let token_out_addr = Address::from_alloy(token_out);
        let recipient_addr = Address::from_alloy(p.to);

        let input_token = native_eth(tx.chain_id);
        let output_token = self.tokens.get(tx.chain_id, &token_out_addr);

        Ok(dex_swap_action(
            tx,
            "aerodrome-v1",
            input_token,
            output_token,
            tx.value_wei.clone(),
            Some(p.amount_out_min.to_string()),
            &recipient_addr,
            &p.routes,
            "aerodrome-v1/swapExactETHForTokens",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    const WETH: &str = "0x4200000000000000000000000000000000000006";
    const USDC: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const FACTORY: &str = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
    const RECIPIENT: &str = "0x1111111111111111111111111111111111111111";

    fn sample_params() -> Params {
        Params {
            amount_out_min: U256::ZERO,
            routes: vec![Route {
                from: AlloyAddress::from_str(WETH).unwrap(),
                to: AlloyAddress::from_str(USDC).unwrap(),
                stable: false,
                factory: AlloyAddress::from_str(FACTORY).unwrap(),
            }],
            to: AlloyAddress::from_str(RECIPIENT).unwrap(),
            deadline: U256::from(9_999_999_999u64),
        }
    }

    #[test]
    fn round_trip() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn build_treats_msg_value_as_native_eth_input() {
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 8453,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(AERODROME_V1_ROUTER_BASE).unwrap(),
            value_wei: "1000000000000000000".into(), // 1 ETH
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["aerodrome-v1"]);
                assert!(d.facts.input_tokens[0].is_native);
                assert_eq!(d.facts.input_tokens[0].symbol, "ETH");
                assert_eq!(d.facts.output_tokens[0].symbol, "USDC");
                assert_eq!(d.facts.max_fee_bps, Some(30));
                assert_eq!(d.oracle_requirements[0].raw_amount, "1000000000000000000");
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
