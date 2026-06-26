function stripDashboardId(id) {
  return id.replace(/^def::/, "");
}
function defaultTab(method) {
  return method === "form" ? "form" : "cedar";
}
function EditorDetailPageV2() {
  const snap = useOverview();
  const route = useRoute();
  const id = route.segs[1] ? decodeURIComponent(route.segs[1]) : "";
  const storedDef = snap.library.defs[id] || null;
  const walletAddr = (route.params.get("wallet") || "").toLowerCase() || null;
  const bindingId = route.params.get("binding");
  const binding = walletAddr && bindingId ? snap.wallets.byAddress[walletAddr]?.bindings[bindingId] ?? null : null;
  const bindingCtx = storedDef && walletAddr && binding ? { address: walletAddr, binding } : null;
  const seed = React.useMemo(() => consumeNavStateOnce(id), [id]);
  const isNew = !storedDef && !!seed;
  const policy = React.useMemo(() => {
    if (storedDef) {
      const baseModel = storedDef.skeleton.model;
      let model = baseModel;
      if (bindingCtx) {
        model = bindingCtx.binding.modelOverride || Cedar.applyParams(baseModel, { ...storedDef.defaults.params, ...bindingCtx.binding.params || {} });
      }
      const slug = stripDashboardId(storedDef.id);
      const raw = storedDef.skeleton.rawCedar;
      return {
        id: storedDef.id,
        displayName: bindingCtx ? bindingCtx.binding.alias ?? storedDef.displayName : storedDef.displayName,
        model: { ...model, id: slug },
        text: raw && !bindingCtx ? raw : raw ? raw : Cedar.serializeCedar(model, slug, model.severity, model.reason),
        method: storedDef.method || "form",
        cat: storedDef.cat,
        source: storedDef.source,
        sourceVersion: storedDef.sourceVersion,
        manifest: storedDef.skeleton.manifest
      };
    }
    if (seed) {
      return { id, displayName: seed.displayName, model: seed.model ? { ...seed.model, id: stripDashboardId(id) } : Cedar.emptyFormModel(stripDashboardId(id)), text: seed.cedarText, method: seed.method, cat: seed.cat, source: "mine" };
    }
    return null;
  }, [storedDef, seed, id, bindingCtx]);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Topbar, { here: "Policy Editor", subtitle: policy ? policy.displayName : id || "\u2026", right: /* @__PURE__ */ React.createElement("a", { href: "#/editor", className: "ev2-back" }, "\u2190 \uBAA9\uB85D") }), /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-body" }, !policy && /* @__PURE__ */ React.createElement("div", { className: "ev2-empty" }, /* @__PURE__ */ React.createElement("div", { className: "big" }, "\uC815\uCC45\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4"), /* @__PURE__ */ React.createElement("div", { className: "sm" }, /* @__PURE__ */ React.createElement("code", null, id), /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("a", { href: "#/editor" }, "\u2190 \uBAA9\uB85D\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30"))), policy && /* @__PURE__ */ React.createElement(
    EditorBody,
    {
      key: `${policy.id}:${bindingCtx?.binding.id ?? ""}`,
      policy,
      storedDef,
      snap,
      bindingCtx,
      isNew,
      defaultScope: seed ? seed.defaultScope : null,
      defaultWallet: seed ? seed.defaultWallet : null,
      replaceCtx: seed ? seed.replace : null,
      initialTab: seed ? seed.initialTab : null,
      onSaved: () => {
        if (bindingCtx) return navigate("/editor");
        if (isNew) return navigate("/editor", { replace: true });
      },
      onDeleted: () => navigate("/editor")
    }
  )), /* @__PURE__ */ React.createElement(ToastStack, null));
}
const _seedCache = {};
function consumeNavStateOnce(id) {
  if (_seedCache[id] !== void 0) return _seedCache[id];
  const s = consumeNavState();
  const seed = s && s.newPolicy ? s.newPolicy : null;
  _seedCache[id] = seed;
  return seed;
}
function TabBtn({ label, active, badge, onClick }) {
  return /* @__PURE__ */ React.createElement("button", { type: "button", role: "tab", "aria-selected": active, className: `ev2-tab${active ? " on" : ""}`, onClick }, label, badge && /* @__PURE__ */ React.createElement("span", { className: "ev2-tab-soon" }, badge));
}
function DocField({ label, hint, value, onChange }) {
  return /* @__PURE__ */ React.createElement("label", { className: "ev2-doc-field" }, /* @__PURE__ */ React.createElement("span", { className: "ev2-doc-label" }, label), /* @__PURE__ */ React.createElement("textarea", { className: "ev2-doc-input", value, onChange: (e) => onChange(e.target.value), rows: 2, placeholder: hint }));
}
function CedarPane({ value, readOnly, onChange }) {
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-cedar-pane" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-cedar-toolbar" }, /* @__PURE__ */ React.createElement("span", { className: "ev2-cedar-hint" }, readOnly ? /* @__PURE__ */ React.createElement(React.Fragment, null, "\uC774 \uC9C0\uAC11 \uC778\uC2A4\uD134\uC2A4\uC758 \uAC12\uC774 \uC801\uC6A9\uB41C Cedar\uC608\uC694 \u2014 \uC77D\uAE30 \uC804\uC6A9. \uAC12 \uC218\uC815\uC740 \uD3FC \uD0ED\uC5D0\uC11C \uD574\uC8FC\uC138\uC694.") : /* @__PURE__ */ React.createElement(React.Fragment, null, "Cedar \uCF54\uB4DC\uB97C \uC9C1\uC811 \uD3B8\uC9D1\uD569\uB2C8\uB2E4. \uC800\uC7A5 \uC2DC \uC790\uB3D9\uC73C\uB85C ", /* @__PURE__ */ React.createElement("code", null, "@id"), " / ", /* @__PURE__ */ React.createElement("code", null, "@severity"), " \uC8FC\uC11D\uC774 \uAC31\uC2E0\uB429\uB2C8\uB2E4."))), /* @__PURE__ */ React.createElement("textarea", { className: "ev2-cedar-textarea", value, readOnly, onChange: (e) => {
    if (!readOnly) onChange(e.target.value);
  }, spellCheck: false, autoCorrect: "off", autoCapitalize: "off" }));
}
function EditorBody({ policy, storedDef, snap, bindingCtx, isNew, defaultScope, defaultWallet, replaceCtx, initialTab, onSaved, onDeleted }) {
  const [name, setName] = React.useState(policy.displayName);
  const [model, setModel] = React.useState(policy.model);
  const [cedarText, setCedarText] = React.useState(policy.text);
  const [manifest, setManifest] = React.useState(policy.manifest);
  const [tab, setTab] = React.useState(initialTab && !bindingCtx ? initialTab : defaultTab(policy.method));
  const initialDoc = storedDef && storedDef.doc || {};
  const [docDefinition, setDocDefinition] = React.useState(initialDoc.definition || "");
  const [docScope, setDocScope] = React.useState(initialDoc.scope || "");
  const [docAudience, setDocAudience] = React.useState(initialDoc.audience || "");
  const [docUsedData, setDocUsedData] = React.useState(initialDoc.usedData || "");
  const [docOpen, setDocOpen] = React.useState(!!(initialDoc.definition || initialDoc.scope || initialDoc.audience || initialDoc.usedData));
  const docPayload = () => {
    const d = {
      definition: docDefinition.trim() || void 0,
      scope: docScope.trim() || void 0,
      audience: docAudience.trim() || void 0,
      usedData: docUsedData.trim() || void 0
    };
    return d.definition || d.scope || d.audience || d.usedData ? d : void 0;
  };
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [scopeAsk, setScopeAsk] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [revertNotice, setRevertNotice] = React.useState(null);
  const [llmWarn, setLlmWarn] = React.useState(null);
  const [formValidity, setFormValidity] = React.useState({ valid: true, error: null });
  const [resetToken, setResetToken] = React.useState(0);
  const severity = model.severity;
  const setSeverity = (s) => setModel((m) => ({ ...m, severity: s }));
  const fromMarket = policy.source === "market";
  const cstyle = catStyle(policy.cat);
  const usageCount = defUsageCount(snap, policy.id);
  const buildFinalModel = () => ({ ...model, id: stripDashboardId(policy.id), severity, reason: model.reason });
  const prepare = () => {
    const fm = buildFinalModel();
    if (!["deny", "warn", "info"].includes(severity)) throw new Error("\uC2EC\uAC01\uB3C4\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694 (\uCC28\uB2E8/\uACBD\uACE0/\uC815\uBCF4)");
    if (!(fm.reason || "").trim()) throw new Error("\uC0AC\uC720\uAC00 \uBE44\uC5B4 \uC788\uC5B4\uC694 \u2014 \uC815\uCC45\uC774 \uBC1C\uB3D9\uD588\uC744 \uB54C \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uBCF4\uC5EC\uC904 \uBA54\uC2DC\uC9C0\uC608\uC694. \u2462 '\uC5B4\uB5BB\uAC8C \uC54C\uB9B4\uAE4C\uC694?'\uC758 \uC0AC\uC720\uB97C \uCC44\uC6CC\uC8FC\uC138\uC694.");
    const bad = Cedar.findInvalidModelDecimals(fm);
    if (bad.length > 0) throw new Error(`decimal \uAC12 \uD615\uC2DD\uC774 \uC798\uBABB\uB410\uC5B4\uC694: ${bad.map((v) => `"${v}"`).join(", ")} \u2014 \uC18C\uC218\uC810\uC774 \uAF2D \uD544\uC694\uD574\uC694 (\uC608: 3 \u2192 3.0, \uC18C\uC218\uC810 \uC544\uB798 \uCD5C\uB300 4\uC790\uB9AC)`);
    return fm;
  };
  const doSave = async () => {
    setError(null);
    let fm;
    try {
      fm = prepare();
    } catch (e) {
      setError(String(e.message || e));
      return;
    }
    if (bindingCtx && storedDef) {
      await run("\uC800\uC7A5", () => PS.updateBinding({ address: bindingCtx.address, bindingId: bindingCtx.binding.id, patch: { modelOverride: fm, alias: name.trim() && name.trim() !== storedDef.displayName ? name.trim() : void 0 } }));
      pushToast("\uC774 \uC9C0\uAC11\uC758 \uAC12\uC744 \uC800\uC7A5\uD588\uC5B4\uC694");
      return onSaved(policy.id);
    }
    if (!isNew && storedDef) {
      const usage = Object.values(snap.wallets.byAddress).reduce((n, w) => n + Object.values(w.bindings).filter((b) => b.defId === storedDef.id).length, 0);
      if (usage > 0) {
        const before = JSON.stringify(structureOf(storedDef.skeleton.model));
        const after = JSON.stringify(structureOf(fm));
        if (before !== after) {
          window.alert(`\uC774 \uC815\uCC45\uC740 \uC9C0\uAC11 ${usage}\uACF3\uC5D0 \uC801\uC6A9\uB3FC \uC788\uC5B4 \uAD6C\uC870\uB97C \uBC14\uAFC0 \uC218 \uC5C6\uC5B4\uC694.
\uAC12(\uAE30\uBCF8 \uD30C\uB77C\uBBF8\uD130)\xB7\uC774\uB984\xB7\uC2EC\uAC01\uB3C4\uB294 \uBC14\uAFC0 \uC218 \uC788\uC5B4\uC694. \uAD6C\uC870\uAC00 \uB2E4\uB978 \uC815\uCC45\uC774 \uD544\uC694\uD558\uBA74 \uBCF5\uC81C\uD558\uC138\uC694.`);
          setError("\uC800\uC7A5\uC744 \uCDE8\uC18C\uD588\uC5B4\uC694");
          return;
        }
      }
    }
    if (isNew) {
      if (replaceCtx) {
        setBusy(true);
        try {
          await PS.putDef(mkDef({ id: policy.id, name: name.trim() || "untitled", cat: policy.cat, model: fm, manifest, doc: docPayload(), hidden: true, homeWallet: replaceCtx.address, enabled: false, packageId: void 0 }));
          await PS.bindDef({ defId: policy.id, packageId: replaceCtx.packageId, addresses: [replaceCtx.address], enabled: true });
          await PS.removeBinding({ address: replaceCtx.address, bindingId: replaceCtx.bindingId });
          pushToast("\uC0C8 \uC815\uCC45\uC73C\uB85C \uC800\uC7A5\uD558\uACE0 \uAE30\uC874 \uC815\uCC45\uC744 \uB300\uCCB4\uD588\uC5B4\uC694");
          return onSaved("");
        } catch (e) {
          setError(String(e.message || e));
          return;
        } finally {
          setBusy(false);
        }
      }
      setScopeAsk(fm);
      return;
    }
    await run("\uC800\uC7A5", () => PS.putDef({ ...storedDef, displayName: name.trim() || "untitled", skeleton: { ...storedDef.skeleton, model: fm, manifest }, doc: docPayload(), updatedAtMs: Date.now() }));
    pushToast("\uC800\uC7A5\uD588\uC5B4\uC694");
    onSaved(policy.id);
  };
  const finishScope = async (choice) => {
    setBusy(true);
    const fm = scopeAsk;
    try {
      if (choice.scope.kind === "wallets") {
        let lastId = "";
        for (const address of choice.scope.addresses) {
          const addr = address.toLowerCase();
          const defId = `def::${slugify(choice.name)}-${addr.slice(2, 6)}`;
          if (choice.applyNow) {
            await PS.putDef(mkDef({ id: defId, name: choice.name, cat: policy.cat, model: fm, manifest, doc: docPayload(), hidden: true, homeWallet: addr, walletFolderId: void 0, enabled: false, packageId: void 0 }));
            const bindPkg = (choice.walletPackages || {})[address] || PS.UNCATEGORIZED_PKG;
            await PS.bindDef({ defId, packageId: bindPkg, addresses: [addr], enabled: true });
          } else {
            const pick = (choice.walletFolders || {})[address] || { id: WALLET_FOLDER_UNCAT };
            let folderId;
            if ("newName" in pick) {
              const existing = Object.values(snap.wallets.byAddress[addr]?.folders || {}).find((f) => f.displayName === pick.newName);
              if (existing) folderId = existing.id;
              else {
                folderId = `fold::${crypto.randomUUID()}`;
                await PS.putWalletFolder({ address: addr, folder: { id: folderId, displayName: pick.newName } });
              }
            } else if (pick.id !== WALLET_FOLDER_UNCAT) folderId = pick.id;
            await PS.putDef(mkDef({ id: defId, name: choice.name, cat: policy.cat, model: fm, manifest, doc: docPayload(), hidden: true, homeWallet: addr, walletFolderId: folderId, enabled: false, packageId: void 0 }));
          }
          lastId = defId;
        }
      } else {
        let pkgId = choice.packageId;
        if (pkgId === "__new__") {
          pkgId = `pkg::${crypto.randomUUID()}`;
          await PS.putPackage({ id: pkgId, displayName: choice.newPackageName || "\uC0C8 \uD3F4\uB354", source: "mine", updatedAtMs: Date.now() });
        }
        const defId = `def::${slugify(choice.name)}`;
        await PS.putDef(mkDef({ id: defId, name: choice.name, cat: policy.cat, model: fm, manifest, doc: docPayload(), enabled: choice.applyToNewWallets, packageId: pkgId === PS.UNCATEGORIZED_PKG ? void 0 : pkgId }));
        if (choice.scope.kind === "all-wallets") {
          for (const address of choice.scope.addresses) await PS.bindDef({ defId, packageId: PS.UNCATEGORIZED_PKG, addresses: [address] });
        }
      }
      pushToast("\uC815\uCC45\uC744 \uC800\uC7A5\uD588\uC5B4\uC694");
      setScopeAsk(null);
      onSaved("");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };
  const doDelete = () => {
    const extra = usageCount > 0 ? `
${usageCount}\uAC1C \uC9C0\uAC11\uC5D0\uC11C \uD568\uAED8 \uC81C\uAC70\uB429\uB2C8\uB2E4.` : "";
    if (!window.confirm(`\uC815\uCC45 "${name}"\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?${extra}`)) return;
    run("\uC0AD\uC81C", () => PS.deleteDef(policy.id)).then((ok) => ok && onDeleted());
  };
  const openPublish = () => {
    try {
      prepare();
      setPublishOpen(true);
    } catch (e) {
      window.alert(String(e.message || e));
    }
  };
  const onFormChange = ({ cedarText: c, model: nextModel, manifest: nextManifest }) => {
    setModel(nextModel);
    setCedarText(c);
    setManifest(nextManifest);
  };
  const onCedarChange = (next) => {
    setCedarText(next);
    setModel((m) => ({ ...m, severity: Cedar.severityFromCedar(next), reason: Cedar.reasonFromCedar(next) || m.reason }));
  };
  const publishSource = {
    kind: "policy",
    cedarText,
    manifest: policy.manifest,
    suggestedDisplayName: policy.displayName,
    suggestedSlug: stripDashboardId(policy.id)
  };
  const modalWallets = React.useMemo(() => {
    return Object.keys(snap.wallets.byAddress).sort().map((address) => ({
      address,
      label: shortAddr(address),
      folders: Object.values(snap.wallets.byAddress[address]?.folders || {}).map((f) => ({ id: f.id, displayName: f.displayName })),
      packages: Object.values(snap.wallets.byAddress[address]?.packages || {}).map((p) => ({ id: p.id, displayName: p.displayName }))
    }));
  }, [snap]);
  const modalPackages = React.useMemo(() => Object.values(snap.library.packages), [snap]);
  const invalidSave = bindingCtx && !formValidity.valid;
  const applyLlmModel = async (m, warnings) => {
    const sev = ["deny", "warn", "info"].includes(m && m.severity) ? m.severity : severity || "warn";
    const normalized = {
      trigger: m && m.trigger || { kind: "any" },
      when: Array.isArray(m && m.when) ? m.when : [],
      unless: Array.isArray(m && m.unless) ? m.unless : [],
      id: stripDashboardId(policy.id),
      severity: sev,
      reason: m && m.reason || ""
    };
    try {
      normalized.when = Cedar.normalizeSituations(normalized.when);
      normalized.unless = Cedar.normalizeSituations(normalized.unless);
    } catch (e) {
      throw new Error("LLM\uC774 \uB9CC\uB4E0 \uC815\uCC45 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC544\uC694. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
    }
    setModel(normalized);
    setCedarText(Cedar.serializeCedar(normalized, normalized.id, normalized.severity, normalized.reason));
    setManifest(Cedar.generateManifest(normalized, void 0, { id: normalized.id, severity: normalized.severity }).manifest);
    setLlmWarn(warnings && warnings.length ? warnings.join(" \xB7 ") : null);
    setResetToken((t) => t + 1);
    setTab("form");
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-detail" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-head" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-title-row" }, /* @__PURE__ */ React.createElement("span", { className: "ev2-cat-ic", style: cstyle.iconWrap }, /* @__PURE__ */ React.createElement(CatIcon, { cat: policy.cat })), /* @__PURE__ */ React.createElement("input", { className: "ev2-detail-title", value: name, onChange: (e) => setName(e.target.value), placeholder: "\uC815\uCC45 \uC774\uB984" }), isNew && !replaceCtx && /* @__PURE__ */ React.createElement("button", { type: "button", className: `ev2-badge-draft clickable${tab === "doc" ? " open" : ""}`, onClick: () => setTab("doc"), title: "\uC815\uCC45 \uC18C\uAC1C \uD3B8\uC9D1" }, "\uC0C8 \uC815\uCC45 \xB7 \uC800\uC7A5\uD574\uC57C \uC801\uC6A9\uB429\uB2C8\uB2E4", /* @__PURE__ */ React.createElement("svg", { className: "ev2-badge-caret", viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "m6 9 6 6 6-6" }))), policy.cat && /* @__PURE__ */ React.createElement("span", { className: "ev2-cat-tag", style: cstyle.tag }, catLabel(policy.cat))), /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-meta" }, replaceCtx && /* @__PURE__ */ React.createElement("span", { className: "ev2-badge-fork" }, "\u26A0 \uAD6C\uC870 \uD3B8\uC9D1 \u2014 \uC561\uC158\xB7\uC870\uAC74\uC744 \uBC14\uAFD4 \uC800\uC7A5\uD558\uBA74 \uC0C8 \uC815\uCC45\uC73C\uB85C \uB9CC\uB4E4\uC5B4\uC9C0\uACE0, \uC774 \uD328\uD0A4\uC9C0\uC758 \uAE30\uC874 \xAB", replaceCtx.oldName, "\xBB \uC815\uCC45\uC740 \uC0AC\uB77C\uC838\uC694"), bindingCtx && /* @__PURE__ */ React.createElement("span", { className: "ev2-badge-draft" }, bindingCtx.address.slice(0, 6), "\u2026", bindingCtx.address.slice(-4), " \uC9C0\uAC11\uC758 \uC778\uC2A4\uD134\uC2A4 \uD3B8\uC9D1 \u2014 \uAC12 \uBCC0\uACBD\uC740 \uC774 \uC9C0\uAC11\uC5D0\uB9CC \uC801\uC6A9\uB3FC\uC694"), fromMarket && /* @__PURE__ */ React.createElement("span", { className: "ev2-detail-prov" }, /* @__PURE__ */ React.createElement(ShieldIcon, null), "Policy Hub\uC5D0\uC11C \uAC00\uC838\uC634", policy.sourceVersion ? ` \xB7 ${policy.sourceVersion}` : "")), /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-tabs", role: "tablist" }, !bindingCtx && /* @__PURE__ */ React.createElement(TabBtn, { label: "\uC815\uCC45 \uC18C\uAC1C", active: tab === "doc", onClick: () => setTab("doc") }), /* @__PURE__ */ React.createElement(TabBtn, { label: "\uD3FC", active: tab === "form", onClick: () => setTab("form") }), !bindingCtx && /* @__PURE__ */ React.createElement(TabBtn, { label: "LLM", active: tab === "llm", onClick: () => setTab("llm") }), /* @__PURE__ */ React.createElement(TabBtn, { label: "Cedar", active: tab === "cedar", badge: bindingCtx ? "\uC77D\uAE30 \uC804\uC6A9" : void 0, onClick: () => setTab("cedar") }), /* @__PURE__ */ React.createElement("span", { className: "ev2-spc" }), !bindingCtx && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-pri ghost", onClick: openPublish, title: "Policy Hub\uC5D0 \uC62C\uB9AC\uAE30" }, /* @__PURE__ */ React.createElement(ShieldIcon, null), " Policy Hub\uC5D0 \uC62C\uB9AC\uAE30"), !bindingCtx && /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-pri danger", onClick: doDelete }, "\uC0AD\uC81C"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: `ev2-pri${invalidSave ? " invalid" : ""}`,
      title: invalidSave ? "\uD615\uC2DD\uC774 \uB9DE\uC9C0 \uC54A\uC544\uC694 \u2014 \uB204\uB974\uBA74 \uBCC0\uACBD \uC804 \uC0C1\uD0DC\uB85C \uB418\uB3CC\uB9BD\uB2C8\uB2E4" : void 0,
      onClick: () => {
        if (invalidSave) {
          setRevertNotice(`\uD615\uC2DD\uC774 \uB9DE\uC9C0 \uC54A\uC544 \uC800\uC7A5\uD558\uC9C0 \uC54A\uACE0 \uBCC0\uACBD \uC804 \uC0C1\uD0DC\uB85C \uB418\uB3CC\uB838\uC5B4\uC694${formValidity.error ? ` (${formValidity.error})` : ""}.`);
          setResetToken((t) => t + 1);
          return;
        }
        setRevertNotice(null);
        doSave();
      },
      disabled: busy || !cedarText.trim()
    },
    busy ? "\uC800\uC7A5 \uC911\u2026" : "\uC800\uC7A5"
  ))), error && /* @__PURE__ */ React.createElement("div", { className: "ev2-err-banner" }, /* @__PURE__ */ React.createElement(WarnIcon, null), error), revertNotice && /* @__PURE__ */ React.createElement("div", { className: "ev2-err-banner warn" }, /* @__PURE__ */ React.createElement(WarnIcon, null), revertNotice), llmWarn && /* @__PURE__ */ React.createElement("div", { className: "ev2-err-banner warn" }, /* @__PURE__ */ React.createElement(WarnIcon, null), "\uCC38\uACE0: ", llmWarn), /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-tabbody" }, tab === "cedar" && /* @__PURE__ */ React.createElement(CedarPane, { value: cedarText, readOnly: !!bindingCtx, onChange: onCedarChange }), tab === "form" && /* @__PURE__ */ React.createElement(
    PolicyFormPane,
    {
      key: `${policy.id}:${bindingCtx?.binding.id ?? ""}:${resetToken}`,
      initialModel: model,
      initialManifest: policy.manifest,
      valuesOnly: !!bindingCtx,
      onValidity: setFormValidity,
      resetToken,
      onChange: onFormChange
    }
  ), tab === "llm" && !bindingCtx && /* @__PURE__ */ React.createElement(LlmPane, { onModel: applyLlmModel }), tab === "doc" && !bindingCtx && /* @__PURE__ */ React.createElement("div", { className: "ev2-doc-pane" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-doc-pane-head" }, /* @__PURE__ */ React.createElement("div", { className: "t" }, "\uC815\uCC45 \uC18C\uAC1C"), /* @__PURE__ */ React.createElement("div", { className: "s" }, "Policy Hub\uC5D0 \uC62C\uB9B4 \uB54C \uD568\uAED8 \uBCF4\uC5EC\uC9C0\uB294 \uC124\uBA85\uC774\uC5D0\uC694. \uBE44\uC6CC\uB450\uC5B4\uB3C4 \uC800\uC7A5\uB3FC\uC694.")), /* @__PURE__ */ React.createElement("div", { className: "ev2-detail-doc" }, /* @__PURE__ */ React.createElement(DocField, { label: "\uC815\uC758 (\uD55C \uC904 \uC18C\uAC1C)", hint: "\uC774 \uC815\uCC45\uC774 \uBB34\uC5C7\uC744 \uB9C9\uB294\uC9C0 \uD55C \uC904\uB85C", value: docDefinition, onChange: setDocDefinition }), /* @__PURE__ */ React.createElement(DocField, { label: "\uC801\uC6A9 \uBC94\uC704", hint: "\uC5B4\uB5A4 \uAC70\uB798\xB7\uC0C1\uD669\uC5D0 \uC801\uC6A9\uB418\uB294\uC9C0", value: docScope, onChange: setDocScope }), /* @__PURE__ */ React.createElement(DocField, { label: "\uB300\uC0C1 \uC0AC\uC6A9\uC790", hint: "\uB204\uAD6C\uC5D0\uAC8C \uAD8C\uC7A5\uD558\uB294 \uC815\uCC45\uC778\uC9C0", value: docAudience, onChange: setDocAudience }), /* @__PURE__ */ React.createElement(DocField, { label: "\uC0AC\uC6A9\uD558\uB294 \uB370\uC774\uD130", hint: "\uC678\uBD80 \uC870\uD68C\xB7\uBCF4\uAC15 \uB370\uC774\uD130\uAC00 \uC788\uB2E4\uBA74", value: docUsedData, onChange: setDocUsedData })))), /* @__PURE__ */ React.createElement(PublishModal, { open: publishOpen, source: publishSource, onClose: () => setPublishOpen(false) }), /* @__PURE__ */ React.createElement(
    SaveScopeModal,
    {
      open: scopeAsk !== null,
      policyName: name.trim() || "untitled",
      wallets: modalWallets,
      packages: modalPackages,
      defaultKind: defaultScope === "wallet" ? "wallet" : defaultScope === "library" ? "library" : null,
      defaultWalletAddrs: defaultWallet ? [defaultWallet.toLowerCase()] : [],
      busy,
      onCancel: () => setScopeAsk(null),
      onConfirm: finishScope
    }
  ));
}
const LLM_EXAMPLES = [
  "\uC2A4\uC651\uC73C\uB85C \uC0B0 \uD1A0\uD070\uC774 \uB0B4 \uC9C0\uAC11\uC774 \uC544\uB2CC \uB2E4\uB978 \uC8FC\uC18C\uB85C \uAC00\uBA74 \uCC28\uB2E8",
  "\uD1A0\uD070\uC744 \uC18C\uAC01 \uC8FC\uC18C(0x0\u20260 / 0x\u2026dead)\uB85C \uC804\uC1A1\uD558\uBA74 \uCC28\uB2E8",
  "\uBB34\uC81C\uD55C \uC2B9\uC778(uint256/uint160 max)\uC740 \uCC28\uB2E8, \uB2E8 spender\uAC00 Permit2\uBA74 \uC608\uC678",
  "\uC815\uCCB4\uBD88\uBA85 \uBE14\uB77C\uC778\uB4DC \uC11C\uBA85 \uC694\uCCAD\uC740 \uACBD\uACE0"
];
async function llmDraftPolicy(intent) {
  if (!(window.claude && typeof window.claude.complete === "function")) {
    throw new Error("\uC774 \uD658\uACBD\uC5D0\uC11C\uB294 LLM \uC0DD\uC131\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC5B4\uC694. (\uBC31\uC5D4\uB4DC LLM \uBBF8\uC5F0\uACB0)");
  }
  const actions = (Cedar.KNOWN_ACTIONS || []).map((a2) => `${a2.entityType}|${a2.id} = ${a2.label}`).join("\n");
  const fields = (Cedar.fieldsForTrigger() || []).map((f) => `${f.path} = ${f.label} [${f.fieldKind}${f.unit ? ", " + f.unit : ""}]`).join("\n");
  const prompt = [
    "\uB2F9\uC2E0\uC740 DeFi \uAC70\uB798 \uBCF4\uC548 \uC815\uCC45 \uBE4C\uB354\uC785\uB2C8\uB2E4. \uC0AC\uC6A9\uC790\uC758 \uC790\uC5F0\uC5B4 \uC758\uB3C4\uB97C \uC544\uB798 FormModel JSON \uC73C\uB85C \uBCC0\uD658\uD558\uC138\uC694.",
    "\uBC18\uB4DC\uC2DC JSON \uAC1D\uCCB4 \uD558\uB098\uB9CC \uCD9C\uB825\uD558\uC138\uC694. \uCF54\uB4DC\uD39C\uC2A4/\uC124\uBA85/\uC8FC\uC11D \uAE08\uC9C0.",
    "",
    "FormModel \uC2A4\uD0A4\uB9C8:",
    '{ "trigger": {"kind":"actionEq","entityType":"<EntityType>","id":"<ActionId>"} | {"kind":"any"},',
    '  "when": [ Leaf | Group ], "unless": [ Leaf | Group ],',
    '  "severity": "deny" | "warn" | "info", "reason": "<\uC0AC\uC6A9\uC790\uC5D0\uAC8C \uBCF4\uC5EC\uC904 \uC9E7\uC740 \uC601\uC5B4 \uBA54\uC2DC\uC9C0>" }',
    'Leaf = { "fieldPath":"<\uD544\uB4DC path>", "op":"<\uC5F0\uC0B0\uC790>", "value":<Value>, "joiner":"and"|"or" }',
    'Group = { "conds":[Leaf...], "joiner":"and"|"or" }',
    "\uC5F0\uC0B0\uC790: == != < <= > >= in notIn contains notContains",
    'Value \uC885\uB958: {"kind":"string","value":"..."} {"kind":"long","value":0} {"kind":"decimal","value":"0.0"} {"kind":"bool","value":true} {"kind":"set","values":["0x..."]} {"kind":"field","path":"principal.address"}',
    '\uC8FC\uC18C \uBE44\uAD50\uB294 \uBCF4\uD1B5 context.recipient \uB4F1 address \uD544\uB4DC. "\uB0B4 \uC9C0\uAC11"\uC740 {"kind":"field","path":"principal.address"} \uB85C \uD45C\uD604.',
    "\uCC28\uB2E8=deny, \uACBD\uACE0=warn. reason \uC740 \uC601\uC5B4 \uD55C \uBB38\uC7A5.",
    "",
    "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C trigger \uC561\uC158 (EntityType|ActionId = \uB77C\uBCA8):",
    actions,
    "",
    "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uD544\uB4DC (path = \uB77C\uBCA8 [\uD0C0\uC785]):",
    fields,
    "",
    "\uC0AC\uC6A9\uC790 \uC758\uB3C4: " + JSON.stringify(intent),
    "JSON:"
  ].join("\n");
  const raw = await window.claude.complete(prompt);
  let txt = String(raw || "").trim();
  const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
  if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
  let model;
  try {
    model = JSON.parse(txt);
  } catch (e) {
    throw new Error("LLM \uC751\uB2F5\uC744 \uD574\uC11D\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694. \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
  }
  const warnings = [];
  if (model && model.trigger && model.trigger.kind === "actionEq") {
    const ok = (Cedar.KNOWN_ACTIONS || []).some((x) => x.entityType === model.trigger.entityType && x.id === model.trigger.id);
    if (!ok) {
      warnings.push("LLM\uC774 \uACE0\uB978 \uB3D9\uC791\uC744 \uCC3E\uC9C0 \uBABB\uD574 '\uBAA8\uB4E0 \uAC70\uB798'\uB85C \uB450\uC5C8\uC5B4\uC694 \u2014 \uD3FC\uC5D0\uC11C \uACE8\uB77C\uC8FC\uC138\uC694.");
      model.trigger = { kind: "any" };
    }
  }
  return { model, warnings };
}
function LlmPane({ onModel }) {
  const [intent, setIntent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const submit = async () => {
    const text = intent.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { model, warnings } = await llmDraftPolicy(text);
      await onModel(model, warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-pane" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-card" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-head" }, /* @__PURE__ */ React.createElement("span", { className: "ev2-llm-spark", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" }), /* @__PURE__ */ React.createElement("path", { d: "M19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7z" }))), /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-headtext" }, /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-title" }, "\uC815\uCC45\uC744 \uC790\uC5F0\uC5B4\uB85C \uC124\uBA85\uD558\uC138\uC694"), /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-sub" }, "\uC758\uB3C4\uB97C \uC801\uC73C\uBA74 LLM\uC774 \uC815\uCC45\uC73C\uB85C \uBCC0\uD658\uD574 \uD3FC \uD0ED\uC5D0 \uB123\uC5B4\uC918\uC694. \uBCC0\uD658 \uD6C4 \uAC80\uD1A0\xB7\uC218\uC815\uD560 \uC218 \uC788\uC5B4\uC694."))), /* @__PURE__ */ React.createElement("div", { className: `ev2-llm-inputwrap${busy ? " busy" : ""}` }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      className: "ev2-llm-textarea",
      value: intent,
      onChange: (e) => setIntent(e.target.value),
      placeholder: "\uC608: \uC2A4\uC651\uC73C\uB85C \uC0B0 \uD1A0\uD070\uC774 \uB0B4 \uC9C0\uAC11\uC774 \uC544\uB2CC \uB2E4\uB978 \uC8FC\uC18C\uB85C \uAC00\uBA74 \uCC28\uB2E8",
      disabled: busy,
      onKeyDown: (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-inputbar" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-llm-gen", onClick: submit, disabled: busy || !intent.trim() }, busy ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "ev2-llm-spin" }), "\uBCC0\uD658 \uC911\u2026") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.9", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" })), "\uC815\uCC45 \uC0DD\uC131")))), error && /* @__PURE__ */ React.createElement("div", { className: "ev2-llm-error" }, /* @__PURE__ */ React.createElement(WarnIcon, null), error)));
}
function slugify(s) {
  return ((s || "policy").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "policy") + "-" + Math.random().toString(36).slice(2, 6);
}
function mkDef({ id, name, cat, model, manifest, doc, hidden, homeWallet, walletFolderId, enabled, packageId }) {
  return {
    id,
    hidden,
    homeWallet,
    walletFolderId,
    displayName: name || "untitled",
    cat,
    doc,
    skeleton: { model, manifest },
    holes: [],
    defaults: { enabled: !!enabled, params: {}, packageId },
    source: "mine",
    updatedAtMs: Date.now()
  };
}
function structureOf(model) {
  const strip = (nodes) => nodes.map((n) => Cedar.isGroupNode(n) ? { g: strip(n.conds) } : { f: n.fieldPath, o: n.op, k: n.value.kind, j: n.joiner });
  return { trigger: model.trigger, when: strip(model.when), unless: strip(model.unless) };
}
Object.assign(window, { EditorDetailPageV2, EditorBody, CedarPane, TabBtn, DocField });
