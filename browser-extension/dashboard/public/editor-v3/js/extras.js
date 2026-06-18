const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const isAddr = (s) => ADDR_RE.test(String(s).trim());
function KindDot({ kind }) {
  return /* @__PURE__ */ React.createElement("span", { className: `pf-addr-dot ${kind}`, "aria-hidden": true });
}
function useAddrMatches(query, exclude) {
  const q = String(query).trim().toLowerCase();
  return Cedar.AddressBook.suggestions.filter((s) => !exclude || !exclude.has(s.address.toLowerCase())).filter((s) => q === "" || s.name.toLowerCase().includes(q) || s.address.includes(q)).slice(0, 8);
}
function AddressInput({ value, onChange }) {
  const [focused, setFocused] = React.useState(false);
  const entry = Cedar.AddressBook.lookup(value);
  const matches = useAddrMatches(focused && !entry ? value : "  ");
  const showPop = focused && !entry && matches.length > 0;
  const bad = !focused && value.trim() !== "" && !isAddr(value) && !entry;
  return /* @__PURE__ */ React.createElement("span", { className: "pf-addr" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: `pf-val mono${bad ? " invalid" : ""}${entry ? " resolved" : ""}`,
      value,
      onChange: (e) => onChange(e.target.value),
      onFocus: () => setFocused(true),
      onBlur: () => window.setTimeout(() => setFocused(false), 120),
      placeholder: "0x\u2026 \uB610\uB294 \uC774\uB984 \uAC80\uC0C9",
      spellCheck: false,
      autoComplete: "off"
    }
  ), entry && /* @__PURE__ */ React.createElement("span", { className: "pf-addr-name", title: value }, /* @__PURE__ */ React.createElement(KindDot, { kind: entry.kind }), entry.name), showPop && /* @__PURE__ */ React.createElement("div", { className: "pf-addr-pop", role: "listbox" }, matches.map((m) => /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      key: m.address,
      className: "pf-addr-opt",
      onMouseDown: (e) => {
        e.preventDefault();
        onChange(m.address);
        setFocused(false);
      }
    },
    /* @__PURE__ */ React.createElement(KindDot, { kind: m.kind }),
    /* @__PURE__ */ React.createElement("span", { className: "nm" }, m.name),
    /* @__PURE__ */ React.createElement("span", { className: "sub" }, m.sub, " \xB7 ", Cedar.shortAddress(m.address))
  ))));
}
function AddressSetInput({ values, onChange }) {
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
  return /* @__PURE__ */ React.createElement("div", { className: "pf-addrset" }, /* @__PURE__ */ React.createElement("div", { className: "pf-addrset-chips" }, values.map((v) => {
    const e = Cedar.AddressBook.lookup(v);
    const bad = !isAddr(v) && !e;
    return /* @__PURE__ */ React.createElement("span", { key: v, className: `pf-addrchip${bad ? " invalid" : ""}`, title: v }, e && /* @__PURE__ */ React.createElement(KindDot, { kind: e.kind }), /* @__PURE__ */ React.createElement("span", { className: "t" }, e ? e.name : Cedar.shortAddress(v)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "x", onClick: () => remove(v), "aria-label": "\uC81C\uAC70" }, "\xD7"));
  })), /* @__PURE__ */ React.createElement("span", { className: "pf-addr" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: inputRef,
      className: "pf-val mono",
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onFocus: () => setFocused(true),
      onBlur: () => window.setTimeout(() => setFocused(false), 120),
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          if (draft.trim()) addMany(draft);
        } else if (e.key === "Backspace" && draft === "" && values.length) remove(values[values.length - 1]);
      },
      placeholder: "\uC8FC\uC18C \uCD94\uAC00 (0x\u2026 \uB610\uB294 \uC774\uB984)",
      spellCheck: false,
      autoComplete: "off"
    }
  ), focused && matches.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "pf-addr-pop", role: "listbox" }, matches.map((m) => /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      key: m.address,
      className: "pf-addr-opt",
      onMouseDown: (e) => {
        e.preventDefault();
        addMany(m.address);
        inputRef.current && inputRef.current.focus();
      }
    },
    /* @__PURE__ */ React.createElement(KindDot, { kind: m.kind }),
    /* @__PURE__ */ React.createElement("span", { className: "nm" }, m.name),
    /* @__PURE__ */ React.createElement("span", { className: "sub" }, m.sub, " \xB7 ", Cedar.shortAddress(m.address))
  )))));
}
const PARAM_KEY_LABEL = { chain_id: "\uCCB4\uC778", asset: "\uC790\uC0B0(\uD1A0\uD070)", amount: "\uC218\uB7C9", address: "\uC8FC\uC18C", wallet: "\uC9C0\uAC11", decimals: "\uC18C\uC218\uC810" };
const paramKeyLabel = (key) => PARAM_KEY_LABEL[key] || key;
const PARAM_KIND = { chain_id: "chain", asset: "address", address: "address", wallet: "address", amount: "amount" };
const kindOf = (key) => PARAM_KIND[key] || "any";
function kindChip(kind) {
  switch (kind) {
    case "chain":
      return "\uCCB4\uC778";
    case "address":
      return "\uC8FC\uC18C";
    case "amount":
      return "\uAE08\uC561";
    default:
      return null;
  }
}
function autoName(methodName, existing) {
  const tail = methodName.split(".").pop() || "value";
  const base = tail.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}${i}`;
    if (!existing.includes(cand)) return cand;
  }
}
function buildOptions(fields) {
  const root = [
    { sel: "$.root.chain_id", label: "\uCCB4\uC778 ID (\uC774 \uAC70\uB798)", isChain: true, isAddress: false, isAmount: false },
    { sel: "$.root.from", label: "\uBCF4\uB0B4\uB294 \uC8FC\uC18C (\uC774 \uAC70\uB798)", isChain: false, isAddress: true, isAmount: false },
    { sel: "$.root.to", label: "\uBC1B\uB294 \uCEE8\uD2B8\uB799\uD2B8 (\uC774 \uAC70\uB798)", isChain: false, isAddress: true, isAmount: false }
  ];
  const action = fields.filter((f) => f.source === "base" && f.path.startsWith("context.") && f.fieldKind.startsWith("primitive.")).map((f) => {
    const leaf = f.path.split(".").pop() || "";
    return {
      sel: `$.action.${f.path.slice("context.".length)}`,
      label: f.label,
      isChain: leaf === "chain",
      isAddress: f.role === "address",
      isAmount: /amount|size|qty/i.test(leaf) || f.fieldKind === "primitive.Long" || f.fieldKind === "primitive.decimal"
    };
  });
  return [...root, ...action];
}
function optionsFor(key, all) {
  switch (kindOf(key)) {
    case "chain":
      return all.filter((o) => o.isChain);
    case "address":
      return all.filter((o) => o.isAddress);
    case "amount":
      return all.filter((o) => o.isAmount);
    default:
      return all;
  }
}
function defaultParams(m, all) {
  const out = {};
  for (const [key, spec] of Object.entries(m.params)) {
    const raw = spec && typeof spec === "object" && "literal" in spec ? String(spec.literal) : String(spec);
    if (!raw.startsWith("$.")) {
      out[key] = raw;
      continue;
    }
    const opts = optionsFor(key, all);
    out[key] = opts.some((o) => o.sel === raw) ? raw : opts[0] ? opts[0].sel : "";
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
  const mode = known ? "known" : value.startsWith("$.") ? "raw" : "lit";
  return /* @__PURE__ */ React.createElement("span", { className: "cfm-pick" }, /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "pf-select",
      value: known ? value : mode === "raw" ? "__raw" : "__lit",
      onChange: (e) => {
        const v = e.target.value;
        if (v === "__lit") onChange("");
        else if (v === "__raw") onChange(value.startsWith("$.") ? value : "$.action.");
        else onChange(v);
      }
    },
    /* @__PURE__ */ React.createElement("optgroup", { label: "\uC774 \uAC70\uB798\uC5D0\uC11C \uAC00\uC838\uC624\uAE30" }, options.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.sel, value: o.sel }, o.label))),
    /* @__PURE__ */ React.createElement("option", { value: "__lit" }, "\uACE0\uC815\uAC12 \uC9C1\uC811 \uC785\uB825\u2026"),
    /* @__PURE__ */ React.createElement("option", { value: "__raw" }, "\uC140\uB809\uD130 \uC9C1\uC811 \uC785\uB825\u2026")
  ), mode !== "known" && /* @__PURE__ */ React.createElement("input", { className: "pf-val mono", value, onChange: (e) => onChange(e.target.value), placeholder: mode === "raw" ? "$.action.\u2026" : "\uC608: 1" }));
}
function CustomFieldModal({ existing, actionTag, fields, onCreate, onClose }) {
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
    return want ? Object.values(existing).find((f) => f.label.ko === want) || null : null;
  }, [existing, label]);
  const sameCall = React.useMemo(() => {
    const wantParams = JSON.stringify(sortedParams(paramSpecs(params)));
    return Object.values(existing).find((f) => f.method === method.method && f.projection === projection && JSON.stringify(sortedParams(f.params)) === wantParams) || null;
  }, [existing, method.method, projection, params]);
  const blockMsg = sameCall ? `\uAC19\uC740 \uD638\uCD9C\uC774 \uC774\uBBF8 '${sameCall.label.ko}' \uD544\uB4DC\uB85C \uC788\uC5B4\uC694` : labelDup ? "\uAC19\uC740 \uC774\uB984\uC758 \uBCF4\uAC15 \uD544\uB4DC\uAC00 \uC774\uBBF8 \uC788\uC5B4\uC694" : null;
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
  const typeLabel = method.type === "decimal" ? "\uC18C\uC218" : method.type === "Long" ? "\uC815\uC218" : method.type === "Bool" ? "\uCC38/\uAC70\uC9D3" : "\uBB38\uC790\uC5F4";
  return /* @__PURE__ */ React.createElement("div", { className: "cfm-bd", role: "dialog", "aria-modal": true, onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "cfm", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "cfm-h" }, "\uC0C8 \uBCF4\uAC15 \uD544\uB4DC \uB9CC\uB4E4\uAE30", /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-iconbtn", onClick: onClose, "aria-label": "\uB2EB\uAE30" }, "\u2715")), /* @__PURE__ */ React.createElement("p", { className: "cfm-sub" }, "\uC815\uCC45 \uC11C\uBC84 \uBA54\uC11C\uB4DC\uB97C \uACE8\uB77C \uD30C\uB77C\uBBF8\uD130\uB97C \uB9E4\uD551\uD558\uBA74 ", /* @__PURE__ */ React.createElement("code", null, "context.custom.<\uC774\uB984>"), " \uD544\uB4DC\uAC00 \uC0DD\uACA8 \uC870\uAC74\uC5D0\uC11C \uC4F8 \uC218 \uC788\uC5B4\uC694."), /* @__PURE__ */ React.createElement("div", { className: "cfm-step" }, "\u2460 \uBB34\uC5C7\uC744 \uC870\uD68C\uD558\uB098\uC694?"), /* @__PURE__ */ React.createElement("label", { className: "cfm-row" }, /* @__PURE__ */ React.createElement("span", { className: "cfm-label" }, "\uC870\uD68C \uBA54\uC11C\uB4DC"), /* @__PURE__ */ React.createElement("select", { className: "pf-select", value: method.method, onChange: (e) => {
    const m = Cedar.METHOD_CATALOG.find((x) => x.method === e.target.value);
    if (m) pickMethod(m);
  } }, Cedar.METHOD_CATALOG.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.method, value: m.method }, m.mock ? Cedar.methodLabel(m) + " (\uC608\uC2DC)" : Cedar.methodLabel(m))))), /* @__PURE__ */ React.createElement("div", { className: "cfm-desc" }, Cedar.methodDesc(method), method.mock && /* @__PURE__ */ React.createElement("span", { className: "cfm-mock" }, " \xB7 \uC11C\uBC84 \uBBF8\uAD6C\uD604 \uC608\uC2DC\uC608\uC694")), /* @__PURE__ */ React.createElement("div", { className: "cfm-params" }, /* @__PURE__ */ React.createElement("div", { className: "cfm-step" }, "\u2461 \uBB34\uC5C7\uC73C\uB85C \uC870\uD68C\uD558\uB098\uC694?"), Object.entries(params).map(([key, v]) => {
    const chip = kindChip(kindOf(key));
    return /* @__PURE__ */ React.createElement("div", { key, className: "cfm-row" }, /* @__PURE__ */ React.createElement("span", { className: "cfm-label" }, paramKeyLabel(key), chip && /* @__PURE__ */ React.createElement("span", { className: "cfm-kind" }, chip)), /* @__PURE__ */ React.createElement(ParamPicker, { value: v, options: optionsFor(key, allOptions), onChange: (next) => setParams((p) => ({ ...p, [key]: next })) }));
  }), /* @__PURE__ */ React.createElement("details", { className: "cfm-adv" }, /* @__PURE__ */ React.createElement("summary", null, "\uACE0\uAE09 \u2014 \uC140\uB809\uD130\xB7\uACB0\uACFC \uC704\uCE58 \uC9C1\uC811 \uD3B8\uC9D1"), Object.entries(params).map(([key, v]) => /* @__PURE__ */ React.createElement("label", { key, className: "cfm-row" }, /* @__PURE__ */ React.createElement("span", { className: "cfm-label mono" }, key), /* @__PURE__ */ React.createElement("input", { className: "pf-val wide mono", value: v, onChange: (e) => setParams((p) => ({ ...p, [key]: e.target.value })) }))), /* @__PURE__ */ React.createElement("label", { className: "cfm-row" }, /* @__PURE__ */ React.createElement("span", { className: "cfm-label mono" }, "result path"), /* @__PURE__ */ React.createElement("input", { className: "pf-val wide mono", value: projection, onChange: (e) => setProjection(e.target.value) })))), /* @__PURE__ */ React.createElement("div", { className: "cfm-step" }, "\u2462 \uC774\uB984"), /* @__PURE__ */ React.createElement("label", { className: "cfm-row" }, /* @__PURE__ */ React.createElement("span", { className: "cfm-label" }, "\uD45C\uC2DC \uC774\uB984"), /* @__PURE__ */ React.createElement("input", { className: "pf-val wide", value: label, autoFocus: true, onChange: (e) => {
    setLabel(e.target.value);
    setLabelTouched(true);
  }, placeholder: "\uC608: \uC785\uB825 USD \uAC00\uCE58" })), /* @__PURE__ */ React.createElement("div", { className: "cfm-autoname" }, typeLabel, " \uAC12 \xB7 \uC870\uAC74 \uD544\uB4DC\uB85C ", /* @__PURE__ */ React.createElement("code", null, "context.custom.", name)), blockMsg && /* @__PURE__ */ React.createElement("div", { className: "cfm-block" }, "\u26A0 ", blockMsg), /* @__PURE__ */ React.createElement("div", { className: "cfm-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-add-cond", onClick: onClose }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "cfm-create", disabled: !canCreate, onClick: create }, "\uD544\uB4DC \uB9CC\uB4E4\uAE30"))));
}
function ManifestPreview({ open, onToggle, autoManifest, errors, overrideText, parseErr, canEdit, onEdit, onChangeText, onReset }) {
  const editing = overrideText !== null;
  const hasManifest = autoManifest !== void 0;
  const tag = editing ? "\uC9C1\uC811 \uD3B8\uC9D1\uB428" : errors.length > 0 ? `\uC624\uB958 ${errors.length}` : hasManifest ? "\uBCF4\uAC15 \uD544\uB4DC \uC788\uC74C" : "\uBD88\uD544\uC694";
  return /* @__PURE__ */ React.createElement("div", { className: "pf-manifest" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-manifest-head", onClick: onToggle, "aria-expanded": open }, /* @__PURE__ */ React.createElement("span", { className: `pf-manifest-caret${open ? " open" : ""}` }, "\u25B6"), "manifest", /* @__PURE__ */ React.createElement("span", { className: `pf-manifest-tag${editing ? " edited" : ""}` }, tag)), open && /* @__PURE__ */ React.createElement("div", { className: "pf-manifest-body" }, /* @__PURE__ */ React.createElement("div", { className: "pf-manifest-bar" }, editing ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: `pf-manifest-status${parseErr ? " err" : " ok"}` }, parseErr ? `JSON \uC624\uB958: ${parseErr}` : "\uC9C1\uC811 \uD3B8\uC9D1 \uC911 \u2014 \uC800\uC7A5 \uC2DC \uC774 \uAC12\uC744 \uC501\uB2C8\uB2E4"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-manifest-btn", onClick: onReset }, "\u21BA \uC790\uB3D9\uC73C\uB85C")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "pf-manifest-status" }, "\uC815\uCC45\uC5D0\uC11C \uC77D\uB294 \uBCF4\uAC15 \uD544\uB4DC\uB85C \uC790\uB3D9 \uC0DD\uC131\uB3FC\uC694"), canEdit && hasManifest && /* @__PURE__ */ React.createElement("button", { type: "button", className: "pf-manifest-btn", onClick: onEdit }, "\u270E \uC9C1\uC811 \uD3B8\uC9D1"))), editing ? /* @__PURE__ */ React.createElement("textarea", { className: `pf-manifest-edit${parseErr ? " invalid" : ""}`, value: overrideText, onChange: (e) => onChangeText(e.target.value), spellCheck: false, rows: 12 }) : errors.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "pf-manifest-err" }, errors.map((e, i) => /* @__PURE__ */ React.createElement("div", { key: i }, "\u26A0 ", e.message))) : hasManifest ? /* @__PURE__ */ React.createElement("pre", { className: "pf-manifest-json" }, JSON.stringify(autoManifest, null, 2)) : /* @__PURE__ */ React.createElement("div", { className: "pf-manifest-empty" }, "\uC774 \uC815\uCC45\uC740 ", /* @__PURE__ */ React.createElement("code", null, "context.custom.*"), " \uBCF4\uAC15 \uD544\uB4DC\uB97C \uC4F0\uC9C0 \uC54A\uC544 manifest\uAC00 \uD544\uC694 \uC5C6\uC5B4\uC694.")));
}
Object.assign(window, { KindDot, AddressInput, AddressSetInput, CustomFieldModal, ManifestPreview });
