//! Shared resources for Aerodrome Slipstream `SwapRouter` swap-function adapters.
//!
//! Slipstream is a Uniswap V3 fork with one structural divergence: the pool
//! is keyed on `int24 tickSpacing` instead of `uint24 fee`. tickSpacing is
//! NOT a fee — pool fees are stored on the pool contract and decoupled from
//! tickSpacing — so the adapter emits `DexFacts::max_fee_bps = None` for
//! every Slipstream swap and records the decoded tickSpacing in the audit
//! trace. Policies that gate on `context has maxFeeBps` will correctly
//! short-circuit for these swaps.
//!
//! The packed `bytes path` layout reuses Uniswap V3's 20+3+20+3+...+20
//! shape, but the 3-byte field is now a signed `int24` tickSpacing rather
//! than a `uint24` fee. The local `decode_slipstream_path` helper
//! sign-extends the 3-byte value into `i32`.

use alloy_primitives::{address, Address as AlloyAddress};
use policy_engine::prelude::*;
use std::collections::{HashMap, HashSet};

/// Aerodrome Slipstream `SwapRouter` on Base.
pub const AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE: &str =
    "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";

/// Token registry baked into the adapter for v0.1.
#[derive(Debug)]
pub struct TokenLookup {
    tokens: HashMap<(ChainId, String), Token>,
}

impl TokenLookup {
    /// Builds a lookup pre-populated with USDC, WETH, and AERO on Base.
    #[must_use]
    pub fn with_base_defaults() -> Self {
        let mut me = Self {
            tokens: HashMap::new(),
        };
        me.add(Token {
            chain_id: 8453,
            address: Address::from_alloy(address!("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")),
            symbol: "USDC".into(),
            decimals: 6,
            is_native: false,
        });
        me.add(Token {
            chain_id: 8453,
            address: Address::from_alloy(address!("0x4200000000000000000000000000000000000006")),
            symbol: "WETH".into(),
            decimals: 18,
            is_native: false,
        });
        me.add(Token {
            chain_id: 8453,
            address: Address::from_alloy(address!("0x940181a94a35a4569e4529a3cdfb74e38fd98631")),
            symbol: "AERO".into(),
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

    /// Returns known metadata or an `UNKNOWN` token placeholder.
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
        Self::with_base_defaults()
    }
}

pub(crate) fn swap_router_address() -> Address {
    Address::from_alloy(address!("0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5"))
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
            "aerodrome-slipstream path must contain at least 2 tokens, got {}",
            path.len()
        )));
    }
    Ok((path[0], path[path.len() - 1]))
}

/// Build the aggregate DEX action emitted by a single decoded Slipstream swap.
///
/// `max_fee_bps` is always `None` for Slipstream (tickSpacing is not a fee).
#[allow(clippy::too_many_arguments)]
pub fn dex_swap_action(
    tx: &TransactionRequest,
    protocol_id: &str,
    input_token: Token,
    output_token: Token,
    input_raw: String,
    min_output_raw: Option<String>,
    recipient: &Address,
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
            // Intentionally None — Slipstream calldata does not carry the
            // pool's swap fee.
            max_fee_bps: None,
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
        // max_fee_bps is always None for Slipstream — nothing to merge.
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
            max_fee_bps: None,
            has_zero_min_output,
            has_external_recipient,
            ..DexFacts::default()
        },
        oracle_requirements,
        trace: DexTrace { steps: trace_steps },
    }))
}

/// Decode a Slipstream packed `bytes path`.
///
/// Layout: `[token(20)][tickSpacing(3, signed)][token(20)]...[token(20)]`
/// where `tickSpacing` is a big-endian signed 24-bit integer. Returns
/// `(tokens, tick_spacings)` with `tokens.len() == hops + 1` and
/// `tick_spacings.len() == hops`.
///
/// # Errors
///
/// Returns an error if the path length is not `20 + 23*N`.
pub fn decode_slipstream_path(path: &[u8]) -> Result<(Vec<AlloyAddress>, Vec<i32>), DecodeError> {
    if path.len() < 20 + 23 || !(path.len() - 20).is_multiple_of(23) {
        return Err(DecodeError::AbiDecode(format!(
            "invalid Slipstream path length: {} (must be 20 + 23*N)",
            path.len()
        )));
    }
    let hops = (path.len() - 20) / 23;
    let mut tokens = Vec::with_capacity(hops + 1);
    let mut tick_spacings = Vec::with_capacity(hops);

    let mut cursor = 0;
    for _ in 0..hops {
        tokens.push(AlloyAddress::from_slice(&path[cursor..cursor + 20]));
        cursor += 20;
        let b0 = path[cursor];
        let b1 = path[cursor + 1];
        let b2 = path[cursor + 2];
        // Sign-extend big-endian 3-byte int24 to i32.
        let high = if b0 & 0x80 != 0 { 0xFF } else { 0x00 };
        let tick = i32::from_be_bytes([high, b0, b1, b2]);
        tick_spacings.push(tick);
        cursor += 3;
    }
    tokens.push(AlloyAddress::from_slice(&path[cursor..cursor + 20]));
    Ok((tokens, tick_spacings))
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
    /// A decoded int24 tickSpacing could not be widened to i32.
    #[error("int24 tickSpacing value {0} doesn't fit i32 (should never happen for valid Slipstream calldata)")]
    TickSpacingOutOfRange(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_lookup_returns_known_base_tokens() {
        let lookup = TokenLookup::with_base_defaults();
        let weth = Address::new("0x4200000000000000000000000000000000000006").unwrap();
        assert_eq!(lookup.get(8453, &weth).symbol, "WETH");
    }

    #[test]
    fn slipstream_path_single_hop_positive_tick_spacing() {
        let mut path = Vec::new();
        path.extend_from_slice(&[0x11; 20]);
        // tickSpacing = 200 (0x0000c8, positive)
        path.extend_from_slice(&[0x00, 0x00, 0xc8]);
        path.extend_from_slice(&[0x22; 20]);
        let (tokens, ticks) = decode_slipstream_path(&path).unwrap();
        assert_eq!(tokens.len(), 2);
        assert_eq!(ticks, vec![200]);
    }

    #[test]
    fn slipstream_path_handles_negative_tick_spacing() {
        let mut path = Vec::new();
        path.extend_from_slice(&[0x11; 20]);
        // tickSpacing = -1 in 24-bit two's complement: 0xFFFFFF
        path.extend_from_slice(&[0xff, 0xff, 0xff]);
        path.extend_from_slice(&[0x22; 20]);
        let (_tokens, ticks) = decode_slipstream_path(&path).unwrap();
        assert_eq!(ticks, vec![-1]);
    }

    #[test]
    fn slipstream_path_handles_int24_min_two_complement() {
        let mut path = Vec::new();
        path.extend_from_slice(&[0x11; 20]);
        // tickSpacing = -8388608 (i24::MIN) = 0x800000
        path.extend_from_slice(&[0x80, 0x00, 0x00]);
        path.extend_from_slice(&[0x22; 20]);
        let (_tokens, ticks) = decode_slipstream_path(&path).unwrap();
        assert_eq!(ticks, vec![-8_388_608]);
    }

    #[test]
    fn slipstream_path_rejects_invalid_length() {
        assert!(decode_slipstream_path(&[]).is_err());
        assert!(decode_slipstream_path(&[0u8; 22]).is_err());
        // 20+23+22 (incomplete second hop)
        assert!(decode_slipstream_path(&[0u8; 65]).is_err());
    }
}
