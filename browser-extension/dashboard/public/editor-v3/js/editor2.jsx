/* ════════════════════════════════════════════════════════════════════════
 * Editor2View — 지갑별 정책 v2 (라이브러리 뼈대 → 패키지 카드 드래그 적용)
 * 확장(dashboard) editor/v2/Editor2View.tsx 의 충실 포팅. 좌: 라이브러리 뼈대
 * (드래그 소스), 우: 이 지갑의 패키지 카드(플립 → 바인딩 토글/삭제). 뼈대를
 * 카드에 끌어다 놓으면 별칭·값을 채워 적용(bindDef). 폴더를 통째로 끌면 일괄 적용.
 * ════════════════════════════════════════════════════════════════════════ */

/* ── 인라인 아이콘 (sprite 의존 없음) ── */
const E2_ICONS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  chev: <path d="m6 9 6 6 6-6" />,
  grip: <g stroke="none" fill="currentColor"><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" /></g>,
  flip: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  shield: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z" /></>,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  box: <><path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></>,
  check: <path d="M5 12l5 5L20 6" />,
  warn: <><path d="M12 3l9.5 16.5h-19z" /><path d="M12 10v4M12 17.5v.5" /></>,
  block: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  eye: <><path d="M2 12s3.6-6.8 10-6.8S22 12 22 12s-3.6 6.8-10 6.8S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></>,
  pin: <><path d="M9 3h6M10 3v5l-2.5 4h9L14 8V3M12 16v5" /></>,
};
function Ic({ id, cls }) {
  return <svg className={`ic ${cls || ""}`.trim()} viewBox="0 0 24 24" aria-hidden="true">{E2_ICONS[id]}</svg>;
}

/* ── 데이터 helpers (포팅 모델: binding.modelOverride 사용) ── */
function e2BaseModel(def) {
  // 실제 백엔드 def 는 skeleton.ir 만 있고 model 이 없을 수 있다. 없으면 안전한
  // 빈 모델을 돌려 모달이 깨지지 않게 한다(조건은 못 보여줘도 적용은 가능).
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
  if (!base) return undefined; // 안전망 — base 가 없으면 override 없음
  const finalModel = { ...(edited || base), severity };
  const baseJson = JSON.stringify({ ...base, severity: base.severity });
  const editedJson = JSON.stringify({ ...finalModel, id: base.id });
  return editedJson !== baseJson ? { ...finalModel, id: base.id } : undefined;
}

