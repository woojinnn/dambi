//! `Adapter` trait — the contract every per-protocol calldata mapper
//! implements. Concrete adapter crates live under `crates/adapters/<name>/`
//! and program against [`crate::prelude`].
//!
//! Two responsibilities:
//! - [`Adapter::build`] — protocol-specific decoding: parsed calldata →
//!   semantic [`Action`].
//! - [`Adapter::build_actions`] — optional multi-leaf expansion.
//! - [`Adapter::leaf_metadata`] — optional per-leaf metadata injection.

use crate::core::{Action, Address, ChainId, TransactionRequest};
use serde_json::Map;
use std::sync::Arc;
use thiserror::Error;

/// Stable identifier for an adapter (e.g., `uniswap-v3/exactInputSingle@0.1.0`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AdapterId {
    raw: String,
    protocol_end: usize,
    name_end: usize,
    version_start: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AdapterIdParts<'a> {
    pub protocol: &'a str,
    pub name: &'a str,
    pub version: Option<&'a str>,
}

impl AdapterId {
    pub fn new(s: &str) -> Result<Self, AdapterIdError> {
        let parsed = parse_adapter_id(s)?;
        Ok(Self {
            raw: s.to_string(),
            protocol_end: parsed.protocol_end,
            name_end: parsed.name_end,
            version_start: parsed.version_start,
        })
    }

    pub fn parts(s: &str) -> Result<AdapterIdParts<'_>, AdapterIdError> {
        let parsed = parse_adapter_id(s)?;
        Ok(AdapterIdParts {
            protocol: &s[..parsed.protocol_end],
            name: &s[(parsed.protocol_end + 1)..parsed.name_end],
            version: parsed.version_start.map(|start| &s[start..]),
        })
    }

    pub fn protocol(&self) -> &str {
        &self.raw[..self.protocol_end]
    }

    pub fn name(&self) -> &str {
        &self.raw[(self.protocol_end + 1)..self.name_end]
    }

    pub fn version(&self) -> Option<&str> {
        self.version_start.map(|start| &self.raw[start..])
    }

    pub fn as_str(&self) -> &str {
        &self.raw
    }
}

#[derive(Debug, Error, PartialEq)]
pub enum AdapterIdError {
    #[error("adapter id is empty")]
    Empty,
    #[error("adapter id has missing protocol separator: expected <protocol>/<name>[@<version>]")]
    MissingSeparator,
    #[error("adapter id must include a protocol")]
    MissingProtocol,
    #[error("adapter id must include a name")]
    MissingName,
    #[error("adapter id has an empty version component")]
    EmptyVersion,
    #[error("adapter id has an invalid version '{version}'")]
    InvalidVersion { version: String },
}

#[derive(Debug, Clone, Copy)]
struct ParsedAdapterId {
    protocol_end: usize,
    name_end: usize,
    version_start: Option<usize>,
}

fn parse_adapter_id(s: &str) -> Result<ParsedAdapterId, AdapterIdError> {
    if s.is_empty() {
        return Err(AdapterIdError::Empty);
    }

    let Some((protocol, tail)) = s.split_once('/') else {
        return Err(AdapterIdError::MissingSeparator);
    };
    if protocol.is_empty() {
        return Err(AdapterIdError::MissingProtocol);
    }

    if tail.is_empty() {
        return Err(AdapterIdError::MissingName);
    }

    let protocol_len = protocol.len();
    let (name, version_start) = if let Some((name, version)) = tail.split_once('@') {
        if name.is_empty() {
            return Err(AdapterIdError::MissingName);
        }
        if version.is_empty() {
            return Err(AdapterIdError::EmptyVersion);
        }
        if !is_valid_version(version) {
            return Err(AdapterIdError::InvalidVersion {
                version: version.to_string(),
            });
        }
        (name, Some(protocol_len + 1 + name.len() + 1))
    } else {
        (tail, None)
    };

    let name_end = protocol_len + 1 + name.len();
    let name_start = protocol_len + 1;
    if name_start >= name_end {
        return Err(AdapterIdError::MissingName);
    }

    Ok(ParsedAdapterId {
        protocol_end: protocol_len,
        name_end,
        version_start,
    })
}

