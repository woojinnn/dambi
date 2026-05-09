//! Shared resources for PancakeSwap V2 (AMM) Router swap-function adapters.
//!
//! PancakeSwap V2 is an ABI-level fork of Uniswap V2 Router02. Selectors,
//! struct shapes, and per-function semantics are identical; only the deployed
//! router address, the default chain, the protocol id reported in `DexFacts`,
//! and the constant fee (25 bps vs Uniswap V2's 30 bps) differ.

use alloy_primitives::{address, Address as AlloyAddress};
use policy_engine::prelude::*;
use std::collections::HashMap;

/// PancakeSwap V2 (Router v2) on BSC.
pub const PANCAKESWAP_V2_ROUTER_BSC: &str = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

/// Sentinel address used to represent the chain's native asset (BNB on BSC)
/// inside our `Token` model. Not the same as any deployed token contract.
pub const NATIVE_BNB_SENTINEL: &str = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/// Construct a `Token` representing native BNB on the given chain.
///
/// Even though PancakeSwap's `swap*ETH*` functions are named after ETH
/// (a verbatim fork of Uniswap V2's API), on BSC the native asset is BNB.
/// The returned `Token.symbol` is `"BNB"`.
#[must_use]
pub fn native_bnb(chain_id: ChainId) -> Token {
    Token {
        chain_id,
        address: Address::from_alloy(address!("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")),
        symbol: "BNB".into(),
        decimals: 18,
        is_native: true,
    }
}

pub(crate) fn router_address() -> Address {
    Address::from_alloy(address!("0x10ed43c718714eb63d5aa57b78b54704e256024e"))
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
            "pancakeswap-amm path must contain at least 2 tokens, got {}",
            path.len()
        )));
    }
    Ok((path[0], path[path.len() - 1]))
}

/// Build a DEX swap action from decoded PancakeSwap V2 router parameters.
///
/// `protocol_id` is always `"pancakeswap-amm"` for this crate; it is taken
/// as a parameter so callers cannot accidentally drift the wire id.
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

/// Token metadata lookup for PancakeSwap V2 swap adapters.
#[derive(Debug)]
pub struct TokenLookup {
    tokens: HashMap<(ChainId, String), Token>,
}

impl TokenLookup {
    /// Builds a lookup pre-populated with WBNB, USDT (BSC), BUSD, and CAKE.
    ///
    /// Note: BSC USDT is an 18-decimal BEP-20 token, in contrast to
    /// mainnet Ethereum USDT's 6 decimals. Callers that hardcode amounts
    /// must respect the chain-specific decimal count.
    #[must_use]
    pub fn with_bsc_defaults() -> Self {
        let mut me = Self {
            tokens: HashMap::new(),
        };
        // WBNB
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c")),
            symbol: "WBNB".into(),
            decimals: 18,
            is_native: false,
        });
        // BSC USDT (Tether on BNB Smart Chain) — 18 decimals on BSC
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0x55d398326f99059ff775485246999027b3197955")),
            symbol: "USDT".into(),
            decimals: 18,
            is_native: false,
        });
        // BUSD
        me.add(Token {
            chain_id: 56,
            address: Address::from_alloy(address!("0xe9e7cea3dedca5984780bafc599bd69add087d56")),
            symbol: "BUSD".into(),
            decimals: 18,
            is_native: false,
        });
        // CAKE
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
        Self::with_bsc_defaults()
    }
}

/// Errors returned by PancakeSwap V2 calldata decoders. Identical in shape
/// to the Uniswap V2 adapter's `DecodeError`.
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
    /// Swap path did not contain both input and output tokens.
    #[error("path must contain at least 2 tokens, got {0}")]
    EmptyPath(usize),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_bnb_marks_is_native_with_bnb_symbol() {
        let n = native_bnb(56);
        assert!(n.is_native);
        assert_eq!(n.symbol, "BNB");
        assert_eq!(n.decimals, 18);
        assert_eq!(n.chain_id, 56);
    }

    #[test]
    fn token_lookup_returns_known_bsc_tokens() {
        let lookup = TokenLookup::with_bsc_defaults();
        let cake = Address::new("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82").unwrap();
        assert_eq!(lookup.get(56, &cake).symbol, "CAKE");
        let busd = Address::new("0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56").unwrap();
        assert_eq!(lookup.get(56, &busd).symbol, "BUSD");
    }

    #[test]
    fn bsc_usdt_has_18_decimals_unlike_mainnet() {
        let lookup = TokenLookup::with_bsc_defaults();
        let usdt = Address::new("0x55d398326f99059fF775485246999027B3197955").unwrap();
        let t = lookup.get(56, &usdt);
        assert_eq!(t.symbol, "USDT");
        assert_eq!(t.decimals, 18);
    }

    #[test]
    fn token_lookup_unknown_falls_back() {
        let lookup = TokenLookup::with_bsc_defaults();
        let unknown = Address::new("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        assert_eq!(lookup.get(56, &unknown).symbol, "UNKNOWN");
    }

    #[test]
    fn token_lookup_keys_by_chain_id() {
        let lookup = TokenLookup::with_bsc_defaults();
        let cake = Address::new("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82").unwrap();
        // CAKE on Ethereum (chain_id 1) is not registered → UNKNOWN fallback.
        assert_eq!(lookup.get(1, &cake).symbol, "UNKNOWN");
    }

    #[test]
    fn dex_swap_action_emits_pancakeswap_amm_protocol_id_and_25bps_fee() {
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new(PANCAKESWAP_V2_ROUTER_BSC).unwrap(),
            value_wei: "0".into(),
            data: Vec::new(),
            gas: None,
            nonce: None,
        };
        let input_token = Token {
            chain_id: 56,
            address: Address::new("0x55d398326f99059fF775485246999027B3197955").unwrap(),
            symbol: "USDT".into(),
            decimals: 18,
            is_native: false,
        };
        let output_token = Token {
            chain_id: 56,
            address: Address::new("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c").unwrap(),
            symbol: "WBNB".into(),
            decimals: 18,
            is_native: false,
        };
        match dex_swap_action(
            &tx,
            "pancakeswap-amm",
            input_token,
            output_token,
            "100".into(),
            Some("0".into()),
            &Address::new("0x0000000000000000000000000000000000000002").unwrap(),
            Some(25),
            "pancakeswap-amm/test",
        ) {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["pancakeswap-amm".to_string()]);
                assert_eq!(d.facts.max_fee_bps, Some(25));
                assert!(d.facts.has_zero_min_output);
                assert!(d.facts.has_external_recipient);
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
