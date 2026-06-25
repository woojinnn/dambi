#!/usr/bin/env node
/* STEP 4-B.3 — off-scale 타입스케일 린트 가드 (read-only).
 *
 * 원칙: "인벤토리가 진실" — 아래 HEADINGS(실제 제목 자리 큐레이트 집합)만 검사한다.
 *   caption/label/list-item name/divider/icon/숫자 등은 제목이 아니므로 대상 외(오탐 방지).
 *   새 제목 클래스가 생기면 HEADINGS에 추가하는 것이 유지보수 계약이다.
 *
 * 검사: 각 제목 셀렉터의 **유효(파일 내 마지막) 선언**을 본다(append-override 인식).
 *   size별(역할별) weight를 강제한다:
 *     size 28 (H1)      → weight 700
 *     size 22 (Title)   → weight 700   ← 600 금지(Title 700 전역 통일 보장)
 *     size 16 (Subhead) → weight 600
 *     size 14 (Body)    → weight 400
 *     size 12.5(Caption)→ weight 400
 *     size 12 (Label)   → weight 600
 *   그 외 size = off-scale fail. size↔weight 불일치 = fail. var(--text-ROLE-*) = 역할 자동인식.
 *
 * ★ 전제: 이 린트는 **size를 키로 역할을 식별**한다 — size↔역할 1:1 전제.
 *    현재 6역할이 전부 다른 size(28/22/16/14/12.5/12)라 성립한다. 나중에 같은 size에 다른
 *    역할이 생기면 이 매핑이 깨지니, 그땐 역할 식별 키를 size 외(클래스/data-attr 등)로 바꿔야 함.
 * ★ 경계: 이 가드가 보는 것 = **size + weight 뿐**. lh/letter-spacing 은 검사하지 않는다
 *    (누가 Title의 ls를 0으로 되돌려도 통과한다). 정의는 토큰/유틸이 보장, 린트는 size+weight만 본다.
 *    Label의 uppercase·ls 0.08em 도 '스케일 정의'이지 린트 검사 항목이 아니다.
 *
 * 예외: ⓐ EXEMPT(보류 자리: crumb 20→28) ⓑ editor/frontend 경로 제외.
 * 사용: node scripts/lint-typescale.mjs   (위반 시 exit 1)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const SCAN_DIRS = ["pages", "shell", "components"].map((d) => join(SRC, d));

// 역할 정의(린트가 강제하는 계약). size↔역할 1:1 (위 전제 주석 참조).
const ROLES = {
  h1:      { size: "28",   weight: "700" },
  title:   { size: "22",   weight: "700" },
  subhead: { size: "16",   weight: "600" },
  body:    { size: "14",   weight: "400" },
  caption: { size: "12.5", weight: "400" },
  label:   { size: "12",   weight: "600" },
};
const SIZE_ROLE = Object.fromEntries(Object.entries(ROLES).map(([r, v]) => [v.size, r]));

// 큐레이트된 제목 인벤토리 (STEP 4-B.1 분류).
const HEADINGS = new Set([
  ".rm-md-head h1", ".rm-hero-cat .nm",
  ".rm-rev-head h2", ".rm-shead-ttl", ".rm-hero2 .ttl", ".featured-pkg-name",
  ".featured-card-name", ".im-title", ".im-headmeta .im-title", ".pub-title",
  ".market-empty h2", ".sw-step-head h2", ".sim-login-gate h2",
  ".rm-sec-head h2", ".rm-card-name", ".rm-lv-head h2", ".lv-section-head h2",
  ".mc-name", ".rm-rname", ".rm-featured .name", ".rm-pagehead .logo",
  ".wc-name", ".dp-id .name", ".wv-title", ".sec-head h3", ".pp-sec-head h2",
  ".sw-policy-name", ".sw-pkg-name", ".sd-name", ".w1-card.embed .w1-name",
  ".sw-deny-head b", ".modal-head h3",
]);
const EXEMPT = new Set([".crumb .here"]); // 의도적 보류(레이아웃 리스크)

function cssFiles(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (/editor/i.test(p)) continue;
    const s = statSync(p);
    if (s.isDirectory()) out = out.concat(cssFiles(p));
    else if (e.endsWith(".css")) out.push(p);
  }
  return out;
}
const norm = (s) => s.replace(/\s+/g, " ").trim();
const lineOf = (t, i) => t.slice(0, i).split("\n").length;

// 선언에서 역할(또는 리터럴 값) 해석. → {sizeRole|null, sizeBad|null, weightVal|null}
function resolve(body) {
  const short = /font:\s*([^;]+)/i.exec(body);
  // size
  let sizeRole = null, sizeBad = null;
  const fsVar = /font-size:\s*var\(--text-([a-z0-9]+)-size\)/i.exec(body);
  const fsLit = /font-size:\s*(\d+(?:\.\d+)?)px/i.exec(body) || (short && /(\d+(?:\.\d+)?)px/.exec(short[1]));
  if (fsVar) sizeRole = fsVar[1];
  else if (fsLit) { const px = fsLit[1]; sizeRole = SIZE_ROLE[px] || null; if (!SIZE_ROLE[px]) sizeBad = px + "px"; }
  // weight
  let weightVal = null;
  const fwVar = /font-weight:\s*var\(--text-([a-z0-9]+)-weight\)/i.exec(body);
  const fwLit = /font-weight:\s*([1-9]00|normal|bold)/i.exec(body) || (short && /(?:^|\s)([1-9]00)\s/.exec(short[1]));
  if (fwVar) weightVal = ROLES[fwVar[1]] ? ROLES[fwVar[1]].weight : "??";
  else if (fwLit) weightVal = fwLit[1] === "normal" ? "400" : fwLit[1] === "bold" ? "700" : fwLit[1];
  return { sizeRole, sizeBad, weightVal };
}

const violations = [];
for (const file of SCAN_DIRS.flatMap(cssFiles)) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rel = relative(join(SRC, ".."), file);
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  const last = new Map();
  let m;
  while ((m = ruleRe.exec(css))) {
    const parts = m[1].split(",").map(norm);
    const body = m[2];
    const ln = lineOf(css, m.index);
    for (const p of parts) if (HEADINGS.has(p)) last.set(p, { body, ln });
  }
  for (const [sel, { body, ln }] of last) {
    if (EXEMPT.has(sel)) continue;
    const { sizeRole, sizeBad, weightVal } = resolve(body);
    if (sizeBad) { violations.push({ rel, ln, sel, msg: `off-scale size ${sizeBad}` }); continue; }
    if (sizeRole) {
      const want = ROLES[sizeRole].weight;
      if (weightVal && weightVal !== want)
        violations.push({ rel, ln, sel, msg: `size ${ROLES[sizeRole].size}(${sizeRole})→weight ${want} 강제, got ${weightVal}` });
    } else if (weightVal && !["400", "600", "700"].includes(weightVal)) {
      violations.push({ rel, ln, sel, msg: `off-scale weight ${weightVal}` });
    }
  }
}

if (violations.length === 0) {
  console.log(`✅ typescale lint: 제목 인벤토리 ${HEADINGS.size}개 전부 on-scale (size별 weight 강제: H1/Title=700, Subhead/Label=600, Body/Caption=400). EXEMPT: ${[...EXEMPT].join(", ")}`);
  process.exit(0);
}
console.log(`❌ typescale lint: ${violations.length}건 위반\n`);
for (const v of violations) console.log(`  ${v.rel}:${v.ln}  ${v.sel}\n      ${v.msg}`);
process.exit(1);
