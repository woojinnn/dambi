/**
 * Cedar `decimal()` 리터럴 형식 유틸.
 *
 * Cedar의 decimal 확장 함수는 소수점이 필수다 — `decimal("3")`은 텍스트
 * 파싱은 통과하지만 엔진이 정책을 설치할 때 스키마 검증(확장 함수 인자
 * 평가)에서 거부되고, 설치 실패는 fail-closed라 모든 요청이 막힌다.
 * 폼 입력 정규화와 저장 시 검증이 같은 규칙을 쓰도록 여기 모아둔다.
 */

import type { Expr, PolicyIR } from "../blocks/ir";

import type { FormModel, FormNode } from "./model";
import { isGroupNode } from "./model";

/** Cedar decimal 리터럴 형식: 소수점 필수, 소수부 1~4자리. */
export const CEDAR_DECIMAL_RE = /^-?\d+\.\d{1,4}$/;

/** 숫자 텍스트를 Cedar decimal 리터럴로 정규화 — `"3"`→`"3.0"`, `"3."`→`"3.0"`,
 *  `".5"`→`"0.5"`. 숫자가 아니거나 소수부가 4자리를 넘으면 null. */
export function normalizeDecimal(raw: string): string | null {
  const m = /^\s*(-?)(\d*)(?:\.(\d*))?\s*$/.exec(raw);
  if (!m) return null;
  const [, sign, intPart, fracPart] = m;
  if (!intPart && !fracPart) return null;
  if ((fracPart ?? "").length > 4) return null;
  return `${sign}${intPart || "0"}.${fracPart || "0"}`;
}

/** IR에서 형식이 잘못된 `decimal("…")` 인자 값을 수집한다(저장 검증용).
 *  홀 노드는 보지 않으므로 concretize된 IR에 거는 것이 안전하다. */
export function findInvalidIrDecimals(ir: PolicyIR): string[] {
  const bad: string[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "ext":
        if (e.fn === "decimal") {
          for (const a of e.args) {
            if (a.kind === "lit" && a.litType === "string" && !CEDAR_DECIMAL_RE.test(String(a.value))) {
              bad.push(String(a.value));
            }
          }
        }
        e.args.forEach(walk);
        break;
      case "binary":
        walk(e.left);
        walk(e.right);
        break;
      case "unary":
        walk(e.operand);
        break;
      case "set":
        e.elements.forEach(walk);
        break;
      case "record":
        e.pairs.forEach((p) => walk(p.value));
        break;
      case "attr":
      case "has":
      case "like":
        walk(e.of);
        break;
      case "is":
        walk(e.of);
        if (e.in) walk(e.in);
        break;
      case "if":
        walk(e.cond);
        walk(e.then);
        walk(e.else);
        break;
      default:
        break; // var/lit/litEntity/raw/hole — 끝 노드
    }
  };
  for (const c of ir.conditions) walk(c.body);
  return bad;
}

/** 폼 모델에서 정규화조차 안 되는 decimal 값을 수집한다(인스턴스 저장 검증용 —
 *  `"3"`처럼 정규화로 고쳐지는 값은 직렬화 경로가 알아서 고치므로 제외). */
export function findInvalidModelDecimals(model: FormModel): string[] {
  const bad: string[] = [];
  const visit = (nodes: FormNode[]): void => {
    for (const n of nodes) {
      if (isGroupNode(n)) visit(n.conds);
      else if (n.value.kind === "decimal" && normalizeDecimal(n.value.value) === null) {
        bad.push(n.value.value);
      }
    }
  };
  visit(model.when);
  visit(model.unless);
  return bad;
}
