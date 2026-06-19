/**
 * verify-prod-registry — the cryptographic pre-REQUIRE-flip gate.
 *
 * Given the live proxy base URL + the pinned public key, samples live route-index
 * bundles, or checks every route-index entry with --all-routes, and proves
 * end-to-end that the prod registry is safe to enforce:
 *
 *   reconcile — the prod-served bundle's canonical SHA equals the LOCAL canonical
 *               build's bundle_sha256 for the same entry. Proves the prod bucket
 *               serves the source-of-truth build, not a drifted / corrupted copy
 *               (the bucket-to-bucket migration was count-verified, not content-verified).
 *   verify    — sha256(canonicalize(served bundle)) === served bundle_sha256, the
 *               detached /signatures/<sha>.sig is 200, and it WebCrypto-verifies
 *               under the PINNED key — exactly what the extension does at install.
 *
 * Full per-sha coverage (every bundle has a published .sig) is checked separately
 * and bucket-side by verify-bucket-parity.sh (proxy rate limits forbid 31k probes).
 * Extension release runs this against a representative source-ref index so the
 * live-proxy preflight is deterministic but bounded.
 *
 *   REGISTRY_BASE_URL=https://…  PINNED_BUNDLE_PUBLIC_KEY=<spki-b64> \
 *     npx tsx scripts/verify-prod-registry.ts [--sample=40 | --all-routes] [--max-entries=N] \
 *       [--concurrency=8] [--timeout-ms=10000]
 *
 * Exit 0 = all selected route bundles reconcile + verify; non-zero on any mismatch.
 */
import { createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const subtle = webcrypto.subtle;

const BASE = (process.env.REGISTRY_BASE_URL ?? "").replace(/\/$/, "");
const PIN = process.env.PINNED_BUNDLE_PUBLIC_KEY ?? "";
const ALL_ROUTES = process.argv.includes("--all-routes");
const SAMPLE_ARG = process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1];
const SAMPLE = SAMPLE_ARG === undefined ? 40 : Number(SAMPLE_ARG);
const MAX_ENTRIES_ARG = process.argv.find((a) => a.startsWith("--max-entries="))?.split("=")[1];
const MAX_ENTRIES = MAX_ENTRIES_ARG === undefined ? null : Number(MAX_ENTRIES_ARG);
const CONCURRENCY_ARG = process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1];
const CONCURRENCY = CONCURRENCY_ARG === undefined ? 8 : Number(CONCURRENCY_ARG);
const TIMEOUT_MS_ARG = process.argv.find((a) => a.startsWith("--timeout-ms="))?.split("=")[1];
const TIMEOUT_MS = TIMEOUT_MS_ARG === undefined ? 10000 : Number(TIMEOUT_MS_ARG);
const ROUTE_INDEX_DIRS = ["by-callkey", "by-typed-data", "by-selector"] as const;

if (!BASE) {
  console.error("FATAL: REGISTRY_BASE_URL required");
  process.exit(2);
}
if (!ALL_ROUTES && (!Number.isInteger(SAMPLE) || SAMPLE <= 0)) {
  console.error("FATAL: --sample must be a positive integer");
  process.exit(2);
}
if (MAX_ENTRIES !== null && (!Number.isInteger(MAX_ENTRIES) || MAX_ENTRIES <= 0)) {
  console.error("FATAL: --max-entries must be a positive integer");
  process.exit(2);
}
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY <= 0) {
  console.error("FATAL: --concurrency must be a positive integer");
  process.exit(2);
}
if (!Number.isInteger(TIMEOUT_MS) || TIMEOUT_MS <= 0) {
  console.error("FATAL: --timeout-ms must be a positive integer");
  process.exit(2);
}

