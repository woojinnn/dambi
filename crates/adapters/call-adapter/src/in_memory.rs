use std::collections::HashMap;
use std::sync::Arc;

use crate::call_adapter::{CallAdapter, CallAdapterRegistry};

pub struct InMemoryCallAdapterRegistry {
    by_key: HashMap<abi_resolver::CallMatchKey, Arc<dyn CallAdapter>>,
}

impl InMemoryCallAdapterRegistry {
    pub fn new() -> Self {
        Self {
            by_key: HashMap::new(),
        }
    }

    pub fn builder() -> InMemoryCallAdapterRegistryBuilder {
        InMemoryCallAdapterRegistryBuilder {
            adapters: Vec::new(),
        }
    }

    pub fn empty() -> Self {
        Self::new()
    }

    /// Convenience: build a registry containing one DefaultCallAdapter per
    /// (chain_id, to, selector) key registered in a DecoderRegistry. This is
    /// the typical "wire everything up" path; specialty CallAdapter impls
    /// can be layered on top using `builder().register(...)`.
    pub fn from_decoder_registry(decoder_reg: &dyn abi_resolver::DecoderRegistry) -> Self {
        let mut builder = Self::builder();
        for key in decoder_reg.match_keys() {
            let id = crate::call_adapter::CallAdapterId(format!(
                "default/chain={}/to={}/sel=0x{}",
                key.chain_id,
                key.to,
                hex::encode(key.selector)
            ));
            let adapter = crate::default::DefaultCallAdapter::new(id, vec![key]);
            builder = builder.register(Arc::new(adapter));
        }
        builder.build()
    }
}

impl Default for InMemoryCallAdapterRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub struct InMemoryCallAdapterRegistryBuilder {
    adapters: Vec<Arc<dyn CallAdapter>>,
}

impl InMemoryCallAdapterRegistryBuilder {
    pub fn register(mut self, adapter: Arc<dyn CallAdapter>) -> Self {
        self.adapters.push(adapter);
        self
    }

    pub fn build(self) -> InMemoryCallAdapterRegistry {
        let mut by_key = HashMap::new();
        for a in self.adapters {
            for k in a.match_keys() {
                if let Some(existing) = by_key.insert(k.clone(), a.clone()) {
                    panic!(
                        "duplicate call adapter match key {:?}: existing={:?} new={:?}",
                        k,
                        existing.id(),
                        a.id()
                    );
                }
            }
        }
        InMemoryCallAdapterRegistry { by_key }
    }
}

impl CallAdapterRegistry for InMemoryCallAdapterRegistry {
    fn resolve(&self, key: &abi_resolver::CallMatchKey) -> Option<Arc<dyn CallAdapter>> {
        self.by_key.get(key).cloned()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use abi_resolver::{
        CallMatchKey, DecodeContext, DecodedCall, Decoder, DecoderError, DecoderId,
        InMemoryDecoderRegistry,
    };
    use policy_engine::action::Address;

    use crate::{
        CallAdapter, CallAdapterId, CallAdapterRegistry, CallContext, InMemoryCallAdapterRegistry,
    };

    struct MockCallAdapter {
        id: CallAdapterId,
        keys: Vec<CallMatchKey>,
    }

    impl MockCallAdapter {
        fn new(id: &str, keys: Vec<CallMatchKey>) -> Self {
            Self {
                id: CallAdapterId::new(id),
                keys,
            }
        }
    }

    impl CallAdapter for MockCallAdapter {
        fn id(&self) -> CallAdapterId {
            self.id.clone()
        }

        fn match_keys(&self) -> Vec<CallMatchKey> {
            self.keys.clone()
        }

        fn build(
            &self,
            _ctx: &CallContext<'_>,
            _calldata: &[u8],
        ) -> Result<Vec<policy_engine::ActionEnvelope>, crate::AdapterError> {
            Ok(Vec::new())
        }
    }

    struct MockDecoder {
        id: DecoderId,
        keys: Vec<CallMatchKey>,
    }

    impl MockDecoder {
        fn new(id: &str, keys: Vec<CallMatchKey>) -> Self {
            Self {
                id: DecoderId::new(id),
                keys,
            }
        }
    }

    impl Decoder for MockDecoder {
        fn id(&self) -> DecoderId {
            self.id.clone()
        }

        fn match_keys(&self) -> Vec<CallMatchKey> {
            self.keys.clone()
        }

        fn decode(
            &self,
            _ctx: &DecodeContext<'_>,
            _calldata: &[u8],
        ) -> Result<DecodedCall, DecoderError> {
            Err(DecoderError::UnsupportedSelector)
        }
    }

    fn address(value: &str) -> Address {
        value.parse().unwrap()
    }

    fn key(selector: [u8; 4]) -> CallMatchKey {
        CallMatchKey {
            chain_id: 1,
            to: address("0x2222222222222222222222222222222222222222"),
            selector,
        }
    }

    #[test]
    fn test_in_memory_registry_resolves() {
        let key = key([0xde, 0xad, 0xbe, 0xef]);
        let registry = InMemoryCallAdapterRegistry::builder()
            .register(Arc::new(MockCallAdapter::new("mock", vec![key.clone()])))
            .build();

        let adapter = registry.resolve(&key).expect("adapter should resolve");

        assert_eq!(adapter.id().as_str(), "mock");
    }

    #[test]
    #[should_panic]
    fn test_in_memory_registry_panics_on_duplicate() {
        let key = key([0xde, 0xad, 0xbe, 0xef]);

        let _registry = InMemoryCallAdapterRegistry::builder()
            .register(Arc::new(MockCallAdapter::new("first", vec![key.clone()])))
            .register(Arc::new(MockCallAdapter::new("second", vec![key])))
            .build();
    }

    #[test]
    fn test_from_decoder_registry_pairs_one_adapter_per_key() {
        let keys = vec![
            key([0x00, 0x00, 0x00, 0x01]),
            key([0x00, 0x00, 0x00, 0x02]),
            key([0x00, 0x00, 0x00, 0x03]),
        ];
        let decoder_registry = InMemoryDecoderRegistry::builder()
            .register(Arc::new(MockDecoder::new("mock-decoder", keys.clone())))
            .build();

        let registry = InMemoryCallAdapterRegistry::from_decoder_registry(&decoder_registry);

        for key in keys {
            let adapter = registry.resolve(&key).expect("adapter should resolve");
            assert!(adapter.id().as_str().starts_with("default/chain=1/"));
            assert_eq!(adapter.match_keys(), vec![key.clone()]);
        }
    }
}
