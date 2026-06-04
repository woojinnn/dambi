import { describe, it, expect } from "vitest";
import type { PolicyIR, Expr } from "../../blocks/ir";
import { buildProbes } from "../probes";

const forbidSlippage: PolicyIR = {
  kind: "policy", effect: "forbid", annotations: [{ name: "id", value: "p" }],
  scope: { principal: { kind: "scopeAll" }, action: { kind: "scopeAll" }, resource: { kind: "scopeAll" } },
  conditions: [{ kind: "when", body: {
    kind: "binary", op: ">",
    left: { kind: "attr", of: { kind: "var", name: "context" }, attr: "slippageBp" },
    right: { kind: "lit", litType: "long", value: 100 },
  } as Expr }],
};

describe("buildProbes", () => {
  it("emits one probe per boolean node (the whole when body here)", () => {
    const { probes } = buildProbes(forbidSlippage);
    const ids = probes.map((p) => p.id);
    expect(ids).toContain("c0.body");        // the when-clause body (boolean)
    // the leaf comparison IS the body here, so c0.body is the comparison node
    expect(probes.every((p) => (p.est as any).effect === "permit")).toBe(true);
    // pin the exact unconstrained-permit shape the Rust runner consumes
    expect(probes.every((p) => (p.est as any).principal.op === "All")).toBe(true);
    // each probe est carries its @id annotation
    const body = probes.find((p) => p.id === "c0.body")!;
    expect((body.est as any).annotations.id).toBe("c0.body");
  });

  it("does NOT probe non-boolean nodes (the Long attr / the literal)", () => {
    const { probes } = buildProbes(forbidSlippage);
    const ids = probes.map((p) => p.id);
    expect(ids).not.toContain("c0.body.left");   // context.slippageBp is a Long
    expect(ids).not.toContain("c0.body.right");  // 100 is a Long
  });
});
