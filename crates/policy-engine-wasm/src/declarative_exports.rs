//! `#[wasm_bindgen]` JSON-string exports for the declarative adapter pipeline.
//!
//! Phase 1A surface:
//!   * `declarative_install_json(bundle_json: String) -> String` —
//!     parses a bundle, constructs a [`DeclarativeMapper`], and stores it in a
//!     process-local registry keyed by the bundle's declarative decoder id.
//!     Returns the decoder id so the caller can record the
//!     `(chain_id, to, selector) → decoder_id` mapping bridge-side.
//!
//!   * `declarative_lookup_json(input_json: String) -> String` —
//!     resolves an installed mapper by decoder id and runs `Mapper::map`
//!     against a JSON-described `DecodedCall`. Returns the resulting
//!     `Vec<ActionEnvelope>`.
//!
//! Wire shape (input/output) is documented inline next to each export. This
//! module forms the contract that the Phase 1B TS bridge consumes.

use std::cell::RefCell;
use std::collections::HashMap;
use std::str::FromStr as _;
use std::sync::Arc;

use abi_resolver::{DecodedArg, DecodedCall, DecodedValue, DecoderId};
use alloy_primitives::{I256, U256};
use mappers::declarative::{AdapterFunctionBundle, DeclarativeMapper};
use mappers::mapper::{MapContext, Mapper};
use mappers::token_registry::EmptyTokenRegistry;
use policy_engine::action::{Address, DecimalString};
use wasm_bindgen::prelude::*;

use crate::dto::{
    DecodedArgDto, DecodedCallDto, DecodedValueDto, DeclarativeInstallResultDto,
    DeclarativeLookupInputDto, EngineErrorDto, Envelope,
};

thread_local! {
    /// Installed mappers, keyed by declarative decoder id.
    ///
    /// Spec §5.4 routes lookups by decoder_id, so this key is exactly what the
    /// bridge layer (§5.5) emits when it tags a `DecodedCall`.
    static DECLARATIVE_STATE: RefCell<HashMap<String, Arc<DeclarativeMapper>>> =
        RefCell::new(HashMap::new());
}

/// Install (or replace) a declarative adapter bundle.
///
/// Input JSON shape: the full bundle as per
/// `ADAPTER_MARKETPLACE_ARCHITECTURE.md` §4.1 (see
/// `crates/adapters/mappers/tests/fixtures/uniswap-v2-swap-exact-tokens.json`).
///
/// Output:
/// ```json
/// { "ok": true, "data": { "decoder_id": "declarative.<path>", "bundle_id": "<id>@<ver>" } }
/// ```
/// or `{ "ok": false, "error": { "kind": "...", "message": "..." } }`.
#[wasm_bindgen]
pub fn declarative_install_json(bundle_json: String) -> String {
    let result = (|| -> Result<DeclarativeInstallResultDto, EngineErrorDto> {
        let bundle: AdapterFunctionBundle = serde_json::from_str(&bundle_json).map_err(|error| {
            EngineErrorDto::new(
                "invalid_bundle_json",
                format!("invalid bundle json: {error}"),
            )
        })?;
        let mapper = DeclarativeMapper::new(bundle.clone());
        let decoder_id = mapper.declarative_decoder_id().as_str().to_owned();
        let bundle_id = bundle.id.clone();
        DECLARATIVE_STATE.with(|state| {
            state.borrow_mut().insert(decoder_id.clone(), Arc::new(mapper));
        });
        Ok(DeclarativeInstallResultDto {
            decoder_id,
            bundle_id,
        })
    })();

    match result {
        Ok(dto) => Envelope::ok(dto).to_json(),
        Err(error) => Envelope::<()>::err(error.kind, error.message).to_json(),
    }
}

