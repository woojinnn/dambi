//! Aerodrome Slipstream `SwapRouter` `exactInput` — multi-hop, exact-in.
//! Path is packed as `[token(20)][tickSpacing(3, signed)][token(20)]...`.

#[cfg(test)]
use crate::common::AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE;
use crate::common::{
    decode_slipstream_path, dex_swap_action, path_endpoints, static_adapter_id,
    swap_router_address, DecodeError, TokenLookup,
};
use alloy_primitives::{Address as AlloyAddress, U256};
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;
use std::fmt::Write as _;

sol! {
    #[derive(Debug)]
    struct SolExactInputParams {
        bytes   path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(SolExactInputParams params) external payable returns (uint256 amountOut);
}

/// Selector for `exactInput`.
pub const SELECTOR: [u8; 4] = exactInputCall::SELECTOR;

/// Decoded `exactInput` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Packed Slipstream path.
    pub path: Vec<u8>,
    /// Recipient address.
    pub recipient: AlloyAddress,
    /// Swap deadline.
    pub deadline: U256,
    /// Exact input amount.
    pub amount_in: U256,
    /// Minimum acceptable output amount.
    pub amount_out_minimum: U256,
}

/// ABI-encode `exactInput` calldata.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    exactInputCall {
        params: SolExactInputParams {
            path: p.path.clone().into(),
            recipient: p.recipient,
            deadline: p.deadline,
            amountIn: p.amount_in,
            amountOutMinimum: p.amount_out_minimum,
        },
    }
    .abi_encode()
}

/// Decode `exactInput` calldata.
///
/// # Errors
///
/// Returns an error when calldata is too short, has the wrong selector, or
/// fails ABI decoding.
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
    let call = exactInputCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    Ok(Params {
        path: call.params.path.to_vec(),
        recipient: call.params.recipient,
        deadline: call.params.deadline,
        amount_in: call.params.amountIn,
        amount_out_minimum: call.params.amountOutMinimum,
    })
}

/// Adapter for Slipstream `exactInput`.
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
        static_adapter_id("aerodrome-slipstream/exactInput@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.chain_targets
            .iter()
            .map(|(chain, target)| MatchKey::exact(*chain, target.clone(), SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let (alloy_tokens, tick_spacings) = decode_slipstream_path(&p.path)
            .map_err(|e| AdapterError::BadCalldata(e.to_string()))?;
        let (token_in, token_out) = path_endpoints(&alloy_tokens)?;
        let token_in_addr = Address::from_alloy(token_in);
        let token_out_addr = Address::from_alloy(token_out);
        let recipient_addr = Address::from_alloy(p.recipient);

        let input_token = self.tokens.get(tx.chain_id, &token_in_addr);
        let output_token = self.tokens.get(tx.chain_id, &token_out_addr);

        let mut trace_step = String::from("exactInput tickSpacings=[");
        for (i, ts) in tick_spacings.iter().enumerate() {
            if i > 0 {
                trace_step.push_str(", ");
            }
            let _ = write!(trace_step, "{ts}");
        }
        trace_step.push(']');

        Ok(dex_swap_action(
            tx,
            "aerodrome-slipstream",
            input_token,
            output_token,
            p.amount_in.to_string(),
            Some(p.amount_out_minimum.to_string()),
            &recipient_addr,
            trace_step,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn build_path_signed(token_a: &str, tick: i32, token_b: &str) -> Vec<u8> {
        let mut out = Vec::with_capacity(43);
        out.extend_from_slice(AlloyAddress::from_str(token_a).unwrap().as_slice());
        // big-endian 3-byte tick from i32: take low 3 bytes
        let bytes = tick.to_be_bytes();
        out.extend_from_slice(&bytes[1..4]);
        out.extend_from_slice(AlloyAddress::from_str(token_b).unwrap().as_slice());
        out
    }

    fn sample_params() -> Params {
        Params {
            path: build_path_signed(
                "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                200,
                "0x4200000000000000000000000000000000000006",
            ),
            recipient: AlloyAddress::from_str("0x1111111111111111111111111111111111111111")
                .unwrap(),
            deadline: U256::from(9_999_999_999u64),
            amount_in: U256::from(100_000_000u64),
            amount_out_minimum: U256::ZERO,
        }
    }

    #[test]
    fn round_trip() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn build_emits_slipstream_with_no_max_fee_and_records_tick_spacings() {
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
                assert_eq!(d.facts.input_tokens[0].symbol, "USDC");
                assert_eq!(d.facts.output_tokens[0].symbol, "WETH");
                assert_eq!(d.facts.max_fee_bps, None);
                assert_eq!(d.trace.steps, vec!["exactInput tickSpacings=[200]"]);
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }

    #[test]
    fn build_decodes_negative_tick_spacing_in_path() {
        let p = Params {
            path: build_path_signed(
                "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                -100,
                "0x4200000000000000000000000000000000000006",
            ),
            recipient: AlloyAddress::from_str("0x1111111111111111111111111111111111111111")
                .unwrap(),
            deadline: U256::from(1u64),
            amount_in: U256::from(1u64),
            amount_out_minimum: U256::ZERO,
        };
        let adapter = Adapter_::new();
        let tx = TransactionRequest {
            chain_id: 8453,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE).unwrap(),
            value_wei: "0".into(),
            data: encode(&p),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => assert_eq!(d.trace.steps, vec!["exactInput tickSpacings=[-100]"]),
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
