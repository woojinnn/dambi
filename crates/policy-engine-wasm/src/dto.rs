//! Serde-friendly DTOs for the WASM JSON boundary.

use serde::{Deserialize, Serialize};

use policy_engine::policy_rpc::{PolicyManifest, PolicyRpcCall, PolicyRpcResponse, RootInput};
use policy_engine::ActionEnvelope;

#[derive(Debug, Serialize)]
pub struct Envelope<T: Serialize> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<EngineErrorDto>,
}

impl<T: Serialize> Envelope<T> {
    pub fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(EngineErrorDto::new(kind, message)),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("envelope serialization cannot fail")
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineErrorDto {
    pub kind: String,
    pub message: String,
}

impl EngineErrorDto {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct InstallPoliciesInputDto {
    #[serde(default)]
    pub schema_text: String,
    pub policy_set: Vec<PolicyEntryDto>,
    #[serde(default)]
    pub manifests: Vec<PolicyManifest>,
}

#[derive(Debug, Deserialize)]
pub struct PolicyEntryDto {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VerdictDto {
    Pass,
    Warn { matched: Vec<MatchedPolicyDto> },
    Fail { matched: Vec<MatchedPolicyDto> },
}

#[derive(Debug, Clone, Serialize)]
pub struct MatchedPolicyDto {
    pub policy_id: String,
    pub reason: Option<String>,
    pub severity: String,
    pub origin: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawRequestDto {
    pub method: String,
    pub params: serde_json::Value,
    pub chain_id: u64,
    #[serde(default)]
    pub block_timestamp: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlanPolicyRpcInputDto {
    pub request_id: String,
    pub raw_request: RawRequestDto,
    #[serde(default)]
    pub manifests: Vec<PolicyManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRpcPlanDto {
    pub request_id: String,
    pub root: RootInput,
    pub envelopes: Vec<ActionEnvelope>,
    pub calls: Vec<PolicyRpcCall>,
    pub manifest_set_hash: String,
    pub schema_hash: String,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EvaluatePolicyRpcInputDto {
    pub plan: PolicyRpcPlanDto,
    pub rpc_response: PolicyRpcResponse,
    #[serde(default)]
    pub manifests: Vec<PolicyManifest>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PreviewSchemaInputDto {
    #[serde(default)]
    pub manifests: Vec<PolicyManifest>,
}

// ───────────────────────────────────────────────────────────────────────────
// Declarative mapper boundary (Phase 1A)
// ───────────────────────────────────────────────────────────────────────────

/// Result returned by `declarative_install_json` on success.
#[derive(Debug, Clone, Serialize)]
pub struct DeclarativeInstallResultDto {
    /// Decoder id derived from the bundle (`declarative.<bundle.id-without-version>`).
    pub decoder_id: String,
    /// Echoes back the bundle's full id (including `@version`) for client
    /// indexing.
    pub bundle_id: String,
}

/// Input for `declarative_lookup_json`.
///
/// Phase 1A keeps this self-contained — it carries the decoder selection key
/// and a JSON-friendly `DecodedCall`. Bridge integration (selector → decoder)
/// is left for Phase 1B / Phase 2.
#[derive(Debug, Clone, Deserialize)]
pub struct DeclarativeLookupInputDto {
    /// Bundle's declarative decoder id (e.g.
    /// `"declarative.uniswap/v2/swapExactTokensForTokens"`).
    pub decoder_id: String,
    pub ctx: DeclarativeCtxDto,
    pub decoded: DecodedCallDto,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeclarativeCtxDto {
    pub chain_id: u64,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub value_wei: Option<String>,
    #[serde(default)]
    pub block_timestamp: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DecodedCallDto {
    pub decoder_id: String,
    pub function_signature: String,
    #[serde(default)]
    pub args: Vec<DecodedArgDto>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DecodedArgDto {
    pub name: String,
    pub abi_type: String,
    pub value: DecodedValueDto,
}

/// Tagged DTO for the calldata-decoder's value tree.
///
/// `kind` discriminates the variant. `value` payloads:
///   * `address`  — `"0x" + 40 hex` string.
///   * `uint`     — base-10 decimal string (lossless for `uint256`).
///   * `int`      — signed decimal string.
///   * `bool`     — boolean.
///   * `bytes`    — `"0x" + hex` string.
///   * `string`   — string.
///   * `array`    — array of `DecodedValueDto`.
///   * `tuple`    — array of `DecodedValueDto`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DecodedValueDto {
    Address(String),
    Uint(String),
    Int(String),
    Bool(bool),
    Bytes(String),
    String(String),
    Array(Vec<DecodedValueDto>),
    Tuple(Vec<DecodedValueDto>),
}

// ───────────────────────────────────────────────────────────────────────────
// Phase 6 — orchestrator route entry
// ───────────────────────────────────────────────────────────────────────────

/// Input for `declarative_route_request_json`.
///
/// `(chain_id, to, selector)` form the callkey for the bridge lookup. `ctx`
/// and `decoded` are the per-tx execution context and the decoded call data
/// the caller (orchestrator) decoded ahead of time (typically via the
/// Tier B static abi-resolver). `decoded.decoder_id` is ignored — the route
/// entry overwrites it with the canonical declarative id resolved from the
/// bridge.
#[derive(Debug, Clone, Deserialize)]
pub struct DeclarativeRouteRequestInputDto {
    pub chain_id: u64,
    /// "0x" + 40 hex. Case-insensitive — the bridge normalises to lowercase.
    pub to: String,
    /// "0x" + 8 hex. Case-insensitive — same as `to`.
    pub selector: String,
    pub ctx: DeclarativeCtxDto,
    pub decoded: DecodedCallDto,
}

/// Result returned by `declarative_route_request_json` on success.
/// `decoder_id` lets the caller correlate the envelopes with the bundle the
/// bridge resolved (useful for audit / telemetry).
#[derive(Debug, Clone, Serialize)]
pub struct DeclarativeRouteRequestResultDto {
    pub envelopes: Vec<policy_engine::ActionEnvelope>,
    pub decoder_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn envelope_ok_uses_boolean_wire_shape() {
        let output = Envelope::ok(json!({"answer": 42})).to_json();
        let parsed: Value = serde_json::from_str(&output).unwrap();

        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["answer"], 42, "{parsed}");
        assert!(parsed["error"].is_null(), "{parsed}");
    }
}
