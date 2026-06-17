//! LLM policy drafting + per-user settings.
//!
//! - `GET  /v2/settings`        → `{ openai_api_key_set }` (never returns the key)
//! - `PUT  /v2/settings`        → store the user's OpenAI API key (empty clears)
//! - `POST /v2/policy/llm-draft`→ natural language → validated FormModel
//!
//! The OpenAI key is read from per-user storage (set via the dashboard Profile
//! page) and used here server-side, so the secret never reaches the browser.
//!
//! To stay under the OpenAI TPM budget, drafting is two calls: (1) pick the one
//! relevant action from a tiny key list, then (2) generate the FormModel given
//! only that action's fields. The FormModel is returned to the client, which
//! converts it to Cedar via the existing WASM pipeline (policy-engine) and
//! validates there — that conversion is deterministic and is the real save-time
//! gate, so the model never hand-writes Cedar.
#![allow(clippy::doc_markdown)]

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::AuthUser;

/// OpenAI chat-completions endpoint.
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
/// Default model. Kept server-side so it can change without a frontend release.
const OPENAI_MODEL: &str = "gpt-4o";

fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, msg.into()).into_response()
}

// ── GET/PUT /v2/settings ────────────────────────────────────────────────────

/// `GET /v2/settings` — report whether the user has an OpenAI key set. The key
/// value is never returned.
pub async fn get_settings(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    match state.global_db.get_openai_key(&user.user_id).await {
        Ok(key) => Json(json!({ "openai_api_key_set": key.is_some_and(|k| !k.is_empty()) }))
            .into_response(),
        Err(e) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("read settings: {e}"),
        ),
    }
}

/// Body for `PUT /v2/settings`.
#[derive(Deserialize)]
pub struct PutSettingsReq {
    /// The OpenAI API key. An empty string clears the stored key.
    pub openai_api_key: String,
}

/// `PUT /v2/settings` — store (or clear) the user's OpenAI API key.
pub async fn put_settings(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<PutSettingsReq>,
) -> Response {
    let key = req.openai_api_key.trim();
    if !key.is_empty() && !key.starts_with("sk-") {
        return err(
            StatusCode::BAD_REQUEST,
            "OpenAI API key는 보통 'sk-'로 시작합니다.",
        );
    }
    match state.global_db.set_openai_key(&user.user_id, key).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("save settings: {e}"),
        ),
    }
}

// ── POST /v2/policy/llm-draft ─────────────────────────────────────────────────

/// Body for `POST /v2/policy/llm-draft`.
#[derive(Deserialize)]
pub struct LlmDraftReq {
    /// Natural-language policy intent.
    pub intent: String,
    /// Full field catalog object `{ "Ns::Id": [[path, type, guards?], …], "*": [...] }`,
    /// sent by the dashboard. The server picks ONE action and sends only that
    /// action's fields to the model — keeps each request small (TPM budget).
    #[serde(default)]
    pub catalog: Value,
    /// Optional pre-chosen trigger hint `{ entityType, id }` (skips action pick).
    #[serde(default)]
    pub trigger: Option<Value>,
}

/// `POST /v2/policy/llm-draft` — natural language → FormModel.
pub async fn draft_policy(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<LlmDraftReq>,
) -> Response {
    if req.intent.trim().is_empty() {
        return err(
            StatusCode::BAD_REQUEST,
            "정책 의도(intent)가 비어 있습니다.",
        );
    }

    let key = match state.global_db.get_openai_key(&user.user_id).await {
        Ok(Some(k)) if !k.is_empty() => k,
        Ok(_) => {
            return err(
                StatusCode::PRECONDITION_REQUIRED,
                "OpenAI API key가 설정되지 않았습니다. 프로필 페이지에서 키를 입력하세요.",
            )
        }
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, format!("read key: {e}")),
    };

    let client = reqwest::Client::new();

    // 1) 액션 결정 — trigger 가 오면 그걸 쓰고, 아니면 작은 액션 목록만 줘서 LLM 이
    //    하나 고르게 한다(여기서 전체 카탈로그를 보내지 않는 게 토큰 절약의 핵심).
    let action_keys: Vec<String> = req
        .catalog
        .as_object()
        .map(|m| m.keys().filter(|k| k.as_str() != "*").cloned().collect())
        .unwrap_or_default();
    let chosen_key: Option<String> = match req.trigger.as_ref().and_then(trigger_to_key) {
        Some(k) => Some(k),
        None if action_keys.is_empty() => None,
        None => match pick_action(&client, &key, &req.intent, &action_keys).await {
            Ok(k) => k,
            Err(e) => return err(StatusCode::BAD_GATEWAY, format!("OpenAI 호출 실패: {e}")),
        },
    };

    // 2) 선택된 액션의 필드만 컨텍스트로 — 없으면 any-action 합집합("*")로 폴백.
    let fields = chosen_key
        .as_deref()
        .and_then(|k| req.catalog.get(k))
        .or_else(|| req.catalog.get("*"));
    let action_context = fields.map_or_else(|| "[]".to_owned(), ToString::to_string);

    let messages = vec![
        json!({ "role": "system", "content": system_prompt(&action_context, chosen_key.as_deref()) }),
        json!({ "role": "user", "content": format!("정책 의도: {}", req.intent) }),
    ];

    // FormModel 만 생성한다. 실제 저장될 Cedar 는 클라이언트가 FormModel→WASM(동일
    // policy-engine)으로 만들어 검증하므로, 거기가 진짜 컴파일 게이트다.
    match call_openai(&client, &key, &messages).await {
        Ok(form_model) => Json(form_model).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, format!("OpenAI 호출 실패: {e}")),
    }
}

