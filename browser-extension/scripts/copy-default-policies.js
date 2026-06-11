#!/usr/bin/env node
// Copy the engine's default policy set + composed schema into
// extension/public/default-policies/ so the SW can fetch them at install
// time. Plan 6 will replace this static set with marketplace bundles.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXT_ROOT = path.resolve(__dirname, "..");
const DEST = path.resolve(__dirname, "..", "public", "default-policies");

function listFilesWithExtension(dir, extension) {
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(extension)) files.push(full);
    }
  }
  walk(dir);
  return files.sort(); // deterministic order so the policy-set.json hashes stably
}

function listCedarFiles(dir) {
  return listFilesWithExtension(dir, ".cedar");
}

function listSchemaFiles() {
  const files = [];
  const core = path.join(REPO_ROOT, "schema", "policy-schema", "core.cedarschema");
  if (fs.existsSync(core)) files.push(core);

  const actionsDir = path.join(REPO_ROOT, "schema", "policy-schema", "actions");
  if (fs.existsSync(actionsDir)) {
    files.push(...listFilesWithExtension(actionsDir, ".cedarschema"));
  }

  return files;
}

// Phase 1 / P2 — emit the default v2 policy set alongside the v1
// `policy-set.json`. v2 is STATELESS: the SW holds these bundles in memory
// and passes them INLINE to `evaluate_action_v2_json` per call (no install
// step). The canonical source of truth is the Rust fixture dir
// `crates/policy-engine/tests/fixtures/default_policies_v2/<id>/{manifest.json,
// policy.cedar}`, proven consistent by `default_policies_v2.rs`. We enumerate
// DIRECTORIES (not `.cedar` files), sort for byte-stable output, and ship the
// policy text + manifest verbatim (no JS-side transform — validity is the
// Rust fixture gate's job).
function copyDefaultPoliciesV2() {
  const destPath = path.join(DEST, "policy-set-v2.json");

  // Ship the "day1-safety" bundle as the baked default v2 set. The bundle lives
  // under `default-bundles/day1-safety/` (package.json + policies/<id>/{policy.cedar,
  // manifest.json}); we project each policy onto the `{id, policy}` shape that
  // `loadDefaults()` in policy-selection.ts consumes for the popup catalog.
  // Enumerate via package.json's `policies[]` so order + id match the bundle's
  // canonical manifest; fall back to dir-scan if package.json is absent.
  // Which bundle to bake. Defaults to `day1-safety`; override with
  // `DEFAULT_BUNDLE=<dir>` (e.g. `safe-swap-lp`) at build time.
  const bundleName = process.env.DEFAULT_BUNDLE || "day1-safety";
  const bundleDir = path.join(EXT_ROOT, "default-bundles", bundleName);
  if (!fs.existsSync(bundleDir)) {
    fs.writeFileSync(destPath, "[]");
    console.log(`Wrote empty policy-set-v2.json (default-bundles/${bundleName} not found)`);
    return;
  }

  const pkgPath = path.join(bundleDir, "package.json");
  let ids;
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    ids = (pkg.policies || []).map((p) => p.id);
  } else {
    ids = fs
      .readdirSync(path.join(bundleDir, "policies"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  const policySet = ids.map((id) => {
    const dir = path.join(bundleDir, "policies", id);
    const policy = fs.readFileSync(path.join(dir, "policy.cedar"), "utf8");
    // Embed the parsed manifest. The default-policy loader (policies-loader-v2)
    // does NOT synthesize a manifest the way managed/dashboard policies do, so a
    // missing manifest reaches the WASM `evaluate_action_v2_json` as `null` →
    // `invalid type: null, expected struct ManifestV2` → fail-closed warn on
    // every tx. Ship each policy's `manifest.json` verbatim (fallback: minimal).
    const manifestPath = path.join(dir, "manifest.json");
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      : { id, schema_version: 2 };
    return { id, policy, manifest };
  });

  fs.writeFileSync(destPath, JSON.stringify(policySet, null, 2));
  console.log(
    `Wrote policy-set-v2.json with ${policySet.length} ${bundleName} policies → ${destPath}`,
  );
}

function main() {
  if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

  const schemaParts = listSchemaFiles();
  const schema = schemaParts
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n\n");
  fs.writeFileSync(path.join(DEST, "schema.cedarschema"), schema);

  const policiesDir = path.join(REPO_ROOT, "policy-rpc", "examples", "policies");
  if (fs.existsSync(policiesDir)) {
    const files = listCedarFiles(policiesDir);
    const policySet = files.map((f) => {
      const entry = {
        id: `default::${path
          .relative(policiesDir, f)
          .replace(/\\/g, "/")
          .replace(/\.cedar$/, "")}`,
        text: fs.readFileSync(f, "utf8"),
      };
      const manifestPath = f.replace(/\.cedar$/, ".policy-rpc.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (Array.isArray(manifest)) entry.manifests = manifest;
        else entry.manifest = manifest;
      }
      return entry;
    });
    fs.writeFileSync(
      path.join(DEST, "policy-set.json"),
      JSON.stringify(policySet, null, 2),
    );
    console.log(
      `Copied ${schemaParts.length} schema parts + ${policySet.length} policies → ${DEST}`,
    );
  } else {
    fs.writeFileSync(path.join(DEST, "policy-set.json"), "[]");
    console.log(
      `Wrote empty policy-set.json (no policy-rpc/examples/policies/ dir found)`,
    );
  }

  copyDefaultPoliciesV2();
}

main();
