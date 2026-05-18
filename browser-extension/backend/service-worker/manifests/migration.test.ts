import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    browser: {
      storage: {
        local: {
          get: vi.fn(async (key: string | string[]) => {
            const keys = Array.isArray(key) ? key : [key];
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (localStore.has(k)) out[k] = localStore.get(k);
            }
            return out;
          }),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) localStore.delete(k);
          }),
        },
      },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: mocks.browser }));

import {
  KEY_PENDING_MIGRATION,
  listPending,
  rewritePolicyText,
  setPending,
} from "./migration";

describe("rewritePolicyText", () => {
  it("rewrites known v0 enrichment refs to context.custom with a has-guard", () => {
    const before = `forbid (principal, action == Action::"swap", resource)
      when { context.totalInputUsd.value > 100 };`;
    const after = rewritePolicyText(before, ["totalInputUsd"]);
    expect(after).toContain("context.custom has totalInputUsd");
    expect(after).toContain("context.custom.totalInputUsd.value > 100");
    expect(after).not.toContain("context.totalInputUsd");
  });

  it("leaves unknown identifiers alone", () => {
    const before = `forbid (principal, action == Action::"swap", resource)
      when { context.someUnknown == 1 };`;
    const after = rewritePolicyText(before, ["totalInputUsd"]);
    expect(after).toBe(before);
  });

  it("only adds a single has-guard even when the field appears multiple times", () => {
    const before = `forbid (principal, action == Action::"swap", resource)
      when { context.totalInputUsd.value > 100 && context.totalInputUsd.value < 1000 };`;
    const after = rewritePolicyText(before, ["totalInputUsd"]);
    // Both reads got rewritten...
    expect(
      (after.match(/context\.custom\.totalInputUsd/g) ?? []).length,
    ).toBe(2);
    // ...but the has-guard appears exactly once.
    expect(
      (after.match(/context\.custom has totalInputUsd/g) ?? []).length,
    ).toBe(1);
  });

  it("rewrites multiple known fields independently", () => {
    const before = `forbid (principal, action == Action::"swap", resource)
      when { context.totalInputUsd.value > 100 && context.tokenRiskScore > 5 };`;
    const after = rewritePolicyText(before, ["totalInputUsd", "tokenRiskScore"]);
    expect(after).toContain("context.custom.totalInputUsd.value > 100");
    expect(after).toContain("context.custom.tokenRiskScore > 5");
    expect(after).toContain("context.custom has totalInputUsd");
    expect(after).toContain("context.custom has tokenRiskScore");
  });

  it("is a no-op when there are no when-clauses to guard", () => {
    const before = `forbid (principal, action == Action::"swap", resource);`;
    const after = rewritePolicyText(before, ["totalInputUsd"]);
    expect(after).toBe(before);
  });

  it("does not rewrite fields that already use context.custom (idempotent)", () => {
    const before = `forbid (principal, action == Action::"swap", resource)
      when { context.custom has totalInputUsd && context.custom.totalInputUsd.value > 100 };`;
    const after = rewritePolicyText(before, ["totalInputUsd"]);
    expect(after).toBe(before);
  });
});

describe("pending-migration list", () => {
  beforeEach(() => {
    mocks.localStore.clear();
    vi.clearAllMocks();
  });

  it("listPending returns [] when nothing has been recorded", async () => {
    expect(await listPending()).toEqual([]);
  });

  it("setPending / listPending round-trips ids in storage", async () => {
    await setPending(["policy:a", "policy:b"]);
    expect(await listPending()).toEqual(["policy:a", "policy:b"]);
    expect(mocks.localStore.get(KEY_PENDING_MIGRATION)).toEqual([
      "policy:a",
      "policy:b",
    ]);
  });

  it("setPending with [] clears the key", async () => {
    await setPending(["policy:a"]);
    await setPending([]);
    expect(await listPending()).toEqual([]);
  });
});
