import { describe, expect, it } from "vitest";
import { collectPackageMembers } from "./publish-package";
import type { PolicyDef } from "../../../../sdk/policy-store-types";

const def = (id: string, name: string, pkgId?: string): PolicyDef => ({
  id,
  displayName: name,
  skeleton: { ir: {} },
  holes: [],
  defaults: { enabled: true, params: {}, packageId: pkgId },
  source: "mine",
  updatedAtMs: 1,
});

describe("collectPackageMembers", () => {
  it("collects defs whose defaults.packageId matches, name-sorted", () => {
    const defs = {
      a: def("a", "나", "pkg::x"),
      b: def("b", "다"),
      c: def("c", "가", "pkg::x"),
    };
    expect(collectPackageMembers(defs, "pkg::x").map((d) => d.displayName)).toEqual(["가", "나"]);
  });

  it("empty membership → []", () => {
    expect(collectPackageMembers({}, "pkg::x")).toEqual([]);
  });
});