fn is_valid_version(version: &str) -> bool {
    version.split('.').all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    })
}

#[derive(Debug, Error, PartialEq)]
pub enum AdapterError {
    #[error("adapter cannot decode this calldata: {0}")]
    BadCalldata(String),
}

/// Coarse adapter shape for registry/catalog UIs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterKind {
    /// One Solidity function maps to one adapter module.
    Function,
    /// One router function contains nested semantic calls.
    CompositeRouter,
}

/// Semantic action families an adapter may emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionKind {
    Swap,
    Multi,
    Other,
}

/// Solidity function surface covered by an adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SolidityFunction {
    pub name: String,
    pub signature: String,
    pub selector: [u8; 4],
}

/// Compile-time-friendly Solidity function descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SolidityFunctionSpec {
    pub name: &'static str,
    pub signature: &'static str,
    pub selector: [u8; 4],
}

impl SolidityFunctionSpec {
    pub const fn new(name: &'static str, signature: &'static str, selector: [u8; 4]) -> Self {
        Self {
            name,
            signature,
            selector,
        }
    }

    pub fn into_owned_function(self) -> SolidityFunction {
        SolidityFunction::new(self.name, self.signature, self.selector)
    }
}

impl SolidityFunction {
    pub fn new(name: &str, signature: &str, selector: [u8; 4]) -> Self {
        Self {
            name: name.into(),
            signature: signature.into(),
            selector,
        }
    }
}

/// A chain-specific contract address an adapter targets.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ContractTarget {
    pub chain_id: ChainId,
    pub address: Address,
}

impl ContractTarget {
    pub fn new(chain_id: ChainId, address: Address) -> Self {
        Self { chain_id, address }
    }

    pub fn match_key(&self, selector: [u8; 4]) -> MatchKey {
        MatchKey::exact(self.chain_id, self.address.clone(), selector)
    }
}

/// Static-ish metadata a registry can index before invoking an adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterDescriptor {
    pub id: AdapterId,
    pub protocol_id: String,
    pub kind: AdapterKind,
    pub functions: Vec<SolidityFunction>,
    pub match_keys: Vec<MatchKey>,
    pub emitted_actions: Vec<ActionKind>,
}

impl AdapterDescriptor {
    pub fn new(
        id: AdapterId,
        protocol_id: &str,
        kind: AdapterKind,
        functions: Vec<SolidityFunction>,
        match_keys: Vec<MatchKey>,
        emitted_actions: Vec<ActionKind>,
    ) -> Self {
        Self {
            id,
            protocol_id: protocol_id.into(),
            kind,
            functions,
            match_keys,
            emitted_actions,
        }
    }

    pub fn from_adapter(adapter: &dyn Adapter) -> Self {
        let id = adapter.id();
        let protocol_id = id.protocol().to_string();
        Self {
            id,
            protocol_id,
            kind: AdapterKind::Function,
            functions: Vec::new(),
            match_keys: adapter.match_keys(),
            emitted_actions: Vec::new(),
        }
    }
}

fn construct_typed_adapter<T: TypedAdapter>() -> Arc<dyn Adapter> {
    Arc::new(T::default())
}

/// Factory surface a remote/local adapter registry can use to instantiate an
/// adapter after it has matched the descriptor.
pub trait AdapterFactory: Send + Sync {
    fn descriptor(&self) -> AdapterDescriptor;
    fn create(&self) -> Arc<dyn Adapter>;
}

pub type AdapterConstructor = fn() -> Arc<dyn Adapter>;

#[derive(Clone)]
pub struct StaticAdapterFactory {
    descriptor: AdapterDescriptor,
    constructor: AdapterConstructor,
}

impl StaticAdapterFactory {
    pub fn new(descriptor: AdapterDescriptor, constructor: AdapterConstructor) -> Self {
        Self {
            descriptor,
            constructor,
        }
    }
}

