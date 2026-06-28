#!/usr/bin/env node
/**
 * validate-dist — fail the build if the generated manifest references a file that
 * does not exist in dist/<target>. Chrome's "Load unpacked" rejects the whole
 * extension on the FIRST missing load-critical resource (e.g. options_page →
 * options.html), so a partial build (webpack without the dashboard) ships a
 * manifest that can't load. This gate turns that into a loud build failure.
 *
 * Scope:
 * - load-blocking fields (icons, action popup/icons, options page, background,
 *   content-script JS)
 * - web_accessible_resources needed by injected/page-context runtime assets
 *
 * The latter do not block extension load, but a missing injected script, CSS, or
 * image resource breaks wallet interception/advisory behavior after install.
 *
 * Target comes from TARGET_BROWSER (default "chrome").
 */
const fs = require("node:fs");
const path = require("node:path");

const target =
  process.env.DAMBI_EXTENSION_DIST_TARGET ||
  process.env.TARGET_BROWSER ||
  "chrome";
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

const allFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
    } else if (entry.isFile()) {
      allFiles.push(abs);
    }
  }
};
walk(distDir);

const relPath = (abs) => path.relative(distDir, abs).split(path.sep).join("/");
const allRelFiles = allFiles.map(relPath);

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

const licenseNoticeViolations = ["LICENSE", "NOTICE"].filter((file) => {
  const abs = path.join(distDir, file);
  return !fs.existsSync(abs) || !fs.statSync(abs).isFile();
});
if (licenseNoticeViolations.length > 0) {
  console.error(
    `[validate-dist] ${target}: Apache-2.0 distribution notice file(s) missing from dist/${target} —`,
  );
  for (const file of licenseNoticeViolations) console.error(`    - ${file}`);
  process.exit(1);
}

function resourcePatternsFromWebAccessibleResources(entries) {
  const patterns = [];
  for (const entry of entries || []) {
    if (typeof entry === "string") {
      patterns.push(entry);
    } else if (entry && Array.isArray(entry.resources)) {
      patterns.push(
        ...entry.resources.filter((resource) => typeof resource === "string"),
      );
    }
  }
  return patterns;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", "[^/]*")}$`);
}

const warPatterns = resourcePatternsFromWebAccessibleResources(
  m.web_accessible_resources,
);
const warViolations = [];
for (const pattern of warPatterns) {
  if (pattern.includes("*")) {
    const regex = globToRegExp(pattern);
    if (!allRelFiles.some((rel) => regex.test(rel))) {
      warViolations.push(
        `web_accessible_resources glob has no matches: ${pattern}`,
      );
    }
  } else if (!fs.existsSync(path.join(distDir, pattern))) {
    warViolations.push(`web_accessible_resources missing resource: ${pattern}`);
  }
}

if (warViolations.length > 0) {
  console.error(
    `[validate-dist] ${target}: runtime web-accessible resource violation(s) —`,
  );
  for (const violation of warViolations) {
    console.error(`    - ${violation}`);
  }
  process.exit(1);
}

const devOnlyUrls = new Set([
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*",
  "http://localhost:8000/*",
  "http://127.0.0.1:8000/*",
  "http://127.0.0.1:8788/*",
]);
const manifestViolations = [];
for (const script of m.content_scripts || []) {
  if ((script.js || []).includes("js/content-scripts/dashboard-bridge.js")) {
    manifestViolations.push("content_scripts includes dashboard-bridge.js");
  }
  for (const match of script.matches || []) {
    if (devOnlyUrls.has(match)) {
      manifestViolations.push(`content_scripts includes dev-only match ${match}`);
    }
  }
}
for (const key of ["host_permissions", "permissions"]) {
  for (const permission of m[key] || []) {
    if (devOnlyUrls.has(permission)) {
      manifestViolations.push(`${key} includes dev-only URL ${permission}`);
    }
  }
}

if (manifestViolations.length > 0) {
  console.error(
    `[validate-dist] ${target}: release-safety violation(s) in manifest.json —`,
  );
  for (const violation of manifestViolations) {
    console.error(`    - ${violation}`);
  }
  process.exit(1);
}

const releaseViolations = [];

for (const abs of allFiles) {
  const rel = relPath(abs);
  const segments = rel.split("/");
  if (segments.includes("tests") || segments.includes("__tests__")) {
    releaseViolations.push(`${rel}: shipped test fixture`);
    continue;
  }

  const ext = path.extname(abs);
  if (ext !== ".html" && ext !== ".js") continue;

  const checks =
    ext === ".html"
      ? [
          {
            label: "remote HTML script",
            regex: /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i,
          },
          {
            label: "remote HTML link",
            regex: /<link\b[^>]*\bhref\s*=\s*["']https?:\/\//i,
          },
          {
            label: "runtime Babel fixture",
            regex: /<script\b[^>]*\btype\s*=\s*["']text\/babel["']/i,
          },
        ]
      : [
          {
            label: "remote importScripts",
            regex: /\bimportScripts\s*\(\s*["']https?:\/\//,
          },
          {
            label: "remote dynamic import",
            regex: /\bimport\s*\(\s*["']https?:\/\//,
          },
          {
            label: "dynamic code generation",
            regex: /\bnew\s+Function\s*\(|\beval\s*\(/,
          },
        ];

  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const check of checks) {
      if (check.regex.test(line)) {
        releaseViolations.push(`${rel}:${index + 1}: ${check.label}`);
      }
    }
  });
}

if (releaseViolations.length > 0) {
  console.error(
    `[validate-dist] ${target}: release-safety violation(s) in dist/${target} —`,
  );
  for (const violation of releaseViolations) {
    console.error(`    - ${violation}`);
  }
  process.exit(1);
}

if (process.env.DAMBI_STRIP_CONSOLE === "1") {
  const sensitiveLogPatterns = [
    /\[Dambi\]/,
    /Dambi SW alive/,
    /decoded ActionBody/,
    /wasm\.lowered-context/,
    /wasm\.evaluate-action-v2/,
    /tx\.incoming/,
    /typed-sig\.incoming/,
    /personal-sign\.incoming/,
    /registry-fetch/,
    /declarative-route-v3/,
    /declarative-verdict/,
    /HL \/exchange parsed/,
  ];
  const consoleCallPattern = /\bconsole\s*(?:\.|\[)[A-Za-z0-9_'"]+\s*\(/;
  const consoleViolations = [];
  for (const abs of allFiles) {
    if (path.extname(abs) !== ".js") continue;
    const rel = relPath(abs);
    const source = fs.readFileSync(abs, "utf8");
    if (consoleCallPattern.test(source)) {
      consoleViolations.push(`${rel}: console call survived stripped build`);
      continue;
    }
    const pattern = sensitiveLogPatterns.find((p) => p.test(source));
    if (pattern) {
      consoleViolations.push(`${rel}: sensitive debug log survived (${pattern})`);
    }
  }
  if (consoleViolations.length > 0) {
    console.error(
      `[validate-dist] ${target}: stripped-console violation(s) survived DAMBI_STRIP_CONSOLE=1 -`,
    );
    for (const violation of consoleViolations) {
      console.error(`    - ${violation}`);
    }
    process.exit(1);
  }
}

console.error(
  `[validate-dist] ${target}: all ${refs.size} load-critical manifest paths present; ` +
    `${warPatterns.length} web-accessible resource pattern(s) checked ✓`,
);
