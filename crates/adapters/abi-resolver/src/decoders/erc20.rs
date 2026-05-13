//! ERC-20 entrypoint decoders. Covers `approve(address,uint256)`,
//! `transfer(address,uint256)`, and `transferFrom(address,address,uint256)` by registering selector keys with the
//! zero-address wildcard `to` sentinel. Registries try exact
//! `(chain_id, to, selector)` matches first, then fall back to
//! `(chain_id, WILDCARD_TO, selector)` so selector-only ERC-20 logic can apply
//! to any token contract unless a more specific decoder is registered.

use std::str::FromStr as _;

use alloy_primitives::Address as AlloyAddress;
use alloy_sol_types::{sol, SolCall};
use policy_engine::action::Address;

use crate::{
    in_memory_registry::WILDCARD_TO, CallMatchKey, DecodeContext, DecodedArg, DecodedCall,
    DecodedValue, Decoder, DecoderError, DecoderId,
};

pub const ERC20_APPROVE_DECODER_ID: &str = "erc20/approve";
pub const ERC20_TRANSFER_DECODER_ID: &str = "erc20/transfer";
pub const ERC20_TRANSFER_FROM_DECODER_ID: &str = "erc20/transferFrom";

/// `approve(address,uint256)` selector. Same across every ERC-20.
pub const APPROVE_SELECTOR: [u8; 4] = [0x09, 0x5e, 0xa7, 0xb3];
/// `transfer(address,uint256)` selector. Same across every ERC-20.
pub const TRANSFER_SELECTOR: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];
/// `transferFrom(address,address,uint256)` selector. Same across every ERC-20.
pub const TRANSFER_FROM_SELECTOR: [u8; 4] = [0x23, 0xb8, 0x72, 0xdd];

const APPROVE_SIGNATURE: &str = "approve(address,uint256)";
const TRANSFER_SIGNATURE: &str = "transfer(address,uint256)";
const TRANSFER_FROM_SIGNATURE: &str = "transferFrom(address,address,uint256)";