interface Entry {
  relPath: string;
  sha: string;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function routeIndexFiles(): string[] {
  return ROUTE_INDEX_DIRS.flatMap((dir) => walk(join(ROOT, "index", dir)));
}

function readEntry(file: string): Entry | null {
  try {
    const e = JSON.parse(readFileSync(file, "utf8"));
    // Route entries may be concrete-inline or 3-ref/materialized by the prod proxy.
    // Reconcile against the served route entry, not a local inlined bundle copy.
    if (typeof e.bundle_sha256 === "string") {
      return { relPath: file.slice(ROOT.length + 1), sha: e.bundle_sha256 };
    }
  } catch {
    /* skip malformed local files; build-index/check:manifest catches them separately */
  }
  return null;
}

/** Select route-index entries that carry a bundle SHA. */
function selectedEntries(): Entry[] {
  const files = routeIndexFiles();
  if (files.length === 0) {
    console.error("FATAL: no route index entries — run `npm run build` first");
    process.exit(2);
  }
  if (ALL_ROUTES) {
    return files.flatMap((file) => {
      const entry = readEntry(file);
      return entry ? [entry] : [];
    });
  }

  const step = Math.max(1, Math.floor(files.length / SAMPLE));
  const out: Entry[] = [];
  for (let i = 0; i < files.length && out.length < SAMPLE; i += step) {
    const entry = readEntry(files[i]);
    if (entry) out.push(entry);
  }
  return out;
}

function sha256Hex(bytes: Uint8Array): string {
  return "0x" + createHash("sha256").update(bytes).digest("hex");
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP-${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const key = PIN
    ? await subtle.importKey(
        "spki",
        Uint8Array.from(Buffer.from(PIN, "base64")),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      )
    : null;
  if (!key) console.error("WARN: PINNED_BUNDLE_PUBLIC_KEY unset — skipping sig verify, reconcile only");

  const entries = selectedEntries();
  if (MAX_ENTRIES !== null && entries.length > MAX_ENTRIES) {
    console.error(`FATAL: selected ${entries.length} entries, exceeding --max-entries=${MAX_ENTRIES}`);
    process.exit(2);
  }
  let ok = 0;
  const fails: string[] = [];
  const signatureChecks = new Map<string, Promise<string | null>>();

  async function verifySignatureOnce(localSha: string, canon: Buffer, relPath: string): Promise<string | null> {
    if (!key) return null;
    const existing = signatureChecks.get(localSha);
    if (existing) return existing;

    const check = (async (): Promise<string | null> => {
      try {
        const sig = await fetchJson(`${BASE}/signatures/${localSha}.sig`);
        const sigB64 = (sig as { sig_b64?: unknown }).sig_b64;
        if (typeof sigB64 !== "string") return `SIG-MALFORMED ${localSha} (${relPath})`;
        const p1363 = Uint8Array.from(Buffer.from(sigB64, "base64"));
        const good = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, p1363, canon);
        return good ? null : `VERIFY-FAIL ${localSha} (${relPath})`;
      } catch (err) {
        return `SIG-FETCH ${localSha} (${relPath}): ${err instanceof Error ? err.message : err}`;
      }
    })();
    signatureChecks.set(localSha, check);
    return check;
  }

  async function verifyEntry(e: Entry): Promise<string | null> {
    try {
      const served = (await fetchJson(`${BASE}/${e.relPath}`)) as {
        bundle?: unknown;
        bundle_sha256?: unknown;
      };
      const canon = Buffer.from(canonicalize(served.bundle) as string, "utf8");
      const localSha = sha256Hex(canon);

      // reconcile: prod-served content == the LOCAL canonical build for this entry
      if (e.sha !== served.bundle_sha256) {
        return `RECONCILE ${e.relPath}: local ${e.sha} != served ${served.bundle_sha256}`;
      }
      // verify: canonical hash self-consistency (parity on the live wire)
      if (localSha !== served.bundle_sha256) {
        return `PARITY ${e.relPath}: canon ${localSha} != claimed ${served.bundle_sha256}`;
      }
      return await verifySignatureOnce(localSha, canon, e.relPath);
    } catch (err) {
      return `FETCH ${e.relPath}: ${err instanceof Error ? err.message : err}`;
    }
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= entries.length) return;
      const fail = await verifyEntry(entries[i]);
      if (fail) fails.push(fail);
      else ok++;
    }
  });
  await Promise.all(workers);

  console.error(
    `mode=${ALL_ROUTES ? "all-routes" : `sample:${SAMPLE}`}  entries=${entries.length}  ok=${ok}  fail=${fails.length}  unique_sig_checks=${signatureChecks.size}  concurrency=${CONCURRENCY}  timeout_ms=${TIMEOUT_MS}  (pin ${key ? "ON" : "OFF"})`,
  );
  for (const f of fails.slice(0, 20)) console.error("  " + f);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(2);
});
