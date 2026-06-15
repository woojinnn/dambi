const path = require("path");

const DEFAULT_SERVER_URL = "https://dambi-policy.duckdns.org";

function buildMode(env = process.env) {
  return env.DAMBI_EXTENSION_BUILD_MODE || env.NODE_ENV || "development";
}

function envFileNameForMode(mode = buildMode()) {
  return mode === "production" ? ".env" : `.env.${mode}`;
}

function envPathForMode(extRoot, mode = buildMode()) {
  return path.join(extRoot, envFileNameForMode(mode));
}

function loadBuildEnv(extRoot, mode = buildMode()) {
  require("dotenv").config({ path: envPathForMode(extRoot, mode) });
}

function resolveServerUrl(env = process.env) {
  return env.DAMBI_SERVER_URL || DEFAULT_SERVER_URL;
}

// Channel-specific PINNED registry-bundle signing public key (SPKI base64). The
// SW verifies each bundle's detached ECDSA P-256 signature against this before
// installing the decoder. Empty when signing is not yet pinned on this channel.
function resolvePinnedBundleKey(env = process.env) {
  return env.PINNED_BUNDLE_PUBLIC_KEY || "";
}

// Whether bundle signatures are ENFORCED on this build channel. Baked verbatim
// as the string "true"/"false"; the verifier reads `=== "true"`. Off by default
// so an unsigned dev/staging registry keeps working (staged rollout).
function resolveRequireBundleSig(env = process.env) {
  return env.DAMBI_REQUIRE_BUNDLE_SIGNATURE === "true" ? "true" : "false";
}

// Production-build guard: a build destined for actual user distribution MUST
// enforce bundle signatures, otherwise the shipped extension would trust an
// unsigned/MITM'd registry and the supply-chain integrity check is silently
// defeated. We fail the build rather than let that ship (mirrors the
// REGISTRY_BASE_URL https guard's "fail the build, not the user" stance).
//
// The default IS strict: only an EXPLICIT opt-out downgrades a prod-config build
// to a non-enforcing local/staging smoke build —
//   - DAMBI_ALLOW_UNSIGNED_REGISTRY=1  (dedicated, clearest intent), or
//   - DAMBI_ALLOW_INSECURE_REGISTRY=1  (already marks a build as non-production,
//     so it implies the signature requirement is waived too — keeps CI's existing
//     compile-only build steps working with no extra flag).
// Only the literal "1" counts (a stray "true"/"yes" must not silently disarm it).
function assertProdSignatureEnforced(env = process.env) {
  const optedOut =
    env.DAMBI_ALLOW_UNSIGNED_REGISTRY === "1" ||
    env.DAMBI_ALLOW_INSECURE_REGISTRY === "1";
  if (optedOut) return;
  if (env.DAMBI_REQUIRE_BUNDLE_SIGNATURE !== "true") {
    throw new Error(
      "[webpack.prod] production builds must enforce bundle signatures: set " +
        "DAMBI_REQUIRE_BUNDLE_SIGNATURE=true (and PINNED_BUNDLE_PUBLIC_KEY) in " +
        "browser-extension/.env, or export DAMBI_ALLOW_UNSIGNED_REGISTRY=1 for a " +
        "local/staging smoke build that is NOT being distributed to users.",
    );
  }
}

module.exports = {
  DEFAULT_SERVER_URL,
  buildMode,
  envFileNameForMode,
  envPathForMode,
  loadBuildEnv,
  resolveServerUrl,
  resolvePinnedBundleKey,
  resolveRequireBundleSig,
  assertProdSignatureEnforced,
};