impl AdapterFactory for StaticAdapterFactory {
    fn descriptor(&self) -> AdapterDescriptor {
        self.descriptor.clone()
    }

    fn create(&self) -> Arc<dyn Adapter> {
        (self.constructor)()
    }
}

/// Typed authoring surface for third-party adapters.
///
/// Implement this trait when one crate/module owns one logical adapter. The
/// associated constants describe the registry-visible surface; `build_action`
/// is the only protocol-specific runtime function simple adapters must provide.
pub trait TypedAdapter: Send + Sync + Default + Sized + 'static {
    const ADAPTER_ID: &'static str;
    const PROTOCOL_ID: &'static str;
    const KIND: AdapterKind;
    const FUNCTIONS: &'static [SolidityFunctionSpec];
    const EMITTED_ACTIONS: &'static [ActionKind];

    fn contract_targets(&self) -> Vec<ContractTarget>;

    fn build_action(&self, tx: &TransactionRequest) -> Result<Action, AdapterError>;

    fn build_leaf_actions(&self, tx: &TransactionRequest) -> Result<Vec<Action>, AdapterError> {
        Ok(vec![self.build_action(tx)?])
    }

    fn typed_leaf_metadata(
        &self,
        tx: &TransactionRequest,
        leaves: &[Action],
    ) -> Vec<Map<String, serde_json::Value>> {
        let _ = (tx, leaves);
        leaves.iter().map(|_| Default::default()).collect()
    }

    fn adapter_id() -> AdapterId {
        AdapterId::new(Self::ADAPTER_ID).expect("static AdapterId is well-formed")
    }

    fn typed_match_keys(&self) -> Vec<MatchKey> {
        let targets = self.contract_targets();
        targets
            .iter()
            .flat_map(|target| {
                Self::FUNCTIONS
                    .iter()
                    .map(|function| target.match_key(function.selector))
            })
            .collect()
    }

    fn typed_descriptor(&self) -> AdapterDescriptor {
        let id = Self::adapter_id();
        let protocol_id = id.protocol().to_string();
        AdapterDescriptor::new(
            id,
            &protocol_id,
            Self::KIND,
            Self::FUNCTIONS
                .iter()
                .map(|f| f.into_owned_function())
                .collect(),
            self.typed_match_keys(),
            Self::EMITTED_ACTIONS.to_vec(),
        )
    }

    fn factory() -> StaticAdapterFactory {
        StaticAdapterFactory::new(
            Self::default().typed_descriptor(),
            construct_typed_adapter::<Self>,
        )
    }
}

impl<T> Adapter for T
where
    T: TypedAdapter,
{
    fn id(&self) -> AdapterId {
        T::adapter_id()
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.typed_match_keys()
    }

    fn descriptor(&self) -> AdapterDescriptor {
        self.typed_descriptor()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        self.build_action(tx)
    }

    fn build_actions(&self, tx: &TransactionRequest) -> Result<Vec<Action>, AdapterError> {
        self.build_leaf_actions(tx)
    }

    fn leaf_metadata(
        &self,
        tx: &TransactionRequest,
        leaves: &[Action],
    ) -> Vec<Map<String, serde_json::Value>> {
        self.typed_leaf_metadata(tx, leaves)
    }
}

/// One adapter handles one (or a small set of) `(chain_id, to, selector)` keys
/// and emits an `Action` from a decoded `TransactionRequest`.
pub trait Adapter: Send + Sync {
    fn id(&self) -> AdapterId;

    /// The set of `(chain_id, to, selector)` keys this adapter wants to match.
    /// `to == None` means "any contract address".
    fn match_keys(&self) -> Vec<MatchKey>;

    /// Registry/catalog metadata. Simple adapters can use the default; richer
    /// adapters should override it with function signatures and action kinds.
    fn descriptor(&self) -> AdapterDescriptor {
        let id = self.id();
        let protocol_id = id.protocol().to_string();
        AdapterDescriptor {
            id,
            protocol_id,
            kind: AdapterKind::Function,
            functions: Vec::new(),
            match_keys: self.match_keys(),
            emitted_actions: Vec::new(),
        }
    }

