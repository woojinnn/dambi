// @ts-nocheck
import * as React from "react";

import * as PS from "./mockStore";
import { pushToast } from "./shell";
import { navigate } from "./nav";
import {
  ShieldIcon, XIcon, TrashIcon, PlusIcon, CaretRightIcon, PackageIcon, PencilIcon, CopyIcon, CheckIcon,
  CatIcon, catKey, catLabel, famStyle, sevLabel, mtimeLabel,
} from "./icons";

/* ── derive helpers (shared) ── */
export function defUsageCount(snap, defId) {
  let n = 0;
  for (const w of Object.values(snap.wallets.byAddress)) {
    if (Object.values(w.bindings).some((b) => b.defId === defId)) n += 1;
  }
  return n;
}
export function packageDisplayOn(packageOn, activeBindings) {
  return packageOn && activeBindings > 0;
}
export const DRAG_DEF_MIME = "application/x-dambi-def-id";
export const SOURCE_LABEL = { builtin: "내장", mine: "내 정책", market: "Policy Hub" };

/** run(label, fn): await, toast on failure. */
export async function run(label, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`[${label}]`, err);
    pushToast(`${label}에 실패했어요`);
    return false;
  }
}

/* ════════════════════ New Policy Chooser ════════════════════ */
export function dashboardId(slug) {
  return "def::" + slug;
}
export function seedCedar(id) {
  return `// @id("${id}")\nforbid (\n  principal,\n  action,\n  resource\n);`;
}
const CHOOSER_CARDS = [
  {
    key: "llm",
    accent: "sage",
    title: "LLM으로 만들기",
    summary: "원하는 규칙을 한국어로 설명하면 LLM이 폼 정책 초안을 만들어줘요 · 생성 후 폼에서 확인·수정.",
    rec: "빠르게 초안부터",
    pros: ["자연어로 설명만", "폼으로 변환·검증"],
    cons: ["초안은 검토 필요", "OpenAI 키 필요"],
    preview: "llm",
  },
  {
    key: "form",
    accent: "cyan",
    title: "폼으로 만들기",
    summary: "가장 쉬움 · 흔한 정책(forbid + AND) · .cedar와 manifest 자동 생성 · 임계값만 바꾸면 끝.",
    rec: "처음·표준 정책",
    pros: ["round-trip 안전망", "cedar·manifest 자동", "인라인 값 편집"],
    cons: ["복잡한 정책(OR·중첩 등)은 폼으로 안 열릴 수 있어요"],
    preview: "form",
  },
  {
    key: "cedar",
    accent: "slate",
    title: "Cedar로 만들기",
    summary: "코드 직접 작성 · 최대 자유, 가드 최소 · 폼 안전망 밖 · 숙련자용.",
    rec: "Cedar를 아는 사람",
    pros: ["최대 자유", "manifest 직접 관리"],
    cons: ["가드 최소", "폼 안전망 밖"],
    preview: "cedar",
  },
];
function ChooserPreview({ kind }) {
  if (kind === "llm") {
    return (
      <div className="ev2-mpc-prev llm">
        <div className="prompt"><span className="spark">✦</span><span className="ln l1" /><span className="ln l2" /></div>
        <div className="and">↓</div>
        <div className="row"><span className="cap" /><span className="fld" /><span className="op">&gt;</span><span className="val">150</span></div>
      </div>
    );
  }
  if (kind === "form") {
    return (
      <div className="ev2-mpc-prev form">
        <div className="row"><span className="cap" /><span className="fld" /><span className="op">&gt;</span><span className="val">150</span></div>
        <div className="and">AND</div>
        <div className="row"><span className="cap" /><span className="fld w2" /><span className="op">≠</span><span className="val ref">self</span></div>
      </div>
    );
  }
  return (
    <div className="ev2-mpc-prev cedar">
      <div className="ln"><span className="g" /><span className="t kw" /></div>
      <div className="ln"><span className="g" /><span className="t" /></div>
      <div className="ln"><span className="g" /><span className="t guard" /></div>
      <div className="ln"><span className="g" /><span className="t s" /></div>
    </div>
  );
}
export function NewPolicyChooser({ open, onClose, defaultScope, defaultWallet }) {
  if (!open) return null;
  const pick = (method) => {
    const stamp = Date.now().toString(36);
    const slug = `new-${method}-${stamp}`;
    const id = dashboardId(slug);
    const initialTab = method === "llm" ? "llm" : undefined;
    const realMethod = method === "cedar" ? "cedar" : "form";
    onClose();
    navigate(`/editor/${encodeURIComponent(id)}`, {
      state: { newPolicy: { method: realMethod, cedarText: seedCedar(slug), displayName: "새 정책", defaultScope: defaultScope || null, defaultWallet: defaultWallet || null, ...(initialTab ? { initialTab } : {}) } },
    });
  };
  return (
    <div className="ev2-modal-bd" role="dialog" aria-modal onClick={onClose}>
      <div className="ev2-mpc" onClick={(e) => e.stopPropagation()}>
        <div className="ev2-mpc-h">
          <div>
            <div className="t">새 정책 만들기</div>
            <div className="s">어떤 방식으로 시작할지 고르세요. 둘 다 같은 Cedar로 저장되고, 나중에 다른 방식으로도 볼 수 있어요 (폼은 단순한 정책만).</div>
          </div>
          <button type="button" className="ev2-mpc-x" onClick={onClose} aria-label="닫기"><XIcon /></button>
        </div>
        <div className="ev2-mpc-grid">
          {CHOOSER_CARDS.map((c) => (
            <button key={c.key} type="button" className={`ev2-mpc-card ${c.accent}`} onClick={() => pick(c.key)}>
              <div className="ev2-mpc-card-top">
                <span className="ev2-mpc-ic"><ShieldIcon /></span>
                <span className="ev2-mpc-title">{c.title}</span>
              </div>
              <ChooserPreview kind={c.preview} />
              <div className="ev2-mpc-summary">{c.summary}</div>
              <div className="ev2-mpc-rec"><span className="lbl">추천</span>{c.rec}</div>
              <div className="ev2-mpc-pc">
                <ul className="pros">{c.pros.map((p, i) => (<li key={i}><CheckIcon />{p}</li>))}</ul>
                <ul className="cons">{c.cons.map((p, i) => (<li key={i}><XIcon />{p}</li>))}</ul>
              </div>
              <span className="ev2-mpc-go">이 방식으로 시작<CaretRightIcon /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════ Library Directory ════════════════════ */
export function LibraryDirectory(props) {
  const { snap, mode, query, catFilter, onOpenDef, onDuplicate, onDelete, onDefaults, onToggleDefault, onRenamePackage, onDeletePackage, onPublishPackage, onMoveDef } = props;
  const [collapsed, setCollapsed] = React.useState(new Set());
  const [dropTarget, setDropTarget] = React.useState(null);
  const [renaming, setRenaming] = React.useState(null);
  const [draftName, setDraftName] = React.useState("");
  const UNCAT = PS.UNCATEGORIZED_PKG;

  const packages = React.useMemo(
    () => Object.values(snap.library.packages).sort((a, b) => (a.id === UNCAT ? 1 : b.id === UNCAT ? -1 : a.id.localeCompare(b.id))),
    [snap],
  );
  const byFolder = React.useMemo(() => {
    const m = new Map();
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

  const toggleFolder = (id) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const filtering = query.trim().length > 0 || catFilter !== "all";

  const allPkgs = packages.some((p) => p.id === UNCAT) ? packages : [...packages, { id: UNCAT, displayName: "미분류" }];

  return (
    <div className={`ld${mode === "pick" ? " pick" : ""}`}>
      {allPkgs.map((pkg) => {
        const defs = byFolder.get(pkg.id) || [];
        if (filtering && defs.length === 0) return null;
        if (pkg.id === UNCAT && defs.length === 0 && !filtering) return null;
        const open = !collapsed.has(pkg.id);
        const locked = pkg.id === UNCAT;
        return (
          <div
            key={pkg.id}
            className={`ld-folder is-pkg${dropTarget === pkg.id ? " droptarget" : ""}`}
            onDragOver={(e) => {
              if (mode === "manage" && onMoveDef && e.dataTransfer.types.includes(DRAG_DEF_MIME)) {
                e.preventDefault();
                setDropTarget(pkg.id);
              }
            }}
            onDragLeave={() => setDropTarget((t) => (t === pkg.id ? null : t))}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const defId = e.dataTransfer.getData(DRAG_DEF_MIME);
              if (defId && onMoveDef) onMoveDef(defId, pkg.id);
            }}
          >
            <div className="ld-folderhead" onClick={() => toggleFolder(pkg.id)}>
              <span className={`ld-caret${open ? " open" : ""}`}><CaretRightIcon /></span>
              <PackageIcon className="ld-pkgico" />
              {renaming === pkg.id ? (
                <input
                  autoFocus
                  value={draftName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    setRenaming(null);
                    onRenamePackage && onRenamePackage(pkg, draftName);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span className="nm">{pkg.displayName}</span>
              )}
              <span className="cnt">{defs.length}</span>
              {mode === "manage" && (
                <span className="acts" onClick={(e) => e.stopPropagation()}>
                  {onPublishPackage && !locked && (
                    <button type="button" className="ev2-iconbtn" title="이 패키지를 Policy Hub에 올리기" onClick={() => onPublishPackage(pkg)}><ShieldIcon /></button>
                  )}
                  {onRenamePackage && !locked && (
                    <button type="button" className="ev2-iconbtn" title="이름 변경" onClick={() => { setRenaming(pkg.id); setDraftName(pkg.displayName); }}><PencilIcon /></button>
                  )}
                  {onDeletePackage && !locked && (
                    <button type="button" className="ev2-iconbtn danger" title="삭제" onClick={() => onDeletePackage(pkg)}><TrashIcon /></button>
                  )}
                </span>
              )}
            </div>
            {open && (
              <div className="ld-defs">
                {defs.length === 0 && <div className="ld-empty">비어 있어요</div>}
                {defs.map((d) => {
                  const cat = catKey(d.cat);
                  const usage = defUsageCount(snap, d.id);
                  return (
                    <div
                      key={d.id}
                      className="ld-def"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_DEF_MIME, d.id);
                        e.dataTransfer.effectAllowed = mode === "manage" ? "move" : "copy";
                      }}
                      onClick={() => onOpenDef && onOpenDef(d)}
                    >
                      <span className="pol-ic" style={famStyle(d.cat).tile} title={catLabel(cat)}><CatIcon cat={d.cat} /></span>
                      <span className="pol-main">
                        <span className="pol-nm">{d.displayName}</span>
                        <span className={`pol-desc${d.doc && d.doc.definition ? "" : " add"}`}>{d.doc && d.doc.definition ? d.doc.definition : "설명 추가"}</span>
                      </span>
                      {sevLabel(d.skeleton.model.severity) && <span className={`pol-sev ${d.skeleton.model.severity}`}>{sevLabel(d.skeleton.model.severity)}</span>}
                      <span className="ld-src">{SOURCE_LABEL[d.source]}</span>
                      {mode === "manage" && (
                        <>
                          <span className="ld-meta">{usage > 0 ? `지갑 ${usage}` : ""}</span>
                          <button
                            type="button"
                            className={`ld-defaultchip${d.defaults.enabled ? " on" : ""}`}
                            title="앞으로 추가되는 지갑에 이 정책을 기본으로 적용할지 — 클릭해서 전환"
                            onClick={(e) => { e.stopPropagation(); onToggleDefault(d, !d.defaults.enabled); }}
                          >
                            {d.defaults.enabled ? "새 지갑 기본 적용" : "새 지갑 적용 안 함"}
                          </button>
                          <span className="ld-meta time">{mtimeLabel(d.updatedAtMs)}</span>
                          <span className="acts" onClick={(e) => e.stopPropagation()}>
                            <button type="button" className="ev2-iconbtn" title="기본값 설정" onClick={() => onDefaults(d)}><PencilIcon /></button>
                            <button type="button" className="ev2-iconbtn" title="복제" onClick={() => onDuplicate(d)}><CopyIcon /></button>
                            {d.source !== "builtin" && (
                              <button type="button" className="ev2-iconbtn danger" title="삭제" onClick={() => onDelete(d)}><TrashIcon /></button>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════ DefDefaults Modal ════════════════════ */
export function DefDefaultsModal({ def, packages, onCancel, onSave }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const [enabled, setEnabled] = React.useState(def.defaults.enabled);
  const [packageId, setPackageId] = React.useState(def.defaults.packageId || UNCAT);
  const pkgList = packages.some((p) => p.id === UNCAT) ? packages : [{ id: UNCAT, displayName: "미분류" }, ...packages];
  return (
    <div className="ptm-bd" role="dialog" aria-modal onClick={onCancel}>
      <div className="ptm" onClick={(e) => e.stopPropagation()}>
        <div className="ptm-h">
          <div className="ptm-t">기본값 설정</div>
          <div className="ptm-s"><b>{def.displayName}</b> — 앞으로 추가되는 지갑에 어떻게 적용할까요?</div>
        </div>
        <div className="ptm-opts">
          <label className="ptm-field">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            새 지갑에 기본으로 적용
          </label>
          <label className="ptm-field">
            소속 패키지
            <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              {pkgList.map((p) => (<option key={p.id} value={p.id}>{p.displayName}</option>))}
            </select>
          </label>
          <div className="ptm-row">
            <button type="button" className="ev2-sec" onClick={onCancel}>취소</button>
            <button type="button" className="ev2-pri" onClick={() => onSave(enabled, packageId === UNCAT ? undefined : packageId)}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}
