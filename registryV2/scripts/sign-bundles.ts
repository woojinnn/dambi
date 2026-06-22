/**
 * sign-bundles — detached ECDSA P-256 signatures over each unique registry bundle.
 *
 * The signed message is `canonicalize(bundle)` (RFC 8785 JCS); its SHA-256 is
 * exactly the `bundle_sha256` that build-index.ts stamps on every index entry
 * (proven for the whole corpus by registry-api's materialization-parity gate).
 * Signing that 32-byte digest therefore signs the canonical bundle. The browser
 * extension verifies with:
 *
 *     crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"}, pinnedKey, sig, canonicalize(bundle))
 *
 * which re-hashes the canonical message to the same digest. So we never need the
 * canonical bytes here — only `bundle_sha256`, read straight from the built index.
 *
 * Output: one detached sidecar per unique bundle, `signatures/<sha>.sig`:
 *     { "alg": "ECDSA_P256_SHA256", "key_id": "<label>", "sig_b64": "<base64 P1363 r||s>" }
 * The extension treats `alg`/`key_id` as telemetry ONLY — it hard-codes the
 * algorithm and the pinned key, so a malicious registry cannot downgrade them.
 *
 * Modes (BUNDLE_SIGNING_MODE):
 *   local (default) — sign with a local P-256 secret key (@noble/curves). dev / CI-test.
 *   kms             — sign each digest via Google Cloud KMS asymmetricSign (DER → P1363).
 *
 *   npm run sign                 # local mode (BUNDLE_SIGNING_KEY_PATH or dev key)
 *   BUNDLE_SIGNING_MODE=kms KMS_KEY_NAME=projects/.../cryptoKeyVersions/1 npm run sign
 *   npm run sign -- --force      # re-sign even when a .sig already exists
 */
import { createHash, webcrypto } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { p256 } from "@noble/curves/nist.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..");

export const SIG_ALG = "ECDSA_P256_SHA256";

/** Fixed ASN.1 SubjectPublicKeyInfo prefix for an uncompressed prime256v1 point. */
const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

export interface SignBundlesOptions {
  registryRoot?: string;
  mode?: "local" | "kms";
  /** local mode: 32-byte secret key, hex (0x optional). */
  privKeyHex?: string;
  /** kms mode: full crypto key VERSION resource name. */
  kmsKeyName?: string;
  /** label stored in each .sig (telemetry only; the extension ignores it). */
  keyId?: string;
  /** re-sign even when a .sig already exists (key rotation / corpus repair). */
  force?: boolean;
  /** kms mode: max concurrent asymmetricSign calls (default 12; env BUNDLE_SIGN_CONCURRENCY). */
  concurrency?: number;
  log?: (msg: string) => void;
}

export interface SignBundlesResult {
  total: number;
  signed: number;
  skipped: number;
}

export interface SignatureVerificationFailure {
  sha: string;
  reason:
    | "index_read_failed"
    | "bundle_materialization_failed"
    | "bundle_hash_mismatch"
    | "missing_signature"
    | "signature_read_failed"
    | "signature_malformed"
    | "signature_invalid";
  relPath?: string;
  detail?: string;
}

export interface VerifyLocalSignaturesResult {
  total: number;
  verified: number;
  failures: SignatureVerificationFailure[];
}

interface RefRegistryEntry {
  matched: true;
  schema_version: "3-ref";
  bundle_id: string;
  manifest_path: string;
  bundle_sha256: string;
  bundle_ref: string;
  context_ref?: string;
}

interface SourceContextDocument {
  schema_version: "3-source-context";
  chain_id: number;
  address: string;
  context: Record<string, unknown>;
}

interface BundleVerificationInput {
  sha: string;
  canonical: string;
  relPath: string;
}

// ---- helpers ----------------------------------------------------------------

function walkJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJson(full));
    else if (ent.name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Every unique `bundle_sha256` referenced by the built index/ tree. */
export function collectBundleShas(registryRoot: string): string[] {
  const shas = new Set<string>();
  for (const file of walkJson(join(registryRoot, "index"))) {
    let entry: { bundle_sha256?: unknown };
    try {
      entry = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const sha = entry.bundle_sha256;
    if (typeof sha === "string" && /^0x[0-9a-f]{64}$/.test(sha)) shas.add(sha);
  }
  return [...shas].sort();
}

/** Built-index bundle_sha256 values that have NO signatures/<sha>.sig sidecar —
 *  i.e. a coverage gap. Empty ⇒ every served bundle is verifiable. This is the
 *  hard gate that must hold before DAMBI_REQUIRE_BUNDLE_SIGNATURE is flipped on:
 *  a single uncovered bundle would fail-closed fleet-wide once REQUIRE is true. */
export function findMissingSignatures(registryRoot: string): string[] {
  const sigDir = join(registryRoot, "signatures");
  return collectBundleShas(registryRoot).filter(
    (sha) => !existsSync(join(sigDir, `${sha}.sig`)),
  );
}

function sha256Hex(s: string): string {
  return "0x" + createHash("sha256").update(s, "utf8").digest("hex");
}

type CanonicalizeFn = (value: unknown) => string | undefined;
let canonicalizePromise: Promise<CanonicalizeFn> | undefined;

async function loadCanonicalize(): Promise<CanonicalizeFn> {
  canonicalizePromise ??= import("canonicalize").then(
    (mod: { default: CanonicalizeFn }) => mod.default,
  );
  return canonicalizePromise;
}

async function canonicalBundle(bundle: unknown): Promise<string> {
  const canonicalize = await loadCanonicalize();
  const canonical = canonicalize(bundle);
  if (typeof canonical !== "string") {
    throw new Error("bundle canonicalization failed");
  }
  return canonical;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRefRegistryEntry(v: unknown): v is RefRegistryEntry {
  if (!isRecord(v)) return false;
  return (
    v.matched === true &&
    v.schema_version === "3-ref" &&
    typeof v.bundle_id === "string" &&
    typeof v.manifest_path === "string" &&
    typeof v.bundle_sha256 === "string" &&
    typeof v.bundle_ref === "string" &&
    (!("context_ref" in v) || typeof v.context_ref === "string")
  );
}

function readRegistryRefJson(
  registryRoot: string,
  ref: string,
  expectedPrefix: "bundles/" | "contexts/",
): unknown {
  if (ref.startsWith("/") || ref.includes("\0") || !ref.startsWith(expectedPrefix)) {
    throw new Error(`invalid generated ${expectedPrefix} ref ${JSON.stringify(ref)}`);
  }
  const full = resolve(registryRoot, ref);
  const rel = relative(resolve(registryRoot), full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`generated ref escapes registry root: ${JSON.stringify(ref)}`);
  }
  return JSON.parse(readFileSync(full, "utf8"));
}

function lookupSourcePath(context: Record<string, unknown>, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function substituteSourcePlaceholders(
  value: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    if (!value.startsWith("$source.")) return value;
    const resolved = lookupSourcePath(context, value.slice("$source.".length));
    if (resolved === undefined) {
      throw new Error(`unknown source placeholder ${JSON.stringify(value)}`);
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteSourcePlaceholders(item, context));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = substituteSourcePlaceholders(nested, context);
    }
    return out;
  }
  return value;
}

function sanitizeIdSuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "");
}

function appendIdSuffix(id: string, suffix: string): string {
  const clean = sanitizeIdSuffix(suffix);
  if (!clean) throw new Error(`source materialization produced empty id suffix for ${id}`);
  const at = id.lastIndexOf("@");
  if (at === -1) return `${id}/${clean}`;
  return `${id.slice(0, at)}/${clean}${id.slice(at)}`;
}

function materializeSourceBundle(
  template: unknown,
  contextDoc: SourceContextDocument,
): Record<string, unknown> {
  if (!isRecord(template)) throw new Error("bundle template must be an object");
  if (!isRecord(contextDoc) || !isRecord(contextDoc.context)) {
    throw new Error("source context document must have context object");
  }
  const context = contextDoc.context;
  const substituted = substituteSourcePlaceholders(template, context);
  if (!isRecord(substituted)) {
    throw new Error("source-substituted bundle must be an object");
  }
  const match = substituted.match;
  if (!isRecord(match) || typeof match.selector !== "string") {
    throw new Error("source-substituted bundle missing match.selector");
  }
  const id = substituted.id;
  if (typeof id !== "string") {
    throw new Error("source-substituted bundle missing id");
  }
  const idSuffix = context.id_suffix;
  if (typeof idSuffix !== "string") {
    throw new Error("source context missing id_suffix");
  }
  const chainId = contextDoc.chain_id;
  const address = contextDoc.address.toLowerCase();
  if (!Number.isInteger(chainId) || typeof contextDoc.address !== "string") {
    throw new Error("source context has invalid chain_id/address");
  }

  const { match: _match, source_materialize: _sourceMaterialize, ...rest } =
    substituted;
  return {
    ...rest,
    id: appendIdSuffix(id, idSuffix),
    match: {
      selector: match.selector,
      chain_to_addresses: {
        [String(chainId)]: [address],
      },
    },
  };
}

