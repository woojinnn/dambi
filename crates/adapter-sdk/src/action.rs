//! Minimal action types. Host translates these into the engine's full
//! `policy_engine::Action` enum during lowering. SDK keeps a wire-compatible
//! slice — adapters never see the Cedar-side richness.

use crate::primitives::{Address, ChainId};
use crate::types::DecodedCall;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    Other {
        chain_id: ChainId,
        target: Address,
        decoded: Option<DecodedCall>,
    },
    Custom {
        chain_id: ChainId,
        target: Address,
        name: String,
        fields: serde_json::Value,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionEnvelope {
    pub action: Action,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub trace: serde_json::Value,
}

impl ActionEnvelope {
    pub fn new(action: Action) -> Self {
        Self { action, trace: serde_json::Value::Null }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn envelope_default_trace_omitted_in_json() {
        let env = ActionEnvelope::new(Action::Other {
            chain_id: 1,
            target: Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
            decoded: None,
        });
        let s = serde_json::to_string(&env).unwrap();
        assert!(!s.contains("trace"));
    }
}
