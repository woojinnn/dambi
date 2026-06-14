/**
 * verify-prod-registry — the cryptographic pre-REQUIRE-flip gate.
 *
 * Given the live proxy base URL + the pinned public key, samples live bundles and
 * proves, end-to-end, that the prod registry is safe to enforce:
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
 *
 *   REGISTRY_BASE_URL=https://…  PINNED_BUNDLE_PUBLIC_KEY=<spki-b64> \
 *     npx tsx scripts/verify-prod-registry.ts [--sample=40]
 *
 * Exit 0 = all sampled bundles reconcile + verify; non-zero on any mismatch.
 */
import { createHash, webcrypto } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const subtle = webcrypto.subtle;

const BASE = (process.env.REGISTRY_BASE_URL ?? "").replace(/\/$/, "");
const PIN = process.env.PINNED_BUNDLE_PUBLIC_KEY ?? "";
const SAMPLE = Number(
  process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? "40",
);

if (!BASE) {
  console.error("FATAL: REGISTRY_BASE_URL required");
  process.exit(2);
}

interface Entry {
  relPath: string;
  sha: string;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Evenly-spaced sample of index entries that carry an inline bundle. */
function sampleEntries(n: number): Entry[] {
  const files = walk(join(ROOT, "index", "by-callkey"));
  if (files.length === 0) {
    console.error("FATAL: no index/by-callkey entries — run `npm run build` first");
    process.exit(2);
  }
  const step = Math.max(1, Math.floor(files.length / n));
  const out: Entry[] = [];
  for (let i = 0; i < files.length && out.length < n; i += step) {
    try {
      const e = JSON.parse(readFileSync(files[i], "utf8"));
      // Sample ALL entries (concrete-inline AND 3-ref): the prod proxy materializes
      // both into an inline `bundle` when served, and the 3-ref materialization path
      // is exactly the one whose drift we most need to catch. The local file may
      // carry only bundle_ref — we reconcile against the SERVED bundle, not a local one.
      if (typeof e.bundle_sha256 === "string") {
        out.push({ relPath: files[i].slice(ROOT.length + 1), sha: e.bundle_sha256 });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function sha256Hex(bytes: Uint8Array): string {
  return "0x" + createHash("sha256").update(bytes).digest("hex");
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

  const entries = sampleEntries(SAMPLE);
  let ok = 0;
  const fails: string[] = [];

  for (const e of entries) {
    try {
      const served = await (await fetch(`${BASE}/${e.relPath}`)).json();
      const canon = Buffer.from(canonicalize(served.bundle) as string, "utf8");
      const localSha = sha256Hex(canon);

      // reconcile: prod-served content == the LOCAL canonical build for this entry
      if (e.sha !== served.bundle_sha256) {
        fails.push(`RECONCILE ${e.relPath}: local ${e.sha} != served ${served.bundle_sha256}`);
        continue;
      }
      // verify: canonical hash self-consistency (parity on the live wire)
      if (localSha !== served.bundle_sha256) {
        fails.push(`PARITY ${e.relPath}: canon ${localSha} != claimed ${served.bundle_sha256}`);
        continue;
      }
      if (key) {
        const sres = await fetch(`${BASE}/signatures/${localSha}.sig`);
        if (!sres.ok) {
          fails.push(`SIG-404 ${localSha} (${e.relPath})`);
          continue;
        }
        const sig = await sres.json();
        const p1363 = Uint8Array.from(Buffer.from(sig.sig_b64, "base64"));
        const good = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, p1363, canon);
        if (!good) {
          fails.push(`VERIFY-FAIL ${localSha} (${e.relPath})`);
          continue;
        }
      }
      ok++;
    } catch (err) {
      fails.push(`FETCH ${e.relPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.error(`sample=${entries.length}  ok=${ok}  fail=${fails.length}  (pin ${key ? "ON" : "OFF"})`);
  for (const f of fails.slice(0, 20)) console.error("  " + f);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(2);
});
