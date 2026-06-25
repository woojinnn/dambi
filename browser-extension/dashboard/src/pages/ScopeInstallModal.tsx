import { useMemo, useRef, useState, type ReactNode } from "react";

import { UNCATEGORIZED_PKG, type HoleValue } from "../server-api/policy-store";
import { diffParamValues } from "./market-install-v2";
import type { FormModel } from "../cedar/form";
import { PolicyFormPane } from "./editor/v2/PolicyFormPane";

import "./market.css"; // im-* 모달 스타일(공유)

/**
 * 정책을 "에디터(라이브러리 + 지갑 패키지)"에 들이는 **공유 모달**.
 *
 * Policy Hub에서 받기(MarketInstallModal)나 새 정책 저장(에디터)이나 결국 같은
 * 동작 — 템플릿을 라이브러리에 저장하고, 고른 (지갑·패키지)에 값을 채워 적용 —
 * 이라 화면/흐름을 하나로 통일한다. 소스(어떤 정책의 어떤 폼)와 결과(실제 저장/
 * 설치)만 props 로 주입받고, 선택·파라미터 수집 UI 는 여기서 공통으로 처리한다.
 */
export interface ScopeFormDef {
  defId: string;
  defName: string;
  /** 값 시트 기준 모델. null = 폼으로 못 여는 정책(파라미터 편집 생략). */
  model: FormModel | null;
  manifest: unknown;
}
export interface ScopeWallet {
  address: string;
  label?: string | null;
  packages: { id: string; displayName: string }[];
}
/** defId → (hole → 값). */
export type ScopeParams = Record<string, Record<string, HoleValue>>;

export interface WalletApply {
  addresses: string[];
  /** addr → 선택 패키지 키 목록(pkgId | UNCATEGORIZED_PKG | "__new__"). 빈 배열 = 라이브러리만. */
  walletPackages: Record<string, string[]>;
  walletNewName: Record<string, string>;
  /** comboKey `${addr}|${key}` → params. */
  paramsByCombo: Record<string, ScopeParams>;
  /** comboKey → (defId → 심각도 override). */
  severityByCombo: Record<string, Record<string, "deny" | "warn">>;
}
export interface LibraryApply {
  packageId: string | "__new__";
  newPackageName: string;
  applyToAllNow: boolean;
  applyToNewWallets: boolean;
  libParams: ScopeParams;
}

