/**
 * LLM 정책 초안 — 자연어 의도 → FormModel. **완전 클라이언트 사이드.**
 *
 * 에디터의 "LLM" 탭이 호출한다. 예전엔 policy-server 로 보내 서버가 OpenAI 를
 * 호출했지만, 이제 키를 브라우저(localStorage)에만 두고 여기서 **OpenAI 를 직접**
 * 호출한다(키가 우리 서버를 절대 거치지 않는다). 확장은 host_permissions(<all_urls>)
 * 로 api.openai.com 에 교차출처 fetch 가 허용되고, CSP 가 connect-src 를 막지 않는다.
 *
 * TPM 절약을 위해 2단계: (1) 작은 키 목록에서 액션 하나를 고르고, (2) 그 액션의
 * 필드만 줘서 FormModel 을 생성한다. fieldPath 는 그 액션의 실제 경로 enum 으로
 * 강제되고, trigger 는 우리가 선택 액션으로 덮어쓴다(분류/동작은 LLM 책임 밖).
 * 생성된 FormModel 은 호출부에서 WASM(policy-engine) 으로 Cedar 변환·검증된다 —
 * 그 변환이 진짜 저장 게이트라 모델이 Cedar 를 직접 쓰지 않는다.
 *
 * OpenAI 키는 프로필 페이지에서 설정한다(server-api/settings.ts, localStorage).
 */

import { i18n } from "../i18n";
import { KNOWN_ACTIONS } from "../cedar/form/actions";
import { isRawNumericStringLeaf } from "../cedar/form/field-catalog";
import { SCHEMA_CATALOG } from "../cedar/form/schema-catalog.generated";
import type { FormModel, FormTrigger } from "../cedar/form/model";
import { methodDerivedFields } from "../pages/editor/v2/custom-field-methods";
import { ENRICHMENT_FIELDS } from "../editor-v9/manifest-gen";
import { getStoredOpenaiKey } from "./settings";

/** OpenAI chat-completions 엔드포인트. */
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** 기본 모델 — 구조화 출력(strict function call)을 지원해야 한다. */
const OPENAI_MODEL = "gpt-4o";
/** strict structured outputs 는 스키마 전체 enum 값이 ~1000개 제한이라, 큰 액션은
 *  fieldPath enum 을 떨궈 cap 아래로 둔다(프롬프트엔 여전히 경로 목록을 준다). */
const MAX_ENUM_PATHS = 800;

export interface LlmDraftInput {
  /** 사용자가 적은 정책 의도(자연어). */
  intent: string;
  /** 이미 고른 액션이 있으면 힌트로 전달(없으면 LLM 이 직접 고른다). */
  trigger?: FormTrigger | null;
}

/** LLM 생성 결과 — FormModel + LLM 이 남긴 경고(예: mock 메서드 필요). */
export interface LlmDraftResult {
  model: FormModel;
  warnings: string[];
}

type EnrichEntry = { path: string; type: string; label: string };
type ActionInfo = { key: string; label: string };

/** `"Perp::PlaceOrder"` → 액션 태그 `"place_order"` (manifest-gen 의 actionTag 와 동일). */
const tagOfKey = (key: string): string =>
  (key.split("::")[1] ?? "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** LLM 에 줄 카탈로그 — 정렬 비교가 안 되는 원시 숫자-String 필드(amount/gas/price
 *  원본 등)는 제외한다. 폼이 고급으로 숨기는 것과 동일 판정(isRawNumericStringLeaf)
 *  이라, LLM 이 "gas > X" 같은 의도에 잘못된 String 필드를 고르지 않게 한다. */
function cleanedCatalog(): typeof SCHEMA_CATALOG {
  const out: Record<string, (typeof SCHEMA_CATALOG)[string]> = {};
  for (const [k, rows] of Object.entries(SCHEMA_CATALOG)) {
    out[k] = rows.filter(
      ([path, type]) => !(type === "String" && isRawNumericStringLeaf(path.split(".").pop() ?? "")),
    );
  }
  return out;
}

/** 액션 선택용 목록 — 카탈로그 키("Ns::Id")에 사람이 읽는 한국어 라벨을 붙인다.
 *  step1(액션 선택)이 라벨로 의도를 더 정확히 매칭하게 한다. */
function actionList(): ActionInfo[] {
  return KNOWN_ACTIONS.map((a) => ({
    key: `${a.entityType.split("::")[0]}::${a.id}`,
    label: a.label,
  }));
}

/** 액션별로 LLM 에 줄 (1) 사용 가능한 보강 필드 = 레지스트리 보강 + 실구현(real)
 *  메서드-파생 필드, (2) mock 메서드 개념 라벨(사용 불가, 경고용)을 만든다. */
