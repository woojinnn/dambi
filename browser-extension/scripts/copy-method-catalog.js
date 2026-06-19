#!/usr/bin/env node
// Copy `schema/method-catalog.json` into `browser-extension/public/`
// so the dashboard can fetch it at runtime via
// `Browser.runtime.getURL("method-catalog.json")`.
//
// The catalog is the bundled "what methods does this extension know
// about" snapshot — the dashboard uses it as the default for the
// manifest editor's method/param/return dropdowns. When the user
// configures a policy-rpc endpoint, the dashboard ALSO fetches that
// daemon's `GET /v1/methods` and merges the two so user-added methods
// (plugins) show up alongside.
//
// Unlike `copy-default-manifests.js`, this runs in BOTH dev and prod
// builds: even prod manifests need the catalog to drive the editor
// UX. The catalog itself is small (~5KB) so the bundle hit is
// negligible.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.resolve(REPO_ROOT, "schema", "method-catalog.json");
const DEST_DIR = path.resolve(__dirname, "..", "public");
const DEST = path.join(DEST_DIR, "method-catalog.json");
const SERVER_HANDLER = path.resolve(
  REPO_ROOT,
  "crates",
  "policy-server",
  "server",
  "src",
  "handler.rs",
);
const LOCAL_HANDLERS = path.resolve(
  REPO_ROOT,
  "browser-extension",
  "backend",
  "service-worker",
  "local-method-handlers.ts",
);

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function extractServerMethods() {
  const source = fs.readFileSync(SERVER_HANDLER, "utf8");
  const start = source.indexOf("match spec.method.as_str()");
  const end = source.indexOf("other => diagnostics.push", start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      `[copy-method-catalog] cannot locate policy-server method dispatch in ${SERVER_HANDLER}`,
    );
  }
  return sortedUnique(
    [...source.slice(start, end).matchAll(/"([A-Za-z0-9_.]+)"\s*=>/g)].map(
      (match) => match[1],
    ),
  );
}

function extractLocalMethods() {
  const source = fs.readFileSync(LOCAL_HANDLERS, "utf8");
  const start = source.indexOf("const LOCAL_HANDLERS");
  const end = source.indexOf("\n};\n\nclass LocalMethodError", start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      `[copy-method-catalog] cannot locate local method dispatch in ${LOCAL_HANDLERS}`,
    );
  }
  return sortedUnique(
    [...source.slice(start, end).matchAll(/"([A-Za-z0-9_.]+)"\s*:/g)].map(
      (match) => match[1],
    ),
  );
}

function validateExecutableCatalog(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.methods ||
    typeof parsed.methods !== "object"
  ) {
    throw new Error("[copy-method-catalog] catalog must contain a methods object");
  }
  const catalog = sortedUnique(Object.keys(parsed.methods));
  const executable = sortedUnique([...extractServerMethods(), ...extractLocalMethods()]);
  const missing = executable.filter((method) => !catalog.includes(method));
  const stale = catalog.filter((method) => !executable.includes(method));
  if (missing.length || stale.length) {
    throw new Error(
      [
        "[copy-method-catalog] method-catalog drifted from executable policy-rpc methods",
        missing.length ? `  missing from catalog: ${missing.join(", ")}` : null,
        stale.length ? `  advertised but not executable: ${stale.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.warn(`[copy-method-catalog] source not found at ${SRC} — skipping.`);
    return;
  }
  if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });

  const raw = fs.readFileSync(SRC, "utf8");
  // Parse + reserialise so malformed catalogs fail the build early
  // (we'd rather break here than at runtime in the dashboard).
  const parsed = JSON.parse(raw);
  validateExecutableCatalog(parsed);
  fs.writeFileSync(DEST, JSON.stringify(parsed));
  console.log(
    `[copy-method-catalog] copied ${Object.keys(parsed.methods).length} method entries → ${DEST}`,
  );
}

main();