    /// Try to construct an `Action` from this transaction. Called only after
    /// the resolver has selected this adapter, so the implementation may
    /// assume the calldata starts with the matching selector.
    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError>;

    /// Construct zero or more semantic leaf actions. Simple adapters keep the
    /// default one-action behavior; composite routers override this.
    fn build_actions(&self, tx: &TransactionRequest) -> Result<Vec<Action>, AdapterError> {
        Ok(vec![self.build(tx)?])
    }

    /// Optional protocol-specific metadata to stamp into each leaf request context.
    /// Defaults to one empty map per leaf.
    fn leaf_metadata(
        &self,
        tx: &TransactionRequest,
        leaves: &[Action],
    ) -> Vec<Map<String, serde_json::Value>> {
        let _ = tx;
        leaves.iter().map(|_| Default::default()).collect()
    }
}

/// A single `(chain_id, to, selector)` pattern an adapter matches.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MatchKey {
    pub chain_id: ChainId,
    /// `None` represents the wildcard (`"*"` in the manifest spec).
    pub to: Option<Address>,
    pub selector: [u8; 4],
}

impl MatchKey {
    pub fn exact(chain_id: ChainId, to: Address, selector: [u8; 4]) -> Self {
        MatchKey {
            chain_id,
            to: Some(to),
            selector,
        }
    }

    pub fn wildcard_target(chain_id: ChainId, selector: [u8; 4]) -> Self {
        MatchKey {
            chain_id,
            to: None,
            selector,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct TypedNoopAdapter;

    impl TypedAdapter for TypedNoopAdapter {
        const ADAPTER_ID: &'static str = "test/typed-noop@0.0.1";
        const PROTOCOL_ID: &'static str = "test";
        const KIND: AdapterKind = AdapterKind::Function;
        const FUNCTIONS: &'static [SolidityFunctionSpec] = &[SolidityFunctionSpec::new(
            "noop",
            "noop(uint256)",
            [0xaa, 0xbb, 0xcc, 0xdd],
        )];
        const EMITTED_ACTIONS: &'static [ActionKind] = &[ActionKind::Other];

        fn contract_targets(&self) -> Vec<ContractTarget> {
            vec![ContractTarget::new(
                1,
                Address::new("0x1111111111111111111111111111111111111111").unwrap(),
            )]
        }

        fn build_action(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
            Ok(Action::Other {
                actor: tx.from.clone(),
                target: tx.to.clone(),
                selector: "0xaabbccdd".into(),
                value_wei: tx.value_wei.clone(),
                raw_calldata: hex::encode(&tx.data),
            })
        }
    }

    #[test]
    fn typed_adapter_supplies_runtime_adapter_contract() {
        let adapter = TypedNoopAdapter;
        let as_adapter: &dyn Adapter = &adapter;
        let target = Address::new("0x1111111111111111111111111111111111111111").unwrap();

        assert_eq!(
            as_adapter.id(),
            AdapterId::new("test/typed-noop@0.0.1").expect("static AdapterId is well-formed")
        );
        assert_eq!(
            as_adapter.match_keys(),
            vec![MatchKey::exact(1, target.clone(), [0xaa, 0xbb, 0xcc, 0xdd])]
        );

        let descriptor = as_adapter.descriptor();
        assert_eq!(descriptor.protocol_id, "test");
        assert_eq!(descriptor.kind, AdapterKind::Function);
        assert_eq!(descriptor.functions[0].signature, "noop(uint256)");
        assert_eq!(descriptor.emitted_actions, vec![ActionKind::Other]);
    }

    #[test]
    fn typed_adapter_factory_instantiates_adapter() {
        let factory = TypedNoopAdapter::factory();
        assert_eq!(
            factory.descriptor().id,
            AdapterId::new("test/typed-noop@0.0.1").expect("static AdapterId is well-formed")
        );
        assert_eq!(
            factory.create().id(),
            AdapterId::new("test/typed-noop@0.0.1").expect("static AdapterId is well-formed")
        );
    }
}
