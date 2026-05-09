//! Aerodrome V1 Router `swapExactTokensForETH(uint256 amountIn,
//! uint256 amountOutMin, Route[] routes, address to, uint256 deadline)`.
//! Output is native ETH on Base.

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

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        SolRoute[] routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] amounts);
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

/// Selector for `swapExactTokensForETH` (Aerodrome V1's `Route[]` overload).
pub const SELECTOR: [u8; 4] = swapExactTokensForETHCall::SELECTOR;

/// Decoded `swapExactTokensForETH` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Exact input token amount.
    pub amount_in: U256,
    /// Minimum acceptable native ETH output amount.
    pub amount_out_min: U256,
    /// Aerodrome route legs (last leg's `to` is WETH).
    pub routes: Vec<Route>,
    /// Recipient address.
    pub to: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
}

/// ABI-encode `swapExactTokensForETH` calldata.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    swapExactTokensForETHCall {
        amountIn: p.amount_in,
        amountOutMin: p.amount_out_min,
        routes: p.routes.iter().map(route_to_sol).collect(),
        to: p.to,
        deadline: p.deadline,
    }
    .abi_encode()
}

/// Decode `swapExactTokensForETH` calldata.
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
    let call = swapExactTokensForETHCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    if call.routes.is_empty() {
        return Err(DecodeError::EmptyRoutes(0));
    }
    Ok(Params {
        amount_in: call.amountIn,
        amount_out_min: call.amountOutMin,
        routes: call.routes.iter().map(route_from_sol).collect(),
        to: call.to,
        deadline: call.deadline,
    })
}

/// Adapter for Aerodrome V1 `swapExactTokensForETH`.
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
        static_adapter_id("aerodrome-v1/swapExactTokensForETH@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| MatchKey::exact(*chain, target.clone(), SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let (token_in, _) = route_endpoints(&p.routes)?;
        let token_in_addr = Address::from_alloy(token_in);
        let recipient_addr = Address::from_alloy(p.to);

        let input_token = self.tokens.get(tx.chain_id, &token_in_addr);
        let output_token = native_eth(tx.chain_id);

        Ok(dex_swap_action(
            tx,
            "aerodrome-v1",
            input_token,
            output_token,
            p.amount_in.to_string(),
            Some(p.amount_out_min.to_string()),
            &recipient_addr,
            &p.routes,
            "aerodrome-v1/swapExactTokensForETH",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    const USDC: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const WETH: &str = "0x4200000000000000000000000000000000000006";
    const FACTORY: &str = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
    const RECIPIENT: &str = "0x1111111111111111111111111111111111111111";

    fn sample_params() -> Params {
        Params {
            amount_in: U256::from(100_000_000u64),
            amount_out_min: U256::ZERO,
            routes: vec![Route {
                from: AlloyAddress::from_str(USDC).unwrap(),
                to: AlloyAddress::from_str(WETH).unwrap(),
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
    fn build_marks_native_eth_as_output_token() {
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 8453,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(AERODROME_V1_ROUTER_BASE).unwrap(),
            value_wei: "0".into(),
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.input_tokens[0].symbol, "USDC");
                assert!(d.facts.output_tokens[0].is_native);
                assert_eq!(d.facts.output_tokens[0].symbol, "ETH");
                assert!(d.facts.has_zero_min_output);
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
