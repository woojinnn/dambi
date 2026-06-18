const OP_LABEL = { "==": "=", "!=": "\u2260", "<": "<", "<=": "\u2264", ">": ">", ">=": "\u2265", contains: "\uD3EC\uD568", notContains: "\uD3EC\uD568 \uC548 \uD568", in: "\uB2E4\uC74C \uC911 \uD558\uB098", notIn: "\uB2E4\uC74C \uC911 \uC544\uB2D8" };
const SUFFIX_KO = { "==": "\uC640 \uAC19\uC73C\uBA74", "!=": "\uC640 \uB2E4\uB974\uBA74", "<": "\uBCF4\uB2E4 \uC791\uC73C\uBA74", "<=": "\uC774\uD558\uC774\uBA74", ">": "\uBCF4\uB2E4 \uD06C\uBA74", ">=": "\uC774\uC0C1\uC774\uBA74", contains: "\uC744 \uD3EC\uD568\uD558\uBA74", notContains: "\uC744 \uD3EC\uD568\uD558\uC9C0 \uC54A\uC73C\uBA74", in: "\uC911 \uD558\uB098\uC774\uBA74", notIn: "\uC911 \uC5B4\uB290 \uAC83\uB3C4 \uC544\uB2C8\uBA74" };
const SCALAR_OPS = /* @__PURE__ */ new Set(["==", "!=", "<", "<=", ">", ">="]);
const ROLE_LABEL_KO = { address: "\uC8FC\uC18C", ref: "\uD1A0\uD070\xB7\uAC70\uB798 \uC7A5\uC18C", numeric: "\uAE08\uC561\xB7\uC218\uB7C9", enum: "\uBC29\uD5A5\xB7\uC8FC\uBB38", auth: "\uC778\uC99D\xB7\uD3EC\uC9C0\uC158", derived: "\uC790\uB3D9 \uACC4\uC0B0\uAC12" };
const ROLE_ORDER = ["numeric", "derived", "address", "ref", "enum", "auth"];
const PRINCIPAL_ADDRESS = { path: "principal.address", label: "\uB0B4 \uC9C0\uAC11 \uC8FC\uC18C", role: "address", fieldKind: "primitive.String", source: "base" };
const ENUM_SUGGESTIONS = {
  "context.direction.kind": ["exact_input", "exact_output"],
  "context.side": ["long", "short"],
  "context.orderType.kind": ["limit", "stop", "twap"],
  "context.orderType.timeInForce.kind": ["gtc", "ioc", "fok", "post_only", "gtd"],
  "context.venue.name": ["uniswap_v2", "uniswap_v3", "uniswap_v4", "aave_v3", "curve", "balancer_v2", "cowswap", "1inch", "hyperliquid"]
};
function stringFlavor(field) {
  if (!field) return "plain";
  if (field.role === "address") return "address";
  if (field.role === "enum") return "enum";
  return "plain";
}
function defaultValueOfKind(kind) {
  switch (kind) {
    case "bool":
      return { kind: "bool", value: true };
    case "long":
      return { kind: "long", value: 0 };
    case "decimal":
      return { kind: "decimal", value: "0" };
    case "set":
      return { kind: "set", values: [] };
    case "field":
      return { kind: "field", path: PRINCIPAL_ADDRESS.path };
    default:
      return { kind: "string", value: "" };
  }
}
function valueKindFor(field, op) {
  if (op === "in" || op === "notIn") return "set";
  return field ? Cedar.valueKindForField(field.fieldKind) : "string";
}
function compatibleRhsFields(all, lhs) {
  if (!lhs) return all;
  const kind = Cedar.valueKindForField(lhs.fieldKind);
  return all.filter((f) => f.path !== lhs.path && f.fieldKind.startsWith("primitive.") && Cedar.valueKindForField(f.fieldKind) === kind && f.role === "address" === (lhs.role === "address"));
}
function newCond(fields) {
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
  const e = window.Cedar && Cedar.AddressBook && Cedar.AddressBook.lookup(str);
  if (e) return e.name;
  if (/^0x[0-9a-fA-F]{40}$/.test(str)) return shortAddr(str);
  return null;
}
function valueText(v, ctx, field) {
  const unit = field && field.unit ? ` ${field.unit}` : "";
  switch (v.kind) {
    case "bool":
      return v.value ? "\uCC38" : "\uAC70\uC9D3";
    case "long":
      return (field && field.scale === "nano" ? v.value / 1e9 : v.value) + unit;
    case "decimal":
      return v.value + unit;
    case "string": {
      if (v.value === "") return "(\uBE48 \uAC12)";
      const ad = e2AddrDisplay(v.value);
      return ad ?? `"${v.value}"`;
    }
    case "set":
      return v.values.length ? `[${v.values.map((x) => e2AddrDisplay(x) ?? shortAddr(x)).join(", ")}]` : "[\uBE44\uC5B4 \uC788\uC74C]";
    case "field":
      return ctx.fieldByPath.get(v.path)?.label ?? ctx.rhsFields.find((f) => f.path === v.path)?.label ?? v.path;
  }
}
function condChip(cond, ctx) {
  const field = ctx.fieldByPath.get(cond.fieldPath);
  const subj = field?.label ?? cond.fieldPath ?? "\uAC12";
  return `${subj}${SUFFIX_KO[cond.op] ? " " : " "}${valueText(cond.value, ctx, field)} ${SUFFIX_KO[cond.op] || OP_LABEL[cond.op]}`.replace(/\s+/g, " ").trim();
}
function FieldCombobox({ value, fields, onChange }) {
  const byRole = {};
  for (const f of fields) (byRole[f.role] = byRole[f.role] || []).push(f);
  const roles = ROLE_ORDER.filter((r) => byRole[r]).concat(Object.keys(byRole).filter((r) => !ROLE_ORDER.includes(r)));
  const known = fields.some((f) => f.path === value);
  return /* @__PURE__ */ React.createElement("span", { className: "fc" }, /* @__PURE__ */ React.createElement("select", { className: "pf-ctl pf-field-sel", value, onChange: (e) => onChange(e.target.value) }, !known && /* @__PURE__ */ React.createElement("option", { value }, value || "\uD544\uB4DC \uC120\uD0DD\u2026"), roles.map((r) => /* @__PURE__ */ React.createElement("optgroup", { key: r, label: ROLE_LABEL_KO[r] || r }, byRole[r].map((f) => /* @__PURE__ */ React.createElement("option", { key: f.path, value: f.path }, f.label))))));
}
function ValueInput({ value, field, invalid, onChange }) {
  const unit = field && field.unit;
  switch (value.kind) {
    case "bool":
      return /* @__PURE__ */ React.createElement("select", { className: "pf-val", value: String(value.value), onChange: (e) => onChange({ kind: "bool", value: e.target.value === "true" }) }, /* @__PURE__ */ React.createElement("option", { value: "true" }, "true"), /* @__PURE__ */ React.createElement("option", { value: "false" }, "false"));
    case "long": {
      const nano = field && field.scale === "nano";
      const shown = nano ? value.value / 1e9 : value.value;
      return /* @__PURE__ */ React.createElement("span", { className: "pf-val-wrap" }, /* @__PURE__ */ React.createElement("input", { className: "pf-val num", type: "number", step: nano ? "any" : void 0, value: shown, onChange: (e) => {
        const n = Number(e.target.value);
        onChange({ kind: "long", value: nano ? Math.round(n * 1e9) : n });
      } }), unit && /* @__PURE__ */ React.createElement("span", { className: "pf-unit" }, unit));
    }
    case "decimal":
      return /* @__PURE__ */ React.createElement("span", { className: "pf-val-wrap" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          className: `pf-val num${invalid ? " invalid" : ""}`,
          value: value.value,
          onChange: (e) => onChange({ kind: "decimal", value: e.target.value }),
          onBlur: (e) => {
            const n = Cedar.normalizeDecimal(e.target.value);
            if (n !== null && n !== e.target.value) onChange({ kind: "decimal", value: n });
          },
          placeholder: "0.05"
        }
      ), unit && /* @__PURE__ */ React.createElement("span", { className: "pf-unit" }, unit));
    case "set":
      if (field && field.role === "address") {
        return /* @__PURE__ */ React.createElement(AddressSetInput, { values: value.values, onChange: (values) => onChange({ kind: "set", values }) });
      }
      return /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "pf-val wide",
          value: value.values.join(", "),
          onChange: (e) => onChange({ kind: "set", values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }),
          placeholder: "0x\uC8FC\uC18C1, 0x\uC8FC\uC18C2, \u2026"
        }
      );
    case "field":
      return null;
    default: {
      const flavor = stringFlavor(field);
      if (flavor === "address") {
        return /* @__PURE__ */ React.createElement(AddressInput, { value: value.value, onChange: (v) => onChange({ kind: "string", value: v }) });
      }
      const sugg = field ? ENUM_SUGGESTIONS[field.path] : void 0;
      if (flavor === "enum" || sugg) {
        const listId = `enum-${field ? field.path : ""}`;
        return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
          "input",
          {
            className: "pf-val",
            list: sugg ? listId : void 0,
            value: value.value,
            onChange: (e) => onChange({ kind: "string", value: e.target.value }),
            placeholder: field && field.desc ? field.desc.slice(0, 24) : "\uAC12"
          }
        ), sugg && /* @__PURE__ */ React.createElement("datalist", { id: listId }, sugg.map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }))));
      }
      return /* @__PURE__ */ React.createElement("input", { className: "pf-val", value: value.value, onChange: (e) => onChange({ kind: "string", value: e.target.value }), placeholder: "\uAC12" });
    }
  }
}
function ConditionRow({ cond, alt, ctx, selected, onSelect, onDragStart, onField, onOp, onValue, onGroup, onRemove }) {
  const field = ctx.fieldByPath.get(cond.fieldPath);
  const ops = field ? Cedar.operatorsFor(field.fieldKind) : ["=="];
  const chip = cond.fieldPath ? condChip(cond, ctx) : "\u2026";
  const rhsOptions = compatibleRhsFields(ctx.rhsFields, field);
  const canField = SCALAR_OPS.has(cond.op) && rhsOptions.length > 0;
  const fieldMode = cond.value.kind === "field";
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `pf-cond${selected ? " is-selected" : ""}`,
      onClick: onSelect ? (ev) => {
        if (ev.target.closest("button, select, input, [draggable], .fc")) return;
        onSelect();
      } : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "pf-cond-main" }, onDragStart && !ctx.valuesOnly && /* @__PURE__ */ React.createElement("span", { className: "pf-drag", draggable: true, onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "cond");
      onDragStart();
    }, title: "\uB4DC\uB798\uADF8\uD574\uC11C \uB2E4\uB978 \uC0C1\uD669\xB7\uBB36\uC74C\uC73C\uB85C \uC774\uB3D9" }, "\u283F"), /* @__PURE__ */ React.createElement("span", { className: `pf-bullet${alt ? " alt" : ""}` }, alt ? "\u25E6" : "\u2022"), ctx.valuesOnly ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "pf-ctl pf-ro" }, field?.label ?? cond.fieldPath ?? "\u2026"), /* @__PURE__ */ React.createElement("span", { className: "pf-ctl pf-leaf-op pf-ro" }, OP_LABEL[cond.op])) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(FieldCombobox, { value: cond.fieldPath, fields: ctx.fields, onChange: onField }), /* @__PURE__ */ React.createElement("select", { className: "pf-ctl pf-leaf-op", value: cond.op, onChange: (e) => onOp(e.target.value) }, ops.map((op) => /* @__PURE__ */ React.createElement("option", { key: op, value: op }, OP_LABEL[op])))), canField && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-ctl pf-mode", onClick: () => onValue(fieldMode ? defaultValueOfKind(valueKindFor(field, cond.op)) : { kind: "field", path: rhsOptions[0]?.path ?? "principal.address" }), title: fieldMode ? "\uACE0\uC815 \uAC12\uC73C\uB85C" : "\uB2E4\uB978 \uD544\uB4DC\uC640 \uBE44\uAD50" }, fieldMode ? "\uD544\uB4DC" : "\uAC12"), fieldMode ? /* @__PURE__ */ React.createElement(FieldCombobox, { value: cond.value.kind === "field" ? cond.value.path : "", fields: rhsOptions, onChange: (p) => onValue({ kind: "field", path: p }) }) : /* @__PURE__ */ React.createElement(ValueInput, { value: cond.value, field, onChange: onValue }), /* @__PURE__ */ React.createElement("span", { className: "pf-grow" }), onGroup && !ctx.valuesOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-iconbtn", onClick: onGroup, title: alt ? "\uC774 \uC120\uD0DD\uC9C0\uC5D0 '\uADF8\uB9AC\uACE0' \uC870\uAC74\uC744 \uBD99\uC5EC\uC694" : "\uC774 \uC870\uAC74\uC5D0 '\uB610\uB294' \uC120\uD0DD\uC9C0\uB97C \uBD99\uC5EC\uC694" }, alt ? "+\uADF8\uB9AC\uACE0" : "+\uB610\uB294"), !ctx.valuesOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-iconbtn danger", onClick: onRemove, "aria-label": "\uC870\uAC74 \uC0AD\uC81C", title: "\uC0AD\uC81C" }, "\u2715")),
    cond.fieldPath && /* @__PURE__ */ React.createElement("div", { className: "pf-cond-chip" }, chip)
  );
}
function GroupBox({ group, orCtx, ctx, dragging, selection, onDragStartCond, onDropIntoGroup, onConds, onRemove }) {
  const { conds } = group;
  const norm = (xs) => xs.map((c, i) => {
    const want = i === 0 ? "and" : "or";
    return c.joiner === want ? c : { ...c, joiner: want };
  });
  const update = (i, n) => onConds(norm(conds.map((x, j) => j === i ? n : x)));
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
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `pf-box ${orCtx ? "or" : "and"}${dragging ? " droppable" : ""}${selection.isNodeSelected(group) ? " is-selected" : ""}`,
      onDragOver: dragging ? (e) => e.preventDefault() : void 0,
      onDrop: dragging ? (e) => {
        e.stopPropagation();
        e.preventDefault();
        onDropIntoGroup(group);
      } : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "pf-box-head", onClick: (ev) => {
      if (ev.target.closest("button")) return;
      selection.onClickNode(group);
    } }, /* @__PURE__ */ React.createElement("span", { className: "pf-box-label" }, orCtx ? "\uB2E4\uC74C \uC911 \uD558\uB098\uB77C\uB3C4" : "\uB2E4\uC74C\uC5D0 \uBAA8\uB450 \uD574\uB2F9"), /* @__PURE__ */ React.createElement("span", { className: "pf-spc" }), !ctx.valuesOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-iconbtn danger", onClick: onRemove, "aria-label": "\uC0AD\uC81C", title: "\uC774 \uBB36\uC74C \uC804\uCCB4 \uC0AD\uC81C" }, "\u2715")),
    conds.map(
      (c, i) => Cedar.isGroupNode(c) ? /* @__PURE__ */ React.createElement(GroupBox, { key: i, group: c, orCtx: !orCtx, ctx, dragging, selection, onDragStartCond, onDropIntoGroup, onConds: (next) => update(i, { ...c, conds: next }), onRemove: () => removeAt(i) }) : /* @__PURE__ */ React.createElement(ConditionRow, { key: i, cond: c, alt: orCtx, ctx, selected: selection.isNodeSelected(c), onSelect: () => selection.onClickNode(c), onDragStart: () => onDragStartCond(c), onField: (p) => update(i, pickFieldCond(c, p, ctx.fieldByPath)), onOp: (op) => update(i, pickOpCond(c, op, ctx.fieldByPath)), onValue: (value) => update(i, { ...c, value }), onGroup: () => wrapChild(i), onRemove: () => removeAt(i) })
    ),
    !ctx.valuesOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-or-btn", onClick: () => onConds(norm([...conds, newCond(ctx.fields)])) }, orCtx ? "+ \uB610\uB294" : "+ \uADF8\uB9AC\uACE0")
  );
}
function ConditionEditor({ nodes, ctx, emptyHint, onChange, selection }) {
  const runs = Cedar.situationsOf(nodes);
  const commit = (next) => onChange(Cedar.normalizeSituations(Cedar.flattenSituations(next)));
  const updateNode = (si, ni, n) => commit(runs.map((r, i) => i === si ? r.map((x, j) => j === ni ? n : x) : r));
  const removeNode = (si, ni) => commit(runs.map((r, i) => i === si ? r.filter((_, j) => j !== ni) : r));
  const addCond = (si) => commit(runs.map((r, i) => i === si ? [...r, newCond(ctx.fields)] : r));
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
  return /* @__PURE__ */ React.createElement(React.Fragment, null, runs.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "pf-empty-cond" }, emptyHint), runs.map((run, si) => /* @__PURE__ */ React.createElement("div", { key: si }, si > 0 && /* @__PURE__ */ React.createElement("div", { className: "pf-or-div" }, /* @__PURE__ */ React.createElement("span", null, "\uB610\uB294")), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `pf-sit${drag ? " droppable" : ""}${selection.isSituationSelected(run[0]) ? " is-selected" : ""}`,
      onDragOver: drag ? (e) => e.preventDefault() : void 0,
      onDrop: drag ? (e) => {
        e.preventDefault();
        dropTo({ kind: "situation", index: si });
      } : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "pf-sit-head", onClick: (ev) => {
      if (ev.target.closest("button")) return;
      selection.onClickSituation(run[0]);
    } }, /* @__PURE__ */ React.createElement("span", { className: "pf-sit-title" }, "\uC0C1\uD669 ", si + 1), run.length > 1 && /* @__PURE__ */ React.createElement("span", { className: "pf-sit-mode" }, "\uB2E4\uC74C\uC5D0 \uBAA8\uB450 \uD574\uB2F9"), /* @__PURE__ */ React.createElement("span", { className: "pf-spc" }), !ctx.valuesOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-iconbtn danger", onClick: () => removeSituation(si), "aria-label": "\uC0C1\uD669 \uC0AD\uC81C", title: "\uC0C1\uD669 \uC0AD\uC81C" }, "\u2715")),
    run.map(
      (n, ni) => Cedar.isGroupNode(n) ? /* @__PURE__ */ React.createElement(GroupBox, { key: ni, group: n, orCtx: true, ctx, dragging: drag !== null, selection, onDragStartCond: (c) => setDrag(c), onDropIntoGroup: (g) => dropTo({ kind: "group", group: g }), onConds: (conds) => updateNode(si, ni, { ...n, conds }), onRemove: () => removeNode(si, ni) }) : /* @__PURE__ */ React.createElement(ConditionRow, { key: ni, cond: n, ctx, selected: selection.isNodeSelected(n), onSelect: () => selection.onClickNode(n), onDragStart: () => setDrag(n), onField: (p) => updateNode(si, ni, pickFieldCond(n, p, ctx.fieldByPath)), onOp: (op) => updateNode(si, ni, pickOpCond(n, op, ctx.fieldByPath)), onValue: (value) => updateNode(si, ni, { ...n, value }), onGroup: () => addOr(si, ni), onRemove: () => removeNode(si, ni) })
    ),
    !ctx.valuesOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-add-cond sm", onClick: () => addCond(si) }, "+ \uADF8\uB9AC\uACE0")
  ))), drag !== null && /* @__PURE__ */ React.createElement("div", { className: "pf-dropstrip", onDragOver: (e) => e.preventDefault(), onDrop: (e) => {
    e.preventDefault();
    dropTo({ kind: "new-situation" });
  } }, "\uC5EC\uAE30\uC5D0 \uB193\uC544 \uC0C8 \uC0C1\uD669\uC73C\uB85C \uB9CC\uB4E4\uAE30"), !ctx.valuesOnly && /* @__PURE__ */ React.createElement("div", { className: "pf-add-row" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-add-cond", onClick: addSituation }, runs.length === 0 ? "+ \uC704\uD5D8 \uC0C1\uD669 \uCD94\uAC00" : "+ \uB610\uB294"), ctx.onCreateCustom && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "pf-add-cond accent",
      onClick: ctx.onCreateCustom,
      disabled: !ctx.customFieldEnabled,
      title: ctx.customFieldEnabled ? "\uC815\uCC45 \uC11C\uBC84 \uBA54\uC11C\uB4DC\uB85C context.custom.* \uD544\uB4DC\uB97C \uB9CC\uB4E4\uC5B4\uC694" : "\uBA3C\uC800 \uB3D9\uC791\uC744 \uD558\uB098 \uACE8\uB77C\uC8FC\uC138\uC694 \u2014 \uBCF4\uAC15 \uD30C\uB77C\uBBF8\uD130\uB294 \uB3D9\uC791\uBCC4\uC774\uC5D0\uC694"
    },
    "\uFF0B \uC0C8 \uBCF4\uAC15 \uD544\uB4DC \uB9CC\uB4E4\uAE30"
  )));
}
Object.assign(window, { OP_LABEL, SUFFIX_KO, SCALAR_OPS, PRINCIPAL_ADDRESS, ENUM_SUGGESTIONS, stringFlavor, defaultValueOfKind, valueKindFor, compatibleRhsFields, newCond, condChip, valueText, FieldCombobox, ValueInput, ConditionRow, GroupBox, ConditionEditor });
