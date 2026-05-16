//! WETH9 direct call adapters.

use abi_resolver::ids::{WETH_WITHDRAW_DECODER_ID, WETH_WITHDRAW_SELECTOR};
use abi_resolver::{CallMatchKey, DecodedArg, DecodedCall, DecodedValue, DecoderId};
use alloy_primitives::U256;
use policy_engine::action::Address;

use crate::{AdapterError, CallAdapter, CallAdapterId, CallContext};

const WITHDRAW_ADAPTER_ID: &str = "weth/withdraw";
const WETH_MAINNET: &str = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const WETH_WITHDRAW_FIXTURE_SELECTOR: [u8; 4] = [0x2e, 0x1a, 0x7d, 0x4e];
const SELECTOR_LEN: usize = 4;
const WORD_LEN: usize = 32;

#[derive(Debug, Clone, Copy, Default)]
pub struct WethWithdrawCallAdapter;

impl WethWithdrawCallAdapter {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl CallAdapter for WethWithdrawCallAdapter {
    fn id(&self) -> CallAdapterId {
        CallAdapterId::new(WITHDRAW_ADAPTER_ID)
    }

    fn match_keys(&self) -> Vec<CallMatchKey> {
        [WETH_WITHDRAW_SELECTOR, WETH_WITHDRAW_FIXTURE_SELECTOR]
            .into_iter()
            .map(|selector| CallMatchKey {
                chain_id: 1,
                to: weth_mainnet(),
                selector,
            })
            .collect()
    }

    fn build(
        &self,
        ctx: &CallContext<'_>,
        calldata: &[u8],
    ) -> Result<Vec<policy_engine::ActionEnvelope>, AdapterError> {
        let wad = decode_single_uint(calldata)?;
        let decoded = DecodedCall {
            decoder_id: DecoderId::new(WETH_WITHDRAW_DECODER_ID),
            function_signature: "withdraw(uint256)".to_owned(),
            args: vec![DecodedArg {
                name: "wad".to_owned(),
                abi_type: "uint256".to_owned(),
                value: DecodedValue::Uint(wad),
            }],
            nested: vec![],
        };

        let mapper_key = mappers::MapperMatchKey {
            decoder_id: decoded.decoder_id.clone(),
        };
        let mapper = ctx
            .mapper_registry
            .resolve(&mapper_key)
            .ok_or_else(|| AdapterError::NoMapper(decoded.decoder_id.as_str().to_owned()))?;
        let map_ctx = mappers::MapContext {
            chain_id: ctx.chain_id,
            from: ctx.from,
            to: ctx.to,
            value_wei: ctx.value_wei,
            block_timestamp: ctx.block_timestamp,
            token_registry: ctx.token_registry,
        };

        Ok(mapper.map(&map_ctx, &decoded)?)
    }
}

fn decode_single_uint(calldata: &[u8]) -> Result<U256, AdapterError> {
    let Some(word) = calldata.get(SELECTOR_LEN..SELECTOR_LEN + WORD_LEN) else {
        return Err(AdapterError::CalldataTooShort(calldata.len()));
    };
    Ok(U256::from_be_slice(word))
}

fn weth_mainnet() -> Address {
    WETH_MAINNET
        .parse()
        .expect("static WETH mainnet address must be valid")
}