sol! {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Erc20ApproveDecoder;

impl Erc20ApproveDecoder {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Decoder for Erc20ApproveDecoder {
    fn id(&self) -> DecoderId {
        DecoderId::new(ERC20_APPROVE_DECODER_ID)
    }

    fn match_keys(&self) -> Vec<CallMatchKey> {
        vec![CallMatchKey {
            chain_id: 1,
            to: WILDCARD_TO.clone(),
            selector: APPROVE_SELECTOR,
        }]
    }

    fn decode(
        &self,
        _ctx: &DecodeContext<'_>,
        calldata: &[u8],
    ) -> Result<DecodedCall, DecoderError> {
        let call = approveCall::abi_decode(calldata, true)
            .map_err(|e| DecoderError::AbiMismatch(e.to_string()))?;
        let spender = decode_address(&call.spender)?;
        Ok(DecodedCall {
            decoder_id: self.id(),
            function_signature: APPROVE_SIGNATURE.to_string(),
            args: vec![
                DecodedArg {
                    name: "spender".into(),
                    abi_type: "address".into(),
                    value: DecodedValue::Address(spender),
                },
                DecodedArg {
                    name: "amount".into(),
                    abi_type: "uint256".into(),
                    value: DecodedValue::Uint(call.amount),
                },
            ],
            nested: vec![],
        })
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Erc20TransferDecoder;

impl Erc20TransferDecoder {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Decoder for Erc20TransferDecoder {
    fn id(&self) -> DecoderId {
        DecoderId::new(ERC20_TRANSFER_DECODER_ID)
    }

    fn match_keys(&self) -> Vec<CallMatchKey> {
        vec![CallMatchKey {
            chain_id: 1,
            to: WILDCARD_TO.clone(),
            selector: TRANSFER_SELECTOR,
        }]
    }

    fn decode(
        &self,
        _ctx: &DecodeContext<'_>,
        calldata: &[u8],
    ) -> Result<DecodedCall, DecoderError> {
        let call = transferCall::abi_decode(calldata, true)
            .map_err(|e| DecoderError::AbiMismatch(e.to_string()))?;
        let to = decode_address(&call.to)?;
        Ok(DecodedCall {
            decoder_id: self.id(),
            function_signature: TRANSFER_SIGNATURE.to_string(),
            args: vec![
                DecodedArg {
                    name: "to".into(),
                    abi_type: "address".into(),
                    value: DecodedValue::Address(to),
                },
                DecodedArg {
                    name: "amount".into(),
                    abi_type: "uint256".into(),
                    value: DecodedValue::Uint(call.amount),
                },
            ],
            nested: vec![],
        })
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Erc20TransferFromDecoder;

impl Erc20TransferFromDecoder {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Decoder for Erc20TransferFromDecoder {
    fn id(&self) -> DecoderId {
        DecoderId::new(ERC20_TRANSFER_FROM_DECODER_ID)
    }

    fn match_keys(&self) -> Vec<CallMatchKey> {
        vec![CallMatchKey {
            chain_id: 1,
            to: WILDCARD_TO.clone(),
            selector: TRANSFER_FROM_SELECTOR,
        }]
    }

    fn decode(
        &self,
        _ctx: &DecodeContext<'_>,
        calldata: &[u8],
    ) -> Result<DecodedCall, DecoderError> {
        let call = transferFromCall::abi_decode(calldata, true)
            .map_err(|e| DecoderError::AbiMismatch(e.to_string()))?;
        let from = decode_address(&call.from)?;
        let to = decode_address(&call.to)?;
        Ok(DecodedCall {
            decoder_id: self.id(),
            function_signature: TRANSFER_FROM_SIGNATURE.to_string(),
            args: vec![
                DecodedArg {
                    name: "from".into(),
                    abi_type: "address".into(),
                    value: DecodedValue::Address(from),
                },
                DecodedArg {
                    name: "to".into(),
                    abi_type: "address".into(),
                    value: DecodedValue::Address(to),
                },
                DecodedArg {
                    name: "amount".into(),
                    abi_type: "uint256".into(),
                    value: DecodedValue::Uint(call.amount),
                },
            ],
            nested: vec![],
        })
    }
}

fn decode_address(value: &AlloyAddress) -> Result<Address, DecoderError> {
    Address::from_str(&format!("{value:#x}"))
        .map_err(|e| DecoderError::Internal(anyhow::anyhow!("address: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approve_match_key_uses_wildcard_to() {
        let adapter = Erc20ApproveDecoder::new();
        let keys = adapter.match_keys();
        assert_eq!(
            keys,
            vec![CallMatchKey {
                chain_id: 1,
                to: WILDCARD_TO.clone(),
                selector: APPROVE_SELECTOR,
            }]
        );
    }

    #[test]
    fn transfer_match_key_uses_wildcard_to() {
        let adapter = Erc20TransferDecoder::new();
        let keys = adapter.match_keys();
        assert_eq!(
            keys,
            vec![CallMatchKey {
                chain_id: 1,
                to: WILDCARD_TO.clone(),
                selector: TRANSFER_SELECTOR,
            }]
        );
    }

    #[test]
    fn transfer_from_match_key_uses_wildcard_to() {
        let adapter = Erc20TransferFromDecoder::new();
        let keys = adapter.match_keys();
        assert_eq!(
            keys,
            vec![CallMatchKey {
                chain_id: 1,
                to: WILDCARD_TO.clone(),
                selector: TRANSFER_FROM_SELECTOR,
            }]
        );
    }

    #[test]
    fn decodes_unlimited_approve() {
        let adapter = Erc20ApproveDecoder::new();
        // approve(0x1111..., uint256::MAX)
        let calldata: Vec<u8> = {
            let mut v = Vec::from(APPROVE_SELECTOR);
            v.extend_from_slice(&[0u8; 12]);
            v.extend_from_slice(&[0x11; 20]);
            v.extend_from_slice(&[0xff; 32]);
            v
        };
        let to = Address::from_str("0x1234567890123456789012345678901234567890").unwrap();
        let value = policy_engine::action::DecimalString::from_str("0").unwrap();
        let ctx = DecodeContext {
            chain_id: 1,
            to: &to,
            value: &value,
            block_timestamp: None,
        };
        let decoded = adapter.decode(&ctx, &calldata).unwrap();
        assert_eq!(decoded.decoder_id.as_str(), ERC20_APPROVE_DECODER_ID);
        assert_eq!(decoded.args.len(), 2);
        assert_eq!(decoded.args[0].name, "spender");
        assert_eq!(decoded.args[1].name, "amount");
    }

    #[test]
    fn decodes_transfer() {
        let adapter = Erc20TransferDecoder::new();
        // transfer(0x1111..., 1_000_000_000_000)
        let calldata: Vec<u8> = {
            let mut v = Vec::from(TRANSFER_SELECTOR);
            v.extend_from_slice(&[0u8; 12]);
            v.extend_from_slice(&[0x11; 20]);
            v.extend_from_slice(
                &alloy_primitives::U256::from(1_000_000_000_000_u64).to_be_bytes::<32>(),
            );
            v
        };
        let token = Address::from_str("0x1234567890123456789012345678901234567890").unwrap();
        let value = policy_engine::action::DecimalString::from_str("0").unwrap();
        let ctx = DecodeContext {
            chain_id: 1,
            to: &token,
            value: &value,
            block_timestamp: None,
        };
        let decoded = adapter.decode(&ctx, &calldata).unwrap();
        assert_eq!(decoded.decoder_id.as_str(), ERC20_TRANSFER_DECODER_ID);
        assert_eq!(decoded.args.len(), 2);
        assert_eq!(decoded.args[0].name, "to");
        assert_eq!(decoded.args[1].name, "amount");
    }

    #[test]
    fn decodes_transfer_from() {
        let adapter = Erc20TransferFromDecoder::new();
        // transferFrom(0xaaaa..., 0xbbbb..., 1_000_000)
        let calldata: Vec<u8> = {
            let mut v = Vec::from(TRANSFER_FROM_SELECTOR);
            v.extend_from_slice(&[0u8; 12]);
            v.extend_from_slice(&[0xaa; 20]);
            v.extend_from_slice(&[0u8; 12]);
            v.extend_from_slice(&[0xbb; 20]);
            v.extend_from_slice(&alloy_primitives::U256::from(1_000_000_u64).to_be_bytes::<32>());
            v
        };
        let token = Address::from_str("0x1234567890123456789012345678901234567890").unwrap();
        let value = policy_engine::action::DecimalString::from_str("0").unwrap();
        let ctx = DecodeContext {
            chain_id: 1,
            to: &token,
            value: &value,
            block_timestamp: None,
        };
        let decoded = adapter.decode(&ctx, &calldata).unwrap();
        assert_eq!(decoded.decoder_id.as_str(), ERC20_TRANSFER_FROM_DECODER_ID);
        assert_eq!(decoded.args.len(), 3);
        assert_eq!(decoded.args[0].name, "from");
        assert_eq!(decoded.args[1].name, "to");
        assert_eq!(decoded.args[2].name, "amount");
    }
}
