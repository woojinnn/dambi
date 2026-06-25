import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bindDef,
  deleteDef,
  deletePackage,
  getOverview,
  isEffectiveOn,
  missingRequiredHoles,
  putDef,
  putPackage,
  putWalletPackage,
  removeBinding,
  removeWalletPackage,
  setPackageEnabled,
  updateBinding,
  UNCATEGORIZED_PKG,
  type Binding,
  type HoleSpec,
  type HoleValue,
  type PolicyDef,
  type StoreSnapshot,
  type WalletPolicyState,
} from "../../../server-api/policy-store";
import { listWallets } from "../../../server-api/wallets";
import { getDashboardSummary } from "../../../server-api/dashboard";
import { useProvisionWallets } from "../../use-provision-wallets";
import { deriveWalletRows, packageDisplayOn } from "./wallet-policies-derive";
import { collectPackageMembers } from "../publish-package";
import { PublishModal, type PublishSource } from "../PublishModal";
import { toMarketCategory } from "../../market-domain";
import { blocksToText } from "../../../cedar";
import type { PolicyIR } from "../../../cedar/blocks";
import { catKey, catStyle } from "./categories";
import { PolicyFormPane } from "./PolicyFormPane";
import { irToForm, type FormModel } from "../../../cedar/form";
import { diffParamValues } from "../../../cedar/form/parameterize";
import { concretizeIr } from "../../../cedar/blocks";
import "./editor2.css";

/**
 * /editor · "지갑별 정책 v2" 탭 — editor-redesign/editor.html 디자인을 실제 ps2
 * 정책 스토어에 연결한 워크스페이스. 좌: 라이브러리 뼈대(드래그 소스), 우: 이
 * 지갑의 패키지 카드(뒤집어 바인딩 토글/삭제). 뼈대를 카드에 끌어다 놓으면
 * 별칭·값을 채워 적용(bindDef). 폴더를 통째로 끌면 일괄 적용.
 *
 * 데이터·동작은 WalletPoliciesView 와 동일한 ps2 API 를 쓴다 — 화면만 새 디자인.
 */

/* ─────────────── 아이콘 (인라인 — sprite/<use> 의존 없음) ─────────────── */
const ICON_PATHS: Record<string, JSX.Element> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  chev: <path d="m6 9 6 6 6-6" />,
  grip: (
    <g stroke="none" fill="currentColor">
      <circle cx="9" cy="6" r="1.3" />
      <circle cx="15" cy="6" r="1.3" />
      <circle cx="9" cy="12" r="1.3" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="9" cy="18" r="1.3" />
      <circle cx="15" cy="18" r="1.3" />
    </g>
  ),
  flip: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v5h-5" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  trash: (
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z" />
    </>
  ),
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  box: (
    <>
      <path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ),
  check: <path d="M5 12l5 5L20 6" />,
  warn: (
    <>
      <path d="M12 3l9.5 16.5h-19z" />
      <path d="M12 10v4M12 17.5v.5" />
    </>
  ),
};

