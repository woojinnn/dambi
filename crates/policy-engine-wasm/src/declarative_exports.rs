//! `#[wasm_bindgen]` JSON-string exports for the v3 declarative adapter pipeline.
//!
//! Phase 1 (action-types) trimmed this module to the v3 surface only. The
//! legacy v1 envelope path (`declarative_install_json`, `declarative_lookup_json`,
//! `declarative_route_request_json`, `declarative_plan_children_json` and their
//! `DeclarativeMapper` / `WasmChildResolver` / `ActionEnvelope` machinery) has
//! been removed alongside the v1 `mappers` `Mapper` trait it depended on.
//!
//! Surviving surface:
//!   * `declarative_install_v3_json(bundle_json) -> String` — stores the raw v3
//!     manifest keyed by `(chain_id, to, selector)` so the route entry can
//!     resolve a raw tx tuple to the right manifest.
//!   * `declarative_route_request_v3_json(input_json) -> String` — decodes the
//!     raw calldata against the manifest ABI and builds a hierarchical v3
//!     `ActionBody` via `mappers::declarative::action_builder`.
//!
//! Wire shapes are documented inline next to each export.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};

use mappers::declarative::action_builder::{
    build_action_body, build_multicall_from_opcode_stream,
    UnknownOpcodePolicy as V3UnknownOpcodePolicy, V3MapContext,
};
use mappers::declarative::args_json::args_to_json;
use mappers::declarative::types::BundleMatch;
use wasm_bindgen::prelude::*;

use crate::dto::{
    DeclarativeInstallResultDto, DeclarativeRouteRequestV3InputDto,
    DeclarativeRouteRequestV3ResultDto, EngineErrorDto, Envelope,
};
use crate::exports::check_input_size;

// v3 action tree imports. Namespaced under `v3_action` for readability.
use simulation_reducer::action as v3_action;
use simulation_state::live_field::{DataSource, LiveField, OracleProvider};
use simulation_state::primitives::{
    Address as V3Address, ChainId as V3ChainId, Time as V3Time, U256 as V3U256,
};

/// Bridge key: `(chain_id, to_lowercase, selector_lowercase)`.
///
/// `to` is normalised to lowercase hex (no checksum) and `selector` to
/// lowercase `"0x" + 8 hex` so the lookup is case-insensitive — bundles may
/// carry checksummed addresses and the route side has no reason to roundtrip
/// the case.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BridgeKey {
    chain_id: u64,
    to: String,
    selector: String,
}

// ───────────────────────────────────────────────────────────────────────────
// v3 declarative state
// ───────────────────────────────────────────────────────────────────────────
//
// v3 (PDF FSM hierarchical `ActionBody`) install table:
//
// * `bridge`  — `(chain_id, to_lower, selector_lower) -> bundle_id`. The
//   bundle_id is the canonical registry id (e.g. `"uniswap/v2-router-02/
//   swapExactTokensForTokens@1.0.0"`), used as decoder_id in the v3 path.
// * `bundles` — `bundle_id -> raw manifest JSON`. We keep the manifest
//   untyped because the v3 `emit.body` / `emit.live_inputs` /
//   `emit.per_opcode_body` shapes are templates the action_builder consumes
//   directly. The v3 install therefore only validates the structural envelope
//   (`id`, `match`) and trusts the action_builder + serde_json::from_value to
//   surface schema errors at route time.

#[derive(Default)]
struct DeclarativeV3State {
    /// `(chain_id, to_lower, selector_lower)` → `bundle_id`. Populated by
    /// [`declarative_install_v3_json`] via [`BundleMatch::entries`] so the
    /// dual-schema (`chain_to_addresses` / `chain_ids × to`) split is
    /// invisible here.
    bridge: HashMap<BridgeKey, String>,
    /// `bundle_id` → raw manifest JSON. Stored as `serde_json::Value` because
    /// the v3 templates (`emit.body`, `emit.live_inputs`,
    /// `emit.per_opcode_body`) are consumed by the action_builder as-is.
    bundles: HashMap<String, serde_json::Value>,
}

thread_local! {
    /// v3 install table. Single instance per WASM module lifetime (one per SW
    /// lifetime in the extension).
    static DECLARATIVE_V3_STATE: RefCell<DeclarativeV3State> =
        RefCell::new(DeclarativeV3State::default());
}

