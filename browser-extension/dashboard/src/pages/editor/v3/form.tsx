// @ts-nocheck
import * as React from "react";

import { Cedar } from "./cedar";
import { shortAddr } from "./icons";
import { AddressInput, AddressSetInput } from "./extras";

/* ════════════════════ Form pane (폼으로 만들기) ════════════════════ */
export const OP_LABEL = { "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥", contains: "포함", notContains: "포함 안 함", in: "다음 중 하나", notIn: "다음 중 아님" };
export const SUFFIX_KO = { "==": "와 같으면", "!=": "와 다르면", "<": "보다 작으면", "<=": "이하이면", ">": "보다 크면", ">=": "이상이면", contains: "을 포함하면", notContains: "을 포함하지 않으면", in: "중 하나이면", notIn: "중 어느 것도 아니면" };
export const SCALAR_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);
const ROLE_LABEL_KO = { address: "주소", ref: "토큰·거래 장소", numeric: "금액·수량", enum: "방향·주문", auth: "인증·포지션", derived: "자동 계산값" };
const ROLE_ORDER = ["numeric", "derived", "address", "ref", "enum", "auth"];
export const PRINCIPAL_ADDRESS = { path: "principal.address", label: "내 지갑 주소", role: "address", fieldKind: "primitive.String", source: "base" };

const ENUM_SUGGESTIONS = {
  "context.direction.kind": ["exact_input", "exact_output"],
  "context.side": ["long", "short"],
  "context.orderType.kind": ["limit", "stop", "twap"],
  "context.orderType.timeInForce.kind": ["gtc", "ioc", "fok", "post_only", "gtd"],
  "context.venue.name": ["uniswap_v2", "uniswap_v3", "uniswap_v4", "aave_v3", "curve", "balancer_v2", "cowswap", "1inch", "hyperliquid"],
};
function stringFlavor(field) {
  if (!field) return "plain";
  if (field.role === "address") return "address";
  if (field.role === "enum") return "enum";
  return "plain";
}

export function defaultValueOfKind(kind) {
  switch (kind) {
    case "bool": return { kind: "bool", value: true };
    case "long": return { kind: "long", value: 0 };
    case "decimal": return { kind: "decimal", value: "0" };
    case "set": return { kind: "set", values: [] };
    case "field": return { kind: "field", path: PRINCIPAL_ADDRESS.path };
    default: return { kind: "string", value: "" };
  }
}
export function valueKindFor(field, op) {
  if (op === "in" || op === "notIn") return "set";
  return field ? Cedar.valueKindForField(field.fieldKind) : "string";
}
export function compatibleRhsFields(all, lhs) {
  if (!lhs) return all;
  const kind = Cedar.valueKindForField(lhs.fieldKind);
  return all.filter((f) => f.path !== lhs.path && f.fieldKind.startsWith("primitive.") && Cedar.valueKindForField(f.fieldKind) === kind && (f.role === "address") === (lhs.role === "address"));
}
export function newCond(fields) {
  return { fieldPath: fields[0]?.path ?? "", op: "==", value: defaultValueOfKind("string"), joiner: "and" };
}
function pickFieldCond(c, path, fieldByPath) {
  const field = fieldByPath.get(path);
  const op = field ? Cedar.operatorsFor(field.fieldKind)[0] : "==";
  return { ...c, fieldPath: path, op, value: defaultValueOfKind(valueKindFor(field, op)) };
}
function pickOpCond(c, op, fieldByPath) {
  if (c.value.kind === "field" && SCALAR_OPS.has(op)) return { ...c, op };
  const field = fieldByPath.get(c.fieldPath);
  const wantKind = valueKindFor(field, op);
  const value = c.value.kind === wantKind ? c.value : defaultValueOfKind(wantKind);
  return { ...c, op, value };
}

