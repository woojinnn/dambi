import { describe, expect, it } from "vitest";

import { extractHoles, redactCedar } from "../publish-redact";

const RECIPIENT = `@id("recipient-blocklist-deny")
forbid(principal, action, resource)
when { context.recipient == "0xA1c4000000000000000000000000000000007e29" };`;

const ALLOWLIST = `@id("gov-delegatee-allowlist-deny")
forbid(principal, action, resource)
when { ["0x91d2000000000000000000000000000000000001", "0x44ab000000000000000000000000000000000002"].contains(context.delegatee) };`;

const SLIPPAGE = `@id("swap-slippage-wide-warn")
forbid(principal, action, resource)
when { context.slippageBp >= 150 };`;

describe("extractHoles", () => {
  it("finds a literal address comparison and blanks it (forced)", () => {
    const holes = extractHoles(RECIPIENT);
    const addr = holes.find((h) => h.kind === "address");
    expect(addr).toBeTruthy();
    expect(addr!.path).toBe("context.recipient");
    expect(addr!.paramName).toBe("?recipient");
    const out = redactCedar(RECIPIENT, holes, new Set());
    expect(out).not.toContain("0xA1c4000000000000000000000000000000007e29");
  });

  it("finds an address set behind .contains()", () => {
    const holes = extractHoles(ALLOWLIST);
    const addr = holes.find((h) => h.kind === "address");
    expect(addr).toBeTruthy();
    expect(addr!.addrCount).toBe(2);
    expect(addr!.path).toBe("context.delegatee");
  });

  it("finds a numeric threshold with its value", () => {
    const holes = extractHoles(SLIPPAGE);
    const num = holes.find((h) => h.kind === "number");
    expect(num).toBeTruthy();
    expect(num!.display).toBe("150");
  });

  it("redacts addresses always; keeps a number only when chosen", () => {
    const holes = extractHoles(SLIPPAGE);
    const num = holes.find((h) => h.kind === "number")!;

    const kept = redactCedar(SLIPPAGE, holes, new Set([num.key]));
    expect(kept).toContain("150"); // author kept the recommended value

    const blanked = redactCedar(SLIPPAGE, holes, new Set());
    expect(blanked).not.toContain("150"); // blanked to 0
    expect(blanked).toContain("context.slippageBp >= 0");
  });

  it("blanks a real address to the zero address", () => {
    const holes = extractHoles(ALLOWLIST);
    const out = redactCedar(ALLOWLIST, holes, new Set());
    expect(out).not.toContain("0x91d2000000000000000000000000000000000001");
  });

  it("finds an address literal inside attr.contains(...) (form contains/notContains)", () => {
    const cedar = `@id("p")
forbid(principal, action, resource)
when { !(context.path.contains("0x7a3f000000000000000000000000000000009c21")) };`;
    const holes = extractHoles(cedar);
    const addr = holes.find((h) => h.kind === "address");
    expect(addr).toBeTruthy();
    expect(addr!.path).toBe("context.path");
    const out = redactCedar(cedar, holes, new Set());
    expect(out).not.toContain("0x7a3f000000000000000000000000000000009c21");
  });

  it("finds an address literal on the LEFT of ==", () => {
    const cedar = `@id("p")
forbid(principal, action, resource)
when { "0x7a3f000000000000000000000000000000009c21" == context.recipient };`;
    const holes = extractHoles(cedar);
    expect(holes.find((h) => h.kind === "address")?.path).toBe("context.recipient");
  });

  it("finds a decimal threshold in extension-method form and blanks it to a VALID decimal", () => {
    const cedar = `@id("p")
forbid(principal, action, resource)
when { context.amountUsd.greaterThanOrEqual(decimal("3.0")) };`;
    const holes = extractHoles(cedar);
    const num = holes.find((h) => h.kind === "number");
    expect(num).toBeTruthy();
    expect(num!.display).toBe("3.0");
    const out = redactCedar(cedar, holes, new Set());
    expect(out).toContain('decimal("0.0")'); // decimal("0")은 Cedar가 거부한다
    expect(out).not.toContain('decimal("3.0")');
  });

  it("replaces EVERY occurrence of a repeated literal", () => {
    const cedar = `@id("p")
forbid(principal, action, resource)
when { context.recipient == "0xA1c4000000000000000000000000000000007e29"
  || context.sender == "0xA1c4000000000000000000000000000000007e29" };`;
    const holes = extractHoles(cedar);
    const out = redactCedar(cedar, holes, new Set());
    expect(out).not.toContain("0xA1c4000000000000000000000000000000007e29");
  });

  it("does not mangle a longer number that contains the blanked one as a substring", () => {
    const cedar = `@id("p")
forbid(principal, action, resource)
when { context.slippageBp >= 150 && context.other == decimal("150.5") };`;
    const holes = extractHoles(cedar);
    const bare = holes.find((h) => h.raw === "150")!;
    const out = redactCedar(cedar, [bare], new Set());
    expect(out).toContain("context.slippageBp >= 0");
    expect(out).toContain('decimal("150.5")');
  });
});
