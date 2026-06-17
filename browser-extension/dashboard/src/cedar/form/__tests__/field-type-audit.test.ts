/**
 * 필드 타입 전수조사 — "숫자로 비교해야 하는데 문자(=/≠)로 입력받는" 필드를 찾는다.
 *
 * 모든 액션에 대해 fieldsForTrigger()를 실제로 돌려, 각 필드의 fieldKind/연산자/
 * advanced 여부를 수집하고, 이름상 '크기(amount/gas/price/…)'인데 String 으로 잡혀
 * ==/≠ 텍스트만 가능한 필드(=SUSPECT)를 표로 만든다. 결과를 HTML 로 떨어뜨린다.
 *
 * 실행: node_modules/.bin/vitest run src/cedar/form/__tests__/field-type-audit.test.ts
 */
import { writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { fieldsForTrigger, operatorsFor } from "../field-catalog";
import { SCHEMA_CATALOG } from "../schema-catalog.generated";
import type { FormTrigger } from "../model";

/** 이름상 '숫자 크기'를 뜻하는 leaf — 이런 게 String 이면 보통 ==/≠ 만 가능해 의심. */
const NUMERIC_LEAF =
  /amount|amt|qty|quantity|count|gas|fee|price|value|usd|wei|gwei|balance|cap|limit|threshold|leverage|slippage|ratio|pct|percent|score|deadline|expiry|horizon|duration|exposure|streak|notional|collateral|reserve|liquidity|^min|^max|out$|^net|estimate/i;

/** 주소/식별자/모드 등 — 숫자가 아니므로 String 이어도 정상(오탐 제외). */
const NON_NUMERIC_LEAF =
  /address|contract|recipient|spender|owner|account|operator|delegatee|validator|builder|swapper|offerer|representative|sig|signature|proof|hash|nonce|salt|id$|^orderHash|kind|mode|side|^type|standard|support|tif|name|chain|venue|pool|factory|router|reactor|settlement|domain/i;

interface Row {
  action: string;
  path: string;
  leaf: string;
  label: string;
  kind: string;
  ops: string;
  advanced: boolean;
  numericLooking: boolean;
  suspect: boolean; // String + 숫자이름 + 비교연산 없음 + 화면 노출(advanced 아님) → 남은 문제
  fixedHidden: boolean; // String + 숫자이름 + 이제 advanced(숨김) → 이번 수정으로 처리됨
}

function triggerFor(key: string): FormTrigger {
  const [ns, id] = key.split("::");
  return { kind: "actionEq", entityType: `${ns}::Action`, id };
}

// 수동 감사 도구 — CI 에선 산출물(html)을 안 만들도록 FIELD_AUDIT=1 일 때만 실행.
//   FIELD_AUDIT=1 node_modules/.bin/vitest run src/cedar/form/__tests__/field-type-audit.test.ts
describe.skipIf(!process.env.FIELD_AUDIT)("field-type audit", () => {
  it("collects String-typed numeric-looking fields and writes an HTML report", () => {
    const rows: Row[] = [];
    for (const key of Object.keys(SCHEMA_CATALOG)) {
      if (key === "*") continue;
      const trigger = triggerFor(key);
      for (const f of fieldsForTrigger(trigger)) {
        if (f.source !== "base") continue; // 보강 필드 제외(여긴 정적 스키마만)
        const leaf = f.path.split(".").pop()!;
        const ops = operatorsFor(f.fieldKind);
        const numericLooking = NUMERIC_LEAF.test(leaf) && !NON_NUMERIC_LEAF.test(leaf);
        const hasOrdering = ops.includes("<") || ops.includes(">");
        const isStr = f.fieldKind === "primitive.String";
        const suspect = isStr && numericLooking && !hasOrdering && !f.advanced;
        // "이번 변경으로 새로 숨김" = 얕은(depth<2) 숫자-String 이고, 기존 정규식이
        // 못 잡던 것. (깊이 규칙으로 원래 숨겨지던 건 제외해 과대집계 방지.)
        const OLD_REGEX = /amount|^buyMin|^sellAmount|^netInput|^minOut/i;
        const deep = f.path.split(".").slice(1).filter((s) => s !== "key").length >= 2;
        const fixedHidden = isStr && numericLooking && !!f.advanced && !deep && !OLD_REGEX.test(leaf);
        rows.push({
          action: key,
          path: f.path,
          leaf,
          label: f.label,
          kind: f.fieldKind,
          ops: ops.join(" "),
          advanced: !!f.advanced,
          numericLooking,
          suspect,
          fixedHidden,
        });
      }
    }

    const suspects = rows.filter((r) => r.suspect);
    // 콘솔에 SUSPECT leaf 들을 찍어 정규식 보정에 쓴다.
    const byLeaf = [...new Set(suspects.map((r) => r.leaf))].sort();
    // eslint-disable-next-line no-console
    console.log(`\n[audit] total=${rows.length}  suspect=${suspects.length}  distinctSuspectLeaves=${byLeaf.length}`);
    // eslint-disable-next-line no-console
    console.log("[audit] suspect leaves:", byLeaf.join(", "));

    writeFileSync("field-type-audit.html", renderHtml(rows), "utf8");
    expect(rows.length).toBeGreaterThan(0);
  });
});

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function renderHtml(rows: Row[]): string {
  const suspects = rows.filter((r) => r.suspect);
  const fixed = rows.filter((r) => r.fixedHidden);
  const strNumeric = rows.filter((r) => r.kind === "primitive.String" && r.numericLooking);
  const verdict = (r: Row) =>
    r.suspect ? "⚠ 남은 문제" : r.fixedHidden ? "✓ 새로 숨김" : "";
  const tableRows = rows
    .slice()
    .sort(
      (a, b) =>
        Number(b.suspect) - Number(a.suspect) ||
        Number(b.fixedHidden) - Number(a.fixedHidden) ||
        a.action.localeCompare(b.action) ||
        a.path.localeCompare(b.path),
    )
    .map(
      (r) => `<tr class="${r.suspect ? "suspect" : r.fixedHidden ? "fixed" : r.advanced ? "adv" : ""}">
      <td>${esc(r.action)}</td><td class="mono">${esc(r.path)}</td><td>${esc(r.label)}</td>
      <td>${esc(r.kind)}</td><td class="mono">${esc(r.ops)}</td>
      <td>${r.numericLooking ? "✓" : ""}</td><td>${r.advanced ? "숨김" : ""}</td>
      <td>${verdict(r)}</td></tr>`,
    )
    .join("\n");
  const fixedList = [...new Set(fixed.map((r) => r.leaf))].sort().join(", ");
  return `<!doctype html><meta charset="utf-8"><title>Field type audit</title>
<style>
 body{font:13px/1.5 -apple-system,system-ui,sans-serif;margin:24px;color:#222}
 h1{font-size:19px} .sum{background:#f4f6f8;border:1px solid #e2e6ea;border-radius:8px;padding:12px 16px;margin:12px 0}
 table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #e2e6ea;padding:4px 7px;text-align:left;vertical-align:top}
 th{background:#fafbfc;position:sticky;top:0} .mono{font-family:ui-monospace,Menlo,monospace;font-size:11px}
 tr.suspect{background:#fff3f0} tr.suspect td:last-child{color:#c0392b;font-weight:700}
 tr.fixed{background:#eefaf0} tr.fixed td:last-child{color:#1a8a3c;font-weight:700}
 tr.adv{color:#999} .pill{display:inline-block;padding:1px 8px;border-radius:999px;background:#e8f0e8;margin-right:6px}
</style>
<h1>필드 타입 전수조사 — 숫자여야 하는데 문자(=/≠)로 비교되던 필드</h1>
<div class="sum">
 <b>전체 필드</b> ${rows.length}개 ·
 <span class="pill">String+숫자이름(전체) ${strNumeric.length}</span>
 <span class="pill" style="background:#cdeccf">✓ 이번에 새로 숨김 ${fixed.length}</span>
 <span class="pill" style="background:#ffd9cf">⚠ 남은 문제 ${suspects.length}</span><br/>
 <b>판정 기준</b>: String 타입인데 leaf 이름이 숫자 크기(amount/gas/price/leverage/…)라 ==/≠ 텍스트로만 비교 가능한 필드.
 이런 값은 uint256/hex·big-int 라 Cedar 에서 정렬(&lt; &gt;) 비교가 불가능 → 숫자 비교를 흉내내면 안 되므로
 <b>고급(숨김)으로 demote + LLM 후보에서 제외</b>했다. 사용자는 같은 의미의 숫자 형제 필드(USD/Nano/Bp/decimal)를 쓰면 된다.<br/>
 <b>수정된 leaf</b>(중복 제거): ${esc(fixedList) || "(없음)"}<br/>
 <b>한계</b>: 숫자 형제 필드가 아직 없는 항목(gas/price/leverage 등)은 정밀 숫자 비교를 하려면 보강 메서드(enrichment)로
 decimal 값을 새로 만들어야 한다(차기 작업).
</div>
<table>
 <thead><tr><th>액션</th><th>경로</th><th>라벨</th><th>fieldKind</th><th>연산자</th><th>숫자이름?</th><th>표시</th><th>판정</th></tr></thead>
 <tbody>${tableRows}</tbody>
</table>`;
}
