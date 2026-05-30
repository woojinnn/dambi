/**
 * `declarative-decode` unit tests — selector extraction.
 *
 * `decodeBundleCalldata` and all related helpers have been removed; calldata
 * decoding now happens inside WASM via `declarative_route_request_v3_json`.
 * This file retains only the `extractSelector` cases.
 */
import { describe, expect, it } from "vitest";

import { extractSelector } from "../declarative-decode";

describe("extractSelector", () => {
  it("returns lowercased 0x + 8 hex for valid calldata", () => {
    expect(extractSelector("0x38ed1739abcd")).toBe("0x38ed1739");
    expect(extractSelector("0x38ED1739abcd")).toBe("0x38ed1739");
  });

  it("returns null for empty or too-short calldata", () => {
    expect(extractSelector(undefined)).toBeNull();
    expect(extractSelector("")).toBeNull();
    expect(extractSelector("0x")).toBeNull();
    expect(extractSelector("0x1234")).toBeNull();
  });

  it("returns null when 0x prefix missing", () => {
    expect(extractSelector("38ed1739")).toBeNull();
  });
});
