/* ════════════════════ 지갑별 정책 (Wallet Policies View) ════════════════════ */
function WalletPoliciesView({ activeWallet, onWalletChange }) {
  const snap = useOverview();
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const rows = React.useMemo(() => {
    return Object.keys(snap.wallets.byAddress).sort().map((address) => ({ address, label: undefined }));
  }, [snap]);
  const [localAddr, setLocalAddr] = React.useState(null);
  // ① 상위(페이지)에서 선택 지갑을 주면 그걸 쓰고, 아니면 로컬 state로 폴백.
  const controlled = activeWallet !== undefined;
  const setAddr = (a) => { if (onWalletChange) onWalletChange(a); if (!controlled) setLocalAddr(a); };
  const activeAddr = (controlled ? activeWallet : localAddr) || rows[0]?.address || null;

  if (rows.length === 0) {
    return (
      <div className="ev2-empty">
        <div className="big">등록된 지갑이 없습니다</div>
        <div className="sm">확장 popup에서 지갑을 추가하면 여기에서 정책을 적용할 수 있어요.</div>
      </div>
    );
  }
  return (
    <div className="wd-wrap">
      <div className="wd-modes">
        {activeAddr && (
          <select className="wd-walletsel" value={activeAddr} onChange={(e) => setAddr(e.target.value)}>
            {rows.map((r) => (
              <option key={r.address} value={r.address}>{r.label ? `${r.label} (${shortAddr(r.address)})` : shortAddr(r.address)}</option>
            ))}
          </select>
        )}
      </div>
      {activeAddr && <WalletWorkspace snap={snap} address={activeAddr} />}
    </div>
  );
}

