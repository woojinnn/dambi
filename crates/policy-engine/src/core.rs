//! Core domain types: Address, Token, AmountSpec, Action.

use alloy_primitives::{Address as AlloyAddress, U256};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// EVM address as a lowercase hex string with 0x prefix.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Address(String);

impl Address {
    pub fn new(s: &str) -> Result<Self, String> {
        let parsed = AlloyAddress::from_str(s).map_err(|e| format!("invalid address: {e}"))?;
        Ok(Address(format!("{parsed:#x}")))
    }

    pub fn from_alloy(a: AlloyAddress) -> Self {
        Address(format!("{a:#x}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Chain id (EIP-155).
pub type ChainId = u64;

/// Token metadata as the engine sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Token {
    pub chain_id: ChainId,
    pub address: Address,
    pub symbol: String,
    pub decimals: u32,
    pub is_native: bool,
}

impl Token {
    pub fn key(&self) -> String {
        format!("{}:{}", self.chain_id, self.address.as_str().to_lowercase())
    }
}

/// Provenance + value information about an oracle-derived USD valuation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsdValuation {
    /// USD value as a stringified decimal (e.g., "1234.56").
    /// We use a string here because Cedar's `Decimal` extension is the place
    /// that actually does the comparison and we want to avoid f64 drift.
    pub value: String,
    pub as_of_ts: u64,
    pub sources: Vec<String>,
    pub stale_sec: u64,
}

/// Amount paired with its token, with optional human-readable and USD views.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AmountSpec {
    pub token: Token,
    /// Wei-scale raw amount as decimal string (so we can carry full U256 range).
    pub raw: String,
    /// Optional `raw / 10^decimals` representation as a decimal string.
    pub human: Option<String>,
    /// Optional USD valuation; present when an oracle was available.
    pub usd: Option<UsdValuation>,
}

impl AmountSpec {
    pub fn from_raw(token: Token, raw: U256) -> Self {
        AmountSpec {
            token,
            raw: raw.to_string(),
            human: None,
            usd: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OracleRequirementKind {
    #[serde(rename = "input")]
    Input,
    #[serde(rename = "minOutput")]
    MinOutput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OracleRequirement {
    pub kind: OracleRequirementKind,
    pub token: Token,
    pub raw_amount: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct WindowStatsContext {
    pub swap_volume_usd_24h: Option<String>,
    pub swap_count_24h: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DexFacts {
    pub protocol_ids: Vec<String>,
    pub input_tokens: Vec<Token>,
    pub output_tokens: Vec<Token>,
    pub total_input_usd: Option<UsdValuation>,
    pub total_min_output_usd: Option<UsdValuation>,
    pub max_fee_bps: Option<u32>,
    pub has_zero_min_output: bool,
    pub has_external_recipient: bool,
    pub total_input_fraction_of_portfolio_bps: Option<u64>,
    pub allowances_cover_inputs: Option<bool>,
    pub window_stats: Option<WindowStatsContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DexTrace {
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DexAction {
    pub actor: Address,
    pub target: Address,
    pub value_wei: String,
    pub facts: DexFacts,
    pub oracle_requirements: Vec<OracleRequirement>,
    pub trace: DexTrace,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OtherAction {
    pub actor: Address,
    pub target: Address,
    pub selector: String,
    pub value_wei: String,
    pub raw_calldata: String,
}

/// Semantic action emitted by adapters.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Action {
    #[serde(rename = "dex")]
    Dex(DexAction),
    #[serde(rename = "other")]
    Other(OtherAction),
}

impl Action {
    pub fn kind(&self) -> &'static str {
        match self {
            Action::Dex(_) => "dex",
            Action::Other(_) => "other",
        }
    }

    pub fn target(&self) -> &Address {
        match self {
            Action::Dex(d) => &d.target,
            Action::Other(o) => &o.target,
        }
    }

    pub fn actor(&self) -> &Address {
        match self {
            Action::Dex(d) => &d.actor,
            Action::Other(o) => &o.actor,
        }
    }
}

/// What a wallet receives from a dapp/RPC layer when the user is asked to
/// sign a transaction. This is the unsigned-tx shape (the wallet has not yet
/// produced a signature). Fields that v0.1 policies don't reference yet
/// (`gas`, `nonce`, EIP-1559 fee fields) are kept as `Option` so future
/// policies (e.g., "reject txs with gas above X") can read them without
/// breaking existing call sites.
///
/// Naming aligns with `alloy::TransactionRequest` and `ethers::TransactionRequest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub chain_id: ChainId,
    pub from: Address,
    pub to: Address,
    /// `msg.value` in wei, decimal-encoded so we can carry a full U256.
    pub value_wei: String,
    /// Calldata (function selector + ABI-encoded args).
    pub data: Vec<u8>,
    /// Gas limit, when known.
    pub gas: Option<u64>,
    /// Account nonce, when known.
    pub nonce: Option<u64>,
}

impl TransactionRequest {
    /// First four bytes of `data`, if present — the ABI function selector.
    pub fn selector(&self) -> Option<[u8; 4]> {
        if self.data.len() < 4 {
            return None;
        }
        Some([self.data[0], self.data[1], self.data[2], self.data[3]])
    }

    pub fn selector_hex(&self) -> Option<String> {
        self.selector().map(|s| format!("0x{}", hex::encode(s)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_normalizes_to_lowercase_hex() {
        let a = Address::new("0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48").unwrap();
        assert_eq!(a.as_str(), "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    }

    #[test]
    fn address_rejects_garbage() {
        assert!(Address::new("not-an-address").is_err());
        assert!(Address::new("0x1234").is_err());
    }

    #[test]
    fn token_key_is_chain_qualified() {
        let t = Token {
            chain_id: 1,
            address: Address::new("0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48").unwrap(),
            symbol: "USDC".into(),
            decimals: 6,
            is_native: false,
        };
        assert_eq!(t.key(), "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    }

    #[test]
    fn tx_selector_is_first_four_bytes() {
        let mut data = vec![0x41, 0x4b, 0xf3, 0x89];
        data.extend_from_slice(&[0u8; 32]);
        let tx = TransactionRequest {
            chain_id: 1,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new("0x0000000000000000000000000000000000000002").unwrap(),
            value_wei: "0".into(),
            data,
            gas: None,
            nonce: None,
        };
        assert_eq!(tx.selector_hex().unwrap(), "0x414bf389");
    }

    #[test]
    fn tx_selector_returns_none_for_short_data() {
        let tx = TransactionRequest {
            chain_id: 1,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new("0x0000000000000000000000000000000000000002").unwrap(),
            value_wei: "0".into(),
            data: vec![0x41, 0x4b],
            gas: None,
            nonce: None,
        };
        assert!(tx.selector_hex().is_none());
    }

    #[test]
    fn tx_carries_optional_gas_and_nonce() {
        let tx = TransactionRequest {
            chain_id: 1,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: Address::new("0x0000000000000000000000000000000000000002").unwrap(),
            value_wei: "0".into(),
            data: vec![0x00, 0x01, 0x02, 0x03],
            gas: Some(200_000),
            nonce: Some(42),
        };
        assert_eq!(tx.gas, Some(200_000));
        assert_eq!(tx.nonce, Some(42));
    }

    #[test]
    fn dex_action_kind_actor_and_target_are_transaction_level() {
        let actor = Address::new("0x0000000000000000000000000000000000000001").unwrap();
        let target = Address::new("0x0000000000000000000000000000000000000002").unwrap();
        let action = Action::Dex(DexAction {
            actor: actor.clone(),
            target: target.clone(),
            value_wei: "0".into(),
            facts: DexFacts::default(),
            oracle_requirements: Vec::new(),
            trace: DexTrace::default(),
        });

        assert_eq!(action.kind(), "dex");
        assert_eq!(action.actor(), &actor);
        assert_eq!(action.target(), &target);
    }

    #[test]
    fn other_action_kind_actor_and_target_are_transaction_level() {
        let actor = Address::new("0x0000000000000000000000000000000000000001").unwrap();
        let target = Address::new("0x0000000000000000000000000000000000000002").unwrap();
        let action = Action::Other(OtherAction {
            actor: actor.clone(),
            target: target.clone(),
            selector: "0x12345678".into(),
            value_wei: "7".into(),
            raw_calldata: "0x12345678".into(),
        });

        assert_eq!(action.kind(), "other");
        assert_eq!(action.actor(), &actor);
        assert_eq!(action.target(), &target);
    }

    #[test]
    fn action_serializes_with_kind_variant_names() {
        let actor = Address::new("0x0000000000000000000000000000000000000001").unwrap();
        let target = Address::new("0x0000000000000000000000000000000000000002").unwrap();

        let dex = Action::Dex(DexAction {
            actor: actor.clone(),
            target: target.clone(),
            value_wei: "0".into(),
            facts: DexFacts::default(),
            oracle_requirements: Vec::new(),
            trace: DexTrace::default(),
        });
        let other = Action::Other(OtherAction {
            actor,
            target,
            selector: "0x12345678".into(),
            value_wei: "7".into(),
            raw_calldata: "0x12345678".into(),
        });

        assert!(serde_json::to_value(dex).unwrap().get("dex").is_some());
        assert!(serde_json::to_value(other).unwrap().get("other").is_some());
    }

    #[test]
    fn action_dex_kind_string() {
        let zero = Address::new("0x0000000000000000000000000000000000000000").unwrap();
        let act = Action::Dex(DexAction {
            actor: zero.clone(),
            target: zero,
            value_wei: "0".into(),
            facts: DexFacts::default(),
            oracle_requirements: Vec::new(),
            trace: DexTrace::default(),
        });
        assert_eq!(act.kind(), "dex");
    }
}