function e2AddrDisplay(s) {
  const str = String(s == null ? "" : s).trim();
  const e = Cedar.AddressBook && Cedar.AddressBook.lookup(str);
  if (e) return e.name;
  if (/^0x[0-9a-fA-F]{40}$/.test(str)) return shortAddr(str);
  return null;
}

function valueText(v, ctx, field) {
  const unit = field && field.unit ? ` ${field.unit}` : "";
  switch (v.kind) {
    case "bool": return v.value ? "참" : "거짓";
    case "long": return (field && field.scale === "nano" ? v.value / 1e9 : v.value) + unit;
    case "decimal": return v.value + unit;
    case "string": { if (v.value === "") return "(빈 값)"; const ad = e2AddrDisplay(v.value); return ad ?? `"${v.value}"`; }
    case "set": return v.values.length ? `[${v.values.map((x) => e2AddrDisplay(x) ?? shortAddr(x)).join(", ")}]` : "[비어 있음]";
    case "field": return ctx.fieldByPath.get(v.path)?.label ?? ctx.rhsFields.find((f) => f.path === v.path)?.label ?? v.path;
  }
}
export function condChip(cond, ctx) {
  const field = ctx.fieldByPath.get(cond.fieldPath);
  const subj = field?.label ?? cond.fieldPath ?? "값";
  return `${subj}${SUFFIX_KO[cond.op] ? " " : " "}${valueText(cond.value, ctx, field)} ${SUFFIX_KO[cond.op] || OP_LABEL[cond.op]}`.replace(/\s+/g, " ").trim();
}

export function FieldCombobox({ value, fields, onChange }) {
  const byRole = {};
  for (const f of fields) (byRole[f.role] = byRole[f.role] || []).push(f);
  const roles = ROLE_ORDER.filter((r) => byRole[r]).concat(Object.keys(byRole).filter((r) => !ROLE_ORDER.includes(r)));
  const known = fields.some((f) => f.path === value);
  return (
    <span className="fc">
      <select className="pf-ctl pf-field-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value || "필드 선택…"}</option>}
        {roles.map((r) => (
          <optgroup key={r} label={ROLE_LABEL_KO[r] || r}>
            {byRole[r].map((f) => (<option key={f.path} value={f.path}>{f.label}</option>))}
          </optgroup>
        ))}
      </select>
    </span>
  );
}

