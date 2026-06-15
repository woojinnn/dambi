import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("webpack env mode helpers", () => {
  it("does not load the production .env file for development builds", () => {
    const { envFileNameForMode } = require("../../../webpack/env.js") as {
      envFileNameForMode(mode: string): string;
    };

    expect(envFileNameForMode("development")).toBe(".env.development");
    expect(envFileNameForMode("production")).toBe(".env");
  });

  it("uses the deployed policy server URL unless explicitly overridden", () => {
    const { resolveServerUrl } = require("../../../webpack/env.js") as {
      resolveServerUrl(env: Record<string, string | undefined>): string;
    };

    expect(resolveServerUrl({})).toBe("https://dambi-policy.duckdns.org");
    expect(
      resolveServerUrl({ DAMBI_SERVER_URL: "https://dambi-policy.example.test" }),
    ).toBe("https://dambi-policy.example.test");
  });
});

describe("assertProdSignatureEnforced (prod build guard)", () => {
  const load = () =>
    require("../../../webpack/env.js") as {
      assertProdSignatureEnforced(env: Record<string, string | undefined>): void;
    };

  it("passes when a prod build enforces signatures", () => {
    const { assertProdSignatureEnforced } = load();
    expect(() =>
      assertProdSignatureEnforced({ DAMBI_REQUIRE_BUNDLE_SIGNATURE: "true" }),
    ).not.toThrow();
  });

  it("THROWS when a prod build does not enforce signatures (flag false)", () => {
    const { assertProdSignatureEnforced } = load();
    expect(() =>
      assertProdSignatureEnforced({ DAMBI_REQUIRE_BUNDLE_SIGNATURE: "false" }),
    ).toThrow(/must enforce bundle signatures/);
  });

  it("THROWS when a prod build leaves the flag unset", () => {
    const { assertProdSignatureEnforced } = load();
    expect(() => assertProdSignatureEnforced({})).toThrow(
      /must enforce bundle signatures/,
    );
  });

  it("allows opting out with DAMBI_ALLOW_UNSIGNED_REGISTRY=1 (local/staging smoke)", () => {
    const { assertProdSignatureEnforced } = load();
    expect(() =>
      assertProdSignatureEnforced({
        DAMBI_REQUIRE_BUNDLE_SIGNATURE: "false",
        DAMBI_ALLOW_UNSIGNED_REGISTRY: "1",
      }),
    ).not.toThrow();
  });

  it("treats the existing DAMBI_ALLOW_INSECURE_REGISTRY=1 as a non-prod opt-out too", () => {
    const { assertProdSignatureEnforced } = load();
    expect(() =>
      assertProdSignatureEnforced({
        DAMBI_ALLOW_INSECURE_REGISTRY: "1",
      }),
    ).not.toThrow();
  });

  it("does not accept a non-'1' opt-out value", () => {
    const { assertProdSignatureEnforced } = load();
    expect(() =>
      assertProdSignatureEnforced({ DAMBI_ALLOW_UNSIGNED_REGISTRY: "true" }),
    ).toThrow(/must enforce bundle signatures/);
  });
});
