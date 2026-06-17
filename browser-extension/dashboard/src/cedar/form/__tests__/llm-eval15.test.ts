/**
 * LLM 확장 eval — 15개 실제 정책(필드 메뉴 완전 커버된 풀)에 대한 블라인드 생성 채점.
 *
 * 정답(truth)은 real-policies-est.json 픽스처에서 estToBlocks→irToForm 으로 즉석 로드(손 복사 0).
 * gen 은 정답 Cedar 를 모르는 서브에이전트가 스키마 메뉴+자연어만 보고 생성한 결과.
 * 비교: blocksToEst(formToIr(model)) 의 @주석 제거본을 (1) 원본 (2) decimal 정규화 후 deep-equal.
 *
 * 실행: node_modules/.bin/vitest run src/cedar/form/__tests__/llm-eval15.test.ts
 */
import { describe, expect, it } from "vitest";

import { blocksToEst } from "../../blocks/blocksToEst";
import fixtures from "../../blocks/__tests__/fixtures/real-policies-est.json";
import { estToBlocks } from "../../blocks/estToBlocks";
import { formToIr, irToForm } from "../convert";
import type { FormModel, FormNode } from "../model";
import { isGroupNode } from "../model";

const byName = new Map((fixtures as { name: string; est: unknown }[]).map((p) => [p.name, p.est]));
function truthOf(name: string): FormModel {
  const ir = estToBlocks(byName.get(name) as never, null as never);
  const f = irToForm((Array.isArray(ir) ? ir[0] : ir) as never);
  if (!f) throw new Error(`truth ${name} not representable`);
  return f;
}

/** decimal 값을 수치 정규화("0.0500"→"0.05", "150.0000"→"150") 한 복제본. */
function normDecimals(nodes: FormNode[]): FormNode[] {
  return nodes.map((n): FormNode => {
    if (isGroupNode(n)) return { ...n, conds: normDecimals(n.conds) };
    if (n.value.kind === "decimal") return { ...n, value: { kind: "decimal", value: String(Number(n.value.value)) } };
    return n;
  });
}
const norm = (m: FormModel): FormModel => ({ ...m, when: normDecimals(m.when), unless: normDecimals(m.unless) });

function estOf(m: FormModel): Record<string, unknown> {
  const e = blocksToEst(formToIr(m)) as unknown as Record<string, unknown>;
  delete e.annotations;
  return e;
}

interface GenCase {
  name: string;
  gen: FormModel;
  /** EST 비동치지만 논리 동치로 사전 판정한 케이스(unless 변환 등). */
  logicalEquiv?: boolean;
}

