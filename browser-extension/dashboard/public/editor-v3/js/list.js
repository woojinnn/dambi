function defUsageCount(snap, defId) {
  let n = 0;
  for (const w of Object.values(snap.wallets.byAddress)) {
    if (Object.values(w.bindings).some((b) => b.defId === defId)) n += 1;
  }
  return n;
}
function packageDisplayOn(packageOn, activeBindings) {
  return packageOn && activeBindings > 0;
}
const DRAG_DEF_MIME = "application/x-dambi-def-id";
const SOURCE_LABEL = { builtin: "\uB0B4\uC7A5", mine: "\uB0B4 \uC815\uCC45", market: "Policy Hub" };
async function run(label, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`[${label}]`, err);
    pushToast(`${label}\uC5D0 \uC2E4\uD328\uD588\uC5B4\uC694`);
    return false;
  }
}
Object.assign(window, { defUsageCount, packageDisplayOn, DRAG_DEF_MIME, SOURCE_LABEL, run });
function dashboardId(slug) {
  return "def::" + slug;
}
function seedCedar(id) {
  return `// @id("${id}")
forbid (
  principal,
  action,
  resource
);`;
}
const CHOOSER_CARDS = [
  {
    key: "llm",
    accent: "sage",
    title: "LLM\uC73C\uB85C \uB9CC\uB4E4\uAE30",
    summary: "\uC6D0\uD558\uB294 \uADDC\uCE59\uC744 \uD55C\uAD6D\uC5B4\uB85C \uC124\uBA85\uD558\uBA74 LLM\uC774 \uD3FC \uC815\uCC45 \uCD08\uC548\uC744 \uB9CC\uB4E4\uC5B4\uC918\uC694 \xB7 \uC0DD\uC131 \uD6C4 \uD3FC\uC5D0\uC11C \uD655\uC778\xB7\uC218\uC815.",
    rec: "\uBE60\uB974\uAC8C \uCD08\uC548\uBD80\uD130",
    pros: ["\uC790\uC5F0\uC5B4\uB85C \uC124\uBA85\uB9CC", "\uD3FC\uC73C\uB85C \uBCC0\uD658\xB7\uAC80\uC99D"],
    cons: ["\uCD08\uC548\uC740 \uAC80\uD1A0 \uD544\uC694", "OpenAI \uD0A4 \uD544\uC694"],
    preview: "llm"
  },
  {
    key: "form",
    accent: "cyan",
    title: "\uD3FC\uC73C\uB85C \uB9CC\uB4E4\uAE30",
    summary: "\uAC00\uC7A5 \uC26C\uC6C0 \xB7 \uD754\uD55C \uC815\uCC45(forbid + AND) \xB7 .cedar\uC640 manifest \uC790\uB3D9 \uC0DD\uC131 \xB7 \uC784\uACC4\uAC12\uB9CC \uBC14\uAFB8\uBA74 \uB05D.",
    rec: "\uCC98\uC74C\xB7\uD45C\uC900 \uC815\uCC45",
    pros: ["round-trip \uC548\uC804\uB9DD", "cedar\xB7manifest \uC790\uB3D9", "\uC778\uB77C\uC778 \uAC12 \uD3B8\uC9D1"],
    cons: ["\uBCF5\uC7A1\uD55C \uC815\uCC45(OR\xB7\uC911\uCCA9 \uB4F1)\uC740 \uD3FC\uC73C\uB85C \uC548 \uC5F4\uB9B4 \uC218 \uC788\uC5B4\uC694"],
    preview: "form"
  },
  {
    key: "cedar",
    accent: "slate",
    title: "Cedar\uB85C \uB9CC\uB4E4\uAE30",
    summary: "\uCF54\uB4DC \uC9C1\uC811 \uC791\uC131 \xB7 \uCD5C\uB300 \uC790\uC720, \uAC00\uB4DC \uCD5C\uC18C \xB7 \uD3FC \uC548\uC804\uB9DD \uBC16 \xB7 \uC219\uB828\uC790\uC6A9.",
    rec: "Cedar\uB97C \uC544\uB294 \uC0AC\uB78C",
    pros: ["\uCD5C\uB300 \uC790\uC720", "manifest \uC9C1\uC811 \uAD00\uB9AC"],
    cons: ["\uAC00\uB4DC \uCD5C\uC18C", "\uD3FC \uC548\uC804\uB9DD \uBC16"],
    preview: "cedar"
  }
];
function ChooserPreview({ kind }) {
  if (kind === "llm") {
    return /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-prev llm" }, /* @__PURE__ */ React.createElement("div", { className: "prompt" }, /* @__PURE__ */ React.createElement("span", { className: "spark" }, "\u2726"), /* @__PURE__ */ React.createElement("span", { className: "ln l1" }), /* @__PURE__ */ React.createElement("span", { className: "ln l2" })), /* @__PURE__ */ React.createElement("div", { className: "and" }, "\u2193"), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", { className: "cap" }), /* @__PURE__ */ React.createElement("span", { className: "fld" }), /* @__PURE__ */ React.createElement("span", { className: "op" }, ">"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "150")));
  }
  if (kind === "form") {
    return /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-prev form" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", { className: "cap" }), /* @__PURE__ */ React.createElement("span", { className: "fld" }), /* @__PURE__ */ React.createElement("span", { className: "op" }, ">"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "150")), /* @__PURE__ */ React.createElement("div", { className: "and" }, "AND"), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", { className: "cap" }), /* @__PURE__ */ React.createElement("span", { className: "fld w2" }), /* @__PURE__ */ React.createElement("span", { className: "op" }, "\u2260"), /* @__PURE__ */ React.createElement("span", { className: "val ref" }, "self")));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-prev cedar" }, /* @__PURE__ */ React.createElement("div", { className: "ln" }, /* @__PURE__ */ React.createElement("span", { className: "g" }), /* @__PURE__ */ React.createElement("span", { className: "t kw" })), /* @__PURE__ */ React.createElement("div", { className: "ln" }, /* @__PURE__ */ React.createElement("span", { className: "g" }), /* @__PURE__ */ React.createElement("span", { className: "t" })), /* @__PURE__ */ React.createElement("div", { className: "ln" }, /* @__PURE__ */ React.createElement("span", { className: "g" }), /* @__PURE__ */ React.createElement("span", { className: "t guard" })), /* @__PURE__ */ React.createElement("div", { className: "ln" }, /* @__PURE__ */ React.createElement("span", { className: "g" }), /* @__PURE__ */ React.createElement("span", { className: "t s" })));
}
function NewPolicyChooser({ open, onClose, defaultScope, defaultWallet }) {
  if (!open) return null;
  const pick = (method) => {
    const stamp = Date.now().toString(36);
    const slug = `new-${method}-${stamp}`;
    const id = dashboardId(slug);
    const initialTab = method === "llm" ? "llm" : void 0;
    const realMethod = method === "cedar" ? "cedar" : "form";
    onClose();
    navigate(`/editor/${encodeURIComponent(id)}`, {
      state: { newPolicy: { method: realMethod, cedarText: seedCedar(slug), displayName: "\uC0C8 \uC815\uCC45", defaultScope: defaultScope || null, defaultWallet: defaultWallet || null, ...initialTab ? { initialTab } : {} } }
    });
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-modal-bd", role: "dialog", "aria-modal": true, onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-h" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "t" }, "\uC0C8 \uC815\uCC45 \uB9CC\uB4E4\uAE30"), /* @__PURE__ */ React.createElement("div", { className: "s" }, "\uC5B4\uB5A4 \uBC29\uC2DD\uC73C\uB85C \uC2DC\uC791\uD560\uC9C0 \uACE0\uB974\uC138\uC694. \uB458 \uB2E4 \uAC19\uC740 Cedar\uB85C \uC800\uC7A5\uB418\uACE0, \uB098\uC911\uC5D0 \uB2E4\uB978 \uBC29\uC2DD\uC73C\uB85C\uB3C4 \uBCFC \uC218 \uC788\uC5B4\uC694 (\uD3FC\uC740 \uB2E8\uC21C\uD55C \uC815\uCC45\uB9CC).")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-mpc-x", onClick: onClose, "aria-label": "\uB2EB\uAE30" }, /* @__PURE__ */ React.createElement(XIcon, null))), /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-grid" }, CHOOSER_CARDS.map((c) => /* @__PURE__ */ React.createElement("button", { key: c.key, type: "button", className: `ev2-mpc-card ${c.accent}`, onClick: () => pick(c.key) }, /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-card-top" }, /* @__PURE__ */ React.createElement("span", { className: "ev2-mpc-ic" }, /* @__PURE__ */ React.createElement(ShieldIcon, null)), /* @__PURE__ */ React.createElement("span", { className: "ev2-mpc-title" }, c.title)), /* @__PURE__ */ React.createElement(ChooserPreview, { kind: c.preview }), /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-summary" }, c.summary), /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-rec" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "\uCD94\uCC9C"), c.rec), /* @__PURE__ */ React.createElement("div", { className: "ev2-mpc-pc" }, /* @__PURE__ */ React.createElement("ul", { className: "pros" }, c.pros.map((p, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement(CheckIcon, null), p))), /* @__PURE__ */ React.createElement("ul", { className: "cons" }, c.cons.map((p, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement(XIcon, null), p)))), /* @__PURE__ */ React.createElement("span", { className: "ev2-mpc-go" }, "\uC774 \uBC29\uC2DD\uC73C\uB85C \uC2DC\uC791", /* @__PURE__ */ React.createElement(CaretRightIcon, null)))))));
}
function LibraryDirectory(props) {
  const { snap, mode, query, catFilter, onOpenDef, onDuplicate, onDelete, onDefaults, onToggleDefault, onRenamePackage, onDeletePackage, onPublishPackage, onMoveDef } = props;
  const [collapsed, setCollapsed] = React.useState(/* @__PURE__ */ new Set());
  const [dropTarget, setDropTarget] = React.useState(null);
  const [renaming, setRenaming] = React.useState(null);
  const [draftName, setDraftName] = React.useState("");
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const packages = React.useMemo(
    () => Object.values(snap.library.packages).sort((a, b) => a.id === UNCAT ? 1 : b.id === UNCAT ? -1 : a.id.localeCompare(b.id)),
    [snap]
  );
  const byFolder = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    const q = query.trim().toLowerCase();
    for (const d of Object.values(snap.library.defs)) {
      if (d.hidden) continue;
      if (q && !d.displayName.toLowerCase().includes(q) && !d.id.toLowerCase().includes(q)) continue;
      if (catFilter !== "all" && catKey(d.cat) !== catFilter) continue;
      const raw = d.defaults.packageId;
      const key = raw && snap.library.packages[raw] ? raw : UNCAT;
      const arr = m.get(key) || [];
      arr.push(d);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
    return m;
  }, [snap, query, catFilter]);
  const toggleFolder = (id) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const filtering = query.trim().length > 0 || catFilter !== "all";
  const allPkgs = packages.some((p) => p.id === UNCAT) ? packages : [...packages, { id: UNCAT, displayName: "\uBBF8\uBD84\uB958" }];
  return /* @__PURE__ */ React.createElement("div", { className: `ld${mode === "pick" ? " pick" : ""}` }, allPkgs.map((pkg) => {
    const defs = byFolder.get(pkg.id) || [];
    if (filtering && defs.length === 0) return null;
    if (pkg.id === UNCAT && defs.length === 0 && !filtering) return null;
    const open = !collapsed.has(pkg.id);
    const locked = pkg.id === UNCAT;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: pkg.id,
        className: `ld-folder is-pkg${dropTarget === pkg.id ? " droptarget" : ""}`,
        onDragOver: (e) => {
          if (mode === "manage" && onMoveDef && e.dataTransfer.types.includes(DRAG_DEF_MIME)) {
            e.preventDefault();
            setDropTarget(pkg.id);
          }
        },
        onDragLeave: () => setDropTarget((t) => t === pkg.id ? null : t),
        onDrop: (e) => {
          e.preventDefault();
          setDropTarget(null);
          const defId = e.dataTransfer.getData(DRAG_DEF_MIME);
          if (defId && onMoveDef) onMoveDef(defId, pkg.id);
        }
      },
      /* @__PURE__ */ React.createElement("div", { className: "ld-folderhead", onClick: () => toggleFolder(pkg.id) }, /* @__PURE__ */ React.createElement("span", { className: `ld-caret${open ? " open" : ""}` }, /* @__PURE__ */ React.createElement(CaretRightIcon, null)), /* @__PURE__ */ React.createElement(PackageIcon, { className: "ld-pkgico" }), renaming === pkg.id ? /* @__PURE__ */ React.createElement(
        "input",
        {
          autoFocus: true,
          value: draftName,
          onClick: (e) => e.stopPropagation(),
          onChange: (e) => setDraftName(e.target.value),
          onBlur: () => {
            setRenaming(null);
            onRenamePackage && onRenamePackage(pkg, draftName);
          },
          onKeyDown: (e) => {
            if (e.key === "Enter") e.target.blur();
            if (e.key === "Escape") setRenaming(null);
          }
        }
      ) : /* @__PURE__ */ React.createElement("span", { className: "nm" }, pkg.displayName), /* @__PURE__ */ React.createElement("span", { className: "cnt" }, defs.length), mode === "manage" && /* @__PURE__ */ React.createElement("span", { className: "acts", onClick: (e) => e.stopPropagation() }, onPublishPackage && !locked && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC774 \uD328\uD0A4\uC9C0\uB97C Policy Hub\uC5D0 \uC62C\uB9AC\uAE30", onClick: () => onPublishPackage(pkg) }, /* @__PURE__ */ React.createElement(ShieldIcon, null)), onRenamePackage && !locked && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC774\uB984 \uBCC0\uACBD", onClick: () => {
        setRenaming(pkg.id);
        setDraftName(pkg.displayName);
      } }, /* @__PURE__ */ React.createElement(PencilIcon, null)), onDeletePackage && !locked && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn danger", title: "\uC0AD\uC81C", onClick: () => onDeletePackage(pkg) }, /* @__PURE__ */ React.createElement(TrashIcon, null)))),
      open && /* @__PURE__ */ React.createElement("div", { className: "ld-defs" }, defs.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "ld-empty" }, "\uBE44\uC5B4 \uC788\uC5B4\uC694"), defs.map((d) => {
        const cat = catKey(d.cat);
        const usage = defUsageCount(snap, d.id);
        return /* @__PURE__ */ React.createElement(
          "div",
          {
            key: d.id,
            className: "ld-def",
            draggable: true,
            onDragStart: (e) => {
              e.dataTransfer.setData(DRAG_DEF_MIME, d.id);
              e.dataTransfer.effectAllowed = mode === "manage" ? "move" : "copy";
            },
            onClick: () => onOpenDef && onOpenDef(d)
          },
          /* @__PURE__ */ React.createElement("span", { className: "pol-ic", style: famStyle(d.cat).tile, title: catLabel(cat) }, /* @__PURE__ */ React.createElement(CatIcon, { cat: d.cat })),
          /* @__PURE__ */ React.createElement("span", { className: "pol-main" }, /* @__PURE__ */ React.createElement("span", { className: "pol-nm" }, d.displayName), /* @__PURE__ */ React.createElement("span", { className: `pol-desc${d.doc && d.doc.definition ? "" : " add"}` }, d.doc && d.doc.definition ? d.doc.definition : "\uC124\uBA85 \uCD94\uAC00")),
          sevLabel(d.skeleton.model.severity) && /* @__PURE__ */ React.createElement("span", { className: `pol-sev ${d.skeleton.model.severity}` }, sevLabel(d.skeleton.model.severity)),
          /* @__PURE__ */ React.createElement("span", { className: "ld-src" }, SOURCE_LABEL[d.source]),
          mode === "manage" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "ld-meta" }, usage > 0 ? `\uC9C0\uAC11 ${usage}` : ""), /* @__PURE__ */ React.createElement(
            "button",
            {
              type: "button",
              className: `ld-defaultchip${d.defaults.enabled ? " on" : ""}`,
              title: "\uC55E\uC73C\uB85C \uCD94\uAC00\uB418\uB294 \uC9C0\uAC11\uC5D0 \uC774 \uC815\uCC45\uC744 \uAE30\uBCF8\uC73C\uB85C \uC801\uC6A9\uD560\uC9C0 \u2014 \uD074\uB9AD\uD574\uC11C \uC804\uD658",
              onClick: (e) => {
                e.stopPropagation();
                onToggleDefault(d, !d.defaults.enabled);
              }
            },
            d.defaults.enabled ? "\uC0C8 \uC9C0\uAC11 \uAE30\uBCF8 \uC801\uC6A9" : "\uC0C8 \uC9C0\uAC11 \uC801\uC6A9 \uC548 \uD568"
          ), /* @__PURE__ */ React.createElement("span", { className: "ld-meta time" }, mtimeLabel(d.updatedAtMs)), /* @__PURE__ */ React.createElement("span", { className: "acts", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uAE30\uBCF8\uAC12 \uC124\uC815", onClick: () => onDefaults(d) }, /* @__PURE__ */ React.createElement(PencilIcon, null)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uBCF5\uC81C", onClick: () => onDuplicate(d) }, /* @__PURE__ */ React.createElement(CopyIcon, null)), d.source !== "builtin" && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn danger", title: "\uC0AD\uC81C", onClick: () => onDelete(d) }, /* @__PURE__ */ React.createElement(TrashIcon, null))))
        );
      }))
    );
  }));
}
function DefDefaultsModal({ def, packages, onCancel, onSave }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const [enabled, setEnabled] = React.useState(def.defaults.enabled);
  const [packageId, setPackageId] = React.useState(def.defaults.packageId || UNCAT);
  const pkgList = packages.some((p) => p.id === UNCAT) ? packages : [{ id: UNCAT, displayName: "\uBBF8\uBD84\uB958" }, ...packages];
  return /* @__PURE__ */ React.createElement("div", { className: "ptm-bd", role: "dialog", "aria-modal": true, onClick: onCancel }, /* @__PURE__ */ React.createElement("div", { className: "ptm", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "ptm-h" }, /* @__PURE__ */ React.createElement("div", { className: "ptm-t" }, "\uAE30\uBCF8\uAC12 \uC124\uC815"), /* @__PURE__ */ React.createElement("div", { className: "ptm-s" }, /* @__PURE__ */ React.createElement("b", null, def.displayName), " \u2014 \uC55E\uC73C\uB85C \uCD94\uAC00\uB418\uB294 \uC9C0\uAC11\uC5D0 \uC5B4\uB5BB\uAC8C \uC801\uC6A9\uD560\uAE4C\uC694?")), /* @__PURE__ */ React.createElement("div", { className: "ptm-opts" }, /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: enabled, onChange: (e) => setEnabled(e.target.checked) }), "\uC0C8 \uC9C0\uAC11\uC5D0 \uAE30\uBCF8\uC73C\uB85C \uC801\uC6A9"), /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, "\uC18C\uC18D \uD328\uD0A4\uC9C0", /* @__PURE__ */ React.createElement("select", { value: packageId, onChange: (e) => setPackageId(e.target.value) }, pkgList.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, p.displayName)))), /* @__PURE__ */ React.createElement("div", { className: "ptm-row" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-sec", onClick: onCancel }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-pri", onClick: () => onSave(enabled, packageId === UNCAT ? void 0 : packageId) }, "\uC800\uC7A5")))));
}
Object.assign(window, { NewPolicyChooser, LibraryDirectory, DefDefaultsModal, dashboardId, seedCedar });
