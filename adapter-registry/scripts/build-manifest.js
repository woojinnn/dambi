#!/usr/bin/env node
// build-manifest.js
//
// Walks `public/adapters/<protocol>/<version>/adapter.wasm`, computes sha256
// per artifact, merges per-version `metadata.json`, per-protocol `channels.json`,
// and the optional `.revoked` sentinel file, and writes `public/manifest.json`.
//
// The output conforms to the `AdapterManifest` shape that lives (or will live)
// at `extension/src/lib/adapter-manifest.ts`. While that canonical type is not
// yet committed (track-B prerequisite), see `adapter-registry/tests/README.md`
// for the temporary vendored copy used by tests.
//
// Idempotent: running twice in a row over an unchanged tree produces identical
// output, modulo the `generated_at` timestamp. To make CI diffs reproducible,
// set `MANIFEST_GENERATED_AT` to a fixed ISO-8601 string.
//
// Exit codes:
//   0 — success
//   1 — any error (clear message on stderr)
//
// No external dependencies — only Node built-ins. The host package.json
// declares `"type": "module"`, so this file uses ESM syntax.

import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// paths

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = path.resolve(HERE, "..");
const PUBLIC_ROOT = path.join(REGISTRY_ROOT, "public");
const ADAPTERS_ROOT = path.join(PUBLIC_ROOT, "adapters");
const MANIFEST_PATH = path.join(PUBLIC_ROOT, "manifest.json");

// ---------------------------------------------------------------------------
// helpers

