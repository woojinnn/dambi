/**
 * PolicyFormPane — the "폼으로 만들기" editor surface.
 *
 * Edits a {@link FormModel} (the constrained subset) and keeps the parent's
 * `cedarText` + `ir` in sync: every change rebuilds the IR via `formToIr` and
 * (debounced) renders Cedar via `blocksToText`, then calls `onChange`. Mirrors
 * the Block tab's (WorkspaceV9) contract so the editor wiring is identical.
 *
 * Layout matches the spec: left = three sections (검사 대상 / 조건 / 알림), right
 * = a live read-only `policy.cedar` preview kept in sync with the form.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { blocksToText } from "../../../cedar";
import type { PolicyIR } from "../../../cedar/blocks/ir";
import { exprToText } from "../../../cedar/diagram/PolicyDiagram";
import {
  emptyFormModel,
  fieldsForTrigger,
  formToIr,
  KNOWN_ACTIONS,
  leafToExpr,
  operatorsFor,
  valueKindForField,
  type FieldOption,
  type FormLeaf,
  type FormModel,
  type FormOp,
  type FormValue,
} from "../../../cedar/form";

import "./policy-form.css";

export interface PolicyFormPaneProps {
  initialModel?: FormModel | null;
  onChange: (next: { cedarText: string; ir: PolicyIR; model: FormModel }) => void;
}

const OP_LABEL: Record<FormOp, string> = {
  "==": "=",
  "!=": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  contains: "포함",
  in: "다음 중 하나",
};

function defaultValueOfKind(kind: FormValue["kind"]): FormValue {
  switch (kind) {
    case "bool":
      return { kind: "bool", value: true };
    case "long":
      return { kind: "long", value: 0 };
    case "decimal":
      return { kind: "decimal", value: "0" };
    case "set":
      return { kind: "set", values: [] };
    default:
      return { kind: "string", value: "" };
  }
}

/** Value kind for a (field, op): `in` is always a set, else the field's kind. */
function valueKindFor(field: FieldOption | undefined, op: FormOp): FormValue["kind"] {
  if (op === "in") return "set";
  return field ? valueKindForField(field.fieldKind) : "string";
}

