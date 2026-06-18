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

/// One selectable action with a human label, for step-1 action selection.
#[derive(Deserialize)]
pub struct ActionInfo {
    /// Catalog key `"Ns::Id"` (e.g. `"Perp::PlaceOrder"`).
    pub key: String,
    /// Localized label (e.g. "선물 주문 넣기"). Helps the model match intent.
    #[serde(default)]
    pub label: String,
}

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
    /// Selectable actions with labels, for step-1 selection. Falls back to
    /// catalog keys when empty.
    #[serde(default)]
    pub actions: Vec<ActionInfo>,
    /// Per-action enrichment fields the policy may use:
    /// `{ "Ns::Id": [{ path: "context.custom.<name>", type, label }, …] }`.
    /// Added to the chosen action's fieldPath candidates so the model can author
    /// enrichment policies; the manifest is auto-generated client-side.
    #[serde(default)]
    pub enrichment: Value,
    /// Per-action mock-only concepts `{ "Ns::Id": ["연속 손실 …", …] }` — the
    /// backing method isn't implemented, so these are NOT usable; the model is
    /// told to put them in `warnings` instead of building a (dead) condition.
    #[serde(default)]
    pub mock_concepts: Value,
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

    // 후보 액션: 클라가 보낸 (key,label) 우선, 없으면 카탈로그 키로 폴백.
    let candidates: Vec<(String, String)> = if req.actions.is_empty() {
        req.catalog
            .as_object()
            .map(|m| {
                m.keys()
                    .filter(|k| k.as_str() != "*")
                    .map(|k| (k.clone(), k.clone()))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        req.actions
            .iter()
            .map(|a| {
                let label = if a.label.is_empty() {
                    a.key.clone()
                } else {
                    a.label.clone()
                };
                (a.key.clone(), label)
            })
            .collect()
    };

    // 1) 액션 결정 — trigger 가 오면 그걸, 아니면 LLM 이 (key+label) 목록에서 하나 고른다.
    let chosen_key: Option<String> = match req.trigger.as_ref().and_then(trigger_to_key) {
        Some(k) => Some(k),
        None if candidates.is_empty() => None,
        None => match pick_action(&client, &key, &req.intent, &candidates, &req.enrichment).await {
            Ok(k) => k,
            Err(e) => return err(StatusCode::BAD_GATEWAY, format!("OpenAI 호출 실패: {e}")),
        },
    };

    // 2) 선택 액션의 정적 필드 + 보강 필드만 컨텍스트로. 없으면 any-action("*").
    let fields = action_fields(&req.catalog, chosen_key.as_deref());
    let enrich = enrichment_for(&req.enrichment, chosen_key.as_deref());
    let mut paths: Vec<String> = fields.iter().map(|(p, _)| p.clone()).collect();
    paths.extend(enrich.iter().map(|(p, _, _)| p.clone()));
    let mut lines: Vec<String> = fields.iter().map(|(p, t)| format!("- {p}: {t}")).collect();
    lines.extend(
        enrich
            .iter()
            .map(|(p, t, l)| format!("- {p}: {t}  (보강 필드: {l})")),
    );
    let path_type_list = lines.join("\n");
    let label = chosen_key.as_deref().and_then(|k| {
        candidates
            .iter()
            .find(|(ck, _)| ck == k)
            .map(|(_, l)| l.as_str())
    });
    // mock 개념(미구현) — 사용 불가, 의도에 필요하면 warnings 로.
    let mock_concepts: Vec<String> = chosen_key
        .as_deref()
        .and_then(|k| req.mock_concepts.get(k))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default();

    let messages = vec![
        json!({ "role": "system", "content": system_prompt(&path_type_list, chosen_key.as_deref(), label, &mock_concepts) }),
        json!({ "role": "user", "content": format!("정책 의도: {}", req.intent) }),
    ];

    // FormModel(+warnings) 생성. fieldPath 는 그 액션의 실제 경로 enum 으로 강제되고,
    // trigger 는 서버가 선택 액션으로 덮어쓴다(분류/동작은 LLM 책임에서 제외).
    match call_openai(&client, &key, &messages, &paths).await {
        Ok(mut emitted) => {
            let warnings = emitted
                .as_object_mut()
                .and_then(|o| o.remove("warnings"))
                .unwrap_or_else(|| json!([]));
            force_trigger(&mut emitted, chosen_key.as_deref());
            tracing::info!(
                action = chosen_key.as_deref().unwrap_or("any"),
                "llm-draft generated"
            );
            Json(json!({ "formModel": emitted, "warnings": warnings })).into_response()
        }
        Err(e) => err(StatusCode::BAD_GATEWAY, format!("OpenAI 호출 실패: {e}")),
    }
}

/// Field `(path, cedarType)` pairs for the chosen action (or the `"*"` union).
fn action_fields(catalog: &Value, key: Option<&str>) -> Vec<(String, String)> {
    let rows = key
        .and_then(|k| catalog.get(k))
        .or_else(|| catalog.get("*"))
        .and_then(Value::as_array);
    rows.map(|rows| {
        rows.iter()
            .filter_map(|row| {
                let r = row.as_array()?;
                let path = r.first()?.as_str()?.to_owned();
                let ty = r.get(1)?.as_str()?.to_owned();
                Some((path, ty))
            })
            .collect()
    })
    .unwrap_or_default()
}

/// Enrichment `(path, type, label)` entries the chosen action may use.
fn enrichment_for(enrichment: &Value, key: Option<&str>) -> Vec<(String, String, String)> {
    let rows = key
        .and_then(|k| enrichment.get(k))
        .and_then(Value::as_array);
    rows.map(|rows| {
        rows.iter()
            .filter_map(|r| {
                let path = r.get("path")?.as_str()?.to_owned();
                let ty = r
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("String")
                    .to_owned();
                let label = r
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                Some((path, ty, label))
            })
            .collect()
    })
    .unwrap_or_default()
}

/// Overwrite the model's trigger with the server-chosen action so 분류/동작 is
/// always correct regardless of what the model emitted.
fn force_trigger(form_model: &mut Value, chosen_key: Option<&str>) {
    let trigger = match chosen_key {
        Some(k) => {
            let mut it = k.splitn(2, "::");
            let ns = it.next().unwrap_or("");
            let id = it.next().unwrap_or("");
            json!({ "kind": "actionEq", "entityType": format!("{ns}::Action"), "id": id })
        }
        None => json!({ "kind": "any" }),
    };
    if let Some(obj) = form_model.as_object_mut() {
        obj.insert("trigger".to_owned(), trigger);
    }
}

/// Call OpenAI with the `emit_form_model` function forced, and return the emitted
/// FormModel JSON.
async fn call_openai(
    client: &reqwest::Client,
    key: &str,
    messages: &[Value],
    paths: &[String],
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
                "parameters": form_model_parameters(paths),
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
/// list (or "any"). Tiny request — only the key enum + labels, never the field
/// catalog. Returns `Some(key)` for a specific action, `None` for any-action.
async fn pick_action(
    client: &reqwest::Client,
    key: &str,
    intent: &str,
    candidates: &[(String, String)],
    enrichment: &Value,
) -> Result<Option<String>, String> {
    let mut choices: Vec<Value> = candidates.iter().map(|(k, _)| json!(k)).collect();
    choices.push(json!("any"));
    // 각 액션을 "키 — 라벨 · 보강가능: …" 로 보여준다. 보강 라벨(예 "연속 손실 횟수",
    // "레버리지")이 의도 어휘와 액션을 잇는 가장 강한 신호다.
    let listing = candidates
        .iter()
        .map(|(k, l)| {
            let hints: Vec<&str> = enrichment
                .get(k)
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|r| r.get("label").and_then(Value::as_str))
                        .collect()
                })
                .unwrap_or_default();
            if hints.is_empty() {
                format!("{k} — {l}")
            } else {
                format!("{k} — {l} · 보강가능: {}", hints.join(", "))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let body = json!({
        "model": OPENAI_MODEL,
        "messages": [
            { "role": "system", "content": format!(
                "사용자의 정책 의도에 가장 잘 맞는 액션을 pick_action 의 actionKey 로 고른다.\n\
                 - 거의 모든 정책은 특정 액션에 대한 것이다. \"any\"는 정말 어떤 동작과도 무관할 때만(매우 드뭄).\n\
                 - 의도의 키워드(손실/연속손실/레버리지/가스/슬리피지/승인/전송/스왑 등)가 어떤 액션의 라벨이나 \
                 '보강가능' 항목과 맞으면 그 액션을 골라라. 예: '연속 손실'→'연속 손실 횟수' 보강이 있는 주문 액션.\n\
                 - 프로토콜 이름(Hyperliquid 등)이 나오면 그 프로토콜의 핵심 액션(주문 등)을 우선.\n\n\
                 (키 — 설명 · 보강가능):\n{listing}") },
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

/// Step 2 system prompt — rules + the ONE chosen action's `path: type` field list.
/// `trigger` is set by the server afterward, so the model only writes conditions,
/// severity, and a Korean reason. `value` kind must match each field's type.
fn system_prompt(
    path_type_list: &str,
    chosen_key: Option<&str>,
    label: Option<&str>,
    mock_concepts: &[String],
) -> String {
    let rules = "너는 Cedar 기반 지갑 정책을 만드는 도우미다. 사용자의 자연어 의도를 받아 \
emit_form_model 함수로 정책의 중간표현 FormModel 을 내보낸다.\n\
\n\
규칙:\n\
- effect 는 항상 forbid. severity 로 강도 표현: deny(차단) | warn(경고) | info.\n\
- when 은 위험 상황. 노드 리스트, joiner(and/or)로 묶임. AND 가 OR 보다 강하게 결합(OR of AND-runs). 첫 노드 joiner 무시.\n\
- unless 는 예외. forbid-when-X-unless-Y 는 when=X∧¬Y 와 같다.\n\
- op: == != < <= > >= contains notContains in(리터럴 집합 멤버십) notIn.\n\
- value 종류는 fieldPath 의 타입에 맞춘다: decimal→decimal, Long→long, Bool→bool, String→string, Set→set(in/contains). \
다른 필드와 비교는 field(예 principal.address). USD 금액은 decimal 필드+decimal value, 큰 정수 한도는 string value(16진수).\n\
- fieldPath 는 아래 목록의 경로만 쓸 수 있다(목록 밖은 불가). 같은 조건을 반복하지 말 것.\n\
- reason 은 사용자에게 보여줄 한국어 한 문장으로 쓴다.\n\
- warnings: 의도를 표현하려면 '미구현(mock)' 개념이 꼭 필요한데 아래 사용가능 필드로는 안 될 때, 그 사유를 한국어 한 문장으로 warnings 에 담는다(없으면 빈 배열). 미구현 개념으로 가짜 조건을 만들지 말 것.\n\
\n";
    let action_note = match (chosen_key, label) {
        (Some(k), Some(l)) => format!("대상 액션: {l} ({k}).\n\n"),
        (Some(k), None) => format!("대상 액션: {k}.\n\n"),
        _ => "대상 액션: 특정 동작에 한정되지 않음(any).\n\n".to_owned(),
    };
    let mock_note = if mock_concepts.is_empty() {
        String::new()
    } else {
        format!(
            "\n\n미구현(mock) 개념 — 사용 불가(필요하면 warnings 로만): {}",
            mock_concepts.join(", ")
        )
    };
    format!(
        "{rules}{action_note}이 액션에서 쓸 수 있는 필드(경로: 타입):\n{path_type_list}{mock_note}"
    )
}

/// strict structured outputs allow at most ~1000 enum values across the WHOLE
/// schema, so we can't enum two large path lists at once.
const MAX_ENUM_PATHS: usize = 800;

/// JSON schema for `emit_form_model`'s arguments: the FormModel itself.
/// Recursive (groups nest nodes), so anyOf (not oneOf) for strict mode.
/// `fieldPath` (LHS) is enum-constrained to the action's real paths so the model
/// can't invent a field; the rarer field-vs-field RHS `path` stays a free string
/// (one big enum, not two) — the prompt still lists the allowed paths. Very large
/// actions (> MAX_ENUM_PATHS) drop the fieldPath enum too to stay under the cap.
fn form_model_parameters(paths: &[String]) -> Value {
    let field_path_schema = if paths.is_empty() || paths.len() > MAX_ENUM_PATHS {
        json!({ "type": "string", "description": "context.* 점 경로(아래 목록 중 하나)" })
    } else {
        json!({ "enum": paths })
    };
    let rhs_path_schema =
        json!({ "type": "string", "description": "다른 필드 경로(예 principal.address)" });
    let value_schema = json!({
        "anyOf": [
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["bool"] }, "value": { "type": "boolean" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["long"] }, "value": { "type": "number" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["decimal"] }, "value": { "type": "string" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["string"] }, "value": { "type": "string" } }, "required": ["kind", "value"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["set"] }, "values": { "type": "array", "items": { "type": "string" } } }, "required": ["kind", "values"] },
            { "type": "object", "additionalProperties": false, "properties": { "kind": { "enum": ["field"] }, "path": rhs_path_schema }, "required": ["kind", "path"] }
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
                    "fieldPath": field_path_schema,
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
            "reason": { "type": "string" },
            "warnings": { "type": "array", "items": { "type": "string" }, "description": "미구현 개념이 필요해 표현 못 한 사유(없으면 빈 배열)" }
        },
        "required": ["trigger", "when", "unless", "id", "severity", "reason", "warnings"]
    })
}
