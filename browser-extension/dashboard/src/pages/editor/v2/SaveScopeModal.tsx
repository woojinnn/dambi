import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { UNCATEGORIZED_PKG, type HoleValue, type PackageDef } from "../../../server-api/policy-store";
import { PolicyFormPane } from "./PolicyFormPane";
import { diffParamValues } from "../../../cedar/form/parameterize";
import type { FormModel } from "../../../cedar/form";
import type { SaveScope } from "./save-def";

export interface SaveScopeChoice {
  /** 저장할 정책 이름 — 모달에서 확정한다. */
  name: string;
  scope: SaveScope;
  /** 라이브러리 경로의 폴더(또는 "__new__"). */
  packageId: string | "__new__";
  newPackageName?: string;
  applyToNewWallets: boolean;
  /** 지갑 경로(scope.kind==="wallets"): 지갑별 선택 패키지 키 목록(다중).
   *  키 = 패키지 id | UNCATEGORIZED_PKG | "__new__". 빈 배열 = 그 지갑은 라이브러리만. */
  walletPackages?: Record<string, string[]>;
  walletNewName?: Record<string, string>;
  /** (지갑·패키지) 조합별 파라미터 — 키 `${addr}|${pkgKey}`. */
  paramsByCombo?: Record<string, Record<string, HoleValue>>;
}

export interface ModalWallet {
  address: string;
  label?: string | undefined;
  /** 이 지갑이 이미 가진 패키지들. */
  packages: { id: string; displayName: string }[];
}

type Kind = "wallet" | "library";

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** 신규 정책 첫 저장 모달 — ① 지갑 전용 설정 vs 라이브러리, ② 세부.
 *  지갑 경로: 템플릿은 라이브러리에 저장(숨김 아님) + 선택한 (지갑·패키지)
 *  조합마다 값을 따로 채워 바인딩. 패키지 미선택 지갑은 라이브러리에만. */