/// Call OpenAI with the `emit_form_model` function forced, and return the emitted
/// FormModel JSON.
async fn call_openai(
    client: &reqwest::Client,
    key: &str,
    messages: &[Value],
) -> Result<Value, String> {
    let body = json!({
        "model": OPENAI_MODEL,
        "messages": messages,
        "tools": [{
            "type": "function",
            "function": {
                "name": "emit_form_model",
                "description": "자연어 의도를 변환한 FormModel 정책을 내보낸다.",
                "strict": true,
                "parameters": form_model_parameters(),
            }
        }],
        "tool_choice": { "type": "function", "function": { "name": "emit_form_model" } },
    });

    let resp = client
        .post(OPENAI_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or(text);
        return Err(format!("{status}: {detail}"));
    }

    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let args = json
        .pointer("/choices/0/message/tool_calls/0/function/arguments")
        .and_then(Value::as_str)
        .ok_or_else(|| "응답에 emit_form_model 호출이 없습니다.".to_owned())?;
    serde_json::from_str::<Value>(args).map_err(|e| format!("FormModel 인자 파싱 실패: {e}"))
}

/// `{ entityType: "Amm::Action", id: "Swap" }` → catalog key `"Amm::Swap"`.
fn trigger_to_key(t: &Value) -> Option<String> {
    let et = t.get("entityType").and_then(Value::as_str)?;
    let id = t.get("id").and_then(Value::as_str)?;
    let ns = et.split("::").next()?;
    Some(format!("{ns}::{id}"))
}