// ── 블라인드 서브에이전트 15개 생성 결과(원본 그대로) ──────────────────
const CASES: GenCase[] = [
  { name: "swap-slippage-high-warn", gen: { trigger: { kind: "actionEq", entityType: "Amm::Action::Swap", id: "swap" }, when: [{ fieldPath: "context.slippageBp", op: ">", value: { kind: "long", value: 300 }, joiner: "and" }], unless: [], id: "x", severity: "warn", reason: "" } },
  { name: "swap-min-usd-cap-deny", gen: { trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" }, when: [{ fieldPath: "context.custom.inputUsd", op: ">=", value: { kind: "decimal", value: "0.05" }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  { name: "swap-usdc-input-deny", gen: { trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" }, when: [{ fieldPath: "context.tokenIn.key.address", op: "in", value: { kind: "set", values: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0x0b2c639c533813f4aa9d7837caf62653d097ff85", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"] }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  { name: "values-recipient-denylist-deny", gen: { trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" }, when: [{ fieldPath: "context.recipient", op: "in", value: { kind: "set", values: ["0x000000000000000000000000000000000000dead", "0x00000000000000000000000000000000deadbeef"] }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  { name: "gas-cost-usd-cap-deny", gen: { trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" }, when: [{ fieldPath: "context.custom.gasCostUsd", op: ">", value: { kind: "decimal", value: "150" }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  { name: "bridge-recipient-not-self-deny", gen: { trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Transfer" }, when: [{ fieldPath: "context.recipient", op: "!=", value: { kind: "field", path: "principal.address" }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  { name: "holding-pct-outflow-warn", gen: { trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Transfer" }, when: [{ fieldPath: "context.custom.pctOfHolding", op: ">", value: { kind: "decimal", value: "90" }, joiner: "and" }], unless: [], id: "x", severity: "warn", reason: "" } },
  // unless-트릭: 논리 동치
  { name: "unlimited-approval-deny", logicalEquiv: true, gen: { trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Approve" }, when: [{ fieldPath: "context.custom.approvalIsUnlimited", op: "==", value: { kind: "bool", value: true }, joiner: "and" }], unless: [{ fieldPath: "context.spender", op: "==", value: { kind: "string", value: "0x000000000022d473030f116ddee9f6b43ac78ba3" }, joiner: "and" }], id: "x", severity: "deny", reason: "" } },
  // 명백한 실패: 잘못된 필드(alreadyGranted) + 잘못된 값(field/no-path) + OR 누락
  { name: "increase-allowance-cap-warn", gen: { trigger: { kind: "actionEq", entityType: "Token::Action", id: "Erc20Approve" }, when: [{ fieldPath: "context.custom.alreadyGranted", op: "==", value: { kind: "bool", value: true }, joiner: "and" }, { fieldPath: "context.custom.resultingAllowanceOverBalance", op: ">", value: { kind: "field", path: "context.amountUsd" }, joiner: "and" }], unless: [], id: "x", severity: "warn", reason: "" } },
  { name: "aave-frozen-paused-supply-deny", gen: { trigger: { kind: "actionEq", entityType: "Lending::Action", id: "Supply" }, when: [{ fieldPath: "context.reserveState.isFrozen", op: "==", value: { kind: "bool", value: true }, joiner: "and" }, { fieldPath: "context.reserveState.isPaused", op: "==", value: { kind: "bool", value: true }, joiner: "or" }], unless: [], id: "x", severity: "deny", reason: "" } },
  // 트리거 포맷 버그 + unless-트릭
  { name: "hl-no-short-perp", logicalEquiv: true, gen: { trigger: { kind: "actionEq", entityType: "Perp::Action::PlaceOrder", id: "PlaceOrder" }, when: [{ fieldPath: "context.venue.name", op: "==", value: { kind: "string", value: "hyperliquid" }, joiner: "and" }, { fieldPath: "context.side", op: "==", value: { kind: "string", value: "short" }, joiner: "and" }], unless: [{ fieldPath: "context.reduceOnly", op: "==", value: { kind: "bool", value: true }, joiner: "and" }], id: "x", severity: "deny", reason: "" } },
  { name: "perp-leverage-cap-deny", gen: { trigger: { kind: "actionEq", entityType: "Perp::Action", id: "OpenPosition" }, when: [{ fieldPath: "context.custom.orderLeverage", op: ">", value: { kind: "decimal", value: "10" }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  // unless-트릭(in 형태)
  { name: "nft-setapprovalforall-conduit-warn", logicalEquiv: true, gen: { trigger: { kind: "actionEq", entityType: "Token::Action", id: "NftSetApprovalForAll" }, when: [{ fieldPath: "context.approved", op: "==", value: { kind: "bool", value: true }, joiner: "and" }], unless: [{ fieldPath: "context.spender", op: "in", value: { kind: "set", values: ["0x1e0049783f008a0085193e00003d00cd54003c71", "0x00000000000111abe46ff893f3b2fdf1f759a8a8"] }, joiner: "and" }], id: "x", severity: "warn", reason: "" } },
  { name: "lp-commit-platform-allowlist-deny", gen: { trigger: { kind: "actionEq", entityType: "Launchpad::Action", id: "Commit" }, when: [{ fieldPath: "context.platform.name", op: "notIn", value: { kind: "set", values: ["coinlist", "fjord", "pinksale"] }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
  { name: "air-recipient-not-self-deny", gen: { trigger: { kind: "actionEq", entityType: "Airdrop::Action", id: "Claim" }, when: [{ fieldPath: "context.recipient", op: "!=", value: { kind: "field", path: "principal.address" }, joiner: "and" }], unless: [], id: "x", severity: "deny", reason: "" } },
];

describe("LLM eval15", () => {
  const board: string[] = [];
  for (const c of CASES) {
    it(c.name, () => {
      const truth = truthOf(c.name);
      const trigEq = JSON.stringify(c.gen.trigger) === JSON.stringify(truth.trigger);
      const sevEq = c.gen.severity === truth.severity;
      let estExact = false;
      let estNorm = false;
      let err = "";
      try {
        estExact = JSON.stringify(estOf(c.gen)) === JSON.stringify(estOf(truth));
        estNorm = JSON.stringify(estOf(norm(c.gen))) === JSON.stringify(estOf(norm(truth)));
      } catch (e) {
        err = (e as Error).message.slice(0, 40);
      }
      const verdict = err ? `INVALID(${err})` : estExact ? "EXACT" : estNorm ? "NORM≈" : c.logicalEquiv ? "LOGIC~" : !trigEq ? "TRIGGER✗" : "FIELD✗";
      board.push(`${c.name.padEnd(38)} trig:${trigEq ? "✓" : "✗"} sev:${sevEq ? "✓" : "✗"} → ${verdict}`);
    });
  }
  it("scoreboard", () => {
    console.log("\n========== LLM eval15 scoreboard ==========");
    for (const l of board) console.log(l);
    console.log("===========================================\n");
    expect(board.length).toBe(CASES.length);
  });
});
