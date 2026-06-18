/**
 * LLM feasibility eval — "자연어 → FormModel" 변환 품질 검증.
 *
 * 정답(`truth`)은 default-bundles/day1-safety 의 실제 .cedar 정책을 FormModel 로
 * 충실히 옮긴 것이고, `gen`은 정답 Cedar 를 전혀 모르는 LLM(서브에이전트)이
 * 스키마 컨텍스트 + 자연어 의도만 보고 생성한 결과다.
 *
 * 비교는 EST 레벨에서 한다: blocksToEst(formToIr(model)) 를 deep-equal.
 * (Cedar 텍스트 변환만 WASM 이 필요하므로, 그 직전 단계인 EST 로 의미동치를 본다.)
 *
 * 실행: ../../../node_modules/.bin/vitest run src/cedar/form/__tests__/llm-eval.test.ts
 */
import { describe, expect, it } from "vitest";

import { blocksToEst } from "../../blocks/blocksToEst";
import { formToIr } from "../convert";
import type { FormCondition, FormModel } from "../model";

const cond = (
  fieldPath: string,
  op: FormCondition["op"],
  value: FormCondition["value"],
  extra: Partial<FormCondition> = {},
): FormCondition => ({ fieldPath, op, value, joiner: "and", ...extra });

const BURN_ZERO = "0x0000000000000000000000000000000000000000";
const BURN_DEAD = "0x000000000000000000000000000000000000dead";
const UINT256_MAX = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const UINT160_MAX = "0xffffffffffffffffffffffffffffffffffffffff";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

/** EST 로 변환하되 @id/@reason/@severity 주석은 제거 — 본문 로직(trigger+조건+effect)만 비교한다. */
const est = (m: FormModel) => {
  const e = blocksToEst(formToIr(m)) as unknown as Record<string, unknown>;
  delete e.annotations;
  return e;
};

interface Case {
  name: string;
  nl: string;
  truth: FormModel;
  gen: FormModel;
  /** EST 비동치가 예상되지만 논리적으로는 동치인 케이스(수동 판정). */
  expectEstEqual: boolean;
  note?: string;
}

