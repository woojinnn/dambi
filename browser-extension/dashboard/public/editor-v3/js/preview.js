function e2TriggerLabel(trigger) {
  if (!trigger || trigger.kind === "any") return "\uBAA8\uB4E0 \uAC70\uB798";
  if (trigger.kind === "actionEq") {
    const a = (Cedar.KNOWN_ACTIONS || []).find((x) => x.entityType === trigger.entityType && x.id === trigger.id);
    return a ? a.label : trigger.id || "\uD2B9\uC815 \uB3D9\uC791";
  }
  return "\uD2B9\uC815 \uC0C1\uD669";
}
function e2PreviewCtx() {
  const fields = Cedar.fieldsForTrigger();
  const fieldByPath = new Map(fields.map((f) => [f.path, f]));
  if (window.PRINCIPAL_ADDRESS) fieldByPath.set(window.PRINCIPAL_ADDRESS.path, window.PRINCIPAL_ADDRESS);
  return { fieldByPath, rhsFields: fields };
}
function e2Conds(nodes, ctx) {
  const out = [];
  const walk = (arr) => {
    for (const n of arr || []) {
      if (Cedar.isGroupNode && Cedar.isGroupNode(n)) walk(n.conds);
      else out.push(n);
    }
  };
  walk(nodes);
  return out.map((c, i) => ({ key: i, text: window.condChip ? window.condChip(c, ctx) : c.fieldPath || "\uC870\uAC74" }));
}
const E2_SEV = {
  deny: { label: "\uCC28\uB2E8", cls: "deny", ic: "block", desc: "\uC774 \uAC70\uB798\uB97C \uB9C9\uC544\uC694" },
  warn: { label: "\uACBD\uACE0", cls: "warn", ic: "warn", desc: "\uC9C4\uD589 \uC804 \uACBD\uACE0\uB97C \uB744\uC6CC\uC694" },
  info: { label: "\uC815\uBCF4", cls: "info", ic: "info", desc: "\uAE30\uB85D\uB9CC \uB0A8\uACA8\uC694" }
};
function E2PolicyPreview({ binding, def, displayName, hover }) {
  const model = binding && binding.modelOverride || def && def.skeleton && def.skeleton.model || null;
  const ctx = React.useMemo(e2PreviewCtx, []);
  if (!model) {
    return /* @__PURE__ */ React.createElement("div", { className: "e2pop hoverpop" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-body" }, /* @__PURE__ */ React.createElement("span", { className: "e2pop-empty" }, "\uB0B4\uC6A9\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC5B4\uC694.")));
  }
  const sev = E2_SEV[model.severity] || E2_SEV.warn;
  const when = e2Conds(model.when, ctx);
  const unless = e2Conds(model.unless, ctx);
  const reason = (model.reason || "").trim();
  return /* @__PURE__ */ React.createElement("div", { className: `e2pop${hover ? " hoverpop" : ""}`, role: "tooltip" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-head" }, /* @__PURE__ */ React.createElement("span", { className: `e2pop-sev ${sev.cls}` }, /* @__PURE__ */ React.createElement(Ic, { id: sev.ic, cls: "sm" }), sev.label), /* @__PURE__ */ React.createElement("span", { className: "e2pop-title", title: displayName }, displayName)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-body" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC0C1\uD669"), /* @__PURE__ */ React.createElement("span", { className: "v" }, e2TriggerLabel(model.trigger))), /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC870\uAC74"), when.length === 0 ? /* @__PURE__ */ React.createElement("span", { className: "v" }, "\uD56D\uC0C1") : /* @__PURE__ */ React.createElement("span", { className: "v conds" }, when.map((c) => /* @__PURE__ */ React.createElement("span", { className: "cd", key: c.key }, c.text)))), unless.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC608\uC678"), /* @__PURE__ */ React.createElement("span", { className: "v conds" }, unless.map((c) => /* @__PURE__ */ React.createElement("span", { className: "cd", key: c.key }, c.text)))), reason && /* @__PURE__ */ React.createElement("div", { className: "e2pop-msg" }, reason)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-foot" }, /* @__PURE__ */ React.createElement("span", { className: "e2pop-ro" }, /* @__PURE__ */ React.createElement(Ic, { id: "lock", cls: "sm" }), "\uC77D\uAE30 \uC804\uC6A9 \uBBF8\uB9AC\uBCF4\uAE30 \xB7 \uB204\uB974\uBA74 \uAC12 \uC218\uC815")));
}
Object.assign(window, { E2PolicyPreview, e2TriggerLabel });
