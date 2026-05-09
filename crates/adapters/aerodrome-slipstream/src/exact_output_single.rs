//! Aerodrome Slipstream `SwapRouter` `exactOutputSingle`.
//!
//! Layout matches Uniswap V3's `ExactOutputSingleParams` with `int24
//! tickSpacing` substituted for `uint24 fee`.

#[cfg(test)]
use crate::common::AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE;
use crate::common::{
    dex_swap_action, static_adapter_id, swap_router_address, DecodeError, TokenLookup,
};
use alloy_primitives::{
    aliases::{I24, U160},
    Address as AlloyAddress, U256,
};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    #[derive(Debug)]
    struct SolExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        int24   tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    function exactOutputSingle(SolExactOutputSingleParams params) external payable returns (uint256 amountIn);
}

/// Selector for `exactOutputSingle`.
pub const SELECTOR: [u8; 4] = exactOutputSingleCall::SELECTOR;

/// Decoded `exactOutputSingle` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Input token address.
    pub token_in: AlloyAddress,
    /// Output token address.
    pub token_out: AlloyAddress,
    /// Slipstream pool key (signed 24-bit, widened to i32).
    pub tick_spacing: i32,
    /// Recipient address.
    pub recipient: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
    /// Exact output amount.
    pub amount_out: U256,
    /// Maximum input amount.
    pub amount_in_maximum: U256,
    /// Optional sqrt price limit.
    pub sqrt_price_limit_x96: U256,
}

/// ABI-encode `exactOutputSingle` calldata.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    let sqrt_limit_u160 = if p.sqrt_price_limit_x96 > U256::from(U160::MAX) {
        U160::MAX
    } else {
        U160::from_be_slice(&p.sqrt_price_limit_x96.to_be_bytes::<32>()[12..])
    };
    let tick = I24::try_from(p.tick_spacing).unwrap_or(I24::ZERO);
    exactOutputSingleCall {
        params: SolExactOutputSingleParams {
            tokenIn: p.token_in,
            tokenOut: p.token_out,
            tickSpacing: tick,
            recipient: p.recipient,
            deadline: p.deadline,
            amountOut: p.amount_out,
            amountInMaximum: p.amount_in_maximum,
            sqrtPriceLimitX96: sqrt_limit_u160,
        },
    }
    .abi_encode()
}

/// Decode `exactOutputSingle` calldata.
///
/// # Errors
///
/// Returns an error when calldata is too short, has the wrong selector, fails
/// ABI decoding, or contains an out-of-range tickSpacing.
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
    let call = exactOutputSingleCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    let tick_i32 = i32::try_from(call.params.tickSpacing)
        .map_err(|_| DecodeError::TickSpacingOutOfRange(call.params.tickSpacing.to_string()))?;
    Ok(Params {
        token_in: call.params.tokenIn,
        token_out: call.params.tokenOut,
        tick_spacing: tick_i32,
        recipient: call.params.recipient,
        deadline: call.params.deadline,
        amount_out: call.params.amountOut,
        amount_in_maximum: call.params.amountInMaximum,
        sqrt_price_limit_x96: U256::from(call.params.sqrtPriceLimitX96),
    })
}

/// Adapter for Slipstream `exactOutputSingle`.
#[derive(Debug)]
pub struct Adapter_ {
    chain_targets: Vec<(ChainId, Address)>,
    tokens: TokenLookup,
}

impl Adapter_ {
    /// Construct an adapter with Base Slipstream `SwapRouter` and default token metadata.
    #[must_use]
    pub fn new() -> Self {
        Self {
            chain_targets: vec![(8453, swap_router_address())],
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
        static_adapter_id("aerodrome-slipstream/exactOutputSingle@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| MatchKey::exact(*chain, target.clone(), SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let token_in_addr = Address::from_alloy(p.token_in);
        let token_out_addr = Address::from_alloy(p.token_out);
        let recipient_addr = Address::from_alloy(p.recipient);
        let input_token = self.tokens.get(tx.chain_id, &token_in_addr);
        let output_token = self.tokens.get(tx.chain_id, &token_out_addr);

        Ok(dex_swap_action(
            tx,
            "aerodrome-slipstream",
            input_token,
            output_token,
            p.amount_in_maximum.to_string(),
            Some(p.amount_out.to_string()),
            &recipient_addr,
            format!("exactOutputSingle tickSpacing={}", p.tick_spacing),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn sample_params() -> Params {
        Params {
            token_in: AlloyAddress::from_str("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").unwrap(),
            token_out: AlloyAddress::from_str("0x4200000000000000000000000000000000000006")
                .unwrap(),
            tick_spacing: 60,
            recipient: AlloyAddress::from_str("0x1111111111111111111111111111111111111111")
                .unwrap(),
            deadline: U256::from(9_999_999_999u64),
            amount_out: U256::from(1_000_000_000_000_000_000_u128),
            amount_in_maximum: U256::from(4_000_000_000_u64),
            sqrt_price_limit_x96: U256::ZERO,
        }
    }

    #[test]
    fn round_trip() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn build_uses_amount_in_maximum_for_oracle_input_and_omits_max_fee() {
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 8453,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE).unwrap(),
            value_wei: "0".into(),
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["aerodrome-slipstream"]);
                assert_eq!(d.facts.max_fee_bps, None);
                assert_eq!(d.oracle_requirements[0].raw_amount, "4000000000");
                assert_eq!(d.oracle_requirements[1].raw_amount, "1000000000000000000");
                assert_eq!(d.trace.steps, vec!["exactOutputSingle tickSpacing=60"]);
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