function servedBundle(registryRoot: string, entry: unknown): unknown {
  if (isRefRegistryEntry(entry)) {
    const template = readRegistryRefJson(registryRoot, entry.bundle_ref, "bundles/");
    if (entry.context_ref === undefined) return template;
    const contextDoc = readRegistryRefJson(
      registryRoot,
      entry.context_ref,
      "contexts/",
    ) as SourceContextDocument;
    return materializeSourceBundle(template, contextDoc);
  }
  if (isRecord(entry) && "bundle" in entry) return entry.bundle;
  throw new Error("index entry has no inline bundle or 3-ref bundle_ref");
}

async function collectBundleVerificationInputs(registryRoot: string): Promise<{
  inputs: BundleVerificationInput[];
  failures: SignatureVerificationFailure[];
}> {
  const bySha = new Map<string, BundleVerificationInput>();
  const failures: SignatureVerificationFailure[] = [];
  for (const file of walkJson(join(registryRoot, "index"))) {
    const relPath = relative(registryRoot, file);
    let entry: unknown;
    try {
      entry = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      failures.push({
        sha: "<unknown>",
        reason: "index_read_failed",
        relPath,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const sha = isRecord(entry) ? entry.bundle_sha256 : undefined;
    if (typeof sha !== "string" || !/^0x[0-9a-f]{64}$/.test(sha)) continue;
    let canonical: string;
    try {
      canonical = await canonicalBundle(servedBundle(registryRoot, entry));
    } catch (error) {
      failures.push({
        sha,
        reason: "bundle_materialization_failed",
        relPath,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const recomputed = sha256Hex(canonical);
    if (recomputed !== sha) {
      failures.push({
        sha,
        reason: "bundle_hash_mismatch",
        relPath,
        detail: `recomputed=${recomputed}`,
      });
      continue;
    }
    if (!bySha.has(sha)) bySha.set(sha, { sha, canonical, relPath });
  }
  return { inputs: [...bySha.values()].sort((a, b) => a.sha.localeCompare(b.sha)), failures };
}

async function importPinnedKey(spkiB64: string): Promise<CryptoKey> {
  const raw = spkiB64.trim();
  if (raw === "") throw new Error("PINNED_BUNDLE_PUBLIC_KEY is empty");
  return webcrypto.subtle.importKey(
    "spki",
    Buffer.from(raw, "base64"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function readSignatureBytes(
  registryRoot: string,
  sha: string,
): Uint8Array | SignatureVerificationFailure {
  const sigPath = join(registryRoot, "signatures", `${sha}.sig`);
  if (!existsSync(sigPath)) return { sha, reason: "missing_signature" };
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(sigPath, "utf8"));
  } catch (error) {
    return {
      sha,
      reason: "signature_read_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!isRecord(doc) || doc.alg !== SIG_ALG || typeof doc.sig_b64 !== "string") {
    return { sha, reason: "signature_malformed", detail: "expected alg and sig_b64" };
  }
  const sig = Buffer.from(doc.sig_b64, "base64");
  if (sig.length !== 64) {
    return {
      sha,
      reason: "signature_malformed",
      detail: `expected 64-byte P1363 signature, got ${sig.length}`,
    };
  }
  return Uint8Array.from(sig);
}

/** Verify every local signatures/<sha>.sig against the actual bundle object the
 * registry proxy serves for that sha. This catches stale hydrated signatures
 * from an old KMS key, corrupt sidecars, and source-ref materialization drift. */
export async function verifyLocalSignatures(
  registryRoot: string,
  pinnedPublicKeySpkiB64: string,
): Promise<VerifyLocalSignaturesResult> {
  const shas = collectBundleShas(registryRoot);
  const { inputs, failures } = await collectBundleVerificationInputs(registryRoot);
  const bySha = new Map(inputs.map((input) => [input.sha, input]));
  for (const sha of shas) {
    if (!bySha.has(sha) && !failures.some((failure) => failure.sha === sha)) {
      failures.push({ sha, reason: "bundle_materialization_failed" });
    }
  }

  const key = await importPinnedKey(pinnedPublicKeySpkiB64);
  let verified = 0;
  for (const input of inputs) {
    const sig = readSignatureBytes(registryRoot, input.sha);
    if ("reason" in sig) {
      failures.push({ ...sig, relPath: input.relPath });
      continue;
    }
    const ok = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      Buffer.from(input.canonical, "utf8"),
    );
    if (!ok) {
      failures.push({
        sha: input.sha,
        reason: "signature_invalid",
        relPath: input.relPath,
      });
      continue;
    }
    verified++;
  }

  return { total: shas.length, verified, failures };
}

function digestBytes(sha256Hex: string): Uint8Array {
  const hex = sha256Hex.startsWith("0x") ? sha256Hex.slice(2) : sha256Hex;
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function privKeyBytes(hex: string): Uint8Array {
  const h = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) {
    throw new Error("local signing key must be 32-byte hex (64 chars)");
  }
  return Uint8Array.from(Buffer.from(h, "hex"));
}

/** local: P1363 r||s directly from the prehashed digest. */
function signLocal(digest: Uint8Array, priv: Uint8Array): Uint8Array {
  return p256.sign(digest, priv, { prehash: false });
}

/** Convert an ASN.1 DER ECDSA signature (what Cloud KMS asymmetricSign returns)
 *  to raw r||s P1363 bytes — the form WebCrypto `verify` expects. This is the one
 *  transform unique to the KMS signing path (local mode emits P1363 directly), and
 *  historically the most error-prone (r/s leading-zero & length handling), so it is
 *  exported and unit-tested independently (sign-bundles.test.ts) without a live KMS. */
export function derToP1363(der: Uint8Array): Uint8Array {
  return p256.Signature.fromBytes(der, "der").toBytes("compact");
}

/** Minimal shape of the one KMS client method we use — keeps the heavy
 *  @google-cloud/kms type surface out of the hot path while staying type-checked. */
type KmsSigner = {
  asymmetricSign(req: {
    name: string;
    digest: { sha256: Buffer };
  }): Promise<[{ signature?: Buffer | Uint8Array | string | null }, ...unknown[]]>;
};

/** Construct the KMS client ONCE per run. Previously a fresh client — and with it
 *  a fresh credential + gRPC-channel init — was built per signature; on a full
 *  re-sign that is 30k+ auth handshakes, which exhausted the keyless WIF token
 *  refresh and hung the job for hours ("Getting metadata from plugin failed:
 *  upstream request timeout"). One client reuses a single cached token + channel. */
async function newKmsClient(): Promise<KmsSigner> {
  const { KeyManagementServiceClient } = await import("@google-cloud/kms");
  return new KeyManagementServiceClient() as unknown as KmsSigner;
}

/** kms: asymmetricSign returns DER; convert to P1363 (WebCrypto verify format). */
async function signKms(
  client: KmsSigner,
  digest: Uint8Array,
  keyName: string,
): Promise<Uint8Array> {
  const [resp] = await client.asymmetricSign({
    name: keyName,
    digest: { sha256: Buffer.from(digest) },
  });
  if (!resp.signature) {
    throw new Error(`KMS returned no signature for ${keyName}`);
  }
  return derToP1363(Uint8Array.from(resp.signature as Buffer));
}

/** Run `fn` over `items` with at most `concurrency` in flight, aborting fast on the
 *  first rejection — a broken KMS/auth fails in seconds, not after a partial corpus
 *  and not after a multi-hour stall. Single-threaded JS makes `next++` atomic. */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let aborted = false;
  const worker = async (): Promise<void> => {
    while (!aborted && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (e) {
        aborted = true;
        throw e;
      }
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function localKeyId(priv: Uint8Array): string {
  const pub = p256.getPublicKey(priv, false);
  return "local-" + createHash("sha256").update(pub).digest("hex").slice(0, 12);
}

/** SPKI(base64) public key for a local secret — the value pinned in the extension. */
export function publicKeySpkiBase64(privKeyHex: string): string {
  const pubU = p256.getPublicKey(privKeyBytes(privKeyHex), false); // 65-byte uncompressed
  return Buffer.concat([P256_SPKI_PREFIX, Buffer.from(pubU)]).toString("base64");
}

function readLocalKey(): string {
  const path =
    process.env.BUNDLE_SIGNING_KEY_PATH ??
    join(DEFAULT_ROOT, "scripts", "deploy", "keys", "dev-signing-key.hex");
  if (!existsSync(path)) {
    throw new Error(
      `local signing key not found at ${path}. Generate one with: npm run gen-signing-key`,
    );
  }
  return readFileSync(path, "utf8");
}

// ---- main -------------------------------------------------------------------

export async function signBundles(
  opts: SignBundlesOptions = {},
): Promise<SignBundlesResult> {
  const root = opts.registryRoot ?? DEFAULT_ROOT;
  const mode =
    opts.mode ?? (process.env.BUNDLE_SIGNING_MODE === "kms" ? "kms" : "local");
  const log = opts.log ?? (() => {});
  const sigDir = join(root, "signatures");

  let priv: Uint8Array | undefined;
  let kmsKeyName: string | undefined;
  let keyId = opts.keyId;
  if (mode === "local") {
    priv = privKeyBytes(opts.privKeyHex ?? readLocalKey());
    keyId = keyId ?? localKeyId(priv);
  } else {
    kmsKeyName = opts.kmsKeyName ?? process.env.KMS_KEY_NAME;
    if (!kmsKeyName) {
      throw new Error("kms mode requires KMS_KEY_NAME (key version resource name)");
    }
    keyId = keyId ?? kmsKeyName;
  }

  const shas = collectBundleShas(root);
  mkdirSync(sigDir, { recursive: true });

  // Sign only the gaps. In CI the workflow hydrates signatures/ from the bucket
  // first, so an incremental publish signs ~0 — the heavy KMS loop only runs on a
  // genuine new bundle or a --force rotation.
  const toSign = shas.filter(
    (sha) => opts.force || !existsSync(join(sigDir, `${sha}.sig`)),
  );
  const skipped = shas.length - toSign.length;

  const kmsClient = mode === "kms" ? await newKmsClient() : undefined;
  const concurrency =
    mode === "kms"
      ? (opts.concurrency ?? Number(process.env.BUNDLE_SIGN_CONCURRENCY)) || 12
      : 1;

  let signed = 0;
  await mapPool(toSign, concurrency, async (sha) => {
    const digest = digestBytes(sha);
    const sig =
      mode === "local"
        ? signLocal(digest, priv as Uint8Array)
        : await signKms(kmsClient as KmsSigner, digest, kmsKeyName as string);
    const doc = {
      alg: SIG_ALG,
      key_id: keyId,
      sig_b64: Buffer.from(sig).toString("base64"),
    };
    writeFileSync(
      join(sigDir, `${sha}.sig`),
      JSON.stringify(doc, null, 2) + "\n",
      "utf8",
    );
    signed++;
  });
  log(`[${mode}] ${signed} signed, ${skipped} skipped, ${shas.length} total`);
  return { total: shas.length, signed, skipped };
}

// CLI -------------------------------------------------------------------------

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  signBundles({
    force: process.argv.includes("--force"),
    log: (m) => console.error(`[sign-bundles] ${m}`),
  })
    .then(async (r) => {
      if (r.total === 0) {
        console.error(
          "[sign-bundles] WARN: no bundle_sha256 found — was the index built (npm run build)?",
        );
        return;
      }
      // Coverage gate — every built bundle MUST have a .sig before publish, else
      // a REQUIRE=true install of that bundle would fail-closed in the field.
      const missing = findMissingSignatures(DEFAULT_ROOT);
      if (missing.length > 0) {
        console.error(
          `[sign-bundles] FATAL: signature coverage gap — ${missing.length}/${r.total} bundles have no .sig:`,
        );
        for (const sha of missing.slice(0, 5)) console.error(`    ${sha}`);
        process.exit(1);
      }
      console.error(`[sign-bundles] coverage OK: all ${r.total} bundles signed`);
      const pinned = process.env.PINNED_BUNDLE_PUBLIC_KEY?.trim() ?? "";
      if (pinned === "") {
        if (process.env.BUNDLE_SIGNING_MODE === "kms") {
          console.error(
            "[sign-bundles] FATAL: kms mode requires PINNED_BUNDLE_PUBLIC_KEY for local signature validity verification",
          );
          process.exit(1);
        }
        console.error(
          "[sign-bundles] WARN: PINNED_BUNDLE_PUBLIC_KEY unset — skipped local signature validity verification",
        );
        return;
      }
      const verified = await verifyLocalSignatures(DEFAULT_ROOT, pinned);
      if (verified.failures.length > 0) {
        console.error(
          `[sign-bundles] FATAL: signature validity check failed — ${verified.failures.length}/${verified.total} bundles:`,
        );
        for (const failure of verified.failures.slice(0, 8)) {
          const where = failure.relPath ? ` ${failure.relPath}` : "";
          const detail = failure.detail ? ` (${failure.detail})` : "";
          console.error(`    ${failure.sha} ${failure.reason}${where}${detail}`);
        }
        process.exit(1);
      }
      console.error(
        `[sign-bundles] validity OK: ${verified.verified}/${verified.total} signatures verify under PINNED_BUNDLE_PUBLIC_KEY`,
      );
    })
    .catch((e) => {
      console.error("[sign-bundles] FATAL:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