export function PolicyFormPane({ initialModel, onChange }: PolicyFormPaneProps) {
  const [model, setModel] = useState<FormModel>(() => initialModel ?? emptyFormModel());
  const [cedar, setCedar] = useState<string>("");
  const [cedarError, setCedarError] = useState<string | null>(null);

  const fields = useMemo(() => fieldsForTrigger(model.trigger), [model.trigger]);
  const fieldByPath = useMemo(() => {
    const m = new Map<string, FieldOption>();
    for (const f of fields) m.set(f.path, f);
    return m;
  }, [fields]);

  const ir = useMemo(() => formToIr(model), [model]);

  // Keep onChange in a ref so the sync effect depends only on `ir`.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Rebuild Cedar (debounced) and push {cedarText, ir, model} up.
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      void blocksToText(ir)
        .then((text) => {
          if (cancelled) return;
          setCedar(text);
          setCedarError(null);
          onChangeRef.current({ cedarText: text, ir, model });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setCedarError(err instanceof Error ? err.message : "Cedar 변환 실패");
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ir, model]);

  // ── mutation helpers (immutable) ──
  const patch = (next: Partial<FormModel>) => setModel((m) => ({ ...m, ...next }));
  const setGroups = (groups: FormModel["groups"]) => patch({ groups });

  const updateLeaf = (gi: number, li: number, leaf: FormLeaf) =>
    setGroups(
      model.groups.map((g, i) =>
        i === gi ? { leaves: g.leaves.map((l, j) => (j === li ? leaf : l)) } : g,
      ),
    );

  const onPickField = (gi: number, li: number, path: string) => {
    const field = fieldByPath.get(path);
    const ops = field ? operatorsFor(field.fieldKind) : ["=="];
    const op = (ops[0] ?? "==") as FormOp;
    updateLeaf(gi, li, { fieldPath: path, op, value: defaultValueOfKind(valueKindFor(field, op)) });
  };

  const onPickOp = (gi: number, li: number, op: FormOp) => {
    const leaf = model.groups[gi].leaves[li];
    const field = fieldByPath.get(leaf.fieldPath);
    const wantKind = valueKindFor(field, op);
    const value = leaf.value.kind === wantKind ? leaf.value : defaultValueOfKind(wantKind);
    updateLeaf(gi, li, { ...leaf, op, value });
  };

  const addGroup = () =>
    setGroups([...model.groups, { leaves: [{ fieldPath: fields[0]?.path ?? "", op: "==", value: defaultValueOfKind("string") }] }]);
  const addOrLeaf = (gi: number) =>
    setGroups(
      model.groups.map((g, i) =>
        i === gi
          ? { leaves: [...g.leaves, { fieldPath: fields[0]?.path ?? "", op: "==", value: defaultValueOfKind("string") }] }
          : g,
      ),
    );
  const removeLeaf = (gi: number, li: number) =>
    setGroups(
      model.groups
        .map((g, i) => (i === gi ? { leaves: g.leaves.filter((_, j) => j !== li) } : g))
        .filter((g) => g.leaves.length > 0),
    );

  return (
    <div className="pf-pane">
      <div className="pf-form">
        {/* ① 검사 대상 */}
        <section className="pf-section">
          <h3 className="pf-h">
            <span className="pf-num">1</span> 무엇을 검사하나요? <span className="pf-sub">어떤 거래에 적용할지 골라요</span>
          </h3>
          <div className="pf-row">
            <label className="pf-label">검사 대상</label>
            <select
              className="pf-select"
              value={model.trigger.kind === "actionEq" ? `${model.trigger.entityType}::${model.trigger.id}` : "*"}
              onChange={(e) => {
                if (e.target.value === "*") return patch({ trigger: { kind: "any" } });
                const a = KNOWN_ACTIONS.find((k) => `${k.entityType}::${k.id}` === e.target.value);
                if (a) patch({ trigger: { kind: "actionEq", entityType: a.entityType, id: a.id } });
              }}
            >
              <option value="*">모든 동작</option>
              {KNOWN_ACTIONS.map((a) => (
                <option key={`${a.entityType}::${a.id}`} value={`${a.entityType}::${a.id}`}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* ② 조건 */}
        <section className="pf-section">
          <h3 className="pf-h">
            <span className="pf-num">2</span> 언제 위험한가요? <span className="pf-sub">조건 추가, 여러 개면 모두 참(AND)</span>
          </h3>
          {model.groups.length === 0 && (
            <div className="pf-empty-cond">조건이 없으면 이 동작은 항상 막힙니다.</div>
          )}
          {model.groups.map((g, gi) => (
            <div className="pf-group" key={gi}>
              {g.leaves.map((leaf, li) => (
                <LeafRow
                  key={li}
                  leaf={leaf}
                  fields={fields}
                  field={fieldByPath.get(leaf.fieldPath)}
                  showOr={li > 0}
                  onField={(p) => onPickField(gi, li, p)}
                  onOp={(op) => onPickOp(gi, li, op)}
                  onValue={(value) => updateLeaf(gi, li, { ...leaf, value })}
                  onRemove={() => removeLeaf(gi, li)}
                />
              ))}
              <button type="button" className="pf-or-btn" onClick={() => addOrLeaf(gi)}>
                + 또는(OR)
              </button>
            </div>
          ))}
          <button type="button" className="pf-add-cond" onClick={addGroup}>
            + 조건 추가
          </button>
        </section>

        {/* ③ 알림 */}
        <section className="pf-section">
          <h3 className="pf-h">
            <span className="pf-num">3</span> 어떻게 알릴까요? <span className="pf-sub">이름·심각도·사유</span>
          </h3>
          <div className="pf-row">
            <label className="pf-label">규칙 id</label>
            <input className="pf-input" value={model.id} onChange={(e) => patch({ id: e.target.value })} />
          </div>
          <div className="pf-row">
            <label className="pf-label">심각도</label>
            <div className="pf-sev">
              <button
                type="button"
                className={`pf-sev-btn warn${model.severity === "warn" ? " on" : ""}`}
                onClick={() => patch({ severity: "warn" })}
              >
                ● 경고
              </button>
              <button
                type="button"
                className={`pf-sev-btn deny${model.severity === "deny" ? " on" : ""}`}
                onClick={() => patch({ severity: "deny" })}
              >
                ● 차단
              </button>
            </div>
          </div>
          <div className="pf-row">
            <label className="pf-label">사유</label>
            <input className="pf-input" value={model.reason} onChange={(e) => patch({ reason: e.target.value })} placeholder="예: 고위험 동작 차단" />
          </div>
        </section>
      </div>

      {/* 우측 라이브 Cedar */}
      <aside className="pf-cedar">
        <div className="pf-cedar-head">
          policy.cedar
          <span className={`pf-sync${cedarError ? " err" : ""}`}>{cedarError ? "변환 오류" : "폼과 동기화됨"}</span>
        </div>
        <pre className="pf-cedar-body">{cedarError ?? cedar}</pre>
      </aside>
    </div>
  );
}

// ── one condition row ──────────────────────────────────────────────────────

function LeafRow({
  leaf,
  fields,
  field,
  showOr,
  onField,
  onOp,
  onValue,
  onRemove,
}: {
  leaf: FormLeaf;
  fields: FieldOption[];
  field: FieldOption | undefined;
  showOr: boolean;
  onField: (path: string) => void;
  onOp: (op: FormOp) => void;
  onValue: (v: FormValue) => void;
  onRemove: () => void;
}) {
  const ops = field ? operatorsFor(field.fieldKind) : (["=="] as FormOp[]);
  const chip = leaf.fieldPath ? safeChip(leaf) : "…";
  return (
    <div className="pf-leaf">
      {showOr && <span className="pf-or-tag">또는</span>}
      <select className="pf-leaf-field" value={leaf.fieldPath} onChange={(e) => onField(e.target.value)}>
        <option value="" disabled>
          필드 선택…
        </option>
        {fields.map((f) => (
          <option key={f.path} value={f.path}>
            {f.label}
            {f.source === "custom" ? " ·보강" : ""}
          </option>
        ))}
      </select>
      <select className="pf-leaf-op" value={leaf.op} onChange={(e) => onOp(e.target.value as FormOp)}>
        {ops.map((op) => (
          <option key={op} value={op}>
            {OP_LABEL[op]}
          </option>
        ))}
      </select>
      <ValueInput value={leaf.value} onChange={onValue} />
      <span className="pf-leaf-chip">{chip}</span>
      <button type="button" className="pf-x" onClick={onRemove} aria-label="조건 삭제">
        ×
      </button>
    </div>
  );
}

function safeChip(leaf: FormLeaf): string {
  try {
    return exprToText(leafToExpr(leaf));
  } catch {
    return "…";
  }
}

// ── value widget by kind ───────────────────────────────────────────────────

function ValueInput({ value, onChange }: { value: FormValue; onChange: (v: FormValue) => void }) {
  switch (value.kind) {
    case "bool":
      return (
        <select className="pf-val" value={String(value.value)} onChange={(e) => onChange({ kind: "bool", value: e.target.value === "true" })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case "long":
      return (
        <input
          className="pf-val"
          type="number"
          value={value.value}
          onChange={(e) => onChange({ kind: "long", value: Number(e.target.value) })}
        />
      );
    case "decimal":
      return (
        <input className="pf-val" value={value.value} onChange={(e) => onChange({ kind: "decimal", value: e.target.value })} placeholder="0.05" />
      );
    case "set":
      return (
        <input
          className="pf-val wide"
          value={value.values.join(", ")}
          onChange={(e) =>
            onChange({ kind: "set", values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
          }
          placeholder="값1, 값2, …"
        />
      );
    default:
      return <input className="pf-val" value={value.value} onChange={(e) => onChange({ kind: "string", value: e.target.value })} />;
  }
}
