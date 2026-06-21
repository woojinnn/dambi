/**
 * verify-prod-registry.test.ts — registryV2 has no vitest of its own; run from
 * browser-extension/ with its bundled vitest, pointing --root at registryV2:
 *
 *   cd browser-extension
 *   node .yarn/releases/yarn-4.14.1.cjs vitest run \
 *     --root ../registryV2 scripts/__tests__/verify-prod-registry.test.ts
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCRIPTS_DIR = resolve(__dirname, "..");
const VERIFY_PROD_REGISTRY = join(SCRIPTS_DIR, "verify-prod-registry.ts");
const REGISTRY_V2_ROOT = resolve(SCRIPTS_DIR, "..");
const TSX_BIN = join(REGISTRY_V2_ROOT, "node_modules", ".bin", "tsx");

let root: string;
let server: Server | null;

function sha256Hex(s: string): string {
  return "0x" + createHash("sha256").update(s, "utf8").digest("hex");
}

function writeRouteEntry(relPath: string, bundle: Record<string, unknown>): string {
  const sha = sha256Hex(canonicalize(bundle) as string);
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(
    full,
    JSON.stringify(
      {
        matched: true,
        bundle_id: bundle.id,
        manifest_path: `manifests/${bundle.id}.json`,
        bundle_sha256: sha,
      },
      null,
      2,
    ) + "\n",
  );
  return sha;
}

function startServer(handler: (path: string) => { status: number; body: unknown; headers?: Record<string, string> }): Promise<string> {
  server = createServer((req, res) => {
    const path = req.url?.replace(/^\//, "") ?? "";
    const out = handler(path);
    res.writeHead(out.status, {
      "content-type": "application/json; charset=utf-8",
      ...(out.headers ?? {}),
    });
    res.end(JSON.stringify(out.body));
  });
  return new Promise((resolveStart) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (addr && typeof addr === "object") resolveStart(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function runVerify(baseUrl: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    execFile(
      TSX_BIN,
      [VERIFY_PROD_REGISTRY, "--sample=1", "--concurrency=1", "--timeout-ms=5000", "--retry-base-ms=0"],
      {
        env: {
          ...process.env,
          REGISTRY_BASE_URL: baseUrl,
          PINNED_BUNDLE_PUBLIC_KEY: "",
          VERIFY_PROD_REGISTRY_ROOT: root,
        },
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolveRun({
          status:
            typeof (error as { code?: unknown } | null)?.code === "number"
              ? ((error as { code: number }).code)
              : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-prod-registry-"));
  server = null;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
  }
  rmSync(root, { recursive: true, force: true });
});

describe("verify-prod-registry", () => {
  it("retries live registry 429 responses using Retry-After before failing the release gate", async () => {
    const relPath = "index/by-callkey/1__0x1111111111111111111111111111111111111111__0x12345678.json";
    const bundle = { id: "retry-ok@1.0.0", type: "adapter_action", schema_version: "3" };
    const sha = writeRouteEntry(relPath, bundle);
    let attempts = 0;
    const seenPaths: string[] = [];
    const baseUrl = await startServer((path) => {
      seenPaths.push(path);
      attempts += 1;
      if (attempts === 1) {
        return {
          status: 429,
          headers: { "retry-after": "0" },
          body: { ok: false, error: { code: "rate_limited" } },
        };
      }
      return {
        status: 200,
        body: { matched: true, bundle_sha256: sha, bundle },
      };
    });

    const result = await runVerify(baseUrl);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("ok=1");
    expect(result.stderr).toContain("fail=0");
    expect(attempts).toBe(2);
    expect(seenPaths).toEqual([relPath, relPath]);
  }, 10_000);
});