function buildEnrichment(actions: ActionInfo[]): {
  enrichment: Record<string, EnrichEntry[]>;
  mockConcepts: Record<string, string[]>;
} {
  const en = i18n.language.startsWith("en");
  const enrichment: Record<string, EnrichEntry[]> = {};
  const mockConcepts: Record<string, string[]> = {};

  // 1) 레지스트리 보강 필드 (appliesTo 태그로).
  for (const [name, def] of Object.entries(ENRICHMENT_FIELDS)) {
    const entry: EnrichEntry = {
      path: `context.custom.${name}`,
      type: def.type,
      label: en ? def.label.en : def.label.ko,
    };
    for (const a of actions) {
      if (def.appliesTo.includes(tagOfKey(a.key))) (enrichment[a.key] ??= []).push(entry);
    }
  }

  // 2) 메서드-파생 필드 — real 은 사용 가능, mock 은 개념(경고)으로 분리.
  for (const a of actions) {
    const tag = tagOfKey(a.key);
    const paths = (SCHEMA_CATALOG[a.key] ?? []).map((r) => r[0]);
    for (const d of methodDerivedFields(tag, paths)) {
      const label = en ? d.field.label.en : d.field.label.ko;
      if (d.mock) (mockConcepts[a.key] ??= []).push(label);
      else (enrichment[a.key] ??= []).push({ path: d.path, type: d.field.type, label });
    }
  }
  return { enrichment, mockConcepts };
}

// ── OpenAI 호출 ───────────────────────────────────────────────────────────────

/** OpenAI chat-completions 호출 — 실패 시 모델이 준 error.message 를 꺼내 던진다.
 *  tool_choice 로 강제한 함수의 arguments(JSON 문자열)를 파싱해 돌려준다. */
async function callTool(key: string, body: Record<string, unknown>): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // 네트워크/CORS 실패 등 — fetch 자체가 던진 경우.
    throw new Error(i18n.t("editor:llm.errCall", { detail: e instanceof Error ? e.message : String(e) }));
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let detail = text || `HTTP ${resp.status}`;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j?.error?.message) detail = j.error.message;
    } catch {
      /* not JSON — keep raw text */
    }
    throw new Error(i18n.t("editor:llm.errCall", { detail: `${resp.status}: ${detail}` }));
  }
  const json = (await resp.json()) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
  };
  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== "string") throw new Error(i18n.t("editor:llm.errParse"));
  try {
    return JSON.parse(args);
  } catch {
    throw new Error(i18n.t("editor:llm.errParse"));
  }
}

/** Step 1: 의도에 가장 잘 맞는 액션 키 하나(또는 any)를 고른다. 키+라벨+보강 힌트만
 *  주는 작은 요청. specific 이면 키, any 면 null. */
async function pickAction(
  key: string,
  intent: string,
  candidates: ActionInfo[],
  enrichment: Record<string, EnrichEntry[]>,
): Promise<string | null> {
  const choices = [...candidates.map((c) => c.key), "any"];
  const listing = candidates
    .map((c) => {
      const hints = (enrichment[c.key] ?? []).map((e) => e.label);
      return hints.length ? `${c.key} — ${c.label} · 보강가능: ${hints.join(", ")}` : `${c.key} — ${c.label}`;
    })
    .join("\n");
  const sys =
    "사용자의 정책 의도에 가장 잘 맞는 액션을 pick_action 의 actionKey 로 고른다.\n" +
    '- 거의 모든 정책은 특정 액션에 대한 것이다. "any"는 정말 어떤 동작과도 무관할 때만(매우 드뭄).\n' +
    "- 의도의 키워드(손실/연속손실/레버리지/가스/슬리피지/승인/전송/스왑 등)가 어떤 액션의 라벨이나 '보강가능' 항목과 맞으면 그 액션을 골라라. 예: '연속 손실'→'연속 손실 횟수' 보강이 있는 주문 액션.\n" +
    "- 프로토콜 이름(Hyperliquid 등)이 나오면 그 프로토콜의 핵심 액션(주문 등)을 우선.\n\n" +
    `(키 — 설명 · 보강가능):\n${listing}`;
  const parsed = (await callTool(key, {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `정책 의도: ${intent}` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "pick_action",
          description: "의도에 맞는 액션 키 하나를 고른다.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { actionKey: { enum: choices } },
            required: ["actionKey"],
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "pick_action" } },
  })) as { actionKey?: string };
  const chosen = parsed.actionKey ?? "any";
  return chosen === "any" ? null : chosen;
}

/** 선택 액션(또는 "*" 합집합)의 필드 (path, cedarType) 쌍. */
function actionFields(catalog: typeof SCHEMA_CATALOG, key: string | null): Array<[string, string]> {
  const rows = (key ? catalog[key] : undefined) ?? catalog["*"] ?? [];
  return rows.map((r) => [r[0], r[1]] as [string, string]);
}

