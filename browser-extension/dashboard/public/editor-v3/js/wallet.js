function WalletPoliciesView({ activeWallet, onWalletChange }) {
  const snap = useOverview();
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const rows = React.useMemo(() => {
    return Object.keys(snap.wallets.byAddress).sort().map((address) => ({ address, label: void 0 }));
  }, [snap]);
  const [localAddr, setLocalAddr] = React.useState(null);
  const controlled = activeWallet !== void 0;
  const setAddr = (a) => {
    if (onWalletChange) onWalletChange(a);
    if (!controlled) setLocalAddr(a);
  };
  const activeAddr = (controlled ? activeWallet : localAddr) || rows[0]?.address || null;
  if (rows.length === 0) {
    return /* @__PURE__ */ React.createElement("div", { className: "ev2-empty" }, /* @__PURE__ */ React.createElement("div", { className: "big" }, "\uB4F1\uB85D\uB41C \uC9C0\uAC11\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"), /* @__PURE__ */ React.createElement("div", { className: "sm" }, "\uD655\uC7A5 popup\uC5D0\uC11C \uC9C0\uAC11\uC744 \uCD94\uAC00\uD558\uBA74 \uC5EC\uAE30\uC5D0\uC11C \uC815\uCC45\uC744 \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694."));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "wd-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "wd-modes" }, activeAddr && /* @__PURE__ */ React.createElement("select", { className: "wd-walletsel", value: activeAddr, onChange: (e) => setAddr(e.target.value) }, rows.map((r) => /* @__PURE__ */ React.createElement("option", { key: r.address, value: r.address }, r.label ? `${r.label} (${shortAddr(r.address)})` : shortAddr(r.address))))), activeAddr && /* @__PURE__ */ React.createElement(WalletWorkspace, { snap, address: activeAddr }));
}
function WalletWorkspace({ snap, address }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const wallet = snap.wallets.byAddress[address] || { bindings: {}, packages: {}, packageEnabled: {}, folders: {} };
  const walletPkgName = (pid) => pid === UNCAT ? "\uAC1C\uBCC4" : wallet.packages?.[pid]?.displayName ?? pid;
  const [scope, setScope] = React.useState("all");
  const [dropTarget, setDropTarget] = React.useState(null);
  const [renaming, setRenaming] = React.useState(null);
  const [draftName, setDraftName] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(/* @__PURE__ */ new Set());
  const [folderDropTarget, setFolderDropTarget] = React.useState(null);
  const [publishSrc, setPublishSrc] = React.useState(null);
  const membersByPkg = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const b of Object.values(wallet.bindings)) {
      const arr = m.get(b.packageId) || [];
      arr.push(b);
      m.set(b.packageId, arr);
    }
    return m;
  }, [wallet]);
  const bindingsByDef = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const b of Object.values(wallet.bindings)) {
      const arr = m.get(b.defId) || [];
      arr.push(b);
      m.set(b.defId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => walletPkgName(a.packageId).localeCompare(walletPkgName(b.packageId), "ko"));
    return m;
  }, [wallet]);
  const packages = React.useMemo(() => {
    const list = [{ id: UNCAT, displayName: "\uAC1C\uBCC4", updatedAtMs: 0 }, ...Object.values(wallet.packages || {})];
    return list.sort((a, b) => a.id === UNCAT ? -1 : b.id === UNCAT ? 1 : a.id.localeCompare(b.id));
  }, [wallet]);
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
  const walletOnlyByFolder = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const d of Object.values(snap.library.defs)) {
      if (d.hidden !== true || d.homeWallet !== address.toLowerCase()) continue;
      const key = d.walletFolderId || "__uncat__";
      const arr = m.get(key) || [];
      arr.push(d);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
    return m;
  }, [snap, address]);
  const togglePackage = (pkgId, members, displayedOn) => run("\uD328\uD0A4\uC9C0 \uD1A0\uAE00", async () => {
    if (displayedOn) return PS.setPackageEnabled({ address, packageId: pkgId, enabled: false });
    await PS.setPackageEnabled({ address, packageId: pkgId, enabled: true });
    if (members.length > 0 && !members.some((b) => b.enabled)) {
      for (const b of members) await PS.updateBinding({ address, bindingId: b.id, patch: { enabled: true } });
    }
  });
  const addDefToPackage = (defId, pkgId) => {
    const def = snap.library.defs[defId];
    if (!def) return;
    if ((bindingsByDef.get(defId) || []).some((b) => b.packageId === pkgId)) return pushToast("\uC774\uBBF8 \uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E4\uC5B4 \uC788\uC5B4\uC694");
    run(
      "\uC815\uCC45 \uC801\uC6A9",
      () => PS.bindDef({ defId, packageId: pkgId, addresses: [address], ...Object.keys(def.defaults.params).length ? { params: def.defaults.params } : {} })
    ).then((ok) => ok && pushToast(`${def.displayName} \u2192 ${walletPkgName(pkgId)}`));
  };
  const createPackage = async () => {
    const name = await e2Prompt({ title: "\uC0C8 \uD328\uD0A4\uC9C0 \uB9CC\uB4E4\uAE30", body: "\uC0C8\uB85C\uC6B4 \uD328\uD0A4\uC9C0 \uC774\uB984\uC744 \uC815\uD558\uC138\uC694.", placeholder: "\uC608: DeFi \uBCF4\uD638\uD329", confirmLabel: "\uB9CC\uB4E4\uAE30" });
    if (!name) return;
    run("\uD328\uD0A4\uC9C0 \uC0DD\uC131", () => PS.putWalletPackage({ address, pkg: { id: `pkg::${crypto.randomUUID()}`, displayName: name } })).then(
      (ok) => ok && pushToast(`"${name}" \uD328\uD0A4\uC9C0\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694`)
    );
  };
  const renamePackage = (pkgId) => {
    const pkg = wallet.packages?.[pkgId];
    const name = draftName.trim();
    setRenaming(null);
    if (!pkg || !name || name === pkg.displayName) return;
    run("\uC774\uB984 \uBCC0\uACBD", () => PS.putWalletPackage({ address, pkg: { id: pkgId, displayName: name } }));
  };
  const removePackage = (pkgId) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const n = Object.values(wallet.bindings).filter((b) => b.packageId === pkgId).length;
    if (!window.confirm(`"${pkg.displayName}" \uD328\uD0A4\uC9C0\uB97C \uC774 \uC9C0\uAC11\uC5D0\uC11C \uC81C\uAC70\uD560\uAE4C\uC694?
\uC548\uC758 \uC815\uCC45 \uC778\uC2A4\uD134\uC2A4 ${n}\uAC1C\uB3C4 \uD568\uAED8 \uC81C\uAC70\uB3FC\uC694. (\uB77C\uC774\uBE0C\uB7EC\uB9AC\uC758 \uD3F4\uB354\xB7\uC815\uCC45\uC740 \uADF8\uB300\uB85C\uC608\uC694)`)) return;
    run("\uD328\uD0A4\uC9C0 \uC81C\uAC70", () => PS.removeWalletPackage({ address, packageId: pkgId })).then((ok) => ok && pushToast("\uC774 \uC9C0\uAC11\uC5D0\uC11C \uD328\uD0A4\uC9C0\uB97C \uC81C\uAC70\uD588\uC5B4\uC694"));
  };
  const editSkeleton = (defId) => navigate(`/editor/${encodeURIComponent(defId)}`);
  const deletePolicy = (d) => {
    const uses = Object.values(snap.wallets.byAddress).reduce((n, w) => n + Object.values(w.bindings).filter((b) => b.defId === d.id).length, 0);
    const extra = uses > 0 ? `
${uses}\uAC1C \uC9C0\uAC11\uC5D0\uC11C \uD568\uAED8 \uC81C\uAC70\uB429\uB2C8\uB2E4.` : "";
    if (!window.confirm(`\uC815\uCC45 "${d.displayName}"\uC744(\uB97C) \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0\uC11C \uC0AD\uC81C\uD560\uAE4C\uC694?${extra}`)) return;
    run("\uC815\uCC45 \uC0AD\uC81C", () => PS.deleteDef(d.id)).then((ok) => ok && pushToast("\uC815\uCC45\uC744 \uC0AD\uC81C\uD588\uC5B4\uC694"));
  };
  const toggleFolder = (id) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const ownFolderIds = React.useMemo(() => {
    const ids = Object.values(wallet.folders || {}).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")).map((f) => f.id);
    if (walletOnlyByFolder.has("__uncat__") || ids.length > 0) ids.push("__uncat__");
    return ids;
  }, [wallet, walletOnlyByFolder]);
  const createWalletFolder = () => run("\uD3F4\uB354 \uC0DD\uC131", () => PS.putWalletFolder({ address, folder: { id: `fold::${crypto.randomUUID()}`, displayName: "\uC0C8 \uD3F4\uB354" } })).then(
    (ok) => ok && pushToast("\uD3F4\uB354\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694 \u2014 \uC774\uB984\uC744 \uBC14\uAFD4\uBCF4\uC138\uC694")
  );
  const renameWalletFolderUi = (folderId) => {
    const current = wallet.folders?.[folderId]?.displayName ?? "";
    const name = window.prompt("\uD3F4\uB354 \uC774\uB984", current);
    const t = name && name.trim();
    if (!t || t === current) return;
    run("\uD3F4\uB354 \uC774\uB984 \uBCC0\uACBD", () => PS.putWalletFolder({ address, folder: { id: folderId, displayName: t } }));
  };
  const moveDefToWalletFolder = (defId, folderId) => {
    const d = snap.library.defs[defId];
    if (!d || d.hidden !== true || d.homeWallet !== address.toLowerCase()) return;
    if ((d.walletFolderId || null) === folderId) return;
    const folderName = folderId ? wallet.folders?.[folderId]?.displayName ?? folderId : "\uAC1C\uBCC4";
    run("\uD3F4\uB354 \uC774\uB3D9", () => PS.putDef({ ...d, walletFolderId: folderId || void 0, updatedAtMs: Date.now() })).then((ok) => ok && pushToast(`${d.displayName} \u2192 ${folderName}`));
  };
  const deleteWalletFolderUi = (folderId) => {
    const name = wallet.folders?.[folderId]?.displayName ?? folderId;
    if (!window.confirm(`"${name}" \uD3F4\uB354\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?
\uC548\uC758 \uC815\uCC45\uC740 \uAC1C\uBCC4\uB85C \uC774\uB3D9\uD574\uC694(\uC0AD\uC81C\uB418\uC9C0 \uC54A\uC544\uC694).`)) return;
    run("\uD3F4\uB354 \uC0AD\uC81C", () => PS.removeWalletFolder({ address, folderId })).then((ok) => ok && pushToast("\uD3F4\uB354\uB97C \uC0AD\uC81C\uD588\uC5B4\uC694 \u2014 \uC815\uCC45\uC740 \uAC1C\uBCC4\uB85C \uC62E\uACBC\uC5B4\uC694"));
  };
  const publishWalletPackage = (pkgId, members) => {
    const defs = [...new Map(members.map((b) => [b.defId, snap.library.defs[b.defId]])).values()].filter(Boolean);
    if (defs.length === 0) return pushToast("\uC774 \uD328\uD0A4\uC9C0\uC5D0 \uB4E0 \uC815\uCC45\uC774 \uC5C6\uC5B4\uC694");
    const plan = Cedar.publishMembersFromDefs(defs);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setPublishSrc({ kind: "package", suggestedDisplayName: walletPkgName(pkgId), suggestedSlug: pkgId.replace(/^pkg::/, ""), members: plan.members });
  };
  const publishDef = (d) => {
    const m = Cedar.publishMemberFromDef(d);
    if (!m) return Cedar.rejectUnsupportedPublish(d);
    setPublishSrc({ kind: "policy", cedarText: m.cedarText, manifest: m.manifest, suggestedDisplayName: d.displayName, suggestedSlug: m.slug });
  };
  const totalActive = Object.values(wallet.bindings).filter((b) => PS.isEffectiveOn(wallet, b)).length;
  const renderFolder = (folder, defs, bindingFilter, opts) => {
    opts = opts || {};
    if (defs.length === 0 && !opts.showEmpty) return null;
    const open = !collapsed.has(folder.id);
    const droppable = opts.dropFolderId !== void 0;
    return /* @__PURE__ */ React.createElement("div", { key: folder.id, className: `ld-folder${opts.pkg ? " is-pkg" : ""}` }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `ld-folderhead${droppable && folderDropTarget === folder.id ? " droptarget" : ""}`,
        onClick: () => toggleFolder(folder.id),
        onDragOver: droppable ? (e) => {
          if (e.dataTransfer.types.includes(DRAG_DEF_MIME)) {
            e.preventDefault();
            setFolderDropTarget(folder.id);
          }
        } : void 0,
        onDragLeave: droppable ? () => setFolderDropTarget((t) => t === folder.id ? null : t) : void 0,
        onDrop: droppable ? (e) => {
          e.preventDefault();
          setFolderDropTarget(null);
          const defId = e.dataTransfer.getData(DRAG_DEF_MIME);
          if (defId) moveDefToWalletFolder(defId, opts.dropFolderId ?? null);
        } : void 0
      },
      /* @__PURE__ */ React.createElement("span", { className: `ld-caret${open ? " open" : ""}` }, /* @__PURE__ */ React.createElement(CaretRightIcon, null)),
      opts.pkg ? /* @__PURE__ */ React.createElement(PackageIcon, { className: "ld-pkgico" }) : /* @__PURE__ */ React.createElement(FolderIcon, null),
      /* @__PURE__ */ React.createElement("span", { className: "nm" }, folder.displayName),
      /* @__PURE__ */ React.createElement("span", { className: "cnt" }, defs.length),
      opts.actions && /* @__PURE__ */ React.createElement("span", { className: "acts", onClick: (e) => e.stopPropagation() }, opts.actions)
    ), open && /* @__PURE__ */ React.createElement("div", { className: "ld-defs" }, defs.map((d) => {
      const cat = catKey(d.cat);
      const brows = (bindingsByDef.get(d.id) || []).filter((b) => (scope === "all" || b.packageId === scope) && (bindingFilter === null || bindingFilter(b)));
      return /* @__PURE__ */ React.createElement("div", { key: d.id, className: "wt-def" }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "ld-def",
          draggable: true,
          title: "\uD074\uB9AD\uD574\uC11C \uD15C\uD50C\uB9BF \uD3B8\uC9D1 \xB7 \uB04C\uC5B4\uC11C \uD328\uD0A4\uC9C0\uC5D0 \uC801\uC6A9 / \uC804\uC6A9 \uD3F4\uB354\uB85C \uC774\uB3D9",
          onClick: () => navigate(`/editor/${encodeURIComponent(d.id)}`),
          onDragStart: (e) => {
            e.dataTransfer.setData(DRAG_DEF_MIME, d.id);
            e.dataTransfer.effectAllowed = "copy";
          }
        },
        /* @__PURE__ */ React.createElement("span", { className: "pol-ic", style: famStyle(d.cat).tile, title: catLabel(cat) }, /* @__PURE__ */ React.createElement(CatIcon, { cat: d.cat })),
        /* @__PURE__ */ React.createElement("span", { className: "pol-main" }, /* @__PURE__ */ React.createElement("span", { className: `pol-nm${brows.length === 0 ? " dim" : ""}` }, d.displayName), /* @__PURE__ */ React.createElement("span", { className: `pol-desc${d.doc && d.doc.definition ? "" : " add"}` }, d.doc && d.doc.definition ? d.doc.definition : "\uC124\uBA85 \uCD94\uAC00")),
        (() => {
          const sev = Cedar.defSeverity(d);
          return sevLabel(sev) && /* @__PURE__ */ React.createElement("span", { className: `pol-sev ${sev}` }, sevLabel(sev));
        })(),
        opts.walletOnly && (bindingsByDef.get(d.id) || []).filter((b) => PS.isEffectiveOn(wallet, b)).length === 0 && /* @__PURE__ */ React.createElement("span", { className: "pol-badge draft" }, "\uBBF8\uC801\uC6A9 \uCD08\uC548"),
        opts.pkg && (() => {
          const n = defUsageCount(snap, d.id);
          return n > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pol-badge share" }, "\uACF5\uC720 \xB7 \uC9C0\uAC11 ", n) : null;
        })(),
        /* @__PURE__ */ React.createElement("div", { className: "ld-def-acts" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn wt-pub", title: "\uC774 \uC815\uCC45\uC744 Policy Hub\uC5D0 \uAC8C\uC2DC", onClick: (e) => {
          e.stopPropagation();
          publishDef(d);
        } }, /* @__PURE__ */ React.createElement(ShieldIcon, null)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC815\uCC45 \uBF08\uB300 \uC218\uC815 (\uB77C\uC774\uBE0C\uB7EC\uB9AC)", onClick: (e) => {
          e.stopPropagation();
          editSkeleton(d.id);
        } }, /* @__PURE__ */ React.createElement(PencilIcon, null)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn danger", title: "\uC815\uCC45 \uC0AD\uC81C (\uBAA8\uB4E0 \uC9C0\uAC11\uC5D0\uC11C)", onClick: (e) => {
          e.stopPropagation();
          deletePolicy(d);
        } }, /* @__PURE__ */ React.createElement(TrashIcon, null)))
      ), brows.map((b) => /* @__PURE__ */ React.createElement(
        BindingRow,
        {
          key: b.id,
          binding: b,
          def: d,
          wallet,
          pkgName: walletPkgName(b.packageId),
          address,
          onOpen: () => navigate(`/editor/${encodeURIComponent(d.id)}?wallet=${address}&binding=${encodeURIComponent(b.id)}`)
        }
      )));
    })));
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-2col" }, /* @__PURE__ */ React.createElement("aside", { className: "ev2-left" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-leftsec" }, /* @__PURE__ */ React.createElement("div", { className: "wd-viewfilter" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: `wd-vf${scope === "all" ? " on" : ""}`, onClick: () => setScope("all") }, /* @__PURE__ */ React.createElement("span", { className: "nm" }, "\uC804\uCCB4 \uBCF4\uAE30"), /* @__PURE__ */ React.createElement("span", { className: "wd-vf-ct" }, "\uC801\uC6A9 ", totalActive))), /* @__PURE__ */ React.createElement("div", { className: "ev2-lefthead" }, /* @__PURE__ */ React.createElement("span", null, "\uC774 \uC9C0\uAC11\uC758 \uD328\uD0A4\uC9C0"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC0C8 \uD328\uD0A4\uC9C0", onClick: createPackage }, /* @__PURE__ */ React.createElement(PlusIcon, null))), /* @__PURE__ */ React.createElement("div", { className: "ev2-pkglist" }, packages.map((pkg) => {
    const members = membersByPkg.get(pkg.id) || [];
    const active = members.filter((b) => PS.isEffectiveOn(wallet, b)).length;
    const displayedOn = packageDisplayOn(wallet.packageEnabled[pkg.id] ?? true, members.filter((b) => b.enabled).length);
    const empty = members.length === 0;
    const locked = pkg.id === UNCAT;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: pkg.id,
        className: `ev2-pkgrow wd-scope wd-pkg${scope === pkg.id ? " on" : ""}${empty ? " dim" : ""}${dropTarget === pkg.id ? " droptarget" : ""}`,
        onClick: () => setScope(pkg.id),
        onDragOver: (e) => {
          if (e.dataTransfer.types.includes(DRAG_DEF_MIME)) {
            e.preventDefault();
            setDropTarget(pkg.id);
          }
        },
        onDragLeave: () => setDropTarget((t) => t === pkg.id ? null : t),
        onDrop: (e) => {
          e.preventDefault();
          setDropTarget(null);
          const defId = e.dataTransfer.getData(DRAG_DEF_MIME);
          if (defId) addDefToPackage(defId, pkg.id);
        }
      },
      /* @__PURE__ */ React.createElement(PackageIcon, { className: "wd-pkgico" }),
      renaming === pkg.id ? /* @__PURE__ */ React.createElement("input", { autoFocus: true, value: draftName, onClick: (e) => e.stopPropagation(), onChange: (e) => setDraftName(e.target.value), onBlur: () => renamePackage(pkg.id), onKeyDown: (e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") setRenaming(null);
      } }) : /* @__PURE__ */ React.createElement("span", { className: "nm" }, pkg.displayName),
      /* @__PURE__ */ React.createElement("span", { className: "cnt" }, empty ? "\u2013" : `${active}/${members.length}`),
      !locked && /* @__PURE__ */ React.createElement("span", { className: "acts", onClick: (e) => e.stopPropagation() }, !empty && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC774 \uD328\uD0A4\uC9C0\uB97C Policy Hub\uC5D0 \uAC8C\uC2DC", onClick: () => publishWalletPackage(pkg.id, members) }, /* @__PURE__ */ React.createElement(ShieldIcon, null)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC774\uB984 \uBCC0\uACBD", onClick: () => {
        setRenaming(pkg.id);
        setDraftName(pkg.displayName);
      } }, /* @__PURE__ */ React.createElement(PencilIcon, null)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn danger", title: "\uC0AD\uC81C", onClick: () => removePackage(pkg.id) }, /* @__PURE__ */ React.createElement(TrashIcon, null))),
      !empty && /* @__PURE__ */ React.createElement("label", { className: "pm-switch sm", title: "\uD328\uD0A4\uC9C0 \uC815\uCC45 \uC804\uCCB4 \uCF1C\uAE30/\uB044\uAE30", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: displayedOn, onChange: () => togglePackage(pkg.id, members, displayedOn) }), /* @__PURE__ */ React.createElement("span", { className: "trk" }))
    );
  })), /* @__PURE__ */ React.createElement("div", { className: "ev2-lefthint" }, "\uC624\uB978\uCABD \uC815\uCC45\uC744 \uB04C\uC5B4\uB2E4 \uD328\uD0A4\uC9C0\uC5D0 \uB193\uC73C\uBA74 \uC774 \uC9C0\uAC11\uC5D0 \uC801\uC6A9\uB3FC\uC694 \u2014 \uC815\uCC45 \uC544\uB798\uC5D0 \uD328\uD0A4\uC9C0\uBCC4 \uC904\uC774 \uD558\uB098\uC529 \uC313\uC5EC\uC694."))), /* @__PURE__ */ React.createElement("section", { className: "ev2-right" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-ctrl" }, /* @__PURE__ */ React.createElement("span", { className: "wd-scopelabel" }, scope === "all" ? `\uC801\uC6A9\uB41C \uC815\uCC45 ${totalActive}\uAC1C` : walletPkgName(scope))), /* @__PURE__ */ React.createElement("div", { className: "ev2-scroll" }, /* @__PURE__ */ React.createElement("div", { className: "ld" }, (walletOnlyByFolder.size > 0 || Object.keys(wallet.folders || {}).length > 0) && /* @__PURE__ */ React.createElement("div", { className: "wt-section" }, /* @__PURE__ */ React.createElement("div", { className: "wt-section-h" }, "\uC774 \uC9C0\uAC11 \uC804\uC6A9 \uC815\uCC45", /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn wt-newfolder", title: "\uC0C8 \uD3F4\uB354", onClick: createWalletFolder }, /* @__PURE__ */ React.createElement(PlusIcon, null))), ownFolderIds.map((fid) => {
    const all = walletOnlyByFolder.get(fid) || [];
    const defs = scope === "all" ? all : all.filter((d) => (bindingsByDef.get(d.id) || []).some((b) => b.packageId === scope));
    const isUncat = fid === "__uncat__";
    return renderFolder(
      { id: `own:${fid}`, displayName: isUncat ? "\uAC1C\uBCC4" : wallet.folders?.[fid]?.displayName ?? fid },
      defs,
      null,
      {
        showEmpty: scope === "all",
        walletOnly: true,
        dropFolderId: isUncat ? null : fid,
        actions: isUncat ? void 0 : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uD3F4\uB354 \uC774\uB984 \uBCC0\uACBD", onClick: () => renameWalletFolderUi(fid) }, /* @__PURE__ */ React.createElement(PencilIcon, null)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn danger", title: "\uD3F4\uB354 \uC0AD\uC81C (\uC548\uC758 \uC815\uCC45\uC740 \uAC1C\uBCC4\uB85C)", onClick: () => deleteWalletFolderUi(fid) }, /* @__PURE__ */ React.createElement(TrashIcon, null)))
      }
    );
  })), /* @__PURE__ */ React.createElement("div", { className: "wt-section" }, /* @__PURE__ */ React.createElement("div", { className: "wt-section-h" }, "\uB77C\uC774\uBE0C\uB7EC\uB9AC \uACF5\uC720 \uC815\uCC45"), Object.values(snap.library.packages).sort((a, b) => a.id === UNCAT ? 1 : b.id === UNCAT ? -1 : a.id.localeCompare(b.id)).concat(defsByFolder.has(UNCAT) && !snap.library.packages[UNCAT] ? [{ id: UNCAT, displayName: "\uAC1C\uBCC4" }] : []).map((folder) => {
    let defs = defsByFolder.get(folder.id) || [];
    if (scope !== "all") defs = defs.filter((d) => (bindingsByDef.get(d.id) || []).some((b) => b.packageId === scope));
    return renderFolder(folder, defs, null, { pkg: true });
  }))))), /* @__PURE__ */ React.createElement(PublishModal, { open: publishSrc !== null, source: publishSrc, onClose: () => setPublishSrc(null) }));
}
function BindingRow({ binding: b, def, wallet, pkgName, address, onOpen }) {
  const pkgOn = wallet.packageEnabled[b.packageId] ?? true;
  const effective = PS.isEffectiveOn(wallet, b);
  const [editingAlias, setEditingAlias] = React.useState(false);
  const [aliasDraft, setAliasDraft] = React.useState(b.alias || "");
  const saveAlias = () => {
    setEditingAlias(false);
    const alias = aliasDraft.trim();
    if ((b.alias || "") === alias) return;
    run("\uBCC4\uCE6D \uC800\uC7A5", () => PS.updateBinding({ address, bindingId: b.id, patch: { alias: alias || void 0 } }));
  };
  const duplicate = () => run("\uBCF5\uC81C", () => PS.bindDef({ defId: b.defId, packageId: b.packageId, addresses: [address], ...b.params ? { params: b.params } : {}, alias: `${b.alias ?? def.displayName} (\uBCF5\uC0AC)` }));
  return /* @__PURE__ */ React.createElement("div", { className: `wt-binding${effective ? "" : " off"}` }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "wt-binding-main clickable",
      title: "\uC774 \uC9C0\uAC11 \uC778\uC2A4\uD134\uC2A4 \uD3B8\uC9D1 \u2014 \uAC12\uC744 \uBC14\uAFB8\uBA74 \uC774 \uC9C0\uAC11\uC5D0\uB9CC \uC801\uC6A9\uB3FC\uC694",
      onClick: (ev) => {
        if (ev.target.closest("button, input, label, select")) return;
        onOpen();
      }
    },
    /* @__PURE__ */ React.createElement("span", { className: "wt-pkg" }, pkgName, !pkgOn && /* @__PURE__ */ React.createElement("span", { className: "wt-pkgoff" }, "\uD328\uD0A4\uC9C0 \uAEBC\uC9D0")),
    editingAlias ? /* @__PURE__ */ React.createElement("input", { className: "wt-alias-input", autoFocus: true, value: aliasDraft, placeholder: def.displayName, onChange: (e) => setAliasDraft(e.target.value), onBlur: saveAlias, onKeyDown: (e) => {
      if (e.key === "Enter") e.target.blur();
      if (e.key === "Escape") setEditingAlias(false);
    } }) : /* @__PURE__ */ React.createElement("button", { type: "button", className: `wt-alias${b.alias ? "" : " empty"}`, title: "\uC774 \uC9C0\uAC11\uC5D0\uC11C \uBD80\uB97C \uC774\uB984(\uBCC4\uCE6D) \uBC14\uAFB8\uAE30", onClick: () => {
      setAliasDraft(b.alias || "");
      setEditingAlias(true);
    } }, b.alias || "\uBCC4\uCE6D \uC5C6\uC74C", /* @__PURE__ */ React.createElement(PencilIcon, null)),
    /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn", title: "\uC774 \uC9C0\uAC11\uC5D0 \uBCF5\uC81C", onClick: duplicate }, /* @__PURE__ */ React.createElement(CopyIcon, null)),
    /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: `ev2-ox${b.enabled ? " on" : ""}`,
        title: b.enabled ? "\uC774 \uC815\uCC45 \uB044\uAE30 (\uC81C\uC678)" : "\uC774 \uC815\uCC45 \uCF1C\uAE30 (\uD3EC\uD568)",
        "aria-label": b.enabled ? "\uC815\uCC45 \uB044\uAE30" : "\uC815\uCC45 \uCF1C\uAE30",
        onClick: () => run("\uD1A0\uAE00", () => PS.updateBinding({ address, bindingId: b.id, patch: { enabled: !b.enabled } }))
      },
      b.enabled ? "\u25CB" : "\u2715"
    ),
    /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-iconbtn danger", title: "\uC774 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uC81C\uAC70", onClick: () => run("\uC81C\uAC70", () => PS.removeBinding({ address, bindingId: b.id })) }, /* @__PURE__ */ React.createElement(TrashIcon, null))
  ));
}
Object.assign(window, { WalletPoliciesView, WalletWorkspace, BindingRow });
