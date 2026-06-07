import { describe, expect, it } from "vitest";

import { lowercaseAddressLiterals } from "../annotations";

describe("lowercaseAddressLiterals", () => {
  it("lowercases a checksum-cased address literal (the WETH bug)", () => {
    const text = `when { x == "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }`;
    expect(lowercaseAddressLiterals(text)).toBe(
      `when { x == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" }`,
    );
  });

  it("normalises every member of a `contains` allow/deny list", () => {
    const text = `["0xA0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"].contains(a)`;
    expect(lowercaseAddressLiterals(text)).toBe(
      `["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"].contains(a)`,
    );
  });

  it("normalises an upper-case `0X` prefix too", () => {
    expect(lowercaseAddressLiterals(`"0XABCDEF0123456789abcdef0123456789ABCDEF01"`)).toBe(
      `"0xabcdef0123456789abcdef0123456789abcdef01"`,
    );
  });

  it("leaves a 32-byte hash (64 hex) and a 4-byte selector (8 hex) untouched", () => {
    const hash = `"0xAABBCCDDEEFF00112233445566778899AABBCCDDEEFF001122334455667788AA"`; // 64 hex
    const selector = `"0xA9059CBB"`; // 8 hex
    expect(lowercaseAddressLiterals(hash)).toBe(hash);
    expect(lowercaseAddressLiterals(selector)).toBe(selector);
  });

  it("leaves an already-lowercase address and non-address text unchanged", () => {
    const text = `when { token == "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" && memo == "Hello" }`;
    expect(lowercaseAddressLiterals(text)).toBe(text);
  });
});
