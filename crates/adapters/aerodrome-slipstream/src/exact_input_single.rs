//! Aerodrome Slipstream `SwapRouter` `exactInputSingle`.
//!
//! Layout matches Uniswap V3's `ExactInputSingleParams` with one substitution:
//! `int24 tickSpacing` replaces `uint24 fee`. tickSpacing is captured in
//! `Params.tick_spacing` and recorded in the audit trace; `DexFacts::max_fee_bps`
//! is always `None` for Slipstream swaps.

#[cfg(test)]
use crate::common::AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE;
use crate::common::{dex_swap_action, swap_router_address, DecodeError, TokenLookup};
use alloy_primitives::{
    aliases::{I24, U160},
    Address as AlloyAddress, U256,
};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    #[derive(Debug)]
    struct SolExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24   tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(SolExactInputSingleParams params) external payable returns (uint256 amountOut);
}

/// Selector for `exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))`.
pub const SELECTOR: [u8; 4] = exactInputSingleCall::SELECTOR;

/// Public-facing decoded parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Input token address.
    pub token_in: AlloyAddress,
    /// Output token address.
    pub token_out: AlloyAddress,
    /// Slipstream pool key — signed 24-bit tick spacing widened to i32.
    pub tick_spacing: i32,
    /// Recipient address.
    pub recipient: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
    /// Exact input amount.
    pub amount_in: U256,
    /// Minimum acceptable output amount.
    pub amount_out_minimum: U256,
    /// Optional sqrt price limit.
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
    let tick = I24::try_from(p.tick_spacing).unwrap_or(I24::ZERO);
    exactInputSingleCall {
        params: SolExactInputSingleParams {
            tokenIn: p.token_in,
            tokenOut: p.token_out,
            tickSpacing: tick,
            recipient: p.recipient,
            deadline: p.deadline,
            amountIn: p.amount_in,
            amountOutMinimum: p.amount_out_minimum,
            sqrtPriceLimitX96: sqrt_limit_u160,
        },
    }
    .abi_encode()
}

/// ABI-decode calldata that begins with the `exactInputSingle` selector.
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
    let call = exactInputSingleCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    let tick_i32 = i32::try_from(call.params.tickSpacing)
        .map_err(|_| DecodeError::TickSpacingOutOfRange(call.params.tickSpacing.to_string()))?;
    Ok(Params {
        token_in: call.params.tokenIn,
        token_out: call.params.tokenOut,
        tick_spacing: tick_i32,
        recipient: call.params.recipient,
        deadline: call.params.deadline,
        amount_in: call.params.amountIn,
        amount_out_minimum: call.params.amountOutMinimum,
        sqrt_price_limit_x96: U256::from(call.params.sqrtPriceLimitX96),
    })
}

/// Adapter for Slipstream `exactInputSingle`.
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

impl TypedAdapter for Adapter_ {
    const ADAPTER_ID: &'static str = "aerodrome-slipstream/exactInputSingle@0.1.0";
    const PROTOCOL_ID: &'static str = "aerodrome-slipstream";
    const KIND: AdapterKind = AdapterKind::Function;
    const FUNCTIONS: &'static [SolidityFunctionSpec] = &[SolidityFunctionSpec::new(
        "exactInputSingle",
        "exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))",
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
            format!("exactInputSingle tickSpacing={}", p.tick_spacing),
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
            tick_spacing: 200,
            recipient: AlloyAddress::from_str("0x1111111111111111111111111111111111111111")
                .unwrap(),
            deadline: U256::from(9_999_999_999u64),
            amount_in: U256::from(100_000_000u64), // 100 USDC
            amount_out_minimum: U256::ZERO,
            sqrt_price_limit_x96: U256::ZERO,
        }
    }

    #[test]
    fn round_trip_positive_tick_spacing() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn round_trip_negative_tick_spacing() {
        let mut p = sample_params();
        p.tick_spacing = -100;
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn build_emits_slipstream_with_no_max_fee_and_tick_spacing_in_trace() {
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
        match adapter.build_action(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["aerodrome-slipstream"]);
                assert_eq!(d.facts.input_tokens[0].symbol, "USDC");
                assert_eq!(d.facts.output_tokens[0].symbol, "WETH");
                // Critical contract: max_fee_bps is None — the fee-cap policy
                // (`max-fee-bps-100.cedar`) is correctly bypassed for
                // Slipstream because `context has maxFeeBps` is false.
                assert_eq!(d.facts.max_fee_bps, None);
                assert_eq!(d.trace.steps, vec!["exactInputSingle tickSpacing=200"]);
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
