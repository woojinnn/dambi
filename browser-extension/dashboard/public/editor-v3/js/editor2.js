const E2_ICONS = {
  search: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "7" }), /* @__PURE__ */ React.createElement("path", { d: "m21 21-4.3-4.3" })),
  chev: /* @__PURE__ */ React.createElement("path", { d: "m6 9 6 6 6-6" }),
  grip: /* @__PURE__ */ React.createElement("g", { stroke: "none", fill: "currentColor" }, /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "6", r: "1.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "6", r: "1.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "12", r: "1.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "12", r: "1.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "18", r: "1.3" }), /* @__PURE__ */ React.createElement("circle", { cx: "15", cy: "18", r: "1.3" })),
  flip: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 12a9 9 0 1 1-2.6-6.4" }), /* @__PURE__ */ React.createElement("path", { d: "M21 3v5h-5" })),
  edit: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12 20h9" }), /* @__PURE__ */ React.createElement("path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" })),
  shield: /* @__PURE__ */ React.createElement("path", { d: "M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" }),
  trash: /* @__PURE__ */ React.createElement("path", { d: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7" }),
  plus: /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" }),
  x: /* @__PURE__ */ React.createElement("path", { d: "M6 6l12 12M18 6L6 18" }),
  folder: /* @__PURE__ */ React.createElement("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }),
  inbox: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M22 12h-6l-2 3h-4l-2-3H2" }), /* @__PURE__ */ React.createElement("path", { d: "M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z" })),
  back: /* @__PURE__ */ React.createElement("path", { d: "M19 12H5M12 19l-7-7 7-7" }),
  box: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" }), /* @__PURE__ */ React.createElement("path", { d: "m3.3 7 8.7 5 8.7-5M12 22V12" })),
  check: /* @__PURE__ */ React.createElement("path", { d: "M5 12l5 5L20 6" }),
  warn: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12 3l9.5 16.5h-19z" }), /* @__PURE__ */ React.createElement("path", { d: "M12 10v4M12 17.5v.5" })),
  block: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "9" }), /* @__PURE__ */ React.createElement("path", { d: "M5.6 5.6l12.8 12.8" })),
  info: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "9" }), /* @__PURE__ */ React.createElement("path", { d: "M12 11v5M12 8v.5" })),
  lock: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "5", y: "11", width: "14", height: "9", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M8 11V8a4 4 0 0 1 8 0v3" })),
  eye: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M2 12s3.6-6.8 10-6.8S22 12 22 12s-3.6 6.8-10 6.8S2 12 2 12z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "2.6" })),
  pin: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M9 3h6M10 3v5l-2.5 4h9L14 8V3M12 16v5" }))
};
function Ic({ id, cls }) {
  return /* @__PURE__ */ React.createElement("svg", { className: `ic ${cls || ""}`.trim(), viewBox: "0 0 24 24", "aria-hidden": "true" }, E2_ICONS[id]);
}
function e2BaseModel(def) {
  if (def.skeleton && def.skeleton.model) return def.skeleton.model;
  if (typeof Cedar !== "undefined" && Cedar.emptyFormModel) return Cedar.emptyFormModel(def.id);
  return { trigger: { kind: "any" }, when: [], unless: [], id: def.id, severity: "warn", reason: "" };
}
function e2CountLeaves(nodes) {
  let n = 0;
  for (const x of nodes || []) n += Cedar.isGroupNode(x) ? e2CountLeaves(x.conds) : 1;
  return n;
}
function e2NeedsValues(def) {
  const m = def && def.skeleton && def.skeleton.model;
  if (!m) return Cedar.missingRequiredHoleLabels(def).length > 0;
  return e2CountLeaves(m.when) + e2CountLeaves(m.unless) > 0;
}
function e2Override(base, edited, severity) {
  if (!base) return void 0;
  const finalModel = { ...edited || base, severity };
  const baseJson = JSON.stringify({ ...base, severity: base.severity });
  const editedJson = JSON.stringify({ ...finalModel, id: base.id });
  return editedJson !== baseJson ? { ...finalModel, id: base.id } : void 0;
}
let e2Drag = null;
function readWalletLabels() {
  try {
    return JSON.parse(localStorage.getItem("dambi_wallet_labels") || "{}");
  } catch (e) {
    return {};
  }
}
function Editor2View({ onNewPolicy }) {
  const snap = useOverview();
  const [labelRev, setLabelRev] = React.useState(0);
  React.useEffect(() => {
    const on = (e) => {
      if (!e || e.key === "dambi_wallet_labels") setLabelRev((r) => r + 1);
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const rows = React.useMemo(() => {
    const labels = readWalletLabels();
    return Object.keys(snap.wallets.byAddress).sort().map((address) => ({ address, label: labels[address.toLowerCase()] || void 0 }));
  }, [snap, labelRev]);
  const [addr, setAddr] = React.useState(null);
  const rowAddrs = React.useMemo(() => new Set(rows.map((r) => r.address)), [rows]);
  const activeAddr = (addr && rowAddrs.has(addr) ? addr : null) || rows[0]?.address || null;
  const [lensOrder, setLensOrder] = React.useState([]);
  const lensPkg = lensOrder[0] || null;
  const setLensPkg = (id) => setLensOrder((prev) => id == null ? prev : [id, ...prev.filter((x) => x !== id)]);
  const [pinnedPkgs, setPinnedPkgs] = React.useState(() => /* @__PURE__ */ new Set());
  const togglePin = (id) => setPinnedPkgs((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  React.useEffect(() => {
    setPinnedPkgs(/* @__PURE__ */ new Set());
  }, [activeAddr]);
  const [viewAll, setViewAll] = React.useState(false);
  React.useEffect(() => {
    setViewAll(false);
  }, [activeAddr]);
  React.useEffect(() => {
    setLensOrder([]);
  }, [activeAddr]);
  const [lensPublish, setLensPublish] = React.useState(null);
  const requestPublishPkg = (pkgId) => {
    const w = snap.wallets.byAddress[activeAddr] || { bindings: {}, packages: {} };
    const defs = [...new Map(
      Object.values(w.bindings).filter((b) => b.packageId === pkgId).map((b) => [b.defId, snap.library.defs[b.defId]])
    ).values()].filter(Boolean);
    if (defs.length === 0) {
      pushToast("\uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E0 \uC815\uCC45\uC774 \uC5C6\uC5B4\uC694");
      return;
    }
    const name = pkgId === PS.UNCATEGORIZED_PKG ? "\uAC1C\uBCC4" : w.packages?.[pkgId]?.displayName ?? pkgId;
    const plan = Cedar.publishMembersFromDefs(defs);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setLensPublish({ kind: "package", suggestedDisplayName: name, suggestedSlug: pkgId.replace(/^pkg::/, ""), members: plan.members });
  };
  const dropWal = snap.wallets.byAddress[activeAddr] || { bindings: {}, packages: {} };
  const dropWalName = (pid) => pid === PS.UNCATEGORIZED_PKG ? "\uAC1C\uBCC4" : dropWal.packages?.[pid]?.displayName ?? pid;
  const dropInPkg = (defId, pid) => Object.values(dropWal.bindings).some((b) => b.packageId === pid && b.defId === defId);
  const [dropApply, setDropApply] = React.useState(null);
  const onDropApply = (pkgId) => {
    const d = e2Drag;
    e2Drag = null;
    if (!d) return;
    if (typeof pkgId === "string" && pkgId.indexOf("pkg::builtin.") === 0) return pushToast("\uAE30\uBCF8 \uC548\uC804\uD329\uC740 \uC77D\uAE30 \uC804\uC6A9\uC774\uC5D0\uC694");
    if (d.kind === "folder") return setDropApply({ kind: "folder", pkgId, name: d.name, defs: d.defs });
    if (dropInPkg(d.def.id, pkgId)) return pushToast("\uC774\uBBF8 \uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E4\uC5B4 \uC788\uC5B4\uC694");
    setDropApply({ kind: "def", pkgId, def: d.def });
  };
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement("div", { className: "e2" }, /* @__PURE__ */ React.createElement("div", { className: "muted", style: { padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, color: "var(--ink)" } }, "\uB4F1\uB85D\uB41C \uC9C0\uAC11\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, "\uD655\uC7A5 popup\uC5D0\uC11C \uC9C0\uAC11\uC744 \uCD94\uAC00\uD558\uBA74 \uC5EC\uAE30\uC5D0\uC11C \uC815\uCC45\uC744 \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.")));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "e2" }, /* @__PURE__ */ React.createElement("div", { className: "wbar rise" }, /* @__PURE__ */ React.createElement(WalletRail, { rows, snap, activeAddr, onSelect: setAddr, lensPkg, onLens: setLensPkg, pinnedPkgs, onTogglePin: togglePin, viewAll, onViewAll: setViewAll, onPublishPkg: requestPublishPkg, onDropApply })), activeAddr && /* @__PURE__ */ React.createElement(E2Workspace, { key: activeAddr, snap, address: activeAddr, onNewPolicy, lensPkg, lensOrder, pinnedPkgs, viewAll, onLens: setLensPkg }), /* @__PURE__ */ React.createElement(PublishModal, { open: lensPublish !== null, source: lensPublish, onClose: () => setLensPublish(null) }), dropApply?.kind === "def" && /* @__PURE__ */ React.createElement(E2ApplyModal, { def: dropApply.def, pkgId: dropApply.pkgId, pkgName: dropWalName(dropApply.pkgId), address: activeAddr, onClose: () => setDropApply(null) }), dropApply?.kind === "folder" && /* @__PURE__ */ React.createElement(E2FolderApplyModal, { folderName: dropApply.name, pkgId: dropApply.pkgId, pkgName: dropWalName(dropApply.pkgId), address: activeAddr, defs: dropApply.defs, isInPackage: (defId) => dropInPkg(defId, dropApply.pkgId), onClose: () => setDropApply(null) }));
}
function WalletRail({ rows, snap, activeAddr, onSelect, lensPkg, onLens, pinnedPkgs, onTogglePin, viewAll, onViewAll, onPublishPkg, onDropApply }) {
  const ref = React.useRef(null);
  const lensOpen = lensPkg != null;
  const setViewAll = onViewAll;
  const [lensDrop, setLensDrop] = React.useState(false);
  const [backDrop, setBackDrop] = React.useState(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const card = el.querySelector(".wrail-card.on");
        if (!card) return;
        const cRect = card.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const delta = cRect.left - eRect.left - (el.clientWidth - cRect.width) / 2;
        if (Math.abs(delta) > 2) el.scrollBy({ left: delta, behavior: "smooth" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [activeAddr, viewAll]);
  const [flipped, setFlipped] = React.useState(false);
  React.useEffect(() => {
    setFlipped(false);
  }, [activeAddr]);
  const tap = (address) => {
    if (viewAll) {
      onSelect(address);
      setViewAll(false);
      return;
    }
    if (address === activeAddr) {
      const next = !flipped;
      setFlipped(next);
      if (!next) onLens(null);
    } else onSelect(address);
  };
  const statOf = (address) => {
    const w = snap.wallets.byAddress[address] || { bindings: {}, packages: {}, packageEnabled: {} };
    const active = Object.values(w.bindings).filter((b) => PS.isEffectiveOn(w, b)).length;
    const pkgs = Object.keys(w.packages || {}).length;
    return { active, pkgs };
  };
  const wallet = snap.wallets.byAddress[activeAddr] || { bindings: {}, packages: {}, packageEnabled: {} };
  const lensData = React.useMemo(() => {
    if (lensPkg == null) return null;
    const UNCAT = PS.UNCATEGORIZED_PKG;
    const name = lensPkg === UNCAT ? "\uAC1C\uBCC4" : wallet.packages?.[lensPkg]?.displayName ?? lensPkg;
    const desc = lensPkg === UNCAT ? "\uC5B4\uB5A4 \uD328\uD0A4\uC9C0\uC5D0\uB3C4 \uBB36\uC774\uC9C0 \uC54A\uACE0 \uAC1C\uBCC4\uB85C \uC801\uC6A9\uB41C \uC815\uCC45\uB4E4\uC774\uC5D0\uC694." : wallet.packages?.[lensPkg]?.desc ?? "";
    const members = Object.values(wallet.bindings).filter((b) => b.packageId === lensPkg).sort((a, b) => (snap.library.defs[a.defId]?.displayName ?? "").localeCompare(snap.library.defs[b.defId]?.displayName ?? "", "ko"));
    return { id: lensPkg, name, desc, members };
  }, [lensPkg, snap, wallet]);
  const backPkgs = React.useMemo(() => {
    const UNCAT = PS.UNCATEGORIZED_PKG;
    const countBy = {};
    for (const b of Object.values(wallet.bindings)) countBy[b.packageId] = (countBy[b.packageId] || 0) + 1;
    const list = Object.values(wallet.packages || {}).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")).map((p) => ({ id: p.id, name: p.displayName, count: countBy[p.id] || 0, enabled: wallet.packageEnabled?.[p.id] ?? true }));
    if (countBy[UNCAT]) list.push({ id: UNCAT, name: "\uAC1C\uBCC4", count: countBy[UNCAT], enabled: wallet.packageEnabled?.[UNCAT] ?? true });
    return list;
  }, [wallet]);
  const lensIsUncat = lensPkg === PS.UNCATEGORIZED_PKG;
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  React.useEffect(() => {
    setRenaming(false);
  }, [lensPkg]);
  const startRename = () => {
    setDraftName(lensData?.name ?? "");
    setRenaming(true);
  };
  const commitRename = () => {
    setRenaming(false);
    const t = draftName.trim();
    const pkg = wallet.packages?.[lensPkg];
    if (!pkg || !t || t === pkg.displayName) return;
    run("\uC774\uB984 \uBCC0\uACBD", () => PS.putWalletPackage({ address: activeAddr, pkg: { id: lensPkg, displayName: t, ...pkg.desc ? { desc: pkg.desc } : {} } }));
  };
  return /* @__PURE__ */ React.createElement("div", { className: "wrail-wrap" }, rows.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "wrail-top" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "wrail-all-sm", onClick: () => setViewAll((v) => !v), title: "\uBAA8\uB4E0 \uC9C0\uAC11 \uD55C \uBC88\uC5D0 \uBCF4\uAE30" }, viewAll ? "\uD55C \uC9C0\uAC11\uB9CC \uBCF4\uAE30" : `\uC804\uCCB4 ${rows.length}\uAC1C \uBCF4\uAE30`)), /* @__PURE__ */ React.createElement("div", { className: `wrail ${viewAll ? "allview" : "focused"}`, ref }, rows.map((r) => {
    const on = r.address === activeAddr;
    const av = (r.label?.[0] ?? r.address.slice(2, 3)).toUpperCase();
    const s = statOf(r.address);
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: r.address,
        type: "button",
        "data-address": r.address,
        "aria-pressed": on,
        title: on ? flipped ? "\uB2EB\uAE30" : "\uD55C \uBC88 \uB354 \uB204\uB974\uBA74 \uC774 \uC9C0\uAC11\uC758 \uD328\uD0A4\uC9C0 \uC694\uC57D" : "\uC774 \uC9C0\uAC11\uC73C\uB85C \uC804\uD658",
        className: `wrail-card${on ? " on" : ""}${on && flipped ? " flipped" : ""}`,
        onClick: () => tap(r.address)
      },
      /* @__PURE__ */ React.createElement("span", { className: "wrc-flip" }, /* @__PURE__ */ React.createElement("span", { className: "wrc-face wrc-front" }, /* @__PURE__ */ React.createElement("span", { className: "wrc-top" }, /* @__PURE__ */ React.createElement("span", { className: "wrc-av" }, av), /* @__PURE__ */ React.createElement("span", { className: "wrc-pill" }, /* @__PURE__ */ React.createElement("span", { className: "dot" }), "\uC9C0\uAC11")), /* @__PURE__ */ React.createElement("span", { className: "wrc-name" }, r.label ?? shortAddr(r.address)), /* @__PURE__ */ React.createElement("span", { className: "wrc-addr" }, r.address.slice(0, 8), " \xB7\xB7 ", r.address.slice(-4)), /* @__PURE__ */ React.createElement("span", { className: "wrc-foot" }, /* @__PURE__ */ React.createElement("span", { className: "wrc-lbl" }, "\uC801\uC6A9"), /* @__PURE__ */ React.createElement("span", { className: "wrc-val" }, /* @__PURE__ */ React.createElement("span", { className: "on" }, "\uD65C\uC131 ", s.active), " \xB7 \uD328\uD0A4\uC9C0 ", s.pkgs))), /* @__PURE__ */ React.createElement("span", { className: "wrc-face wrc-back" }, /* @__PURE__ */ React.createElement("span", { className: "wrc-back-head" }, /* @__PURE__ */ React.createElement(Ic, { id: "box", cls: "sm" }), "\uC774 \uC9C0\uAC11\uC758 \uD328\uD0A4\uC9C0 ", /* @__PURE__ */ React.createElement("b", null, backPkgs.length)), /* @__PURE__ */ React.createElement("span", { className: "wrc-back-list scroll" }, backPkgs.length === 0 ? /* @__PURE__ */ React.createElement("span", { className: "wrc-back-empty" }, "\uC544\uC9C1 \uD328\uD0A4\uC9C0\uAC00 \uC5C6\uC5B4\uC694") : [...backPkgs].sort((a, b) => (pinnedPkgs.has(b.id) ? 1 : 0) - (pinnedPkgs.has(a.id) ? 1 : 0)).map((p) => /* @__PURE__ */ React.createElement(
        "span",
        {
          role: "button",
          tabIndex: 0,
          className: `wrc-back-row${p.id === lensPkg ? " on" : ""}${backDrop === p.id ? " dropping" : ""}${pinnedPkgs.has(p.id) ? " pinned" : ""}`,
          key: p.id,
          title: "\uB204\uB974\uBA74 \uC544\uB798 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uAC15\uC870 \xB7 \uC815\uCC45\xB7\uD3F4\uB354\uB97C \uB04C\uC5B4\uB2E4 \uB193\uC73C\uBA74 \uC774 \uD328\uD0A4\uC9C0\uC5D0 \uCD94\uAC00",
          onClick: (e) => {
            e.stopPropagation();
            onLens(p.id);
          },
          onDragOver: (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBackDrop(p.id);
          },
          onDragLeave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setBackDrop((v) => v === p.id ? null : v);
          },
          onDrop: (e) => {
            e.preventDefault();
            e.stopPropagation();
            setBackDrop(null);
            onDropApply(p.id);
          }
        },
        /* @__PURE__ */ React.createElement("span", { className: "nm" }, p.name),
        /* @__PURE__ */ React.createElement("span", { role: "button", tabIndex: 0, className: `wrc-back-pin${pinnedPkgs.has(p.id) ? " on" : ""}`, title: pinnedPkgs.has(p.id) ? "\uACE0\uC815 \uD574\uC81C" : "\uC544\uB798 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uC0C1\uB2E8 \uACE0\uC815", onClick: (e) => {
          e.stopPropagation();
          onTogglePin(p.id);
        } }, /* @__PURE__ */ React.createElement(Ic, { id: "pin", cls: "sm" })),
        /* @__PURE__ */ React.createElement("label", { className: "sw sm wrc-back-sw", title: p.enabled ? "\uC774 \uC9C0\uAC11\uC5D0\uC11C \uB044\uAE30" : "\uC774 \uC9C0\uAC11\uC5D0\uC11C \uCF1C\uAE30", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: p.enabled, onChange: () => run("\uD328\uD0A4\uC9C0 \uCF1C\uAE30/\uB044\uAE30", () => PS.setPackageEnabled({ address: activeAddr, packageId: p.id, enabled: !p.enabled })) }), /* @__PURE__ */ React.createElement("span", { className: "trk" }))
      )))))
    );
  }), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `wlens-scope${lensDrop ? " dropping" : ""}`,
      "aria-hidden": !lensOpen,
      onDragOver: (e) => {
        if (lensData) {
          e.preventDefault();
          setLensDrop(true);
        }
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setLensDrop(false);
      },
      onDrop: (e) => {
        e.preventDefault();
        setLensDrop(false);
        if (lensData) onDropApply(lensData.id);
      }
    },
    /* @__PURE__ */ React.createElement("div", { className: "wlens-inner" }, lensData && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "wlens-head" }, /* @__PURE__ */ React.createElement("span", { className: "wlens-scope-ic" }, /* @__PURE__ */ React.createElement(Ic, { id: "box", cls: "sm" })), renaming && !lensIsUncat ? /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "wlens-rename",
        autoFocus: true,
        value: draftName,
        onChange: (e) => setDraftName(e.target.value),
        onBlur: commitRename,
        onKeyDown: (e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") {
            setDraftName(lensData.name);
            setRenaming(false);
          }
        }
      }
    ) : /* @__PURE__ */ React.createElement("span", { className: "t", title: lensData.name }, lensData.name), !lensIsUncat && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs", title: "\uD328\uD0A4\uC9C0 \uC774\uB984 \uBCC0\uACBD", onClick: startRename }, /* @__PURE__ */ React.createElement(Ic, { id: "edit", cls: "sm" })), lensData.members.length > 0 && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs", title: "\uB9C8\uCF13\uD50C\uB808\uC774\uC2A4(Policy Hub)\uC5D0 \uC62C\uB9AC\uAE30", onClick: () => onPublishPkg(lensData.id) }, /* @__PURE__ */ React.createElement(Ic, { id: "shield", cls: "sm" }))), /* @__PURE__ */ React.createElement("span", { className: "s" }, "\uC815\uCC45 ", lensData.members.length), /* @__PURE__ */ React.createElement("button", { type: "button", className: "wlens-x", title: "\uB2EB\uAE30", onClick: () => onLens(null) }, /* @__PURE__ */ React.createElement(Ic, { id: "x", cls: "sm" }))), lensData.desc && /* @__PURE__ */ React.createElement("div", { className: "wlens-desc" }, lensData.desc), /* @__PURE__ */ React.createElement("div", { className: "wlens-pols scroll" }, lensData.members.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "sgempty", style: { gridColumn: "1 / -1", margin: "auto" } }, "\uC774 \uD328\uD0A4\uC9C0\uC5D0 \uC815\uCC45\uC774 \uC5C6\uC5B4\uC694") : lensData.members.map((b) => {
      const d = snap.library.defs[b.defId];
      const nm = b.alias ?? d?.displayName ?? b.defId;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: b.id,
          className: `wlens-pol${b.enabled ? "" : " off"}`,
          draggable: !!d,
          onDragStart: () => {
            if (d) e2Drag = { kind: "def", def: d };
          }
        },
        /* @__PURE__ */ React.createElement("span", { className: "dot", style: { background: catStyle(catKey(d?.cat)).hex } }),
        /* @__PURE__ */ React.createElement(
          "span",
          {
            className: "nm",
            title: "\uC774 \uC9C0\uAC11 \uC778\uC2A4\uD134\uC2A4 \uD3B8\uC9D1 \u2014 \uAC12\uC744 \uBC14\uAFB8\uBA74 \uC774 \uC9C0\uAC11\uC5D0\uB9CC \uC801\uC6A9\uB3FC\uC694",
            style: { cursor: "pointer" },
            onClick: () => navigate(`/editor/${encodeURIComponent(b.defId)}?wallet=${activeAddr}&binding=${encodeURIComponent(b.id)}`)
          },
          nm
        ),
        /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: `ox${b.enabled ? " on" : ""}`,
            title: b.enabled ? "\uC774 \uC815\uCC45 \uB044\uAE30 (\uC81C\uC678)" : "\uC774 \uC815\uCC45 \uCF1C\uAE30 (\uD3EC\uD568)",
            "aria-label": b.enabled ? "\uC815\uCC45 \uB044\uAE30" : "\uC815\uCC45 \uCF1C\uAE30",
            onClick: () => run("\uD1A0\uAE00", () => PS.updateBinding({ address: activeAddr, bindingId: b.id, patch: { enabled: !b.enabled } }))
          },
          /* @__PURE__ */ React.createElement(Ic, { id: b.enabled ? "check" : "x" })
        ),
        /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib danger", title: "\uC774 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uC81C\uAC70", onClick: async () => {
          if (await e2Confirm({ title: `"${nm}" \uC815\uCC45\uC744 \uC774 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uBE84\uAE4C\uC694?`, body: "\uC774 \uC9C0\uAC11\uC5D0\uC11C \uB354\uB294 \uC801\uC6A9\uB418\uC9C0 \uC54A\uC544\uC694. (\uC815\uCC45 \uC790\uCCB4\uB294 \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0 \uB0A8\uC544\uC694)", danger: true, confirmLabel: "\uC81C\uAC70" })) run("\uC81C\uAC70", () => PS.removeBinding({ address: activeAddr, bindingId: b.id }));
        } }, /* @__PURE__ */ React.createElement(Ic, { id: "trash", cls: "sm" }))
      );
    }))))
  )));
}
function WalletStats({ wallet }) {
  const active = Object.values(wallet.bindings).filter((b) => PS.isEffectiveOn(wallet, b)).length;
  const pkgs = Object.keys(wallet.packages || {}).length;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "wstat" }, /* @__PURE__ */ React.createElement("span", { className: "dot", style: { background: "var(--sage)" } }), "\uD65C\uC131 ", active), /* @__PURE__ */ React.createElement("span", { className: "wsep" }), /* @__PURE__ */ React.createElement("span", { className: "wstat", style: { color: "var(--mut)" } }, "\uD328\uD0A4\uC9C0 ", pkgs));
}
function E2Workspace({ snap, address, onNewPolicy, lensPkg, lensOrder, pinnedPkgs, viewAll, onLens }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const wallet = snap.wallets.byAddress[address] || { bindings: {}, packages: {}, packageEnabled: {} };
  const walletPkgName = (pid) => pid === UNCAT ? "\uAC1C\uBCC4" : wallet.packages?.[pid]?.displayName ?? pid;
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(/* @__PURE__ */ new Set());
  const searching = query.trim() !== "";
  const dragRef = React.useRef(null);
  const [previewId, setPreviewId] = React.useState(null);
  const previewBinding = previewId ? wallet.bindings?.[previewId] : null;
  React.useEffect(() => {
    if (previewId && !wallet.bindings?.[previewId]) setPreviewId(null);
  }, [wallet, previewId]);
  const defsByFolder = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const d of Object.values(snap.library.defs)) {
      if (d.hidden) continue;
      const raw = d.defaults.packageId;
      const key = raw && snap.library.packages[raw] ? raw : UNCAT;
      const arr = m.get(key) || [];
      arr.push(d);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
    return m;
  }, [snap]);
  const folders = React.useMemo(() => {
    const seen = /* @__PURE__ */ new Set();
    const list = Object.values(snap.library.packages).filter((p) => p.id !== UNCAT && !seen.has(p.id) && seen.add(p.id)).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko") || a.id.localeCompare(b.id)).map((p) => ({ id: p.id, displayName: p.displayName }));
    list.push({ id: UNCAT, displayName: "\uAC1C\uBCC4 \uD15C\uD50C\uB9BF", locked: true });
    return list;
  }, [snap, defsByFolder]);
  const matchQuery = (d) => !searching || d.displayName.toLowerCase().includes(query.trim().toLowerCase());
  const toggleFolder = (id) => setExpanded((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const membersByPkg = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const b of Object.values(wallet.bindings)) {
      const arr = m.get(b.packageId) || [];
      arr.push(b);
      m.set(b.packageId, arr);
    }
    return m;
  }, [wallet]);
  const pkgCountByDef = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const b of Object.values(wallet.bindings)) {
      const s = m.get(b.defId) || /* @__PURE__ */ new Set();
      s.add(b.packageId);
      m.set(b.defId, s);
    }
    return m;
  }, [wallet]);
  const packages = React.useMemo(() => {
    const list = [
      // 개별(미분류) 카드는 비어 있어도 항상 표시 — 고정 드롭 영역.
      { id: UNCAT, displayName: "\uAC1C\uBCC4" },
      ...Object.values(wallet.packages || {}).slice().sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")).map((p) => ({ id: p.id, displayName: p.displayName, desc: p.desc }))
    ];
    const pins = pinnedPkgs || /* @__PURE__ */ new Set();
    const order = lensOrder || (lensPkg ? [lensPkg] : []);
    list.sort((a, b) => {
      const pa = pins.has(a.id) ? 0 : 1, pb = pins.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return list;
  }, [wallet, lensPkg, lensOrder, pinnedPkgs]);
  const gridRef = React.useRef(null);
  const prevRects = React.useRef(/* @__PURE__ */ new Map());
  React.useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = grid.querySelectorAll(".prow[data-pkgid]");
    cards.forEach((row) => {
      const id = row.getAttribute("data-pkgid");
      const prev = prevRects.current.get(id);
      const rect = row.getBoundingClientRect();
      if (prev) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if ((dx || dy) && typeof row.animate === "function") {
          row.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
            { duration: 460, easing: "cubic-bezier(.22,.9,.28,1)" }
          );
        }
      }
    });
    const m = /* @__PURE__ */ new Map();
    cards.forEach((row) => m.set(row.getAttribute("data-pkgid"), row.getBoundingClientRect()));
    prevRects.current = m;
  }, [packages]);
  const togglePackage = (pkgId, members, displayedOn) => run("\uD328\uD0A4\uC9C0 \uD1A0\uAE00", async () => {
    if (displayedOn) return PS.setPackageEnabled({ address, packageId: pkgId, enabled: false });
    await PS.setPackageEnabled({ address, packageId: pkgId, enabled: true });
    if (members.length > 0 && !members.some((b) => b.enabled)) {
      for (const b of members) await PS.updateBinding({ address, bindingId: b.id, patch: { enabled: true } });
    }
  });
  const createPackage = () => run("\uD328\uD0A4\uC9C0 \uC0DD\uC131", () => PS.putWalletPackage({ address, pkg: { id: `pkg::${crypto.randomUUID()}`, displayName: "\uC0C8 \uD328\uD0A4\uC9C0" } })).then((ok) => ok && pushToast("\uD328\uD0A4\uC9C0\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694 \u2014 \uC774\uB984\uC744 \uBC14\uAFD4\uBCF4\uC138\uC694"));
  const renamePackage = (pkgId, name) => {
    const pkg = wallet.packages?.[pkgId];
    const trimmed = name.trim();
    if (!pkg || !trimmed || trimmed === pkg.displayName) return;
    run("\uC774\uB984 \uBCC0\uACBD", () => PS.putWalletPackage({ address, pkg: { id: pkgId, displayName: trimmed, ...pkg.desc ? { desc: pkg.desc } : {} } }));
  };
  const savePackageDesc = (pkgId, desc) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const d = desc.trim();
    if ((pkg.desc ?? "") === d) return;
    run("\uC124\uBA85 \uC800\uC7A5", () => PS.putWalletPackage({ address, pkg: { id: pkgId, displayName: pkg.displayName, ...d ? { desc: d } : {} } }));
  };
  const removePackage = (pkgId) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const n = Object.values(wallet.bindings).filter((b) => b.packageId === pkgId).length;
    setConfirmAsk({
      title: `"${pkg.displayName}" \uD328\uD0A4\uC9C0\uB97C \uC774 \uC9C0\uAC11\uC5D0\uC11C \uC81C\uAC70\uD560\uAE4C\uC694?`,
      body: `\uC548\uC758 \uC815\uCC45 \uC778\uC2A4\uD134\uC2A4 ${n}\uAC1C\uB3C4 \uD568\uAED8 \uC81C\uAC70\uB3FC\uC694. (\uB77C\uC774\uBE0C\uB7EC\uB9AC\uC758 \uD3F4\uB354\xB7\uC815\uCC45\uC740 \uADF8\uB300\uB85C\uC608\uC694)`,
      danger: true,
      onConfirm: () => run("\uD328\uD0A4\uC9C0 \uC81C\uAC70", () => PS.removeWalletPackage({ address, packageId: pkgId })).then((ok) => ok && pushToast("\uC774 \uC9C0\uAC11\uC5D0\uC11C \uD328\uD0A4\uC9C0\uB97C \uC81C\uAC70\uD588\uC5B4\uC694"))
    });
  };
  const isInPackage = (defId, pkgId) => (membersByPkg.get(pkgId) || []).some((b) => b.defId === defId);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const createLibFolder = (name) => run("\uD3F4\uB354 \uC0DD\uC131", () => PS.putPackage({ id: `pkg::${crypto.randomUUID()}`, displayName: name.trim() || "\uC0C8 \uD3F4\uB354", source: "mine", updatedAtMs: Date.now() })).then((ok) => ok && pushToast("\uD3F4\uB354\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694 \u2014 \uC774\uB984\uC744 \uBC14\uAFD4\uBCF4\uC138\uC694"));
  const [folderDrop, setFolderDrop] = React.useState(null);
  const moveDefToLibFolder = (defId, folderId) => {
    const d = snap.library.defs[defId];
    if (!d) return;
    if (snap.library.packages[folderId]?.source === "builtin") return pushToast("\uAE30\uBCF8 \uC548\uC804\uD329\uC740 \uC77D\uAE30 \uC804\uC6A9\uC774\uC5D0\uC694");
    const next = folderId === UNCAT ? void 0 : folderId;
    if ((d.defaults.packageId ?? void 0) === next) return;
    const folderName = folderId === UNCAT ? "\uAC1C\uBCC4" : snap.library.packages[folderId]?.displayName ?? folderId;
    run("\uD3F4\uB354 \uC774\uB3D9", () => PS.putDef({ ...d, defaults: { ...d.defaults, packageId: next }, updatedAtMs: Date.now() })).then((ok) => ok && pushToast(`${d.displayName} \u2192 ${folderName}`));
  };
  const renameLibFolder = (id) => {
    const pkg = snap.library.packages[id];
    if (!pkg) return;
    const name = window.prompt("\uC774\uB984 \uBCC0\uACBD", pkg.displayName);
    const t = name && name.trim();
    if (!t || t === pkg.displayName) return;
    run("\uC774\uB984 \uBCC0\uACBD", () => PS.putPackage({ ...pkg, displayName: t, updatedAtMs: Date.now() }));
  };
  const deleteLibFolder = (id) => {
    const pkg = snap.library.packages[id];
    if (!pkg) return;
    setConfirmAsk({ title: `\uD3F4\uB354 "${pkg.displayName}"\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?`, body: "\uC548\uC758 \uC815\uCC45\uC740 '\uAC1C\uBCC4'\uB85C \uC774\uB3D9\uD574\uC694.", danger: true, onConfirm: () => run("\uD3F4\uB354 \uC0AD\uC81C", () => PS.deletePackage(id)).then((ok) => ok && pushToast("\uD3F4\uB354\uB97C \uC0AD\uC81C\uD588\uC5B4\uC694")) });
  };
  const onDeleteDef = (d) => {
    const uses = Object.values(snap.wallets.byAddress).reduce((n, w) => n + Object.values(w.bindings).filter((b) => b.defId === d.id).length, 0);
    setConfirmAsk({ title: `\uC815\uCC45 "${d.displayName}"\uC744(\uB97C) \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0\uC11C \uC0AD\uC81C\uD560\uAE4C\uC694?`, body: uses > 0 ? `${uses}\uAC1C \uC9C0\uAC11\uC5D0\uC11C \uD568\uAED8 \uC81C\uAC70\uB429\uB2C8\uB2E4.` : "", danger: true, onConfirm: () => run("\uC815\uCC45 \uC0AD\uC81C", () => PS.deleteDef(d.id)).then((ok) => ok && pushToast("\uC815\uCC45\uC744 \uC0AD\uC81C\uD588\uC5B4\uC694")) });
  };
  const [publishSrc, setPublishSrc] = React.useState(null);
  const publishLibFolder = (id, name) => {
    const members = Object.values(snap.library.defs).filter((d) => !d.hidden && (d.defaults.packageId || UNCAT) === id);
    if (members.length === 0) return pushToast("\uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E0 \uC815\uCC45\uC774 \uC5C6\uC5B4\uC694");
    const plan = Cedar.publishMembersFromDefs(members);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setPublishSrc({ kind: "package", suggestedDisplayName: name, suggestedSlug: id.replace(/^pkg::/, ""), members: plan.members });
  };
  const publishDef = (d) => {
    const m = Cedar.publishMemberFromDef(d);
    if (!m) return Cedar.rejectUnsupportedPublish(d);
    setPublishSrc({ kind: "policy", cedarText: m.cedarText, manifest: m.manifest, suggestedDisplayName: d.displayName, suggestedSlug: m.slug });
  };
  const publishPackage = (pkgId, members) => {
    const defs = [...new Map(members.map((b) => [b.defId, snap.library.defs[b.defId]])).values()].filter(Boolean);
    if (defs.length === 0) return pushToast("\uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E0 \uC815\uCC45\uC774 \uC5C6\uC5B4\uC694");
    const plan = Cedar.publishMembersFromDefs(defs);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setPublishSrc({ kind: "package", suggestedDisplayName: walletPkgName(pkgId), suggestedSlug: pkgId.replace(/^pkg::/, ""), members: plan.members });
  };
  const [apply, setApply] = React.useState(null);
  const [folderApply, setFolderApply] = React.useState(null);
  const [confirmAsk, setConfirmAsk] = React.useState(null);
  const onCardDrop = (pkgId) => {
    const d = e2Drag;
    e2Drag = null;
    dragRef.current = null;
    if (!d) return;
    if (typeof pkgId === "string" && pkgId.indexOf("pkg::builtin.") === 0) return pushToast("\uAE30\uBCF8 \uC548\uC804\uD329\uC740 \uC77D\uAE30 \uC804\uC6A9\uC774\uC5D0\uC694");
    if (d.kind === "folder") return setFolderApply({ pkgId, name: d.name, defs: d.defs });
    if (isInPackage(d.def.id, pkgId)) return pushToast("\uC774\uBBF8 \uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E4\uC5B4 \uC788\uC5B4\uC694");
    setApply({ pkgId, def: d.def });
  };
  const forkBinding = (b) => {
    const def = snap.library.defs[b.defId];
    if (!def) return;
    navigate(`/editor/${encodeURIComponent(def.id)}?wallet=${address}&binding=${encodeURIComponent(b.id)}`);
  };
  return /* @__PURE__ */ React.createElement("div", { className: `cols${viewAll ? " allview-on" : ""}` }, /* @__PURE__ */ React.createElement("aside", { className: "skel rise" }, /* @__PURE__ */ React.createElement("div", { className: "skel-top" }, /* @__PURE__ */ React.createElement("div", { className: "skel-label" }, /* @__PURE__ */ React.createElement(Ic, { id: "box", cls: "sm" }), "\uB77C\uC774\uBE0C\uB7EC\uB9AC"), /* @__PURE__ */ React.createElement("div", { className: "skel-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "e2-mini", onClick: () => setNewFolderOpen(true) }, /* @__PURE__ */ React.createElement(Ic, { id: "folder", cls: "sm" }), "\uC0C8 \uD3F4\uB354"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "e2-mini", onClick: onNewPolicy }, /* @__PURE__ */ React.createElement(Ic, { id: "plus", cls: "sm" }), "\uC0C8 \uC815\uCC45")), /* @__PURE__ */ React.createElement("div", { className: "searchbox" }, /* @__PURE__ */ React.createElement(Ic, { id: "search", cls: "sm" }), /* @__PURE__ */ React.createElement("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\uC815\uCC45 \uAC80\uC0C9\u2026" }))), /* @__PURE__ */ React.createElement("div", { className: "skel-body scroll" }, Object.values(snap.library.defs).filter((d) => !d.hidden).length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "pb-empty", style: { padding: "26px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, color: "var(--ink)" } }, "\uC544\uC9C1 \uC815\uCC45 \uBF08\uB300\uAC00 \uC5C6\uC5B4\uC694"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, "\uC704 \u201C+ \uC0C8 \uC815\uCC45\u201D\uC73C\uB85C \uCCAB \uC815\uCC45\uC744 \uB9CC\uB4E4\uC5B4 \uBCF4\uC138\uC694.")) : folders.map((f) => {
    const all = defsByFolder.get(f.id) || [];
    const shown = all.filter(matchQuery);
    if (shown.length === 0 && searching) return null;
    const open = searching || expanded.has(f.id);
    return /* @__PURE__ */ React.createElement("div", { key: f.id, className: `sgroup${open ? "" : " collapsed"}${f.locked ? " uncat" : ""}${f.id && f.id.indexOf("pkg::builtin.") === 0 ? " builtin" : ""}` }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `sghead${folderDrop === f.id ? " droptarget" : ""}`,
        draggable: !f.locked,
        onClick: () => toggleFolder(f.id),
        onDragStart: () => {
          if (!f.locked) {
            dragRef.current = { kind: "folder", name: f.displayName, defs: all };
            e2Drag = dragRef.current;
          }
        },
        onDragOver: (e) => {
          if (dragRef.current?.kind === "def") {
            e.preventDefault();
            setFolderDrop(f.id);
          }
        },
        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFolderDrop((p) => p === f.id ? null : p);
        },
        onDrop: (e) => {
          e.preventDefault();
          setFolderDrop(null);
          const d = dragRef.current;
          dragRef.current = null;
          if (d?.kind === "def") moveDefToLibFolder(d.def.id, f.id);
        }
      },
      /* @__PURE__ */ React.createElement(Ic, { id: "chev", cls: "sm e2cv" }),
      /* @__PURE__ */ React.createElement(Ic, { id: f.locked ? "inbox" : "folder", cls: "sm" }),
      /* @__PURE__ */ React.createElement("span", { className: "nm" }, f.displayName),
      f.locked ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "cnt" }, all.length), /* @__PURE__ */ React.createElement("span", { className: "uncat-tag", title: "\uC544\uC9C1 \uC5B4\uB5A4 \uD3F4\uB354\uC5D0\uB3C4 \uB123\uC9C0 \uC54A\uC740 \uAC1C\uBCC4 \uC815\uCC45 \uBF08\uB300\uC608\uC694. \uD3F4\uB354\uB85C \uB04C\uC5B4\uB2E4 \uC815\uB9AC\uD560 \uC218 \uC788\uC5B4\uC694." }, "\uD3F4\uB354 \uC5C6\uC74C")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "cnt" }, all.length), /* @__PURE__ */ React.createElement("span", { className: "facts", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs", title: "\uAC8C\uC2DC", onClick: () => publishLibFolder(f.id, f.displayName) }, /* @__PURE__ */ React.createElement(Ic, { id: "shield", cls: "sm" })), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs", title: "\uC774\uB984 \uBCC0\uACBD", onClick: () => renameLibFolder(f.id) }, /* @__PURE__ */ React.createElement(Ic, { id: "edit", cls: "sm" })), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs danger", title: "\uC0AD\uC81C", onClick: () => deleteLibFolder(f.id) }, /* @__PURE__ */ React.createElement(Ic, { id: "trash", cls: "sm" }))))
    ), /* @__PURE__ */ React.createElement("div", { className: "sgbody" }, shown.map((d) => {
      const usedIn = pkgCountByDef.get(d.id)?.size ?? 0;
      return /* @__PURE__ */ React.createElement("div", { key: d.id, className: "sitem", draggable: true, onDragStart: () => {
        dragRef.current = { kind: "def", def: d };
        e2Drag = dragRef.current;
      } }, /* @__PURE__ */ React.createElement("span", { className: "nm", title: d.displayName }, d.displayName), /* @__PURE__ */ React.createElement("span", { className: "end" }, /* @__PURE__ */ React.createElement("span", { className: `pkgcnt${usedIn === 0 ? " zero" : ""}`, title: `\uC774 \uC9C0\uAC11\uC758 ${usedIn}\uAC1C \uD328\uD0A4\uC9C0\uC5D0 \uC801\uC6A9\uB428` }, /* @__PURE__ */ React.createElement(Ic, { id: "box", cls: "sm" }), usedIn), d.source !== "builtin" && /* @__PURE__ */ React.createElement("span", { className: "acts" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs", title: "\uC815\uCC45 \uBF08\uB300 \uC218\uC815 (\uB77C\uC774\uBE0C\uB7EC\uB9AC)", onClick: () => navigate(`/editor/${encodeURIComponent(d.id)}`) }, /* @__PURE__ */ React.createElement(Ic, { id: "edit", cls: "sm" })), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs", title: "Policy Hub\uC5D0 \uC62C\uB9AC\uAE30", onClick: () => publishDef(d) }, /* @__PURE__ */ React.createElement(Ic, { id: "shield", cls: "sm" })), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib xs danger", title: "\uC0AD\uC81C", onClick: () => onDeleteDef(d) }, /* @__PURE__ */ React.createElement(Ic, { id: "trash", cls: "sm" }))), /* @__PURE__ */ React.createElement(Ic, { id: "grip", cls: "sm grip" })));
    }), shown.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "sgempty" }, "\uBE44\uC5B4 \uC788\uC5B4\uC694 \u2014 \uC815\uCC45\uC744 \uB04C\uC5B4\uB2E4 \uC774 \uD3F4\uB354\uB85C \uB123\uC73C\uC138\uC694.")));
  })), /* @__PURE__ */ React.createElement("div", { className: "skel-foot" }, /* @__PURE__ */ React.createElement(Ic, { id: "grip", cls: "sm" }), "\uC815\uCC45\xB7\uD3F4\uB354\uB97C \uD328\uD0A4\uC9C0 \uCE74\uB4DC\uB098 \uC704 \uB9D0\uD48D\uC120\uC5D0 \uB04C\uC5B4 \uC801\uC6A9 (\uD3F4\uB354\uB294 \uD1B5\uC9F8\uB85C)")), /* @__PURE__ */ React.createElement("section", null, /* @__PURE__ */ React.createElement("div", { className: "pkhead" }, /* @__PURE__ */ React.createElement("span", { className: "t" }, "\uC774 \uC9C0\uAC11\uC758 \uD328\uD0A4\uC9C0"), /* @__PURE__ */ React.createElement("span", { className: "s" }, "\uCE74\uB4DC\uB97C \uB204\uB974\uBA74 \uC704 \uB9DD\uC6D0\uACBD\uC5D0\uC11C \uD655\uB300\uD574 \uC815\uCC45\uC744 \uBD10\uC694 \xB7 \u201C\uAD00\uB9AC\u201D\uB85C \uD3B8\uC9D1")), packages.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "pb-empty", style: { padding: "40px 16px", maxWidth: 520 } }, "\uC774 \uC9C0\uAC11\uC5D0 \uD328\uD0A4\uC9C0\uAC00 \uC5C6\uC5B4\uC694 \u2014 \u201C\uC0C8 \uD328\uD0A4\uC9C0\u201D\uB85C \uB9CC\uB4E4\uACE0 \uC67C\uCABD \uBF08\uB300\uB97C \uB04C\uC5B4\uB2E4 \uCC44\uC6CC\uBCF4\uC138\uC694.") : /* @__PURE__ */ React.createElement("div", { className: "pgrid stagger", ref: gridRef }, packages.map((pkg) => /* @__PURE__ */ React.createElement(
    E2PackageCard,
    {
      key: pkg.id,
      pkg,
      highlighted: pkg.id === lensPkg,
      pinned: pinnedPkgs?.has(pkg.id),
      wallet,
      snap,
      members: membersByPkg.get(pkg.id) || [],
      address,
      onToggle: togglePackage,
      onRename: renamePackage,
      onSaveDesc: savePackageDesc,
      onRemove: removePackage,
      onPublish: publishPackage,
      onDrop: onCardDrop,
      previewId,
      onPreviewBinding: (bindId) => setPreviewId((cur) => cur === bindId ? null : bindId),
      onForkBinding: forkBinding,
      onOpenBinding: (defId, bindId) => navigate(`/editor/${encodeURIComponent(defId)}?wallet=${address}&binding=${encodeURIComponent(bindId)}`)
    }
  )), /* @__PURE__ */ React.createElement("button", { type: "button", className: "addpkg", onClick: createPackage }, /* @__PURE__ */ React.createElement("span", { className: "pl" }, /* @__PURE__ */ React.createElement(Ic, { id: "plus", cls: "lg" })), /* @__PURE__ */ React.createElement("span", { className: "t" }, "\uC0C8 \uD328\uD0A4\uC9C0")))), apply && /* @__PURE__ */ React.createElement(
    E2ApplyModal,
    {
      def: apply.def,
      pkgId: apply.pkgId,
      pkgName: walletPkgName(apply.pkgId),
      address,
      onClose: () => setApply(null)
    }
  ), folderApply && /* @__PURE__ */ React.createElement(
    E2FolderApplyModal,
    {
      folderName: folderApply.name,
      pkgId: folderApply.pkgId,
      pkgName: walletPkgName(folderApply.pkgId),
      address,
      defs: folderApply.defs,
      isInPackage: (defId) => isInPackage(defId, folderApply.pkgId),
      onClose: () => setFolderApply(null)
    }
  ), /* @__PURE__ */ React.createElement(PublishModal, { open: publishSrc !== null, source: publishSrc, onClose: () => setPublishSrc(null) }), newFolderOpen && /* @__PURE__ */ React.createElement(E2NewFolderModal, { onClose: () => setNewFolderOpen(false), onCreate: (name) => {
    createLibFolder(name);
    setNewFolderOpen(false);
  } }), confirmAsk && /* @__PURE__ */ React.createElement(E2ConfirmModal, { ...confirmAsk, onCancel: () => setConfirmAsk(null) }));
}
function E2ConfirmModal({ title, body, danger, confirmLabel, onConfirm, onCancel }) {
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") {
        onCancel();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);
  return /* @__PURE__ */ React.createElement("div", { className: "e2-ov", onMouseDown: onCancel }, /* @__PURE__ */ React.createElement("div", { className: "modal e2cf", onMouseDown: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "e2cf-body" }, /* @__PURE__ */ React.createElement("div", { className: "e2cf-title" }, title), body && /* @__PURE__ */ React.createElement("div", { className: "e2cf-text" }, body)), /* @__PURE__ */ React.createElement("div", { className: "e2cf-foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "e2cf-btn cancel", onClick: onCancel }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: `e2cf-btn ok${danger ? " danger" : ""}`, autoFocus: true, onClick: () => {
    onCancel();
    onConfirm();
  } }, confirmLabel || "\uD655\uC778"))));
}
function E2NewFolderModal({ onClose, onCreate }) {
  const [name, setName] = React.useState("");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const submit = () => {
    if (name.trim()) onCreate(name);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "e2 e2-ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: { width: 420 } }, /* @__PURE__ */ React.createElement("div", { className: "m-head" }, /* @__PURE__ */ React.createElement("span", { className: "m-ic folder" }, /* @__PURE__ */ React.createElement(Ic, { id: "folder", cls: "lg" })), /* @__PURE__ */ React.createElement("div", { className: "m-title-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "m-h-title" }, "\uC0C8 \uD3F4\uB354 \uB9CC\uB4E4\uAE30"), /* @__PURE__ */ React.createElement("div", { className: "m-title-hint" }, "\uC815\uCC45 \uBF08\uB300\uB97C \uC815\uB9AC\uD560 \uD3F4\uB354 \uC774\uB984\uC744 \uC815\uD558\uC138\uC694.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", style: { marginLeft: "auto" }, onClick: onClose }, /* @__PURE__ */ React.createElement(Ic, { id: "x", cls: "sm" }))), /* @__PURE__ */ React.createElement("div", { className: "m-body", style: { paddingTop: 4 } }, /* @__PURE__ */ React.createElement("input", { ref: inputRef, className: "m-title", style: { width: "100%", margin: 0 }, value: name, placeholder: "\uC608: \uBE0C\uB9BF\uC9C0 \uAC00\uB4DC", onChange: (e) => setName(e.target.value), onKeyDown: (e) => e.key === "Enter" && submit() })), /* @__PURE__ */ React.createElement("div", { className: "m-foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "lk", onClick: onClose }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn sage", disabled: !name.trim(), onClick: submit }, "\uB9CC\uB4E4\uAE30"))));
}
function E2PackageCard({ pkg, wallet, snap, members, address, highlighted, pinned, onToggle, onRename, onSaveDesc, onRemove, onPublish, onDrop, previewId, onPreviewBinding, onForkBinding, onOpenBinding }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const rowRef = React.useRef(null);
  const [drop, setDrop] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState(pkg.displayName);
  const [draftDesc, setDraftDesc] = React.useState(pkg.desc ?? "");
  React.useEffect(() => setDraftDesc(pkg.desc ?? ""), [pkg.desc]);
  const locked = pkg.id === UNCAT;
  const isDefaultPack = typeof pkg.id === "string" && pkg.id.indexOf("pkg::builtin.") === 0;
  const empty = members.length === 0;
  const activeN = members.filter((b) => PS.isEffectiveOn(wallet, b)).length;
  const displayedOn = packageDisplayOn(wallet.packageEnabled[pkg.id] ?? true, members.filter((b) => b.enabled).length);
  const defOf = (b) => snap.library.defs[b.defId];
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      ref: rowRef,
      "data-pkgid": pkg.id,
      className: `prow${drop ? " drop" : ""}${locked ? " uncat" : ""}${isDefaultPack ? " builtin" : ""}${highlighted ? " lensed" : ""}${pinned ? " pinned" : ""}`,
      onDragOver: (e) => {
        e.preventDefault();
        setDrop(true);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDrop(false);
      },
      onDrop: (e) => {
        e.preventDefault();
        setDrop(false);
        onDrop(pkg.id);
      }
    },
    /* @__PURE__ */ React.createElement("div", { className: "prow-head" }, /* @__PURE__ */ React.createElement("span", { className: `pf-ic${empty && !locked ? " empty" : ""}` }, /* @__PURE__ */ React.createElement(Ic, { id: locked ? "inbox" : "box" })), renaming && !locked ? /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "prow-rename",
        autoFocus: true,
        value: draftName,
        onChange: (e) => setDraftName(e.target.value),
        onBlur: () => {
          setRenaming(false);
          onRename(pkg.id, draftName);
        },
        onKeyDown: (e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") {
            setDraftName(pkg.displayName);
            setRenaming(false);
          }
        }
      }
    ) : /* @__PURE__ */ React.createElement("span", { className: "prow-nm", title: pkg.displayName }, pkg.displayName), locked && /* @__PURE__ */ React.createElement("span", { className: "uncat-tag" }, "\uD328\uD0A4\uC9C0 \uC5C6\uC74C"), pinned && /* @__PURE__ */ React.createElement("span", { className: "prow-pin", title: "\uC0C1\uB2E8 \uACE0\uC815\uB428" }, /* @__PURE__ */ React.createElement(Ic, { id: "pin", cls: "sm" })), /* @__PURE__ */ React.createElement("span", { className: "prow-cnt" }, "\uC815\uCC45 ", members.length, !empty && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement("span", { className: "on" }, "\uD65C\uC131 ", activeN))), /* @__PURE__ */ React.createElement("span", { className: "prow-actions" }, !locked && !isDefaultPack && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", title: "\uC774\uB984 \uBCC0\uACBD", onClick: () => {
      setDraftName(pkg.displayName);
      setRenaming(true);
    } }, /* @__PURE__ */ React.createElement(Ic, { id: "edit", cls: "sm" })), !empty && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", title: "\uC774 \uD328\uD0A4\uC9C0\uB97C Policy Hub\uC5D0 \uAC8C\uC2DC", onClick: () => onPublish(pkg.id, members) }, /* @__PURE__ */ React.createElement(Ic, { id: "shield", cls: "sm" })), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib danger", title: "\uD328\uD0A4\uC9C0 \uC0AD\uC81C", onClick: () => onRemove(pkg.id) }, /* @__PURE__ */ React.createElement(Ic, { id: "trash", cls: "sm" }))))),
    !locked && !isDefaultPack && /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "prow-desc",
        value: draftDesc,
        placeholder: "\uC774 \uD328\uD0A4\uC9C0\uAC00 \uBB34\uC5C7\uC744 \uB9C9\uB294\uC9C0 \uAC04\uB2E8\uD788 \uC801\uC5B4\uBCF4\uC138\uC694",
        title: "\uC124\uBA85",
        onChange: (e) => setDraftDesc(e.target.value),
        onBlur: () => onSaveDesc(pkg.id, draftDesc),
        onKeyDown: (e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") {
            setDraftDesc(pkg.desc ?? "");
            e.target.blur();
          }
        }
      }
    ),
    /* @__PURE__ */ React.createElement("div", { className: "prow-pols" }, empty ? /* @__PURE__ */ React.createElement("div", { className: "pb-empty" }, "\uBE44\uC5B4 \uC788\uC74C \u2014 \uC67C\uCABD \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0\uC11C \uC815\uCC45\xB7\uD3F4\uB354\uB97C \uB04C\uC5B4\uB2E4 \uB193\uC73C\uC138\uC694") : members.map((b) => /* @__PURE__ */ React.createElement(E2BindingItem, { key: b.id, binding: b, def: defOf(b), address, readOnly: isDefaultPack, onOpen: () => onOpenBinding(b.defId, b.id), onFork: () => onForkBinding(b) })))
  );
}
function E2BindingItem({ binding: b, def, address, selected, readOnly, onPreview, onOpen, onFork }) {
  const cat = catKey(def?.cat);
  const name = b.alias ?? def?.displayName ?? b.defId;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `pb-item${b.enabled ? "" : " off"}${readOnly ? " ro" : ""}`,
      title: readOnly ? "\uAE30\uBCF8 \uC548\uC804\uD329 \uC815\uCC45 \u2014 \uC218\uC815 \uBD88\uAC00 (\uCF1C\uACE0 \uB044\uAE30\uB9CC \uAC00\uB2A5)" : "\uB204\uB974\uBA74 \uC774 \uC9C0\uAC11 \uAC12 \uC218\uC815 (\uAD6C\uC870\uB294 \uC77D\uAE30 \uC804\uC6A9)",
      onClick: readOnly ? void 0 : onOpen
    },
    /* @__PURE__ */ React.createElement("span", { className: "nm" }, name),
    /* @__PURE__ */ React.createElement("button", { type: "button", className: `pb-check${b.enabled ? " on" : ""}`, title: b.enabled ? "\uC801\uC6A9\uB428 \u2014 \uB044\uAE30" : "\uAEBC\uC9D0 \u2014 \uCF1C\uAE30", onClick: (e) => {
      e.stopPropagation();
      run("\uD1A0\uAE00", () => PS.updateBinding({ address, bindingId: b.id, patch: { enabled: !b.enabled } }));
    } }, b.enabled && /* @__PURE__ */ React.createElement(Ic, { id: "check", cls: "sm" })),
    !readOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", title: "\uAD6C\uC870 \uD3B8\uC9D1 \u2014 \uC561\uC158\xB7\uC870\uAC74\uC744 \uBC14\uAFB8\uBA74 \uC0C8 \uC815\uCC45\uC73C\uB85C \uC800\uC7A5\uB3FC\uC694", onClick: (e) => {
      e.stopPropagation();
      onFork();
    } }, /* @__PURE__ */ React.createElement(Ic, { id: "edit", cls: "sm" })),
    !readOnly && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib danger", title: "\uC774 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uC81C\uAC70", onClick: async (e) => {
      e.stopPropagation();
      if (await e2Confirm({ title: `"${name}" \uC815\uCC45\uC744 \uC774 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uBE84\uAE4C\uC694?`, body: "\uC774 \uC9C0\uAC11\uC5D0\uC11C \uB354\uB294 \uC801\uC6A9\uB418\uC9C0 \uC54A\uC544\uC694. (\uC815\uCC45 \uC790\uCCB4\uB294 \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0 \uB0A8\uC544\uC694)", danger: true, confirmLabel: "\uC81C\uAC70" })) run("\uC81C\uAC70", () => PS.removeBinding({ address, bindingId: b.id }));
    } }, /* @__PURE__ */ React.createElement(Ic, { id: "trash", cls: "sm" })),
    /* @__PURE__ */ React.createElement(E2PolicyPreview, { hover: true, binding: b, def, displayName: name })
  );
}
function E2ApplyModal({ def, pkgId, pkgName, address, onClose }) {
  const base = React.useMemo(() => e2BaseModel(def), [def]);
  const [alias, setAlias] = React.useState(def.displayName);
  const [edited, setEdited] = React.useState(base);
  const [valid, setValid] = React.useState(true);
  const [severity, setSeverity] = React.useState(base?.severity === "deny" ? "deny" : "warn");
  const titleRef = React.useRef(null);
  React.useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const submit = async () => {
    if (!Cedar.canStaticBindDef(def)) return Cedar.rejectUnsupportedApply(def);
    const aliasTrim = alias.trim();
    const finalAlias = aliasTrim && aliasTrim !== def.displayName ? aliasTrim : void 0;
    const ok = await run(
      "\uC815\uCC45 \uC801\uC6A9",
      () => PS.bindDef({ defId: def.id, packageId: pkgId, addresses: [address], ...finalAlias ? { alias: finalAlias } : {} })
    );
    if (ok) {
      pushToast(`${finalAlias ?? def.displayName} \u2192 ${pkgName}`);
      onClose();
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "e2 e2-ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal wide" }, /* @__PURE__ */ React.createElement("div", { className: "m-head" }, /* @__PURE__ */ React.createElement("span", { className: "m-ic" }, /* @__PURE__ */ React.createElement(Ic, { id: "warn", cls: "lg" })), /* @__PURE__ */ React.createElement("div", { className: "m-title-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "m-eye" }, "\uC815\uCC45 \xB7 ", pkgName, "\uC5D0 \uCD94\uAC00"), /* @__PURE__ */ React.createElement("input", { ref: titleRef, className: "m-title", value: alias, onChange: (e) => setAlias(e.target.value) }), /* @__PURE__ */ React.createElement("div", { className: "m-title-hint" }, "\uC81C\uBAA9\uC744 \uBC14\uAFB8\uBA74 \uC774 \uC9C0\uAC11\uC5D0\uC11C \uBD80\uB97C \uC774\uB984\uC774 \uB3FC\uC694.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", style: { marginLeft: "auto" }, onClick: onClose }, /* @__PURE__ */ React.createElement(Ic, { id: "x", cls: "sm" }))), /* @__PURE__ */ React.createElement("div", { className: "m-sub" }, "\uAC12\uC744 \uD655\uC778\uD558\uACE0 \uD544\uC694\uD558\uBA74 \uBC14\uAFD4\uC8FC\uC138\uC694. \uBE48 \uCE78\uC740 \uCC44\uC6CC\uC57C \uC801\uC6A9\uB3FC\uC694."), /* @__PURE__ */ React.createElement("div", { className: "m-body scroll" }, /* @__PURE__ */ React.createElement(
    PolicyFormPane,
    {
      key: def.id,
      initialModel: base,
      initialManifest: def.skeleton.manifest,
      valuesOnly: true,
      compact: true,
      severityValue: severity,
      onSeverityChange: (s) => setSeverity(s),
      onValidity: (v) => setValid(v.valid),
      onChange: ({ model }) => setEdited(model)
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "m-foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "lk", onClick: onClose }, /* @__PURE__ */ React.createElement(Ic, { id: "back", cls: "sm" }), "\uC774\uC804"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn sage", disabled: !valid, onClick: () => void submit() }, "\uBC1B\uAE30"))));
}
function E2FolderApplyModal({ folderName, pkgId, pkgName, address, defs, isInPackage, onClose }) {
  const [checked, setChecked] = React.useState(() => Object.fromEntries(defs.map((d) => [d.id, !isInPackage(d.id)])));
  const [step, setStep] = React.useState(1);
  const [valIdx, setValIdx] = React.useState(0);
  const baseModels = React.useMemo(() => Object.fromEntries(defs.map((d) => [d.id, e2BaseModel(d)])), [defs]);
  const [edited, setEdited] = React.useState(() => ({ ...baseModels }));
  const [validMap, setValidMap] = React.useState({});
  const [sevMap, setSevMap] = React.useState(() => Object.fromEntries(defs.map((d) => [d.id, baseModels[d.id]?.severity === "deny" ? "deny" : "warn"])));
  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const checkedDefs = defs.filter((d) => checked[d.id]);
  const defsToBind = checkedDefs.filter((d) => !isInPackage(d.id));
  const valDefs = defsToBind.filter((d) => e2NeedsValues(d));
  const applyAll = async () => {
    const unsupported = defsToBind.filter((d) => !Cedar.canStaticBindDef(d));
    if (unsupported.length > 0) return Cedar.rejectUnsupportedApply(unsupported);
    for (let i = 0; i < valDefs.length; i++) {
      const d = valDefs[i];
      if (validMap[d.id] === false) {
        setStep(2);
        setValIdx(i);
        pushToast(`\uAC12\uC744 \uBA3C\uC800 \uCC44\uC6CC\uC8FC\uC138\uC694: ${d.displayName}`);
        return;
      }
    }
    const ok = await run("\uC815\uCC45 \uC801\uC6A9", async () => {
      for (const d of checkedDefs) {
        if (isInPackage(d.id)) continue;
        await PS.bindDef({ defId: d.id, packageId: pkgId, addresses: [address] });
      }
    });
    if (ok) {
      pushToast(`${folderName} \u2192 ${pkgName}`);
      onClose();
    }
  };
  const next = () => {
    const unsupported = defsToBind.filter((d) => !Cedar.canStaticBindDef(d));
    if (unsupported.length > 0) return Cedar.rejectUnsupportedApply(unsupported);
    if (valDefs.length === 0) return void applyAll();
    setStep(2);
    setValIdx(0);
  };
  const checkedCount = checkedDefs.length;
  if (step === 1) {
    return /* @__PURE__ */ React.createElement("div", { className: "e2 e2-ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal" }, /* @__PURE__ */ React.createElement("div", { className: "m-head" }, /* @__PURE__ */ React.createElement("span", { className: "m-ic folder" }, /* @__PURE__ */ React.createElement(Ic, { id: "folder", cls: "lg" })), /* @__PURE__ */ React.createElement("div", { className: "m-title-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "m-eye" }, "\uD3F4\uB354 \uC801\uC6A9 \xB7 ", pkgName, "\uC5D0 \uCD94\uAC00"), /* @__PURE__ */ React.createElement("div", { className: "m-h-title" }, folderName, " \uD3F4\uB354"), /* @__PURE__ */ React.createElement("div", { className: "m-title-hint" }, "\uC120\uD0DD\uD55C \uC815\uCC45\uB4E4\uC744 \uD55C \uBC88\uC5D0 \uC801\uC6A9\uD574\uC694.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", style: { marginLeft: "auto" }, onClick: onClose }, /* @__PURE__ */ React.createElement(Ic, { id: "x", cls: "sm" }))), /* @__PURE__ */ React.createElement("div", { className: "m-sub", style: { paddingBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "f-allrow" }, checkedCount, "\uAC1C \uC815\uCC45 \xB7 ", /* @__PURE__ */ React.createElement("span", { className: "need" }, "\uAC12 \uD544\uC694"), " \uB294 \uB2E4\uC74C \uB2E8\uACC4\uC5D0\uC11C \uCC44\uC6CC\uC694.")), /* @__PURE__ */ React.createElement("div", { className: "m-body" }, /* @__PURE__ */ React.createElement("div", { className: "f-list" }, defs.map((d) => {
      const inPkg = isInPackage(d.id);
      return /* @__PURE__ */ React.createElement("label", { key: d.id, className: "f-item", style: inPkg ? { opacity: 0.55 } : void 0 }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!checked[d.id], onChange: () => setChecked((c) => ({ ...c, [d.id]: !c[d.id] })) }), /* @__PURE__ */ React.createElement("span", { className: "dot", style: { background: catStyle(catKey(d.cat)).hex } }), /* @__PURE__ */ React.createElement("span", { className: "nm" }, d.displayName), inPkg ? /* @__PURE__ */ React.createElement("span", { className: "need", style: { color: "var(--mut)", background: "#eef1ef" } }, "\uC774\uBBF8 \uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E4\uC5B4 \uC788\uC5B4\uC694") : e2NeedsValues(d) && /* @__PURE__ */ React.createElement("span", { className: "need" }, "\uAC12 \uD544\uC694"));
    }))), /* @__PURE__ */ React.createElement("div", { className: "m-foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "lk", onClick: onClose }, /* @__PURE__ */ React.createElement(Ic, { id: "x", cls: "sm" }), "\uB2EB\uAE30"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn sage", disabled: checkedCount === 0, onClick: next }, valDefs.length > 0 ? "\uB2E4\uC74C \u2192" : `${checkedCount}\uAC1C \uC801\uC6A9`))));
  }
  const active = valDefs[Math.min(valIdx, valDefs.length - 1)];
  return /* @__PURE__ */ React.createElement("div", { className: "e2 e2-ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal wide" }, /* @__PURE__ */ React.createElement("div", { className: "m-head" }, /* @__PURE__ */ React.createElement("span", { className: "m-ic" }, /* @__PURE__ */ React.createElement(Ic, { id: "warn", cls: "lg" })), /* @__PURE__ */ React.createElement("div", { className: "m-title-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "m-eye" }, "\uAC12 \uCC44\uC6B0\uAE30 \xB7 ", pkgName, "\uC5D0 \uCD94\uAC00"), /* @__PURE__ */ React.createElement("div", { className: "m-h-title" }, active?.displayName), /* @__PURE__ */ React.createElement("div", { className: "m-title-hint" }, "\uD0ED\uC5D0\uC11C \uC815\uCC45\uC744 \uACE8\uB77C \uAC12\uC744 \uCC44\uC6CC\uC694.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ib", style: { marginLeft: "auto" }, onClick: onClose }, /* @__PURE__ */ React.createElement(Ic, { id: "x", cls: "sm" }))), /* @__PURE__ */ React.createElement("div", { className: "f-tabs" }, valDefs.map((d, i) => /* @__PURE__ */ React.createElement("button", { key: d.id, type: "button", className: `f-tab${i === valIdx ? " on" : ""}`, title: d.displayName, onClick: () => setValIdx(i) }, /* @__PURE__ */ React.createElement("span", { className: "dot", style: { background: catStyle(catKey(d.cat)).hex } }), d.displayName))), /* @__PURE__ */ React.createElement("div", { className: "m-sub", style: { paddingTop: 8 } }, "\uD0ED\uC5D0\uC11C \uC815\uCC45\uC744 \uACE8\uB77C \uAC12\uC744 \uD655\uC778\xB7\uC218\uC815\uD574\uC694. \uBE48 \uCE78\uC740 \uCC44\uC6CC\uC57C \uC801\uC6A9\uB3FC\uC694."), /* @__PURE__ */ React.createElement("div", { className: "m-body scroll" }, active && /* @__PURE__ */ React.createElement(
    PolicyFormPane,
    {
      key: active.id,
      initialModel: edited[active.id] ?? baseModels[active.id],
      initialManifest: active.skeleton.manifest,
      valuesOnly: true,
      compact: true,
      severityValue: sevMap[active.id] ?? "warn",
      onSeverityChange: (s) => setSevMap((m) => ({ ...m, [active.id]: s })),
      onValidity: (v) => setValidMap((m) => ({ ...m, [active.id]: v.valid })),
      onChange: ({ model }) => setEdited((m) => ({ ...m, [active.id]: model }))
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "m-foot" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "lk", onClick: () => setStep(1) }, /* @__PURE__ */ React.createElement(Ic, { id: "back", cls: "sm" }), "\uC815\uCC45 \uC120\uD0DD\uC73C\uB85C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn sage", onClick: () => void applyAll() }, "\uBC1B\uAE30"))));
}
Object.assign(window, { Editor2View, Ic });
