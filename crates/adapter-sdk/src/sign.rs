//! Sign-request shapes. Same vocabulary as `crates/adapters/sign-resolver`.

use crate::primitives::{Address, ChainId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignMethod {
    EthSignTypedDataV4,
    PersonalSign,
    EthSign,
    EthSignTransaction,
    EthSendUserOperation,
    WalletGrantPermissions,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "snake_case")]
pub enum SignPayload {
    TypedData(serde_json::Value),
    RawMessage(String),
    RawHash(String),
    Transaction(serde_json::Value),
    UserOperation { user_op: serde_json::Value, entry_point: String },
    PermissionRequest(serde_json::Value),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignRequest {
    pub method: SignMethod,
    pub signer: Address,
    pub chain_id: ChainId,
    pub payload: SignPayload,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn sign_request_roundtrip() {
        let req = SignRequest {
            method: SignMethod::PersonalSign,
            signer: Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
            chain_id: 1,
            payload: SignPayload::RawMessage("0xdeadbeef".into()),
        };
        let s = serde_json::to_string(&req).unwrap();
        let back: SignRequest = serde_json::from_str(&s).unwrap();
        assert_eq!(req, back);
    }
}
