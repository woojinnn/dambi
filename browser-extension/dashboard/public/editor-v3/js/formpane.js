function StructurePreview({ model, ctx }) {
  const renderNodes = (nodes, or) => nodes.map((n, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, i > 0 && /* @__PURE__ */ React.createElement("span", { className: "sp-conn" }, or ? "\uB610\uB294" : "\uADF8\uB9AC\uACE0"), Cedar.isGroupNode(n) ? /* @__PURE__ */ React.createElement("span", { className: "sp-group" }, renderNodes(n.conds, !or)) : /* @__PURE__ */ React.createElement("span", { className: "sp-chip" }, condChip(n, ctx))));
  const runs = Cedar.situationsOf(model.when);
  const unlessRuns = Cedar.situationsOf(model.unless);
  return /* @__PURE__ */ React.createElement("div", { className: "sp-wrap" }, runs.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "sp-empty" }, "\uC870\uAC74\uC774 \uC5C6\uC5B4 \uC774 \uB3D9\uC791\uC740 \uD56D\uC0C1 \uBC1C\uB3D9\uD574\uC694.") : runs.map((run, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, i > 0 && /* @__PURE__ */ React.createElement("div", { className: "sp-or" }, /* @__PURE__ */ React.createElement("span", null, "\uB610\uB294")), /* @__PURE__ */ React.createElement("div", { className: "sp-card" }, renderNodes(run, false)))), unlessRuns.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "sp-unless" }, /* @__PURE__ */ React.createElement("div", { className: "sp-unless-h" }, "\uB2E8, \uB2E4\uC74C\uC774\uBA74 \uC81C\uC678"), unlessRuns.map((run, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, i > 0 && /* @__PURE__ */ React.createElement("div", { className: "sp-or sm" }, /* @__PURE__ */ React.createElement("span", null, "\uB610\uB294")), /* @__PURE__ */ React.createElement("div", { className: "sp-card sm" }, renderNodes(run, false))))));
}
function PolicyFormPane({ initialModel, initialManifest, valuesOnly, onChange, onValidity, resetToken, severityValue, onSeverityChange, compact }) {
  const [model, setModel] = React.useState(
    () => initialModel ? { ...initialModel, when: Cedar.normalizeSituations(initialModel.when), unless: Cedar.normalizeSituations(initialModel.unless) } : Cedar.emptyFormModel()
  );
  const openModelRef = React.useRef(null);
  if (openModelRef.current === null) openModelRef.current = model;
  const [userFields, setUserFields] = React.useState(
    () => Cedar.userFieldsFromManifest(initialManifest, Cedar.actionTagOf((initialModel || Cedar.emptyFormModel()).trigger))
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
      desc: `\uC11C\uBC84 \uBA54\uC11C\uB4DC ${def.method} \uACB0\uACFC\uAC12`
    }));
    return [...Cedar.fieldsForTrigger(model.trigger), ...extra];
  }, [model.trigger, userFields]);
  const rhsFields = React.useMemo(() => [PRINCIPAL_ADDRESS, ...fields], [fields]);
  const fieldByPath = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
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
    valuesOnly: !!valuesOnly
  }), [fields, rhsFields, fieldByPath, model.trigger.kind, valuesOnly]);
  const [selected, setSelected] = React.useState(null);
  const selection = {
    isNodeSelected: (n) => !!selected && selected.kind === "node" && selected.node === n,
    isSituationSelected: (h) => !!selected && selected.kind === "situation" && selected.head === h,
    onClickNode: (n) => setSelected((s) => s && s.kind === "node" && s.node === n ? null : { kind: "node", node: n }),
    onClickSituation: (h) => setSelected((s) => s && s.kind === "situation" && s.head === h ? null : { kind: "situation", head: h }),
    registerRow: () => {
    }
  };
  const badDecimals = React.useMemo(() => Cedar.findInvalidModelDecimals(model), [model]);
  const sheetError = badDecimals.length ? `\uC18C\uC218 \uD615\uC2DD\uC774 \uC798\uBABB\uB410\uC5B4\uC694: ${badDecimals.map((v) => `"${v}"`).join(", ")} \u2014 \uC22B\uC790\uB85C, \uC18C\uC218\uC810 \uC544\uB798 \uCD5C\uB300 4\uC790\uB9AC (\uC608: 3 \u2192 3.0)` : null;
  const onValidityRef = React.useRef(onValidity);
  onValidityRef.current = onValidity;
  React.useEffect(() => {
    onValidityRef.current && onValidityRef.current({ valid: !sheetError, error: sheetError });
  }, [sheetError]);
  const gen = React.useMemo(
    () => Cedar.generateManifest(model, registry, { id: model.id, severity: model.severity }),
    [model, registry]
  );
  const manifestErrors = gen.errors;
  const [manifestOpen, setManifestOpen] = React.useState(false);
  const [manifestText, setManifestText] = React.useState(null);
  const { manifest: effectiveManifest, parseErr: manifestParseErr } = React.useMemo(() => {
    if (manifestText === null) return { manifest: gen.manifest, parseErr: null };
    try {
      return { manifest: JSON.parse(manifestText), parseErr: null };
    } catch (e) {
      return { manifest: gen.manifest, parseErr: e instanceof Error ? e.message : "JSON \uC624\uB958" };
    }
  }, [manifestText, gen.manifest]);
  const resetRef = React.useRef(resetToken);
  React.useEffect(() => {
    if (resetToken === void 0 || resetToken === resetRef.current) return;
    resetRef.current = resetToken;
    if (openModelRef.current) setModel(openModelRef.current);
  }, [resetToken]);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  React.useEffect(() => {
    const cedarText = Cedar.serializeCedar(model, model.id, model.severity, model.reason);
    onChangeRef.current({ cedarText, model, manifest: effectiveManifest, manifestOverridden: manifestText !== null });
  }, [model, effectiveManifest, manifestText]);
  const patch = (next) => setModel((m) => ({ ...m, ...next }));
  const setTrigger = (next) => setModel((m) => {
    const same = m.trigger.kind === "any" && next.kind === "any" || m.trigger.kind === "actionEq" && next.kind === "actionEq" && m.trigger.entityType === next.entityType && m.trigger.id === next.id;
    if (same) return m;
    setUserFields({});
    return { ...m, trigger: next, when: [], unless: [] };
  });
  const trig = model.trigger;
  const currentAction = trig.kind === "actionEq" ? Cedar.KNOWN_ACTIONS.find((k) => k.entityType === trig.entityType && k.id === trig.id) : void 0;
  const currentGroup = trig.kind === "actionEq" ? currentAction?.group ?? Cedar.ACTION_GROUPS[0]?.group ?? "*" : "*";
  const groupActions = Cedar.ACTION_GROUPS.find((g) => g.group === currentGroup)?.actions ?? [];
  const triggerText = trig.kind === "actionEq" ? currentAction?.label ?? trig.id : "\uBAA8\uB4E0 \uB3D9\uC791";
  if (valuesOnly) {
    const open = openModelRef.current;
    const dirty = !!open && (open.when !== model.when || open.unless !== model.unless || open.reason !== model.reason);
    const replaceLeafValue = (nodes, target, value) => nodes.map((n) => Cedar.isGroupNode(n) ? { ...n, conds: replaceLeafValue(n.conds, target, value) } : n === target ? { ...n, value } : n);
    return /* @__PURE__ */ React.createElement(
      ValueSheet,
      {
        model,
        ctx,
        triggerLabel: triggerText,
        triggerAny: trig.kind === "any",
        severity: severityValue || model.severity,
        onSeverity: onSeverityChange,
        compact,
        reason: model.reason,
        dirty,
        error: sheetError,
        badDecimals: new Set(badDecimals),
        onValue: (target, value) => setModel((m) => ({ ...m, when: replaceLeafValue(m.when, target, value), unless: replaceLeafValue(m.unless, target, value) })),
        onReason: (text) => setModel((m) => ({ ...m, reason: text })),
        onRevert: () => open && setModel(open)
      }
    );
  }
  const valid = !sheetError && manifestErrors.length === 0;
  return /* @__PURE__ */ React.createElement("div", { className: "pf-pane" }, /* @__PURE__ */ React.createElement("div", { className: "pf-form" }, /* @__PURE__ */ React.createElement("section", { className: "pf-section" }, /* @__PURE__ */ React.createElement("h3", { className: "pf-h" }, /* @__PURE__ */ React.createElement("span", { className: "pf-num" }, "1"), " \uBB34\uC5C7\uC744 \uAC80\uC0AC\uD558\uB098\uC694? ", /* @__PURE__ */ React.createElement("span", { className: "pf-sub" }, "\uC5B4\uB5A4 \uAC70\uB798\uC5D0 \uC801\uC6A9\uD560\uC9C0 \uACE8\uB77C\uC694")), /* @__PURE__ */ React.createElement("div", { className: "pf-row" }, /* @__PURE__ */ React.createElement("label", { className: "pf-label" }, "\uBD84\uB958"), /* @__PURE__ */ React.createElement("select", { className: "pf-select", value: currentGroup, onChange: (e) => {
    const v = e.target.value;
    if (v === "*") return setTrigger({ kind: "any" });
    const first = Cedar.ACTION_GROUPS.find((g) => g.group === v)?.actions[0];
    if (first) setTrigger({ kind: "actionEq", entityType: first.entityType, id: first.id });
  } }, /* @__PURE__ */ React.createElement("option", { value: "*" }, "\uBAA8\uB4E0 \uB3D9\uC791"), Cedar.ACTION_GROUPS.map((g) => /* @__PURE__ */ React.createElement("option", { key: g.group, value: g.group }, g.group)))), /* @__PURE__ */ React.createElement("div", { className: "pf-row" }, /* @__PURE__ */ React.createElement("label", { className: "pf-label" }, "\uB3D9\uC791"), /* @__PURE__ */ React.createElement("select", { className: "pf-select", disabled: currentGroup === "*", value: currentAction ? `${currentAction.entityType}::${currentAction.id}` : "", onChange: (e) => {
    const a = groupActions.find((k) => `${k.entityType}::${k.id}` === e.target.value);
    if (a) setTrigger({ kind: "actionEq", entityType: a.entityType, id: a.id });
  } }, currentGroup === "*" ? /* @__PURE__ */ React.createElement("option", { value: "" }, "\uBA3C\uC800 \uBD84\uB958\uB97C \uACE8\uB77C\uC694") : groupActions.map((a) => /* @__PURE__ */ React.createElement("option", { key: `${a.entityType}::${a.id}`, value: `${a.entityType}::${a.id}` }, a.label))))), /* @__PURE__ */ React.createElement("section", { className: "pf-section" }, /* @__PURE__ */ React.createElement("h3", { className: "pf-h" }, /* @__PURE__ */ React.createElement("span", { className: "pf-num" }, "2"), " \uC5B8\uC81C \uC704\uD5D8\uD55C\uAC00\uC694? ", /* @__PURE__ */ React.createElement("span", { className: "pf-sub" }, "\uC544\uB798 \uC0C1\uD669 \uC911 \uD558\uB098\uB77C\uB3C4 \uD574\uB2F9\uB418\uBA74 \uBC1C\uB3D9\uD574\uC694")), /* @__PURE__ */ React.createElement(ConditionEditor, { nodes: model.when, ctx, emptyHint: "\uC870\uAC74\uC774 \uC5C6\uC73C\uBA74 \uC774 \uB3D9\uC791\uC740 \uD56D\uC0C1 \uB9C9\uD799\uB2C8\uB2E4.", onChange: (when) => patch({ when }), selection })), /* @__PURE__ */ React.createElement("section", { className: "pf-section" }, /* @__PURE__ */ React.createElement("h3", { className: "pf-h" }, /* @__PURE__ */ React.createElement("span", { className: "pf-num" }, "3"), " \uC5B4\uB5BB\uAC8C \uC54C\uB9B4\uAE4C\uC694? ", /* @__PURE__ */ React.createElement("span", { className: "pf-sub" }, "\uC2EC\uAC01\uB3C4\xB7\uC0AC\uC720")), /* @__PURE__ */ React.createElement("div", { className: "pf-row" }, /* @__PURE__ */ React.createElement("label", { className: "pf-label" }, "\uC2EC\uAC01\uB3C4"), /* @__PURE__ */ React.createElement("div", { className: "pf-sev" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: `pf-sev-btn warn${model.severity === "warn" ? " on" : ""}`, onClick: () => patch({ severity: "warn" }) }, "\u25CF \uACBD\uACE0"), /* @__PURE__ */ React.createElement("button", { type: "button", className: `pf-sev-btn deny${model.severity === "deny" ? " on" : ""}`, onClick: () => patch({ severity: "deny" }) }, "\u25CF \uCC28\uB2E8"))), /* @__PURE__ */ React.createElement("div", { className: "pf-row" }, /* @__PURE__ */ React.createElement("label", { className: "pf-label" }, "\uC0AC\uC720"), /* @__PURE__ */ React.createElement("input", { className: "pf-input", value: model.reason, onChange: (e) => patch({ reason: e.target.value }), placeholder: "\uC608: \uACE0\uC704\uD5D8 \uB3D9\uC791 \uCC28\uB2E8" }))), !valid && /* @__PURE__ */ React.createElement("div", { className: "pf-status bad" }, /* @__PURE__ */ React.createElement("span", { className: "pf-status-main" }, "\u26A0 ", sheetError || manifestErrors[0] && manifestErrors[0].message || "\uC720\uD6A8\uD558\uC9C0 \uC54A\uC544\uC694"))), /* @__PURE__ */ React.createElement("aside", { className: "pf-cedar" }, /* @__PURE__ */ React.createElement("div", { className: "pf-cedar-head" }, "\uAD6C\uC870 \uBBF8\uB9AC\uBCF4\uAE30", /* @__PURE__ */ React.createElement("span", { className: "pf-sync" }, "\uD3FC\uACFC \uB3D9\uAE30\uD654\uB428")), /* @__PURE__ */ React.createElement("div", { className: "pf-sentence top" }, trig.kind === "actionEq" ? /* @__PURE__ */ React.createElement(React.Fragment, null, "\u300C", triggerText, "\u300D \uAC70\uB798\uC5D0\uC11C") : /* @__PURE__ */ React.createElement(React.Fragment, null, "\uBAA8\uB4E0 \uAC70\uB798\uC5D0\uC11C")), /* @__PURE__ */ React.createElement("div", { className: "pf-diagram-body" }, /* @__PURE__ */ React.createElement(StructurePreview, { model, ctx })), /* @__PURE__ */ React.createElement("div", { className: `pf-sentence bottom ${model.severity}` }, model.reason ? `'${model.reason}' (\uC774)\uB77C\uB294 \uBA54\uC2DC\uC9C0\uC640 \uD568\uAED8 ` : "", model.severity === "deny" ? "\uCC28\uB2E8" : "\uACBD\uACE0"), /* @__PURE__ */ React.createElement(
    ManifestPreview,
    {
      open: manifestOpen,
      onToggle: () => setManifestOpen((v) => !v),
      autoManifest: gen.manifest,
      errors: manifestErrors,
      overrideText: manifestText,
      parseErr: manifestParseErr,
      canEdit: !valuesOnly,
      onEdit: () => setManifestText(JSON.stringify(gen.manifest || {}, null, 2)),
      onChangeText: setManifestText,
      onReset: () => setManifestText(null)
    }
  )), fieldModalOpen && /* @__PURE__ */ React.createElement(
    CustomFieldModal,
    {
      existing: registry,
      actionTag: Cedar.actionTagOf(model.trigger),
      fields,
      onCreate: ({ name, field }) => setUserFields((prev) => ({ ...prev, [name]: field })),
      onClose: () => setFieldModalOpen(false)
    }
  ));
}
function ValueSheet({ model, ctx, triggerLabel, triggerAny, severity, onSeverity, compact, reason, dirty, error, badDecimals, onValue, onReason, onRevert }) {
  const renderLeaf = (cond) => {
    const field = ctx.fieldByPath.get(cond.fieldPath);
    const subject = field?.label ?? cond.fieldPath ?? "\uAC12";
    const rhsOptions = compatibleRhsFields(ctx.rhsFields, field);
    const fieldMode = cond.value.kind === "field";
    const invalid = cond.value.kind === "decimal" && badDecimals.has(cond.value.value);
    return /* @__PURE__ */ React.createElement("span", { className: "pv-line" }, /* @__PURE__ */ React.createElement("span", { className: "pv-subj" }, subject, "\uC774(\uAC00)"), fieldMode ? /* @__PURE__ */ React.createElement("span", { className: "pv-blank field" }, /* @__PURE__ */ React.createElement(FieldCombobox, { value: cond.value.kind === "field" ? cond.value.path : "", fields: rhsOptions, onChange: (p) => onValue(cond, { kind: "field", path: p }) })) : /* @__PURE__ */ React.createElement("span", { className: `pv-blank${invalid ? " invalid" : ""}` }, /* @__PURE__ */ React.createElement(ValueInput, { value: cond.value, field, invalid, onChange: (v) => onValue(cond, v) })), /* @__PURE__ */ React.createElement("span", { className: "pv-word" }, SUFFIX_KO[cond.op]));
  };
  const renderNodes = (nodes, or) => nodes.map((n, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: i }, i > 0 && /* @__PURE__ */ React.createElement("span", { className: "pv-conn" }, or ? "\uB610\uB294" : "\uADF8\uB9AC\uACE0"), Cedar.isGroupNode(n) ? /* @__PURE__ */ React.createElement("span", { className: "pv-group" }, renderNodes(n.conds, !or)) : renderLeaf(n)));
  const renderSituations = (nodes, sm) => {
    const runs = Cedar.situationsOf(nodes);
    return runs.map((run, si) => /* @__PURE__ */ React.createElement(React.Fragment, { key: si }, si > 0 && /* @__PURE__ */ React.createElement("div", { className: `pv-or-div${sm ? " sm" : ""}` }, /* @__PURE__ */ React.createElement("span", null, "\uB610\uB294")), /* @__PURE__ */ React.createElement("div", { className: `pv-flow${sm ? " sm" : ""}` }, renderNodes(run, false))));
  };
  const whenRuns = Cedar.situationsOf(model.when);
  const hasUnless = Cedar.situationsOf(model.unless).length > 0;
  return /* @__PURE__ */ React.createElement("div", { className: `pv-sheet${compact ? " compact" : ""}` }, error && /* @__PURE__ */ React.createElement("div", { className: "pv-error", role: "alert" }, /* @__PURE__ */ React.createElement("span", { className: "pv-error-ic" }, "\u26A0"), /* @__PURE__ */ React.createElement("span", null, error)), /* @__PURE__ */ React.createElement("div", { className: "pv-main" }, /* @__PURE__ */ React.createElement("div", { className: "pv-card" }, /* @__PURE__ */ React.createElement("div", { className: "pv-top" }, /* @__PURE__ */ React.createElement("span", { className: "pv-top-lk" }, "\uC774 \uC9C0\uAC11\uC5D0\uC11C"), /* @__PURE__ */ React.createElement("b", { className: `pv-trigchip${triggerAny ? " any" : ""}` }, triggerAny ? "\uBAA8\uB4E0 \uAC70\uB798" : triggerLabel), /* @__PURE__ */ React.createElement("span", { className: "pv-top-lk" }, triggerAny ? "\uB9C8\uB2E4" : "\uAC70\uB798\uC5D0\uC11C"), /* @__PURE__ */ React.createElement("span", { className: "pv-spacer" }), /* @__PURE__ */ React.createElement("span", { className: "pv-ro-pill" }, "\uBF08\uB300 \xB7 \uC77D\uAE30\uC804\uC6A9")), /* @__PURE__ */ React.createElement("div", { className: "pv-when" }, whenRuns.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "pv-empty" }, "\uC870\uAC74\uC774 \uC5C6\uC5B4 \uC774 \uAC70\uB798\uB294 \uD56D\uC0C1 \uC801\uC6A9\uB3FC\uC694.") : renderSituations(model.when)), /* @__PURE__ */ React.createElement("div", { className: `pv-verb ${severity}` }, /* @__PURE__ */ React.createElement("span", { className: "pv-arrow" }, "\u2192"), onSeverity ? /* @__PURE__ */ React.createElement("select", { className: `pv-sev-select ${severity}`, value: severity === "info" ? "warn" : severity, onChange: (e) => onSeverity(e.target.value), title: "\uC774 \uC9C0\uAC11\uC5D0\uC11C \uC801\uC6A9\uD560 \uC2EC\uAC01\uB3C4" }, /* @__PURE__ */ React.createElement("option", { value: "warn" }, "\u26A0 \uACBD\uACE0"), /* @__PURE__ */ React.createElement("option", { value: "deny" }, "\u{1F6AB} \uCC28\uB2E8")) : /* @__PURE__ */ React.createElement("span", { className: "pv-verb-act" }, severity === "deny" ? "\u{1F6AB} \uCC28\uB2E8" : severity === "warn" ? "\u26A0 \uACBD\uACE0" : "\u2139 \uC815\uBCF4"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: `pv-reason-input${reason.trim() ? "" : " empty"}`,
      value: reason,
      placeholder: "\uC0AC\uC6A9\uC790\uC5D0\uAC8C \uBCF4\uC5EC\uC904 \uC0AC\uC720\uB97C \uC801\uC5B4\uC8FC\uC138\uC694",
      title: "\uC0AC\uC720\uB294 \uC815\uCC45 \uACF5\uD1B5 \u2014 \uBAA8\uB4E0 \uC9C0\uAC11\uC5D0 \uC801\uC6A9\uB3FC\uC694",
      onChange: (e) => onReason && onReason(e.target.value)
    }
  )), hasUnless && /* @__PURE__ */ React.createElement("div", { className: "pv-unless" }, /* @__PURE__ */ React.createElement("span", { className: "pv-unless-lk" }, "\uB2E8, \uB2E4\uC74C\uC774\uBA74 \uC801\uC6A9\uD558\uC9C0 \uC54A\uC544\uC694"), renderSituations(model.unless, true))), /* @__PURE__ */ React.createElement("div", { className: "pv-diagram-card" }, /* @__PURE__ */ React.createElement("div", { className: "pv-diagram-head" }, "\uC815\uCC45 \uD750\uB984\uB3C4", /* @__PURE__ */ React.createElement("span", { className: "pv-ro-pill" }, "\uC77D\uAE30\uC804\uC6A9")), /* @__PURE__ */ React.createElement("div", { className: "pv-diagram-body" }, /* @__PURE__ */ React.createElement(StructurePreview, { model, ctx })))), /* @__PURE__ */ React.createElement("div", { className: "pv-foot" }, /* @__PURE__ */ React.createElement("span", { className: "pv-foot-note" }, "\uAC12\uB9CC \uBC14\uAFC0 \uC218 \uC788\uC5B4\uC694 \xB7 \uAD6C\uC870\xB7\uD2B8\uB9AC\uAC70\xB7\uC2EC\uAC01\uB3C4\uB294 \uB77C\uC774\uBE0C\uB7EC\uB9AC \uC815\uCC45\uC5D0\uC11C \uC218\uC815\uD574\uC694."), /* @__PURE__ */ React.createElement("span", { className: "pv-spacer" }), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pv-revert", onClick: onRevert, disabled: !dirty }, "\uB418\uB3CC\uB9AC\uAE30")));
}
Object.assign(window, { PolicyFormPane, ValueSheet, StructurePreview });
