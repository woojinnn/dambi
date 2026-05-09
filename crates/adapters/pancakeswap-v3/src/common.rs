//! Shared resources for PancakeSwap V3 SwapRouter swap-function adapters.
//!
//! PancakeSwap V3 is an ABI-level fork of Uniswap V3's `SwapRouter`. The
//! `ExactInputSingleParams` / `ExactInputParams` / `ExactOutputSingleParams` /
//! `ExactOutputParams` structs are byte-identical, so all four core selectors
//! match Uniswap V3's. Only the deployed router address (BSC), the default
//! chain id, and the protocol id reported in `DexFacts` differ.

use alloy_primitives::{address, Address as AlloyAddress};
use policy_engine::prelude::*;
use std::collections::{HashMap, HashSet};

/// PancakeSwap V3 SwapRouter on BSC.
pub const PANCAKESWAP_V3_SWAP_ROUTER_BSC: &str = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";

/// Token registry baked into the adapter for v0.1. Production replaces this
/// with the manifest's `tokenLookup` capability.
#[derive(Debug)]
pub struct TokenLookup {
    tokens: HashMap<(ChainId, String), Token>,
}

impl TokenLookup {
    /// Builds a lookup pre-populated with WBNB, USDT (BSC), BUSD, and CAKE.
    ///
    /// Note: BSC USDT is an 18-decimal BEP-20 token, not the 6-decimal USDT
    /// of Ethereum mainnet. The same address-by-symbol confusion does not
    /// apply: BSC USDT lives at `0x55d398326f99059ff775485246999027b3197955`,
    /// a different contract from Ethereum's USDT.
    #[must_use]
    pub fn with_bsc_defaults() -> Self {
        let mut me = Self {
            tokens: HashMap::new(),
        };
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c")),
            symbol: "WBNB".into(),
            decimals: 18,
            is_native: false,
        });
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0x55d398326f99059ff775485246999027b3197955")),
            symbol: "USDT".into(),
            decimals: 18,
            is_native: false,
        });
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0xe9e7cea3dedca5984780bafc599bd69add087d56")),
            symbol: "BUSD".into(),
            decimals: 18,
            is_native: false,
        });
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82")),
            symbol: "CAKE".into(),
            decimals: 18,
            is_native: false,
        });
        me
    }

    /// Adds or replaces one token by chain and address.
    pub fn add(&mut self, token: Token) {
        self.tokens.insert(
            (token.chain_id, token.address.as_str().to_lowercase()),
            token,
        );
    }

    /// Returns this lookup after adding `token`.
    #[must_use]
    pub fn with(mut self, token: Token) -> Self {
        self.add(token);
        self
    }

    /// Look up a token; returns a synthetic `UNKNOWN` placeholder when missing.
    #[must_use]
    pub fn get(&self, chain_id: ChainId, addr: &Address) -> Token {
        self.tokens
            .get(&(chain_id, addr.as_str().to_lowercase()))
            .cloned()
            .unwrap_or_else(|| Token {
                chain_id,
                address: addr.clone(),
                symbol: "UNKNOWN".into(),
                decimals: 18,
                is_native: false,
            })
    }
}

impl Default for TokenLookup {
    fn default() -> Self {
        Self::with_bsc_defaults()
    }
}

pub(crate) fn swap_router_address() -> Address {
    Address::from_alloy(address!("0x1b81d678ffb9c0263b24a97847620c99d213eb14"))
}

#[allow(clippy::panic)]
pub(crate) fn static_adapter_id(raw: &str) -> AdapterId {
    match AdapterId::new(raw) {
        Ok(id) => id,
        Err(err) => panic!("invalid static adapter id {raw}: {err}"),
    }
}

pub(crate) fn path_endpoints(
    path: &[AlloyAddress],
) -> Result<(AlloyAddress, AlloyAddress), AdapterError> {
    if path.len() < 2 {
        return Err(AdapterError::BadCalldata(format!(
            "pancakeswap-v3 path must contain at least 2 tokens, got {}",
            path.len()
        )));
    }
    Ok((path[0], path[path.len() - 1]))
}

/// Build the aggregate DEX action emitted by a single decoded swap call.
#[allow(clippy::too_many_arguments)]
pub fn dex_swap_action(
    tx: &TransactionRequest,
    protocol_id: &str,
    input_token: Token,
    output_token: Token,
    input_raw: String,
    min_output_raw: Option<String>,
    recipient: &Address,
    max_fee_bps: Option<u32>,
    trace_step: impl Into<String>,
) -> Action {
    let mut oracle_requirements = vec![OracleRequirement {
        kind: OracleRequirementKind::Input,
        token: input_token.clone(),
        raw_amount: input_raw,
    }];
    let has_zero_min_output = min_output_raw.as_deref() == Some("0");
    if let Some(raw_amount) = min_output_raw {
        oracle_requirements.push(OracleRequirement {
            kind: OracleRequirementKind::MinOutput,
            token: output_token.clone(),
            raw_amount,
        });
    }

    Action::Dex(DexAction {
        actor: tx.from.clone(),
        target: tx.to.clone(),
        value_wei: tx.value_wei.clone(),
        facts: DexFacts {
            protocol_ids: vec![protocol_id.into()],
            input_tokens: vec![input_token],
            output_tokens: vec![output_token],
            max_fee_bps,
            has_zero_min_output,
            has_external_recipient: recipient != &tx.from,
            ..DexFacts::default()
        },
        oracle_requirements,
        trace: DexTrace {
            steps: vec![trace_step.into()],
        },
    })
}

