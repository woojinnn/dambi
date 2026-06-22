// @vitest-environment node
//
// mergedBindingParams is pure, so this runs under the `node` environment.
import { describe, expect, it } from "vitest";

import { mergedBindingParams } from "./binding-ir";

// Minimal def/binding shapes — only the fields mergedBindingParams reads.
function def(holes: string[], defaults: Record<string, unknown>) {
  return {
    holes: holes.map((name) => ({ name })),
    defaults: { params: defaults },
  } as never;
}

describe("mergedBindingParams", () => {
  it("binding override wins over the def default (the history-stale-value bug)", () => {
    // Hub default symbols vs the wallet's edited override.
    const merged = mergedBindingParams(
      def(["symbols"], { symbols: ["DOGE", "kPEPE", "kSHIB"] }),
      { params: { symbols: ["DOGE", "BTC"] } } as never,
    );
    expect(merged).toEqual({ symbols: ["DOGE", "BTC"] });
  });

  it("falls back to def defaults when the binding has no override for a hole", () => {
    const merged = mergedBindingParams(
      def(["a", "b"], { a: 1, b: 2 }),
      { params: { a: 9 } } as never,
    );
    expect(merged).toEqual({ a: 9, b: 2 });
  });

  it("uses def defaults only when binding is null", () => {
    const merged = mergedBindingParams(def(["a"], { a: 1 }), null);
    expect(merged).toEqual({ a: 1 });
  });

  it("drops keys that are not live holes (def-default and binding alike)", () => {
    const merged = mergedBindingParams(
      def(["live"], { live: 1, stale: 2 }),
      { params: { live: 3, ghost: 4 } } as never,
    );
    expect(merged).toEqual({ live: 3 });
  });
});
