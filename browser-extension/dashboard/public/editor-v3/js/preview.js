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
const IR_LABELS = { "context.amount": "\uC218\uB7C9 (\uC6D0\uBCF8)", "principal.address": "\uB0B4 \uC9C0\uAC11", principal: "\uB0B4 \uC9C0\uAC11" };
function irHasBatchim(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code < 44032 || code > 55203) return false;
  return (code - 44032) % 28 !== 0;
}
function irSubj(word) {
  return irHasBatchim(word[word.length - 1]) ? "\uC774" : "\uAC00";
}
function irPath(e) {
  if (!e) return "";
  if (e.kind === "var") return e.name;
  if (e.kind === "attr") {
    const p = irPath(e.of);
    return p ? p + "." + e.attr : e.attr;
  }
  return "";
}
function irFieldLabel(e) {
  const p = irPath(e);
  if (IR_LABELS[p]) return IR_LABELS[p];
  const g = Cedar.getGloss && Cedar.getGloss(p);
  if (g) return g.label;
  return p.replace(/^context\./, "").replace(/^principal\./, "\uB0B4 \uC9C0\uAC11 ") || "\uAC12";
}
function irIsAddrField(e) {
  const p = irPath(e);
  if (p === "principal.address") return true;
  const g = Cedar.getGloss && Cedar.getGloss(p);
  if (g) return g.role === "address";
  return /recipient|spender|address|delegatee|contract|onbehalf/i.test(p);
}
function irVal(e, asAddr) {
  if (!e) return "";
  if (e.kind === "lit") {
    const v = e.value;
    if (typeof v === "string") {
      if (asAddr) return Cedar.shortAddress ? Cedar.shortAddress(v) : v;
      return '"' + v + '"';
    }
    return String(v);
  }
  if (e.kind === "litEntity") return asAddr && Cedar.shortAddress ? Cedar.shortAddress(e.entity.id) : e.entity.id;
  if (e.kind === "attr" || e.kind === "var") return irFieldLabel(e);
  if (e.kind === "set") return e.elements.map((x) => irVal(x, asAddr)).join(", ");
  return "\uAC12";
}
function irMembership(inner) {
  if (inner && inner.kind === "binary" && inner.op === "contains")
    return { field: inner.right, members: irVal(inner.left, irIsAddrField(inner.right)) };
  if (inner && inner.kind === "binary" && inner.op === "in")
    return { field: inner.left, members: irVal(inner.right, irIsAddrField(inner.left)) };
  return null;
}
const IR_CMP = { "==": "\uC640 \uAC19\uC73C\uBA74", "!=": "\uC640 \uB2E4\uB974\uBA74", "<": "\uBCF4\uB2E4 \uC791\uC73C\uBA74", "<=": "\uC774\uD558\uC774\uBA74", ">": "\uBCF4\uB2E4 \uD06C\uBA74", ">=": "\uC774\uC0C1\uC774\uBA74" };
function irClause(e) {
  if (!e) return "";
  if (e.kind === "binary") {
    if (e.op === "&&") return irClause(e.left) + " \uADF8\uB9AC\uACE0 " + irClause(e.right);
    if (e.op === "||") return irClause(e.left) + " \uB610\uB294 " + irClause(e.right);
    const m = irMembership(e);
    if (m) {
      const lbl2 = irFieldLabel(m.field);
      return lbl2 + irSubj(lbl2) + " " + m.members + " \uC911 \uD558\uB098\uC774\uBA74";
    }
    const lbl = irFieldLabel(e.left);
    return lbl + irSubj(lbl) + " " + irVal(e.right, irIsAddrField(e.left)) + " " + (IR_CMP[e.op] || e.op + " \uC774\uBA74");
  }
  if (e.kind === "unary" && e.op === "!") {
    const m = irMembership(e.operand);
    if (m) {
      const lbl = irFieldLabel(m.field);
      return lbl + irSubj(lbl) + " " + m.members + " \uC911 \uC5B4\uB290 \uAC83\uB3C4 \uC544\uB2C8\uBA74";
    }
    return irClause(e.operand) + "\uC774 \uC544\uB2C8\uBA74";
  }
  if (e.kind === "has") return irFieldLabel({ kind: "attr", of: e.of, attr: e.attr }) + " \uAC12\uC774 \uC788\uC73C\uBA74";
  return "\uC870\uAC74";
}
function irAnno(ir, name) {
  const a = (ir.annotations || []).find((x) => x.name === name);
  return a ? a.value : void 0;
}
function irTriggerLabel(ir) {
  const act = ir.scope && ir.scope.action;
  if (!act || act.kind === "scopeAll") return "\uBAA8\uB4E0 \uAC70\uB798";
  if (act.kind === "scopeEq" && act.entity) {
    const a = (Cedar.KNOWN_ACTIONS || []).find((x) => x.entityType === act.entity.type && x.id === act.entity.id);
    return a ? a.label : act.entity.id;
  }
  return "\uD2B9\uC815 \uC0C1\uD669";
}
function E2IrPreview({ ir, displayName, hover }) {
  const sev = E2_SEV[irAnno(ir, "severity")] || E2_SEV.warn;
  const conds = ir.conditions || [];
  const whenTxt = conds.filter((c) => c.kind === "when").map((c) => irClause(c.body)).join(" \uADF8\uB9AC\uACE0 ");
  const unlessTxt = conds.filter((c) => c.kind === "unless").map((c) => irClause(c.body)).join(" \uADF8\uB9AC\uACE0 ");
  const reason = (irAnno(ir, "reason") || "").trim();
  return /* @__PURE__ */ React.createElement("div", { className: `e2pop${hover ? " hoverpop" : ""}`, role: "tooltip" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-head" }, /* @__PURE__ */ React.createElement("span", { className: `e2pop-sev ${sev.cls}` }, /* @__PURE__ */ React.createElement(Ic, { id: sev.ic, cls: "sm" }), sev.label), /* @__PURE__ */ React.createElement("span", { className: "e2pop-title", title: displayName }, displayName)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-body" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC0C1\uD669"), /* @__PURE__ */ React.createElement("span", { className: "v" }, irTriggerLabel(ir))), /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC870\uAC74"), /* @__PURE__ */ React.createElement("span", { className: "v" }, whenTxt || "\uD56D\uC0C1")), unlessTxt && /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC608\uC678"), /* @__PURE__ */ React.createElement("span", { className: "v" }, unlessTxt)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-sentence" }, (whenTxt || "\uC774 \uAC70\uB798\uC77C \uB54C") + " " + sev.label), reason && /* @__PURE__ */ React.createElement("div", { className: "e2pop-msg" }, reason)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-foot" }, /* @__PURE__ */ React.createElement("span", { className: "e2pop-ro" }, /* @__PURE__ */ React.createElement(Ic, { id: "lock", cls: "sm" }), "\uC77D\uAE30 \uC804\uC6A9 \uBBF8\uB9AC\uBCF4\uAE30 \xB7 \uAE30\uBCF8 \uC548\uC804\uD329")));
}
function E2PolicyPreview({ binding, def, displayName, hover }) {
  const model = binding && binding.modelOverride || def && def.skeleton && def.skeleton.model || null;
  const ctx = React.useMemo(e2PreviewCtx, []);
  if (!model) {
    const ir = def && def.skeleton && def.skeleton.ir;
    if (ir && ir.kind === "policy") return /* @__PURE__ */ React.createElement(E2IrPreview, { ir, displayName, hover });
    return /* @__PURE__ */ React.createElement("div", { className: "e2pop hoverpop" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-body" }, /* @__PURE__ */ React.createElement("span", { className: "e2pop-empty" }, "\uB0B4\uC6A9\uC744 \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC5B4\uC694.")));
  }
  const sev = E2_SEV[model.severity] || E2_SEV.warn;
  const when = e2Conds(model.when, ctx);
  const unless = e2Conds(model.unless, ctx);
  const reason = (model.reason || "").trim();
  return /* @__PURE__ */ React.createElement("div", { className: `e2pop${hover ? " hoverpop" : ""}`, role: "tooltip" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-head" }, /* @__PURE__ */ React.createElement("span", { className: `e2pop-sev ${sev.cls}` }, /* @__PURE__ */ React.createElement(Ic, { id: sev.ic, cls: "sm" }), sev.label), /* @__PURE__ */ React.createElement("span", { className: "e2pop-title", title: displayName }, displayName)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-body" }, /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC0C1\uD669"), /* @__PURE__ */ React.createElement("span", { className: "v" }, e2TriggerLabel(model.trigger))), /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC870\uAC74"), when.length === 0 ? /* @__PURE__ */ React.createElement("span", { className: "v" }, "\uD56D\uC0C1") : /* @__PURE__ */ React.createElement("span", { className: "v conds" }, when.map((c) => /* @__PURE__ */ React.createElement("span", { className: "cd", key: c.key }, c.text)))), unless.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "e2pop-line" }, /* @__PURE__ */ React.createElement("span", { className: "k" }, "\uC608\uC678"), /* @__PURE__ */ React.createElement("span", { className: "v conds" }, unless.map((c) => /* @__PURE__ */ React.createElement("span", { className: "cd", key: c.key }, c.text)))), reason && /* @__PURE__ */ React.createElement("div", { className: "e2pop-msg" }, reason)), /* @__PURE__ */ React.createElement("div", { className: "e2pop-foot" }, /* @__PURE__ */ React.createElement("span", { className: "e2pop-ro" }, /* @__PURE__ */ React.createElement(Ic, { id: "lock", cls: "sm" }), "\uC77D\uAE30 \uC804\uC6A9 \uBBF8\uB9AC\uBCF4\uAE30 \xB7 \uB204\uB974\uBA74 \uAC12 \uC218\uC815")));
}
Object.assign(window, { E2PolicyPreview, e2TriggerLabel });