/// Merge child DEX actions from a structural router call into one aggregate.
///
/// # Errors
///
/// Returns an error if any child action is not a DEX action.
pub fn merge_dex_actions(
    tx: &TransactionRequest,
    actions: Vec<Action>,
    trace_step: impl Into<String>,
) -> Result<Action, AdapterError> {
    let mut protocol_ids = Vec::new();
    let mut seen_protocol_ids = HashSet::new();
    let mut input_tokens = Vec::new();
    let mut seen_input_tokens = HashSet::new();
    let mut output_tokens = Vec::new();
    let mut seen_output_tokens = HashSet::new();
    let mut oracle_requirements = Vec::new();
    let mut trace_steps = vec![trace_step.into()];
    let mut max_fee_bps: Option<u32> = None;
    let mut has_zero_min_output = false;
    let mut has_external_recipient = false;

    for action in actions {
        let Action::Dex(dex) = action else {
            return Err(AdapterError::BadCalldata(format!(
                "multicall child emitted non-dex action: {}",
                action.kind()
            )));
        };

        for protocol_id in dex.facts.protocol_ids {
            if seen_protocol_ids.insert(protocol_id.clone()) {
                protocol_ids.push(protocol_id);
            }
        }
        for token in dex.facts.input_tokens {
            if seen_input_tokens.insert(token.key()) {
                input_tokens.push(token);
            }
        }
        for token in dex.facts.output_tokens {
            if seen_output_tokens.insert(token.key()) {
                output_tokens.push(token);
            }
        }
        if let Some(fee) = dex.facts.max_fee_bps {
            max_fee_bps = Some(max_fee_bps.map_or(fee, |current| current.max(fee)));
        }
        has_zero_min_output |= dex.facts.has_zero_min_output;
        has_external_recipient |= dex.facts.has_external_recipient;
        oracle_requirements.extend(dex.oracle_requirements);
        trace_steps.extend(dex.trace.steps);
    }

    Ok(Action::Dex(DexAction {
        actor: tx.from.clone(),
        target: tx.to.clone(),
        value_wei: tx.value_wei.clone(),
        facts: DexFacts {
            protocol_ids,
            input_tokens,
            output_tokens,
            max_fee_bps,
            has_zero_min_output,
            has_external_recipient,
            ..DexFacts::default()
        },
        oracle_requirements,
        trace: DexTrace { steps: trace_steps },
    }))
}

/// Decode a packed `bytes path` (V3 layout: `[token(20)][fee(3)][token(20)]...`).
///
/// Returns `(tokens, fees)` with `tokens.len() == hops + 1` and
/// `fees.len() == hops`.
///
/// # Errors
///
/// Returns an error if the path length is not a valid V3 packed path length.
pub fn decode_v3_path(path: &[u8]) -> Result<(Vec<AlloyAddress>, Vec<u32>), DecodeError> {
    if path.len() < 20 + 23 || !(path.len() - 20).is_multiple_of(23) {
        return Err(DecodeError::AbiDecode(format!(
            "invalid PancakeSwap V3 path length: {} (must be 20 + 23*N)",
            path.len()
        )));
    }
    let hops = (path.len() - 20) / 23;
    let mut tokens = Vec::with_capacity(hops + 1);
    let mut fees = Vec::with_capacity(hops);

    let mut cursor = 0;
    for _ in 0..hops {
        tokens.push(AlloyAddress::from_slice(&path[cursor..cursor + 20]));
        cursor += 20;
        let fee_bytes = &path[cursor..cursor + 3];
        let fee = (u32::from(fee_bytes[0]) << 16)
            | (u32::from(fee_bytes[1]) << 8)
            | u32::from(fee_bytes[2]);
        fees.push(fee);
        cursor += 3;
    }
    tokens.push(AlloyAddress::from_slice(&path[cursor..cursor + 20]));
    Ok((tokens, fees))
}

/// Common decode error kinds used by the per-function modules.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DecodeError {
    /// Calldata is shorter than the minimum required length.
    #[error("calldata too short: need at least {need} bytes, got {got}")]
    TooShort {
        /// Required byte length.
        need: usize,
        /// Actual byte length.
        got: usize,
    },
    /// The four-byte selector does not match the expected function.
    #[error("unexpected selector: got 0x{got}, expected 0x{want}")]
    BadSelector {
        /// Observed selector hex.
        got: String,
        /// Expected selector hex.
        want: String,
    },
    /// ABI decoding failed.
    #[error("ABI decode failed: {0}")]
    AbiDecode(String),
    /// A decoded uint24 fee could not be widened.
    #[error("uint24 fee value {0} doesn't fit u32 (should never happen for valid V3 calldata)")]
    FeeOutOfRange(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_lookup_returns_known_bsc_tokens() {
        let lookup = TokenLookup::with_bsc_defaults();
        let cake = Address::new("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82").unwrap();
        assert_eq!(lookup.get(56, &cake).symbol, "CAKE");
    }

    #[test]
    fn v3_path_single_hop_decodes_two_tokens_one_fee() {
        let mut path = Vec::new();
        path.extend_from_slice(&[0x11; 20]);
        path.extend_from_slice(&[0x00, 0x09, 0xc4]); // fee 2500 — PancakeSwap-only tier
        path.extend_from_slice(&[0x22; 20]);
        let (tokens, fees) = decode_v3_path(&path).unwrap();
        assert_eq!(tokens.len(), 2);
        assert_eq!(fees, vec![2500]);
    }

    #[test]
    fn v3_path_rejects_invalid_length() {
        assert!(decode_v3_path(&[]).is_err());
        assert!(decode_v3_path(&[0u8; 22]).is_err());
    }
}