/// Step 1: ask the model to pick the single most relevant action key from the
/// list (or "any"). Tiny request — only the key enum, never the field catalog.
/// Returns `Some(key)` for a specific action, `None` for any-action.
async fn pick_action(
    client: &reqwest::Client,
    key: &str,
    intent: &str,
    action_keys: &[String],
) -> Result<Option<String>, String> {
    let mut choices: Vec<Value> = action_keys.iter().map(|k| json!(k)).collect();
    choices.push(json!("any"));
    let body = json!({
        "model": OPENAI_MODEL,
        "messages": [
            { "role": "system", "content":
                "사용자의 정책 의도에 가장 잘 맞는 액션 키 하나를 pick_action 의 actionKey 로 고른다. \
                 키는 \"Ns::Id\" 형식. 특정 액션이 없으면 \"any\"." },
            { "role": "user", "content": format!("정책 의도: {intent}") }
        ],
        "tools": [{
            "type": "function",
            "function": {
                "name": "pick_action",
                "description": "의도에 맞는 액션 키 하나를 고른다.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "actionKey": { "enum": choices } },
                    "required": ["actionKey"]
                }
            }
        }],
        "tool_choice": { "type": "function", "function": { "name": "pick_action" } }
    });

    let resp = client
        .post(OPENAI_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .unwrap_or(text);
        return Err(format!("{status}: {detail}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let args = v
        .pointer("/choices/0/message/tool_calls/0/function/arguments")
        .and_then(Value::as_str)
        .ok_or_else(|| "pick_action 응답이 없습니다.".to_owned())?;
    let parsed: Value = serde_json::from_str(args).map_err(|e| e.to_string())?;
    let chosen = parsed
        .get("actionKey")
        .and_then(Value::as_str)
        .unwrap_or("any");
    Ok(if chosen == "any" {
        None
    } else {
        Some(chosen.to_owned())
    })
}

/// Step 2 system prompt — rules + the ONE chosen action's field catalog (not the
/// whole catalog).
fn system_prompt(action_context: &str, chosen_key: Option<&str>) -> String {
    let rules = "너는 Cedar 기반 지갑 정책을 만드는 도우미다. 사용자의 자연어 의도를 받아 \
emit_form_model 함수로 정책의 중간표현 FormModel 을 내보낸다.\n\
\n\
규칙:\n\
- effect 는 항상 forbid. severity 로 강도 표현: deny(차단) | warn(경고) | info.\n\
- when 은 위험 상황. 노드 리스트, joiner(and/or)로 묶임. AND 가 OR 보다 강하게 결합(OR of AND-runs). 첫 노드 joiner 무시.\n\
- unless 는 예외. forbid-when-X-unless-Y 는 when=X∧¬Y 와 같다.\n\
- op: == != < <= > >= contains notContains in(리터럴 집합 멤버십) notIn.\n\
- value 종류: bool/long/decimal(소수점 문자열)/string/set(문자열 집합, in 용)/field(다른 필드 경로, 예 principal.address).\n\
- fieldPath 와 field.path 는 반드시 아래 카탈로그에 존재하는 경로만 사용. USD 금액은 decimal 필드+decimal value. 큰 정수 한도는 string value(16진수).\n\
\n";
    let trigger_note = match chosen_key {
        Some(k) => {
            let mut it = k.splitn(2, "::");
            let ns = it.next().unwrap_or("");
            let id = it.next().unwrap_or("");
            format!(
                "이 정책의 trigger 는 {{ kind:\"actionEq\", entityType:\"{ns}::Action\", id:\"{id}\" }} 로 설정하라.\n\n",
            )
        }
        None => "특정 액션이 없으니 trigger 는 { kind:\"any\" } 로 설정하라.\n\n".to_owned(),
    };
    format!("{rules}{trigger_note}이 액션의 필드 카탈로그(JSON):\n{action_context}")
}

/// JSON schema for `emit_form_model`'s arguments: the FormModel itself.
/// Recursive (groups nest nodes), so this is a non-strict schema.
fn form_model_parameters() -> Value {
    let value_schema = json!({
        "anyOf": [
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["bool"] }, "value": { "type": "boolean" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["long"] }, "value": { "type": "number" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["decimal"] }, "value": { "type": "string" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["string"] }, "value": { "type": "string" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["set"] }, "values": { "type": "array", "items": { "type": "string" } } }, "required": ["kind", "values"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["field"] }, "path": { "type": "string" } }, "required": ["kind", "path"] }
        ]
    });
    json!({
        "type": "object",
        "additionalProperties": false,
        "$defs": {
            "value": value_schema,
            "condition": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "fieldPath": { "type": "string", "description": "context.* 점 경로(카탈로그에 존재)" },
                    "op": { "enum": ["==", "!=", "<", "<=", ">", ">=", "contains", "notContains", "in", "notIn"] },
                    "value": { "$ref": "#/$defs/value" },
                    "joiner": { "enum": ["and", "or"] }
                },
                "required": ["fieldPath", "op", "value", "joiner"]
            },
            "group": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "kind": { "enum": ["group"] },
                    "joiner": { "enum": ["and", "or"] },
                    "conds": { "type": "array", "items": { "$ref": "#/$defs/node" } }
                },
                "required": ["kind", "joiner", "conds"]
            },
            "node": { "anyOf": [{ "$ref": "#/$defs/condition" }, { "$ref": "#/$defs/group" }] }
        },
        "properties": {
            "trigger": {
                "anyOf": [
                    { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["actionEq"] }, "entityType": { "type": "string" }, "id": { "type": "string" } }, "required": ["kind", "entityType", "id"] },
                    { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["any"] } }, "required": ["kind"] }
                ]
            },
            "when": { "type": "array", "items": { "$ref": "#/$defs/node" } },
            "unless": { "type": "array", "items": { "$ref": "#/$defs/node" } },
            "id": { "type": "string" },
            "severity": { "enum": ["warn", "deny", "info"] },
            "reason": { "type": "string" }
        },
        "required": ["trigger", "when", "unless", "id", "severity", "reason"]
    })
}