export function ValueInput({ value, field, invalid, onChange }) {
  const unit = field && field.unit;
  switch (value.kind) {
    case "bool":
      return (
        <select className="pf-val" value={String(value.value)} onChange={(e) => onChange({ kind: "bool", value: e.target.value === "true" })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case "long": {
      const nano = field && field.scale === "nano";
      const shown = nano ? value.value / 1e9 : value.value;
      return (
        <span className="pf-val-wrap">
          <input className="pf-val num" type="number" step={nano ? "any" : undefined} value={shown} onChange={(e) => { const n = Number(e.target.value); onChange({ kind: "long", value: nano ? Math.round(n * 1e9) : n }); }} />
          {unit && <span className="pf-unit">{unit}</span>}
        </span>
      );
    }
    case "decimal":
      return (
        <span className="pf-val-wrap">
          <input
            className={`pf-val num${invalid ? " invalid" : ""}`}
            value={value.value}
            onChange={(e) => onChange({ kind: "decimal", value: e.target.value })}
            onBlur={(e) => { const n = Cedar.normalizeDecimal(e.target.value); if (n !== null && n !== e.target.value) onChange({ kind: "decimal", value: n }); }}
            placeholder="0.05"
          />
          {unit && <span className="pf-unit">{unit}</span>}
        </span>
      );
    case "set":
      if (field && field.role === "address") {
        return <AddressSetInput values={value.values} onChange={(values) => onChange({ kind: "set", values })} />;
      }
      return (
        <input
          className="pf-val wide"
          value={value.values.join(", ")}
          onChange={(e) => onChange({ kind: "set", values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="0x주소1, 0x주소2, …"
        />
      );
    case "field":
      return null;
    default: {
      const flavor = stringFlavor(field);
      if (flavor === "address") {
        return <AddressInput value={value.value} onChange={(v) => onChange({ kind: "string", value: v })} />;
      }
      const sugg = field ? ENUM_SUGGESTIONS[field.path] : undefined;
      if (flavor === "enum" || sugg) {
        const listId = `enum-${field ? field.path : ""}`;
        return (
          <>
            <input
              className="pf-val"
              list={sugg ? listId : undefined}
              value={value.value}
              onChange={(e) => onChange({ kind: "string", value: e.target.value })}
              placeholder={field && field.desc ? field.desc.slice(0, 24) : "값"}
            />
            {sugg && <datalist id={listId}>{sugg.map((s) => (<option key={s} value={s} />))}</datalist>}
          </>
        );
      }
      return <input className="pf-val" value={value.value} onChange={(e) => onChange({ kind: "string", value: e.target.value })} placeholder="값" />;
    }
  }
}

export function ConditionRow({ cond, alt, ctx, selected, onSelect, onDragStart, onField, onOp, onValue, onGroup, onRemove }) {
  const field = ctx.fieldByPath.get(cond.fieldPath);
  const ops = field ? Cedar.operatorsFor(field.fieldKind) : ["=="];
  const chip = cond.fieldPath ? condChip(cond, ctx) : "…";
  const rhsOptions = compatibleRhsFields(ctx.rhsFields, field);
  const canField = SCALAR_OPS.has(cond.op) && rhsOptions.length > 0;
  const fieldMode = cond.value.kind === "field";
  return (
    <div
      className={`pf-cond${selected ? " is-selected" : ""}`}
      onClick={onSelect ? (ev) => { if (ev.target.closest("button, select, input, [draggable], .fc")) return; onSelect(); } : undefined}
    >
      <div className="pf-cond-main">
        {onDragStart && !ctx.valuesOnly && (
          <span className="pf-drag" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "cond"); onDragStart(); }} title="드래그해서 다른 상황·묶음으로 이동">⠿</span>
        )}
        <span className={`pf-bullet${alt ? " alt" : ""}`}>{alt ? "◦" : "•"}</span>
        {ctx.valuesOnly ? (
          <>
            <span className="pf-ctl pf-ro">{field?.label ?? cond.fieldPath ?? "…"}</span>
            <span className="pf-ctl pf-leaf-op pf-ro">{OP_LABEL[cond.op]}</span>
          </>
        ) : (
          <>
            <FieldCombobox value={cond.fieldPath} fields={ctx.fields} onChange={onField} />
            <select className="pf-ctl pf-leaf-op" value={cond.op} onChange={(e) => onOp(e.target.value)}>
              {ops.map((op) => (<option key={op} value={op}>{OP_LABEL[op]}</option>))}
            </select>
          </>
        )}
        {canField && (
          <button type="button" className="pf-ctl pf-mode" onClick={() => onValue(fieldMode ? defaultValueOfKind(valueKindFor(field, cond.op)) : { kind: "field", path: rhsOptions[0]?.path ?? "principal.address" })} title={fieldMode ? "고정 값으로" : "다른 필드와 비교"}>
            {fieldMode ? "필드" : "값"}
          </button>
        )}
        {fieldMode ? (
          <FieldCombobox value={cond.value.kind === "field" ? cond.value.path : ""} fields={rhsOptions} onChange={(p) => onValue({ kind: "field", path: p })} />
        ) : (
          <ValueInput value={cond.value} field={field} onChange={onValue} />
        )}
        <span className="pf-grow" />
        {onGroup && !ctx.valuesOnly && (
          <button type="button" className="pf-iconbtn" onClick={onGroup} title={alt ? "이 선택지에 '그리고' 조건을 붙여요" : "이 조건에 '또는' 선택지를 붙여요"}>{alt ? "+그리고" : "+또는"}</button>
        )}
        {!ctx.valuesOnly && <button type="button" className="pf-iconbtn danger" onClick={onRemove} aria-label="조건 삭제" title="삭제">✕</button>}
      </div>
      {cond.fieldPath && <div className="pf-cond-chip">{chip}</div>}
    </div>
  );
}

function GroupBox({ group, orCtx, ctx, dragging, selection, onDragStartCond, onDropIntoGroup, onConds, onRemove }) {
  const { conds } = group;
  const norm = (xs) => xs.map((c, i) => { const want = i === 0 ? "and" : "or"; return c.joiner === want ? c : { ...c, joiner: want }; });
  const update = (i, n) => onConds(norm(conds.map((x, j) => (j === i ? n : x))));
  const removeAt = (i) => {
    const next = conds.filter((_, j) => j !== i);
    if (next.length === 0) onRemove();
    else onConds(norm(next));
  };
  const wrapChild = (i) => {
    const n = conds[i];
    if (Cedar.isGroupNode(n)) return;
    update(i, { kind: "group", joiner: n.joiner, conds: [{ ...n, joiner: "and" }, { ...newCond(ctx.fields), joiner: "or" }] });
  };
  return (
    <div
      className={`pf-box ${orCtx ? "or" : "and"}${dragging ? " droppable" : ""}${selection.isNodeSelected(group) ? " is-selected" : ""}`}
      onDragOver={dragging ? (e) => e.preventDefault() : undefined}
      onDrop={dragging ? (e) => { e.stopPropagation(); e.preventDefault(); onDropIntoGroup(group); } : undefined}
    >
      <div className="pf-box-head" onClick={(ev) => { if (ev.target.closest("button")) return; selection.onClickNode(group); }}>
        <span className="pf-box-label">{orCtx ? "다음 중 하나라도" : "다음에 모두 해당"}</span>
        <span className="pf-spc" />
        {!ctx.valuesOnly && <button type="button" className="pf-iconbtn danger" onClick={onRemove} aria-label="삭제" title="이 묶음 전체 삭제">✕</button>}
      </div>
      {conds.map((c, i) =>
        Cedar.isGroupNode(c) ? (
          <GroupBox key={i} group={c} orCtx={!orCtx} ctx={ctx} dragging={dragging} selection={selection} onDragStartCond={onDragStartCond} onDropIntoGroup={onDropIntoGroup} onConds={(next) => update(i, { ...c, conds: next })} onRemove={() => removeAt(i)} />
        ) : (
          <ConditionRow key={i} cond={c} alt={orCtx} ctx={ctx} selected={selection.isNodeSelected(c)} onSelect={() => selection.onClickNode(c)} onDragStart={() => onDragStartCond(c)} onField={(p) => update(i, pickFieldCond(c, p, ctx.fieldByPath))} onOp={(op) => update(i, pickOpCond(c, op, ctx.fieldByPath))} onValue={(value) => update(i, { ...c, value })} onGroup={() => wrapChild(i)} onRemove={() => removeAt(i)} />
        ),
      )}
      {!ctx.valuesOnly && <button type="button" className="pf-or-btn" onClick={() => onConds(norm([...conds, newCond(ctx.fields)]))}>{orCtx ? "+ 또는" : "+ 그리고"}</button>}
    </div>
  );
}

export function ConditionEditor({ nodes, ctx, emptyHint, onChange, selection }) {
  const runs = Cedar.situationsOf(nodes);
  const commit = (next) => onChange(Cedar.normalizeSituations(Cedar.flattenSituations(next)));
  const updateNode = (si, ni, n) => commit(runs.map((r, i) => (i === si ? r.map((x, j) => (j === ni ? n : x)) : r)));
  const removeNode = (si, ni) => commit(runs.map((r, i) => (i === si ? r.filter((_, j) => j !== ni) : r)));
  const addCond = (si) => commit(runs.map((r, i) => (i === si ? [...r, newCond(ctx.fields)] : r)));
  const addSituation = () => commit([...runs, [newCond(ctx.fields)]]);
  const removeSituation = (si) => commit(runs.filter((_, i) => i !== si));
  const addOr = (si, ni) => {
    const n = runs[si][ni];
    if (Cedar.isGroupNode(n)) return;
    updateNode(si, ni, { kind: "group", joiner: n.joiner, conds: [{ ...n, joiner: "and" }, { ...newCond(ctx.fields), joiner: "or" }] });
  };
  const [drag, setDrag] = React.useState(null);
  const dropTo = (target) => {
    if (drag) onChange(Cedar.normalizeSituations(Cedar.moveCondTo(nodes, drag, target)));
    setDrag(null);
  };
  return (
    <>
      {runs.length === 0 && <div className="pf-empty-cond">{emptyHint}</div>}
      {runs.map((run, si) => (
        <div key={si}>
          {si > 0 && <div className="pf-or-div"><span>또는</span></div>}
          <div
            className={`pf-sit${drag ? " droppable" : ""}${selection.isSituationSelected(run[0]) ? " is-selected" : ""}`}
            onDragOver={drag ? (e) => e.preventDefault() : undefined}
            onDrop={drag ? (e) => { e.preventDefault(); dropTo({ kind: "situation", index: si }); } : undefined}
          >
            <div className="pf-sit-head" onClick={(ev) => { if (ev.target.closest("button")) return; selection.onClickSituation(run[0]); }}>
              <span className="pf-sit-title">상황 {si + 1}</span>
              {run.length > 1 && <span className="pf-sit-mode">다음에 모두 해당</span>}
              <span className="pf-spc" />
              {!ctx.valuesOnly && <button type="button" className="pf-iconbtn danger" onClick={() => removeSituation(si)} aria-label="상황 삭제" title="상황 삭제">✕</button>}
            </div>
            {run.map((n, ni) =>
              Cedar.isGroupNode(n) ? (
                <GroupBox key={ni} group={n} orCtx ctx={ctx} dragging={drag !== null} selection={selection} onDragStartCond={(c) => setDrag(c)} onDropIntoGroup={(g) => dropTo({ kind: "group", group: g })} onConds={(conds) => updateNode(si, ni, { ...n, conds })} onRemove={() => removeNode(si, ni)} />
              ) : (
                <ConditionRow key={ni} cond={n} ctx={ctx} selected={selection.isNodeSelected(n)} onSelect={() => selection.onClickNode(n)} onDragStart={() => setDrag(n)} onField={(p) => updateNode(si, ni, pickFieldCond(n, p, ctx.fieldByPath))} onOp={(op) => updateNode(si, ni, pickOpCond(n, op, ctx.fieldByPath))} onValue={(value) => updateNode(si, ni, { ...n, value })} onGroup={() => addOr(si, ni)} onRemove={() => removeNode(si, ni)} />
              ),
            )}
            {!ctx.valuesOnly && <button type="button" className="pf-add-cond sm" onClick={() => addCond(si)}>+ 그리고</button>}
          </div>
        </div>
      ))}
      {drag !== null && (
        <div className="pf-dropstrip" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropTo({ kind: "new-situation" }); }}>여기에 놓아 새 상황으로 만들기</div>
      )}
      {!ctx.valuesOnly && (
        <div className="pf-add-row">
          <button type="button" className="pf-add-cond" onClick={addSituation}>{runs.length === 0 ? "+ 위험 상황 추가" : "+ 또는"}</button>
          {ctx.onCreateCustom && (
            <button
              type="button"
              className="pf-add-cond accent"
              onClick={ctx.onCreateCustom}
              disabled={!ctx.customFieldEnabled}
              title={ctx.customFieldEnabled ? "정책 서버 메서드로 context.custom.* 필드를 만들어요" : "먼저 동작을 하나 골라주세요 — 보강 파라미터는 동작별이에요"}
            >
              ＋ 새 보강 필드 만들기
            </button>
          )}
        </div>
      )}
    </>
  );
}