/// Run an installed declarative mapper against a JSON-described `DecodedCall`.
///
/// Input JSON shape (see [`DeclarativeLookupInputDto`]):
/// ```json
/// {
///   "decoder_id": "declarative.uniswap/v2/swapExactTokensForTokens",
///   "ctx": {
///     "chain_id": 1,
///     "from": "0x..",
///     "to":   "0x..",
///     "value_wei": "0",            // optional, default "0"
///     "block_timestamp": 1700000000 // optional
///   },
///   "decoded": {
///     "decoder_id": "declarative.uniswap/v2/swapExactTokensForTokens",
///     "function_signature": "...",
///     "args": [
///       { "name": "amountIn", "abi_type": "uint256",
///         "value": { "kind": "uint", "value": "1000000000000000000" } },
///       ...
///       { "name": "path", "abi_type": "address[]",
///         "value": { "kind": "array",
///                    "value": [ { "kind": "address", "value": "0x.." }, ... ] } }
///     ]
///   }
/// }
/// ```
///
/// Output: `{ "ok": true, "data": { "envelopes": [...] } }` where `envelopes`
/// is the JSON-serialised `Vec<ActionEnvelope>`.
#[wasm_bindgen]
pub fn declarative_lookup_json(input_json: String) -> String {
    let result = (|| -> Result<DeclarativeLookupResultDto, EngineErrorDto> {
        let input: DeclarativeLookupInputDto =
            serde_json::from_str(&input_json).map_err(|error| {
                EngineErrorDto::new("invalid_input_json", format!("invalid input json: {error}"))
            })?;

        let mapper = DECLARATIVE_STATE.with(|state| state.borrow().get(&input.decoder_id).cloned());
        let mapper = mapper.ok_or_else(|| {
            EngineErrorDto::new(
                "decoder_id_not_installed",
                format!(
                    "no declarative mapper installed for decoder_id {:?}",
                    input.decoder_id
                ),
            )
        })?;

        let from =
            Address::from_str(&input.ctx.from).map_err(|message| {
                EngineErrorDto::new("invalid_from", format!("invalid ctx.from: {message}"))
            })?;
        let to = Address::from_str(&input.ctx.to)
            .map_err(|message| EngineErrorDto::new("invalid_to", format!("invalid ctx.to: {message}")))?;
        let value_wei = input
            .ctx
            .value_wei
            .as_deref()
            .unwrap_or("0");
        let value = DecimalString::from_str(value_wei).map_err(|message| {
            EngineErrorDto::new("invalid_value_wei", format!("invalid ctx.value_wei: {message}"))
        })?;
        let block_timestamp = input.ctx.block_timestamp;

        let decoded = decoded_call_from_dto(input.decoded)?;

        let registry = EmptyTokenRegistry;
        // PoC scope: WASM-side `multicall_recurse` e2e is deferred (spec §0).
        // Rust-side unit tests cover the strategy via `ChildResolver` mocks.
        // We leave `resolver: None` here — a bundle that requires recursion
        // will surface `multicall_recurse requires ctx.resolver` and the host
        // can decide whether to add WASM-side recursion later. The remaining
        // single_emit bundles (V2/V3/SR02) are unaffected.
        let ctx = MapContext {
            chain_id: input.ctx.chain_id,
            from: &from,
            to: &to,
            value_wei: &value,
            block_timestamp,
            token_registry: &registry,
            parent_calldata: None,
            depth: 0,
            resolver: None,
        };

        let envelopes = mapper
            .map(&ctx, &decoded)
            .map_err(|error| EngineErrorDto::new("map_failed", error.to_string()))?;
        Ok(DeclarativeLookupResultDto { envelopes })
    })();

    match result {
        Ok(dto) => Envelope::ok(dto).to_json(),
        Err(error) => Envelope::<()>::err(error.kind, error.message).to_json(),
    }
}

#[derive(Debug, serde::Serialize)]
pub struct DeclarativeLookupResultDto {
    pub envelopes: Vec<policy_engine::ActionEnvelope>,
}

// ───────────────────────────────────────────────────────────────────────────
// DecodedCallDto → DecodedCall conversion
// ───────────────────────────────────────────────────────────────────────────

fn decoded_call_from_dto(dto: DecodedCallDto) -> Result<DecodedCall, EngineErrorDto> {
    let args = dto
        .args
        .into_iter()
        .map(decoded_arg_from_dto)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DecodedCall {
        decoder_id: DecoderId::new(dto.decoder_id),
        function_signature: dto.function_signature,
        args,
        nested: vec![],
    })
}

fn decoded_arg_from_dto(dto: DecodedArgDto) -> Result<DecodedArg, EngineErrorDto> {
    let value = decoded_value_from_dto(dto.value)?;
    Ok(DecodedArg {
        name: dto.name,
        abi_type: dto.abi_type,
        value,
    })
}