/** `{ entityType: "Amm::Action", id: "Swap" }` → 카탈로그 키 `"Amm::Swap"`. */
function triggerToKey(t: FormTrigger): string | null {
  if (t.kind !== "actionEq") return null;
  const ns = t.entityType.split("::")[0];
  return ns ? `${ns}::${t.id}` : null;
}

/** 모델 trigger 를 서버-선택 액션으로 덮어써 분류/동작을 항상 정확히 한다. */
function forceTrigger(model: Record<string, unknown>, chosenKey: string | null): void {
  if (chosenKey) {
    const [ns, id] = chosenKey.split("::");
    model.trigger = { kind: "actionEq", entityType: `${ns}::Action`, id: id ?? "" };
  } else {
    model.trigger = { kind: "any" };
  }
}

/** Step 2 시스템 프롬프트 — 규칙 + 선택 액션의 `경로: 타입` 필드 목록. trigger 는
 *  이후 우리가 세팅하므로 모델은 조건/심각도/한국어 사유만 쓴다. */
function systemPrompt(
  pathTypeList: string,
  chosenKey: string | null,
  label: string | null,
  mockConcepts: string[],
): string {
  const rules =
    "너는 Cedar 기반 지갑 정책을 만드는 도우미다. 사용자의 자연어 의도를 받아 emit_form_model 함수로 정책의 중간표현 FormModel 을 내보낸다.\n\n" +
    "규칙:\n" +
    "- effect 는 항상 forbid. severity 로 강도 표현: deny(차단) | warn(경고) | info.\n" +
    "- when 은 위험 상황. 노드 리스트, joiner(and/or)로 묶임. AND 가 OR 보다 강하게 결합(OR of AND-runs). 첫 노드 joiner 무시.\n" +
    "- unless 는 예외. forbid-when-X-unless-Y 는 when=X∧¬Y 와 같다.\n" +
    "- op: == != < <= > >= contains notContains in(리터럴 집합 멤버십) notIn.\n" +
    "- value 종류는 fieldPath 의 타입에 맞춘다: decimal→decimal, Long→long, Bool→bool, String→string, Set→set(in/contains). 다른 필드와 비교는 field(예 principal.address). USD 금액은 decimal 필드+decimal value, 큰 정수 한도는 string value(16진수).\n" +
    "- fieldPath 는 아래 목록의 경로만 쓸 수 있다(목록 밖은 불가). 같은 조건을 반복하지 말 것.\n" +
    "- reason 은 사용자에게 보여줄 한국어 한 문장으로 쓴다.\n" +
    "- warnings: 의도를 표현하려면 '미구현(mock)' 개념이 꼭 필요한데 아래 사용가능 필드로는 안 될 때, 그 사유를 한국어 한 문장으로 warnings 에 담는다(없으면 빈 배열). 미구현 개념으로 가짜 조건을 만들지 말 것.\n\n";
  const actionNote = chosenKey
    ? `대상 액션: ${label ?? chosenKey} (${chosenKey}).\n\n`
    : "대상 액션: 특정 동작에 한정되지 않음(any).\n\n";
  const mockNote = mockConcepts.length
    ? `\n\n미구현(mock) 개념 — 사용 불가(필요하면 warnings 로만): ${mockConcepts.join(", ")}`
    : "";
  return `${rules}${actionNote}이 액션에서 쓸 수 있는 필드(경로: 타입):\n${pathTypeList}${mockNote}`;
}

/** emit_form_model 의 arguments 스키마(=FormModel). 재귀적(group 이 node 를 품음)이라
 *  strict 모드에서 anyOf 를 쓴다. fieldPath(LHS)는 액션의 실제 경로 enum 으로 제약
 *  (큰 액션은 cap 때문에 자유 string). field-vs-field RHS path 는 자유 string. */