function Ic({ id, cls = "" }: { id: string; cls?: string }) {
  return (
    <svg className={`ic ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      {ICON_PATHS[id]}
    </svg>
  );
}

/* ─────────────── hole(파라미터) 직렬화 helper ─────────────── */
function holeToStr(v: HoleValue | undefined): string {
  if (v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object" && v !== null && "field" in v) return v.field;
  return String(v);
}
function strToHole(type: HoleSpec["type"], raw: string): HoleValue {
  switch (type) {
    case "addressSet":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    case "long": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case "bool":
      return raw === "true";
    case "field":
      return { field: raw };
    default:
      return raw;
  }
}
function initDraft(def: PolicyDef): Record<string, string> {
  const d: Record<string, string> = {};
  for (const h of def.holes ?? []) d[h.name] = holeToStr((def.defaults.params ?? {})[h.name]);
  return d;
}
function buildParams(def: PolicyDef, draft: Record<string, string>): Record<string, HoleValue> {
  const merged: Record<string, HoleValue> = { ...(def.defaults.params ?? {}) };
  for (const h of def.holes ?? []) {
    const raw = (draft[h.name] ?? "").trim();
    if (raw === "") {
      if (!(h.name in (def.defaults.params ?? {}))) delete merged[h.name];
      continue;
    }
    merged[h.name] = strToHole(h.type, raw);
  }
  return merged;
}

/** def 의 폼 모델 — 기본값(defaults.params)을 적용한 구체 IR 기준. valuesOnly
 *  값 시트의 초기 모델이자, 폼으로 못 여는 정책이면 null(→ 원시 hole 입력으로 폴백). */
function baseFormModel(def: PolicyDef): FormModel | null {
  try {
    const ir = concretizeIr(def.skeleton.ir as PolicyIR, (def.defaults.params ?? {}) as never);
    return irToForm(ir);
  } catch {
    return null;
  }
}
/** 편집 결과 → 이 바인딩에 저장할 파라미터(템플릿 기본값과 달라진 leaf 만). */
function paramsFromEdit(def: PolicyDef, edited: FormModel | null): Record<string, HoleValue> {
  let tpl: FormModel | null = null;
  try {
    tpl = irToForm(def.skeleton.ir as PolicyIR);
  } catch {
    tpl = null;
  }
  if (!tpl || !edited) return {};
  return diffParamValues(tpl, edited);
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

type RunFn = (label: string, fn: () => Promise<unknown>) => Promise<boolean>;

type DragPayload =
  | { kind: "def"; def: PolicyDef }
  | { kind: "folder"; name: string; defs: PolicyDef[] }
  | null;

/* ─────────────── 진입점: 지갑 선택 + 워크스페이스 ─────────────── */
export function Editor2View(props: { onToast: (text: string) => void; onNewPolicy: () => void }) {
  const { onToast, onNewPolicy } = props;
  const { t } = useTranslation("editor");
  const qc = useQueryClient();

  const walletsQ = useQuery({ queryKey: ["wallets"], queryFn: listWallets });
  const overviewQ = useQuery({ queryKey: ["ps2-overview"], queryFn: getOverview });
  // 지갑 이름(label) — 대시보드 요약에서. 선택기에 주소 대신 이름으로 보여준다.
  const dashQ = useQuery({ queryKey: ["dashboard-summary"], queryFn: getDashboardSummary });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ps2-overview"] });

  useProvisionWallets(
    walletsQ.data ? walletsQ.data.map((w) => w.address) : null,
    overviewQ.data ?? null,
    invalidate,
  );

  const snap = overviewQ.data ?? null;
  const labelByAddr = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of dashQ.data?.wallets ?? []) if (w.label) m.set(w.address.toLowerCase(), w.label);
    return m;
  }, [dashQ.data]);
  const rows = useMemo(
    () =>
      snap
        ? deriveWalletRows(
            snap,
            (walletsQ.data ?? []).map((w) => ({
              address: w.address,
              label: labelByAddr.get(w.address.toLowerCase()),
            })),
          )
        : null,
    [snap, walletsQ.data, labelByAddr],
  );

  const [addr, setAddr] = useState<string | null>(null);
  const activeAddr = addr ?? rows?.[0]?.address ?? null;

  // 지갑 선택 커스텀 드롭다운 — 네이티브 select 대신 예쁘게.
  const [walletMenu, setWalletMenu] = useState(false);
  const wselRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!walletMenu) return;
    const onDown = (e: MouseEvent) => {
      if (wselRef.current && !wselRef.current.contains(e.target as Node)) setWalletMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setWalletMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [walletMenu]);

  if (overviewQ.isLoading || !rows || !snap) {
    return (
      <div className="e2">
        <div className="muted" style={{ padding: 24 }}>
          {t("common:loading")}
        </div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="e2">
        <div className="muted" style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("wallet.noWalletsTitle")}</div>
          <div style={{ marginTop: 4 }}>{t("wallet.noWalletsHint")}</div>
        </div>
      </div>
    );
  }

  const label = rows.find((r) => r.address === activeAddr)?.label;
  const avatarChar = (label?.[0] ?? activeAddr?.slice(2, 3) ?? "W").toUpperCase();

  return (
    <div className="e2">
      <div className="wbar rise">
        <div className="wsel-wrap" ref={wselRef}>
          <button
            type="button"
            className={`wsel${walletMenu ? " open" : ""}`}
            onClick={() => setWalletMenu((o) => !o)}
          >
            <span className="wav">{avatarChar}</span>
            <span className="nm">{label ?? (activeAddr ? shortAddr(activeAddr) : "")}</span>
            <Ic id="chev" cls="sm e2cv" />
          </button>
          {walletMenu && (
            <div className="wmenu" role="listbox">
              {rows.map((r) => {
                const on = r.address === activeAddr;
                const av = (r.label?.[0] ?? r.address.slice(2, 3)).toUpperCase();
                return (
                  <button
                    key={r.address}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`wmenu-item${on ? " on" : ""}`}
                    onClick={() => {
                      setAddr(r.address);
                      setWalletMenu(false);
                    }}
                  >
                    <span className="wmenu-av">{av}</span>
                    <span className="wmenu-nm">{r.label ?? shortAddr(r.address)}</span>
                    {on && <Ic id="check" cls="sm wmenu-ck" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {activeAddr && snap.wallets.byAddress[activeAddr] && (
          <WalletStats wallet={snap.wallets.byAddress[activeAddr]} />
        )}
      </div>

      {activeAddr && (
        <Workspace
          key={activeAddr}
          snap={snap}
          address={activeAddr}
          onToast={onToast}
          onNewPolicy={onNewPolicy}
          invalidate={invalidate}
        />
      )}
    </div>
  );
}

function WalletStats({ wallet }: { wallet: WalletPolicyState }) {
  const { t } = useTranslation("editor");
  const active = Object.values(wallet.bindings).filter((b) => isEffectiveOn(wallet, b)).length;
  const pkgs = Object.keys(wallet.packages ?? {}).length;
  return (
    <>
      <span className="wstat">
        <span className="dot" style={{ background: "var(--sage)" }} />
        {t("editor2.walletActive", { count: active })}
      </span>
      <span className="wsep" />
      <span className="wstat" style={{ color: "var(--mut)" }}>
        {t("editor2.walletPackages", { count: pkgs })}
      </span>
    </>
  );
}

/* ─────────────── 워크스페이스 ─────────────── */
function Workspace(props: {
  snap: StoreSnapshot;
  address: string;
  onToast: (text: string) => void;
  onNewPolicy: () => void;
  invalidate: () => void;
}) {
  const { snap, address, onToast, onNewPolicy, invalidate } = props;
  const { t } = useTranslation("editor");
  const navigate = useNavigate();
  const wallet: WalletPolicyState = snap.wallets.byAddress[address] ?? {
    bindings: {},
    packages: {},
    packageEnabled: {},
  };

  const run: RunFn = async (label, fn) => {
    try {
      await fn();
      invalidate();
      return true;
    } catch (err) {
      console.error(`[editor2] ${label} failed:`, err);
      onToast(t("actionFailed", { action: label }));
      return false;
    }
  };

  const walletPkgName = (pid: string) =>
    pid === UNCATEGORIZED_PKG ? t("editor2.uncatName") : (wallet.packages?.[pid]?.displayName ?? pid);

  /* ── 좌측: 라이브러리 뼈대 ── */
  const [query, setQuery] = useState("");
  // 기본은 모두 접힘. expanded 에 든 폴더만 펼친다(검색 중엔 강제로 펼침).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searching = query.trim() !== "";
  const dragRef = useRef<DragPayload>(null);

  // 비숨김 def 를 라이브러리 폴더(defaults.packageId)별로 묶는다.
  const defsByFolder = useMemo(() => {
    const m = new Map<string, PolicyDef[]>();
    for (const d of Object.values(snap.library.defs)) {
      if (d.hidden) continue;
      const raw = d.defaults.packageId;
      const key = raw && snap.library.packages[raw] ? raw : UNCATEGORIZED_PKG;
      const arr = m.get(key) ?? [];
      arr.push(d);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
    return m;
  }, [snap]);

  // 정렬된 라이브러리 폴더 목록 (미분류 맨 뒤). id 중복은 안전하게 제거하고
  // 이름 동률은 id 로 안정 정렬해 검색/지우기 후 순서가 흔들리지 않게 한다.
  const folders = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; displayName: string; locked?: boolean; builtin?: boolean }[] = Object.values(
      snap.library.packages,
    )
      .filter((p) => p.id !== UNCATEGORIZED_PKG && !seen.has(p.id) && seen.add(p.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko") || a.id.localeCompare(b.id))
      .map((p) => ({ id: p.id, displayName: p.displayName, builtin: p.source === "builtin" }));
    if (defsByFolder.has(UNCATEGORIZED_PKG))
      list.push({ id: UNCATEGORIZED_PKG, displayName: t("editor2.uncatName"), locked: true });
    return list;
  }, [snap, defsByFolder, t]);

  const matchQuery = (d: PolicyDef) =>
    !searching || d.displayName.toLowerCase().includes(query.trim().toLowerCase());

  const toggleFolder = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /* ── 우측: 이 지갑의 패키지 ── */
  const membersByPkg = useMemo(() => {
    const m = new Map<string, Binding[]>();
    for (const b of Object.values(wallet.bindings)) {
      const arr = m.get(b.packageId) ?? [];
      arr.push(b);
      m.set(b.packageId, arr);
    }
    return m;
  }, [wallet]);

  // def별 — 이 지갑에서 이 정책이 들어가 있는 서로 다른 패키지 수.
  const pkgCountByDef = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const b of Object.values(wallet.bindings)) {
      const s = m.get(b.defId) ?? new Set<string>();
      s.add(b.packageId);
      m.set(b.defId, s);
    }
    return m;
  }, [wallet]);

  const packages = useMemo(() => {
    const hasUncat = Object.values(wallet.bindings).some((b) => b.packageId === UNCATEGORIZED_PKG);
    const list: { id: string; displayName: string; desc?: string }[] = [
      ...(hasUncat ? [{ id: UNCATEGORIZED_PKG, displayName: t("editor2.uncatName") }] : []),
      ...Object.values(wallet.packages ?? {})
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"))
        .map((p) => ({ id: p.id, displayName: p.displayName, desc: p.desc })),
    ];
    return list;
  }, [wallet, t]);

  /* ── 동작 ── */
  const togglePackage = (pkgId: string, members: Binding[], displayedOn: boolean) =>
    void run(t("actions.togglePackage"), async () => {
      if (displayedOn) {
        await setPackageEnabled({ address, packageId: pkgId, enabled: false });
        return;
      }
      await setPackageEnabled({ address, packageId: pkgId, enabled: true });
      if (members.length > 0 && !members.some((b) => b.enabled)) {
        for (const b of members) {
          await updateBinding({ address, bindingId: b.id, patch: { enabled: true } });
        }
      }
    });

  const createPackage = () =>
    void run(t("actions.createPackage"), () =>
      putWalletPackage({
        address,
        pkg: { id: `pkg::${crypto.randomUUID()}`, displayName: t("wallet.newPackageName") },
      }),
    ).then((ok) => ok && onToast(t("wallet.packageCreatedToast")));

  const renamePackage = (pkgId: string, name: string) => {
    const pkg = wallet.packages?.[pkgId];
    const trimmed = name.trim();
    if (!pkg || !trimmed || trimmed === pkg.displayName) return;
    void run(t("actions.rename"), () =>
      putWalletPackage({
        address,
        pkg: { id: pkgId, displayName: trimmed, ...(pkg.desc ? { desc: pkg.desc } : {}) },
      }),
    );
  };

  // 패키지 설명 저장(이름 보존). 카드 앞면 설명란.
  const savePackageDesc = (pkgId: string, desc: string) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    const d = desc.trim();
    if ((pkg.desc ?? "") === d) return;
    void run(t("actions.rename"), () =>
      putWalletPackage({
        address,
        pkg: { id: pkgId, displayName: pkg.displayName, ...(d ? { desc: d } : {}) },
      }),
    );
  };

  const removePackage = (pkgId: string) => {
    const pkg = wallet.packages?.[pkgId];
    if (!pkg) return;
    if (snap.library.packages[pkgId]?.source === "builtin") return void onToast(t("list.builtinLocked"));
    const n = Object.values(wallet.bindings).filter((b) => b.packageId === pkgId).length;
    if (!window.confirm(t("wallet.removePackageConfirm", { name: pkg.displayName, count: n }))) return;
    void run(t("actions.removePackage"), () => removeWalletPackage({ address, packageId: pkgId })).then(
      (ok) => ok && onToast(t("wallet.packageRemovedToast")),
    );
  };

  const isInPackage = (defId: string, pkgId: string) =>
    (membersByPkg.get(pkgId) ?? []).some((b) => b.defId === defId);

  /* ── 라이브러리 폴더(정책 묶음) 관리 ── */
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const createLibFolder = (name: string) =>
    void run(t("actions.createFolder"), () =>
      putPackage({
        id: `pkg::${crypto.randomUUID()}`,
        displayName: name.trim() || t("list.newFolderName"),
        source: "mine",
        updatedAtMs: Date.now(),
      }),
    ).then((ok) => ok && onToast(t("list.folderCreatedToast")));

  // 정책(뼈대)을 라이브러리 폴더로 이동(왼쪽 폴더 헤더에 드롭). undefined = 미분류.
  const [folderDrop, setFolderDrop] = useState<string | null>(null);
  const moveDefToLibFolder = (defId: string, folderId: string) => {
    const d = snap.library.defs[defId];
    if (!d) return;
    if (d.source === "builtin") return void onToast(t("list.builtinLocked"));
    const next = folderId === UNCATEGORIZED_PKG ? undefined : folderId;
    if ((d.defaults.packageId ?? undefined) === next) return;
    const folderName =
      folderId === UNCATEGORIZED_PKG
        ? t("editor2.uncatName")
        : (snap.library.packages[folderId]?.displayName ?? folderId);
    void run(t("actions.moveFolder"), () =>
      putDef({ ...d, defaults: { ...d.defaults, packageId: next }, updatedAtMs: Date.now() }),
    ).then((ok) => ok && onToast(`${d.displayName} → ${folderName}`));
  };

  const renameLibFolder = (id: string) => {
    const pkg = snap.library.packages[id];
    if (!pkg) return;
    if (pkg.source === "builtin") return void onToast(t("list.builtinLocked"));
    const name = window.prompt(t("library.rename"), pkg.displayName)?.trim();
    if (!name || name === pkg.displayName) return;
    void run(t("actions.rename"), () =>
      putPackage({ ...pkg, displayName: name, updatedAtMs: Date.now() }),
    );
  };

  const deleteLibFolder = (id: string) => {
    const pkg = snap.library.packages[id];
    if (!pkg) return;
    if (pkg.source === "builtin") return void onToast(t("list.builtinLocked"));
    if (!window.confirm(t("list.deleteFolderConfirm", { name: pkg.displayName }))) return;
    void run(t("actions.deleteFolder"), () => deletePackage(id)).then(
      (ok) => ok && onToast(t("list.folderDeletedToast")),
    );
  };

  const onDeleteDef = (d: PolicyDef) => {
    if (d.source === "builtin") return void onToast(t("list.builtinLocked"));
    const uses = Object.values(snap.wallets.byAddress).reduce(
      (n, w) => n + Object.values(w.bindings).filter((b) => b.defId === d.id).length,
      0,
    );
    const msg =
      uses > 0
        ? t("wallet.deletePolicyConfirmUsed", { name: d.displayName, count: uses })
        : t("wallet.deletePolicyConfirm", { name: d.displayName });
    if (!window.confirm(msg)) return;
    void run(t("actions.deletePolicy"), () => deleteDef(d.id)).then(
      (ok) => ok && onToast(t("list.deletedToast")),
    );
  };

  /* ── 발행 ── */
  const [publishSrc, setPublishSrc] = useState<PublishSource | null>(null);
  const renderMember = async (d: PolicyDef) => ({
    slug: d.id.replace(/^def::/, ""),
    title: d.displayName,
    cedarText: await blocksToText(d.skeleton.ir as PolicyIR),
    manifest: d.skeleton.manifest,
  });

  const publishLibFolder = async (id: string, name: string) => {
    const members = collectPackageMembers(snap.library.defs, id);
    if (members.length === 0) {
      onToast(t("list.emptyPackageToast"));
      return;
    }
    try {
      setPublishSrc({
        kind: "package",
        suggestedDisplayName: name,
        suggestedSlug: id.replace(/^pkg::/, ""),
        members: await Promise.all(members.map(renderMember)),
        categories: [...new Set(members.map((d) => toMarketCategory(d.cat)))],
      });
    } catch (err) {
      console.error("[editor2] publish folder render failed:", err);
      onToast(t("list.publishPrepFailed"));
    }
  };

  const publishDef = async (d: PolicyDef) => {
    try {
      const m = await renderMember(d);
      setPublishSrc({
        kind: "policy",
        cedarText: m.cedarText,
        manifest: m.manifest,
        suggestedDisplayName: d.displayName,
        suggestedSlug: m.slug,
      });
    } catch (err) {
      console.error("[editor2] publish def render failed:", err);
      onToast(t("wallet.publishPrepFailed"));
    }
  };

  const publishPackage = async (pkgId: string, members: Binding[]) => {
    const defs = [...new Map(members.map((b) => [b.defId, snap.library.defs[b.defId]])).values()].filter(
      (d): d is PolicyDef => !!d,
    );
    if (defs.length === 0) {
      onToast(t("list.emptyPackageToast"));
      return;
    }
    try {
      setPublishSrc({
        kind: "package",
        suggestedDisplayName: walletPkgName(pkgId),
        suggestedSlug: pkgId.replace(/^pkg::/, ""),
        members: await Promise.all(defs.map(renderMember)),
      });
    } catch (err) {
      console.error("[editor2] publish package render failed:", err);
      onToast(t("wallet.publishPrepFailed"));
    }
  };

  /* ── 드롭(적용) 모달 ── */
  const [apply, setApply] = useState<{ pkgId: string; def: PolicyDef } | null>(null);
  const [folderApply, setFolderApply] = useState<{ pkgId: string; name: string; defs: PolicyDef[] } | null>(
    null,
  );

  const onCardDrop = (pkgId: string) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "folder") {
      setFolderApply({ pkgId, name: d.name, defs: d.defs });
      return;
    }
    if (isInPackage(d.def.id, pkgId)) {
      onToast(t("wallet.alreadyInPackage"));
      return;
    }
    setApply({ pkgId, def: d.def });
  };

  /* ─────────────── 렌더 ─────────────── */
  return (
    <div className="cols">
      {/* LEFT — 라이브러리 뼈대 */}
      <aside className="skel rise">
        <div className="skel-top">
          <div className="skel-label">
            <Ic id="box" cls="sm" />
            {t("editor2.libLabel")}
          </div>
          <div className="skel-actions">
            <button type="button" className="e2-mini" onClick={() => setNewFolderOpen(true)}>
              <Ic id="folder" cls="sm" />
              {t("editor2.newFolder")}
            </button>
            <button type="button" className="e2-mini" onClick={onNewPolicy}>
              <Ic id="plus" cls="sm" />
              {t("editor2.newPolicy")}
            </button>
          </div>
          <div className="searchbox">
            <Ic id="search" cls="sm" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("editor2.searchPlaceholder")}
            />
          </div>
        </div>

        <div className="skel-body scroll">
          {Object.values(snap.library.defs).filter((d) => !d.hidden).length === 0 ? (
            <div className="pb-empty" style={{ padding: "26px 14px" }}>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("editor2.emptyLibTitle")}</div>
              <div style={{ marginTop: 4 }}>{t("editor2.emptyLibHint")}</div>
            </div>
          ) : (
            folders.map((f) => {
              const all = defsByFolder.get(f.id) ?? [];
              const shown = all.filter(matchQuery);
              // 검색 중이고 매칭이 없으면 숨김. 빈 폴더(검색 아님)는 보여줘서
              // 새로 만든 폴더가 나타나고, 정책을 끌어다 넣을 수 있게 한다.
              if (shown.length === 0 && searching) return null;
              // 기본 접힘. 검색 중엔 매칭을 보여주려 강제로 펼친다.
              const open = searching || expanded.has(f.id);
              return (
                <div
                  key={f.id}
                  className={`sgroup${open ? "" : " collapsed"}${f.locked ? " uncat" : ""}${f.builtin ? " builtin" : ""}`}
                >
                  <div
                    className={`sghead${folderDrop === f.id ? " droptarget" : ""}`}
                    draggable={!f.locked}
                    onClick={() => toggleFolder(f.id)}
                    onDragStart={() => {
                      if (!f.locked) dragRef.current = { kind: "folder", name: f.displayName, defs: all };
                    }}
                    onDragOver={(e) => {
                      if (dragRef.current?.kind === "def") {
                        e.preventDefault();
                        setFolderDrop(f.id);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node))
                        setFolderDrop((p) => (p === f.id ? null : p));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setFolderDrop(null);
                      const d = dragRef.current;
                      dragRef.current = null;
                      if (d?.kind === "def") moveDefToLibFolder(d.def.id, f.id);
                    }}
                  >
                    <Ic id="chev" cls="sm e2cv" />
                    <Ic id={f.locked ? "inbox" : "folder"} cls="sm" />
                    <span className="nm">{f.displayName}</span>
                    {f.locked ? (
                      <>
                        <span className="cnt">{all.length}</span>
                        <span className="uncat-tag" title={t("editor2.uncatFolderHint")}>
                          {t("editor2.uncatFolderTag")}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="cnt">{all.length}</span>
                        {/* 기본 안전팩(builtin) 폴더는 수정 불가 — 게시·이름변경·삭제 숨김. */}
                        {!f.builtin && (
                          <span className="facts" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="ib xs"
                              title={t("editor2.publish")}
                              onClick={() => void publishLibFolder(f.id, f.displayName)}
                            >
                              <Ic id="shield" cls="sm" />
                            </button>
                            <button
                              type="button"
                              className="ib xs"
                              title={t("editor2.rename")}
                              onClick={() => renameLibFolder(f.id)}
                            >
                              <Ic id="edit" cls="sm" />
                            </button>
                            <button
                              type="button"
                              className="ib xs danger"
                              title={t("editor2.delete")}
                              onClick={() => deleteLibFolder(f.id)}
                            >
                              <Ic id="trash" cls="sm" />
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="sgbody">
                    {shown.map((d) => {
                      const usedIn = pkgCountByDef.get(d.id)?.size ?? 0;
                      return (
                        <div
                          key={d.id}
                          className="sitem"
                          draggable
                          onDragStart={() => (dragRef.current = { kind: "def", def: d })}
                        >
                          <span className="nm" title={d.displayName}>
                            {d.displayName}
                          </span>
                          <span className="end">
                            <span
                              className={`pkgcnt${usedIn === 0 ? " zero" : ""}`}
                              title={t("editor2.inPackages", { count: usedIn })}
                            >
                              <Ic id="box" cls="sm" />
                              {usedIn}
                            </span>
                            {/* 기본 안전팩(builtin)은 수정 불가 — 편집·게시·삭제 액션을
                                통째로 숨긴다(바꾸려면 복제해서 내 정책으로). */}
                            {d.source !== "builtin" && (
                              <span className="acts">
                                <button
                                  type="button"
                                  className="ib xs"
                                  title={t("wallet.editSkeletonTitle")}
                                  onClick={() => navigate(`/editor/${encodeURIComponent(d.id)}`)}
                                >
                                  <Ic id="edit" cls="sm" />
                                </button>
                                <button
                                  type="button"
                                  className="ib xs"
                                  title={t("editor2.publishHub")}
                                  onClick={() => void publishDef(d)}
                                >
                                  <Ic id="shield" cls="sm" />
                                </button>
                                <button
                                  type="button"
                                  className="ib xs danger"
                                  title={t("editor2.delete")}
                                  onClick={() => onDeleteDef(d)}
                                >
                                  <Ic id="trash" cls="sm" />
                                </button>
                              </span>
                            )}
                            <Ic id="grip" cls="sm grip" />
                          </span>
                        </div>
                      );
                    })}
                    {shown.length === 0 && (
                      <div className="sgempty">{t("editor2.folderEmptyHint")}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="skel-foot">
          <Ic id="grip" cls="sm" />
          {t("editor2.footHint")}
        </div>
      </aside>

      {/* RIGHT — 패키지 카드 */}
      <section>
        <div className="pkhead">
          <span className="t">{t("editor2.pkgHeadTitle")}</span>
          <span className="s">{t("editor2.pkgHeadSub")}</span>
        </div>
        {packages.length === 0 ? (
          <div className="pb-empty" style={{ padding: "40px 16px", maxWidth: 520 }}>
            {t("editor2.noPackages")}
          </div>
        ) : (
          <div className="pgrid stagger">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                wallet={wallet}
                snap={snap}
                members={membersByPkg.get(pkg.id) ?? []}
                address={address}
                run={run}
                onToast={onToast}
                onToggle={togglePackage}
                onRename={renamePackage}
                onSaveDesc={savePackageDesc}
                onRemove={removePackage}
                onPublish={publishPackage}
                onDrop={onCardDrop}
                onOpenBinding={(defId, bindId) =>
                  navigate(
                    `/editor/${encodeURIComponent(defId)}?wallet=${address}&binding=${encodeURIComponent(bindId)}`,
                  )
                }
              />
            ))}
            <button type="button" className="addpkg" onClick={createPackage}>
              <span className="pl">
                <Ic id="plus" cls="lg" />
              </span>
              <span className="t">{t("editor2.addPackage")}</span>
            </button>
          </div>
        )}
      </section>

      {apply && (
        <ApplyModal
          def={apply.def}
          pkgId={apply.pkgId}
          pkgName={walletPkgName(apply.pkgId)}
          address={address}
          run={run}
          onToast={onToast}
          onClose={() => setApply(null)}
        />
      )}
      {folderApply && (
        <FolderApplyModal
          folderName={folderApply.name}
          pkgId={folderApply.pkgId}
          pkgName={walletPkgName(folderApply.pkgId)}
          address={address}
          defs={folderApply.defs}
          isInPackage={(defId) => isInPackage(defId, folderApply.pkgId)}
          run={run}
          onToast={onToast}
          onClose={() => setFolderApply(null)}
        />
      )}
      <PublishModal open={publishSrc !== null} source={publishSrc} onClose={() => setPublishSrc(null)} />
      {newFolderOpen && (
        <NewFolderModal
          onClose={() => setNewFolderOpen(false)}
          onCreate={(name) => {
            createLibFolder(name);
            setNewFolderOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────── 새 폴더 모달 ─────────────── */
function NewFolderModal(props: { onClose: () => void; onCreate: (name: string) => void }) {
  const { onClose, onCreate } = props;
  const { t } = useTranslation("editor");
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const submit = () => {
    if (!name.trim()) return;
    onCreate(name);
  };
  return (
    <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 420 }}>
        <div className="m-head">
          <span className="m-ic folder">
            <Ic id="folder" cls="lg" />
          </span>
          <div className="m-title-wrap">
            <div className="m-h-title">{t("editor2.newFolderTitle")}</div>
            <div className="m-title-hint">{t("editor2.newFolderHint")}</div>
          </div>
          <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}>
            <Ic id="x" cls="sm" />
          </button>
        </div>
        <div className="m-body" style={{ paddingTop: 4 }}>
          <input
            ref={inputRef}
            className="m-title"
            style={{ width: "100%", margin: 0 }}
            value={name}
            placeholder={t("editor2.newFolderPlaceholder")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <div className="m-foot">
          <button type="button" className="lk" onClick={onClose}>
            {t("common:cancel")}
          </button>
          <button type="button" className="btn sage" disabled={!name.trim()} onClick={submit}>
            {t("editor2.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 패키지 카드(플립) ─────────────── */
function PackageCard(props: {
  pkg: { id: string; displayName: string; desc?: string };
  wallet: WalletPolicyState;
  snap: StoreSnapshot;
  members: Binding[];
  address: string;
  run: RunFn;
  onToast: (text: string) => void;
  onToggle: (pkgId: string, members: Binding[], displayedOn: boolean) => void;
  onRename: (pkgId: string, name: string) => void;
  onSaveDesc: (pkgId: string, desc: string) => void;
  onRemove: (pkgId: string) => void;
  onPublish: (pkgId: string, members: Binding[]) => void;
  onDrop: (pkgId: string) => void;
  onOpenBinding: (defId: string, bindId: string) => void;
}) {
  const { pkg, wallet, snap, members, address, run, onRename, onSaveDesc, onRemove, onPublish, onToggle, onDrop, onOpenBinding } =
    props;
  const { t } = useTranslation("editor");
  const [flip, setFlip] = useState(false);
  const [drop, setDrop] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(pkg.displayName);
  const [draftDesc, setDraftDesc] = useState(pkg.desc ?? "");
  useEffect(() => setDraftDesc(pkg.desc ?? ""), [pkg.desc]);

  const locked = pkg.id === UNCATEGORIZED_PKG;
  // 기본 안전팩(builtin)은 구조 편집 불가 — 이름변경/게시/설명/삭제/바인딩삭제/파라미터
  // 이동을 막고, 색을 개별처럼 다르게 준다(toggle 만 가능). builtin 패키지 id는
  // `pkg::builtin.*`(시드의 BUILTIN_PKG) 규칙을 따른다.
  const isBuiltin = pkg.id.startsWith("pkg::builtin.");
  const readOnly = locked || isBuiltin;
  const empty = members.length === 0;
  const activeN = members.filter((b) => isEffectiveOn(wallet, b)).length;
  const displayedOn = packageDisplayOn(
    wallet.packageEnabled[pkg.id] ?? true,
    members.filter((b) => b.enabled).length,
  );
  const defOf = (b: Binding) => snap.library.defs[b.defId];
  const cats = [...new Set(members.map((b) => catKey(defOf(b)?.cat)))].slice(0, 5);

  return (
    <div
      className={`pcard${flip ? " flip" : ""}${drop ? " drop" : ""}${locked ? " uncat" : ""}${isBuiltin ? " builtin" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrop(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        onDrop(pkg.id);
      }}
    >
      <div className="pcard-in">
        {/* front */}
        <div className="pface pfront" onClick={() => setFlip(true)}>
          <div className="pf-top">
            <span className={`pf-ic${empty && !locked ? " empty" : ""}`}>
              <Ic id={locked ? "inbox" : "box"} />
            </span>
            <span className="pf-nm" title={pkg.displayName}>
              {pkg.displayName}
            </span>
            {locked && <span className="uncat-tag">{t("editor2.uncatCardTag")}</span>}
            {isBuiltin && <span className="uncat-tag">{t("editor2.builtinTag")}</span>}
            {!empty && (
              <label className="sw sm" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={displayedOn}
                  onChange={() => onToggle(pkg.id, members, displayedOn)}
                />
                <span className="trk" />
              </label>
            )}
          </div>
          <p className={`pf-intent${readOnly || !pkg.desc ? " muted" : ""}`}>
            {locked
              ? t("editor2.uncatCardDesc")
              : isBuiltin
                ? t("editor2.builtinCardDesc")
                : pkg.desc || t("editor2.cardDescEmpty")}
          </p>
          <div className="pf-foot">
            {!empty && (
              <span className="swatches">
                {cats.map((c) => (
                  <i key={c} style={{ background: catStyle(c).hex }} />
                ))}
              </span>
            )}
            <span className="pf-cnt">
              {t("editor2.policyCount", { count: members.length })}
              {!empty && (
                <>
                  {" · "}
                  <span className="on">{t("editor2.activeCount", { count: activeN })}</span>
                </>
              )}
            </span>
            <span className="pf-flip">
              <Ic id="flip" cls="sm" />
              {t("editor2.flip")}
            </span>
          </div>
        </div>

        {/* back */}
        <div className="pface pback">
          <div className="pb-head">
            <button type="button" className="pb-back" onClick={() => setFlip(false)}>
              <Ic id="back" cls="sm" />
            </button>
            {renaming && !locked ? (
              <input
                className="m-title"
                style={{ flex: 1, fontSize: 13, padding: "3px 7px", margin: 0, width: "auto" }}
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  setRenaming(false);
                  onRename(pkg.id, draftName);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setDraftName(pkg.displayName);
                    setRenaming(false);
                  }
                }}
              />
            ) : (
              <span className="pb-nm">{pkg.displayName}</span>
            )}
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="ib"
                  title={t("library.rename")}
                  onClick={() => {
                    setDraftName(pkg.displayName);
                    setRenaming(true);
                  }}
                >
                  <Ic id="edit" cls="sm" />
                </button>
                {!empty && (
                  <button
                    type="button"
                    className="ib"
                    title={t("wallet.publishPackageTitle")}
                    onClick={() => onPublish(pkg.id, members)}
                  >
                    <Ic id="shield" cls="sm" />
                  </button>
                )}
              </>
            )}
          </div>
          {!readOnly && (
            <input
              className="pb-desc-input"
              value={draftDesc}
              placeholder={t("editor2.cardDescPlaceholder")}
              title={t("editor2.cardDescLabel")}
              onChange={(e) => setDraftDesc(e.target.value)}
              onBlur={() => onSaveDesc(pkg.id, draftDesc)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setDraftDesc(pkg.desc ?? "");
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          )}
          <div className="pb-list scroll">
            {empty ? (
              <div className="pb-empty">{t("editor2.emptyBack")}</div>
            ) : (
              members.map((b) => (
                <BindingItem
                  key={b.id}
                  binding={b}
                  def={defOf(b)}
                  address={address}
                  run={run}
                  onOpen={() => onOpenBinding(b.defId, b.id)}
                  readOnly={isBuiltin}
                />
              ))
            )}
          </div>
          <div className="pb-foot">
            <span className="muted" style={{ fontSize: 11 }}>
              {t("editor2.policyCount", { count: members.length })}
            </span>
            <span className="spacer" />
            {!readOnly && (
              <button
                type="button"
                className="ib danger"
                title={t("editor2.deletePackage")}
                onClick={() => onRemove(pkg.id)}
              >
                <Ic id="trash" cls="sm" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* 카드 뒷면 바인딩 한 줄 — 토글(on/off)·제거·열기. */
function BindingItem(props: {
  binding: Binding;
  def: PolicyDef | undefined;
  address: string;
  run: RunFn;
  onOpen: () => void;
  /** 기본 안전팩(builtin) — 파라미터 수정 진입과 제거를 막는다(토글만 가능). */
  readOnly?: boolean;
}) {
  const { binding: b, def, address, run, onOpen, readOnly } = props;
  const { t } = useTranslation("editor");
  const cat = catKey(def?.cat);
  const name = b.alias ?? def?.displayName ?? b.defId;
  return (
    <div className={`pb-item${b.enabled ? "" : " off"}`}>
      <span className="dot" style={{ background: catStyle(cat).hex }} />
      {readOnly ? (
        <span className="nm">{name}</span>
      ) : (
        <span
          className="nm"
          title={t("wallet.bindingEditTitle")}
          style={{ cursor: "pointer" }}
          onClick={onOpen}
        >
          {name}
        </span>
      )}
      {b.alias && <span className="alias">{b.alias}</span>}
      <button
        type="button"
        className={`ox${b.enabled ? " on" : ""}`}
        title={b.enabled ? t("wallet.toggleOffTitle") : t("wallet.toggleOnTitle")}
        aria-label={b.enabled ? t("wallet.toggleOffAria") : t("wallet.toggleOnAria")}
        onClick={() =>
          void run(t("actions.toggle"), () =>
            updateBinding({ address, bindingId: b.id, patch: { enabled: !b.enabled } }),
          )
        }
      >
        <Ic id={b.enabled ? "shield" : "x"} />
      </button>
      {!readOnly && (
        <button
          type="button"
          className="ib danger"
          title={t("wallet.removeBindingTitle")}
          onClick={() => void run(t("actions.remove"), () => removeBinding({ address, bindingId: b.id }))}
        >
          <Ic id="trash" cls="sm" />
        </button>
      )}
    </div>
  );
}

/* ─────────────── hole(값) 편집 시트 ─────────────── */
function HoleFields(props: {
  def: PolicyDef;
  draft: Record<string, string>;
  setDraft: (d: Record<string, string>) => void;
}) {
  const { def, draft, setDraft } = props;
  const { t } = useTranslation("editor");
  const holes = def.holes ?? [];
  if (holes.length === 0) {
    return (
      <div className="vsheet">
        <div className="vs-empty muted">{t("editor2.modal.noValues")}</div>
      </div>
    );
  }
  return (
    <div className="vsheet">
      <div className="vs-when">
        {holes.map((h) => {
          const val = draft[h.name] ?? "";
          const set = (v: string) => setDraft({ ...draft, [h.name]: v });
          return (
            <div className="vs-row" key={h.name}>
              <b>{h.label || h.name}</b>
              {h.type === "bool" ? (
                <select className="vs-input" value={val || "false"} onChange={(e) => set(e.target.value)}>
                  <option value="true">{t("value.true")}</option>
                  <option value="false">{t("value.false")}</option>
                </select>
              ) : (
                <input
                  className="vs-input"
                  value={val}
                  placeholder={h.type === "addressSet" ? "0x…, 0x…" : ""}
                  onChange={(e) => set(e.target.value)}
                />
              )}
              {h.required && val.trim() === "" && (
                <span className="need">{t("editor2.modal.required")}</span>
              )}
              {h.desc && <span className="vs-desc muted">{h.desc}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── 단일 정책 적용 모달 ─────────────── */
function ApplyModal(props: {
  def: PolicyDef;
  pkgId: string;
  pkgName: string;
  address: string;
  run: RunFn;
  onToast: (text: string) => void;
  onClose: () => void;
}) {
  const { def, pkgId, pkgName, address, run, onToast, onClose } = props;
  const { t } = useTranslation("editor");
  const [alias, setAlias] = useState(def.displayName);
  const base = useMemo(() => baseFormModel(def), [def]);
  const [edited, setEdited] = useState<FormModel | null>(base);
  const [valid, setValid] = useState(true);
  const [severity, setSeverity] = useState<"deny" | "warn" | "info">(base?.severity ?? "warn");
  // 폼으로 못 여는 정책 폴백 — 원시 hole 입력.
  const [draft, setDraft] = useState<Record<string, string>>(() => initDraft(def));
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    let params: Record<string, HoleValue>;
    if (base) {
      params = paramsFromEdit(def, edited);
    } else {
      params = buildParams(def, draft);
      const missing = missingRequiredHoles(def, params);
      if (missing.length) {
        onToast(t("editor2.modal.requiredMissingToast", { labels: missing.join(", ") }));
        return;
      }
    }
    const aliasTrim = alias.trim();
    const finalAlias = aliasTrim && aliasTrim !== def.displayName ? aliasTrim : undefined;
    const sevOverride =
      (severity === "deny" || severity === "warn") && severity !== base?.severity ? severity : undefined;
    const ok = await run(t("actions.applyPolicy"), () =>
      bindDef({
        defId: def.id,
        packageId: pkgId,
        addresses: [address],
        ...(Object.keys(params).length ? { params } : {}),
        ...(finalAlias ? { alias: finalAlias } : {}),
        ...(sevOverride ? { severity: sevOverride } : {}),
      }),
    );
    if (ok) {
      onToast(`${finalAlias ?? def.displayName} → ${pkgName}`);
      onClose();
    }
  };

  return (
    <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="m-head">
          <span className="m-ic">
            <Ic id="warn" cls="lg" />
          </span>
          <div className="m-title-wrap">
            <div className="m-eye">
              {t("editor2.modal.eyebrow", { pkg: pkgName }).replace(/<\/?s>/g, "")}
            </div>
            <input
              ref={titleRef}
              className="m-title"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
            <div className="m-title-hint">{t("editor2.modal.titleHint")}</div>
          </div>
          <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}>
            <Ic id="x" cls="sm" />
          </button>
        </div>
        <div className="m-sub">{t("editor2.modal.sub")}</div>
        <div className="m-body scroll">
          {base ? (
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
          ) : (
            <HoleFields def={def} draft={draft} setDraft={setDraft} />
          )}
        </div>
        <div className="m-foot">
          <button type="button" className="lk" onClick={onClose}>
            <Ic id="back" cls="sm" />
            {t("editor2.modal.prev")}
          </button>
          <button
            type="button"
            className="btn sage"
            disabled={base ? !valid : false}
            onClick={() => void submit()}
          >
            {t("editor2.modal.receive")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 폴더 일괄 적용 모달 (선택 → 값 채우기 탭) ─────────────── */
function FolderApplyModal(props: {
  folderName: string;
  pkgId: string;
  pkgName: string;
  address: string;
  defs: PolicyDef[];
  isInPackage: (defId: string) => boolean;
  run: RunFn;
  onToast: (text: string) => void;
  onClose: () => void;
}) {
  const { folderName, pkgId, pkgName, address, defs, isInPackage, run, onToast, onClose } = props;
  const { t } = useTranslation("editor");

  // 이미 이 패키지에 든 정책은 기본 해제.
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(defs.map((d) => [d.id, !isInPackage(d.id)])),
  );
  const [step, setStep] = useState<1 | 2>(1);
  const [valIdx, setValIdx] = useState(0);
  // 폼 모델/유효성/심각도 — 폼으로 여는 정책. drafts = 폼으로 못 여는 정책 폴백.
  const baseModels = useMemo(
    () => Object.fromEntries(defs.map((d) => [d.id, baseFormModel(d)])),
    [defs],
  );
  const [edited, setEdited] = useState<Record<string, FormModel | null>>(() => ({ ...baseModels }));
  const [validMap, setValidMap] = useState<Record<string, boolean>>({});
  const [sevMap, setSevMap] = useState<Record<string, "deny" | "warn" | "info">>(() =>
    Object.fromEntries(defs.map((d) => [d.id, baseModels[d.id]?.severity ?? "warn"])),
  );
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(defs.map((d) => [d.id, initDraft(d)])),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const checkedDefs = defs.filter((d) => checked[d.id]);
  const valDefs = checkedDefs.filter((d) => (d.holes ?? []).length > 0);

  const paramsOf = (d: PolicyDef): Record<string, HoleValue> =>
    baseModels[d.id] ? paramsFromEdit(d, edited[d.id] ?? baseModels[d.id]) : buildParams(d, drafts[d.id] ?? {});

  const sevOverrideOf = (d: PolicyDef): "deny" | "warn" | undefined => {
    const s = sevMap[d.id];
    return (s === "deny" || s === "warn") && s !== baseModels[d.id]?.severity ? s : undefined;
  };

  const applyAll = async () => {
    // 값 검증 — 비거나 형식오류면 그 탭으로 보낸다.
    for (let i = 0; i < valDefs.length; i++) {
      const d = valDefs[i];
      if (baseModels[d.id]) {
        if (validMap[d.id] === false) {
          setStep(2);
          setValIdx(i);
          onToast(t("editor2.modal.requiredMissingToast", { labels: d.displayName }));
          return;
        }
      } else {
        const miss = missingRequiredHoles(d, buildParams(d, drafts[d.id] ?? {}));
        if (miss.length) {
          setStep(2);
          setValIdx(i);
          onToast(t("editor2.modal.requiredMissingToast", { labels: miss.join(", ") }));
          return;
        }
      }
    }
    const ok = await run(t("actions.applyPolicy"), async () => {
      for (const d of checkedDefs) {
        if (isInPackage(d.id)) continue;
        const params = paramsOf(d);
        const sev = sevOverrideOf(d);
        await bindDef({
          defId: d.id,
          packageId: pkgId,
          addresses: [address],
          ...(Object.keys(params).length ? { params } : {}),
          ...(sev ? { severity: sev } : {}),
        });
      }
    });
    if (ok) {
      onToast(`${folderName} → ${pkgName}`);
      onClose();
    }
  };

  const next = () => {
    if (valDefs.length === 0) {
      void applyAll();
      return;
    }
    setStep(2);
    setValIdx(0);
  };

  const checkedCount = checkedDefs.length;

  if (step === 1) {
    return (
      <div className="e2 e2-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <div className="m-head">
            <span className="m-ic folder">
              <Ic id="folder" cls="lg" />
            </span>
            <div className="m-title-wrap">
              <div className="m-eye">{t("editor2.folder.eyebrow", { pkg: pkgName }).replace(/<\/?s>/g, "")}</div>
              <div className="m-h-title">{t("editor2.folder.titleSuffix", { name: folderName })}</div>
              <div className="m-title-hint">{t("editor2.folder.hint")}</div>
            </div>
            <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}>
              <Ic id="x" cls="sm" />
            </button>
          </div>
          <div className="m-sub" style={{ paddingBottom: 8 }}>
            <span className="f-allrow">
              {t("editor2.folder.countLead", { count: checkedCount })}
              <span className="need">{t("editor2.folder.needBadge")}</span>
              {t("editor2.folder.countTail")}
            </span>
          </div>
          <div className="m-body">
            <div className="f-list">
              {defs.map((d) => {
                const inPkg = isInPackage(d.id);
                return (
                  <label key={d.id} className="f-item" style={inPkg ? { opacity: 0.55 } : undefined}>
                    <input
                      type="checkbox"
                      checked={!!checked[d.id]}
                      onChange={() => setChecked((c) => ({ ...c, [d.id]: !c[d.id] }))}
                    />
                    <span className="dot" style={{ background: catStyle(catKey(d.cat)).hex }} />
                    <span className="nm">{d.displayName}</span>
                    {inPkg ? (
                      <span className="need" style={{ color: "var(--mut)", background: "#eef1ef" }}>
                        {t("wallet.alreadyInPackage")}
                      </span>
                    ) : (
                      (d.holes ?? []).length > 0 && <span className="need">{t("editor2.folder.needBadge")}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="m-foot">
            <button type="button" className="lk" onClick={onClose}>
              <Ic id="x" cls="sm" />
              {t("editor2.folder.close")}
            </button>
            <button type="button" className="btn sage" disabled={checkedCount === 0} onClick={next}>
              {valDefs.length > 0
                ? t("editor2.folder.next")
                : t("editor2.folder.apply", { count: checkedCount })}
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
          <span className="m-ic">
            <Ic id="warn" cls="lg" />
          </span>
          <div className="m-title-wrap">
            <div className="m-eye">{t("editor2.folder.valEyebrow", { pkg: pkgName })}</div>
            <div className="m-h-title">{active?.displayName}</div>
            <div className="m-title-hint">{t("editor2.folder.valHint")}</div>
          </div>
          <button type="button" className="ib" style={{ marginLeft: "auto" }} onClick={onClose}>
            <Ic id="x" cls="sm" />
          </button>
        </div>
        <div className="f-tabs">
          {valDefs.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={`f-tab${i === valIdx ? " on" : ""}`}
              title={d.displayName}
              onClick={() => setValIdx(i)}
            >
              <span className="dot" style={{ background: catStyle(catKey(d.cat)).hex }} />
              {d.displayName}
            </button>
          ))}
        </div>
        <div className="m-sub" style={{ paddingTop: 8 }}>
          {t("editor2.folder.tabsSub")}
        </div>
        <div className="m-body scroll">
          {active &&
            (baseModels[active.id] ? (
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
            ) : (
              <HoleFields
                def={active}
                draft={drafts[active.id] ?? {}}
                setDraft={(d) => setDrafts((all) => ({ ...all, [active.id]: d }))}
              />
            ))}
        </div>
        <div className="m-foot">
          <button type="button" className="lk" onClick={() => setStep(1)}>
            <Ic id="back" cls="sm" />
            {t("editor2.folder.backToSelect")}
          </button>
          <button type="button" className="btn sage" onClick={() => void applyAll()}>
            {t("editor2.folder.receive")}
          </button>
        </div>
      </div>
    </div>
  );
}
