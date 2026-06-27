// @ts-nocheck
import * as React from "react";

import { Cedar } from "./cedar";
import {
  condChip, PRINCIPAL_ADDRESS, compatibleRhsFields, SCALAR_OPS, defaultValueOfKind, valueKindFor,
  FieldCombobox, ValueInput, SUFFIX_KO, ConditionEditor,
} from "./form";
import { ManifestPreview, CustomFieldModal } from "./extras";

/* Read-only structure preview. */
export function StructurePreview({ model, ctx }) {
  const renderNodes = (nodes, or) =>
    nodes.map((n, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="sp-conn">{or ? "또는" : "그리고"}</span>}
        {Cedar.isGroupNode(n) ? <span className="sp-group">{renderNodes(n.conds, !or)}</span> : <span className="sp-chip">{condChip(n, ctx)}</span>}
      </React.Fragment>
    ));
  const runs = Cedar.situationsOf(model.when);
  const unlessRuns = Cedar.situationsOf(model.unless);
  return (
    <div className="sp-wrap">
      {runs.length === 0 ? (
        <div className="sp-empty">조건이 없어 이 동작은 항상 발동해요.</div>
      ) : (
        runs.map((run, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="sp-or"><span>또는</span></div>}
            <div className="sp-card">{renderNodes(run, false)}</div>
          </React.Fragment>
        ))
      )}
      {unlessRuns.length > 0 && (
        <div className="sp-unless">
          <div className="sp-unless-h">단, 다음이면 제외</div>
          {unlessRuns.map((run, i) => (
            <React.Fragment key={i}>
              {i > 0 && <div className="sp-or sm"><span>또는</span></div>}
              <div className="sp-card sm">{renderNodes(run, false)}</div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export function PolicyFormPane({ initialModel, initialManifest, valuesOnly, onChange, onValidity, resetToken, severityValue, onSeverityChange, compact }) {
  const [model, setModel] = React.useState(() =>
    initialModel
      ? { ...initialModel, when: Cedar.normalizeSituations(initialModel.when), unless: Cedar.normalizeSituations(initialModel.unless) }
      : Cedar.emptyFormModel(),
  );
  const openModelRef = React.useRef(null);
  if (openModelRef.current === null) openModelRef.current = model;

  const [userFields, setUserFields] = React.useState(() =>
    Cedar.userFieldsFromManifest(initialManifest, Cedar.actionTagOf((initialModel || Cedar.emptyFormModel()).trigger)),
  );
  const [fieldModalOpen, setFieldModalOpen] = React.useState(false);
  const registry = React.useMemo(() => ({ ...Cedar.ENRICHMENT_FIELDS, ...userFields }), [userFields]);

  const fields = React.useMemo(() => {
    const extra = Object.entries(userFields).map(([name, def]) => ({
      path: `context.custom.${name}`,
      label: def.label.ko,
      fieldKind: Cedar.KIND_BY_TYPE[def.type],
      role: "derived",
      source: "custom",
      optional: true,
      desc: `서버 메서드 ${def.method} 결과값`,
    }));
    return [...Cedar.fieldsForTrigger(model.trigger), ...extra];
  }, [model.trigger, userFields]);
  const rhsFields = React.useMemo(() => [PRINCIPAL_ADDRESS, ...fields], [fields]);
  const fieldByPath = React.useMemo(() => {
    const m = new Map();
    for (const f of fields) m.set(f.path, f);
    return m;
  }, [fields]);
  const ctx = React.useMemo(() => ({
    fields,
    rhsFields,
    fieldByPath,
    lookupAddr: Cedar.AddressBook.lookup,
    onCreateCustom: () => setFieldModalOpen(true),
    customFieldEnabled: model.trigger.kind === "actionEq",
    valuesOnly: !!valuesOnly,
  }), [fields, rhsFields, fieldByPath, model.trigger.kind, valuesOnly]);

  const [selected, setSelected] = React.useState(null);
  const selection = {
    isNodeSelected: (n) => !!selected && selected.kind === "node" && selected.node === n,
    isSituationSelected: (h) => !!selected && selected.kind === "situation" && selected.head === h,
    onClickNode: (n) => setSelected((s) => (s && s.kind === "node" && s.node === n ? null : { kind: "node", node: n })),
    onClickSituation: (h) => setSelected((s) => (s && s.kind === "situation" && s.head === h ? null : { kind: "situation", head: h })),
    registerRow: () => {},
  };

  const badDecimals = React.useMemo(() => Cedar.findInvalidModelDecimals(model), [model]);
  const sheetError = badDecimals.length ? `소수 형식이 잘못됐어요: ${badDecimals.map((v) => `"${v}"`).join(", ")} — 숫자로, 소수점 아래 최대 4자리 (예: 3 → 3.0)` : null;
  const onValidityRef = React.useRef(onValidity);
  onValidityRef.current = onValidity;
  React.useEffect(() => {
    onValidityRef.current && onValidityRef.current({ valid: !sheetError, error: sheetError });
  }, [sheetError]);

  const gen = React.useMemo(
    () => Cedar.generateManifest(model, registry, { id: model.id, severity: model.severity }),
    [model, registry],
  );
  const manifestErrors = gen.errors;
  const [manifestOpen, setManifestOpen] = React.useState(false);
  const [manifestText, setManifestText] = React.useState(null);
  const { manifest: effectiveManifest, parseErr: manifestParseErr } = React.useMemo(() => {
    if (manifestText === null) return { manifest: gen.manifest, parseErr: null };
    try {
      return { manifest: JSON.parse(manifestText), parseErr: null };
    } catch (e) {
      return { manifest: gen.manifest, parseErr: e instanceof Error ? e.message : "JSON 오류" };
    }
  }, [manifestText, gen.manifest]);

  const resetRef = React.useRef(resetToken);
  React.useEffect(() => {
    if (resetToken === undefined || resetToken === resetRef.current) return;
    resetRef.current = resetToken;
    if (openModelRef.current) setModel(openModelRef.current);
  }, [resetToken]);

  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  React.useEffect(() => {
    const cedarText = Cedar.serializeCedar(model, model.id, model.severity, model.reason);
    onChangeRef.current({ cedarText, model, manifest: effectiveManifest, manifestOverridden: manifestText !== null, registry });
  }, [model, effectiveManifest, manifestText, registry]);

  const patch = (next) => setModel((m) => ({ ...m, ...next }));
  const setTrigger = (next) =>
    setModel((m) => {
      const same = (m.trigger.kind === "any" && next.kind === "any") || (m.trigger.kind === "actionEq" && next.kind === "actionEq" && m.trigger.entityType === next.entityType && m.trigger.id === next.id);
      if (same) return m;
      setUserFields({});
      return { ...m, trigger: next, when: [], unless: [] };
    });

  const trig = model.trigger;
  const currentAction = trig.kind === "actionEq" ? Cedar.KNOWN_ACTIONS.find((k) => k.entityType === trig.entityType && k.id === trig.id) : undefined;
  const currentGroup = trig.kind === "actionEq" ? currentAction?.group ?? Cedar.ACTION_GROUPS[0]?.group ?? "*" : "*";
  const groupActions = Cedar.ACTION_GROUPS.find((g) => g.group === currentGroup)?.actions ?? [];
  const triggerText = trig.kind === "actionEq" ? currentAction?.label ?? trig.id : "모든 동작";

  if (valuesOnly) {
    const open = openModelRef.current;
    const dirty = !!open && (open.when !== model.when || open.unless !== model.unless || open.reason !== model.reason);
    const replaceLeafValue = (nodes, target, value) =>
      nodes.map((n) => (Cedar.isGroupNode(n) ? { ...n, conds: replaceLeafValue(n.conds, target, value) } : n === target ? { ...n, value } : n));
    return (
      <ValueSheet
        model={model}
        ctx={ctx}
        triggerLabel={triggerText}
        triggerAny={trig.kind === "any"}
        severity={severityValue || model.severity}
        onSeverity={onSeverityChange}
        compact={compact}
        reason={model.reason}
        dirty={dirty}
        error={sheetError}
        badDecimals={new Set(badDecimals)}
        onValue={(target, value) => setModel((m) => ({ ...m, when: replaceLeafValue(m.when, target, value), unless: replaceLeafValue(m.unless, target, value) }))}
        onReason={(text) => setModel((m) => ({ ...m, reason: text }))}
        onRevert={() => open && setModel(open)}
      />
    );
  }

  const valid = !sheetError && manifestErrors.length === 0;
  return (
    <div className="pf-pane">
      <div className="pf-form">
        <section className="pf-section">
          <h3 className="pf-h"><span className="pf-num">1</span> 무엇을 검사하나요? <span className="pf-sub">어떤 거래에 적용할지 골라요</span></h3>
          <div className="pf-row">
            <label className="pf-label">분류</label>
            <select className="pf-select" value={currentGroup} onChange={(e) => { const v = e.target.value; if (v === "*") return setTrigger({ kind: "any" }); const first = Cedar.ACTION_GROUPS.find((g) => g.group === v)?.actions[0]; if (first) setTrigger({ kind: "actionEq", entityType: first.entityType, id: first.id }); }}>
              <option value="*">모든 동작</option>
              {Cedar.ACTION_GROUPS.map((g) => (<option key={g.group} value={g.group}>{g.group}</option>))}
            </select>
          </div>
          <div className="pf-row">
            <label className="pf-label">동작</label>
            <select className="pf-select" disabled={currentGroup === "*"} value={currentAction ? `${currentAction.entityType}::${currentAction.id}` : ""} onChange={(e) => { const a = groupActions.find((k) => `${k.entityType}::${k.id}` === e.target.value); if (a) setTrigger({ kind: "actionEq", entityType: a.entityType, id: a.id }); }}>
              {currentGroup === "*" ? <option value="">먼저 분류를 골라요</option> : groupActions.map((a) => (<option key={`${a.entityType}::${a.id}`} value={`${a.entityType}::${a.id}`}>{a.label}</option>))}
            </select>
          </div>
        </section>

        <section className="pf-section">
          <h3 className="pf-h"><span className="pf-num">2</span> 언제 위험한가요? <span className="pf-sub">아래 상황 중 하나라도 해당되면 발동해요</span></h3>
          <ConditionEditor nodes={model.when} ctx={ctx} emptyHint="조건이 없으면 이 동작은 항상 막힙니다." onChange={(when) => patch({ when })} selection={selection} />
        </section>

        <section className="pf-section">
          <h3 className="pf-h"><span className="pf-num">3</span> 어떻게 알릴까요? <span className="pf-sub">심각도·사유</span></h3>
          <div className="pf-row">
            <label className="pf-label">심각도</label>
            <div className="pf-sev">
              <button type="button" className={`pf-sev-btn warn${model.severity === "warn" ? " on" : ""}`} onClick={() => patch({ severity: "warn" })}>● 경고</button>
              <button type="button" className={`pf-sev-btn deny${model.severity === "deny" ? " on" : ""}`} onClick={() => patch({ severity: "deny" })}>● 차단</button>
            </div>
          </div>
          <div className="pf-row">
            <label className="pf-label">사유</label>
            <input className="pf-input" value={model.reason} onChange={(e) => patch({ reason: e.target.value })} placeholder="예: 고위험 동작 차단" />
          </div>
        </section>

        {!valid && (
          <div className="pf-status bad"><span className="pf-status-main">⚠ {sheetError || (manifestErrors[0] && manifestErrors[0].message) || "유효하지 않아요"}</span></div>
        )}
      </div>

      <aside className="pf-cedar">
        <div className="pf-cedar-head">구조 미리보기<span className="pf-sync">폼과 동기화됨</span></div>
        <div className="pf-sentence top">{trig.kind === "actionEq" ? <>「{triggerText}」 거래에서</> : <>모든 거래에서</>}</div>
        <div className="pf-diagram-body"><StructurePreview model={model} ctx={ctx} /></div>
        <div className={`pf-sentence bottom ${model.severity}`}>
          {model.reason ? `'${model.reason}' (이)라는 메시지와 함께 ` : ""}
          {model.severity === "deny" ? "차단" : "경고"}
        </div>
        <ManifestPreview
          open={manifestOpen}
          onToggle={() => setManifestOpen((v) => !v)}
          autoManifest={gen.manifest}
          errors={manifestErrors}
          overrideText={manifestText}
          parseErr={manifestParseErr}
          canEdit={!valuesOnly}
          onEdit={() => setManifestText(JSON.stringify(gen.manifest || {}, null, 2))}
          onChangeText={setManifestText}
          onReset={() => setManifestText(null)}
        />
      </aside>

      {fieldModalOpen && (
        <CustomFieldModal
          existing={registry}
          actionTag={Cedar.actionTagOf(model.trigger)}
          fields={fields}
          onCreate={({ name, field }) => setUserFields((prev) => ({ ...prev, [name]: field }))}
          onClose={() => setFieldModalOpen(false)}
        />
      )}
    </div>
  );
}

export function ValueSheet({ model, ctx, triggerLabel, triggerAny, severity, onSeverity, compact, reason, dirty, error, badDecimals, onValue, onReason, onRevert }) {
  const renderLeaf = (cond) => {
    const field = ctx.fieldByPath.get(cond.fieldPath);
    const subject = field?.label ?? cond.fieldPath ?? "값";
    const rhsOptions = compatibleRhsFields(ctx.rhsFields, field);
    const fieldMode = cond.value.kind === "field";
    const invalid = cond.value.kind === "decimal" && badDecimals.has(cond.value.value);
    // 값 시트(적용·설치)는 "값만 바꿀 수 있어요" — 값↔필드 전환(필드로/값으로)은
    // 구조 변경이라 여기선 노출하지 않는다(라이브러리 정책 편집기에서만).
    return (
      <span className="pv-line">
        <span className="pv-subj">{subject}이(가)</span>
        {fieldMode ? (
          <span className="pv-blank field"><FieldCombobox value={cond.value.kind === "field" ? cond.value.path : ""} fields={rhsOptions} onChange={(p) => onValue(cond, { kind: "field", path: p })} /></span>
        ) : (
          <span className={`pv-blank${invalid ? " invalid" : ""}`}><ValueInput value={cond.value} field={field} invalid={invalid} onChange={(v) => onValue(cond, v)} /></span>
        )}
        <span className="pv-word">{SUFFIX_KO[cond.op]}</span>
      </span>
    );
  };
  const renderNodes = (nodes, or) =>
    nodes.map((n, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="pv-conn">{or ? "또는" : "그리고"}</span>}
        {Cedar.isGroupNode(n) ? <span className="pv-group">{renderNodes(n.conds, !or)}</span> : renderLeaf(n)}
      </React.Fragment>
    ));
  const renderSituations = (nodes, sm) => {
    const runs = Cedar.situationsOf(nodes);
    return runs.map((run, si) => (
      <React.Fragment key={si}>
        {si > 0 && <div className={`pv-or-div${sm ? " sm" : ""}`}><span>또는</span></div>}
        <div className={`pv-flow${sm ? " sm" : ""}`}>{renderNodes(run, false)}</div>
      </React.Fragment>
    ));
  };
  const whenRuns = Cedar.situationsOf(model.when);
  const hasUnless = Cedar.situationsOf(model.unless).length > 0;
  return (
    <div className={`pv-sheet${compact ? " compact" : ""}`}>
      {error && <div className="pv-error" role="alert"><span className="pv-error-ic">⚠</span><span>{error}</span></div>}
      <div className="pv-main">
        <div className="pv-card">
          <div className="pv-top">
            <span className="pv-top-lk">이 지갑에서</span>
            <b className={`pv-trigchip${triggerAny ? " any" : ""}`}>{triggerAny ? "모든 거래" : triggerLabel}</b>
            <span className="pv-top-lk">{triggerAny ? "마다" : "거래에서"}</span>
            <span className="pv-spacer" />
            <span className="pv-ro-pill">뼈대 · 읽기전용</span>
          </div>
          <div className="pv-when">{whenRuns.length === 0 ? <div className="pv-empty">조건이 없어 이 거래는 항상 적용돼요.</div> : renderSituations(model.when)}</div>
          <div className={`pv-verb ${severity}`}>
            <span className="pv-arrow">→</span>
            {onSeverity ? (
              <select className={`pv-sev-select ${severity}`} value={severity === "info" ? "warn" : severity} onChange={(e) => onSeverity(e.target.value)} title="이 지갑에서 적용할 심각도">
                <option value="warn">⚠ 경고</option>
                <option value="deny">🚫 차단</option>
              </select>
            ) : (
              <span className="pv-verb-act">{severity === "deny" ? "🚫 차단" : severity === "warn" ? "⚠ 경고" : "ℹ 정보"}</span>
            )}
            <input
              className={`pv-reason-input${reason.trim() ? "" : " empty"}`}
              value={reason}
              placeholder="사용자에게 보여줄 사유를 적어주세요"
              title="사유는 정책 공통 — 모든 지갑에 적용돼요"
              onChange={(e) => onReason && onReason(e.target.value)}
            />
          </div>
          {hasUnless && (
            <div className="pv-unless">
              <span className="pv-unless-lk">단, 다음이면 적용하지 않아요</span>
              {renderSituations(model.unless, true)}
            </div>
          )}
        </div>
        <div className="pv-diagram-card">
          <div className="pv-diagram-head">정책 흐름도<span className="pv-ro-pill">읽기전용</span></div>
          <div className="pv-diagram-body"><StructurePreview model={model} ctx={ctx} /></div>
        </div>
      </div>
      <div className="pv-foot">
        <span className="pv-foot-note">값만 바꿀 수 있어요 · 구조·트리거·심각도는 라이브러리 정책에서 수정해요.</span>
        <span className="pv-spacer" />
        <button type="button" className="pv-revert" onClick={onRevert} disabled={!dirty}>되돌리기</button>
      </div>
    </div>
  );
}
