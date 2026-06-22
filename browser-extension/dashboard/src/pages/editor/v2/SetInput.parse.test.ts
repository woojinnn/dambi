// @vitest-environment node
//
// parseSet is pure (no DOM), so this runs under the `node` environment — which
// keeps it executable even where the local vitest+jsdom worker is flaky. The
// DOM round-trip regression (the comma-eats-itself bug) lives in SetInput.test.tsx.
import { describe, expect, it } from "vitest";

import { parseSet } from "./SetInput";

describe("parseSet", () => {
  it("trims, drops empties, keeps order", () => {
    expect(parseSet("DOGE, kPEPE,  kSHIB ")).toEqual(["DOGE", "kPEPE", "kSHIB"]);
  });

  it("drops the empty tail of a trailing comma (model stays clean)", () => {
    expect(parseSet("DOGE,")).toEqual(["DOGE"]);
    expect(parseSet("DOGE, ")).toEqual(["DOGE"]);
  });

  it("returns [] for empty / whitespace-only input", () => {
    expect(parseSet("")).toEqual([]);
    expect(parseSet("   ")).toEqual([]);
    expect(parseSet(",")).toEqual([]);
  });

  it("documents the old bug: normalizing then re-joining loses a trailing comma", () => {
    // The old input rendered `value={parseSet(raw).join(\", \")}`, so a trailing
    // comma round-tripped away on the same keystroke. SetInput renders the raw
    // draft instead, which is why the comma now survives (see SetInput.test.tsx).
    expect(parseSet("DOGE,").join(", ")).toBe("DOGE");
  });
});