fn decoded_value_from_dto(dto: DecodedValueDto) -> Result<DecodedValue, EngineErrorDto> {
    match dto {
        DecodedValueDto::Address(raw) => {
            let address = Address::from_str(&raw).map_err(|message| {
                EngineErrorDto::new(
                    "invalid_decoded_value",
                    format!("invalid address {raw:?}: {message}"),
                )
            })?;
            Ok(DecodedValue::Address(address))
        }
        DecodedValueDto::Uint(raw) => {
            let value = U256::from_str_radix(&raw, 10).map_err(|error| {
                EngineErrorDto::new(
                    "invalid_decoded_value",
                    format!("invalid uint {raw:?}: {error}"),
                )
            })?;
            Ok(DecodedValue::Uint(value))
        }
        DecodedValueDto::Int(raw) => {
            let value = I256::from_str(&raw).map_err(|error| {
                EngineErrorDto::new(
                    "invalid_decoded_value",
                    format!("invalid int {raw:?}: {error}"),
                )
            })?;
            Ok(DecodedValue::Int(value))
        }
        DecodedValueDto::Bool(value) => Ok(DecodedValue::Bool(value)),
        DecodedValueDto::Bytes(raw) => {
            let hex_part = raw.strip_prefix("0x").unwrap_or(&raw);
            let bytes = hex::decode(hex_part).map_err(|error| {
                EngineErrorDto::new(
                    "invalid_decoded_value",
                    format!("invalid bytes {raw:?}: {error}"),
                )
            })?;
            Ok(DecodedValue::Bytes(bytes))
        }
        DecodedValueDto::String(value) => Ok(DecodedValue::String(value)),
        DecodedValueDto::Array(items) => {
            let inner = items
                .into_iter()
                .map(decoded_value_from_dto)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(DecodedValue::Array(inner))
        }
        DecodedValueDto::Tuple(items) => {
            let inner = items
                .into_iter()
                .map(decoded_value_from_dto)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(DecodedValue::Tuple(inner))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const V2_BUNDLE_JSON: &str =
        include_str!("../../adapters/mappers/tests/fixtures/uniswap-v2-swap-exact-tokens.json");

    fn install() -> Value {
        let out = declarative_install_json(V2_BUNDLE_JSON.to_owned());
        serde_json::from_str::<Value>(&out).unwrap()
    }

    #[test]
    fn install_returns_decoder_id() {
        let parsed = install();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(
            parsed["data"]["decoder_id"],
            "declarative.uniswap/v2/swapExactTokensForTokens"
        );
        assert_eq!(
            parsed["data"]["bundle_id"],
            "uniswap/v2/swapExactTokensForTokens@1.0.0"
        );
    }

    #[test]
    fn install_rejects_invalid_json() {
        let out = declarative_install_json("{not json".to_owned());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "invalid_bundle_json");
    }

    fn v2_lookup_input() -> Value {
        json!({
            "decoder_id": "declarative.uniswap/v2/swapExactTokensForTokens",
            "ctx": {
                "chain_id": 1,
                "from": "0x000000000000000000000000000000000000aaaa",
                "to":   "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
                "value_wei": "0",
                "block_timestamp": 1_700_000_000_u64
            },
            "decoded": {
                "decoder_id": "declarative.uniswap/v2/swapExactTokensForTokens",
                "function_signature":
                    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
                "args": [
                    { "name": "amountIn",     "abi_type": "uint256",
                      "value": { "kind": "uint", "value": "1000000000000000000" } },
                    { "name": "amountOutMin", "abi_type": "uint256",
                      "value": { "kind": "uint", "value": "1900000" } },
                    { "name": "path",         "abi_type": "address[]",
                      "value": { "kind": "array", "value": [
                          { "kind": "address",
                            "value": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
                          { "kind": "address",
                            "value": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" }
                      ] } },
                    { "name": "to",           "abi_type": "address",
                      "value": { "kind": "address",
                                 "value": "0x4444444444444444444444444444444444444444" } },
                    { "name": "deadline",     "abi_type": "uint256",
                      "value": { "kind": "uint", "value": "1700000900" } }
                ]
            }
        })
    }

    #[test]
    fn lookup_returns_swap_envelope_after_install() {
        install();
        let out = declarative_lookup_json(v2_lookup_input().to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");

        let envelopes = parsed["data"]["envelopes"].as_array().expect("array");
        assert_eq!(envelopes.len(), 1);
        let env = &envelopes[0];
        assert_eq!(env["category"], "dex");
        assert_eq!(env["action"], "swap");
        assert_eq!(env["fields"]["swapMode"], "exact_in");
        assert_eq!(
            env["fields"]["inputToken"]["asset"]["address"],
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        );
        assert_eq!(env["fields"]["inputToken"]["amount"]["kind"], "exact");
        assert_eq!(
            env["fields"]["inputToken"]["amount"]["value"],
            "1000000000000000000"
        );
        assert_eq!(
            env["fields"]["outputToken"]["asset"]["address"],
            "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
        );
        assert_eq!(env["fields"]["outputToken"]["amount"]["kind"], "min");
        assert_eq!(env["fields"]["outputToken"]["amount"]["value"], "1900000");
        assert_eq!(
            env["fields"]["recipient"],
            "0x4444444444444444444444444444444444444444"
        );
        assert_eq!(env["fields"]["validity"]["source"], "tx-deadline");
        assert_eq!(env["fields"]["validity"]["expiresAt"], "1700000900");
    }

    #[test]
    fn lookup_unknown_decoder_errors() {
        let input = json!({
            "decoder_id": "declarative.unknown/x",
            "ctx": {
                "chain_id": 1,
                "from": "0x000000000000000000000000000000000000aaaa",
                "to":   "0x000000000000000000000000000000000000bbbb"
            },
            "decoded": {
                "decoder_id": "declarative.unknown/x",
                "function_signature": "",
                "args": []
            }
        });
        let out = declarative_lookup_json(input.to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "decoder_id_not_installed");
    }
}