// ───────────────────────────────────────────────────────────────────────────
// `declarative_install_v3_json`
// ───────────────────────────────────────────────────────────────────────────
//
// Stores the raw manifest in `DECLARATIVE_V3_STATE` so
// [`declarative_route_request_v3_json`] can route against the v3 `emit.body` /
// `emit.live_inputs` / `emit.per_opcode_body` templates.
//
// The v3 install validates only the structural envelope:
//   * `bundle.id`         — required, non-empty string. Used as decoder_id.
//   * `bundle.match`      — parsed via `BundleMatch` so v1 (`chain_ids × to`)
//                           and v2 (`chain_to_addresses`) bundles both yield
//                           `(chain_id, address)` pairs.
//   * `bundle.match.selector` — required (carried inside `BundleMatch`).
// `emit.strategy` / `emit.body` / `emit.per_opcode_body` are NOT validated at
// install — they flow through `action_builder` at route time, which surfaces
// precise serde errors keyed to the field that failed.

/// Install (or replace) a v3 declarative bundle.
///
/// Input JSON shape: the full v3 manifest with `emit.strategy` ∈
/// {`single_emit`, `opcode_stream_dispatch`} and a hierarchical `emit.body`
/// (and optional `emit.live_inputs` / `emit.per_opcode_body`).
///
/// Output:
/// ```json
/// { "ok": true, "data": { "decoder_id": "<bundle_id>", "bundle_id": "<bundle_id>" } }
/// ```
/// or `{ "ok": false, "error": { "kind": "...", "message": "..." } }`.
///
/// v3 does not mint a separate `declarative.<path>` decoder id — the bundle_id
/// itself is the canonical key. Both `decoder_id` and `bundle_id` are populated
/// to the same value so the wire shape stays identical to v1
/// [`DeclarativeInstallResultDto`].
#[wasm_bindgen]
pub fn declarative_install_v3_json(bundle_json: String) -> String {
    let result = (|| -> Result<DeclarativeInstallResultDto, EngineErrorDto> {
        check_input_size(&bundle_json, "declarative_install_v3_json")?;
        let bundle_value: serde_json::Value =
            serde_json::from_str(&bundle_json).map_err(|error| {
                EngineErrorDto::new(
                    "invalid_bundle_json",
                    format!("invalid bundle json: {error}"),
                )
            })?;

        let bundle_id = bundle_value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                EngineErrorDto::new("missing_id", "bundle.id missing or not a string".to_string())
            })?
            .to_owned();

        let match_value = bundle_value
            .get("match")
            .ok_or_else(|| EngineErrorDto::new("invalid_match", "bundle.match missing".to_string()))?;
        let bundle_match: BundleMatch =
            serde_json::from_value(match_value.clone()).map_err(|error| {
                EngineErrorDto::new("invalid_match", format!("bundle.match parse failed: {error}"))
            })?;

        let selector = bundle_match.selector.to_ascii_lowercase();

        DECLARATIVE_V3_STATE.with(|state| {
            let mut state = state.borrow_mut();
            for (chain_id, to) in bundle_match.entries() {
                let key = BridgeKey {
                    chain_id,
                    to: to.to_ascii_lowercase(),
                    selector: selector.clone(),
                };
                state.bridge.insert(key, bundle_id.clone());
            }
            state.bundles.insert(bundle_id.clone(), bundle_value);
        });

        Ok(DeclarativeInstallResultDto {
            decoder_id: bundle_id.clone(),
            bundle_id,
        })
    })();

    match result {
        Ok(dto) => Envelope::ok(dto).to_json(),
        Err(error) => Envelope::<()>::err(error.kind, error.message).to_json(),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// `declarative_route_request_v3_json`
// ───────────────────────────────────────────────────────────────────────────
//
// Decodes a raw tx (`chain_id, to, selector, calldata, ...`) against the
// installed v3 manifest ABI and builds a hierarchical `ActionBody`.

/// Route a raw transaction to the matching v3 manifest and build its
/// `ActionBody`.
///
/// Input JSON shape: see [`DeclarativeRouteRequestV3InputDto`].
///
/// Output (on success):
/// ```json
/// { "ok": true, "data": { "actions": [ <Action> ], "decoder_id": "<bundle_id>" } }
/// ```
/// or `{ "ok": false, "error": { "kind": "...", "message": "..." } }`.
#[wasm_bindgen]
pub fn declarative_route_request_v3_json(input_json: String) -> String {
    let result = (|| -> Result<DeclarativeRouteRequestV3ResultDto, EngineErrorDto> {
        check_input_size(&input_json, "declarative_route_request_v3_json")?;
        let input: DeclarativeRouteRequestV3InputDto = serde_json::from_str(&input_json)
            .map_err(|error| {
                EngineErrorDto::new("invalid_input_json", format!("invalid input json: {error}"))
            })?;

        // ── Parse + normalise ──────────────────────────────────────────────
        let submitter = parse_v3_address(&input.submitter, "submitter")?;
        let target = parse_v3_address(&input.to, "to")?;
        let value = parse_v3_u256(&input.value, "value")?;
        let gas_limit = parse_v3_u256(&input.gas_limit, "gas_limit")?;
        let gas_price = parse_v3_u256(&input.gas_price, "gas_price")?;

        let chain = V3ChainId::new(format!("eip155:{}", input.chain_id));
        let submitted_at = V3Time::from_unix(input.submitted_at);

        // ── Build ActionMeta (OnchainTx nature) ────────────────────────────
        //
        // Phase 4B wraps `gas_price` in a stub `LiveField` whose source =
        // Pyth `gas/eip155:<chain_id>`. The Sync Orchestrator is not wired
        // into this entry yet — `synced_at` collapses to `submitted_at` and
        // `ttl`/`confidence` are left at default.
        let gas_price_live = LiveField::new(
            gas_price,
            DataSource::OracleFeed {
                provider: OracleProvider::Pyth,
                feed_id: format!("gas/eip155:{}", input.chain_id),
            },
            submitted_at,
        );

        let meta = v3_action::ActionMeta {
            submitted_at,
            submitter,
            nature: v3_action::ActionNature::OnchainTx {
                chain: chain.clone(),
                nonce: input.nonce,
                gas_limit,
                gas_price: gas_price_live,
                value,
            },
        };

        // ── Build ActionBody (v3 manifest lookup + action_builder) ─────────
        //
        // Pipeline:
        //   1. Look the callkey up in `DECLARATIVE_V3_STATE.bridge` — a miss
        //      surfaces a `no_declarative_v3_mapper` error.
        //   2. Decode the raw calldata against the manifest's
        //      `abi_fragment.abi` (JSON-ABI helper from abi-resolver).
        //   3. Build a [`V3MapContext`] from the request + decoded args.
        //   4. Dispatch on `emit.strategy`:
        //        * `single_emit`            → [`build_action_body`]
        //        * `opcode_stream_dispatch` → [`build_multicall_from_opcode_stream`]
        //      any other strategy returns `unsupported_strategy`.
        //
        // `resolved` / `derived` are empty `BTreeMap`s — the Sync orchestrator
        // that fills them is a later milestone. Manifests referencing
        // `$resolved.<k>` / `$derived.<k>` therefore surface a precise
        // `unresolved_placeholder` error at this stage.
        let key = BridgeKey {
            chain_id: input.chain_id,
            to: input.to.to_ascii_lowercase(),
            selector: input.selector.to_ascii_lowercase(),
        };

        let (bundle_id, bundle_value) = DECLARATIVE_V3_STATE
            .with(|state| {
                let state = state.borrow();
                state.bridge.get(&key).and_then(|bundle_id| {
                    state
                        .bundles
                        .get(bundle_id)
                        .cloned()
                        .map(|b| (bundle_id.clone(), b))
                })
            })
            .ok_or_else(|| {
                EngineErrorDto::new(
                    "no_declarative_v3_mapper",
                    format!(
                        "no v3 mapper bridged for chain_id={} to={} selector={}",
                        input.chain_id, input.to, input.selector
                    ),
                )
            })?;

        // Decode calldata against the manifest ABI.
        let calldata_hex = input.calldata.strip_prefix("0x").unwrap_or(&input.calldata);
        let calldata_bytes = hex::decode(calldata_hex).map_err(|error| {
            EngineErrorDto::new(
                "invalid_calldata",
                format!("calldata is not valid hex: {error}"),
            )
        })?;
        let abi_json = bundle_value.pointer("/abi_fragment/abi").ok_or_else(|| {
            EngineErrorDto::new("invalid_bundle", "missing abi_fragment.abi".to_string())
        })?;
        let decoded = abi_resolver::bridge::decode_with_json_abi(abi_json, &calldata_bytes)
            .map_err(|error| {
                EngineErrorDto::new("decode_failed", format!("calldata decode failed: {error}"))
            })?;
        let args_json = args_to_json(&decoded);

        let emit = bundle_value
            .get("emit")
            .ok_or_else(|| EngineErrorDto::new("invalid_bundle", "missing emit".to_string()))?;
        let strategy = emit
            .get("strategy")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                EngineErrorDto::new("invalid_bundle", "missing emit.strategy".to_string())
            })?
            .to_owned();

        let ctx = V3MapContext {
            chain: chain.clone(),
            tx_to: target,
            tx_from: submitter,
            value,
            submitted_at,
            args_json: &args_json,
            resolved: BTreeMap::new(),
            derived: BTreeMap::new(),
            inputs: None,
        };

        let body = match strategy.as_str() {
            "single_emit" => {
                let body_template = emit.get("body").ok_or_else(|| {
                    EngineErrorDto::new("invalid_bundle", "missing emit.body".to_string())
                })?;
                let live_inputs_template = emit.get("live_inputs");
                build_action_body(&ctx, body_template, live_inputs_template).map_err(|error| {
                    EngineErrorDto::new("build_action_body_failed", error.to_string())
                })?
            }
            "opcode_stream_dispatch" => {
                let per_opcode_body = emit
                    .get("per_opcode_body")
                    .and_then(serde_json::Value::as_object)
                    .ok_or_else(|| {
                        EngineErrorDto::new(
                            "invalid_bundle",
                            "missing emit.per_opcode_body".to_string(),
                        )
                    })?;
                let mask = parse_hex_u8(
                    emit.get("mask").and_then(serde_json::Value::as_str).unwrap_or("0xff"),
                    "emit.mask",
                )?;
                let allow_revert_bit = parse_hex_u8(
                    emit.get("allow_revert_bit")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("0x00"),
                    "emit.allow_revert_bit",
                )?;
                let unknown_policy = match emit
                    .get("unknown_opcode_policy")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("warn")
                {
                    "deny" => V3UnknownOpcodePolicy::Deny,
                    "skip" => V3UnknownOpcodePolicy::Skip,
                    _ => V3UnknownOpcodePolicy::Warn,
                };

                let commands_str = args_json
                    .get("commands")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| {
                        EngineErrorDto::new("invalid_args", "missing args.commands".to_string())
                    })?;
                let commands_bytes = hex::decode(
                    commands_str.strip_prefix("0x").unwrap_or(commands_str),
                )
                .map_err(|error| {
                    EngineErrorDto::new(
                        "invalid_commands",
                        format!("commands not hex: {error}"),
                    )
                })?;

                let inputs_array = args_json
                    .get("inputs")
                    .and_then(serde_json::Value::as_array)
                    .ok_or_else(|| {
                        EngineErrorDto::new("invalid_args", "missing args.inputs".to_string())
                    })?;

                // Per-opcode `inputs_abi` ABI-decode pass. The v3 manifest
                // attaches the Solidity tuple signature next to each opcode's
                // `body` template (e.g. UR V3_SWAP_EXACT_IN). Decoding here
                // yields a JSON value the action_builder's `$inputs.<path>`
                // placeholder walker can consume. Best-effort: missing
                // `inputs_abi`, parse failure, or decode failure all degrade
                // to `Value::Null`, which the action_builder surfaces as a
                // clear `UnresolvedPlaceholder` error rather than a silent
                // bogus default.
                let mut decoded_inputs_array = Vec::with_capacity(inputs_array.len());
                for (i, input_hex) in inputs_array.iter().enumerate() {
                    let input_hex_str = input_hex.as_str().ok_or_else(|| {
                        EngineErrorDto::new(
                            "invalid_inputs",
                            format!("inputs[{i}] not string"),
                        )
                    })?;
                    let input_bytes = hex::decode(
                        input_hex_str.strip_prefix("0x").unwrap_or(input_hex_str),
                    )
                    .map_err(|error| {
                        EngineErrorDto::new(
                            "invalid_inputs_hex",
                            format!("inputs[{i}]: {error}"),
                        )
                    })?;

                    let opcode_byte = *commands_bytes.get(i).ok_or_else(|| {
                        EngineErrorDto::new(
                            "invalid_commands",
                            format!("commands shorter than inputs at {i}"),
                        )
                    })?;
                    let opcode_id = opcode_byte & mask;
                    let opcode_key = format!("0x{opcode_id:02x}");

                    let decoded_input = per_opcode_body
                        .get(&opcode_key)
                        .and_then(|entry| entry.get("inputs_abi"))
                        .and_then(serde_json::Value::as_str)
                        .and_then(|sig| decode_inputs_abi_tuple(sig, &input_bytes).ok())
                        .unwrap_or(serde_json::Value::Null);
                    decoded_inputs_array.push(decoded_input);
                }

                build_multicall_from_opcode_stream(
                    &ctx,
                    per_opcode_body,
                    &commands_bytes,
                    &decoded_inputs_array,
                    mask,
                    allow_revert_bit,
                    unknown_policy,
                )
                .map_err(|error| {
                    EngineErrorDto::new("build_multicall_failed", error.to_string())
                })?
            }
            other => {
                return Err(EngineErrorDto::new(
                    "unsupported_strategy",
                    format!("unsupported emit.strategy: {other}"),
                ));
            }
        };

        let action = v3_action::Action { meta, body };

        Ok(DeclarativeRouteRequestV3ResultDto {
            actions: vec![action],
            decoder_id: bundle_id,
        })
    })();

    match result {
        Ok(dto) => Envelope::ok(dto).to_json(),
        Err(error) => Envelope::<()>::err(error.kind, error.message).to_json(),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// v3 parse helpers
// ───────────────────────────────────────────────────────────────────────────

/// Parse a "0x"-prefixed 40-hex string into an [`Address`](V3Address).
/// Wraps the alloy parser to produce a uniform `EngineErrorDto` shape.
fn parse_v3_address(raw: &str, field: &str) -> Result<V3Address, EngineErrorDto> {
    raw.parse::<V3Address>().map_err(|error| {
        EngineErrorDto::new(
            "invalid_input_json",
            format!("invalid {field} address {raw:?}: {error}"),
        )
    })
}

/// Parse a base-10 decimal string into a [`U256`](V3U256). Empty input behaves
/// like the explicit serde default (`"0"`).
fn parse_v3_u256(raw: &str, field: &str) -> Result<V3U256, EngineErrorDto> {
    if raw.is_empty() {
        return Ok(V3U256::ZERO);
    }
    V3U256::from_str_radix(raw, 10).map_err(|error| {
        EngineErrorDto::new(
            "invalid_input_json",
            format!("invalid {field} decimal {raw:?}: {error}"),
        )
    })
}

/// Parse a `"0x" + 1-2 hex` literal into a `u8`. Used for `emit.mask` and
/// `emit.allow_revert_bit` in v3 `opcode_stream_dispatch` manifests.
fn parse_hex_u8(raw: &str, field: &str) -> Result<u8, EngineErrorDto> {
    let stripped = raw.strip_prefix("0x").unwrap_or(raw);
    u8::from_str_radix(stripped, 16).map_err(|error| {
        EngineErrorDto::new(
            "invalid_bundle",
            format!("invalid {field} hex u8 {raw:?}: {error}"),
        )
    })
}

/// Decode a single opcode's `inputs_abi` Solidity tuple signature against a raw
/// byte buffer, returning a JSON object keyed by the tuple's named fields.
///
///   * Reuse [`abi_resolver::decode::decode_with_function`] so we do not pull
///     `alloy_json_abi` / `alloy_dyn_abi` symbols into the WASM surface beyond
///     what abi-resolver already links.
///   * The signature is wrapped into a synthetic `step<sig>` function so alloy
///     can parse it. Selector is recomputed from that function so
///     `decode_with_function`'s selector-equality guard always passes — opcode
///     dispatch already verified the outer call site, we are only re-decoding
///     the inner tuple here.
///   * Each `DecodedArg.value` routes through the
///     `bridge::convert_value` → `args_json::decoded_value_to_json` chain so
///     the resulting `$inputs.<name>` JSON shape matches the `$args.<name>`
///     view the action_builder's placeholder walker understands.
///   * Best-effort: any parse / decode / convert failure returns `Err` and the
///     caller substitutes `Value::Null`.
fn decode_inputs_abi_tuple(
    inputs_abi: &str,
    input_bytes: &[u8],
) -> Result<serde_json::Value, String> {
    use alloy_json_abi::Function;

    let synthetic = format!("step{inputs_abi}");
    let function = Function::parse(&synthetic)
        .map_err(|error| format!("parse {inputs_abi:?}: {error}"))?;
    let selector = function.selector().0;

    let mut prefixed = Vec::with_capacity(4 + input_bytes.len());
    prefixed.extend_from_slice(&selector);
    prefixed.extend_from_slice(input_bytes);

    let decoded = abi_resolver::decode::decode_with_function(&function, &prefixed)
        .map_err(|error| format!("decode {inputs_abi:?}: {error}"))?;

    let mut obj = serde_json::Map::with_capacity(decoded.args.len());
    for arg in &decoded.args {
        let decoded_value = abi_resolver::bridge::convert_value(arg.value.clone())
            .map_err(|error| format!("convert {inputs_abi:?}.{}: {error}", arg.name))?;
        obj.insert(
            arg.name.clone(),
            mappers::declarative::args_json::decoded_value_to_json(&decoded_value),
        );
    }
    Ok(serde_json::Value::Object(obj))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn v3_route_input() -> Value {
        json!({
            "chain_id":    1,
            "to":          "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "selector":    "0x38ed1739",
            "calldata":    "0x38ed1739dead",
            "value":       "0",
            "gas_limit":   "200000",
            "gas_price":   "20000000000",
            "submitter":   "0x000000000000000000000000000000000000aaaa",
            "submitted_at": 1_700_000_000_u64,
            "nonce": 42_u64,
            "block_timestamp": 1_700_000_010_u64
        })
    }

    #[test]
    fn route_request_v3_misses_without_v3_install() {
        // A callkey with no v3 manifest installed surfaces
        // `no_declarative_v3_mapper`.
        let out = declarative_route_request_v3_json(v3_route_input().to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "no_declarative_v3_mapper", "{parsed}");
    }

    #[test]
    fn route_request_v3_rejects_invalid_json() {
        let out = declarative_route_request_v3_json("{not json".to_owned());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "invalid_input_json");
    }

    #[test]
    fn route_request_v3_rejects_invalid_address() {
        let mut input = v3_route_input();
        input["submitter"] = json!("not-an-address");
        let out = declarative_route_request_v3_json(input.to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "invalid_input_json");
        let message = parsed["error"]["message"].as_str().unwrap_or_default();
        assert!(
            message.contains("submitter"),
            "expected submitter diagnostic, got: {message}"
        );
    }

    #[test]
    fn route_request_v3_serde_defaults_round_trip_through_miss() {
        // Pin the serde defaults for `value` / `gas_limit` / `gas_price` /
        // `nonce`. We assert via the error envelope: the early-parse stage
        // succeeds (no `invalid_input_json`) and the bridge lookup is what
        // fails.
        let input = json!({
            "chain_id":    8453,
            "to":          "0x0000000000000000000000000000000000001234",
            "selector":    "0x12345678",
            "calldata":    "0x12345678",
            "submitter":   "0x000000000000000000000000000000000000aaaa",
            "submitted_at": 1_700_000_000_u64
        });
        let out = declarative_route_request_v3_json(input.to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "no_declarative_v3_mapper", "{parsed}");
    }

    #[test]
    fn install_v3_returns_bundle_id() {
        let bundle = json!({
            "id": "test/v3/swap@1.0.0",
            "match": {
                "chain_ids": [1],
                "to": ["0x7a250d5630b4cf539739df2c5dacb4c659f2488d"],
                "selector": "0x38ed1739"
            },
            "abi_fragment": { "abi": [] },
            "emit": { "strategy": "single_emit", "body": {} }
        });
        let out = declarative_install_v3_json(bundle.to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["bundle_id"], "test/v3/swap@1.0.0");
        assert_eq!(parsed["data"]["decoder_id"], "test/v3/swap@1.0.0");
    }

    #[test]
    fn install_v3_rejects_missing_id() {
        let bundle = json!({
            "match": { "chain_ids": [1], "to": ["0x00"], "selector": "0x38ed1739" }
        });
        let out = declarative_install_v3_json(bundle.to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "missing_id");
    }
}
