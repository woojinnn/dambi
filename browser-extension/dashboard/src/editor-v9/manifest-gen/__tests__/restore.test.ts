// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Expr, PolicyIR } from "../../../cedar/blocks";
import { generateManifest } from "../generate";
import { normalizeCustomType, userFieldsFromManifest } from "../restore";

const CTX_CUSTOM: Expr = {
  kind: "attr",
  of: { kind: "var", name: "context" },
  attr: "custom",
};

function customFieldPolicy(field: string): PolicyIR {
  return {
    kind: "policy",
    effect: "forbid",
    annotations: [
      { name: "id", value: "swap-usd-cap-warn" },
      { name: "severity", value: "warn" },
    ],
    scope: {
      principal: { kind: "scopeAll" },
      action: { kind: "scopeEq", entity: { type: "Amm::Action", id: "Swap" } },
      resource: { kind: "scopeAll" },
    },
    conditions: [
      {
        kind: "when",
        body: {
          kind: "binary",
          op: "&&",
          left: { kind: "has", of: CTX_CUSTOM, attr: field },
          right: {
            kind: "ext",
            fn: "greaterThan",
            args: [
              { kind: "attr", of: CTX_CUSTOM, attr: field },
              { kind: "ext", fn: "decimal", args: [{ kind: "lit", litType: "string", value: "25000.0000" }] },
            ],
          },
        },
      },
    ],
  };
}

describe("userFieldsFromManifest", () => {
  it("restores a market custom field keyed by output.field and Decimal output type", () => {
    const restored = userFieldsFromManifest(
      {
        id: "swap-usd-cap-warn",
        schema_version: 2,
        policy_rpc: [
          {
            id: "swap-in-usd",
            method: "oracle.usd_value",
            params: {
              chain_id: "$.root.chain_id",
              asset: "$.action.tokenIn",
              amount: "$.action.direction.amountIn",
            },
            outputs: [
              {
                kind: "context",
                field: "swapUsd",
                type: "Decimal",
                from: "$.result.usd",
                required: false,
              },
            ],
            optional: true,
          },
        ],
        custom_context: { fields: { swapUsd: "decimal" } },
      },
      "swap",
    );

    expect(restored.swapUsd).toMatchObject({
      type: "decimal",
      appliesTo: ["swap"],
      method: "oracle.usd_value",
      projection: "$.result.usd",
      params: {
        chain_id: "$.root.chain_id",
        asset: "$.action.tokenIn",
        amount: "$.action.direction.amountIn",
      },
    });

    const generated = generateManifest(customFieldPolicy("swapUsd"), restored);
    expect(generated.errors).toEqual([]);
    expect(generated.manifest?.custom_context.fields).toEqual({ swapUsd: "decimal" });
  });

  it("restores output.field even when policy_rpc.id names the call", () => {
    const restored = userFieldsFromManifest(
      {
        policy_rpc: [
          {
            id: "session-fill-stats",
            method: "perp.session_fill_stats",
            outputs: [
              { kind: "context", field: "customLossStreak", type: "Long", from: "$.result.lossStreak" },
            ],
          },
        ],
        custom_context: { fields: { customLossStreak: "Long" } },
      },
      "place_order",
    );

    expect(restored).toHaveProperty("customLossStreak");
    expect(restored).not.toHaveProperty("session-fill-stats");
    expect(restored.customLossStreak.method).toBe("perp.session_fill_stats");
  });
});

describe("normalizeCustomType", () => {
  it("accepts custom_context and output projection spellings", () => {
    expect(normalizeCustomType("decimal")).toBe("decimal");
    expect(normalizeCustomType("Decimal")).toBe("decimal");
    expect(normalizeCustomType("Long")).toBe("Long");
    expect(normalizeCustomType("Bool")).toBe("Bool");
    expect(normalizeCustomType("String")).toBe("String");
    expect(normalizeCustomType("Number")).toBeNull();
  });
});
