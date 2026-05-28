//! Generic ABI 디코더 — `alloy-dyn-abi` 기반.
//!
//! 새 protocol 의 view 함수 추가 = `AbiTypeRegistry` 에 ABI 시그니처 한 줄 등록.
//!
//! 사용 예:
//! ```ignore
//! let mut reg = AbiTypeRegistry::with_builtins();
//! reg.register("my_view_fn", "(uint256,address)")?;
//!
//! let decoder = AbiDecoder::new(reg);
//! let json = decoder.decode("aave_v3_user_account_data", &returndata)?;
//! ```

pub mod sourcify;
pub mod types;
pub mod value_to_json;

pub use types::AbiTypeRegistry;

use alloy_dyn_abi::DynSolType;
use serde_json::Value;

use crate::error::SyncError;

/// generic ABI 디코더 — `decoder_id` 기반 dispatch.
#[derive(Debug)]
pub struct AbiDecoder {
    types: AbiTypeRegistry,
}

impl Default for AbiDecoder {
    fn default() -> Self {
        Self::new(AbiTypeRegistry::with_builtins())
    }
}

impl AbiDecoder {
    pub fn new(types: AbiTypeRegistry) -> Self {
        Self { types }
    }

    pub fn types_mut(&mut self) -> &mut AbiTypeRegistry {
        &mut self.types
    }

    /// `decoder_id` 가 known ABI 시그니처인지.
    pub fn knows(&self, decoder_id: &str) -> bool {
        self.types.get(decoder_id).is_some()
    }

    /// raw returndata 를 디코드해서 JSON Value 로.
    /// 단일 반환값이면 그 값 자체, 다중이면 JSON Array.
    pub fn decode(&self, decoder_id: &str, data: &[u8]) -> Result<Value, SyncError> {
        let ty = self.types.get(decoder_id).ok_or_else(|| {
            SyncError::UnknownDecoder(format!("abi_decoder: {}", decoder_id))
        })?;

        // ABI 함수 응답은 보통 tuple 로 래핑. ty 가 Tuple 이라고 가정.
        let decoded = ty.abi_decode(data).map_err(|e| SyncError::FetchFailed {
            source_id: "abi_decoder".into(),
            reason: format!("abi decode '{}': {}", decoder_id, e),
        })?;

        // ty 가 Tuple 이면 그 안의 components 가 함수 반환값들
        if let alloy_dyn_abi::DynSolValue::Tuple(items) = &decoded {
            Ok(value_to_json::flatten_function_result(items))
        } else {
            Ok(value_to_json::dyn_to_json(&decoded))
        }
    }

    /// `decoder_id` 의 ABI 시그니처 (debugging 용).
    pub fn signature_of(&self, decoder_id: &str) -> Option<&DynSolType> {
        self.types.get(decoder_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::U256;

    #[test]
    fn decodes_single_uint256() {
        let decoder = AbiDecoder::default();
        // returns (uint256) 의 32-byte big-endian "100"
        let mut data = [0u8; 32];
        data[31] = 100;
        let json = decoder.decode("abi_u256", &data).unwrap();
        assert_eq!(json, Value::String("100".into()));
    }

    #[test]
    fn decodes_aave_v3_user_account_data() {
        // 6 × uint256 = 192 byte
        // 각 32-byte 슬롯에 1, 2, 3, 4, 5, 6
        let decoder = AbiDecoder::default();
        let mut data = vec![0u8; 192];
        for i in 0..6 {
            data[(i + 1) * 32 - 1] = (i + 1) as u8;
        }
        let json = decoder.decode("aave_v3_user_account_data", &data).unwrap();
        // 6 개 값이 JSON Array 로
        let arr = json.as_array().expect("expected array");
        assert_eq!(arr.len(), 6);
        assert_eq!(arr[0], Value::String("1".into()));
        assert_eq!(arr[5], Value::String("6".into()));
    }

    #[test]
    fn unknown_id_errors() {
        let decoder = AbiDecoder::default();
        let err = decoder.decode("nonexistent", &[]).unwrap_err();
        assert!(matches!(err, SyncError::UnknownDecoder(_)));
    }

    #[test]
    fn knows_returns_correctly() {
        let decoder = AbiDecoder::default();
        assert!(decoder.knows("aave_v3_user_account_data"));
        assert!(decoder.knows("uniswap_v3_slot0"));
        assert!(!decoder.knows("nope"));
    }

    /// 가짜 V3 slot0 데이터 — 실제 슬롯 7 필드.
    #[test]
    fn decodes_uniswap_v3_slot0_shape() {
        let decoder = AbiDecoder::default();
        // 7 슬롯 = uint160 + int24 + 3×uint16 + uint8 + bool
        // alloy 가 모두 32-byte slot 으로 패딩. 총 224 byte
        let mut data = vec![0u8; 32 * 7];
        // sqrtPriceX96 = 4 (단순 placeholder)
        data[31] = 4;
        let json = decoder.decode("uniswap_v3_slot0", &data).unwrap();
        let arr = json.as_array().expect("expected array");
        assert_eq!(arr.len(), 7);
        assert_eq!(arr[0], Value::String("4".into())); // sqrtPriceX96
    }
}
