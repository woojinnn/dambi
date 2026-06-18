// @ts-nocheck
import * as React from "react";

import * as PS from "./mockStore";
import { pushToast } from "./shell";
import { ShieldIcon, XIcon, LockIcon, SearchIcon, shortAddr } from "./icons";

/* ════════════════════ SaveScope Modal ════════════════════ */
export const WALLET_FOLDER_UNCAT = "__uncat__";

export function SaveScopeModal({ open, policyName, wallets, packages, busy, onCancel, onConfirm, defaultKind, defaultWalletAddrs }) {
  const UNCAT = PS.UNCATEGORIZED_PKG;
  const [kind, setKind] = React.useState(null);
  const [nameDraft, setNameDraft] = React.useState(policyName);
  const [picked, setPicked] = React.useState(new Set());
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
      setPicked(defaultKind === "wallet" && defaultWalletAddrs && defaultWalletAddrs.length ? new Set(defaultWalletAddrs) : new Set());
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
  const pkgList = packages.some((p) => p.id === UNCAT) ? packages : [{ id: UNCAT, displayName: "미분류" }, ...packages];

  const togglePick = (addr) =>
    setPicked((prev) => {
      const n = new Set(prev);
      n.has(addr) ? n.delete(addr) : n.add(addr);
      return n;
    });
  const pkgOf = (addr) => walletPkg[addr] ?? WALLET_FOLDER_UNCAT;
  const bindPkgOf = (addr) => walletBindPkg[addr] ?? UNCAT;
  const invalid =
    !nameDraft.trim() ||
    (kind === "wallet"
      ? picked.size === 0 || (applyNow ? false : bulk ? !bulkName.trim() : [...picked].some((a) => pkgOf(a) === "__new__" && !(walletNewName[a] ?? "").trim()))
      : packageId === "__new__" && !newPackageName.trim());

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
      ...(packageId === "__new__" ? { newPackageName: newPackageName.trim() } : {}),
      applyToNewWallets,
    });
  };

  return (
    <div className="ptm-bd" role="dialog" aria-modal onClick={busy ? undefined : onCancel}>
      <div className="ptm" onClick={(e) => e.stopPropagation()}>
        {kind === null ? (
          <>
            <div className="ptm-h">
              <div className="ptm-t">어떤 정책으로 저장할까요?</div>
              <div className="ptm-s">처음 저장하는 정책이에요 — 이름부터 정해주세요.</div>
            </div>
            <label className="ssm-name">
              <span>정책 이름</span>
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="예: 3달러 초과 스왑 시 차단" maxLength={120} />
            </label>
            <div className="ptm-opts">
              <button type="button" className="ptm-opt" disabled={wallets.length === 0} onClick={() => setKind("wallet")}>
                <span className="ptm-opt-t">지갑 전용 정책</span>
                <span className="ptm-opt-d">선택한 지갑에만 적용돼요 — 라이브러리에는 보이지 않는 일회용 정책이에요.{wallets.length === 0 ? " (등록된 지갑이 없어요)" : ""}</span>
              </button>
              <button type="button" className="ptm-opt" onClick={() => setKind("library")}>
                <span className="ptm-opt-t">라이브러리 정책</span>
                <span className="ptm-opt-d">지갑 간 공유되는 템플릿으로 저장돼요 — 지갑별 정책에서 언제든 적용할 수 있어요.</span>
              </button>
              <div className="ptm-row">
                <button type="button" className="ev2-sec" onClick={onCancel} disabled={busy}>취소</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="ptm-h">
              <div className="ptm-t">{kind === "wallet" ? "어느 지갑에 적용할까요?" : "라이브러리 설정"}</div>
              <div className="ptm-s">
                <b>{nameDraft.trim() || policyName}</b> — {kind === "wallet" ? (applyNow ? "선택한 지갑에 지금 바로 적용돼요. 분류는 패키지에서 고를 수 있어요(기본 미분류)." : "적용하지 않고 전용 폴더에 초안으로만 저장돼요 — 나중에 지갑별 정책에서 켜면 돼요.") : "라이브러리에 템플릿으로 저장돼요."}
              </div>
            </div>
            <div className="ptm-opts">
              {kind === "wallet" && (
                <>
                  <div className="ssm-wallets">
                    {wallets.map((w) => (
                      <div key={w.address}>
                        <label className="ptm-field">
                          <input type="checkbox" checked={picked.has(w.address)} onChange={() => togglePick(w.address)} />
                          <span className="ssm-addr">{w.label ?? w.address}</span>
                        </label>
                        {picked.has(w.address) && applyNow && (
                          <div className="ssm-pkgrow">
                            <span className="ssm-pkglabel">패키지</span>
                            <select value={bindPkgOf(w.address)} onChange={(e) => setWalletBindPkg((m) => ({ ...m, [w.address]: e.target.value }))}>
                              <option value={UNCAT}>미분류</option>
                              {(w.packages || []).map((p) => (<option key={p.id} value={p.id}>{p.displayName}</option>))}
                            </select>
                          </div>
                        )}
                        {picked.has(w.address) && !applyNow && !bulk && (
                          <div className="ssm-pkgrow">
                            <span className="ssm-pkglabel">폴더</span>
                            <select value={pkgOf(w.address)} onChange={(e) => setWalletPkg((m) => ({ ...m, [w.address]: e.target.value }))}>
                              <option value={WALLET_FOLDER_UNCAT}>미분류</option>
                              {(w.folders || []).map((f) => (<option key={f.id} value={f.id}>{f.displayName}</option>))}
                              <option value="__new__">+ 새 폴더…</option>
                            </select>
                            {pkgOf(w.address) === "__new__" && (
                              <input value={walletNewName[w.address] ?? ""} onChange={(e) => setWalletNewName((m) => ({ ...m, [w.address]: e.target.value }))} placeholder="새 폴더 이름" />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {!applyNow && (
                    <>
                      <label className="ptm-field">
                        <input type="checkbox" checked={bulk} onChange={(e) => { setBulk(e.target.checked); if (e.target.checked) setPicked(new Set(allAddresses)); }} />
                        모든 지갑에 같은 이름의 새 폴더 만들기
                      </label>
                      {bulk && (
                        <>
                          <label className="ptm-field"><input autoFocus value={bulkName} onChange={(e) => setBulkName(e.target.value)} placeholder="새 폴더 이름" /></label>
                          {bulkCollisions.length > 0 && <div className="ssm-info">같은 이름의 폴더가 이미 있는 지갑은 그 폴더에 넣어요: {bulkCollisions.map(shortAddr).join(", ")}</div>}
                        </>
                      )}
                    </>
                  )}
                  <label className="ptm-field ssm-applynow">
                    <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} />
                    <span>
                      <b>저장하면서 지금 바로 켜기</b>
                      <small>{applyNow ? `선택한 지갑에 곧장 적용돼요.` : "끄면 전용 폴더에 초안으로만 저장(나중에 적용)."}</small>
                    </span>
                  </label>
                </>
              )}
              {kind === "library" && (
                <>
                  <label className="ptm-field">
                    패키지
                    <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                      {pkgList.map((p) => (<option key={p.id} value={p.id}>{p.displayName}</option>))}
                      <option value="__new__">+ 새 패키지…</option>
                    </select>
                  </label>
                  {packageId === "__new__" && <label className="ptm-field"><input autoFocus value={newPackageName} onChange={(e) => setNewPackageName(e.target.value)} placeholder="새 패키지 이름" /></label>}
                  <label className="ptm-field"><input type="checkbox" checked={applyToAllNow} disabled={wallets.length === 0} onChange={(e) => setApplyToAllNow(e.target.checked)} /> 지금 모든 지갑에 적용 ({wallets.length}개)</label>
                  <label className="ptm-field"><input type="checkbox" checked={applyToNewWallets} onChange={(e) => setApplyToNewWallets(e.target.checked)} /> 앞으로 추가되는 지갑에도 기본 적용</label>
                </>
              )}
              <div className="ptm-row">
                <button type="button" className="ev2-sec" onClick={() => setKind(null)} disabled={busy}>← 이전</button>
                <button type="button" className="ev2-pri" onClick={confirm} disabled={invalid || busy}>{busy ? "저장 중…" : "저장"}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ════════════════════ Publish Modal ════════════════════ */
function extractHoles(cedarText) {
  const holes = [];
  let i = 0;
  (cedarText.match(/0x[0-9a-fA-F]{40}/g) || []).forEach((a) => {
    holes.push({ key: "a" + i++, kind: "address", path: "주소", label: "주소", display: shortAddr(a), raw: a, paramName: "addr_" + i });
  });
  (cedarText.match(/[<>]=?\s*(\d+(?:\.\d+)?)/g) || []).forEach((m) => {
    const num = m.replace(/[<>=\s]/g, "");
    holes.push({ key: "n" + i++, kind: "number", path: "임계값", label: "임계값", display: num, paramName: "threshold_" + i });
  });
  (cedarText.match(/decimal\("(\d+(?:\.\d+)?)"\)/g) || []).forEach((m) => {
    const num = m.match(/"([^"]+)"/)[1];
    holes.push({ key: "d" + i++, kind: "number", path: "임계값(decimal)", label: "임계값", display: num, paramName: "threshold_" + i });
  });
  return holes;
}

export function PublishModal({ open, onClose, source }) {
  const [step, setStep] = React.useState(1);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [kept, setKept] = React.useState(new Set());
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
      setKept(new Set());
      setDone(false);
    }
  }, [open]);

  if (!open || !source) return null;
  const toggleKeep = (key) =>
    setKept((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const seededName = name || source.suggestedDisplayName;
  const publish = () => {
    setDone(true);
    pushToast(`'${seededName}'을(를) Policy Hub에 공개했어요`);
    setTimeout(onClose, 700);
  };
  const steps = [{ n: 1, label: "비식별 확인" }, { n: 2, label: "이름·설명" }, { n: 3, label: "공개" }];

  return (
    <div className="pub-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pub-modal" role="dialog" aria-modal>
        <header className="pub-head">
          <span className="pub-head-ic"><ShieldIcon width={16} height={16} /></span>
          <div className="pub-head-t">
            <div className="pub-title">Policy Hub에 올리기</div>
            <div className="pub-sub">내가 큐레이션한 패키지를 공개해 다른 사용자가 담을 수 있게 합니다.</div>
          </div>
          <button type="button" className="pub-x" onClick={onClose} aria-label="닫기"><XIcon width={16} height={16} /></button>
        </header>
        <div className="pub-stepper">
          {steps.map((s, i) => (
            <div key={s.n} className="pub-step-wrap">
              <div className={`pub-step${step === s.n ? " on" : ""}${step > s.n ? " done" : ""}`}>
                <span className="pub-step-n">{step > s.n ? "✓" : s.n}</span>
                <span className="pub-step-l">{s.label}</span>
              </div>
              {i < steps.length - 1 && <span className="pub-step-line" />}
            </div>
          ))}
        </div>
        <div className="pub-body">
          {step === 1 ? (
            <>
              <div className="pub-info">
                <LockIcon width={14} height={14} />
                <div>
                  <b>개인정보 자동 비식별 (기본)</b>
                  <div>주소류 식별자는 기본으로 <b>파라미터 구멍으로 비워서</b> 올라가고, 담는 사람이 자기 값을 채웁니다. 주소가 정책의 본질이면 칸별로 <b>값 공개</b>를 선택할 수 있어요.</div>
                </div>
              </div>
              <div className="pub-chips">
                <span className="pub-chip"><SearchIcon width={14} height={14} /> 주소류 (기본 비움) · {blankedAddrCount}</span>
                {keptAddrCount > 0 && <span className="pub-chip warn"># 주소 공개 · {keptAddrCount}</span>}
                <span className="pub-chip"># 숫자 임계값 (선택) · {numberHoles.length}</span>
              </div>
              <div className="pub-rules">
                {rules.map((r) => (
                  <div key={r.ruleId} className="pub-rule">
                    <div className="pub-rule-head">
                      <span className="pub-rule-dot" />
                      <span className="pub-rule-title">{r.title}</span>
                      <span className="pub-rule-id">{r.ruleId}</span>
                    </div>
                    {r.holes.map((h) =>
                      h.kind === "address" ? (
                        <div key={h.key} className={`pub-field${kept.has(h.key) ? " kept" : ""}`}>
                          <span className="pub-field-ic addr"><SearchIcon width={14} height={14} /></span>
                          <div className="pub-field-main">
                            <div className="pub-field-label">{h.label} <code>{h.display}</code></div>
                            <div className="pub-field-val">{kept.has(h.key) ? (<><span>{h.display}</span><span className="arrow">→</span><span className="param public">Policy Hub에 공개</span></>) : (<><span className="redacted">{h.display}</span><span className="arrow">→</span><span className="param">{h.paramName}</span></>)}</div>
                          </div>
                          <div className="pub-numtoggle pub-addrtoggle">
                            <button type="button" className={!kept.has(h.key) ? "on" : ""} onClick={() => kept.has(h.key) && toggleKeep(h.key)}>비우기<small>{h.paramName}</small></button>
                            <button type="button" className={kept.has(h.key) ? "on public" : ""} onClick={() => !kept.has(h.key) && toggleKeep(h.key)}>값 공개<small>{h.display}</small></button>
                          </div>
                        </div>
                      ) : (
                        <div key={h.key} className="pub-field">
                          <span className="pub-field-ic num">#</span>
                          <div className="pub-field-main">
                            <div className="pub-field-label">{h.label} <code>{h.path}</code></div>
                            <div className="pub-field-sub">원작자가 쓴 값 <b>{h.display}</b></div>
                          </div>
                          <div className="pub-numtoggle">
                            <button type="button" className={!kept.has(h.key) ? "on" : ""} onClick={() => kept.has(h.key) && toggleKeep(h.key)}>비우기<small>{h.paramName}</small></button>
                            <button type="button" className={kept.has(h.key) ? "on" : ""} onClick={() => !kept.has(h.key) && toggleKeep(h.key)}>추천값 남기기<small>{h.display}</small></button>
                          </div>
                        </div>
                      ),
                    )}
                    {r.holes.length === 0 && <div className="pub-rule-clean">비식별할 식별자가 없어요.</div>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="pub-l">패키지 이름</label>
              <input className="pub-input" value={seededName} onChange={(e) => setName(e.target.value)} maxLength={120} />
              <label className="pub-l">설명</label>
              <textarea className="pub-textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} placeholder="이 패키지가 무엇을 막아주는지 간단히 적어주세요" />
              <div className="pub-summary">
                <div className="pub-summary-t">공개될 내용</div>
                <div className="pub-summary-row"><span>정책 수</span><b>{rules.length}개</b></div>
                <div className="pub-summary-row"><span>주소 구멍(비식별)</span><b>{blankedAddrCount}</b></div>
                {keptAddrCount > 0 && <div className="pub-summary-row warn"><span>주소 공개</span><b>{keptAddrCount}</b></div>}
                <div className="pub-summary-row"><span>추천값 남김</span><b>{numberHoles.filter((h) => kept.has(h.key)).length} / {numberHoles.length}</b></div>
              </div>
              <div className="pub-note"><ShieldIcon width={16} height={16} /> 공개 = 누구나 Policy Hub에서 담을 수 있음. 비공개로 되돌릴 수 있어요.</div>
            </>
          )}
        </div>
        <footer className="pub-foot">
          {step === 1 ? (
            <>
              {keptAddrCount > 0 ? <span className="pub-foot-note warn">주소 {keptAddrCount}칸이 Policy Hub에 공개로 올라갑니다</span> : <span className="pub-foot-note">주소류는 기본 비워집니다 · 칸별로 공개 선택 가능</span>}
              <button type="button" className="pub-btn ghost" onClick={onClose}>취소</button>
              <button type="button" className="pub-btn primary" onClick={() => setStep(2)}>다음 ›</button>
            </>
          ) : (
            <>
              <button type="button" className="pub-btn ghost" onClick={() => setStep(1)}>‹ 뒤로</button>
              <span className="pub-spc" />
              <button type="button" className="pub-btn publish" onClick={publish} disabled={done}><ShieldIcon width={16} height={16} />{done ? "공개 중…" : "Policy Hub에 공개"}</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
