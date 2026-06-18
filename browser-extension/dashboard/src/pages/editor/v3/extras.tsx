// @ts-nocheck
import * as React from "react";

import { Cedar } from "./cedar";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const isAddr = (s) => ADDR_RE.test(String(s).trim());

export function KindDot({ kind }) {
  return <span className={`pf-addr-dot ${kind}`} aria-hidden />;
}

function useAddrMatches(query, exclude) {
  const q = String(query).trim().toLowerCase();
  return Cedar.AddressBook.suggestions
    .filter((s) => !exclude || !exclude.has(s.address.toLowerCase()))
    .filter((s) => q === "" || s.name.toLowerCase().includes(q) || s.address.includes(q))
    .slice(0, 8);
}

export function AddressInput({ value, onChange }) {
  const [focused, setFocused] = React.useState(false);
  const entry = Cedar.AddressBook.lookup(value);
  const matches = useAddrMatches(focused && !entry ? value : "  ");
  const showPop = focused && !entry && matches.length > 0;
  const bad = !focused && value.trim() !== "" && !isAddr(value) && !entry;
  return (
    <span className="pf-addr">
      <input
        className={`pf-val mono${bad ? " invalid" : ""}${entry ? " resolved" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        placeholder="0x… 또는 이름 검색"
        spellCheck={false}
        autoComplete="off"
      />
      {entry && (
        <span className="pf-addr-name" title={value}>
          <KindDot kind={entry.kind} />
          {entry.name}
        </span>
      )}
      {showPop && (
        <div className="pf-addr-pop" role="listbox">
          {matches.map((m) => (
            <button
              type="button"
              key={m.address}
              className="pf-addr-opt"
              onMouseDown={(e) => { e.preventDefault(); onChange(m.address); setFocused(false); }}
            >
              <KindDot kind={m.kind} />
              <span className="nm">{m.name}</span>
              <span className="sub">{m.sub} · {Cedar.shortAddress(m.address)}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function AddressSetInput({ values, onChange }) {
  const [draft, setDraft] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef(null);
  const have = React.useMemo(() => new Set(values.map((v) => v.trim().toLowerCase())), [values]);
  const matches = useAddrMatches(focused ? draft : "  ", have);

  const addMany = (raw) => {
    const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft("");
  };
  const remove = (v) => onChange(values.filter((x) => x !== v));

  return (
    <div className="pf-addrset">
      <div className="pf-addrset-chips">
        {values.map((v) => {
          const e = Cedar.AddressBook.lookup(v);
          const bad = !isAddr(v) && !e;
          return (
            <span key={v} className={`pf-addrchip${bad ? " invalid" : ""}`} title={v}>
              {e && <KindDot kind={e.kind} />}
              <span className="t">{e ? e.name : Cedar.shortAddress(v)}</span>
              <button type="button" className="x" onClick={() => remove(v)} aria-label="제거">×</button>
            </span>
          );
        })}
      </div>
      <span className="pf-addr">
        <input
          ref={inputRef}
          className="pf-val mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (draft.trim()) addMany(draft); }
            else if (e.key === "Backspace" && draft === "" && values.length) remove(values[values.length - 1]);
          }}
          placeholder="주소 추가 (0x… 또는 이름)"
          spellCheck={false}
          autoComplete="off"
        />
        {focused && matches.length > 0 && (
          <div className="pf-addr-pop" role="listbox">
            {matches.map((m) => (
              <button
                type="button"
                key={m.address}
                className="pf-addr-opt"
                onMouseDown={(e) => { e.preventDefault(); addMany(m.address); inputRef.current && inputRef.current.focus(); }}
              >
                <KindDot kind={m.kind} />
                <span className="nm">{m.name}</span>
                <span className="sub">{m.sub} · {Cedar.shortAddress(m.address)}</span>
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

/* ════════════════════ CustomFieldModal ════════════════════ */
const PARAM_KEY_LABEL = { chain_id: "체인", asset: "자산(토큰)", amount: "수량", address: "주소", wallet: "지갑", decimals: "소수점" };
const paramKeyLabel = (key) => PARAM_KEY_LABEL[key] || key;
const PARAM_KIND = { chain_id: "chain", asset: "address", address: "address", wallet: "address", amount: "amount" };
const kindOf = (key) => PARAM_KIND[key] || "any";
function kindChip(kind) {
  switch (kind) { case "chain": return "체인"; case "address": return "주소"; case "amount": return "금액"; default: return null; }
}

function autoName(methodName, existing) {
  const tail = methodName.split(".").pop() || "value";
  const base = tail.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) { const cand = `${base}${i}`; if (!existing.includes(cand)) return cand; }
}
function buildOptions(fields) {
  const root = [
    { sel: "$.root.chain_id", label: "체인 ID (이 거래)", isChain: true, isAddress: false, isAmount: false },
    { sel: "$.root.from", label: "보내는 주소 (이 거래)", isChain: false, isAddress: true, isAmount: false },
    { sel: "$.root.to", label: "받는 컨트랙트 (이 거래)", isChain: false, isAddress: true, isAmount: false },
  ];
  const action = fields
    .filter((f) => f.source === "base" && f.path.startsWith("context.") && f.fieldKind.startsWith("primitive."))
    .map((f) => {
      const leaf = f.path.split(".").pop() || "";
      return {
        sel: `$.action.${f.path.slice("context.".length)}`,
        label: f.label,
        isChain: leaf === "chain",
        isAddress: f.role === "address",
        isAmount: /amount|size|qty/i.test(leaf) || f.fieldKind === "primitive.Long" || f.fieldKind === "primitive.decimal",
      };
    });
  return [...root, ...action];
}
function optionsFor(key, all) {
  switch (kindOf(key)) {
    case "chain": return all.filter((o) => o.isChain);
    case "address": return all.filter((o) => o.isAddress);
    case "amount": return all.filter((o) => o.isAmount);
    default: return all;
  }
}
function defaultParams(m, all) {
  const out = {};
  for (const [key, spec] of Object.entries(m.params)) {
    const raw = (spec && typeof spec === "object" && "literal" in spec) ? String(spec.literal) : String(spec);
    if (!raw.startsWith("$.")) { out[key] = raw; continue; }
    const opts = optionsFor(key, all);
    out[key] = opts.some((o) => o.sel === raw) ? raw : (opts[0] ? opts[0].sel : "");
  }
  return out;
}
function parseParam(v) {
  const t = String(v).trim();
  if (t.startsWith("$.")) return t;
  if (t === "true" || t === "false") return { literal: t === "true" };
  if (t !== "" && !Number.isNaN(Number(t))) return { literal: Number(t) };
  return { literal: t };
}
function paramSpecs(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = parseParam(v);
  return out;
}
function sortedParams(p) {
  return Object.entries(p).sort(([a], [b]) => a.localeCompare(b));
}

function ParamPicker({ value, options, onChange }) {
  const known = options.find((o) => o.sel === value);
  const mode = known ? "known" : (value.startsWith("$.") ? "raw" : "lit");
  return (
    <span className="cfm-pick">
      <select
        className="pf-select"
        value={known ? value : (mode === "raw" ? "__raw" : "__lit")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__lit") onChange("");
          else if (v === "__raw") onChange(value.startsWith("$.") ? value : "$.action.");
          else onChange(v);
        }}
      >
        <optgroup label="이 거래에서 가져오기">
          {options.map((o) => (<option key={o.sel} value={o.sel}>{o.label}</option>))}
        </optgroup>
        <option value="__lit">고정값 직접 입력…</option>
        <option value="__raw">셀렉터 직접 입력…</option>
      </select>
      {mode !== "known" && (
        <input className="pf-val mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={mode === "raw" ? "$.action.…" : "예: 1"} />
      )}
    </span>
  );
}

export function CustomFieldModal({ existing, actionTag, fields, onCreate, onClose }) {
  const existingNames = Object.keys(existing);
  const allOptions = React.useMemo(() => buildOptions(fields), [fields]);
  const [method, setMethod] = React.useState(Cedar.METHOD_CATALOG[0]);
  const [label, setLabel] = React.useState(() => Cedar.methodLabel(Cedar.METHOD_CATALOG[0]));
  const [labelTouched, setLabelTouched] = React.useState(false);
  const [params, setParams] = React.useState(() => defaultParams(Cedar.METHOD_CATALOG[0], buildOptions(fields)));
  const [projection, setProjection] = React.useState(Cedar.METHOD_CATALOG[0].projection);

  const name = React.useMemo(() => autoName(method.method, existingNames), [method.method, existingNames]);
  const labelDup = React.useMemo(() => {
    const want = label.trim();
    return want ? (Object.values(existing).find((f) => f.label.ko === want) || null) : null;
  }, [existing, label]);
  const sameCall = React.useMemo(() => {
    const wantParams = JSON.stringify(sortedParams(paramSpecs(params)));
    return Object.values(existing).find((f) => f.method === method.method && f.projection === projection && JSON.stringify(sortedParams(f.params)) === wantParams) || null;
  }, [existing, method.method, projection, params]);

  const blockMsg = sameCall ? `같은 호출이 이미 '${sameCall.label.ko}' 필드로 있어요` : (labelDup ? "같은 이름의 보강 필드가 이미 있어요" : null);
  const canCreate = label.trim().length > 0 && !blockMsg;

  const pickMethod = (m) => {
    setMethod(m);
    setParams(defaultParams(m, allOptions));
    setProjection(m.projection);
    if (!labelTouched) setLabel(Cedar.methodLabel(m));
  };
  const create = () => {
    if (!canCreate) return;
    onCreate({ name, field: { type: method.type, label: { ko: label.trim() || name, en: name }, appliesTo: actionTag ? [actionTag] : [], method: method.method, projection, params: paramSpecs(params) } });
    onClose();
  };
  const typeLabel = method.type === "decimal" ? "소수" : method.type === "Long" ? "정수" : method.type === "Bool" ? "참/거짓" : "문자열";

  return (
    <div className="cfm-bd" role="dialog" aria-modal onClick={onClose}>
      <div className="cfm" onClick={(e) => e.stopPropagation()}>
        <div className="cfm-h">
          새 보강 필드 만들기
          <button type="button" className="pf-iconbtn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="cfm-sub">정책 서버 메서드를 골라 파라미터를 매핑하면 <code>context.custom.&lt;이름&gt;</code> 필드가 생겨 조건에서 쓸 수 있어요.</p>

        <div className="cfm-step">① 무엇을 조회하나요?</div>
        <label className="cfm-row">
          <span className="cfm-label">조회 메서드</span>
          <select className="pf-select" value={method.method} onChange={(e) => { const m = Cedar.METHOD_CATALOG.find((x) => x.method === e.target.value); if (m) pickMethod(m); }}>
            {Cedar.METHOD_CATALOG.map((m) => (<option key={m.method} value={m.method}>{m.mock ? Cedar.methodLabel(m) + " (예시)" : Cedar.methodLabel(m)}</option>))}
          </select>
        </label>
        <div className="cfm-desc">
          {Cedar.methodDesc(method)}
          {method.mock && <span className="cfm-mock"> · 서버 미구현 예시예요</span>}
        </div>

        <div className="cfm-params">
          <div className="cfm-step">② 무엇으로 조회하나요?</div>
          {Object.entries(params).map(([key, v]) => {
            const chip = kindChip(kindOf(key));
            return (
              <div key={key} className="cfm-row">
                <span className="cfm-label">{paramKeyLabel(key)}{chip && <span className="cfm-kind">{chip}</span>}</span>
                <ParamPicker value={v} options={optionsFor(key, allOptions)} onChange={(next) => setParams((p) => ({ ...p, [key]: next }))} />
              </div>
            );
          })}
          <details className="cfm-adv">
            <summary>고급 — 셀렉터·결과 위치 직접 편집</summary>
            {Object.entries(params).map(([key, v]) => (
              <label key={key} className="cfm-row">
                <span className="cfm-label mono">{key}</span>
                <input className="pf-val wide mono" value={v} onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))} />
              </label>
            ))}
            <label className="cfm-row">
              <span className="cfm-label mono">result path</span>
              <input className="pf-val wide mono" value={projection} onChange={(e) => setProjection(e.target.value)} />
            </label>
          </details>
        </div>

        <div className="cfm-step">③ 이름</div>
        <label className="cfm-row">
          <span className="cfm-label">표시 이름</span>
          <input className="pf-val wide" value={label} autoFocus onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }} placeholder="예: 입력 USD 가치" />
        </label>
        <div className="cfm-autoname">
          {typeLabel} 값 · 조건 필드로 <code>context.custom.{name}</code>
        </div>
        {blockMsg && <div className="cfm-block">⚠ {blockMsg}</div>}

        <div className="cfm-actions">
          <button type="button" className="pf-add-cond" onClick={onClose}>취소</button>
          <button type="button" className="cfm-create" disabled={!canCreate} onClick={create}>필드 만들기</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════ ManifestPreview ════════════════════ */
export function ManifestPreview({ open, onToggle, autoManifest, errors, overrideText, parseErr, canEdit, onEdit, onChangeText, onReset }) {
  const editing = overrideText !== null;
  const hasManifest = autoManifest !== undefined;
  const tag = editing ? "직접 편집됨" : (errors.length > 0 ? `오류 ${errors.length}` : (hasManifest ? "보강 필드 있음" : "불필요"));
  return (
    <div className="pf-manifest">
      <button type="button" className="pf-manifest-head" onClick={onToggle} aria-expanded={open}>
        <span className={`pf-manifest-caret${open ? " open" : ""}`}>▶</span>
        manifest
        <span className={`pf-manifest-tag${editing ? " edited" : ""}`}>{tag}</span>
      </button>
      {open && (
        <div className="pf-manifest-body">
          <div className="pf-manifest-bar">
            {editing ? (
              <>
                <span className={`pf-manifest-status${parseErr ? " err" : " ok"}`}>{parseErr ? `JSON 오류: ${parseErr}` : "직접 편집 중 — 저장 시 이 값을 씁니다"}</span>
                <button type="button" className="pf-manifest-btn" onClick={onReset}>↺ 자동으로</button>
              </>
            ) : (
              <>
                <span className="pf-manifest-status">정책에서 읽는 보강 필드로 자동 생성돼요</span>
                {canEdit && hasManifest && <button type="button" className="pf-manifest-btn" onClick={onEdit}>✎ 직접 편집</button>}
              </>
            )}
          </div>
          {editing ? (
            <textarea className={`pf-manifest-edit${parseErr ? " invalid" : ""}`} value={overrideText} onChange={(e) => onChangeText(e.target.value)} spellCheck={false} rows={12} />
          ) : errors.length > 0 ? (
            <div className="pf-manifest-err">{errors.map((e, i) => (<div key={i}>⚠ {e.message}</div>))}</div>
          ) : hasManifest ? (
            <pre className="pf-manifest-json">{JSON.stringify(autoManifest, null, 2)}</pre>
          ) : (
            <div className="pf-manifest-empty">이 정책은 <code>context.custom.*</code> 보강 필드를 쓰지 않아 manifest가 필요 없어요.</div>
          )}
        </div>
      )}
    </div>
  );
}
