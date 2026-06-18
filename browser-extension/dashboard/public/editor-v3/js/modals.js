const WALLET_FOLDER_UNCAT = "__uncat__";
function SaveScopeModal({ open, policyName, wallets, packages, busy, onCancel, onConfirm, defaultKind, defaultWalletAddrs }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const [kind, setKind] = React.useState(null);
  const [nameDraft, setNameDraft] = React.useState(policyName);
  const [picked, setPicked] = React.useState(/* @__PURE__ */ new Set());
  const [walletPkg, setWalletPkg] = React.useState({});
  const [walletNewName, setWalletNewName] = React.useState({});
  const [bulk, setBulk] = React.useState(false);
  const [bulkName, setBulkName] = React.useState("");
  const [packageId, setPackageId] = React.useState(UNCAT);
  const [newPackageName, setNewPackageName] = React.useState("");
  const [applyToNewWallets, setApplyToNewWallets] = React.useState(true);
  const [applyToAllNow, setApplyToAllNow] = React.useState(false);
  const [applyNow, setApplyNow] = React.useState(true);
  const [walletBindPkg, setWalletBindPkg] = React.useState({});
  React.useEffect(() => {
    if (open) {
      setNameDraft(policyName);
      setKind(defaultKind || null);
      setPicked(defaultKind === "wallet" && defaultWalletAddrs && defaultWalletAddrs.length ? new Set(defaultWalletAddrs) : /* @__PURE__ */ new Set());
      setWalletPkg({});
      setWalletNewName({});
      setBulk(false);
      setBulkName("");
      setPackageId(UNCAT);
      setNewPackageName("");
      setApplyNow(true);
      setWalletBindPkg({});
    }
  }, [open, policyName]);
  const allAddresses = React.useMemo(() => wallets.map((w) => w.address), [wallets]);
  const walletByAddr = React.useMemo(() => new Map(wallets.map((w) => [w.address, w])), [wallets]);
  const bulkCollisions = React.useMemo(() => {
    const name = bulkName.trim();
    if (!bulk || !name) return [];
    return [...picked].filter((a) => (walletByAddr.get(a)?.folders ?? []).some((f) => f.displayName === name));
  }, [bulk, bulkName, picked, walletByAddr]);
  if (!open) return null;
  const pkgList = packages.some((p) => p.id === UNCAT) ? packages : [{ id: UNCAT, displayName: "\uBBF8\uBD84\uB958" }, ...packages];
  const togglePick = (addr) => setPicked((prev) => {
    const n = new Set(prev);
    n.has(addr) ? n.delete(addr) : n.add(addr);
    return n;
  });
  const pkgOf = (addr) => walletPkg[addr] ?? WALLET_FOLDER_UNCAT;
  const bindPkgOf = (addr) => walletBindPkg[addr] ?? UNCAT;
  const invalid = !nameDraft.trim() || (kind === "wallet" ? picked.size === 0 || (applyNow ? false : bulk ? !bulkName.trim() : [...picked].some((a) => pkgOf(a) === "__new__" && !(walletNewName[a] ?? "").trim())) : packageId === "__new__" && !newPackageName.trim());
  const confirm = () => {
    if (kind === "wallet") {
      if (applyNow) {
        const walletPackages = {};
        for (const addr of picked) walletPackages[addr] = bindPkgOf(addr);
        onConfirm({ name: nameDraft.trim(), scope: { kind: "wallets", addresses: [...picked] }, applyNow: true, walletPackages });
        return;
      }
      const walletFolders = {};
      for (const addr of picked) {
        if (bulk) walletFolders[addr] = { newName: bulkName.trim() };
        else {
          const sel = pkgOf(addr);
          walletFolders[addr] = sel === "__new__" ? { newName: (walletNewName[addr] ?? "").trim() } : { id: sel };
        }
      }
      onConfirm({ name: nameDraft.trim(), scope: { kind: "wallets", addresses: [...picked] }, applyNow: false, packageId: UNCAT, walletFolders, applyToNewWallets: false });
      return;
    }
    onConfirm({
      name: nameDraft.trim(),
      scope: applyToAllNow ? { kind: "all-wallets", addresses: allAddresses } : { kind: "library-only" },
      packageId,
      ...packageId === "__new__" ? { newPackageName: newPackageName.trim() } : {},
      applyToNewWallets
    });
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ptm-bd", role: "dialog", "aria-modal": true, onClick: busy ? void 0 : onCancel }, /* @__PURE__ */ React.createElement("div", { className: "ptm", onClick: (e) => e.stopPropagation() }, kind === null ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "ptm-h" }, /* @__PURE__ */ React.createElement("div", { className: "ptm-t" }, "\uC5B4\uB5A4 \uC815\uCC45\uC73C\uB85C \uC800\uC7A5\uD560\uAE4C\uC694?"), /* @__PURE__ */ React.createElement("div", { className: "ptm-s" }, "\uCC98\uC74C \uC800\uC7A5\uD558\uB294 \uC815\uCC45\uC774\uC5D0\uC694 \u2014 \uC774\uB984\uBD80\uD130 \uC815\uD574\uC8FC\uC138\uC694.")), /* @__PURE__ */ React.createElement("label", { className: "ssm-name" }, /* @__PURE__ */ React.createElement("span", null, "\uC815\uCC45 \uC774\uB984"), /* @__PURE__ */ React.createElement("input", { autoFocus: true, value: nameDraft, onChange: (e) => setNameDraft(e.target.value), placeholder: "\uC608: 3\uB2EC\uB7EC \uCD08\uACFC \uC2A4\uC651 \uC2DC \uCC28\uB2E8", maxLength: 120 })), /* @__PURE__ */ React.createElement("div", { className: "ptm-opts" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ptm-opt", disabled: wallets.length === 0, onClick: () => setKind("wallet") }, /* @__PURE__ */ React.createElement("span", { className: "ptm-opt-t" }, "\uC9C0\uAC11 \uC804\uC6A9 \uC815\uCC45"), /* @__PURE__ */ React.createElement("span", { className: "ptm-opt-d" }, "\uC120\uD0DD\uD55C \uC9C0\uAC11\uC5D0\uB9CC \uC801\uC6A9\uB3FC\uC694 \u2014 \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0\uB294 \uBCF4\uC774\uC9C0 \uC54A\uB294 \uC77C\uD68C\uC6A9 \uC815\uCC45\uC774\uC5D0\uC694.", wallets.length === 0 ? " (\uB4F1\uB85D\uB41C \uC9C0\uAC11\uC774 \uC5C6\uC5B4\uC694)" : "")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ptm-opt", onClick: () => setKind("library") }, /* @__PURE__ */ React.createElement("span", { className: "ptm-opt-t" }, "\uB77C\uC774\uBE0C\uB7EC\uB9AC \uC815\uCC45"), /* @__PURE__ */ React.createElement("span", { className: "ptm-opt-d" }, "\uC9C0\uAC11 \uAC04 \uACF5\uC720\uB418\uB294 \uD15C\uD50C\uB9BF\uC73C\uB85C \uC800\uC7A5\uB3FC\uC694 \u2014 \uC9C0\uAC11\uBCC4 \uC815\uCC45\uC5D0\uC11C \uC5B8\uC81C\uB4E0 \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.")), /* @__PURE__ */ React.createElement("div", { className: "ptm-row" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-sec", onClick: onCancel, disabled: busy }, "\uCDE8\uC18C")))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "ptm-h" }, /* @__PURE__ */ React.createElement("div", { className: "ptm-t" }, kind === "wallet" ? "\uC5B4\uB290 \uC9C0\uAC11\uC5D0 \uC801\uC6A9\uD560\uAE4C\uC694?" : "\uB77C\uC774\uBE0C\uB7EC\uB9AC \uC124\uC815"), /* @__PURE__ */ React.createElement("div", { className: "ptm-s" }, /* @__PURE__ */ React.createElement("b", null, nameDraft.trim() || policyName), " \u2014 ", kind === "wallet" ? applyNow ? "\uC120\uD0DD\uD55C \uC9C0\uAC11\uC5D0 \uC9C0\uAE08 \uBC14\uB85C \uC801\uC6A9\uB3FC\uC694. \uBD84\uB958\uB294 \uD328\uD0A4\uC9C0\uC5D0\uC11C \uACE0\uB97C \uC218 \uC788\uC5B4\uC694(\uAE30\uBCF8 \uBBF8\uBD84\uB958)." : "\uC801\uC6A9\uD558\uC9C0 \uC54A\uACE0 \uC804\uC6A9 \uD3F4\uB354\uC5D0 \uCD08\uC548\uC73C\uB85C\uB9CC \uC800\uC7A5\uB3FC\uC694 \u2014 \uB098\uC911\uC5D0 \uC9C0\uAC11\uBCC4 \uC815\uCC45\uC5D0\uC11C \uCF1C\uBA74 \uB3FC\uC694." : "\uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0 \uD15C\uD50C\uB9BF\uC73C\uB85C \uC800\uC7A5\uB3FC\uC694.")), /* @__PURE__ */ React.createElement("div", { className: "ptm-opts" }, kind === "wallet" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "ssm-wallets" }, wallets.map((w) => /* @__PURE__ */ React.createElement("div", { key: w.address }, /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: picked.has(w.address), onChange: () => togglePick(w.address) }), /* @__PURE__ */ React.createElement("span", { className: "ssm-addr" }, w.label ?? w.address)), picked.has(w.address) && applyNow && /* @__PURE__ */ React.createElement("div", { className: "ssm-pkgrow" }, /* @__PURE__ */ React.createElement("span", { className: "ssm-pkglabel" }, "\uD328\uD0A4\uC9C0"), /* @__PURE__ */ React.createElement("select", { value: bindPkgOf(w.address), onChange: (e) => setWalletBindPkg((m) => ({ ...m, [w.address]: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: UNCAT }, "\uBBF8\uBD84\uB958"), (w.packages || []).map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, p.displayName)))), picked.has(w.address) && !applyNow && !bulk && /* @__PURE__ */ React.createElement("div", { className: "ssm-pkgrow" }, /* @__PURE__ */ React.createElement("span", { className: "ssm-pkglabel" }, "\uD3F4\uB354"), /* @__PURE__ */ React.createElement("select", { value: pkgOf(w.address), onChange: (e) => setWalletPkg((m) => ({ ...m, [w.address]: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: WALLET_FOLDER_UNCAT }, "\uBBF8\uBD84\uB958"), (w.folders || []).map((f) => /* @__PURE__ */ React.createElement("option", { key: f.id, value: f.id }, f.displayName)), /* @__PURE__ */ React.createElement("option", { value: "__new__" }, "+ \uC0C8 \uD3F4\uB354\u2026")), pkgOf(w.address) === "__new__" && /* @__PURE__ */ React.createElement("input", { value: walletNewName[w.address] ?? "", onChange: (e) => setWalletNewName((m) => ({ ...m, [w.address]: e.target.value })), placeholder: "\uC0C8 \uD3F4\uB354 \uC774\uB984" }))))), !applyNow && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: bulk, onChange: (e) => {
    setBulk(e.target.checked);
    if (e.target.checked) setPicked(new Set(allAddresses));
  } }), "\uBAA8\uB4E0 \uC9C0\uAC11\uC5D0 \uAC19\uC740 \uC774\uB984\uC758 \uC0C8 \uD3F4\uB354 \uB9CC\uB4E4\uAE30"), bulk && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { autoFocus: true, value: bulkName, onChange: (e) => setBulkName(e.target.value), placeholder: "\uC0C8 \uD3F4\uB354 \uC774\uB984" })), bulkCollisions.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "ssm-info" }, "\uAC19\uC740 \uC774\uB984\uC758 \uD3F4\uB354\uAC00 \uC774\uBBF8 \uC788\uB294 \uC9C0\uAC11\uC740 \uADF8 \uD3F4\uB354\uC5D0 \uB123\uC5B4\uC694: ", bulkCollisions.map(shortAddr).join(", ")))), /* @__PURE__ */ React.createElement("label", { className: "ptm-field ssm-applynow" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: applyNow, onChange: (e) => setApplyNow(e.target.checked) }), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", null, "\uC800\uC7A5\uD558\uBA74\uC11C \uC9C0\uAE08 \uBC14\uB85C \uCF1C\uAE30"), /* @__PURE__ */ React.createElement("small", null, applyNow ? `\uC120\uD0DD\uD55C \uC9C0\uAC11\uC5D0 \uACE7\uC7A5 \uC801\uC6A9\uB3FC\uC694.` : "\uB044\uBA74 \uC804\uC6A9 \uD3F4\uB354\uC5D0 \uCD08\uC548\uC73C\uB85C\uB9CC \uC800\uC7A5(\uB098\uC911\uC5D0 \uC801\uC6A9).")))), kind === "library" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, "\uD328\uD0A4\uC9C0", /* @__PURE__ */ React.createElement("select", { value: packageId, onChange: (e) => setPackageId(e.target.value) }, pkgList.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, p.displayName)), /* @__PURE__ */ React.createElement("option", { value: "__new__" }, "+ \uC0C8 \uD328\uD0A4\uC9C0\u2026"))), packageId === "__new__" && /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { autoFocus: true, value: newPackageName, onChange: (e) => setNewPackageName(e.target.value), placeholder: "\uC0C8 \uD328\uD0A4\uC9C0 \uC774\uB984" })), /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: applyToAllNow, disabled: wallets.length === 0, onChange: (e) => setApplyToAllNow(e.target.checked) }), " \uC9C0\uAE08 \uBAA8\uB4E0 \uC9C0\uAC11\uC5D0 \uC801\uC6A9 (", wallets.length, "\uAC1C)"), /* @__PURE__ */ React.createElement("label", { className: "ptm-field" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: applyToNewWallets, onChange: (e) => setApplyToNewWallets(e.target.checked) }), " \uC55E\uC73C\uB85C \uCD94\uAC00\uB418\uB294 \uC9C0\uAC11\uC5D0\uB3C4 \uAE30\uBCF8 \uC801\uC6A9")), /* @__PURE__ */ React.createElement("div", { className: "ptm-row" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-sec", onClick: () => setKind(null), disabled: busy }, "\u2190 \uC774\uC804"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "ev2-pri", onClick: confirm, disabled: invalid || busy }, busy ? "\uC800\uC7A5 \uC911\u2026" : "\uC800\uC7A5"))))));
}
const SLUG_RE = /^[A-Za-z0-9_./()-]{1,128}$/;
function extractHoles(cedarText) {
  const holes = [];
  let i = 0;
  (cedarText.match(/0x[0-9a-fA-F]{40}/g) || []).forEach((a) => {
    holes.push({ key: "a" + i++, kind: "address", path: "\uC8FC\uC18C", label: "\uC8FC\uC18C", display: shortAddr(a), raw: a, paramName: "addr_" + i });
  });
  (cedarText.match(/[<>]=?\s*(\d+(?:\.\d+)?)/g) || []).forEach((m) => {
    const num = m.replace(/[<>=\s]/g, "");
    holes.push({ key: "n" + i++, kind: "number", path: "\uC784\uACC4\uAC12", label: "\uC784\uACC4\uAC12", display: num, paramName: "threshold_" + i });
  });
  (cedarText.match(/decimal\("(\d+(?:\.\d+)?)"\)/g) || []).forEach((m) => {
    const num = m.match(/"([^"]+)"/)[1];
    holes.push({ key: "d" + i++, kind: "number", path: "\uC784\uACC4\uAC12(decimal)", label: "\uC784\uACC4\uAC12", display: num, paramName: "threshold_" + i });
  });
  return holes;
}
function PublishModal({ open, onClose, source }) {
  const [step, setStep] = React.useState(1);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [kept, setKept] = React.useState(/* @__PURE__ */ new Set());
  const [done, setDone] = React.useState(false);
  const rules = React.useMemo(() => {
    if (!source) return [];
    if (source.kind === "policy") {
      const holes = extractHoles(source.cedarText);
      return [{ ruleId: source.suggestedSlug, title: source.suggestedDisplayName, cedarText: source.cedarText, holes }];
    }
    return source.members.map((m) => ({ ruleId: m.slug, title: m.title, cedarText: m.cedarText, holes: extractHoles(m.cedarText) }));
  }, [source]);
  const numberHoles = rules.flatMap((r) => r.holes.filter((h) => h.kind === "number"));
  const addressHoles = rules.flatMap((r) => r.holes.filter((h) => h.kind === "address"));
  const keptAddrCount = addressHoles.filter((h) => kept.has(h.key)).length;
  const blankedAddrCount = addressHoles.length - keptAddrCount;
  React.useEffect(() => {
    if (open) {
      setStep(1);
      setName("");
      setDescription("");
      setKept(/* @__PURE__ */ new Set());
      setDone(false);
    }
  }, [open]);
  if (!open || !source) return null;
  const toggleKeep = (key) => setKept((prev) => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const seededName = name || source.suggestedDisplayName;
  const publish = () => {
    setDone(true);
    pushToast(`'${seededName}'\uC744(\uB97C) Policy Hub\uC5D0 \uACF5\uAC1C\uD588\uC5B4\uC694`);
    setTimeout(onClose, 700);
  };
  const steps = [{ n: 1, label: "\uBE44\uC2DD\uBCC4 \uD655\uC778" }, { n: 2, label: "\uC774\uB984\xB7\uC124\uBA85" }, { n: 3, label: "\uACF5\uAC1C" }];
  return /* @__PURE__ */ React.createElement("div", { className: "pub-backdrop", onClick: (e) => {
    if (e.target === e.currentTarget) onClose();
  } }, /* @__PURE__ */ React.createElement("div", { className: "pub-modal", role: "dialog", "aria-modal": true }, /* @__PURE__ */ React.createElement("header", { className: "pub-head" }, /* @__PURE__ */ React.createElement("span", { className: "pub-head-ic" }, /* @__PURE__ */ React.createElement(ShieldIcon, { width: 16, height: 16 })), /* @__PURE__ */ React.createElement("div", { className: "pub-head-t" }, /* @__PURE__ */ React.createElement("div", { className: "pub-title" }, "Policy Hub\uC5D0 \uC62C\uB9AC\uAE30"), /* @__PURE__ */ React.createElement("div", { className: "pub-sub" }, "\uB0B4\uAC00 \uD050\uB808\uC774\uC158\uD55C \uD328\uD0A4\uC9C0\uB97C \uACF5\uAC1C\uD574 \uB2E4\uB978 \uC0AC\uC6A9\uC790\uAC00 \uB2F4\uC744 \uC218 \uC788\uAC8C \uD569\uB2C8\uB2E4.")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pub-x", onClick: onClose, "aria-label": "\uB2EB\uAE30" }, /* @__PURE__ */ React.createElement(XIcon, { width: 16, height: 16 }))), /* @__PURE__ */ React.createElement("div", { className: "pub-stepper" }, steps.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: s.n, className: "pub-step-wrap" }, /* @__PURE__ */ React.createElement("div", { className: `pub-step${step === s.n ? " on" : ""}${step > s.n ? " done" : ""}` }, /* @__PURE__ */ React.createElement("span", { className: "pub-step-n" }, step > s.n ? "\u2713" : s.n), /* @__PURE__ */ React.createElement("span", { className: "pub-step-l" }, s.label)), i < steps.length - 1 && /* @__PURE__ */ React.createElement("span", { className: "pub-step-line" })))), /* @__PURE__ */ React.createElement("div", { className: "pub-body" }, step === 1 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pub-info" }, /* @__PURE__ */ React.createElement(LockIcon, { width: 14, height: 14 }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "\uAC1C\uC778\uC815\uBCF4 \uC790\uB3D9 \uBE44\uC2DD\uBCC4 (\uAE30\uBCF8)"), /* @__PURE__ */ React.createElement("div", null, "\uC8FC\uC18C\uB958 \uC2DD\uBCC4\uC790\uB294 \uAE30\uBCF8\uC73C\uB85C ", /* @__PURE__ */ React.createElement("b", null, "\uD30C\uB77C\uBBF8\uD130 \uAD6C\uBA4D\uC73C\uB85C \uBE44\uC6CC\uC11C"), " \uC62C\uB77C\uAC00\uACE0, \uB2F4\uB294 \uC0AC\uB78C\uC774 \uC790\uAE30 \uAC12\uC744 \uCC44\uC6C1\uB2C8\uB2E4. \uC8FC\uC18C\uAC00 \uC815\uCC45\uC758 \uBCF8\uC9C8\uC774\uBA74 \uCE78\uBCC4\uB85C ", /* @__PURE__ */ React.createElement("b", null, "\uAC12 \uACF5\uAC1C"), "\uB97C \uC120\uD0DD\uD560 \uC218 \uC788\uC5B4\uC694."))), /* @__PURE__ */ React.createElement("div", { className: "pub-chips" }, /* @__PURE__ */ React.createElement("span", { className: "pub-chip" }, /* @__PURE__ */ React.createElement(SearchIcon, { width: 14, height: 14 }), " \uC8FC\uC18C\uB958 (\uAE30\uBCF8 \uBE44\uC6C0) \xB7 ", blankedAddrCount), keptAddrCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "pub-chip warn" }, "# \uC8FC\uC18C \uACF5\uAC1C \xB7 ", keptAddrCount), /* @__PURE__ */ React.createElement("span", { className: "pub-chip" }, "# \uC22B\uC790 \uC784\uACC4\uAC12 (\uC120\uD0DD) \xB7 ", numberHoles.length)), /* @__PURE__ */ React.createElement("div", { className: "pub-rules" }, rules.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.ruleId, className: "pub-rule" }, /* @__PURE__ */ React.createElement("div", { className: "pub-rule-head" }, /* @__PURE__ */ React.createElement("span", { className: "pub-rule-dot" }), /* @__PURE__ */ React.createElement("span", { className: "pub-rule-title" }, r.title), /* @__PURE__ */ React.createElement("span", { className: "pub-rule-id" }, r.ruleId)), r.holes.map(
    (h) => h.kind === "address" ? /* @__PURE__ */ React.createElement("div", { key: h.key, className: `pub-field${kept.has(h.key) ? " kept" : ""}` }, /* @__PURE__ */ React.createElement("span", { className: "pub-field-ic addr" }, /* @__PURE__ */ React.createElement(SearchIcon, { width: 14, height: 14 })), /* @__PURE__ */ React.createElement("div", { className: "pub-field-main" }, /* @__PURE__ */ React.createElement("div", { className: "pub-field-label" }, h.label, " ", /* @__PURE__ */ React.createElement("code", null, h.display)), /* @__PURE__ */ React.createElement("div", { className: "pub-field-val" }, kept.has(h.key) ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", null, h.display), /* @__PURE__ */ React.createElement("span", { className: "arrow" }, "\u2192"), /* @__PURE__ */ React.createElement("span", { className: "param public" }, "Policy Hub\uC5D0 \uACF5\uAC1C")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "redacted" }, h.display), /* @__PURE__ */ React.createElement("span", { className: "arrow" }, "\u2192"), /* @__PURE__ */ React.createElement("span", { className: "param" }, h.paramName)))), /* @__PURE__ */ React.createElement("div", { className: "pub-numtoggle pub-addrtoggle" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: !kept.has(h.key) ? "on" : "", onClick: () => kept.has(h.key) && toggleKeep(h.key) }, "\uBE44\uC6B0\uAE30", /* @__PURE__ */ React.createElement("small", null, h.paramName)), /* @__PURE__ */ React.createElement("button", { type: "button", className: kept.has(h.key) ? "on public" : "", onClick: () => !kept.has(h.key) && toggleKeep(h.key) }, "\uAC12 \uACF5\uAC1C", /* @__PURE__ */ React.createElement("small", null, h.display)))) : /* @__PURE__ */ React.createElement("div", { key: h.key, className: "pub-field" }, /* @__PURE__ */ React.createElement("span", { className: "pub-field-ic num" }, "#"), /* @__PURE__ */ React.createElement("div", { className: "pub-field-main" }, /* @__PURE__ */ React.createElement("div", { className: "pub-field-label" }, h.label, " ", /* @__PURE__ */ React.createElement("code", null, h.path)), /* @__PURE__ */ React.createElement("div", { className: "pub-field-sub" }, "\uC6D0\uC791\uC790\uAC00 \uC4F4 \uAC12 ", /* @__PURE__ */ React.createElement("b", null, h.display))), /* @__PURE__ */ React.createElement("div", { className: "pub-numtoggle" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: !kept.has(h.key) ? "on" : "", onClick: () => kept.has(h.key) && toggleKeep(h.key) }, "\uBE44\uC6B0\uAE30", /* @__PURE__ */ React.createElement("small", null, h.paramName)), /* @__PURE__ */ React.createElement("button", { type: "button", className: kept.has(h.key) ? "on" : "", onClick: () => !kept.has(h.key) && toggleKeep(h.key) }, "\uCD94\uCC9C\uAC12 \uB0A8\uAE30\uAE30", /* @__PURE__ */ React.createElement("small", null, h.display))))
  ), r.holes.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "pub-rule-clean" }, "\uBE44\uC2DD\uBCC4\uD560 \uC2DD\uBCC4\uC790\uAC00 \uC5C6\uC5B4\uC694."))))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "pub-l" }, "\uD328\uD0A4\uC9C0 \uC774\uB984"), /* @__PURE__ */ React.createElement("input", { className: "pub-input", value: seededName, onChange: (e) => setName(e.target.value), maxLength: 120 }), /* @__PURE__ */ React.createElement("label", { className: "pub-l" }, "\uC124\uBA85"), /* @__PURE__ */ React.createElement("textarea", { className: "pub-textarea", value: description, onChange: (e) => setDescription(e.target.value), rows: 3, maxLength: 500, placeholder: "\uC774 \uD328\uD0A4\uC9C0\uAC00 \uBB34\uC5C7\uC744 \uB9C9\uC544\uC8FC\uB294\uC9C0 \uAC04\uB2E8\uD788 \uC801\uC5B4\uC8FC\uC138\uC694" }), /* @__PURE__ */ React.createElement("div", { className: "pub-summary" }, /* @__PURE__ */ React.createElement("div", { className: "pub-summary-t" }, "\uACF5\uAC1C\uB420 \uB0B4\uC6A9"), /* @__PURE__ */ React.createElement("div", { className: "pub-summary-row" }, /* @__PURE__ */ React.createElement("span", null, "\uC815\uCC45 \uC218"), /* @__PURE__ */ React.createElement("b", null, rules.length, "\uAC1C")), /* @__PURE__ */ React.createElement("div", { className: "pub-summary-row" }, /* @__PURE__ */ React.createElement("span", null, "\uC8FC\uC18C \uAD6C\uBA4D(\uBE44\uC2DD\uBCC4)"), /* @__PURE__ */ React.createElement("b", null, blankedAddrCount)), keptAddrCount > 0 && /* @__PURE__ */ React.createElement("div", { className: "pub-summary-row warn" }, /* @__PURE__ */ React.createElement("span", null, "\uC8FC\uC18C \uACF5\uAC1C"), /* @__PURE__ */ React.createElement("b", null, keptAddrCount)), /* @__PURE__ */ React.createElement("div", { className: "pub-summary-row" }, /* @__PURE__ */ React.createElement("span", null, "\uCD94\uCC9C\uAC12 \uB0A8\uAE40"), /* @__PURE__ */ React.createElement("b", null, numberHoles.filter((h) => kept.has(h.key)).length, " / ", numberHoles.length))), /* @__PURE__ */ React.createElement("div", { className: "pub-note" }, /* @__PURE__ */ React.createElement(ShieldIcon, { width: 16, height: 16 }), " \uACF5\uAC1C = \uB204\uAD6C\uB098 Policy Hub\uC5D0\uC11C \uB2F4\uC744 \uC218 \uC788\uC74C. \uBE44\uACF5\uAC1C\uB85C \uB418\uB3CC\uB9B4 \uC218 \uC788\uC5B4\uC694."))), /* @__PURE__ */ React.createElement("footer", { className: "pub-foot" }, step === 1 ? /* @__PURE__ */ React.createElement(React.Fragment, null, keptAddrCount > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pub-foot-note warn" }, "\uC8FC\uC18C ", keptAddrCount, "\uCE78\uC774 Policy Hub\uC5D0 \uACF5\uAC1C\uB85C \uC62C\uB77C\uAC11\uB2C8\uB2E4") : /* @__PURE__ */ React.createElement("span", { className: "pub-foot-note" }, "\uC8FC\uC18C\uB958\uB294 \uAE30\uBCF8 \uBE44\uC6CC\uC9D1\uB2C8\uB2E4 \xB7 \uCE78\uBCC4\uB85C \uACF5\uAC1C \uC120\uD0DD \uAC00\uB2A5"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pub-btn ghost", onClick: onClose }, "\uCDE8\uC18C"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pub-btn primary", onClick: () => setStep(2) }, "\uB2E4\uC74C \u203A")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { type: "button", className: "pub-btn ghost", onClick: () => setStep(1) }, "\u2039 \uB4A4\uB85C"), /* @__PURE__ */ React.createElement("span", { className: "pub-spc" }), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pub-btn publish", onClick: publish, disabled: done }, /* @__PURE__ */ React.createElement(ShieldIcon, { width: 16, height: 16 }), done ? "\uACF5\uAC1C \uC911\u2026" : "Policy Hub\uC5D0 \uACF5\uAC1C")))));
}
Object.assign(window, { SaveScopeModal, PublishModal, WALLET_FOLDER_UNCAT });