function formModelParameters(paths: string[]): Record<string, unknown> {
  const fieldPathSchema =
    paths.length === 0 || paths.length > MAX_ENUM_PATHS
      ? { type: "string", description: "context.* 점 경로(아래 목록 중 하나)" }
      : { enum: paths };
  const valueSchema = {
    anyOf: [
      { type: "object", additionalProperties: false, properties: { kind: { enum: ["bool"] }, value: { type: "boolean" } }, required: ["kind", "value"] },
      { type: "object", additionalProperties: false, properties: { kind: { enum: ["long"] }, value: { type: "number" } }, required: ["kind", "value"] },
      { type: "object", additionalProperties: false, properties: { kind: { enum: ["decimal"] }, value: { type: "string" } }, required: ["kind", "value"] },
      { type: "object", additionalProperties: false, properties: { kind: { enum: ["string"] }, value: { type: "string" } }, required: ["kind", "value"] },
      { type: "object", additionalProperties: false, properties: { kind: { enum: ["set"] }, values: { type: "array", items: { type: "string" } } }, required: ["kind", "values"] },
      { type: "object", additionalProperties: false, properties: { kind: { enum: ["field"] }, path: { type: "string", description: "다른 필드 경로(예 principal.address)" } }, required: ["kind", "path"] },
    ],
  };
  return {
    type: "object",
    additionalProperties: false,
    $defs: {
      value: valueSchema,
      condition: {
        type: "object",
        additionalProperties: false,
        properties: {
          fieldPath: fieldPathSchema,
          op: { enum: ["==", "!=", "<", "<=", ">", ">=", "contains", "notContains", "in", "notIn"] },
          value: { $ref: "#/$defs/value" },
          joiner: { enum: ["and", "or"] },
        },
        required: ["fieldPath", "op", "value", "joiner"],
      },
      group: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { enum: ["group"] },
          joiner: { enum: ["and", "or"] },
          conds: { type: "array", items: { $ref: "#/$defs/node" } },
        },
        required: ["kind", "joiner", "conds"],
      },
      node: { anyOf: [{ $ref: "#/$defs/condition" }, { $ref: "#/$defs/group" }] },
    },
    properties: {
      trigger: {
        anyOf: [
          { type: "object", additionalProperties: false, properties: { kind: { enum: ["actionEq"] }, entityType: { type: "string" }, id: { type: "string" } }, required: ["kind", "entityType", "id"] },
          { type: "object", additionalProperties: false, properties: { kind: { enum: ["any"] } }, required: ["kind"] },
        ],
      },
      when: { type: "array", items: { $ref: "#/$defs/node" } },
      unless: { type: "array", items: { $ref: "#/$defs/node" } },
      id: { type: "string" },
      severity: { enum: ["warn", "deny", "info"] },
      reason: { type: "string" },
      warnings: { type: "array", items: { type: "string" }, description: "미구현 개념이 필요해 표현 못 한 사유(없으면 빈 배열)" },
    },
    required: ["trigger", "when", "unless", "id", "severity", "reason", "warnings"],
  };
}

/** 자연어 의도를 FormModel 로 변환한다. 키는 localStorage 에서 읽어 OpenAI 를 직접
 *  호출한다(우리 서버 경유 없음). */
export async function llmDraftPolicy({ intent, trigger }: LlmDraftInput): Promise<LlmDraftResult> {
  if (!intent.trim()) throw new Error(i18n.t("editor:llm.errEmpty"));
  const key = getStoredOpenaiKey();
  if (!key) throw new Error(i18n.t("editor:llm.errNoKey"));

  const catalog = cleanedCatalog();
  const actions = actionList();
  const { enrichment, mockConcepts } = buildEnrichment(actions);

  // 1) 액션 결정 — trigger 힌트가 있으면 그걸, 아니면 LLM 이 고른다.
  const hinted = trigger ? triggerToKey(trigger) : null;
  const chosenKey: string | null = hinted ?? (actions.length ? await pickAction(key, intent, actions, enrichment) : null);

  // 2) 선택 액션의 정적 필드 + 보강 필드만 컨텍스트로.
  const fields = actionFields(catalog, chosenKey);
  const enrich = chosenKey ? enrichment[chosenKey] ?? [] : [];
  const paths = [...fields.map(([p]) => p), ...enrich.map((e) => e.path)];
  const lines = [
    ...fields.map(([p, t]) => `- ${p}: ${t}`),
    ...enrich.map((e) => `- ${e.path}: ${e.type}  (보강 필드: ${e.label})`),
  ];
  const label = chosenKey ? actions.find((a) => a.key === chosenKey)?.label ?? null : null;
  const mock = chosenKey ? mockConcepts[chosenKey] ?? [] : [];

  const emitted = (await callTool(key, {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt(lines.join("\n"), chosenKey, label, mock) },
      { role: "user", content: `정책 의도: ${intent}` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_form_model",
          description: "자연어 의도를 변환한 FormModel 정책을 내보낸다.",
          strict: true,
          parameters: formModelParameters(paths),
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "emit_form_model" } },
  })) as Record<string, unknown>;

  // warnings 분리 + trigger 덮어쓰기.
  const warningsRaw = emitted.warnings;
  delete emitted.warnings;
  forceTrigger(emitted, chosenKey);
  const warnings = Array.isArray(warningsRaw) ? warningsRaw.filter((w): w is string => typeof w === "string") : [];

  return { model: emitted as unknown as FormModel, warnings };
}