export function SaveScopeModal(props: {
  open: boolean;
  policyName: string;
  wallets: ModalWallet[];
  packages: PackageDef[];
  /** 파라미터 폼 기준 모델(폼으로 못 여는 정책이면 null → 파라미터 단계 생략). */
  baseModel: FormModel | null;
  baseManifest: unknown;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (choice: SaveScopeChoice) => void;
}) {
  const { open, policyName, wallets, packages, baseModel, baseManifest, busy, onCancel, onConfirm } = props;
  const { t } = useTranslation("editor");
  const [kind, setKind] = useState<Kind | null>(null);
  const [nameDraft, setNameDraft] = useState(policyName);
  useEffect(() => {
    if (open) {
      setNameDraft(policyName);
      setKind(null);
      setWalletStep("select");
      setPicked(new Set());
      setWalletPkgSel({});
    }
  }, [open, policyName]);

  // 지갑 경로.
  const [walletStep, setWalletStep] = useState<"select" | "params">("select");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [walletPkgSel, setWalletPkgSel] = useState<Record<string, string[]>>({});
  const [walletNewName, setWalletNewName] = useState<Record<string, string>>({});
  // 라이브러리 경로.
  const [packageId, setPackageId] = useState<string | "__new__">(UNCATEGORIZED_PKG);
  const [newPackageName, setNewPackageName] = useState("");
  const [applyToNewWallets, setApplyToNewWallets] = useState(true);
  const [applyToAllNow, setApplyToAllNow] = useState(false);

  // 파라미터 폼: (지갑·패키지) 조합별 편집 모델 ref + 유효성.
  const comboModelsRef = useRef<Record<string, FormModel>>({});
  const [comboValidity, setComboValidity] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const allAddresses = useMemo(() => wallets.map((w) => w.address), [wallets]);
  const selOf = (addr: string) => walletPkgSel[addr] ?? [];
  const toggleWalletPkg = (addr: string, key: string) =>
    setWalletPkgSel((m) => {
      const cur = m[addr] ?? [];
      return { ...m, [addr]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });
  const combos = useMemo(
    () => [...picked].flatMap((a) => selOf(a).map((key) => ({ addr: a, key }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, walletPkgSel],
  );
  const comboKey = (addr: string, key: string) => `${addr}|${key}`;
  const walletNameOf = (a: string) => wallets.find((w) => w.address === a)?.label?.trim() || shortAddr(a);
  const pkgLabelOf = (addr: string, key: string) => {
    if (key === "__new__") return (walletNewName[addr] ?? "").trim() || t("saveScope.newFolderOption");
    if (key === UNCATEGORIZED_PKG) return t("editor2.uncatName");
    return wallets.find((w) => w.address === addr)?.packages.find((p) => p.id === key)?.displayName ?? key;
  };

  if (!open) return null;

  const hasParams = !!baseModel && (baseModel.when.length > 0 || baseModel.unless.length > 0);
  const paramsForCombo = (ck: string): Record<string, HoleValue> => {
    if (!baseModel) return {};
    const edited = comboModelsRef.current[ck];
    if (!edited) return {};
    return diffParamValues(baseModel, edited);
  };

  const togglePick = (addr: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(addr)) n.delete(addr);
      else n.add(addr);
      return n;
    });

  const walletSelectionInvalid =
    !nameDraft.trim() ||
    picked.size === 0 ||
    [...picked].some((a) => selOf(a).includes("__new__") && !(walletNewName[a] ?? "").trim());
  const walletParamsInvalid = combos.some(({ addr, key }) => comboValidity[comboKey(addr, key)] === false);
  const libraryInvalid = !nameDraft.trim() || (packageId === "__new__" && !newPackageName.trim());

  const confirmWallet = () => {
    const walletPackages: Record<string, string[]> = {};
    for (const a of picked) walletPackages[a] = selOf(a);
    const paramsByCombo: Record<string, Record<string, HoleValue>> = {};
    for (const { addr, key } of combos) {
      const ck = comboKey(addr, key);
      const p = paramsForCombo(ck);
      if (Object.keys(p).length) paramsByCombo[ck] = p;
    }
    onConfirm({
      name: nameDraft.trim(),
      scope: { kind: "wallets", addresses: [...picked] },
      packageId: UNCATEGORIZED_PKG,
      applyToNewWallets: false,
      walletPackages,
      walletNewName,
      paramsByCombo,
    });
  };

  const confirmLibrary = () =>
    onConfirm({
      name: nameDraft.trim(),
      scope: applyToAllNow
        ? { kind: "all-wallets", addresses: allAddresses }
        : { kind: "library-only" },
      packageId,
      ...(packageId === "__new__" ? { newPackageName: newPackageName.trim() } : {}),
      applyToNewWallets,
    });

  /** (지갑·패키지) 조합 하나의 파라미터 폼. */
  const renderComboForm = (ck: string) => {
    if (!baseModel) {
      return <div className="ssm-noparams">{t("editor2.modal.noValues")}</div>;
    }
    const seeded = comboModelsRef.current[ck] ?? baseModel;
    return (
      <PolicyFormPane
        key={ck}
        initialModel={seeded}
        initialManifest={baseManifest}
        valuesOnly
        compact
        onChange={({ model }) => (comboModelsRef.current[ck] = model)}
        onValidity={({ valid }) => setComboValidity((m) => ({ ...m, [ck]: valid }))}
      />
    );
  };

  return (
    <div className="ptm-bd" role="dialog" aria-modal onClick={busy ? undefined : onCancel}>
      <div className={`ptm${kind === "wallet" && walletStep === "params" && hasParams ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        {kind === null ? (
          <>
            <div className="ptm-h">
              <div className="ptm-t">{t("saveScope.title1")}</div>
              <div className="ptm-s">{t("saveScope.sub1")}</div>
            </div>
            <label className="ssm-name">
              <span>{t("saveScope.nameLabel")}</span>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={t("saveScope.namePlaceholder")}
                maxLength={120}
              />
            </label>
            <div className="ptm-opts">
              <button
                type="button"
                className="ptm-opt"
                disabled={wallets.length === 0}
                onClick={() => {
                  setWalletStep("select");
                  setKind("wallet");
                }}
              >
                <span className="ptm-opt-t">{t("saveScope.walletOptTitle")}</span>
                <span className="ptm-opt-d">
                  {t("saveScope.walletOptDesc")}
                  {wallets.length === 0 ? t("saveScope.noWalletsSuffix") : ""}
                </span>
              </button>
              <button type="button" className="ptm-opt" onClick={() => setKind("library")}>
                <span className="ptm-opt-t">{t("saveScope.libOptTitle")}</span>
                <span className="ptm-opt-d">{t("saveScope.libOptDesc")}</span>
              </button>
              <div className="ptm-row">
                <button type="button" className="ev2-sec" onClick={onCancel} disabled={busy}>
                  {t("common:cancel")}
                </button>
              </div>
            </div>
          </>
        ) : kind === "wallet" ? (
          walletStep === "select" ? (
            <>
              <div className="ptm-h">
                <div className="ptm-t">{t("saveScope.title2Wallet")}</div>
                <div className="ptm-s">
                  <b>{nameDraft.trim() || policyName}</b> — {t("saveScope.sub2Wallet")}
                </div>
              </div>
              <div className="ptm-opts">
                <div className="ssm-wcards">
                  {wallets.map((w) => {
                    const on = picked.has(w.address);
                    const sels = selOf(w.address);
                    return (
                      <div key={w.address} className={`ssm-wcard${on ? " on" : ""}`}>
                        <label className="ssm-wrow">
                          <input type="checkbox" checked={on} onChange={() => togglePick(w.address)} />
                          <span className="ssm-wname">{w.label?.trim() || shortAddr(w.address)}</span>
                        </label>
                        {on && (
                          <div className="ssm-pkgsel">
                            <span className="ssm-pkglabel">{t("saveScope.folderLabel")}</span>
                            <div className="ssm-chips">
                              <button
                                type="button"
                                className={`ssm-chip${sels.includes(UNCATEGORIZED_PKG) ? " on" : ""}`}
                                onClick={() => toggleWalletPkg(w.address, UNCATEGORIZED_PKG)}
                              >
                                {t("editor2.uncatName")}
                              </button>
                              {w.packages.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className={`ssm-chip${sels.includes(p.id) ? " on" : ""}`}
                                  onClick={() => toggleWalletPkg(w.address, p.id)}
                                >
                                  {p.displayName}
                                </button>
                              ))}
                              <button
                                type="button"
                                className={`ssm-chip new${sels.includes("__new__") ? " on" : ""}`}
                                onClick={() => toggleWalletPkg(w.address, "__new__")}
                              >
                                {t("saveScope.newFolderOption")}
                              </button>
                            </div>
                            {sels.includes("__new__") && (
                              <input
                                className="ssm-newpkg"
                                value={walletNewName[w.address] ?? ""}
                                onChange={(e) =>
                                  setWalletNewName((m) => ({ ...m, [w.address]: e.target.value }))
                                }
                                placeholder={t("saveScope.newFolderPlaceholder")}
                              />
                            )}
                            {sels.length === 0 && (
                              <span className="ssm-libnote">{t("saveScope.noPkgLibraryOnly")}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="ptm-row">
                  <button type="button" className="ev2-sec" onClick={() => setKind(null)} disabled={busy}>
                    {t("saveScope.back")}
                  </button>
                  <button
                    type="button"
                    className="ev2-pri"
                    onClick={() => setWalletStep("params")}
                    disabled={walletSelectionInvalid || busy}
                  >
                    {t("editor2.folder.next")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ptm-h">
                <div className="ptm-t">{t("saveScope.fillTitle")}</div>
                <div className="ptm-s">
                  {combos.length === 0
                    ? t("saveScope.noPkgLibraryOnly")
                    : hasParams
                      ? t("saveScope.fillSub")
                      : t("editor2.modal.noValues")}
                </div>
              </div>
              <div className="ptm-opts">
                {combos.length === 0 || !hasParams ? (
                  <div className="ssm-noparams">
                    {combos.length === 0 ? t("saveScope.noPkgLibraryOnly") : t("editor2.modal.noValues")}
                  </div>
                ) : (
                  (() => {
                    const tabKeys = combos.map((c) => comboKey(c.addr, c.key));
                    const active = activeTab && tabKeys.includes(activeTab) ? activeTab : tabKeys[0];
                    return (
                      <div className="ssm-params">
                        {tabKeys.length > 1 && (
                          <div className="ssm-tabs" role="tablist">
                            {combos.map((c) => {
                              const ck = comboKey(c.addr, c.key);
                              return (
                                <button
                                  key={ck}
                                  type="button"
                                  role="tab"
                                  aria-selected={ck === active}
                                  className={`ssm-tab${ck === active ? " on" : ""}`}
                                  onClick={() => setActiveTab(ck)}
                                >
                                  {walletNameOf(c.addr)} · {pkgLabelOf(c.addr, c.key)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {active && renderComboForm(active)}
                      </div>
                    );
                  })()
                )}
                <div className="ptm-row">
                  <button type="button" className="ev2-sec" onClick={() => setWalletStep("select")} disabled={busy}>
                    {t("saveScope.back")}
                  </button>
                  <button
                    type="button"
                    className="ev2-pri"
                    onClick={confirmWallet}
                    disabled={walletParamsInvalid || busy}
                  >
                    {busy ? t("saving") : t("common:save")}
                  </button>
                </div>
              </div>
            </>
          )
        ) : (
          <>
            <div className="ptm-h">
              <div className="ptm-t">{t("saveScope.title2Library")}</div>
              <div className="ptm-s">
                <b>{nameDraft.trim() || policyName}</b> — {t("saveScope.sub2Library")}
              </div>
            </div>
            <div className="ptm-opts">
              <label className="ptm-field">
                {t("saveScope.folder")}
                <select value={packageId} onChange={(e) => setPackageId(e.target.value as string | "__new__")}>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                  <option value="__new__">{t("saveScope.newFolderOption")}</option>
                </select>
              </label>
              {packageId === "__new__" && (
                <label className="ptm-field">
                  <input
                    autoFocus
                    value={newPackageName}
                    onChange={(e) => setNewPackageName(e.target.value)}
                    placeholder={t("saveScope.newFolderPlaceholder")}
                  />
                </label>
              )}
              <label className="ptm-field">
                <input
                  type="checkbox"
                  checked={applyToAllNow}
                  disabled={wallets.length === 0}
                  onChange={(e) => setApplyToAllNow(e.target.checked)}
                />
                {t("saveScope.applyAllNow", { count: wallets.length })}
              </label>
              <label className="ptm-field">
                <input
                  type="checkbox"
                  checked={applyToNewWallets}
                  onChange={(e) => setApplyToNewWallets(e.target.checked)}
                />
                {t("saveScope.applyToNew")}
              </label>
              <div className="ptm-row">
                <button type="button" className="ev2-sec" onClick={() => setKind(null)} disabled={busy}>
                  {t("saveScope.back")}
                </button>
                <button
                  type="button"
                  className="ev2-pri"
                  onClick={confirmLibrary}
                  disabled={libraryInvalid || busy}
                >
                  {busy ? t("saving") : t("common:save")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
