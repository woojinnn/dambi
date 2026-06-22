/* ════════════════════ Editor List Page — 지갑별 정책 v2 (Editor2View) ════════════════════ */
function EditorListPageV2() {
  const snap = useOverview();
  const [chooserOpen, setChooserOpen] = React.useState(false);

  const defCount = Object.values(snap.library.defs).filter((d) => !d.hidden).length;
  const pkgCount = Object.keys(snap.library.packages).length;

  return (
    <>
      <Topbar here="Policy Editor" subtitle={`정책 ${defCount}개 · 패키지 ${pkgCount}개`} />
      <div className="ev2-body">
        <Editor2View onNewPolicy={() => setChooserOpen(true)} />
      </div>
      <ToastStack />
      <ConfirmHost />
      <NewPolicyChooser open={chooserOpen} onClose={() => setChooserOpen(false)} />
    </>
  );
}

function LibraryTab({ snap }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const [query, setQuery] = React.useState("");
  const [catFilter, setCatFilter] = React.useState("all");
  const [defaultsFor, setDefaultsFor] = React.useState(null);
  const [publishSrc, setPublishSrc] = React.useState(null);

  const presentCats = React.useMemo(() => {
    const set = new Set();
    for (const d of Object.values(snap.library.defs)) if (!d.hidden) set.add(catKey(d.cat));
    return CAT_ORDER.filter((c) => set.has(c));
  }, [snap]);

  const onDelete = (d) => {
    const n = defUsageCount(snap, d.id);
    const msg = n > 0
      ? `정책 "${d.displayName}"를 삭제할까요?\n${n}개 지갑에서 함께 제거됩니다. 되돌릴 수 없어요.`
      : `정책 "${d.displayName}"를 삭제할까요?\n되돌릴 수 없어요.`;
    if (!window.confirm(msg)) return;
    run("삭제", () => PS.deleteDef(d.id)).then((ok) => ok && pushToast("정책을 삭제했어요"));
  };
  const createPackage = () =>
    run("패키지 생성", () => PS.putPackage({ id: `pkg::${crypto.randomUUID()}`, displayName: "새 패키지", source: "mine", updatedAtMs: Date.now() })).then(
      (ok) => ok && pushToast("패키지를 만들었어요 — 이름을 바꿔보세요"),
    );
  const renamePackage = (pkg, name) => {
    const t = name.trim();
    if (!t || t === pkg.displayName) return;
    run("이름 변경", () => PS.putPackage({ ...pkg, displayName: t, updatedAtMs: Date.now() }));
  };
  const removePackage = (pkg) => {
    if (!window.confirm(`패키지 "${pkg.displayName}"를 삭제할까요?\n안의 정책은 '개별'로 이동해요.`)) return;
    run("패키지 삭제", () => PS.deletePackage(pkg.id)).then((ok) => ok && pushToast("패키지를 삭제했어요"));
  };
  const moveDef = (defId, packageId) => {
    const d = snap.library.defs[defId];
    if (!d) return;
    const next = packageId === UNCAT ? undefined : packageId;
    if ((d.defaults.packageId || undefined) === next) return;
    run("폴더 이동", () => PS.putDef({ ...d, defaults: { ...d.defaults, packageId: next }, updatedAtMs: Date.now() })).then(
      (ok) => ok && pushToast(`${d.displayName} → ${snap.library.packages[packageId]?.displayName ?? "개별"}`),
    );
  };
  const publishPackage = (pkg) => {
    const members = Object.values(snap.library.defs).filter((d) => !d.hidden && d.defaults.packageId === pkg.id);
    if (members.length === 0) return pushToast("이 패키지에 든 정책이 없어요");
    const plan = Cedar.publishMembersFromDefs(members);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setPublishSrc({
      kind: "package",
      suggestedDisplayName: pkg.displayName,
      suggestedSlug: pkg.id.replace(/^pkg::/, ""),
      members: plan.members,
    });
  };

  return (
    <div className="ld-wrap">
      <div className="ev2-ctrl">
        <div className="ev2-search">
          <SearchIcon />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="정책 이름 검색…" />
        </div>
        <span className="ev2-spc" />
        <button type="button" className="ev2-sec" onClick={createPackage}><PlusIcon /> 새 패키지</button>
      </div>

      {presentCats.length > 0 && (
        <div className="ev2-catbar">
          <button type="button" className={`ev2-catchip${catFilter === "all" ? " on" : ""}`} onClick={() => setCatFilter("all")}>모든 카테고리</button>
          {presentCats.map((c) => (
            <button key={c} type="button" className={`ev2-catchip${catFilter === c ? " on" : ""}`} onClick={() => setCatFilter(c)}>
              <span className="dot" style={{ background: catStyle(c).hex }} />
              {catLabel(c)}
            </button>
          ))}
        </div>
      )}

      <div className="ev2-scroll">
        {Object.values(snap.library.defs).filter((d) => !d.hidden).length === 0 ? (
          <div className="ev2-empty">
            <div className="big">아직 정책 정의가 없습니다</div>
            <div className="sm">상단 “+ 새 정책” 버튼으로 첫 정의를 만들어 보세요.</div>
          </div>
        ) : (
          <LibraryDirectory
            snap={snap}
            mode="manage"
            query={query}
            catFilter={catFilter}
            onOpenDef={(d) => navigate(`/editor/${encodeURIComponent(d.id)}`)}
            onDuplicate={(d) => run("복제", () => PS.duplicateDef(d.id)).then((ok) => ok && pushToast("정의를 복제했어요"))}
            onDelete={onDelete}
            onDefaults={setDefaultsFor}
            onToggleDefault={(d, enabled) =>
              run("기본 적용 변경", () => PS.putDef({ ...d, defaults: { ...d.defaults, enabled }, updatedAtMs: Date.now() })).then(
                (ok) => ok && pushToast(enabled ? `${d.displayName} — 새 지갑에 기본 적용돼요` : `${d.displayName} — 새 지갑 기본 적용을 껐어요`),
              )
            }
            onRenamePackage={renamePackage}
            onDeletePackage={removePackage}
            onPublishPackage={publishPackage}
            onMoveDef={moveDef}
          />
        )}
        <div className="ev2-lefthint">정책을 끌어다 패키지에 놓으면 소속이 바뀌어요 — 지갑 적용은 <b>지갑별 정책</b> 탭에서.</div>
      </div>

      <PublishModal open={publishSrc !== null} source={publishSrc} onClose={() => setPublishSrc(null)} />

      {defaultsFor && (
        <DefDefaultsModal
          def={defaultsFor}
          packages={Object.values(snap.library.packages)}
          onCancel={() => setDefaultsFor(null)}
          onSave={(enabled, packageId) => {
            run("기본값 저장", () => PS.putDef({ ...defaultsFor, defaults: { ...defaultsFor.defaults, enabled, packageId }, updatedAtMs: Date.now() })).then(
              (ok) => ok && pushToast("기본값을 저장했어요"),
            );
            setDefaultsFor(null);
          }}
        />
      )}
    </div>
  );
}

Object.assign(window, { EditorListPageV2, LibraryTab });
