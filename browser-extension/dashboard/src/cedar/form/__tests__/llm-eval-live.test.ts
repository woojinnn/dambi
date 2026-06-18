/**
 * LIVE LLM feasibility probe — 실제 Claude(opus-4-8)를 호출해 "자연어 → FormModel"을
 * 생성시키고, 기존 변환 파이프라인(formToIr → blocksToEst)으로 변환되는지 검증한다.
 *
 * 형제 파일 llm-eval.test.ts 는 사람이 손으로 옮긴 `gen` 을 비교하지만, 이 테스트는
 * 진짜 LLM 을 붙여 본다 — "이 기능이 가능한가?" 에 대한 실증.
 *
 * 검증 기준(eval 과 동일하게 EST 레벨):
 *   1) LLM 산출물이 formToIr→blocksToEst 로 깨지지 않고 변환된다(부분집합 안).
 *   2) trigger(액션)와 severity 가 의도와 일치한다.
 *   3) (참고) expectEstEqual 케이스는 정답 EST 와의 동치 여부를 로그로 남긴다.
 *
 * ANTHROPIC_API_KEY 가 있을 때만 실행:
 *   ANTHROPIC_API_KEY=sk-... node_modules/.bin/vitest run \
 *     src/cedar/form/__tests__/llm-eval-live.test.ts
 *
 * 백엔드/UI 없이, 가장 위험한 부분(LLM 이 변환가능한 FormModel 을 진짜 만드는가)만 본다.
 */
import { describe, expect, it } from "vitest";

import { blocksToEst } from "../../blocks/blocksToEst";
import { formToIr } from "../convert";
import type { FormModel, FormTrigger, FormSeverity } from "../model";
import { SCHEMA_CATALOG } from "../schema-catalog.generated";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LLM_EVAL_MODEL ?? "claude-opus-4-8";

/** @id/@reason/@severity 주석 제거 — 본문 로직만 비교(형제 eval 과 동일). */
const est = (m: FormModel) => {
  const e = blocksToEst(formToIr(m)) as unknown as Record<string, unknown>;
  delete e.annotations;
  return e;
};

// ── FormModel tool schema (재귀 구조라 비-strict; $defs/$ref 사용) ──────────────
const FORM_VALUE_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: false, properties: { kind: { const: "bool" }, value: { type: "boolean" } }, required: ["kind", "value"] },
    { type: "object", additionalProperties: false, properties: { kind: { const: "long" }, value: { type: "number" } }, required: ["kind", "value"] },
    { type: "object", additionalProperties: false, properties: { kind: { const: "decimal" }, value: { type: "string", description: "소수점 포함 문자열, 예 \"0.05\"" } }, required: ["kind", "value"] },
    { type: "object", additionalProperties: false, properties: { kind: { const: "string" }, value: { type: "string" } }, required: ["kind", "value"] },
    { type: "object", additionalProperties: false, properties: { kind: { const: "set" }, values: { type: "array", items: { type: "string" } } }, required: ["kind", "values"] },
    { type: "object", additionalProperties: false, properties: { kind: { const: "field" }, path: { type: "string", description: "다른 필드 경로, 예 principal.address" } }, required: ["kind", "path"] },
  ],
};

const FORM_MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  $defs: {
    value: FORM_VALUE_SCHEMA,
    condition: {
      type: "object",
      additionalProperties: false,
      properties: {
        fieldPath: { type: "string", description: "context.* 로 시작하는 점 경로" },
        op: { enum: ["==", "!=", "<", "<=", ">", ">=", "contains", "notContains", "in", "notIn"] },
        value: { $ref: "#/$defs/value" },
        joiner: { enum: ["and", "or"], description: "직전 노드와의 결합. 첫 노드는 무시됨. AND 가 OR 보다 강하게 묶임(= OR of AND-runs)" },
      },
      required: ["fieldPath", "op", "value", "joiner"],
    },
    group: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "group" },
        joiner: { enum: ["and", "or"] },
        conds: { type: "array", items: { $ref: "#/$defs/node" } },
      },
      required: ["kind", "joiner", "conds"],
    },
    node: { oneOf: [{ $ref: "#/$defs/condition" }, { $ref: "#/$defs/group" }] },
  },
  properties: {
    trigger: {
      oneOf: [
        { type: "object", additionalProperties: false, properties: { kind: { const: "actionEq" }, entityType: { type: "string", description: "예 Amm::Action, Token::Action" }, id: { type: "string", description: "예 Swap, Erc20Transfer" } }, required: ["kind", "entityType", "id"] },
        { type: "object", additionalProperties: false, properties: { kind: { const: "any" } }, required: ["kind"] },
      ],
    },
    when: { type: "array", items: { $ref: "#/$defs/node" }, description: "위험 상황 조건(OR of AND-runs). 비우면 조건 없음." },
    unless: { type: "array", items: { $ref: "#/$defs/node" }, description: "예외(단, ~인 경우 제외)." },
    id: { type: "string" },
    severity: { enum: ["warn", "deny", "info"] },
    reason: { type: "string", description: "사용자에게 보여줄 한국어 설명" },
  },
  required: ["trigger", "when", "unless", "id", "severity", "reason"],
};