function WalletWorkspace({ snap, address }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const wallet = snap.wallets.byAddress[address] || { bindings: {}, packages: {}, packageEnabled: {}, folders: {} };
  const walletPkgName = (pid) => (pid === UNCAT ? "개별" : wallet.packages?.[pid]?.displayName ?? pid);

  const [scope, setScope] = React.useState("all");
  const [dropTarget, setDropTarget] = React.useState(null);
  const [renaming, setRenaming] = React.useState(null);
  const [draftName, setDraftName] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(new Set());
  const [folderDropTarget, setFolderDropTarget] = React.useState(null);
  const [publishSrc, setPublishSrc] = React.useState(null);

  const membersByPkg = React.useMemo(() => {
    const m = new Map();
    for (const b of Object.values(wallet.bindings)) {
      const arr = m.get(b.packageId) || [];
      arr.push(b);
      m.set(b.packageId, arr);
    }
    return m;
  }, [wallet]);
  const bindingsByDef = React.useMemo(() => {
    const m = new Map();
    for (const b of Object.values(wallet.bindings)) {
      const arr = m.get(b.defId) || [];
      arr.push(b);
      m.set(b.defId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => walletPkgName(a.packageId).localeCompare(walletPkgName(b.packageId), "ko"));
    return m;
  }, [wallet]);
  const packages = React.useMemo(() => {
    // 개별(미분류)은 비어 있어도 항상 표시.
    const list = [{ id: UNCAT, displayName: "개별", updatedAtMs: 0 }, ...Object.values(wallet.packages || {})];
    return list.sort((a, b) => (a.id === UNCAT ? -1 : b.id === UNCAT ? 1 : a.id.localeCompare(b.id)));
  }, [wallet]);
  const defsByFolder = React.useMemo(() => {
    const m = new Map();
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
    const m = new Map();
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

  const togglePackage = (pkgId, members, displayedOn) =>
    run("패키지 토글", async () => {
      if (displayedOn) return PS.setPackageEnabled({ address, packageId: pkgId, enabled: false });
      await PS.setPackageEnabled({ address, packageId: pkgId, enabled: true });
      if (members.length > 0 && !members.some((b) => b.enabled)) {
        for (const b of members) await PS.updateBinding({ address, bindingId: b.id, patch: { enabled: true } });
      }
    });
  const addDefToPackage = (defId, pkgId) => {
    const def = snap.library.defs[defId];
    if (!def) return;
    if ((bindingsByDef.get(defId) || []).some((b) => b.packageId === pkgId)) return pushToast("이미 이 패키지에 들어 있어요");
    run("정책 적용", () =>
      PS.bindDef({ defId, packageId: pkgId, addresses: [address], ...(Object.keys(def.defaults.params).length ? { params: def.defaults.params } : {}) }),
    ).then((ok) => ok && pushToast(`${def.displayName} → ${walletPkgName(pkgId)}`));
  };
  const createPackage = () =>
    run("패키지 생성", () => PS.putWalletPackage({ address, pkg: { id: `pkg::${crypto.randomUUID()}`, displayName: "새 패키지" } })).then(
      (ok) => ok && pushToast("패키지를 만들었어요 — 이름을 바꿔보세요"),
    );
  const renamePackage = (pkgId) => {
    const pkg = wallet.packages?.[pkgId];
    const name = draftName.trim();
    setRenaming(null);
    if (!pkg || !name || name === pkg.displayName) return;
    run("이름 변경", () => PS.putWalletPackage({ address, pkg: { id: pkgId, displayName: name } }));
  };
  const removePackage = (pkgId) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const n = Object.values(wallet.bindings).filter((b) => b.packageId === pkgId).length;
    if (!window.confirm(`"${pkg.displayName}" 패키지를 이 지갑에서 제거할까요?\n안의 정책 인스턴스 ${n}개도 함께 제거돼요. (라이브러리의 폴더·정책은 그대로예요)`)) return;
    run("패키지 제거", () => PS.removeWalletPackage({ address, packageId: pkgId })).then((ok) => ok && pushToast("이 지갑에서 패키지를 제거했어요"));
  };
  const editSkeleton = (defId) => navigate(`/editor/${encodeURIComponent(defId)}`);
  const deletePolicy = (d) => {
    const uses = Object.values(snap.wallets.byAddress).reduce((n, w) => n + Object.values(w.bindings).filter((b) => b.defId === d.id).length, 0);
    const extra = uses > 0 ? `\n${uses}개 지갑에서 함께 제거됩니다.` : "";
    if (!window.confirm(`정책 "${d.displayName}"을(를) 라이브러리에서 삭제할까요?${extra}`)) return;
    run("정책 삭제", () => PS.deleteDef(d.id)).then((ok) => ok && pushToast("정책을 삭제했어요"));
  };
  const toggleFolder = (id) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const ownFolderIds = React.useMemo(() => {
    const ids = Object.values(wallet.folders || {}).sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")).map((f) => f.id);
    if (walletOnlyByFolder.has("__uncat__") || ids.length > 0) ids.push("__uncat__");
    return ids;
  }, [wallet, walletOnlyByFolder]);
  const createWalletFolder = () =>
    run("폴더 생성", () => PS.putWalletFolder({ address, folder: { id: `fold::${crypto.randomUUID()}`, displayName: "새 폴더" } })).then(
      (ok) => ok && pushToast("폴더를 만들었어요 — 이름을 바꿔보세요"),
    );
  const renameWalletFolderUi = (folderId) => {
    const current = wallet.folders?.[folderId]?.displayName ?? "";
    const name = window.prompt("폴더 이름", current);
    const t = name && name.trim();
    if (!t || t === current) return;
    run("폴더 이름 변경", () => PS.putWalletFolder({ address, folder: { id: folderId, displayName: t } }));
  };
  const moveDefToWalletFolder = (defId, folderId) => {
    const d = snap.library.defs[defId];
    if (!d || d.hidden !== true || d.homeWallet !== address.toLowerCase()) return;
    if ((d.walletFolderId || null) === folderId) return;
    const folderName = folderId ? wallet.folders?.[folderId]?.displayName ?? folderId : "개별";
    run("폴더 이동", () => PS.putDef({ ...d, walletFolderId: folderId || undefined, updatedAtMs: Date.now() })).then((ok) => ok && pushToast(`${d.displayName} → ${folderName}`));
  };
  const deleteWalletFolderUi = (folderId) => {
    const name = wallet.folders?.[folderId]?.displayName ?? folderId;
    if (!window.confirm(`"${name}" 폴더를 삭제할까요?\n안의 정책은 개별로 이동해요(삭제되지 않아요).`)) return;
    run("폴더 삭제", () => PS.removeWalletFolder({ address, folderId })).then((ok) => ok && pushToast("폴더를 삭제했어요 — 정책은 개별로 옮겼어요"));
  };
  const publishWalletPackage = (pkgId, members) => {
    const defs = [...new Map(members.map((b) => [b.defId, snap.library.defs[b.defId]])).values()].filter(Boolean);
    if (defs.length === 0) return pushToast("이 패키지에 든 정책이 없어요");
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
    const droppable = opts.dropFolderId !== undefined;
    return (
      <div key={folder.id} className={`ld-folder${opts.pkg ? " is-pkg" : ""}`}>
        <div
          className={`ld-folderhead${droppable && folderDropTarget === folder.id ? " droptarget" : ""}`}
          onClick={() => toggleFolder(folder.id)}
          onDragOver={droppable ? (e) => { if (e.dataTransfer.types.includes(DRAG_DEF_MIME)) { e.preventDefault(); setFolderDropTarget(folder.id); } } : undefined}
          onDragLeave={droppable ? () => setFolderDropTarget((t) => (t === folder.id ? null : t)) : undefined}
          onDrop={droppable ? (e) => { e.preventDefault(); setFolderDropTarget(null); const defId = e.dataTransfer.getData(DRAG_DEF_MIME); if (defId) moveDefToWalletFolder(defId, opts.dropFolderId ?? null); } : undefined}
        >
          <span className={`ld-caret${open ? " open" : ""}`}><CaretRightIcon /></span>
          {opts.pkg ? <PackageIcon className="ld-pkgico" /> : <FolderIcon />}
          <span className="nm">{folder.displayName}</span>
          <span className="cnt">{defs.length}</span>
          {opts.actions && <span className="acts" onClick={(e) => e.stopPropagation()}>{opts.actions}</span>}
        </div>
        {open && (
          <div className="ld-defs">
            {defs.map((d) => {
              const cat = catKey(d.cat);
              const brows = (bindingsByDef.get(d.id) || []).filter((b) => (scope === "all" || b.packageId === scope) && (bindingFilter === null || bindingFilter(b)));
              return (
                <div key={d.id} className="wt-def">
                  <div
                    className="ld-def"
                    draggable
                    title="클릭해서 템플릿 편집 · 끌어서 패키지에 적용 / 전용 폴더로 이동"
                    onClick={() => navigate(`/editor/${encodeURIComponent(d.id)}`)}
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG_DEF_MIME, d.id); e.dataTransfer.effectAllowed = "copy"; }}
                  >
                    <span className="pol-ic" style={famStyle(d.cat).tile} title={catLabel(cat)}><CatIcon cat={d.cat} /></span>
                    <span className="pol-main">
                      <span className={`pol-nm${brows.length === 0 ? " dim" : ""}`}>{d.displayName}</span>
                      <span className={`pol-desc${d.doc && d.doc.definition ? "" : " add"}`}>{d.doc && d.doc.definition ? d.doc.definition : "설명 추가"}</span>
                    </span>
                    {(() => {
                      const sev = Cedar.defSeverity(d);
                      return sevLabel(sev) && <span className={`pol-sev ${sev}`}>{sevLabel(sev)}</span>;
                    })()}
                    {opts.walletOnly && (bindingsByDef.get(d.id) || []).filter((b) => PS.isEffectiveOn(wallet, b)).length === 0 && (
                      <span className="pol-badge draft">미적용 초안</span>
                    )}
                    {opts.pkg && (() => { const n = defUsageCount(snap, d.id); return n > 0 ? <span className="pol-badge share">공유 · 지갑 {n}</span> : null; })()}
                    <div className="ld-def-acts">
                      <button type="button" className="ev2-iconbtn wt-pub" title="이 정책을 Policy Hub에 게시" onClick={(e) => { e.stopPropagation(); publishDef(d); }}><ShieldIcon /></button>
                      <button type="button" className="ev2-iconbtn" title="정책 뼈대 수정 (라이브러리)" onClick={(e) => { e.stopPropagation(); editSkeleton(d.id); }}><PencilIcon /></button>
                      <button type="button" className="ev2-iconbtn danger" title="정책 삭제 (모든 지갑에서)" onClick={(e) => { e.stopPropagation(); deletePolicy(d); }}><TrashIcon /></button>
                    </div>
                  </div>
                  {brows.map((b) => (
                    <BindingRow
                      key={b.id}
                      binding={b}
                      def={d}
                      wallet={wallet}
                      pkgName={walletPkgName(b.packageId)}
                      address={address}
                      onOpen={() => navigate(`/editor/${encodeURIComponent(d.id)}?wallet=${address}&binding=${encodeURIComponent(b.id)}`)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ev2-2col">
      <aside className="ev2-left">
        <div className="ev2-leftsec">
          <div className="wd-viewfilter">
            <button type="button" className={`wd-vf${scope === "all" ? " on" : ""}`} onClick={() => setScope("all")}>
              <span className="nm">전체 보기</span>
              <span className="wd-vf-ct">적용 {totalActive}</span>
            </button>
          </div>
          <div className="ev2-lefthead">
            <span>이 지갑의 패키지</span>
            <button type="button" className="ev2-iconbtn" title="새 패키지" onClick={createPackage}><PlusIcon /></button>
          </div>
          <div className="ev2-pkglist">
            {packages.map((pkg) => {
              const members = membersByPkg.get(pkg.id) || [];
              const active = members.filter((b) => PS.isEffectiveOn(wallet, b)).length;
              const displayedOn = packageDisplayOn(wallet.packageEnabled[pkg.id] ?? true, members.filter((b) => b.enabled).length);
              const empty = members.length === 0;
              const locked = pkg.id === UNCAT;
              return (
                <div
                  key={pkg.id}
                  className={`ev2-pkgrow wd-scope wd-pkg${scope === pkg.id ? " on" : ""}${empty ? " dim" : ""}${dropTarget === pkg.id ? " droptarget" : ""}`}
                  onClick={() => setScope(pkg.id)}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_DEF_MIME)) { e.preventDefault(); setDropTarget(pkg.id); } }}
                  onDragLeave={() => setDropTarget((t) => (t === pkg.id ? null : t))}
                  onDrop={(e) => { e.preventDefault(); setDropTarget(null); const defId = e.dataTransfer.getData(DRAG_DEF_MIME); if (defId) addDefToPackage(defId, pkg.id); }}
                >
                  <PackageIcon className="wd-pkgico" />
                  {renaming === pkg.id ? (
                    <input autoFocus value={draftName} onClick={(e) => e.stopPropagation()} onChange={(e) => setDraftName(e.target.value)} onBlur={() => renamePackage(pkg.id)} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setRenaming(null); }} />
                  ) : (
                    <span className="nm">{pkg.displayName}</span>
                  )}
                  <span className="cnt">{empty ? "–" : `${active}/${members.length}`}</span>
                  {!locked && (
                    <span className="acts" onClick={(e) => e.stopPropagation()}>
                      {!empty && <button type="button" className="ev2-iconbtn" title="이 패키지를 Policy Hub에 게시" onClick={() => publishWalletPackage(pkg.id, members)}><ShieldIcon /></button>}
                      <button type="button" className="ev2-iconbtn" title="이름 변경" onClick={() => { setRenaming(pkg.id); setDraftName(pkg.displayName); }}><PencilIcon /></button>
                      <button type="button" className="ev2-iconbtn danger" title="삭제" onClick={() => removePackage(pkg.id)}><TrashIcon /></button>
                    </span>
                  )}
                  {!empty && (
                    <label className="pm-switch sm" title="패키지 정책 전체 켜기/끄기" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={displayedOn} onChange={() => togglePackage(pkg.id, members, displayedOn)} />
                      <span className="trk" />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ev2-lefthint">오른쪽 정책을 끌어다 패키지에 놓으면 이 지갑에 적용돼요 — 정책 아래에 패키지별 줄이 하나씩 쌓여요.</div>
        </div>
      </aside>

      <section className="ev2-right">
        <div className="ev2-ctrl">
          <span className="wd-scopelabel">{scope === "all" ? `적용된 정책 ${totalActive}개` : walletPkgName(scope)}</span>
        </div>
        <div className="ev2-scroll">
          <div className="ld">
            {(walletOnlyByFolder.size > 0 || Object.keys(wallet.folders || {}).length > 0) && (
              <div className="wt-section">
                <div className="wt-section-h">
                  이 지갑 전용 정책
                  <button type="button" className="ev2-iconbtn wt-newfolder" title="새 폴더" onClick={createWalletFolder}><PlusIcon /></button>
                </div>
                {ownFolderIds.map((fid) => {
                  const all = walletOnlyByFolder.get(fid) || [];
                  const defs = scope === "all" ? all : all.filter((d) => (bindingsByDef.get(d.id) || []).some((b) => b.packageId === scope));
                  const isUncat = fid === "__uncat__";
                  return renderFolder(
                    { id: `own:${fid}`, displayName: isUncat ? "개별" : wallet.folders?.[fid]?.displayName ?? fid },
                    defs,
                    null,
                    {
                      showEmpty: scope === "all",
                      walletOnly: true,
                      dropFolderId: isUncat ? null : fid,
                      actions: isUncat ? undefined : (
                        <>
                          <button type="button" className="ev2-iconbtn" title="폴더 이름 변경" onClick={() => renameWalletFolderUi(fid)}><PencilIcon /></button>
                          <button type="button" className="ev2-iconbtn danger" title="폴더 삭제 (안의 정책은 개별로)" onClick={() => deleteWalletFolderUi(fid)}><TrashIcon /></button>
                        </>
                      ),
                    },
                  );
                })}
              </div>
            )}
            <div className="wt-section">
              <div className="wt-section-h">라이브러리 공유 정책</div>
              {Object.values(snap.library.packages)
                .sort((a, b) => (a.id === UNCAT ? 1 : b.id === UNCAT ? -1 : a.id.localeCompare(b.id)))
                .concat(defsByFolder.has(UNCAT) && !snap.library.packages[UNCAT] ? [{ id: UNCAT, displayName: "개별" }] : [])
                .map((folder) => {
                  let defs = defsByFolder.get(folder.id) || [];
                  if (scope !== "all") defs = defs.filter((d) => (bindingsByDef.get(d.id) || []).some((b) => b.packageId === scope));
                  return renderFolder(folder, defs, null, { pkg: true });
                })}
            </div>
          </div>
        </div>
      </section>

      <PublishModal open={publishSrc !== null} source={publishSrc} onClose={() => setPublishSrc(null)} />
    </div>
  );
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
    run("별칭 저장", () => PS.updateBinding({ address, bindingId: b.id, patch: { alias: alias || undefined } }));
  };
  const duplicate = () =>
    run("복제", () => PS.bindDef({ defId: b.defId, packageId: b.packageId, addresses: [address], ...(b.params ? { params: b.params } : {}), alias: `${b.alias ?? def.displayName} (복사)` }));

  return (
    <div className={`wt-binding${effective ? "" : " off"}`}>
      <div
        className="wt-binding-main clickable"
        title="이 지갑 인스턴스 편집 — 값을 바꾸면 이 지갑에만 적용돼요"
        onClick={(ev) => {
          if (ev.target.closest("button, input, label, select")) return;
          onOpen();
        }}
      >
        <span className="wt-pkg">
          {pkgName}
          {!pkgOn && <span className="wt-pkgoff">패키지 꺼짐</span>}
        </span>
        {editingAlias ? (
          <input className="wt-alias-input" autoFocus value={aliasDraft} placeholder={def.displayName} onChange={(e) => setAliasDraft(e.target.value)} onBlur={saveAlias} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditingAlias(false); }} />
        ) : (
          <button type="button" className={`wt-alias${b.alias ? "" : " empty"}`} title="이 지갑에서 부를 이름(별칭) 바꾸기" onClick={() => { setAliasDraft(b.alias || ""); setEditingAlias(true); }}>
            {b.alias || "별칭 없음"}
            <PencilIcon />
          </button>
        )}
        <button type="button" className="ev2-iconbtn" title="이 지갑에 복제" onClick={duplicate}><CopyIcon /></button>
        <button
          type="button"
          className={`ev2-ox${b.enabled ? " on" : ""}`}
          title={b.enabled ? "이 정책 끄기 (제외)" : "이 정책 켜기 (포함)"}
          aria-label={b.enabled ? "정책 끄기" : "정책 켜기"}
          onClick={() => run("토글", () => PS.updateBinding({ address, bindingId: b.id, patch: { enabled: !b.enabled } }))}
        >
          {b.enabled ? "○" : "✕"}
        </button>
        <button type="button" className="ev2-iconbtn danger" title="이 패키지에서 제거" onClick={() => run("제거", () => PS.removeBinding({ address, bindingId: b.id }))}><TrashIcon /></button>
      </div>
    </div>
  );
}

Object.assign(window, { WalletPoliciesView, WalletWorkspace, BindingRow });
