import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("extension-release workflow safety", () => {
  const workflowText = () =>
    readFileSync(
      join(process.cwd(), "..", ".github/workflows/extension-release.yml"),
      "utf8",
    );
  const envExampleText = () =>
    readFileSync(join(process.cwd(), ".env.example"), "utf8");

  it("only creates release artifacts from an existing ext-vX.Y.Z tag", () => {
    const workflow = workflowText();
    const tagGuard = workflow.indexOf("name: Require extension release tag");
    const releaseCreate = workflow.indexOf("gh release create");

    expect(tagGuard).toBeGreaterThan(-1);
    expect(releaseCreate).toBeGreaterThan(tagGuard);
    expect(workflow).toContain('test "${GITHUB_REF_TYPE}" = "tag"');
    expect(workflow).toContain("^ext-v[0-9]+[.][0-9]+[.][0-9]+$");
    expect(workflow).toContain("--verify-tag");
    expect(workflow).not.toContain("non-tag ref");
  });

  it("keeps the documented release registry URL aligned with the extension env example", () => {
    const envExample = envExampleText();
    const registryUrl = envExample.match(/^REGISTRY_BASE_URL=(https:\/\/\S+)$/m)?.[1];

    expect(registryUrl).toBeTruthy();
    expect(workflowText()).toContain(`REGISTRY_BASE_URL              = ${registryUrl}`);
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

describe("assertProdServerUrlSecure (prod build guard)", () => {
  const load = () =>
    require("../../../webpack/env.js") as {
      assertProdServerUrlSecure(env: Record<string, string | undefined>): void;
    };

  it("passes for the default deployed https server URL", () => {
    const { assertProdServerUrlSecure } = load();
    expect(() => assertProdServerUrlSecure({})).not.toThrow();
  });

  it("passes for an explicit https bare origin", () => {
    const { assertProdServerUrlSecure } = load();
    expect(() =>
      assertProdServerUrlSecure({
        DAMBI_SERVER_URL: "https://dambi-policy.example.test",
      }),
    ).not.toThrow();
  });

  it("THROWS for an insecure server URL", () => {
    const { assertProdServerUrlSecure } = load();
    expect(() =>
      assertProdServerUrlSecure({
        DAMBI_SERVER_URL: "http://127.0.0.1:8788",
      }),
    ).toThrow(/DAMBI_SERVER_URL must be https/);
  });

  it("THROWS for a non-origin server URL", () => {
    const { assertProdServerUrlSecure } = load();
    expect(() =>
      assertProdServerUrlSecure({
        DAMBI_SERVER_URL: "https://dambi-policy.example.test/api?token=x",
      }),
    ).toThrow(/bare origin/);
  });

  it("allows opting out with DAMBI_ALLOW_INSECURE_SERVER=1 for local smoke builds", () => {
    const { assertProdServerUrlSecure } = load();
    expect(() =>
      assertProdServerUrlSecure({
        DAMBI_SERVER_URL: "http://127.0.0.1:8788",
        DAMBI_ALLOW_INSECURE_SERVER: "1",
      }),
    ).not.toThrow();
  });
});
