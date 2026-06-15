#!/usr/bin/env node
/**
 * validate-dist — fail the build if the generated manifest references a file that
 * does not exist in dist/<target>. Chrome's "Load unpacked" rejects the whole
 * extension on the FIRST missing load-critical resource (e.g. options_page →
 * options.html), so a partial build (webpack without the dashboard) ships a
 * manifest that can't load. This gate turns that into a loud build failure.
 *
 * Scope: load-blocking fields only (icons, action popup/icons, options page,
 * background, content-script JS). web_accessible_resources are runtime + may be
 * globs, and a missing one does NOT block load, so they are not enforced here.
 *
 * Target comes from TARGET_BROWSER (default "chrome").
 */
const fs = require("node:fs");
const path = require("node:path");

const target = process.env.TARGET_BROWSER || "chrome";
const distDir = path.resolve(__dirname, "..", "dist", target);
const manifestPath = path.join(distDir, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error(`[validate-dist] ${target}: no manifest.json at ${manifestPath}`);
  process.exit(1);
}

const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const refs = new Set();
const add = (p) => {
  if (typeof p === "string" && p && !p.includes("*")) refs.add(p);
};

if (m.icons) Object.values(m.icons).forEach(add);
if (m.action) {
  add(m.action.default_popup);
  if (m.action.default_icon) Object.values(m.action.default_icon).forEach(add);
}
if (m.browser_action) {
  add(m.browser_action.default_popup);
  if (m.browser_action.default_icon)
    Object.values(m.browser_action.default_icon).forEach(add);
}
add(m.options_page);
if (m.options_ui) add(m.options_ui.page);
if (m.background) {
  add(m.background.service_worker);
  (m.background.scripts || []).forEach(add);
}
(m.content_scripts || []).forEach((cs) => (cs.js || []).forEach(add));

const missing = [...refs].filter(
  (ref) => !fs.existsSync(path.join(distDir, ref)),
);

if (missing.length > 0) {
  console.error(
    `[validate-dist] ${target}: ${missing.length} manifest-referenced file(s) MISSING from dist/${target} —`,
  );
  for (const ref of missing) console.error(`    - ${ref}`);
  console.error(
    `[validate-dist] the extension will FAIL to load. (options.html is built by the dashboard — run a full \`build:${target}\`, not webpack alone.)`,
  );
  process.exit(1);
}

console.error(
  `[validate-dist] ${target}: all ${refs.size} load-critical manifest paths present ✓`,
);