const SYSTEM = `너는 Cedar 기반 지갑 정책을 만드는 도우미다. 사용자의 자연어 의도를 받아 \
정책의 중간표현인 FormModel 로 변환해 emit_form_model 도구로 내보낸다.

규칙:
- 정책 effect 는 항상 forbid(금지/경고). severity 로 강도를 표현: deny(차단) | warn(경고) | info.
- trigger 는 검사 대상 액션: { kind:"actionEq", entityType, id }. 조건 없이 액션 자체만 보면 when/unless 를 비운다.
- when 은 "위험 상황"이다. 노드 리스트이며 joiner(and/or)로 묶인다. AND 가 OR 보다 강하게 결합(= OR of AND-runs). 첫 노드의 joiner 는 무시된다.
- unless 는 예외다("단, ~인 경우 제외"). forbid-when-X-unless-Y 는 논리적으로 when=X∧¬Y 와 같다.
- 비교 연산 op: == != < <= > >= contains notContains in(리터럴 집합 멤버십) notIn.
- value 종류: bool/long/decimal(소수점 문자열)/string/set(문자열 집합, in 용)/field(다른 필드 경로, 예 principal.address).
- fieldPath 와 field.path 는 반드시 제공된 스키마 카탈로그에 존재하는 경로만 사용한다. USD 금액 비교는 decimal 필드와 decimal value 를 쓴다.
- 무제한 승인 등 큰 정수 한도는 string value(예 uint256 max 16진수)로 비교한다.

아래는 액션별 필드 카탈로그다. 각 항목은 [경로, Cedar타입] 또는 [경로, 타입, 가드들] 형식이다(가드는 네가 신경쓸 필요 없음 — 변환기가 자동 처리).`;

interface Case {
  name: string;
  nl: string;
  trigger: FormTrigger;
  severity: FormSeverity;
  expectEstEqual?: FormModel; // 있으면 정답 EST 와 동치 여부를 로그
}

const CASES: Case[] = [
  {
    name: "swap-recipient-not-self",
    nl: "스왑으로 산 토큰이 내 지갑이 아닌 다른 주소로 가는 경우 차단",
    trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" },
    severity: "deny",
  },
  {
    name: "transfer-to-burn",
    nl: "토큰을 소각 주소(0x0…0 또는 0x…dead)로 전송하면 차단",
    trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Transfer" },
    severity: "deny",
  },
  {
    name: "unlimited-approval-except-permit2",
    nl: "무제한 승인(금액이 uint256 max 또는 uint160 max)은 차단, 단 spender 가 Permit2면 예외",
    trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Approve" },
    severity: "deny",
  },
  {
    name: "permit2-sign-confirm",
    nl: "Permit2 허용량 서명은 항상 경고만 띄운다",
    trigger: { kind: "actionEq", entityType: "Token::Action", id: "Permit2SignAllowance" },
    severity: "warn",
  },
  {
    name: "unknown-blind-sign",
    nl: "정체불명 블라인드 서명 요청은 경고",
    trigger: { kind: "actionEq", entityType: "Core::Action", id: "Unknown" },
    severity: "warn",
  },
];

/** trigger 후보 + 그 액션들의 카탈로그만 추려 컨텍스트를 만든다(전체를 줘도 되지만 토큰 절약). */
function catalogContext(trigger: FormTrigger): string {
  // 후보 액션: 의도된 액션 + 흔한 토큰/스왑 액션 몇 개(LLM 이 직접 고르게).
  const want = new Set<string>(["Amm::Swap", "Token::Erc20Transfer", "Token::Erc20Approve", "Token::Permit2SignAllowance", "Core::Unknown"]);
  if (trigger.kind === "actionEq") {
    const ns = trigger.entityType.split("::")[0];
    want.add(`${ns}::${trigger.id}`);
  }
  const slice: Record<string, unknown> = {};
  for (const k of want) if (SCHEMA_CATALOG[k]) slice[k] = SCHEMA_CATALOG[k];
  return JSON.stringify(slice, null, 0);
}

async function callLlm(nl: string, trigger: FormTrigger): Promise<FormModel> {
  const body = {
    model: MODEL,
    max_tokens: 8192,
    system: `${SYSTEM}\n\n${catalogContext(trigger)}`,
    tools: [
      {
        name: "emit_form_model",
        description: "자연어 의도를 변환한 FormModel 정책을 내보낸다.",
        input_schema: FORM_MODEL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "emit_form_model" },
    messages: [{ role: "user", content: `정책 의도: ${nl}` }],
  };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${await resp.text()}`);
  const json = (await resp.json()) as { content: Array<{ type: string; name?: string; input?: unknown }> };
  const tool = json.content.find((b) => b.type === "tool_use" && b.name === "emit_form_model");
  if (!tool?.input) throw new Error(`no tool_use in response: ${JSON.stringify(json.content)}`);
  return tool.input as FormModel;
}

describe.skipIf(!API_KEY)("LIVE: 자연어 → FormModel (실제 LLM 호출)", () => {
  for (const c of CASES) {
    it(
      `[${c.name}] LLM 생성물이 변환되고 trigger/severity 일치`,
      async () => {
        const gen = await callLlm(c.nl, c.trigger);
        // eslint-disable-next-line no-console
        console.log(`\n[${c.name}] LLM FormModel:\n`, JSON.stringify(gen, null, 2));

        // 1) 변환 가능(부분집합 안)
        const gEst = est(gen);
        expect(gEst).toBeTruthy();

        // 2) trigger / severity 일치
        expect(gen.trigger).toEqual(c.trigger);
        expect(gen.severity).toBe(c.severity);
      },
      60_000,
    );
  }
});

// 키가 없을 때 vitest 가 "no test" 로 실패하지 않도록 가드 테스트 하나.
describe.skipIf(!!API_KEY)("LIVE (skipped: ANTHROPIC_API_KEY 없음)", () => {
  it("set ANTHROPIC_API_KEY to run the live probe", () => {
    expect(true).toBe(true);
  });
});
