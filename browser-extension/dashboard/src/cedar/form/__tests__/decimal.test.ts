import { describe, expect, it } from "vitest";

import type { PolicyIR } from "../../blocks/ir";
import { formToIr } from "../convert";
import { findInvalidIrDecimals, findInvalidModelDecimals, normalizeDecimal } from "../decimal";
import type { FormModel } from "../model";

describe("normalizeDecimal", () => {
  it("정수에 소수점을 붙인다 — Cedar decimal은 소수점 필수", () => {
    expect(normalizeDecimal("3")).toBe("3.0");
    expect(normalizeDecimal("-3")).toBe("-3.0");
    expect(normalizeDecimal("3.")).toBe("3.0");
    expect(normalizeDecimal(".5")).toBe("0.5");
    expect(normalizeDecimal(" 3 ")).toBe("3.0");
  });

  it("이미 유효한 값은 그대로", () => {
    expect(normalizeDecimal("0.05")).toBe("0.05");
    expect(normalizeDecimal("3.0")).toBe("3.0");
    expect(normalizeDecimal("1.2345")).toBe("1.2345");
  });

  it("숫자가 아니거나 소수부 5자리 이상이면 null", () => {
    expect(normalizeDecimal("abc")).toBeNull();
    expect(normalizeDecimal("")).toBeNull();
    expect(normalizeDecimal(".")).toBeNull();
    expect(normalizeDecimal("-")).toBeNull();
    expect(normalizeDecimal("1.23456")).toBeNull();
    expect(normalizeDecimal("1,5")).toBeNull();
  });
});

const decimalModel = (value: string): FormModel => ({
  trigger: { kind: "actionEq", entityType: "Amm::Action", id: "Swap" },
  when: [
    {
      fieldPath: "context.custom.inputUsd",
      op: ">",
      value: { kind: "decimal", value },
      joiner: "and",
    },
  ],
  unless: [],
  id: "p1",
  severity: "deny",
  reason: "테스트",
});

describe("findInvalidIrDecimals", () => {
  it("decimal(\"3\") 같은 잘못된 리터럴을 IR에서 찾는다", () => {
    const ir: PolicyIR = {
      kind: "policy",
      effect: "forbid",
      annotations: [],
      scope: {
        principal: { kind: "scopeAll" },
        action: { kind: "scopeAll" },
        resource: { kind: "scopeAll" },
      },
      conditions: [
        {
          kind: "when",
          body: {
            kind: "binary",
            op: "&&",
            left: { kind: "lit", litType: "bool", value: true },
            right: {
              kind: "ext",
              fn: "greaterThan",
              args: [
                { kind: "attr", of: { kind: "var", name: "context" }, attr: "amt" },
                {
                  kind: "ext",
                  fn: "decimal",
                  args: [{ kind: "lit", litType: "string", value: "3" }],
                },
              ],
            },
          },
        },
      ],
    };
    expect(findInvalidIrDecimals(ir)).toEqual(["3"]);
  });

  it("폼 직렬화는 \"3\"을 \"3.0\"으로 고쳐서 IR에 잘못된 decimal이 남지 않는다", () => {
    const ir = formToIr(decimalModel("3"));
    expect(findInvalidIrDecimals(ir)).toEqual([]);
    expect(JSON.stringify(ir)).toContain('"3.0"');
  });
});

describe("findInvalidModelDecimals", () => {
  it("정규화로 못 고치는 값만 걸린다", () => {
    expect(findInvalidModelDecimals(decimalModel("3"))).toEqual([]);
    expect(findInvalidModelDecimals(decimalModel("abc"))).toEqual(["abc"]);
  });
});