async function pathExists(p) {
  try {
    await fs.access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOptional(p) {
  if (!(await pathExists(p))) return null;
  const raw = await fs.readFile(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON at ${p}: ${err.message}`);
  }
}

async function listChildDirs(p) {
  if (!(await pathExists(p))) return [];
  const entries = await fs.readdir(p, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort();
}

async function sha256OfFile(p) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(p));
  return hash.digest("hex");
}

// Compare two semver-ish strings ("0.1.0", "1.10.2", "1.0.0-rc.1"). Pre-release
// tags are sorted lexicographically after the numeric triple, matching the
// "highest stable wins" heuristic. Pure semver compliance is not a goal here —
// `channels.json` is the authoritative override.
function compareSemver(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split("-", 2);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10));
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre ?? "" };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  // Empty pre-release > non-empty (1.0.0 > 1.0.0-rc.1).
  if (pa.pre === "" && pb.pre !== "") return 1;
  if (pa.pre !== "" && pb.pre === "") return -1;
  return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

function highestVersion(versions) {
  if (versions.length === 0) return null;
  return [...versions].sort(compareSemver).at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// metadata schema (per-version)

function coerceSupportedChains(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("metadata.supported_chains must be an array of numbers");
  }
  return raw.map((entry, idx) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
      throw new Error(
        `metadata.supported_chains[${idx}] must be a non-negative integer`
      );
    }
    return entry;
  });
}

function coerceSupportedAddresses(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("metadata.supported_addresses must be an array");
  }
  return raw.map((entry, idx) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.chain_id !== "number" ||
      typeof entry.address !== "string"
    ) {
      throw new Error(
        `metadata.supported_addresses[${idx}] must be { chain_id: number, address: string }`
      );
    }
    return { chain_id: entry.chain_id, address: entry.address };
  });
}

function coerceHostCapabilities(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("metadata.host_capabilities must be an array of strings");
  }
  return raw.map((entry, idx) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(
        `metadata.host_capabilities[${idx}] must be a non-empty string`
      );
    }
    return entry;
  });
}

function coerceDisplayName(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("metadata.display_name must be a non-empty string");
  }
  return raw;
}

// ---------------------------------------------------------------------------
// version + protocol walkers

async function buildVersionEntry({ protocol, version }) {
  const versionDir = path.join(ADAPTERS_ROOT, protocol, version);
  const wasmPath = path.join(versionDir, "adapter.wasm");

  if (!(await pathExists(wasmPath))) {
    throw new Error(`Missing ${wasmPath}; every version directory must ship adapter.wasm`);
  }

  const sha256 = await sha256OfFile(wasmPath);
  const metadata = (await readJsonOptional(path.join(versionDir, "metadata.json"))) ?? {};
  const revokedSentinel = await pathExists(path.join(versionDir, ".revoked"));

  return {
    version,
    wasm_url: `/adapters/${protocol}/${version}/adapter.wasm`,
    sha256,
    supported_chains: coerceSupportedChains(metadata.supported_chains),
    supported_addresses: coerceSupportedAddresses(metadata.supported_addresses),
    host_capabilities: coerceHostCapabilities(metadata.host_capabilities),
    revoked: Boolean(revokedSentinel),
    display_name_override: coerceDisplayName(metadata.display_name),
  };
}

async function buildProtocolEntry(protocol) {
  const protocolDir = path.join(ADAPTERS_ROOT, protocol);
  const versionDirs = await listChildDirs(protocolDir);

  const versions = [];
  for (const version of versionDirs) {
    versions.push(await buildVersionEntry({ protocol, version }));
  }
  // Stable sort by semver-ish version so output is deterministic regardless of
  // filesystem ordering.
  versions.sort((a, b) => compareSemver(a.version, b.version));

  // `display_name`: per-version metadata can override; protocol-level falls
  // back to the latest version's name, or the protocol slug.
  const latestWithName = [...versions]
    .reverse()
    .find((v) => v.display_name_override !== undefined);
  const protocolDisplayName = latestWithName?.display_name_override ?? protocol;

  // `stable_version`: prefer `channels.json`; fall back to highest semver.
  const channels = await readJsonOptional(path.join(protocolDir, "channels.json"));
  let stableVersion = null;
  if (channels && typeof channels === "object" && typeof channels.stable === "string") {
    if (!versions.some((v) => v.version === channels.stable)) {
      throw new Error(
        `channels.json for ${protocol} pins stable=${channels.stable}, but that version directory is missing`
      );
    }
    stableVersion = channels.stable;
  } else {
    const versionList = versions.map((v) => v.version);
    stableVersion = highestVersion(versionList);
  }
  if (stableVersion === null) {
    throw new Error(`Protocol ${protocol} has no versions; refuse to emit an entry`);
  }

  return {
    protocol,
    display_name: protocolDisplayName,
    stable_version: stableVersion,
    versions: versions.map(({ display_name_override, ...rest }) => rest),
  };
}

// ---------------------------------------------------------------------------
// main

async function buildManifest() {
  if (!(await pathExists(ADAPTERS_ROOT))) {
    throw new Error(`Adapters directory not found at ${ADAPTERS_ROOT}`);
  }
  const protocols = await listChildDirs(ADAPTERS_ROOT);

  const adapters = [];
  for (const protocol of protocols) {
    const entry = await buildProtocolEntry(protocol);
    adapters.push(entry);
  }
  adapters.sort((a, b) => (a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0));

  const generatedAt =
    process.env.MANIFEST_GENERATED_AT ?? new Date().toISOString();

  return {
    schema_version: 1,
    generated_at: generatedAt,
    adapters,
  };
}

async function main() {
  const manifest = await buildManifest();
  // Two-space indent + trailing newline so the file is diff-friendly.
  await fs.writeFile(
    MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${MANIFEST_PATH} (${manifest.adapters.length} protocol${manifest.adapters.length === 1 ? "" : "s"})`
  );
}

// Detect "ran directly" vs "imported". macOS symlinks `/tmp` → `/private/tmp`,
// so `process.argv[1]` and `fileURLToPath(import.meta.url)` may differ in
// realpath terms. Resolve both sides via `fs.realpath` before comparing — or
// just always run main() unless tests opt out by setting the env flag.
async function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const argvReal = await fs.realpath(path.resolve(process.argv[1]));
    const selfReal = await fs.realpath(fileURLToPath(import.meta.url));
    return argvReal === selfReal;
  } catch {
    return false;
  }
}

if (await isInvokedDirectly()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`build-manifest.js failed: ${err.message ?? err}`);
    process.exit(1);
  });
}

export { buildManifest };