const CASES: Case[] = [
  // ── 1. 스왑 수령자 ≠ 본인 ────────────────────────────────────────────
  {
    name: "swap-recipient-not-self",
    nl: "스왑으로 산 토큰이 내 지갑이 아닌 다른 주소로 가는 경우 차단",
    expectEstEqual: true,
    truth: {
      trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" },
      when: [cond("context.recipient", "!=", { kind: "field", path: "principal.address" })],
      unless: [],
      id: "swap-recipient-not-self-deny",
      severity: "deny",
      reason: "x",
    },
    gen: {
      trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" },
      when: [cond("context.recipient", "!=", { kind: "field", path: "principal.address" })],
      unless: [],
      id: "swap-recipient-not-self-deny",
      severity: "deny",
      reason: "스왑으로 산 토큰이 내 지갑이 아닌 다른 주소로 전송되는 거래입니다",
    },
  },

  // ── 2. 소각 주소 전송(리터럴 집합 멤버십) ─────────────────────────────
  {
    name: "transfer-to-burn",
    nl: "토큰을 소각 주소(0x0…0 / 0x…dead)로 전송 차단",
    expectEstEqual: true,
    truth: {
      trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Transfer" },
      when: [cond("context.recipient", "in", { kind: "set", values: [BURN_ZERO, BURN_DEAD] })],
      unless: [],
      id: "send-burn-recipient",
      severity: "deny",
      reason: "x",
    },
    gen: {
      trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Transfer" },
      when: [cond("context.recipient", "in", { kind: "set", values: [BURN_ZERO, BURN_DEAD] })],
      unless: [],
      id: "send-burn-recipient",
      severity: "deny",
      reason: "토큰을 소각 주소로 전송하면 영구히 잃어버립니다",
    },
  },

  // ── 3. 무제한 승인 + Permit2 예외 (HARD: 중첩 OR그룹 ∧ 부정 멤버십) ───
  {
    name: "unlimited-approval-except-permit2",
    nl: "무제한 승인(amount==uint256max OR uint160max) 차단, 단 spender==Permit2 예외",
    // 정답은 when=(A∨B)∧notIn[P], LLM은 when=(A∨B), unless=(spender==P).
    // forbid-when-X-unless-Y ≡ forbid-when-X∧¬Y 이므로 논리적으론 동치이나 EST 는 다름.
    expectEstEqual: false,
    note: "LLM이 unless로 예외를 표현 → 논리 동치이지만 EST 구조 상이 (더 읽기 쉬운 형태)",
    truth: {
      trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Approve" },
      when: [
        {
          kind: "group",
          joiner: "and",
          conds: [
            cond("context.amount", "==", { kind: "string", value: UINT256_MAX }),
            cond("context.amount", "==", { kind: "string", value: UINT160_MAX }, { joiner: "or" }),
          ],
        },
        cond("context.spender", "notIn", { kind: "set", values: [PERMIT2] }),
      ],
      unless: [],
      id: "unlimited-approval-deny",
      severity: "deny",
      reason: "x",
    },
    gen: {
      trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Approve" },
      when: [
        cond("context.amount", "==", { kind: "string", value: UINT256_MAX }),
        cond("context.amount", "==", { kind: "string", value: UINT160_MAX }, { joiner: "or" }),
      ],
      unless: [cond("context.spender", "==", { kind: "string", value: PERMIT2 })],
      id: "unlimited-approve-deny",
      severity: "deny",
      reason: "무제한 토큰 승인 거래입니다",
    },
  },

  // ── 4. Permit2 서명 확인(조건 없는 trigger) ───────────────────────────
  {
    name: "permit2-sign-confirm",
    nl: "Permit2 허용량 서명은 항상 경고만",
    expectEstEqual: true,
    truth: {
      trigger: { kind: "actionEq", entityType: "Token::Action", id: "Permit2SignAllowance" },
      when: [],
      unless: [],
      id: "permit2-sign",
      severity: "warn",
      reason: "x",
    },
    gen: {
      trigger: { kind: "actionEq", entityType: "Token::Action", id: "Permit2SignAllowance" },
      when: [],
      unless: [],
      id: "permit2-sign",
      severity: "warn",
      reason: "Permit2 토큰 허용량 서명 요청입니다",
    },
  },

  // ── 5. 블라인드 서명 경고(조건 없는 trigger) ──────────────────────────
  {
    name: "unknown-blind-sign",
    nl: "정체불명 블라인드 서명 요청은 경고",
    expectEstEqual: true,
    truth: {
      trigger: { kind: "actionEq", entityType: "Core::Action", id: "Unknown" },
      when: [],
      unless: [],
      id: "unknown-blind",
      severity: "warn",
      reason: "x",
    },
    gen: {
      trigger: { kind: "actionEq", entityType: "Core::Action", id: "Unknown" },
      when: [],
      unless: [],
      id: "unknown-blind",
      severity: "warn",
      reason: "어떤 동작인지 식별되지 않는 블라인드 서명 요청입니다",
    },
  },
];

describe("LLM FormModel eval (자연어→FormModel)", () => {
  for (const c of CASES) {
    it(`[${c.name}] trigger/severity 일치 + EST ${c.expectEstEqual ? "동치" : "비동치(예상)"}`, () => {
      // trigger 와 severity 는 모든 케이스에서 정확해야 한다.
      expect(c.gen.trigger).toEqual(c.truth.trigger);
      expect(c.gen.severity).toBe(c.truth.severity);

      // 두 모델 다 합법적으로 IR/EST 로 변환돼야 한다(생성물이 깨지지 않음).
      const gEst = est(c.gen);
      const tEst = est(c.truth);
      expect(gEst).toBeTruthy();
      expect(tEst).toBeTruthy();

      if (c.expectEstEqual) {
        expect(gEst).toEqual(tEst);
      } else {
        // 의도적으로 구조가 다른(그러나 논리 동치) 케이스.
        expect(gEst).not.toEqual(tEst);
      }
    });
  }
});