const CHEVRON = "M9 6l6 6-6 6";
function Glyph({ d, size, color = "currentColor", sw = 1.8 }: { d: string; size: number; color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function ScopeInstallModal(props: {
  open: boolean;
  ko: boolean;
  /** 헤더 아이콘 + 종류 라벨 + 제목. */
  icon: ReactNode;
  kindLabel: string;
  title: string;
  /** 편집 가능한 이름(신규 정책). 주어지면 1단계에 이름 입력칸이 뜬다. */
  name?: { value: string; onChange: (s: string) => void; label: string; placeholder: string };
  /** 1단계 선택지 설명(보통/지갑) — 호출측 문구. */
  walletOptTitle: string;
  walletOptDesc: string;
  libraryOptTitle: string;
  libraryOptDesc: string;
  formDefs: ScopeFormDef[];
  formDefsLoading?: boolean;
  wallets: ScopeWallet[];
  libPackages: { id: string; displayName: string }[];
  /** 마켓 set: 라이브러리 경로에서 폴더 대신 "패키지로 저장" 안내만. */
  libraryIsSet?: boolean;
  busy: boolean;
  error?: string | null;
  onApplyWallets: (a: WalletApply) => void;
  onApplyLibrary: (a: LibraryApply) => void;
  onClose: () => void;
  /** 설치/저장 성공 화면(마켓). 없으면 성공 시 호출측이 모달을 닫는다. */
  done?: { message: string; primaryLabel?: string; onPrimary?: () => void } | null;
}) {
  const {
    ko, icon, kindLabel, title, name, formDefs, formDefsLoading, wallets, libPackages, libraryIsSet,
    busy, error, onApplyWallets, onApplyLibrary, onClose, done,
  } = props;

  const [kind, setKind] = useState<"wallet" | "library" | null>(null);
  const [walletStep, setWalletStep] = useState<"select" | "params">("select");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [walletPkgSel, setWalletPkgSel] = useState<Record<string, string[]>>({});
  const [walletNewName, setWalletNewName] = useState<Record<string, string>>({});
  const [packageId, setPackageId] = useState<string | "__new__">(UNCATEGORIZED_PKG);
  const [newPackageName, setNewPackageName] = useState("");
  // 라이브러리 경로 = 폴더에 템플릿만 저장. 자동 적용 토글은 제거(라이브러리 탭의
  // 정책별 기본적용에서 관리). 적용은 지갑 경로에서.
  const applyToAllNow = false;
  const applyToNewWallets = false;
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // 편집 모델은 ref(키 입력마다 부모 리렌더 방지). 유효성/심각도만 state.
  const comboModelsRef = useRef<Record<string, Record<string, FormModel>>>({});
  const libModelsRef = useRef<Record<string, FormModel>>({});
  const [comboValidity, setComboValidity] = useState<Record<string, Record<string, boolean>>>({});
  const [libValidity, setLibValidity] = useState<Record<string, boolean>>({});
  const [comboSeverity, setComboSeverity] = useState<Record<string, Record<string, "deny" | "warn">>>({});

  const baseOf = (defId: string) => formDefs.find((f) => f.defId === defId)?.model ?? null;
  const hasParams = formDefs.some((f) => f.model);
  const selOf = (a: string) => walletPkgSel[a] ?? [];
  const toggleWalletPkg = (a: string, key: string) =>
    setWalletPkgSel((m) => {
      const cur = m[a] ?? [];
      return { ...m, [a]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });
  const combos = useMemo(
    () => [...picked].flatMap((a) => selOf(a).map((key) => ({ addr: a, key }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, walletPkgSel],
  );
  const ckOf = (a: string, key: string) => `${a}|${key}`;
  const walletNameOf = (a: string) => wallets.find((w) => w.address === a)?.label?.trim() || shortAddr(a);
  const pkgLabelOf = (a: string, key: string) => {
    if (key === "__new__") return (walletNewName[a] ?? "").trim() || (ko ? "새 패키지" : "New package");
    if (key === UNCATEGORIZED_PKG) return ko ? "미분류" : "Uncategorized";
    return wallets.find((w) => w.address === a)?.packages.find((p) => p.id === key)?.displayName ?? key;
  };

  const paramsFor = (defId: string, edited: FormModel | undefined): Record<string, HoleValue> => {
    const base = baseOf(defId);
    if (!base || !edited) return {};
    return diffParamValues(base, edited);
  };
  const comboParams = (ck: string): ScopeParams => {
    const out: ScopeParams = {};
    for (const f of formDefs) out[f.defId] = paramsFor(f.defId, comboModelsRef.current[ck]?.[f.defId]);
    return out;
  };
  const libParams = (): ScopeParams => {
    const out: ScopeParams = {};
    for (const f of formDefs) out[f.defId] = paramsFor(f.defId, libModelsRef.current[f.defId]);
    return out;
  };

  if (!props.open) return null;

  const nameOk = !name || !!name.value.trim();
  const walletSelectionInvalid =
    !nameOk ||
    picked.size === 0 ||
    [...picked].some((a) => selOf(a).includes("__new__") && !(walletNewName[a] ?? "").trim());
  const walletParamsInvalid = combos.some(({ addr, key }) =>
    formDefs.some((f) => comboValidity[ckOf(addr, key)]?.[f.defId] === false),
  );
  const libraryInvalid = !nameOk || (packageId === "__new__" && !newPackageName.trim()) ||
    formDefs.some((f) => libValidity[f.defId] === false);

  const togglePick = (a: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  const submitWallets = () => {
    const walletPackages: Record<string, string[]> = {};
    for (const a of picked) walletPackages[a] = selOf(a);
    const paramsByCombo: Record<string, ScopeParams> = {};
    const severityByCombo: Record<string, Record<string, "deny" | "warn">> = {};
    for (const { addr, key } of combos) {
      const ck = ckOf(addr, key);
      paramsByCombo[ck] = comboParams(ck);
      const sevs: Record<string, "deny" | "warn"> = {};
      for (const f of formDefs) {
        const chosen = comboSeverity[ck]?.[f.defId];
        if (chosen && f.model && chosen !== f.model.severity) sevs[f.defId] = chosen;
      }
      if (Object.keys(sevs).length) severityByCombo[ck] = sevs;
    }
    onApplyWallets({ addresses: [...picked], walletPackages, walletNewName, paramsByCombo, severityByCombo });
  };
  const submitLibrary = () =>
    onApplyLibrary({ packageId, newPackageName: newPackageName.trim(), applyToAllNow, applyToNewWallets, libParams: libParams() });

  /** scope: comboKey(지갑 경로) 또는 undefined(라이브러리 경로) — 그 칸의 폼들. */
  const renderForms = (scope: string | undefined) => {
    if (!hasParams) {
      return <div className="im-noparams">{ko ? "설정할 파라미터가 없습니다." : "No parameters to set."}</div>;
    }
    const setModel = (defId: string, model: FormModel) => {
      if (scope) (comboModelsRef.current[scope] ??= {})[defId] = model;
      else libModelsRef.current[defId] = model;
    };
    const setValid = (defId: string, valid: boolean) => {
      if (scope) setComboValidity((m) => ({ ...m, [scope]: { ...(m[scope] ?? {}), [defId]: valid } }));
      else setLibValidity((m) => ({ ...m, [defId]: valid }));
    };
    return (
      <div className="im-paramforms">
        {formDefs.map((f) => {
          if (!f.model) return null;
          const seeded = (scope ? comboModelsRef.current[scope]?.[f.defId] : libModelsRef.current[f.defId]) ?? f.model;
          const defSev = f.model.severity;
          const sevEditable = scope !== undefined && (defSev === "deny" || defSev === "warn");
          const sevProps = sevEditable
            ? {
                severityValue: comboSeverity[scope]?.[f.defId] ?? (defSev as "deny" | "warn"),
                onSeverityChange: (s: "deny" | "warn") =>
                  setComboSeverity((m) => ({ ...m, [scope]: { ...(m[scope] ?? {}), [f.defId]: s } })),
              }
            : {};
          return (
            <div key={f.defId} className="im-paramform">
              {formDefs.length > 1 && <div className="im-paramform-name">{f.defName}</div>}
              <PolicyFormPane
                key={`${scope ?? "lib"}:${f.defId}`}
                initialModel={seeded}
                initialManifest={f.manifest}
                valuesOnly
                compact
                {...sevProps}
                onChange={({ model }) => setModel(f.defId, model)}
                onValidity={({ valid }) => setValid(f.defId, valid)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const head = (
    <div className="im-head">
      <span className="im-ico" style={{ background: "var(--fog-200)" }}>
        {icon}
      </span>
      <div className="im-headmeta">
        <span className="im-kind">{kindLabel}</span>
        <h3 className="im-title">{title}</h3>
      </div>
    </div>
  );

  const wideForForms = hasParams && !done && ((kind === "wallet" && walletStep === "params") || kind === "library");

  return (
    <div className="im-overlay" onClick={busy ? undefined : onClose}>
      <div className={`im-box${wideForForms ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="im-x" onClick={onClose} aria-label="close">
          <Glyph d="M6 6l12 12M18 6L6 18" size={16} sw={2} />
        </button>

        {done ? (
          <>
            <div className="im-success">
              <div className="im-ok">
                <Glyph d="M5 12.5l4.5 4.5L19 7.5" size={26} sw={2.6} />
              </div>
              <h3 className="im-success-t">{ko ? "완료" : "Done"}</h3>
              <p className="im-success-s">{done.message}</p>
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={onClose}>
                {ko ? "닫기" : "Close"}
              </button>
              {done.onPrimary && (
                <button type="button" className="pri" onClick={done.onPrimary}>
                  {done.primaryLabel ?? (ko ? "확인" : "OK")}
                </button>
              )}
            </div>
          </>
        ) : kind === null ? (
          <>
            {head}
            <div className="im-body">
              {name && (
                <label className="im-name">
                  <span>{name.label}</span>
                  <input
                    autoFocus
                    value={name.value}
                    onChange={(e) => name.onChange(e.target.value)}
                    placeholder={name.placeholder}
                    maxLength={120}
                  />
                </label>
              )}
              <p className="im-sub">{ko ? "어떻게 저장할까요?" : "How should this be saved?"}</p>
              <div className="im-scope">
                <button
                  type="button"
                  className="im-opt"
                  disabled={wallets.length === 0}
                  onClick={() => {
                    setWalletStep("select");
                    setKind("wallet");
                  }}
                >
                  <span className="im-opt-ic">
                    <Glyph d="M3 7.5h18v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7.5l2.5-3h13L21 7.5M16.5 13h2.5" size={20} color="var(--slate-500)" sw={1.7} />
                  </span>
                  <span className="im-opt-main">
                    <span className="im-opt-t">{props.walletOptTitle}</span>
                    <span className="im-opt-d">{props.walletOptDesc}</span>
                  </span>
                  <span className="im-opt-go">
                    <Glyph d={CHEVRON} size={15} color="var(--slate-300)" sw={2} />
                  </span>
                </button>
                <button type="button" className="im-opt" onClick={() => setKind("library")}>
                  <span className="im-opt-ic">
                    <Glyph d="M5 4h5v16H5zM12.5 4l4.5 1 2.5 14.5-4.5-1zM5 8h5M5 16h5" size={20} color="var(--slate-500)" sw={1.7} />
                  </span>
                  <span className="im-opt-main">
                    <span className="im-opt-t">{props.libraryOptTitle}</span>
                    <span className="im-opt-d">{props.libraryOptDesc}</span>
                  </span>
                  <span className="im-opt-go">
                    <Glyph d={CHEVRON} size={15} color="var(--slate-300)" sw={2} />
                  </span>
                </button>
              </div>
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={onClose}>
                {ko ? "취소" : "Cancel"}
              </button>
            </div>
          </>
        ) : kind === "wallet" ? (
          walletStep === "select" ? (
            <>
              {head}
              <div className="im-body">
                <p className="im-sub">
                  {ko
                    ? "어느 지갑에 적용할까요? 패키지는 여러 개 고를 수 있고, 안 고르면 라이브러리에만 저장돼요."
                    : "Pick wallets — choose any number of packages each (none = library only)."}
                </p>
                <div className="im-wallets">
                  {wallets.map((w) => {
                    const on = picked.has(w.address);
                    const sels = selOf(w.address);
                    const label = w.label?.trim();
                    const short = shortAddr(w.address);
                    const nm = label || short;
                    const subAddr = label ? short : null;
                    const avatar = (label || w.address.replace(/^0x/i, "")).slice(0, 1).toUpperCase();
                    return (
                      <div key={w.address} className={`im-wallet${on ? " on" : ""}`}>
                        <div className="im-wrow" onClick={() => togglePick(w.address)}>
                          <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-hidden="true" />
                          <span className="im-wav">{avatar}</span>
                          <span className="im-wmeta">
                            <span className="im-wname">{nm}</span>
                            {subAddr && <span className="im-waddr">{subAddr}</span>}
                          </span>
                        </div>
                        {on && (
                          <div className="im-pkgrow">
                            <span className="im-pkglabel">{ko ? "패키지" : "Package"}</span>
                            <div className="im-pkgchips">
                              <button
                                type="button"
                                className={`im-pkgchip${sels.includes(UNCATEGORIZED_PKG) ? " on" : ""}`}
                                onClick={() => toggleWalletPkg(w.address, UNCATEGORIZED_PKG)}
                              >
                                {ko ? "미분류" : "Uncategorized"}
                              </button>
                              {w.packages.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className={`im-pkgchip${sels.includes(p.id) ? " on" : ""}`}
                                  onClick={() => toggleWalletPkg(w.address, p.id)}
                                >
                                  {p.displayName}
                                </button>
                              ))}
                              <button
                                type="button"
                                className={`im-pkgchip new${sels.includes("__new__") ? " on" : ""}`}
                                onClick={() => toggleWalletPkg(w.address, "__new__")}
                              >
                                {ko ? "+ 새 패키지" : "+ New"}
                              </button>
                            </div>
                            {sels.includes("__new__") && (
                              <input
                                className="im-textfield sm"
                                value={walletNewName[w.address] ?? ""}
                                onChange={(e) => setWalletNewName((m) => ({ ...m, [w.address]: e.target.value }))}
                                placeholder={ko ? "새 패키지 이름" : "Package name"}
                              />
                            )}
                            {sels.length === 0 && (
                              <span className="im-libnote">
                                {ko ? "패키지 미선택 — 라이브러리에만 저장돼요" : "No package — library only"}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="im-actions">
                <button type="button" className="sec" onClick={() => setKind(null)}>
                  {ko ? "← 이전" : "← Back"}
                </button>
                <button
                  type="button"
                  className="pri"
                  disabled={formDefsLoading || walletSelectionInvalid}
                  onClick={() => setWalletStep("params")}
                >
                  {ko ? "다음 →" : "Next →"}
                </button>
              </div>
            </>
          ) : (
            <>
              {head}
              <div className="im-body">
                <p className="im-sub">
                  {combos.length === 0
                    ? ko
                      ? "패키지를 안 골라서 라이브러리에만 저장돼요. 그대로 저장해도 돼요."
                      : "No package chosen — it'll be saved to the library only."
                    : hasParams
                      ? ko
                        ? "선택한 패키지마다 값을 확인하고 필요하면 바꿔주세요. 빈 칸은 채워야 적용돼요."
                        : "Review values per selected package and fill any blanks."
                      : ko
                        ? "설정할 파라미터가 없어요. 바로 저장할 수 있어요."
                        : "No parameters to set — you can save directly."}
                </p>
                {combos.length === 0 || !hasParams ? (
                  <div className="im-noparams">
                    {combos.length === 0
                      ? ko
                        ? "선택한 패키지가 없어 라이브러리에만 저장돼요."
                        : "No package selected — saved to the library only."
                      : ko
                        ? "설정할 파라미터가 없습니다."
                        : "No parameters to set."}
                  </div>
                ) : (
                  (() => {
                    const tabKeys = combos.map((c) => ckOf(c.addr, c.key));
                    const active = activeTab && tabKeys.includes(activeTab) ? activeTab : tabKeys[0];
                    return (
                      <div className="im-wparams">
                        {tabKeys.length > 1 && (
                          <div className="im-wtabs" role="tablist">
                            {combos.map((c) => {
                              const ck = ckOf(c.addr, c.key);
                              return (
                                <button
                                  key={ck}
                                  type="button"
                                  role="tab"
                                  aria-selected={ck === active}
                                  className={`im-wtab${ck === active ? " on" : ""}`}
                                  onClick={() => setActiveTab(ck)}
                                >
                                  {walletNameOf(c.addr)} · {pkgLabelOf(c.addr, c.key)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {active && renderForms(active)}
                      </div>
                    );
                  })()
                )}
                {error && <div className="publish-error">{error}</div>}
              </div>
              <div className="im-actions">
                <button type="button" className="sec" onClick={() => setWalletStep("select")}>
                  {ko ? "← 이전" : "← Back"}
                </button>
                <button type="button" className="pri" disabled={busy || walletParamsInvalid} onClick={submitWallets}>
                  {busy ? (ko ? "저장 중…" : "Saving…") : ko ? "저장" : "Save"}
                </button>
              </div>
            </>
          )
        ) : (
          <>
            {head}
            <div className="im-body">
              <p className="im-sub">{ko ? "라이브러리 설정을 골라주세요." : "Library options."}</p>
              {libraryIsSet ? (
                <div className="im-infocard">
                  <Glyph d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8" size={20} color="var(--blue-700)" sw={1.7} />
                  <div className="im-infocard-tx">
                    <b>{ko ? "패키지로 묶여 저장" : "Saved as a package"}</b>
                    <span>{ko ? "정책들이 하나의 패키지로 라이브러리에 저장돼요." : "Policies are saved as one library package."}</span>
                  </div>
                </div>
              ) : (
                <div className="im-folderrow">
                  <span className="im-foldlabel">{ko ? "폴더" : "Folder"}</span>
                  <div className="im-pkgchips">
                    {libPackages.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`im-pkgchip${packageId === p.id ? " on" : ""}`}
                        onClick={() => setPackageId(p.id)}
                      >
                        {p.displayName}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`im-pkgchip new${packageId === "__new__" ? " on" : ""}`}
                      onClick={() => setPackageId("__new__")}
                    >
                      {ko ? "+ 새 폴더" : "+ New"}
                    </button>
                  </div>
                </div>
              )}
              {packageId === "__new__" && !libraryIsSet && (
                <input
                  className="im-textfield"
                  value={newPackageName}
                  onChange={(e) => setNewPackageName(e.target.value)}
                  placeholder={ko ? "새 폴더 이름" : "Folder name"}
                />
              )}
              {renderForms(undefined)}
              {error && <div className="publish-error">{error}</div>}
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={() => setKind(null)}>
                {ko ? "← 이전" : "← Back"}
              </button>
              <button type="button" className="pri" disabled={busy || libraryInvalid} onClick={submitLibrary}>
                {busy ? (ko ? "저장 중…" : "Saving…") : ko ? "저장" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