/* ─────────────── 진입점: 지갑 선택 + 워크스페이스 ─────────────── */
// 라이브러리 뼈대에서 끌고 있는 항목 — 레스(말풍선)와 패키지 카드가 공유하는 드래그 페이로드.
let e2Drag = null;
// 지갑 별명(label) — 부모 대시보드가 localStorage("dambi_wallet_labels")에 기록한다
// (ps2 스냅샷엔 라벨이 없음). 같은 origin이라 공유된다.
function readWalletLabels() {
  try { return JSON.parse(localStorage.getItem("dambi_wallet_labels") || "{}"); } catch (e) { return {}; }
}
function Editor2View({ onNewPolicy }) {
  const snap = useOverview();
  // 부모가 라벨을 늦게 써도 반영되도록 storage 이벤트로 갱신.
  const [labelRev, setLabelRev] = React.useState(0);
  React.useEffect(() => {
    const on = (e) => { if (!e || e.key === "dambi_wallet_labels") setLabelRev((r) => r + 1); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const rows = React.useMemo(() => {
    const labels = readWalletLabels();
    return Object.keys(snap.wallets.byAddress).sort().map((address) => ({ address, label: labels[address.toLowerCase()] || undefined }));
  }, [snap, labelRev]);
  const [addr, setAddr] = React.useState(null);
  const rowAddrs = React.useMemo(() => new Set(rows.map((r) => r.address)), [rows]);
  const activeAddr = (addr && rowAddrs.has(addr) ? addr : null) || rows[0]?.address || null;
  // 위 카드에서 누른 패키지 — 누른 순서대로 쌓임(최근이 맨 앞). 두 패널 공유.
  const [lensOrder, setLensOrder] = React.useState([]);
  const lensPkg = lensOrder[0] || null;
  const setLensPkg = (id) => setLensOrder((prev) => (id == null ? prev : [id, ...prev.filter((x) => x !== id)]));
  // 고정핀 패키지 — 아래 “이 지갑의 패키지”에서 상단 고정. 두 패널 공유.
  const [pinnedPkgs, setPinnedPkgs] = React.useState(() => new Set());
  const togglePin = (id) => setPinnedPkgs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  React.useEffect(() => { setPinnedPkgs(new Set()); }, [activeAddr]);
  // 전체 보기(allview) — 두 패널 공유(라이브러리 오프셋 해제용).
  const [viewAll, setViewAll] = React.useState(false);
  React.useEffect(() => { setViewAll(false); }, [activeAddr]);
  React.useEffect(() => { setLensOrder([]); }, [activeAddr]);

  // 렌즈 헤더의 “마켓플레이스에 올리기” — 해당 패키지를 게시 모달로.
  const [lensPublish, setLensPublish] = React.useState(null);
  const requestPublishPkg = (pkgId) => {
    const w = snap.wallets.byAddress[activeAddr] || { bindings: {}, packages: {} };
    const defs = [...new Map(
      Object.values(w.bindings).filter((b) => b.packageId === pkgId).map((b) => [b.defId, snap.library.defs[b.defId]])
    ).values()].filter(Boolean);
    if (defs.length === 0) { pushToast("이 패키지에 든 정책이 없어요"); return; }
    const name = pkgId === PS.UNCATEGORIZED_PKG ? "개별" : (w.packages?.[pkgId]?.displayName ?? pkgId);
    const plan = Cedar.publishMembersFromDefs(defs);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setLensPublish({ kind: "package", suggestedDisplayName: name, suggestedSlug: pkgId.replace(/^pkg::/, ""), members: plan.members });
  };

  // 렌즈(말풍선)에 라이브러리 뼈대를 끌어놓으면 — 해당 패키지에 적용(카드 드롭과 동일한 모달).
  const dropWal = snap.wallets.byAddress[activeAddr] || { bindings: {}, packages: {} };
  const dropWalName = (pid) => (pid === PS.UNCATEGORIZED_PKG ? "개별" : (dropWal.packages?.[pid]?.displayName ?? pid));
  const dropInPkg = (defId, pid) => Object.values(dropWal.bindings).some((b) => b.packageId === pid && b.defId === defId);
  const [dropApply, setDropApply] = React.useState(null);
  const onDropApply = (pkgId) => {
    const d = e2Drag; e2Drag = null;
    if (!d) return;
    if (d.kind === "folder") return setDropApply({ kind: "folder", pkgId, name: d.name, defs: d.defs });
    if (dropInPkg(d.def.id, pkgId)) return pushToast("이미 이 패키지에 들어 있어요");
    setDropApply({ kind: "def", pkgId, def: d.def });
  };

  if (rows.length === 0) {
    return (
      <div className="e2">
        <div className="muted" style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>등록된 지갑이 없습니다</div>
          <div style={{ marginTop: 4 }}>확장 popup에서 지갑을 추가하면 여기에서 정책을 적용할 수 있어요.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="e2">
      <div className="wbar rise">
        <WalletRail rows={rows} snap={snap} activeAddr={activeAddr} onSelect={setAddr} lensPkg={lensPkg} onLens={setLensPkg} pinnedPkgs={pinnedPkgs} onTogglePin={togglePin} viewAll={viewAll} onViewAll={setViewAll} onPublishPkg={requestPublishPkg} onDropApply={onDropApply} />
      </div>

      {activeAddr && <E2Workspace key={activeAddr} snap={snap} address={activeAddr} onNewPolicy={onNewPolicy} lensPkg={lensPkg} lensOrder={lensOrder} pinnedPkgs={pinnedPkgs} viewAll={viewAll} onLens={setLensPkg} />}
      <PublishModal open={lensPublish !== null} source={lensPublish} onClose={() => setLensPublish(null)} />
      {dropApply?.kind === "def" && (
        <E2ApplyModal def={dropApply.def} pkgId={dropApply.pkgId} pkgName={dropWalName(dropApply.pkgId)} address={activeAddr} onClose={() => setDropApply(null)} />
      )}
      {dropApply?.kind === "folder" && (
        <E2FolderApplyModal folderName={dropApply.name} pkgId={dropApply.pkgId} pkgName={dropWalName(dropApply.pkgId)} address={activeAddr} defs={dropApply.defs} isInPackage={(defId) => dropInPkg(defId, dropApply.pkgId)} onClose={() => setDropApply(null)} />
      )}
    </div>
  );
}

/* 지갑 레일 — 가로로 늘어선 지갑 카드를 좌우로 끌어 넘기고, 탭하면 선택. */
function WalletRail({ rows, snap, activeAddr, onSelect, lensPkg, onLens, pinnedPkgs, onTogglePin, viewAll, onViewAll, onPublishPkg, onDropApply }) {
  const ref = React.useRef(null);
  const lensOpen = lensPkg != null;
  const setViewAll = onViewAll;
  const [lensDrop, setLensDrop] = React.useState(false);
  const [backDrop, setBackDrop] = React.useState(null);

  // 활성(강조) 지갑을 레일 가운데로 부드럽게 가져온다 — 새로고침/전환 모두.
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
        const delta = (cRect.left - eRect.left) - (el.clientWidth - cRect.width) / 2;
        if (Math.abs(delta) > 2) el.scrollBy({ left: delta, behavior: "smooth" });
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [activeAddr, viewAll]);
  // 탭: 전체보기면 고른 지갑에 집중 / 작업 지갑 → 카드 뒤집기(이 지갑의 패키지 요약) / 흐린 옆 지갑 → 전환.
  const [flipped, setFlipped] = React.useState(false);
  React.useEffect(() => { setFlipped(false); }, [activeAddr]);
  const tap = (address) => {
    if (viewAll) { onSelect(address); setViewAll(false); return; }
    if (address === activeAddr) {
      const next = !flipped;
      setFlipped(next);
      if (!next) onLens(null); // 앞면으로 돌아가면 옆 말풍선도 같이 닫기
    } else onSelect(address);
  };


  const statOf = (address) => {
    const w = snap.wallets.byAddress[address] || { bindings: {}, packages: {}, packageEnabled: {} };
    const active = Object.values(w.bindings).filter((b) => PS.isEffectiveOn(w, b)).length;
    const pkgs = Object.keys(w.packages || {}).length;
    return { active, pkgs };
  };

  // 렌즈(망원경) — "이 지갑의 패키지"에서 누른 패키지 하나를 확대해 그 정책들을 펼친다.
  const wallet = snap.wallets.byAddress[activeAddr] || { bindings: {}, packages: {}, packageEnabled: {} };
  const lensData = React.useMemo(() => {
    if (lensPkg == null) return null;
    const UNCAT = PS.UNCATEGORIZED_PKG;
    const name = lensPkg === UNCAT ? "개별" : (wallet.packages?.[lensPkg]?.displayName ?? lensPkg);
    const desc = lensPkg === UNCAT
      ? "어떤 패키지에도 묶이지 않고 개별로 적용된 정책들이에요."
      : (wallet.packages?.[lensPkg]?.desc ?? "");
    const members = Object.values(wallet.bindings)
      .filter((b) => b.packageId === lensPkg)
      .sort((a, b) => (snap.library.defs[a.defId]?.displayName ?? "").localeCompare(snap.library.defs[b.defId]?.displayName ?? "", "ko"));
    return { id: lensPkg, name, desc, members };
  }, [lensPkg, snap, wallet]);

  // 카드 뒷면 — 이 지갑의 실제 패키지(제목·정책 수). 누르면 렌즈로 확대.
  const backPkgs = React.useMemo(() => {
    const UNCAT = PS.UNCATEGORIZED_PKG;
    const countBy = {};
    for (const b of Object.values(wallet.bindings)) countBy[b.packageId] = (countBy[b.packageId] || 0) + 1;
    const list = Object.values(wallet.packages || {})
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"))
      .map((p) => ({ id: p.id, name: p.displayName, count: countBy[p.id] || 0, enabled: wallet.packageEnabled?.[p.id] ?? true }));
    if (countBy[UNCAT]) list.push({ id: UNCAT, name: "개별", count: countBy[UNCAT], enabled: wallet.packageEnabled?.[UNCAT] ?? true });
    return list;
  }, [wallet]);

  // 렌즈 패키지 이름 변경(인라인).
  const lensIsUncat = lensPkg === PS.UNCATEGORIZED_PKG;
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  React.useEffect(() => { setRenaming(false); }, [lensPkg]);
  const startRename = () => { setDraftName(lensData?.name ?? ""); setRenaming(true); };
  const commitRename = () => {
    setRenaming(false);
    const t = draftName.trim();
    const pkg = wallet.packages?.[lensPkg];
    if (!pkg || !t || t === pkg.displayName) return;
    run("이름 변경", () => PS.putWalletPackage({ address: activeAddr, pkg: { id: lensPkg, displayName: t, ...(pkg.desc ? { desc: pkg.desc } : {}) } }));
  };

  return (
    <div className="wrail-wrap">
      {rows.length > 1 && (
        <div className="wrail-top">
          <button type="button" className="wrail-all-sm" onClick={() => setViewAll((v) => !v)} title="모든 지갑 한 번에 보기">
            {viewAll ? "한 지갑만 보기" : `전체 ${rows.length}개 보기`}
          </button>
        </div>
      )}
      <div className={`wrail ${viewAll ? "allview" : "focused"}`} ref={ref}>
      {rows.map((r) => {
        const on = r.address === activeAddr;
        const av = (r.label?.[0] ?? r.address.slice(2, 3)).toUpperCase();
        const s = statOf(r.address);
        return (
          <button
            key={r.address}
            type="button"
            data-address={r.address}
            aria-pressed={on}
            title={on ? (flipped ? "닫기" : "한 번 더 누르면 이 지갑의 패키지 요약") : "이 지갑으로 전환"}
            className={`wrail-card${on ? " on" : ""}${on && flipped ? " flipped" : ""}`}
            onClick={() => tap(r.address)}
          >
            <span className="wrc-flip">
              <span className="wrc-face wrc-front">
                <span className="wrc-top">
                  <span className="wrc-av">{av}</span>
                  <span className="wrc-pill"><span className="dot" />지갑</span>
                </span>
                <span className="wrc-name">{r.label ?? shortAddr(r.address)}</span>
                <span className="wrc-addr">{r.address.slice(0, 8)} ·· {r.address.slice(-4)}</span>
                <span className="wrc-foot">
                  <span className="wrc-lbl">적용</span>
                  <span className="wrc-val"><span className="on">활성 {s.active}</span> · 패키지 {s.pkgs}</span>
                </span>
              </span>
              <span className="wrc-face wrc-back">
                <span className="wrc-back-head"><Ic id="box" cls="sm" />이 지갑의 패키지 <b>{backPkgs.length}</b></span>
                <span className="wrc-back-list scroll">
                  {backPkgs.length === 0 ? (
                    <span className="wrc-back-empty">아직 패키지가 없어요</span>
                  ) : [...backPkgs].sort((a, b) => (pinnedPkgs.has(b.id) ? 1 : 0) - (pinnedPkgs.has(a.id) ? 1 : 0)).map((p) => (
                    <span
                      role="button"
                      tabIndex={0}
                      className={`wrc-back-row${p.id === lensPkg ? " on" : ""}${backDrop === p.id ? " dropping" : ""}${pinnedPkgs.has(p.id) ? " pinned" : ""}`}
                      key={p.id}
                      title="누르면 아래 패키지에서 강조 · 정책·폴더를 끌어다 놓으면 이 패키지에 추가"
                      onClick={(e) => { e.stopPropagation(); onLens(p.id); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setBackDrop(p.id); }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setBackDrop((v) => (v === p.id ? null : v)); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setBackDrop(null); onDropApply(p.id); }}
                    >
                      <span className="nm">{p.name}</span>
                      <span role="button" tabIndex={0} className={`wrc-back-pin${pinnedPkgs.has(p.id) ? " on" : ""}`} title={pinnedPkgs.has(p.id) ? "고정 해제" : "아래 패키지에서 상단 고정"} onClick={(e) => { e.stopPropagation(); onTogglePin(p.id); }}><Ic id="pin" cls="sm" /></span>
                      <label className="sw sm wrc-back-sw" title={p.enabled ? "이 지갑에서 끄기" : "이 지갑에서 켜기"} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={p.enabled} onChange={() => run("패키지 켜기/끄기", () => PS.setPackageEnabled({ address: activeAddr, packageId: p.id, enabled: !p.enabled }))} />
                        <span className="trk" />
                      </label>
                    </span>
                  ))}
                </span>
              </span>
            </span>
          </button>
        );
      })}

      {/* 망원경 — "이 지갑의 패키지"에서 누른 패키지 하나를 확대해 정책을 펼친다. 라이브러리 뼈대 드롭 대상. */}
      <div
        className={`wlens-scope${lensDrop ? " dropping" : ""}`}
        aria-hidden={!lensOpen}
        onDragOver={(e) => { if (lensData) { e.preventDefault(); setLensDrop(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setLensDrop(false); }}
        onDrop={(e) => { e.preventDefault(); setLensDrop(false); if (lensData) onDropApply(lensData.id); }}
      >
        <div className="wlens-inner">
          {lensData && (
            <>
              <div className="wlens-head">
                <span className="wlens-scope-ic"><Ic id="box" cls="sm" /></span>
                {renaming && !lensIsUncat ? (
                  <input
                    className="wlens-rename"
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setDraftName(lensData.name); setRenaming(false); } }}
                  />
                ) : (
                  <span className="t" title={lensData.name}>{lensData.name}</span>
                )}
                {!lensIsUncat && (
                  <>
                    <button type="button" className="ib xs" title="패키지 이름 변경" onClick={startRename}><Ic id="edit" cls="sm" /></button>
                    {lensData.members.length > 0 && (
                      <button type="button" className="ib xs" title="마켓플레이스(Policy Hub)에 올리기" onClick={() => onPublishPkg(lensData.id)}><Ic id="shield" cls="sm" /></button>
                    )}
                  </>
                )}
                <span className="s">정책 {lensData.members.length}</span>
                <button type="button" className="wlens-x" title="닫기" onClick={() => onLens(null)}><Ic id="x" cls="sm" /></button>
              </div>
              {lensData.desc && <div className="wlens-desc">{lensData.desc}</div>}
              <div className="wlens-pols scroll">
                {lensData.members.length === 0 ? (
                  <div className="sgempty" style={{ gridColumn: "1 / -1", margin: "auto" }}>이 패키지에 정책이 없어요</div>
                ) : (
                  lensData.members.map((b) => {
                    const d = snap.library.defs[b.defId];
                    const nm = b.alias ?? d?.displayName ?? b.defId;
                    return (
                      <div
                        key={b.id}
                        className={`wlens-pol${b.enabled ? "" : " off"}`}
                        draggable={!!d}
                        onDragStart={() => { if (d) e2Drag = { kind: "def", def: d }; }}
                      >
                        <span className="dot" style={{ background: catStyle(catKey(d?.cat)).hex }} />
                        <span
                          className="nm"
                          title="이 지갑 인스턴스 편집 — 값을 바꾸면 이 지갑에만 적용돼요"
                          style={{ cursor: "pointer" }}
                          onClick={() => navigate(`/editor/${encodeURIComponent(b.defId)}?wallet=${activeAddr}&binding=${encodeURIComponent(b.id)}`)}
                        >{nm}</span>
                        <button
                          type="button"
                          className={`ox${b.enabled ? " on" : ""}`}
                          title={b.enabled ? "이 정책 끄기 (제외)" : "이 정책 켜기 (포함)"}
                          aria-label={b.enabled ? "정책 끄기" : "정책 켜기"}
                          onClick={() => run("토글", () => PS.updateBinding({ address: activeAddr, bindingId: b.id, patch: { enabled: !b.enabled } }))}
                        >
                          <Ic id={b.enabled ? "check" : "x"} />
                        </button>
                        <button type="button" className="ib danger" title="이 패키지에서 제거" onClick={async () => { if (await e2Confirm({ title: `"${nm}" 정책을 이 패키지에서 뺄까요?`, body: "이 지갑에서 더는 적용되지 않아요. (정책 자체는 라이브러리에 남아요)", danger: true, confirmLabel: "제거" })) run("제거", () => PS.removeBinding({ address: activeAddr, bindingId: b.id })); }}><Ic id="trash" cls="sm" /></button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

function WalletStats({ wallet }) {
  const active = Object.values(wallet.bindings).filter((b) => PS.isEffectiveOn(wallet, b)).length;
  const pkgs = Object.keys(wallet.packages || {}).length;
  return (
    <>
      <span className="wstat"><span className="dot" style={{ background: "var(--sage)" }} />활성 {active}</span>
      <span className="wsep" />
      <span className="wstat" style={{ color: "var(--mut)" }}>패키지 {pkgs}</span>
    </>
  );
}

/* ─────────────── 워크스페이스 ─────────────── */
function E2Workspace({ snap, address, onNewPolicy, lensPkg, lensOrder, pinnedPkgs, viewAll, onLens }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const wallet = snap.wallets.byAddress[address] || { bindings: {}, packages: {}, packageEnabled: {} };
  const walletPkgName = (pid) => (pid === UNCAT ? "개별" : wallet.packages?.[pid]?.displayName ?? pid);

  /* 좌측: 라이브러리 뼈대 */
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(new Set());
  const searching = query.trim() !== "";
  const dragRef = React.useRef(null);

  // 아래 영역 — 정책 읽기 전용 미리보기 (패키지 안 정책 클릭)
  const [previewId, setPreviewId] = React.useState(null);
  const previewBinding = previewId ? wallet.bindings?.[previewId] : null;
  React.useEffect(() => { if (previewId && !wallet.bindings?.[previewId]) setPreviewId(null); }, [wallet, previewId]);

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

  const folders = React.useMemo(() => {
    const seen = new Set();
    const list = Object.values(snap.library.packages)
      .filter((p) => p.id !== UNCAT && !seen.has(p.id) && seen.add(p.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko") || a.id.localeCompare(b.id))
      .map((p) => ({ id: p.id, displayName: p.displayName }));
    // 개별(미분류)은 비어 있어도 항상 표시 — 끌어다 놓을 고정 영역으로 둔다.
    list.push({ id: UNCAT, displayName: "개별 템플릿", locked: true });
    return list;
  }, [snap, defsByFolder]);

  const matchQuery = (d) => !searching || d.displayName.toLowerCase().includes(query.trim().toLowerCase());
  const toggleFolder = (id) =>
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  /* 우측: 이 지갑의 패키지 */
  const membersByPkg = React.useMemo(() => {
    const m = new Map();
    for (const b of Object.values(wallet.bindings)) { const arr = m.get(b.packageId) || []; arr.push(b); m.set(b.packageId, arr); }
    return m;
  }, [wallet]);
  const pkgCountByDef = React.useMemo(() => {
    const m = new Map();
    for (const b of Object.values(wallet.bindings)) { const s = m.get(b.defId) || new Set(); s.add(b.packageId); m.set(b.defId, s); }
    return m;
  }, [wallet]);
  const packages = React.useMemo(() => {
    const list = [
      // 개별(미분류) 카드는 비어 있어도 항상 표시 — 고정 드롭 영역.
      { id: UNCAT, displayName: "개별" },
      ...Object.values(wallet.packages || {}).slice().sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")).map((p) => ({ id: p.id, displayName: p.displayName, desc: p.desc })),
    ];
    // 위 지갑 카드에서 고른 패키지를 맨 위로 올려 “같은 것”임을 강조.
    // 고정된 패키지를 최상단으로, 그 다음 위 카드에서 고른 순서대로.
    const pins = pinnedPkgs || new Set();
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

  /* 동작 */
  // FLIP — 패키지 순서가 바뀌면 모든 카드가 새 위치로 부드럽게 미끄러진다(띡 끊김 제거).
  const gridRef = React.useRef(null);
  const prevRects = React.useRef(new Map());
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
            { duration: 460, easing: "cubic-bezier(.22,.9,.28,1)" },
          );
        }
      }
    });
    const m = new Map();
    cards.forEach((row) => m.set(row.getAttribute("data-pkgid"), row.getBoundingClientRect()));
    prevRects.current = m;
  }, [packages]);

  const togglePackage = (pkgId, members, displayedOn) =>
    run("패키지 토글", async () => {
      if (displayedOn) return PS.setPackageEnabled({ address, packageId: pkgId, enabled: false });
      await PS.setPackageEnabled({ address, packageId: pkgId, enabled: true });
      if (members.length > 0 && !members.some((b) => b.enabled)) {
        for (const b of members) await PS.updateBinding({ address, bindingId: b.id, patch: { enabled: true } });
      }
    });
  const createPackage = () =>
    run("패키지 생성", () => PS.putWalletPackage({ address, pkg: { id: `pkg::${crypto.randomUUID()}`, displayName: "새 패키지" } })).then((ok) => ok && pushToast("패키지를 만들었어요 — 이름을 바꿔보세요"));
  const renamePackage = (pkgId, name) => {
    const pkg = wallet.packages?.[pkgId];
    const trimmed = name.trim();
    if (!pkg || !trimmed || trimmed === pkg.displayName) return;
    run("이름 변경", () => PS.putWalletPackage({ address, pkg: { id: pkgId, displayName: trimmed, ...(pkg.desc ? { desc: pkg.desc } : {}) } }));
  };
  const savePackageDesc = (pkgId, desc) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const d = desc.trim();
    if ((pkg.desc ?? "") === d) return;
    run("설명 저장", () => PS.putWalletPackage({ address, pkg: { id: pkgId, displayName: pkg.displayName, ...(d ? { desc: d } : {}) } }));
  };
  const removePackage = (pkgId) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const n = Object.values(wallet.bindings).filter((b) => b.packageId === pkgId).length;
    setConfirmAsk({
      title: `"${pkg.displayName}" 패키지를 이 지갑에서 제거할까요?`,
      body: `안의 정책 인스턴스 ${n}개도 함께 제거돼요. (라이브러리의 폴더·정책은 그대로예요)`,
      danger: true,
      onConfirm: () => run("패키지 제거", () => PS.removeWalletPackage({ address, packageId: pkgId })).then((ok) => ok && pushToast("이 지갑에서 패키지를 제거했어요")),
    });
  };
  const isInPackage = (defId, pkgId) => (membersByPkg.get(pkgId) || []).some((b) => b.defId === defId);

  /* 라이브러리 폴더 관리 */
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const createLibFolder = (name) =>
    run("폴더 생성", () => PS.putPackage({ id: `pkg::${crypto.randomUUID()}`, displayName: name.trim() || "새 폴더", source: "mine", updatedAtMs: Date.now() })).then((ok) => ok && pushToast("폴더를 만들었어요 — 이름을 바꿔보세요"));

  const [folderDrop, setFolderDrop] = React.useState(null);
  const moveDefToLibFolder = (defId, folderId) => {
    const d = snap.library.defs[defId];
    if (!d) return;
    const next = folderId === UNCAT ? undefined : folderId;
    if ((d.defaults.packageId ?? undefined) === next) return;
    const folderName = folderId === UNCAT ? "개별" : snap.library.packages[folderId]?.displayName ?? folderId;
    run("폴더 이동", () => PS.putDef({ ...d, defaults: { ...d.defaults, packageId: next }, updatedAtMs: Date.now() })).then((ok) => ok && pushToast(`${d.displayName} → ${folderName}`));
  };
  const renameLibFolder = (id) => {
    const pkg = snap.library.packages[id];
    if (!pkg) return;
    const name = window.prompt("이름 변경", pkg.displayName);
    const t = name && name.trim();
    if (!t || t === pkg.displayName) return;
    run("이름 변경", () => PS.putPackage({ ...pkg, displayName: t, updatedAtMs: Date.now() }));
  };
  const deleteLibFolder = (id) => {
    const pkg = snap.library.packages[id];
    if (!pkg) return;
    setConfirmAsk({ title: `폴더 "${pkg.displayName}"를 삭제할까요?`, body: "안의 정책은 '개별'로 이동해요.", danger: true, onConfirm: () => run("폴더 삭제", () => PS.deletePackage(id)).then((ok) => ok && pushToast("폴더를 삭제했어요")) });
  };
  const onDeleteDef = (d) => {
    const uses = Object.values(snap.wallets.byAddress).reduce((n, w) => n + Object.values(w.bindings).filter((b) => b.defId === d.id).length, 0);
    setConfirmAsk({ title: `정책 "${d.displayName}"을(를) 라이브러리에서 삭제할까요?`, body: uses > 0 ? `${uses}개 지갑에서 함께 제거됩니다.` : "", danger: true, onConfirm: () => run("정책 삭제", () => PS.deleteDef(d.id)).then((ok) => ok && pushToast("정책을 삭제했어요")) });
  };

  /* 발행 */
  const [publishSrc, setPublishSrc] = React.useState(null);
  const publishLibFolder = (id, name) => {
    const members = Object.values(snap.library.defs).filter((d) => !d.hidden && (d.defaults.packageId || UNCAT) === id);
    if (members.length === 0) return pushToast("이 패키지에 든 정책이 없어요");
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
    if (defs.length === 0) return pushToast("이 패키지에 든 정책이 없어요");
    const plan = Cedar.publishMembersFromDefs(defs);
    if (plan.unsupported.length > 0) return Cedar.rejectUnsupportedPublish(plan.unsupported);
    setPublishSrc({ kind: "package", suggestedDisplayName: walletPkgName(pkgId), suggestedSlug: pkgId.replace(/^pkg::/, ""), members: plan.members });
  };

  /* 드롭(적용) 모달 */
  const [apply, setApply] = React.useState(null);
  const [folderApply, setFolderApply] = React.useState(null);
  const [confirmAsk, setConfirmAsk] = React.useState(null);
  const onCardDrop = (pkgId) => {
    const d = e2Drag;
    e2Drag = null;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "folder") return setFolderApply({ pkgId, name: d.name, defs: d.defs });
    if (isInPackage(d.def.id, pkgId)) return pushToast("이미 이 패키지에 들어 있어요");
    setApply({ pkgId, def: d.def });
  };

  // 연필(구조 편집) — 액션·조건을 바꾸는 건 구조 변경이라, 새 정책으로 포크하고
  // 기존 정책은 이 패키지에서 대체한다(편집기에서 경고 후 저장).
  const forkBinding = (b) => {
    const def = snap.library.defs[b.defId];
    if (!def) return;
    navigate(`/editor/${encodeURIComponent(def.id)}?wallet=${address}&binding=${encodeURIComponent(b.id)}`);
  };

  return (
    <div className={`cols${viewAll ? " allview-on" : ""}`}>
      {/* LEFT — 라이브러리 뼈대 */}
      <aside className="skel rise">
        <div className="skel-top">
          <div className="skel-label"><Ic id="box" cls="sm" />라이브러리</div>
          <div className="skel-actions">
            <button type="button" className="e2-mini" onClick={() => setNewFolderOpen(true)}><Ic id="folder" cls="sm" />새 폴더</button>
            <button type="button" className="e2-mini" onClick={onNewPolicy}><Ic id="plus" cls="sm" />새 정책</button>
          </div>
          <div className="searchbox">
            <Ic id="search" cls="sm" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="정책 검색…" />
          </div>
        </div>

        <div className="skel-body scroll">
          {Object.values(snap.library.defs).filter((d) => !d.hidden).length === 0 ? (
            <div className="pb-empty" style={{ padding: "26px 14px" }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>아직 정책 뼈대가 없어요</div>
              <div style={{ marginTop: 4 }}>위 “+ 새 정책”으로 첫 정책을 만들어 보세요.</div>
            </div>
          ) : (
            folders.map((f) => {
              const all = defsByFolder.get(f.id) || [];
              const shown = all.filter(matchQuery);
              if (shown.length === 0 && searching) return null;
              const open = searching || expanded.has(f.id);
              return (
                <div key={f.id} className={`sgroup${open ? "" : " collapsed"}${f.locked ? " uncat" : ""}${f.id && f.id.indexOf("pkg::builtin.") === 0 ? " builtin" : ""}`}>
                  <div
                    className={`sghead${folderDrop === f.id ? " droptarget" : ""}`}
                    draggable={!f.locked}
                    onClick={() => toggleFolder(f.id)}
                    onDragStart={() => { if (!f.locked) { dragRef.current = { kind: "folder", name: f.displayName, defs: all }; e2Drag = dragRef.current; } }}
                    onDragOver={(e) => { if (dragRef.current?.kind === "def") { e.preventDefault(); setFolderDrop(f.id); } }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFolderDrop((p) => (p === f.id ? null : p)); }}
                    onDrop={(e) => { e.preventDefault(); setFolderDrop(null); const d = dragRef.current; dragRef.current = null; if (d?.kind === "def") moveDefToLibFolder(d.def.id, f.id); }}
                  >
                    <Ic id="chev" cls="sm e2cv" />
                    <Ic id={f.locked ? "inbox" : "folder"} cls="sm" />
                    <span className="nm">{f.displayName}</span>
                    {f.locked ? (
                      <>
                        <span className="cnt">{all.length}</span>
                        <span className="uncat-tag" title="아직 어떤 폴더에도 넣지 않은 개별 정책 뼈대예요. 폴더로 끌어다 정리할 수 있어요.">폴더 없음</span>
                      </>
                    ) : (
                      <>
                        <span className="cnt">{all.length}</span>
                        <span className="facts" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="ib xs" title="게시" onClick={() => publishLibFolder(f.id, f.displayName)}><Ic id="shield" cls="sm" /></button>
                          <button type="button" className="ib xs" title="이름 변경" onClick={() => renameLibFolder(f.id)}><Ic id="edit" cls="sm" /></button>
                          <button type="button" className="ib xs danger" title="삭제" onClick={() => deleteLibFolder(f.id)}><Ic id="trash" cls="sm" /></button>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="sgbody">
                    {shown.map((d) => {
                      const usedIn = pkgCountByDef.get(d.id)?.size ?? 0;
                      return (
                        <div key={d.id} className="sitem" draggable onDragStart={() => { dragRef.current = { kind: "def", def: d }; e2Drag = dragRef.current; }}>
                          <span className="nm" title={d.displayName}>{d.displayName}</span>
                          <span className="end">
                            <span className={`pkgcnt${usedIn === 0 ? " zero" : ""}`} title={`이 지갑의 ${usedIn}개 패키지에 적용됨`}>
                              <Ic id="box" cls="sm" />{usedIn}
                            </span>
                            {d.source !== "builtin" && (
                              <span className="acts">
                                <button type="button" className="ib xs" title="정책 뼈대 수정 (라이브러리)" onClick={() => navigate(`/editor/${encodeURIComponent(d.id)}`)}><Ic id="edit" cls="sm" /></button>
                                <button type="button" className="ib xs" title="Policy Hub에 올리기" onClick={() => publishDef(d)}><Ic id="shield" cls="sm" /></button>
                                <button type="button" className="ib xs danger" title="삭제" onClick={() => onDeleteDef(d)}><Ic id="trash" cls="sm" /></button>
                              </span>
                            )}
                            <Ic id="grip" cls="sm grip" />
                          </span>
                        </div>
                      );
                    })}
                    {shown.length === 0 && <div className="sgempty">비어 있어요 — 정책을 끌어다 이 폴더로 넣으세요.</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="skel-foot"><Ic id="grip" cls="sm" />정책·폴더를 패키지 카드나 위 말풍선에 끌어 적용 (폴더는 통째로)</div>
      </aside>

      {/* RIGHT — 패키지 카드 */}
      <section>
        <div className="pkhead">
          <span className="t">이 지갑의 패키지</span>
          <span className="s">카드를 누르면 위 망원경에서 확대해 정책을 봐요 · “관리”로 편집</span>
        </div>
        {packages.length === 0 ? (
          <div className="pb-empty" style={{ padding: "40px 16px", maxWidth: 520 }}>이 지갑에 패키지가 없어요 — “새 패키지”로 만들고 왼쪽 뼈대를 끌어다 채워보세요.</div>
        ) : (
          <div className="pgrid stagger" ref={gridRef}>
            {packages.map((pkg) => (
              <E2PackageCard
                key={pkg.id}
                pkg={pkg}
                highlighted={pkg.id === lensPkg}
                pinned={pinnedPkgs?.has(pkg.id)}
                wallet={wallet}
                snap={snap}
                members={membersByPkg.get(pkg.id) || []}
                address={address}
                onToggle={togglePackage}
                onRename={renamePackage}
                onSaveDesc={savePackageDesc}
                onRemove={removePackage}
                onPublish={publishPackage}
                onDrop={onCardDrop}
                previewId={previewId}
                onPreviewBinding={(bindId) => setPreviewId((cur) => (cur === bindId ? null : bindId))}
                onForkBinding={forkBinding}
                onOpenBinding={(defId, bindId) => navigate(`/editor/${encodeURIComponent(defId)}?wallet=${address}&binding=${encodeURIComponent(bindId)}`)}
              />
            ))}
            <button type="button" className="addpkg" onClick={createPackage}>
              <span className="pl"><Ic id="plus" cls="lg" /></span>
              <span className="t">새 패키지</span>
            </button>
          </div>
        )}
      </section>

      {apply && (
        <E2ApplyModal
          def={apply.def}
          pkgId={apply.pkgId}
          pkgName={walletPkgName(apply.pkgId)}
          address={address}
          onClose={() => setApply(null)}
        />
      )}
      {folderApply && (
        <E2FolderApplyModal
          folderName={folderApply.name}
          pkgId={folderApply.pkgId}
          pkgName={walletPkgName(folderApply.pkgId)}
          address={address}
          defs={folderApply.defs}
          isInPackage={(defId) => isInPackage(defId, folderApply.pkgId)}
          onClose={() => setFolderApply(null)}
        />
      )}
      <PublishModal open={publishSrc !== null} source={publishSrc} onClose={() => setPublishSrc(null)} />
      {newFolderOpen && <E2NewFolderModal onClose={() => setNewFolderOpen(false)} onCreate={(name) => { createLibFolder(name); setNewFolderOpen(false); }} />}
      {confirmAsk && <E2ConfirmModal {...confirmAsk} onCancel={() => setConfirmAsk(null)} />}
    </div>
  );
}

/* ─────────────── 새 폴더 모달 ─────────────── */
function E2ConfirmModal({ title, body, danger, confirmLabel, onConfirm, onCancel }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter") { onCancel(); onConfirm(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);
  return (
    <div className="e2-ov" onMouseDown={onCancel}>
      <div className="modal e2cf" onMouseDown={(e) => e.stopPropagation()}>
        <div className="e2cf-body">
          <div className="e2cf-title">{title}</div>
          {body && <div className="e2cf-text">{body}</div>}
        </div>
        <div className="e2cf-foot">
          <button type="button" className="e2cf-btn cancel" onClick={onCancel}>취소</button>
          <button type="button" className={`e2cf-btn ok${danger ? " danger" : ""}`} autoFocus onClick={() => { onCancel(); onConfirm(); }}>{confirmLabel || "확인"}</button>
        </div>
      </div>
    </div>
  );
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
  const submit = () => { if (name.trim()) onCreate(name); };
  return (
    <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 420 }}>
        <div className="m-head">
          <span className="m-ic folder"><Ic id="folder" cls="lg" /></span>
          <div className="m-title-wrap">
            <div className="m-h-title">새 폴더 만들기</div>
            <div className="m-title-hint">정책 뼈대를 정리할 폴더 이름을 정하세요.</div>
          </div>
          <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}><Ic id="x" cls="sm" /></button>
        </div>
        <div className="m-body" style={{ paddingTop: 4 }}>
          <input ref={inputRef} className="m-title" style={{ width: "100%", margin: 0 }} value={name} placeholder="예: 브릿지 가드" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="m-foot">
          <button type="button" className="lk" onClick={onClose}>취소</button>
          <button type="button" className="btn sage" disabled={!name.trim()} onClick={submit}>만들기</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 패키지 행 (한 줄 = 한 패키지, 플립 없이 펼침) ─────────────── */
function E2PackageCard({ pkg, wallet, snap, members, address, highlighted, pinned, onToggle, onRename, onSaveDesc, onRemove, onPublish, onDrop, previewId, onPreviewBinding, onForkBinding, onOpenBinding }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const rowRef = React.useRef(null);
  const [drop, setDrop] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState(pkg.displayName);
  const [draftDesc, setDraftDesc] = React.useState(pkg.desc ?? "");
  React.useEffect(() => setDraftDesc(pkg.desc ?? ""), [pkg.desc]);

  const locked = pkg.id === UNCAT;
  const isDefaultPack = pkg.displayName === "기본 안전팩"; // 기본값 안전팩 — 읽기 전용(눈 아이콘만)
  const empty = members.length === 0;
  const activeN = members.filter((b) => PS.isEffectiveOn(wallet, b)).length;
  const displayedOn = packageDisplayOn(wallet.packageEnabled[pkg.id] ?? true, members.filter((b) => b.enabled).length);
  const defOf = (b) => snap.library.defs[b.defId];

  return (
    <div
      ref={rowRef}
      data-pkgid={pkg.id}
      className={`prow${drop ? " drop" : ""}${locked ? " uncat" : ""}${isDefaultPack ? " builtin" : ""}${highlighted ? " lensed" : ""}${pinned ? " pinned" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrop(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(false); }}
      onDrop={(e) => { e.preventDefault(); setDrop(false); onDrop(pkg.id); }}
    >
      <div className="prow-head">
        <span className={`pf-ic${empty && !locked ? " empty" : ""}`}><Ic id={locked ? "inbox" : "box"} /></span>
        {renaming && !locked ? (
          <input
            className="prow-rename"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => { setRenaming(false); onRename(pkg.id, draftName); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setDraftName(pkg.displayName); setRenaming(false); } }}
          />
        ) : (
          <span className="prow-nm" title={pkg.displayName}>{pkg.displayName}</span>
        )}
        {locked && <span className="uncat-tag">패키지 없음</span>}
        {pinned && <span className="prow-pin" title="상단 고정됨"><Ic id="pin" cls="sm" /></span>}
        <span className="prow-cnt">정책 {members.length}{!empty && <>{" · "}<span className="on">활성 {activeN}</span></>}</span>
        <span className="prow-actions">
          {!locked && !isDefaultPack && (
            <>
              <button type="button" className="ib" title="이름 변경" onClick={() => { setDraftName(pkg.displayName); setRenaming(true); }}><Ic id="edit" cls="sm" /></button>
              {!empty && <button type="button" className="ib" title="이 패키지를 Policy Hub에 게시" onClick={() => onPublish(pkg.id, members)}><Ic id="shield" cls="sm" /></button>}
              <button type="button" className="ib danger" title="패키지 삭제" onClick={() => onRemove(pkg.id)}><Ic id="trash" cls="sm" /></button>
            </>
          )}
        </span>
      </div>

      {!locked && !isDefaultPack && (
        <input
          className="prow-desc"
          value={draftDesc}
          placeholder="이 패키지가 무엇을 막는지 간단히 적어보세요"
          title="설명"
          onChange={(e) => setDraftDesc(e.target.value)}
          onBlur={() => onSaveDesc(pkg.id, draftDesc)}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { setDraftDesc(pkg.desc ?? ""); e.target.blur(); } }}
        />
      )}

      <div className="prow-pols">
        {empty ? (
          <div className="pb-empty">비어 있음 — 왼쪽 라이브러리에서 정책·폴더를 끌어다 놓으세요</div>
        ) : (
          members.map((b) => (
            <E2BindingItem key={b.id} binding={b} def={defOf(b)} address={address} readOnly={isDefaultPack} onOpen={() => onOpenBinding(b.defId, b.id)} onFork={() => onForkBinding(b)} />
          ))
        )}
      </div>
    </div>
  );
}

/* 카드 뒷면 바인딩 한 줄 — 토글(on/off)·제거·열기. */
function E2BindingItem({ binding: b, def, address, selected, readOnly, onPreview, onOpen, onFork }) {
  const cat = catKey(def?.cat);
  const name = b.alias ?? def?.displayName ?? b.defId;
  return (
    <div
      className={`pb-item${b.enabled ? "" : " off"}${readOnly ? " ro" : ""}`}
      title={readOnly ? "기본 안전팩 정책 — 수정 불가 (켜고 끄기만 가능)" : "누르면 이 지갑 값 수정 (구조는 읽기 전용)"}
      onClick={readOnly ? undefined : onOpen}
    >
      <span className="nm">{name}</span>
      <button type="button" className={`pb-check${b.enabled ? " on" : ""}`} title={b.enabled ? "적용됨 — 끄기" : "꺼짐 — 켜기"} onClick={(e) => { e.stopPropagation(); run("토글", () => PS.updateBinding({ address, bindingId: b.id, patch: { enabled: !b.enabled } })); }}>
        {b.enabled && <Ic id="check" cls="sm" />}
      </button>
      {!readOnly && <button type="button" className="ib" title="구조 편집 — 액션·조건을 바꾸면 새 정책으로 저장돼요" onClick={(e) => { e.stopPropagation(); onFork(); }}><Ic id="edit" cls="sm" /></button>}
      {!readOnly && <button type="button" className="ib danger" title="이 패키지에서 제거" onClick={async (e) => { e.stopPropagation(); if (await e2Confirm({ title: `"${name}" 정책을 이 패키지에서 뺄까요?`, body: "이 지갑에서 더는 적용되지 않아요. (정책 자체는 라이브러리에 남아요)", danger: true, confirmLabel: "제거" })) run("제거", () => PS.removeBinding({ address, bindingId: b.id })); }}><Ic id="trash" cls="sm" /></button>}
      <E2PolicyPreview hover binding={b} def={def} displayName={name} />
    </div>
  );
}

/* ─────────────── 단일 정책 적용 모달 ─────────────── */
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
    const finalAlias = aliasTrim && aliasTrim !== def.displayName ? aliasTrim : undefined;
    // 실제 ps2 bind 는 modelOverride 를 받지 않는다. 정책의 심각도/구조는 def 를
    // 그대로 상속하고, 여기선 적용(별칭만 옵션)만 한다. (값 채우기=params 는 추후)
    const ok = await run("정책 적용", () =>
      PS.bindDef({ defId: def.id, packageId: pkgId, addresses: [address], ...(finalAlias ? { alias: finalAlias } : {}) }),
    );
    if (ok) { pushToast(`${finalAlias ?? def.displayName} → ${pkgName}`); onClose(); }
  };

  return (
    <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="m-head">
          <span className="m-ic"><Ic id="warn" cls="lg" /></span>
          <div className="m-title-wrap">
            <div className="m-eye">정책 · {pkgName}에 추가</div>
            <input ref={titleRef} className="m-title" value={alias} onChange={(e) => setAlias(e.target.value)} />
            <div className="m-title-hint">제목을 바꾸면 이 지갑에서 부를 이름이 돼요.</div>
          </div>
          <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}><Ic id="x" cls="sm" /></button>
        </div>
        <div className="m-sub">값을 확인하고 필요하면 바꿔주세요. 빈 칸은 채워야 적용돼요.</div>
        <div className="m-body scroll">
          <PolicyFormPane
            key={def.id}
            initialModel={base}
            initialManifest={def.skeleton.manifest}
            valuesOnly
            compact
            severityValue={severity}
            onSeverityChange={(s) => setSeverity(s)}
            onValidity={(v) => setValid(v.valid)}
            onChange={({ model }) => setEdited(model)}
          />
        </div>
        <div className="m-foot">
          <button type="button" className="lk" onClick={onClose}><Ic id="back" cls="sm" />이전</button>
          <button type="button" className="btn sage" disabled={!valid} onClick={() => void submit()}>받기</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 폴더 일괄 적용 모달 (선택 → 값 채우기 탭) ─────────────── */
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
      if (validMap[d.id] === false) { setStep(2); setValIdx(i); pushToast(`값을 먼저 채워주세요: ${d.displayName}`); return; }
    }
    const ok = await run("정책 적용", async () => {
      for (const d of checkedDefs) {
        if (isInPackage(d.id)) continue;
        // 실제 ps2 bind 는 modelOverride 미지원 — def 상속으로 적용.
        await PS.bindDef({ defId: d.id, packageId: pkgId, addresses: [address] });
      }
    });
    if (ok) { pushToast(`${folderName} → ${pkgName}`); onClose(); }
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
    return (
      <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <div className="m-head">
            <span className="m-ic folder"><Ic id="folder" cls="lg" /></span>
            <div className="m-title-wrap">
              <div className="m-eye">폴더 적용 · {pkgName}에 추가</div>
              <div className="m-h-title">{folderName} 폴더</div>
              <div className="m-title-hint">선택한 정책들을 한 번에 적용해요.</div>
            </div>
            <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}><Ic id="x" cls="sm" /></button>
          </div>
          <div className="m-sub" style={{ paddingBottom: 8 }}>
            <span className="f-allrow">{checkedCount}개 정책 · <span className="need">값 필요</span> 는 다음 단계에서 채워요.</span>
          </div>
          <div className="m-body">
            <div className="f-list">
              {defs.map((d) => {
                const inPkg = isInPackage(d.id);
                return (
                  <label key={d.id} className="f-item" style={inPkg ? { opacity: 0.55 } : undefined}>
                    <input type="checkbox" checked={!!checked[d.id]} onChange={() => setChecked((c) => ({ ...c, [d.id]: !c[d.id] }))} />
                    <span className="dot" style={{ background: catStyle(catKey(d.cat)).hex }} />
                    <span className="nm">{d.displayName}</span>
                    {inPkg ? (
                      <span className="need" style={{ color: "var(--mut)", background: "#eef1ef" }}>이미 이 패키지에 들어 있어요</span>
                    ) : (
                      e2NeedsValues(d) && <span className="need">값 필요</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="m-foot">
            <button type="button" className="lk" onClick={onClose}><Ic id="x" cls="sm" />닫기</button>
            <button type="button" className="btn sage" disabled={checkedCount === 0} onClick={next}>
              {valDefs.length > 0 ? "다음 →" : `${checkedCount}개 적용`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const active = valDefs[Math.min(valIdx, valDefs.length - 1)];
  return (
    <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="m-head">
          <span className="m-ic"><Ic id="warn" cls="lg" /></span>
          <div className="m-title-wrap">
            <div className="m-eye">값 채우기 · {pkgName}에 추가</div>
            <div className="m-h-title">{active?.displayName}</div>
            <div className="m-title-hint">탭에서 정책을 골라 값을 채워요.</div>
          </div>
          <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}><Ic id="x" cls="sm" /></button>
        </div>
        <div className="f-tabs">
          {valDefs.map((d, i) => (
            <button key={d.id} type="button" className={`f-tab${i === valIdx ? " on" : ""}`} title={d.displayName} onClick={() => setValIdx(i)}>
              <span className="dot" style={{ background: catStyle(catKey(d.cat)).hex }} />{d.displayName}
            </button>
          ))}
        </div>
        <div className="m-sub" style={{ paddingTop: 8 }}>탭에서 정책을 골라 값을 확인·수정해요. 빈 칸은 채워야 적용돼요.</div>
        <div className="m-body scroll">
          {active && (
            <PolicyFormPane
              key={active.id}
              initialModel={edited[active.id] ?? baseModels[active.id]}
              initialManifest={active.skeleton.manifest}
              valuesOnly
              compact
              severityValue={sevMap[active.id] ?? "warn"}
              onSeverityChange={(s) => setSevMap((m) => ({ ...m, [active.id]: s }))}
              onValidity={(v) => setValidMap((m) => ({ ...m, [active.id]: v.valid }))}
              onChange={({ model }) => setEdited((m) => ({ ...m, [active.id]: model }))}
            />
          )}
        </div>
        <div className="m-foot">
          <button type="button" className="lk" onClick={() => setStep(1)}><Ic id="back" cls="sm" />정책 선택으로</button>
          <button type="button" className="btn sage" onClick={() => void applyAll()}>받기</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Editor2View, Ic: Ic });
