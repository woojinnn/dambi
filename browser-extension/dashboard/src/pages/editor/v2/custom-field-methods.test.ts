// @vitest-environment node
//
// servedMethodSpecs is a pure transform (served get-method-catalog map ->
// modal MethodSpec list), so it runs under the `node` environment.
import { describe, expect, it } from "vitest";

import { servedMethodSpecs } from "./custom-field-methods";

describe("servedMethodSpecs", () => {
  it("maps a scalar return to its from-projection and mapped type", () => {
    const specs = servedMethodSpecs({
      "token.normalize_to_nano": {
        name: "token.normalize_to_nano",
        description: "normalize",
        params: {
          chain_id: { type: "Long", required: false, defaultSelector: "$.root.chain_id" },
          amount: { type: "String", required: true, defaultSelector: "$.action.amount" },
        },
        returns: { kind: "scalar", type: "Long", from: "$.result.nano" },
      },
    });
    expect(specs).toHaveLength(1);
    const s = specs[0];
    expect(s.method).toBe("token.normalize_to_nano");
    expect(s.projection).toBe("$.result.nano");
    expect(s.type).toBe("Long");
    expect(s.served).toBe(true);
    expect(s.params).toEqual({
      chain_id: "$.root.chain_id",
      amount: "$.action.amount",
    });
  });

  it("uses the curated leaf for a known record return (pool.liquidity)", () => {
    const specs = servedMethodSpecs({
      "pool.liquidity": {
        name: "pool.liquidity",
        params: { venue: { required: true, defaultSelector: "$.action.venue" } },
        returns: { kind: "record", type: "PoolLiquidity" },
      },
    });
    expect(specs[0].projection).toBe("$.result.vol24hUsd");
    expect(specs[0].type).toBe("decimal");
  });

  it("defaults an uncurated record return to $.result + decimal", () => {
    const specs = servedMethodSpecs({
      "some.future_record": {
        name: "some.future_record",
        params: {},
        returns: { kind: "record", type: "FutureThing" },
      },
    });
    expect(specs[0].projection).toBe("$.result");
    expect(specs[0].type).toBe("decimal");
  });

  it("keeps required-no-default params as an empty literal and omits optional-no-default ones", () => {
    const specs = servedMethodSpecs({
      "m.x": {
        name: "m.x",
        params: {
          req: { type: "String", required: true },
          opt: { type: "Long", required: false },
        },
        returns: { kind: "scalar", type: "Bool", from: "$.result.flag" },
      },
    });
    expect(specs[0].params).toEqual({ req: { literal: "" } });
    expect(specs[0].type).toBe("Bool");
  });

  it("sorts methods by name", () => {
    const specs = servedMethodSpecs({
      "z.method": { name: "z.method", params: {}, returns: { kind: "scalar", type: "Long", from: "$.result.v" } },
      "a.method": { name: "a.method", params: {}, returns: { kind: "scalar", type: "Long", from: "$.result.v" } },
    });
    expect(specs.map((s) => s.method)).toEqual(["a.method", "z.method"]);
  });
});
