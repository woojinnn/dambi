#!/usr/bin/env node
// Import dambi-docs (GitBook markdown) → marketplace seed JSON + validation report.
//
// Reads the wallet-guardians/dambi-docs checkout and extracts, for every policy
// page, the canonical slug (@id), Cedar source, manifest, severity, names and
// category. For every package page it extracts name/description/category and the
// member-policy codes (e.g. AMM-001), then resolves those codes back to policy
// slugs. Emits:
//   - policies.seed.json   one entry per policy (with parse + adapter status)
//   - packages.seed.json   one entry per package (with resolved members)
//   - report.html          human-readable mapping / validation report
//
// Usage: node import.mjs [DOCS_DIR] [OUT_DIR]
//   DOCS_DIR defaults to /tmp/dambi-docs/docs
//   OUT_DIR  defaults to ./out (next to this script)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const DOCS = process.argv[2] || "/tmp/dambi-docs/docs";
const OUT = process.argv[3] || path.join(__dirname, "out");

const POLICY_DIRS = [
  "standard-policies/market-offered-policies",
  "standard-policies/built-in-policies",
];
const PACKAGE_ROOT = "standard-packages/market-offered-packages";

// ── helpers ────────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim();
  }
  return fm;
}

// First "# CODE: name" heading → { code, nameKo }. Code like TOKEN-003 / AMM-001.
function heading(md) {
  const m = md.match(/^#\s+\\?\[?([A-Z]{2,}-\d+)\\?\]?\s*[:：]\s*(.+)$/m);
  if (m) return { code: m[1].toUpperCase(), nameKo: m[2].trim() };
  // package heading: "# \[DEX] Swap 기본 보호"
  const p = md.match(/^#\s+(.+)$/m);
  return { code: null, nameKo: p ? unesc(p[1].trim()) : null };
}

const unesc = (s) => (s || "").replace(/\\(\[|\]|\*)/g, "$1").trim();

// Body of a {% code title="X" %} ... fenced block ... {% endcode %}.
function codeBlock(md, title) {
  const re = new RegExp(
    `title="${title.replace(/[.]/g, "\\.")}"[\\s\\S]*?\\u0060\\u0060\\u0060[a-zA-Z]*\\n([\\s\\S]*?)\\u0060\\u0060\\u0060`,
  );
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

// Footer bold line just above "Wallet Guardians" — the English display name.
function footerName(md) {
  const lines = md.split("\n");
  const idx = lines.findIndex((l) => l.includes("Wallet Guardians"));
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0 && i >= idx - 6; i--) {
    const m = lines[i].match(/\*\*(.+?)\*\*/);
    if (m) return unesc(m[1].replace(/[:：].*$/, "").trim());
  }
  return null;
}

function methodsOf(manifest) {
  if (!manifest || !Array.isArray(manifest.policy_rpc)) return [];
  return manifest.policy_rpc.map((r) => r && r.method).filter(Boolean);
}

// ── policy docs (정의/범위/대상/데이터) ───────────────────────────────────────
// Each policy .md carries four prose sections under fixed headings:
//   ### Policy Definition (정책 정의) · #### Scope (적용 범위) ·
//   #### Audience (대상 사용자) · #### Used Data (판정에 사용될 데이터)
// followed by "#### Policy in Code". Extract the text between each heading and
// the next ## / ### / #### heading; strip blockquote markers + light markdown
// so it reads as plain prose on the listing detail page.
function docSection(md, labels) {
  const lines = md.split("\n");
  const isHeading = (l) => /^#{2,4}\s/.test(l);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i]) && labels.some((lab) => lines[i].includes(lab))) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return undefined;
  const buf = [];
  for (let i = start; i < lines.length; i++) {
    if (isHeading(lines[i])) break;
    buf.push(lines[i]);
  }
  let text = buf
    .join("\n")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "") // gitbook image figures
    .replace(/\{%[\s\S]*?%\}/g, "") // gitbook shortcodes
    .replace(/<[^>]+>/g, "") // stray HTML tags
    .replace(/&#x20;/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u0008\u200b\u200c\u200d\ufeff]/g, "") // control / zero-width
    .replace(/^\s*>\s?/gm, "") // blockquote markers
    .replace(/\*\*/g, "") // bold
    .replace(/`/g, "") // inline code ticks (keep the field name)
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2") // italic _x_ → x
    .replace(/[ \t]+/g, " ") // collapse runs of spaces (newlines kept)
    .replace(/[ \t]+$/gm, "") // trailing spaces per line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

function parseDoc(md) {
  const definition = docSection(md, ["정책 정의", "Policy Definition"]);
  const scope = docSection(md, ["적용 범위", "Scope"]);
  const audience = docSection(md, ["대상 사용자", "Audience"]);
  const usedData = docSection(md, ["판정에 사용될 데이터", "Used Data"]);
  if (!definition && !scope && !audience && !usedData) return undefined;
  const doc = {};
  if (definition) doc.definition = definition;
  if (scope) doc.scope = scope;
  if (audience) doc.audience = audience;
  if (usedData) doc.usedData = usedData;
  return doc;
}

// ── known adapter methods (what the engine actually IMPLEMENTS) ───────────────
// Source of truth = the policy_rpc dispatcher in the policy-server: handler.rs
// has one `"<method>" =>` match arm per implemented adapter. (Manifests only
// say which methods a policy *wants*, not which exist — so we read the dispatch.)
function knownMethods() {
  const set = new Set();
  const handler = path.join(REPO, "crates/policy-server/server/src/handler.rs");
  if (fs.existsSync(handler)) {
    const txt = fs.readFileSync(handler, "utf8");
    for (const m of txt.matchAll(/^\s*"([a-z_]+\.[a-z_]+)"\s*=>/gm)) set.add(m[1]);
  }
  return set;
}

// ── parse policies ───────────────────────────────────────────────────────────
function parsePolicies() {
  const policies = [];
  for (const rel of POLICY_DIRS) {
    const root = path.join(DOCS, rel);
    const builtin = rel.includes("built-in");
    for (const file of walk(root)) {
      const name = path.basename(file);
      if (name === "README.md") continue;
      const md = fs.readFileSync(file, "utf8");
      const fm = frontmatter(md);
      const h = heading(md);
      const cedar = codeBlock(md, "policy.cedar");
      const manifestRaw = codeBlock(md, "manifest.json");
      let manifest = null;
      let manifestError = null;
      if (manifestRaw) {
        try {
          manifest = JSON.parse(manifestRaw);
        } catch (e) {
          manifestError = String(e.message || e);
        }
      }
      const ids = cedar ? [...cedar.matchAll(/@id\("([^"]+)"\)/g)].map((m) => m[1]) : [];
      const severity = cedar ? (cedar.match(/@severity\("([^"]+)"\)/) || [])[1] || null : null;
      const slug = ids[0] || (manifest && manifest.id) || null;
      const category = builtin ? "built-in" : path.basename(path.dirname(file));
      const methods = methodsOf(manifest);

      const problems = [];
      if (!cedar) problems.push("no-cedar");
      if (!slug) problems.push("no-@id");
      if (manifestRaw && !manifest) problems.push("bad-manifest-json");
      if (ids.length > 1) problems.push(`multi-@id(${ids.length})`);
      const unknownMethods = methods.filter((m) => !KNOWN.has(m));

      let status;
      if (!cedar || !slug) status = "broken";
      else if (unknownMethods.length) status = "needs-adapter";
      else status = "clean";

      // Many policies (restaking, liquid-staking, most staking) have no code in
      // their heading — but the filename encodes it (e.g. restake-002.md,
      // lido-006.md). Fall back to that so every policy gets a display code.
      const fnameMatch = name.match(/^([a-z]+)-(\d+)/);
      const code = h.code || (fnameMatch ? `${fnameMatch[1].toUpperCase()}-${fnameMatch[2]}` : null);

      policies.push({
        code,
        slug,
        category,
        severity,
        name_ko: h.nameKo,
        description_en: fm.description || null,
        doc: parseDoc(md),
        builtin,
        cedar,
        manifest,
        methods,
        unknownMethods,
        ids,
        status,
        problems,
        manifestError,
        source: path.relative(DOCS, file),
      });
    }
  }
  return policies;
}

// ── parse packages ───────────────────────────────────────────────────────────
function parsePackages() {
  const packages = [];
  const root = path.join(DOCS, PACKAGE_ROOT);
  for (const file of walk(root)) {
    const name = path.basename(file);
    if (name === "README.md" || name === "others.md") continue;
    const md = fs.readFileSync(file, "utf8");
    const fm = frontmatter(md);
    const h = heading(md);
    const category = path.basename(path.dirname(file));
    const slug = path.basename(file, ".md");
    // Members live under "### 정책 목록" up to the next "***" or heading. Two
    // machine-readable forms appear: inline codes "(PERP-001)" and GitBook
    // content-ref file links. (A third form — prose only — isn't mappable.)
    let memberCodes = [];
    let memberRefs = [];
    const sec = md.split(/###\s*정책\s*목록/)[1];
    if (sec) {
      const block = sec.split(/\n\*\*\*|\n#{1,3}\s/)[0];
      memberCodes = [...new Set([...block.matchAll(/\(([A-Z]{2,}-\d+)\)/g)].map((m) => m[1].toUpperCase()))];
      // content-ref url="../../standard-policies/.../bridge-001.md" → doc-relative path
      memberRefs = [...new Set(
        [...block.matchAll(/content-ref\s+url="([^"]+\.md)"/g)].map((m) =>
          path.relative(DOCS, path.resolve(path.dirname(file), m[1])),
        ),
      )];
    }
    packages.push({
      slug,
      category,
      name_ko: h.nameKo,
      name_en: footerName(md),
      description_ko: fm.description || null,
      memberCodes,
      memberRefs,
      source: path.relative(DOCS, file),
    });
  }
  return packages;
}

// ── run ──────────────────────────────────────────────────────────────────────
const KNOWN = knownMethods();
const policies = parsePolicies();
const packages = parsePackages();

// code → policy and source-path → policy indexes (detect collisions)
const byCode = new Map();
const bySource = new Map();
const codeCollisions = [];
for (const p of policies) {
  bySource.set(p.source, p);
  if (!p.code) continue;
  if (byCode.has(p.code)) codeCollisions.push(p.code);
  else byCode.set(p.code, p);
}

// resolve package members from both inline codes and content-ref file links
for (const pkg of packages) {
  const members = new Map(); // slug → {code, slug, status}
  pkg.unresolved = [];
  for (const code of pkg.memberCodes) {
    const pol = byCode.get(code);
    if (pol && pol.slug) members.set(pol.slug, { ref: code, slug: pol.slug, status: pol.status });
    else pkg.unresolved.push(code);
  }
  for (const ref of pkg.memberRefs) {
    const pol = bySource.get(ref);
    if (pol && pol.slug) members.set(pol.slug, { ref: pol.code || path.basename(ref), slug: pol.slug, status: pol.status });
    else pkg.unresolved.push(path.basename(ref));
  }
  pkg.members = [...members.values()];
  pkg.status = pkg.members.length === 0 ? "empty" : pkg.unresolved.length ? "partial" : "clean";
}

// ── summary ──
const sum = {
  policies: {
    total: policies.length,
    clean: policies.filter((p) => p.status === "clean").length,
    needsAdapter: policies.filter((p) => p.status === "needs-adapter").length,
    broken: policies.filter((p) => p.status === "broken").length,
  },
  packages: {
    total: packages.length,
    clean: packages.filter((p) => p.status === "clean").length,
    partial: packages.filter((p) => p.status === "partial").length,
    empty: packages.filter((p) => p.status === "empty").length,
  },
  knownMethods: [...KNOWN].sort(),
  unknownMethods: [...new Set(policies.flatMap((p) => p.unknownMethods))].sort(),
  codeCollisions: [...new Set(codeCollisions)],
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "policies.seed.json"), JSON.stringify(policies, null, 2));
fs.writeFileSync(path.join(OUT, "packages.seed.json"), JSON.stringify(packages, null, 2));
fs.writeFileSync(path.join(OUT, "report.html"), renderHtml(sum, policies, packages));

// ── frontend demo seed: emitted at the end (after CAT_* consts are defined) ──
const seedTsPath = path.join(REPO, "browser-extension/dashboard/src/server-api/market-seed-dambi.ts");

// policy code prefix → dashboard CategoryKey
const CAT_BY_PREFIX = {
  TOKEN: "Token", AMM: "DEX", LEND: "Lending", PERP: "Perp", BRIDGE: "Bridge",
  LIDO: "LiquidStaking", STAKE: "Staking", RESTAKE: "Restaking", NFT: "NFT",
  AIRDROP: "Airdrop", LAUNCH: "Launchpad", OTHER: "Others", BASIC: "Others",
};
// package directory → dashboard CategoryKey
const CAT_BY_DIR = {
  "erc-20": "Token", "dex-amm": "DEX", lending: "Lending", perp: "Perp",
  bridge: "Bridge", "liquid-staking": "LiquidStaking", staking: "Staking",
  restaking: "Restaking", nft: "NFT", airdrop: "Airdrop", launchpad: "Launchpad",
};
// policy directory → dashboard CategoryKey. The directory is the reliable
// category source (the heading code is missing for many policies), so prefer it.
const CAT_BY_POLDIR = {
  "token-erc-20": "Token", "dex-amm": "DEX", lending: "Lending", perp: "Perp",
  bridge: "Bridge", "liquid-staking": "LiquidStaking", staking: "Staking",
  restaking: "Restaking", nft: "NFT", airdrop: "Airdrop", launchpad: "Launchpad",
};
function hash(s) {
  let x = 0;
  for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x;
}
function fakeStats(slug) {
  const h = hash(slug);
  return {
    installs: 150 + (h % 2000),
    rating: Math.round((4.3 + (h % 7) / 10) * 10) / 10,
    ratings: 6 + (h % 90),
  };
}
function renderCatalogTs(policies) {
  const cat = {};
  const code = {};
  for (const p of policies) {
    if (!p.slug || !p.cedar) continue;
    const prefix = (p.code || "").split("-")[0];
    cat[p.slug] = CAT_BY_POLDIR[p.category] || CAT_BY_PREFIX[prefix] || "Others";
    if (p.code) code[p.slug] = p.code;
  }
  return `/**
 * ⚠️ GENERATED — slug → category / code lookup from wallet-guardians/dambi-docs.
 * 생성: scripts/import-dambi-docs/import.mjs. The dashboard uses these to
 * classify and label any listing by its slug, so server-provided listings
 * (whose category may be null/server-taxonomy) still map to the dashboard
 * category and show their catalog code.
 */
import type { CategoryKey } from "../pages/market-domain";

export const SLUG_CATEGORY: Record<string, CategoryKey> = ${JSON.stringify(cat, null, 2)};

export const SLUG_CODE: Record<string, string> = ${JSON.stringify(code, null, 2)};
`;
}

function renderSeedTs(policies, packages) {
  const polBySlug = new Map(policies.filter((p) => p.slug).map((p) => [p.slug, p]));
  const POLS = policies
    .filter((p) => p.slug && p.cedar)
    .map((p) => {
      const s = fakeStats(p.slug);
      const prefix = (p.code || "").split("-")[0];
      // Strip editorial notes the docs left in headings, e.g. "(2번과 같아서
      // 삭제예정)", "(고점 시간을 정해놔야 할 것 같음 -> )".
      const cleanKo = (p.name_ko || p.slug).replace(/\s*\([^)]*(?:삭제|예정|같음|->|→)[^)]*\)\s*$/u, "").trim();
      return {
        slug: p.slug,
        code: p.code,
        name_ko: cleanKo,
        name_en: (p.description_en || cleanKo).replace(/\s*\((DENY|WARN)\)\s*$/i, ""),
        // Directory is the reliable category; built-in has no single dir so it
        // falls back to the code prefix.
        category: CAT_BY_POLDIR[p.category] || CAT_BY_PREFIX[prefix] || "Others",
        severity: p.severity === "deny" ? "deny" : "warn",
        cedar: p.cedar,
        manifest: p.manifest || null,
        ...s,
      };
    });
  const PKGS = packages.map((pkg) => {
    const s = fakeStats(pkg.slug);
    const members = pkg.members
      .map((m) => polBySlug.get(m.slug))
      .filter(Boolean)
      .map((pol) => ({
        slug: pol.slug,
        display_name: pol.name_ko || pol.slug,
        cedar_text: pol.cedar,
        manifest: pol.manifest || null,
      }));
    return {
      slug: pkg.slug,
      name_ko: pkg.name_ko || pkg.slug,
      name_en: pkg.name_en || pkg.name_ko || pkg.slug,
      description_ko: pkg.description_ko || "",
      category: CAT_BY_DIR[pkg.category] || "Others",
      members,
      ...s,
    };
  });

  return `/**
 * ⚠️ GENERATED — wallet-guardians/dambi-docs 전체 임포트 데모 시드.
 * 생성: scripts/import-dambi-docs/import.mjs (직접 수정 금지, 재생성하세요).
 * 로컬에서 마켓 화면을 채우기 위한 폴백. 실데이터 올라오면 market.ts 의
 * import 를 "./market-seed-beginner" 로 되돌리면 됩니다.
 */
import type { ListingDetail, ListingSummary } from "./market";

const RELEASED = Date.UTC(2026, 5, 12) / 1000;

interface SeedPol { slug: string; code: string | null; name_ko: string; name_en: string; category: string; severity: "deny" | "warn"; cedar: string; manifest: unknown; installs: number; rating: number; ratings: number; }
interface SeedMember { slug: string; display_name: string; cedar_text: string; manifest: unknown; }
interface SeedPkg { slug: string; name_ko: string; name_en: string; description_ko: string; category: string; installs: number; rating: number; ratings: number; members: SeedMember[]; }

const POLICIES: SeedPol[] = ${JSON.stringify(POLS, null, 2)};

const PACKAGES: SeedPkg[] = ${JSON.stringify(PKGS, null, 2)};

function polSummary(p: SeedPol): ListingSummary {
  return {
    id: \`seed-\${p.slug}\`, slug: p.slug, code: p.code ?? undefined, kind: "policy",
    publisher_id: "wallet-guardians", publisher_tier: "official",
    display_name: { en: p.name_en, ko: p.name_ko },
    description: { en: p.name_en, ko: p.name_ko },
    category: p.category, severity: p.severity, status: "published",
    current_version: "1.0.0", created_at: RELEASED, updated_at: RELEASED,
    install_count: p.installs, rating_avg: p.rating, rating_count: p.ratings,
    is_installed: false,
  };
}
function pkgSummary(p: SeedPkg): ListingSummary {
  return {
    id: \`seed-\${p.slug}\`, slug: p.slug, kind: "set",
    publisher_id: "wallet-guardians", publisher_tier: "official",
    display_name: { en: p.name_en, ko: p.name_ko },
    description: { en: p.description_ko, ko: p.description_ko },
    category: p.category, status: "published",
    current_version: "1.0.0", created_at: RELEASED, updated_at: RELEASED,
    install_count: p.installs, rating_avg: p.rating, rating_count: p.ratings,
    is_installed: false,
  };
}

export function seedListings(): ListingSummary[] {
  return [...PACKAGES.map(pkgSummary), ...POLICIES.map(polSummary)];
}

export function seedDetail(slug: string): ListingDetail | null {
  const pkg = PACKAGES.find((p) => p.slug === slug);
  if (pkg) {
    return {
      ...pkgSummary(pkg),
      latest_version: {
        listing_id: \`seed-\${pkg.slug}\`, version: "1.0.0", major: 1, minor: 0, patch: 0,
        members: pkg.members.map((m) => ({ slug: m.slug, display_name: m.display_name, cedar_text: m.cedar_text, manifest: m.manifest })),
        published_at: RELEASED,
      },
      recent_reviews: [],
    };
  }
  const p = POLICIES.find((x) => x.slug === slug);
  if (!p) return null;
  return {
    ...polSummary(p),
    latest_version: {
      listing_id: \`seed-\${p.slug}\`, version: "1.0.0", major: 1, minor: 0, patch: 0,
      cedar_text: p.cedar, manifest: p.manifest, published_at: RELEASED,
    },
    recent_reviews: [],
  };
}
`;
}

console.log("Policies:", JSON.stringify(sum.policies));
console.log("Packages:", JSON.stringify(sum.packages));
console.log("Known adapter methods:", sum.knownMethods.length);
console.log("Unknown (need adapter):", sum.unknownMethods.length);
console.log("Code collisions:", sum.codeCollisions.length);
console.log("→ wrote", path.join(OUT, "report.html"));

fs.writeFileSync(seedTsPath, renderSeedTs(policies, packages));
console.log("→ wrote", seedTsPath);

// Catalog maps (slug → category / code). Used by the dashboard to classify and
// label ANY listing by slug, regardless of whether it came from the server or
// the seed — so remote listings (whose `category` field doesn't match the
// dashboard taxonomy) still resolve to the right category + show their code.
const catalogPath = path.join(REPO, "browser-extension/dashboard/src/server-api/dambi-catalog.ts");
fs.writeFileSync(catalogPath, renderCatalogTs(policies));
console.log("→ wrote", catalogPath);

// ── HTML report ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function badge(status) {
  const map = {
    clean: ["#0a7d28", "#e3f5e9", "그대로 가능"],
    "needs-adapter": ["#9a6700", "#fff5d6", "어댑터 필요"],
    broken: ["#b42318", "#fee4e2", "파싱 실패"],
    partial: ["#9a6700", "#fff5d6", "일부 매핑"],
    empty: ["#b42318", "#fee4e2", "멤버 0"],
  };
  const [c, bg, label] = map[status] || ["#555", "#eee", status];
  return `<span class="b" style="color:${c};background:${bg}">${label}</span>`;
}
function renderHtml(sum, policies, packages) {
  const polRows = policies
    .slice()
    .sort((a, b) => (a.category + a.code).localeCompare(b.category + b.code))
    .map(
      (p) => `<tr class="st-${p.status}">
      <td>${esc(p.code || "—")}</td>
      <td>${esc(p.category)}</td>
      <td><code>${esc(p.slug || "—")}</code></td>
      <td>${esc(p.severity || "")}</td>
      <td>${badge(p.status)}</td>
      <td>${p.methods.map((m) => `<code class="${p.unknownMethods.includes(m) ? "mu" : "mk"}">${esc(m)}</code>`).join(" ") || '<span class="dim">(RPC 없음)</span>'}</td>
      <td>${esc(p.name_ko || "")}</td>
      <td class="dim">${esc(p.problems.join(", "))}</td>
    </tr>`,
    )
    .join("\n");

  const pkgRows = packages
    .slice()
    .sort((a, b) => (a.category + a.slug).localeCompare(b.category + b.slug))
    .map(
      (p) => `<tr class="st-${p.status}">
      <td>${esc(p.name_ko || p.slug)}<div class="dim">${esc(p.name_en || "")}</div></td>
      <td>${esc(p.category)}</td>
      <td><code>${esc(p.slug)}</code></td>
      <td>${badge(p.status)}</td>
      <td>${p.members.map((m) => `<code class="${m.status === "clean" ? "mk" : "mu"}" title="${esc(m.slug)}">${esc(m.ref)}</code>`).join(" ")}</td>
      <td>${p.unresolved.map((c) => `<code class="mx">${esc(c)}</code>`).join(" ") || '<span class="dim">—</span>'}</td>
    </tr>`,
    )
    .join("\n");

  const card = (label, val, sub) =>
    `<div class="card"><div class="n">${val}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dambi-docs → 마켓 임포트 리포트</title>
<style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  body{margin:0;background:#f6f7f9;color:#1b222c}
  .wrap{max-width:1200px;margin:0 auto;padding:28px 22px 80px}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#697485;font-size:13px;margin-bottom:22px}
  h2{font-size:15px;margin:34px 0 12px;border-bottom:2px solid #e6e8ec;padding-bottom:6px}
  .cards{display:flex;gap:12px;flex-wrap:wrap}
  .card{background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:14px 18px;min-width:130px}
  .card .n{font-size:26px;font-weight:700} .card .l{font-size:12px;color:#697485;margin-top:2px} .card .s{font-size:11px;color:#9aa3b0;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e6e8ec;border-radius:10px;overflow:hidden;font-size:12.5px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eef0f3;vertical-align:top}
  th{background:#fafbfc;font-size:11px;color:#697485;text-transform:uppercase;letter-spacing:.03em;position:sticky;top:0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#f1f3f5;padding:1px 5px;border-radius:5px}
  code.mk{background:#e3f5e9;color:#0a7d28} code.mu{background:#fff5d6;color:#9a6700} code.mx{background:#fee4e2;color:#b42318}
  .b{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .dim{color:#9aa3b0;font-size:11px} .legend{font-size:12px;color:#697485;margin:10px 0}
  .legend code{margin:0 2px}
  tr.st-broken td,tr.st-empty td{background:#fffafa}
  details{margin:8px 0}
</style></head><body><div class="wrap">
<h1>dambi-docs → 마켓플레이스 임포트 리포트</h1>
<div class="sub">소스: wallet-guardians/dambi-docs · 생성 스크립트: scripts/import-dambi-docs/import.mjs</div>

<h2>정책 (Policies)</h2>
<div class="cards">
  ${card("정책 파일", sum.policies.total)}
  ${card("그대로 가능", sum.policies.clean, "Cedar+manifest OK, 어댑터 있음")}
  ${card("어댑터 필요", sum.policies.needsAdapter, "임포트는 되나 RPC 미구현")}
  ${card("파싱 실패", sum.policies.broken, "cedar/@id 없음")}
</div>

<h2>패키지 (Packages)</h2>
<div class="cards">
  ${card("패키지 파일", sum.packages.total)}
  ${card("멤버 전부 매핑", sum.packages.clean)}
  ${card("일부만 매핑", sum.packages.partial)}
  ${card("멤버 0", sum.packages.empty)}
</div>

<h2>어댑터(RPC 메서드) 커버리지</h2>
<div class="legend">
  코드베이스 지원 메서드 <b>${sum.knownMethods.length}</b>개: ${sum.knownMethods.map((m) => `<code class="mk">${esc(m)}</code>`).join("")}<br>
  문서가 요구하는 <b>미지원</b> 메서드 <b>${sum.unknownMethods.length}</b>개: ${sum.unknownMethods.map((m) => `<code class="mu">${esc(m)}</code>`).join("")}
</div>
${sum.codeCollisions.length ? `<div class="legend">⚠️ 코드 충돌: ${sum.codeCollisions.map((c) => `<code class="mx">${esc(c)}</code>`).join("")}</div>` : ""}

<h2>패키지 매핑 상세 (${packages.length})</h2>
<div class="legend">멤버 코드: <code class="mk">초록=그대로 가능</code> <code class="mu">노랑=어댑터 필요</code> · 미해결 = 참조했지만 정책 파일 없음</div>
<table><thead><tr><th>패키지</th><th>카테고리</th><th>slug</th><th>상태</th><th>멤버(코드)</th><th>미해결 코드</th></tr></thead>
<tbody>${pkgRows}</tbody></table>

<h2>정책 매핑 상세 (${policies.length})</h2>
<div class="legend">RPC: <code class="mk">초록=지원</code> <code class="mu">노랑=미지원</code></div>
<table><thead><tr><th>코드</th><th>카테고리</th><th>slug(@id)</th><th>severity</th><th>상태</th><th>RPC 메서드</th><th>이름</th><th>문제</th></tr></thead>
<tbody>${polRows}</tbody></table>

</div></body></html>`;
}
