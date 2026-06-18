function EditorListPageV2() {
  const snap = useOverview();
  const [chooserOpen, setChooserOpen] = React.useState(false);
  const defCount = Object.values(snap.library.defs).filter((d) => !d.hidden).length;
  const pkgCount = Object.keys(snap.library.packages).length;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Topbar, { here: "Policy Editor", subtitle: `\uC815\uCC45 ${defCount}\uAC1C \xB7 \uD328\uD0A4\uC9C0 ${pkgCount}\uAC1C` }), /* @__PURE__ */ React.createElement("div", { className: "ev2-body" }, /* @__PURE__ */ React.createElement(Editor2View, { onNewPolicy: () => setChooserOpen(true) })), /* @__PURE__ */ React.createElement(ToastStack, null), /* @__PURE__ */ React.createElement(NewPolicyChooser, { open: chooserOpen, onClose: () => setChooserOpen(false) }));
}
function LibraryTab({ snap }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const [query, setQuery] = React.useState("");
  const [catFilter, setCatFilter] = React.useState("all");
  const [defaultsFor, setDefaultsFor] = React.useState(null);
  const [publishSrc, setPublishSrc] = React.useState(null);
  const presentCats = React.useMemo(() => {
    const set = /* @__PURE__ */ new Set();
    for (const d of Object.values(snap.library.defs)) if (!d.hidden) set.add(catKey(d.cat));
    return CAT_ORDER.filter((c) => set.has(c));
  }, [snap]);
  const onDelete = (d) => {
    const n = defUsageCount(snap, d.id);
    const msg = n > 0 ? `\uC815\uCC45 "${d.displayName}"\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?
${n}\uAC1C \uC9C0\uAC11\uC5D0\uC11C \uD568\uAED8 \uC81C\uAC70\uB429\uB2C8\uB2E4. \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC5B4\uC694.` : `\uC815\uCC45 "${d.displayName}"\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?
\uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC5B4\uC694.`;
    if (!window.confirm(msg)) return;
    run("\uC0AD\uC81C", () => PS.deleteDef(d.id)).then((ok) => ok && pushToast("\uC815\uCC45\uC744 \uC0AD\uC81C\uD588\uC5B4\uC694"));
  };
  const createPackage = () => run("\uD328\uD0A4\uC9C0 \uC0DD\uC131", () => PS.putPackage({ id: `pkg::${crypto.randomUUID()}`, displayName: "\uC0C8 \uD328\uD0A4\uC9C0", source: "mine", updatedAtMs: Date.now() })).then(
    (ok) => ok && pushToast("\uD328\uD0A4\uC9C0\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694 \u2014 \uC774\uB984\uC744 \uBC14\uAFD4\uBCF4\uC138\uC694")
  );
  const renamePackage = (pkg, name) => {
    const t = name.trim();
    if (!t || t === pkg.displayName) return;
    run("\uC774\uB984 \uBCC0\uACBD", () => PS.putPackage({ ...pkg, displayName: t, updatedAtMs: Date.now() }));
  };
  const removePackage = (pkg) => {
    if (!window.confirm(`\uD328\uD0A4\uC9C0 "${pkg.displayName}"\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?
\uC548\uC758 \uC815\uCC45\uC740 '\uAC1C\uBCC4'\uB85C \uC774\uB3D9\uD574\uC694.`)) return;
    run("\uD328\uD0A4\uC9C0 \uC0AD\uC81C", () => PS.deletePackage(pkg.id)).then((ok) => ok && pushToast("\uD328\uD0A4\uC9C0\uB97C \uC0AD\uC81C\uD588\uC5B4\uC694"));
  };
  const moveDef = (defId, packageId) => {
    const d = snap.library.defs[defId];
    if (!d) return;
    const next = packageId === UNCAT ? void 0 : packageId;
    if ((d.defaults.packageId || void 0) === next) return;
    run("\uD3F4\uB354 \uC774\uB3D9", () => PS.putDef({ ...d, defaults: { ...d.defaults, packageId: next }, updatedAtMs: Date.now() })).then(
      (ok) => ok && pushToast(`${d.displayName} \u2192 ${snap.library.packages[packageId]?.displayName ?? "\uAC1C\uBCC4"}`)
    );
  };
  const publishPackage = (pkg) => {
    const members = Object.values(snap.library.defs).filter((d) => !d.hidden && d.defaults.packageId === pkg.id);
    if (members.length === 0) return pushToast("\uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E0 \uC815\uCC45\uC774 \uC5C6\uC5B4\uC694");
    setPublishSrc({
      kind: "package",
      suggestedDisplayName: pkg.displayName,
      suggestedSlug: pkg.id.replace(/^pkg::/, ""),
      members: members.map((d) => ({
        slug: d.id.replace(/^def::/, ""),
        title: d.displayName,
        cedarText: Cedar.serializeCedar(d.skeleton.model, d.id.replace(/^def::/, ""), Cedar.severityFromCedar('@severity("' + d.skeleton.model.severity + '")')),
        manifest: d.skeleton.manifest
      }))
    });
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ld-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-ctrl" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-search" }, /* @__PURE__ */ React.createElement(SearchIcon, null), /* @__PURE__ */ React.createElement("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\uC815\uCC45 \uC774\uB984 \uAC80\uC0C9\u2026" })), /* @__PURE__ */ React.createElement("span", { className: "ev2-spc" }), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-sec", onClick: createPackage }, /* @__PURE__ */ React.createElement(PlusIcon, null), " \uC0C8 \uD328\uD0A4\uC9C0")), presentCats.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "ev2-catbar" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: `ev2-catchip${catFilter === "all" ? " on" : ""}`, onClick: () => setCatFilter("all") }, "\uBAA8\uB4E0 \uCE74\uD14C\uACE0\uB9AC"), presentCats.map((c) => /* @__PURE__ */ React.createElement("button", { key: c, type: "button", className: `ev2-catchip${catFilter === c ? " on" : ""}`, onClick: () => setCatFilter(c) }, /* @__PURE__ */ React.createElement("span", { className: "dot", style: { background: catStyle(c).hex } }), catLabel(c)))), /* @__PURE__ */ React.createElement("div", { className: "ev2-scroll" }, Object.values(snap.library.defs).filter((d) => !d.hidden).length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "ev2-empty" }, /* @__PURE__ */ React.createElement("div", { className: "big" }, "\uC544\uC9C1 \uC815\uCC45 \uC815\uC758\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4"), /* @__PURE__ */ React.createElement("div", { className: "sm" }, "\uC0C1\uB2E8 \u201C+ \uC0C8 \uC815\uCC45\u201D \uBC84\uD2BC\uC73C\uB85C \uCCAB \uC815\uC758\uB97C \uB9CC\uB4E4\uC5B4 \uBCF4\uC138\uC694.")) : /* @__PURE__ */ React.createElement(
    LibraryDirectory,
    {
      snap,
      mode: "manage",
      query,
      catFilter,
      onOpenDef: (d) => navigate(`/editor/${encodeURIComponent(d.id)}`),
      onDuplicate: (d) => run("\uBCF5\uC81C", () => PS.duplicateDef(d.id)).then((ok) => ok && pushToast("\uC815\uC758\uB97C \uBCF5\uC81C\uD588\uC5B4\uC694")),
      onDelete,
      onDefaults: setDefaultsFor,
      onToggleDefault: (d, enabled) => run("\uAE30\uBCF8 \uC801\uC6A9 \uBCC0\uACBD", () => PS.putDef({ ...d, defaults: { ...d.defaults, enabled }, updatedAtMs: Date.now() })).then(
        (ok) => ok && pushToast(enabled ? `${d.displayName} \u2014 \uC0C8 \uC9C0\uAC11\uC5D0 \uAE30\uBCF8 \uC801\uC6A9\uB3FC\uC694` : `${d.displayName} \u2014 \uC0C8 \uC9C0\uAC11 \uAE30\uBCF8 \uC801\uC6A9\uC744 \uAED0\uC5B4\uC694`)
      ),
      onRenamePackage: renamePackage,
      onDeletePackage: removePackage,
      onPublishPackage: publishPackage,
      onMoveDef: moveDef
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "ev2-lefthint" }, "\uC815\uCC45\uC744 \uB04C\uC5B4\uB2E4 \uD328\uD0A4\uC9C0\uC5D0 \uB193\uC73C\uBA74 \uC18C\uC18D\uC774 \uBC14\uB00C\uC5B4\uC694 \u2014 \uC9C0\uAC11 \uC801\uC6A9\uC740 ", /* @__PURE__ */ React.createElement("b", null, "\uC9C0\uAC11\uBCC4 \uC815\uCC45"), " \uD0ED\uC5D0\uC11C.")), /* @__PURE__ */ React.createElement(PublishModal, { open: publishSrc !== null, source: publishSrc, onClose: () => setPublishSrc(null) }), defaultsFor && /* @__PURE__ */ React.createElement(
    DefDefaultsModal,
    {
      def: defaultsFor,
      packages: Object.values(snap.library.packages),
      onCancel: () => setDefaultsFor(null),
      onSave: (enabled, packageId) => {
        run("\uAE30\uBCF8\uAC12 \uC800\uC7A5", () => PS.putDef({ ...defaultsFor, defaults: { ...defaultsFor.defaults, enabled, packageId }, updatedAtMs: Date.now() })).then(
          (ok) => ok && pushToast("\uAE30\uBCF8\uAC12\uC744 \uC800\uC7A5\uD588\uC5B4\uC694")
        );
        setDefaultsFor(null);
      }
    }
  ));
}
Object.assign(window, { EditorListPageV2, LibraryTab });
