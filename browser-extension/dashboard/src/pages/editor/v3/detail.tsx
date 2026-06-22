// @ts-nocheck
import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";

import * as PS from "./mockStore";
import { Cedar } from "./cedar";
import { useOverview, Topbar, ToastStack, pushToast } from "./shell";
import { navigate, consumeNavState } from "./nav";
import { run, defUsageCount } from "./list";
import { catStyle, catLabel, shortAddr, CatIcon, ShieldIcon, WarnIcon } from "./icons";
import { PolicyFormPane } from "./formpane";
import { PublishModal, SaveScopeModal, WALLET_FOLDER_UNCAT } from "./modals";

/* ════════════════════ Editor Detail Page ════════════════════ */
function stripDashboardId(id) {
  return id.replace(/^def::/, "");
}
function defaultTab(method) {
  return method === "form" ? "form" : "cedar";
}

export function EditorDetailPageV2() {
  const snap = useOverview();
  const params = useParams();
  const [search] = useSearchParams();
  const id = params.id ? decodeURIComponent(params.id) : "";
  const storedDef = snap.library.defs[id] || null;

  const walletAddr = (search.get("wallet") || "").toLowerCase() || null;
  const bindingId = search.get("binding");
  const binding = walletAddr && bindingId ? snap.wallets.byAddress[walletAddr]?.bindings[bindingId] ?? null : null;
  const bindingCtx = storedDef && walletAddr && binding ? { address: walletAddr, binding } : null;

  const seed = React.useMemo(() => consumeNavStateOnce(id), [id]);
  const isNew = !storedDef && !!seed;

  const policy = React.useMemo(() => {
    if (storedDef) {
      const baseModel = storedDef.skeleton.model;
      let model = baseModel;
      if (bindingCtx) {
        model = bindingCtx.binding.modelOverride || Cedar.applyParams(baseModel, { ...storedDef.defaults.params, ...(bindingCtx.binding.params || {}) });
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
        manifest: storedDef.skeleton.manifest,
      };
    }
    if (seed) {
      return { id, displayName: seed.displayName, model: seed.model ? { ...seed.model, id: stripDashboardId(id) } : Cedar.emptyFormModel(stripDashboardId(id)), text: seed.cedarText, method: seed.method, cat: seed.cat, source: "mine" };
    }
    return null;
  }, [storedDef, seed, id, bindingCtx]);

  return (
    <>
      <Topbar here="Policy Editor" subtitle={policy ? policy.displayName : id || "…"} right={<button type="button" className="ev2-back" onClick={() => navigate("/editor")}>← 목록</button>} />
      <div className="ev2-detail-body">
        {!policy && (
          <div className="ev2-empty">
            <div className="big">정책을 찾을 수 없습니다</div>
            <div className="sm"><code>{id}</code><br /><button type="button" className="ev2-linkbtn" onClick={() => navigate("/editor")}>← 목록으로 돌아가기</button></div>
          </div>
        )}
        {policy && (
          <EditorBody
            key={`${policy.id}:${bindingCtx?.binding.id ?? ""}`}
            policy={policy}
            storedDef={storedDef}
            snap={snap}
            bindingCtx={bindingCtx}
            isNew={isNew}
            defaultScope={seed ? seed.defaultScope : null}
            defaultWallet={seed ? seed.defaultWallet : null}
            replaceCtx={seed ? seed.replace : null}
            initialTab={seed ? seed.initialTab : null}
            onSaved={() => {
              if (bindingCtx) return navigate("/editor");
              if (isNew) return navigate("/editor", { replace: true });
            }}
            onDeleted={() => navigate("/editor")}
          />
        )}
      </div>
      <ToastStack />
    </>
  );
}
const _seedCache = {};
function consumeNavStateOnce(id) {
  if (_seedCache[id] !== undefined) return _seedCache[id];
  const s = consumeNavState();
  const seed = s && s.newPolicy ? s.newPolicy : null;
  _seedCache[id] = seed;
  return seed;
}

function TabBtn({ label, active, badge, onClick }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={`ev2-tab${active ? " on" : ""}`} onClick={onClick}>
      {label}
      {badge && <span className="ev2-tab-soon">{badge}</span>}
    </button>
  );
}

function DocField({ label, hint, value, onChange }) {
  return (
    <label className="ev2-doc-field">
      <span className="ev2-doc-label">{label}</span>
      <textarea className="ev2-doc-input" value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={hint} />
    </label>
  );
}

function CedarPane({ value, readOnly, onChange }) {
  return (
    <div className="ev2-cedar-pane">
      <div className="ev2-cedar-toolbar">
        <span className="ev2-cedar-hint">
          {readOnly ? <>이 지갑 인스턴스의 값이 적용된 Cedar예요 — 읽기 전용. 값 수정은 폼 탭에서 해주세요.</> : <>Cedar 코드를 직접 편집합니다. 저장 시 자동으로 <code>@id</code> / <code>@severity</code> 주석이 갱신됩니다.</>}
        </span>
      </div>
      <textarea className="ev2-cedar-textarea" value={value} readOnly={readOnly} onChange={(e) => { if (!readOnly) onChange(e.target.value); }} spellCheck={false} autoCorrect="off" autoCapitalize="off" />
    </div>
  );
}

function EditorBody({ policy, storedDef, snap, bindingCtx, isNew, defaultScope, defaultWallet, replaceCtx, initialTab, onSaved, onDeleted }) {
  const [name, setName] = React.useState(policy.displayName);
  const [model, setModel] = React.useState(policy.model);
  const [cedarText, setCedarText] = React.useState(policy.text);
  const [manifest, setManifest] = React.useState(policy.manifest);
  // Merged enrichment registry last reported by the form pane — reused when this
  // page regenerates the manifest (LLM-apply) so modal-created custom fields survive.
  const [formRegistry, setFormRegistry] = React.useState(undefined);
  const [tab, setTab] = React.useState(initialTab && !bindingCtx ? initialTab : defaultTab(policy.method));
  const initialDoc = (storedDef && storedDef.doc) || {};
  const [docDefinition, setDocDefinition] = React.useState(initialDoc.definition || "");
  const [docScope, setDocScope] = React.useState(initialDoc.scope || "");
  const [docAudience, setDocAudience] = React.useState(initialDoc.audience || "");
  const [docUsedData, setDocUsedData] = React.useState(initialDoc.usedData || "");
  const [docOpen, setDocOpen] = React.useState(!!(initialDoc.definition || initialDoc.scope || initialDoc.audience || initialDoc.usedData));
  const docPayload = () => {
    const d = {
      definition: docDefinition.trim() || undefined,
      scope: docScope.trim() || undefined,
      audience: docAudience.trim() || undefined,
      usedData: docUsedData.trim() || undefined,
    };
    return d.definition || d.scope || d.audience || d.usedData ? d : undefined;
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
    if (!["deny", "warn", "info"].includes(severity)) throw new Error("심각도를 선택해 주세요 (차단/경고/정보)");
    if (!(fm.reason || "").trim()) throw new Error("사유가 비어 있어요 — 정책이 발동했을 때 사용자에게 보여줄 메시지예요. ③ '어떻게 알릴까요?'의 사유를 채워주세요.");
    const bad = Cedar.findInvalidModelDecimals(fm);
    if (bad.length > 0) throw new Error(`decimal 값 형식이 잘못됐어요: ${bad.map((v) => `"${v}"`).join(", ")} — 소수점이 꼭 필요해요 (예: 3 → 3.0, 소수점 아래 최대 4자리)`);
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
      await run("저장", () => PS.updateBinding({ address: bindingCtx.address, bindingId: bindingCtx.binding.id, patch: { modelOverride: fm, alias: name.trim() && name.trim() !== storedDef.displayName ? name.trim() : undefined } }));
      pushToast("이 지갑의 값을 저장했어요");
      return onSaved(policy.id);
    }
    if (!isNew && storedDef) {
      const usage = Object.values(snap.wallets.byAddress).reduce((n, w) => n + Object.values(w.bindings).filter((b) => b.defId === storedDef.id).length, 0);
      if (usage > 0) {
        const before = JSON.stringify(structureOf(storedDef.skeleton.model));
        const after = JSON.stringify(structureOf(fm));
        if (before !== after) {
          window.alert(`이 정책은 지갑 ${usage}곳에 적용돼 있어 구조를 바꿀 수 없어요.\n값(기본 파라미터)·이름·심각도는 바꿀 수 있어요. 구조가 다른 정책이 필요하면 복제하세요.`);
          setError("저장을 취소했어요");
          return;
        }
      }
    }
    if (isNew) {
      if (replaceCtx) {
        setBusy(true);
        try {
          await PS.putDef(mkDef({ id: policy.id, name: name.trim() || "untitled", cat: policy.cat, model: fm, manifest, doc: docPayload(), hidden: true, homeWallet: replaceCtx.address, enabled: false, packageId: undefined }));
          await PS.bindDef({ defId: policy.id, packageId: replaceCtx.packageId, addresses: [replaceCtx.address], enabled: true });
          await PS.removeBinding({ address: replaceCtx.address, bindingId: replaceCtx.bindingId });
          pushToast("새 정책으로 저장하고 기존 정책을 대체했어요");
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
    await run("저장", () => PS.putDef({ ...storedDef, displayName: name.trim() || "untitled", skeleton: { ...storedDef.skeleton, model: fm, manifest }, doc: docPayload(), updatedAtMs: Date.now() }));
    pushToast("저장했어요");
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
            await PS.putDef(mkDef({ id: defId, name: choice.name, cat: policy.cat, model: fm, manifest, doc: docPayload(), hidden: true, homeWallet: addr, walletFolderId: undefined, enabled: false, packageId: undefined }));
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
            await PS.putDef(mkDef({ id: defId, name: choice.name, cat: policy.cat, model: fm, manifest, doc: docPayload(), hidden: true, homeWallet: addr, walletFolderId: folderId, enabled: false, packageId: undefined }));
          }
          lastId = defId;
        }
      } else {
        let pkgId = choice.packageId;
        if (pkgId === "__new__") {
          pkgId = `pkg::${crypto.randomUUID()}`;
          await PS.putPackage({ id: pkgId, displayName: choice.newPackageName || "새 폴더", source: "mine", updatedAtMs: Date.now() });
        }
        const defId = `def::${slugify(choice.name)}`;
        await PS.putDef(mkDef({ id: defId, name: choice.name, cat: policy.cat, model: fm, manifest, doc: docPayload(), enabled: choice.applyToNewWallets, packageId: pkgId === PS.UNCATEGORIZED_PKG ? undefined : pkgId }));
        if (choice.scope.kind === "all-wallets") {
          for (const address of choice.scope.addresses) await PS.bindDef({ defId, packageId: PS.UNCATEGORIZED_PKG, addresses: [address] });
        }
      }
      pushToast("정책을 저장했어요");
      setScopeAsk(null);
      onSaved("");
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = () => {
    const extra = usageCount > 0 ? `\n${usageCount}개 지갑에서 함께 제거됩니다.` : "";
    if (!window.confirm(`정책 "${name}"을 삭제할까요?${extra}`)) return;
    run("삭제", () => PS.deleteDef(policy.id)).then((ok) => ok && onDeleted());
  };

  const openPublish = () => {
    try {
      prepare();
      setPublishOpen(true);
    } catch (e) {
      window.alert(String(e.message || e));
    }
  };

  const onFormChange = ({ cedarText: c, model: nextModel, manifest: nextManifest, registry }) => {
    setModel(nextModel);
    setCedarText(c);
    setManifest(nextManifest);
    // Reuse the form's merged registry when regenerating the manifest (e.g. the
    // LLM-apply path), so modal-created custom fields aren't rejected with noBinding.
    if (registry) setFormRegistry(registry);
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
    suggestedSlug: stripDashboardId(policy.id),
  };

  const modalWallets = React.useMemo(() => {
    return Object.keys(snap.wallets.byAddress).sort().map((address) => ({
      address,
      label: shortAddr(address),
      folders: Object.values(snap.wallets.byAddress[address]?.folders || {}).map((f) => ({ id: f.id, displayName: f.displayName })),
      packages: Object.values(snap.wallets.byAddress[address]?.packages || {}).map((p) => ({ id: p.id, displayName: p.displayName })),
    }));
  }, [snap]);
  const modalPackages = React.useMemo(() => Object.values(snap.library.packages), [snap]);

  const invalidSave = bindingCtx && !formValidity.valid;

  const applyLlmModel = async (m, warnings) => {
    const sev = ["deny", "warn", "info"].includes(m && m.severity) ? m.severity : (severity || "warn");
    const normalized = {
      trigger: (m && m.trigger) || { kind: "any" },
      when: Array.isArray(m && m.when) ? m.when : [],
      unless: Array.isArray(m && m.unless) ? m.unless : [],
      id: stripDashboardId(policy.id),
      severity: sev,
      reason: (m && m.reason) || "",
    };
    try {
      normalized.when = Cedar.normalizeSituations(normalized.when);
      normalized.unless = Cedar.normalizeSituations(normalized.unless);
    } catch (e) {
      throw new Error("LLM이 만든 정책 형식이 올바르지 않아요. 다시 시도해 주세요.");
    }
    setModel(normalized);
    setCedarText(Cedar.serializeCedar(normalized, normalized.id, normalized.severity, normalized.reason));
    setManifest(Cedar.generateManifest(normalized, formRegistry, { id: normalized.id, severity: normalized.severity }).manifest);
    setLlmWarn(warnings && warnings.length ? warnings.join(" · ") : null);
    setResetToken((t) => t + 1);
    setTab("form");
  };

  return (
    <div className="ev2-detail">
      <div className="ev2-detail-head">
        <div className="ev2-detail-title-row">
          <span className="ev2-cat-ic" style={cstyle.iconWrap}><CatIcon cat={policy.cat} /></span>
          <input className="ev2-detail-title" value={name} onChange={(e) => setName(e.target.value)} placeholder="정책 이름" />
          {isNew && !replaceCtx && (
            <button type="button" className={`ev2-badge-draft clickable${tab === "doc" ? " open" : ""}`} onClick={() => setTab("doc")} title="정책 소개 편집">
              새 정책 · 저장해야 적용됩니다
              <svg className="ev2-badge-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          )}
          {policy.cat && <span className="ev2-cat-tag" style={cstyle.tag}>{catLabel(policy.cat)}</span>}
        </div>

        <div className="ev2-detail-meta">
          {replaceCtx && <span className="ev2-badge-fork">⚠ 구조 편집 — 액션·조건을 바꿔 저장하면 새 정책으로 만들어지고, 이 패키지의 기존 «{replaceCtx.oldName}» 정책은 사라져요</span>}
          {bindingCtx && <span className="ev2-badge-draft">{bindingCtx.address.slice(0, 6)}…{bindingCtx.address.slice(-4)} 지갑의 인스턴스 편집 — 값 변경은 이 지갑에만 적용돼요</span>}
          {fromMarket && <span className="ev2-detail-prov"><ShieldIcon />Policy Hub에서 가져옴{policy.sourceVersion ? ` · ${policy.sourceVersion}` : ""}</span>}
        </div>

        <div className="ev2-detail-tabs" role="tablist">
          {!bindingCtx && <TabBtn label="정책 소개" active={tab === "doc"} onClick={() => setTab("doc")} />}
          <TabBtn label="폼" active={tab === "form"} onClick={() => setTab("form")} />
          {!bindingCtx && <TabBtn label="LLM" active={tab === "llm"} onClick={() => setTab("llm")} />}
          <TabBtn label="Cedar" active={tab === "cedar"} badge={bindingCtx ? "읽기 전용" : undefined} onClick={() => setTab("cedar")} />
          <span className="ev2-spc" />
          {!bindingCtx && <button type="button" className="ev2-pri ghost" onClick={openPublish} title="Policy Hub에 올리기"><ShieldIcon /> Policy Hub에 올리기</button>}
          {!bindingCtx && <button type="button" className="ev2-pri danger" onClick={doDelete}>삭제</button>}
          <button
            type="button"
            className={`ev2-pri${invalidSave ? " invalid" : ""}`}
            title={invalidSave ? "형식이 맞지 않아요 — 누르면 변경 전 상태로 되돌립니다" : undefined}
            onClick={() => {
              if (invalidSave) {
                setRevertNotice(`형식이 맞지 않아 저장하지 않고 변경 전 상태로 되돌렸어요${formValidity.error ? ` (${formValidity.error})` : ""}.`);
                setResetToken((t) => t + 1);
                return;
              }
              setRevertNotice(null);
              doSave();
            }}
            disabled={busy || !cedarText.trim()}
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      {error && <div className="ev2-err-banner"><WarnIcon />{error}</div>}
      {revertNotice && <div className="ev2-err-banner warn"><WarnIcon />{revertNotice}</div>}
      {llmWarn && <div className="ev2-err-banner warn"><WarnIcon />참고: {llmWarn}</div>}

      <div className="ev2-detail-tabbody">
        {tab === "cedar" && <CedarPane value={cedarText} readOnly={!!bindingCtx} onChange={onCedarChange} />}
        {tab === "form" && (
          <PolicyFormPane
            key={`${policy.id}:${bindingCtx?.binding.id ?? ""}:${resetToken}`}
            initialModel={model}
            initialManifest={policy.manifest}
            valuesOnly={!!bindingCtx}
            onValidity={setFormValidity}
            resetToken={resetToken}
            onChange={onFormChange}
          />
        )}
        {tab === "llm" && !bindingCtx && <LlmPane onModel={applyLlmModel} />}
        {tab === "doc" && !bindingCtx && (
          <div className="ev2-doc-pane">
            <div className="ev2-doc-pane-head">
              <div className="t">정책 소개</div>
              <div className="s">Policy Hub에 올릴 때 함께 보여지는 설명이에요. 비워두어도 저장돼요.</div>
            </div>
            <div className="ev2-detail-doc">
              <DocField label="정의 (한 줄 소개)" hint="이 정책이 무엇을 막는지 한 줄로" value={docDefinition} onChange={setDocDefinition} />
              <DocField label="적용 범위" hint="어떤 거래·상황에 적용되는지" value={docScope} onChange={setDocScope} />
              <DocField label="대상 사용자" hint="누구에게 권장하는 정책인지" value={docAudience} onChange={setDocAudience} />
              <DocField label="사용하는 데이터" hint="외부 조회·보강 데이터가 있다면" value={docUsedData} onChange={setDocUsedData} />
            </div>
          </div>
        )}
      </div>

      <PublishModal open={publishOpen} source={publishSource} onClose={() => setPublishOpen(false)} />
      <SaveScopeModal
        open={scopeAsk !== null}
        policyName={name.trim() || "untitled"}
        wallets={modalWallets}
        packages={modalPackages}
        defaultKind={defaultScope === "wallet" ? "wallet" : defaultScope === "library" ? "library" : null}
        defaultWalletAddrs={defaultWallet ? [defaultWallet.toLowerCase()] : []}
        busy={busy}
        onCancel={() => setScopeAsk(null)}
        onConfirm={finishScope}
      />
    </div>
  );
}

/* ── LLM 탭 ── */
const LLM_EXAMPLES = [
  "스왑으로 산 토큰이 내 지갑이 아닌 다른 주소로 가면 차단",
  "토큰을 소각 주소(0x0…0 / 0x…dead)로 전송하면 차단",
  "무제한 승인(uint256/uint160 max)은 차단, 단 spender가 Permit2면 예외",
  "정체불명 블라인드 서명 요청은 경고",
];

async function llmDraftPolicy(intent) {
  if (!(window.claude && typeof window.claude.complete === "function")) {
    throw new Error("이 환경에서는 LLM 생성을 사용할 수 없어요. (백엔드 LLM 미연결)");
  }
  const actions = (Cedar.KNOWN_ACTIONS || []).map((a) => `${a.entityType}|${a.id} = ${a.label}`).join("\n");
  const fields = (Cedar.fieldsForTrigger() || []).map((f) => `${f.path} = ${f.label} [${f.fieldKind}${f.unit ? ", " + f.unit : ""}]`).join("\n");
  const prompt = [
    "당신은 DeFi 거래 보안 정책 빌더입니다. 사용자의 자연어 의도를 아래 FormModel JSON 으로 변환하세요.",
    "반드시 JSON 객체 하나만 출력하세요. 코드펜스/설명/주석 금지.",
    "",
    "FormModel 스키마:",
    '{ "trigger": {"kind":"actionEq","entityType":"<EntityType>","id":"<ActionId>"} | {"kind":"any"},',
    '  "when": [ Leaf | Group ], "unless": [ Leaf | Group ],',
    '  "severity": "deny" | "warn" | "info", "reason": "<사용자에게 보여줄 짧은 영어 메시지>" }',
    'Leaf = { "fieldPath":"<필드 path>", "op":"<연산자>", "value":<Value>, "joiner":"and"|"or" }',
    'Group = { "conds":[Leaf...], "joiner":"and"|"or" }',
    "연산자: == != < <= > >= in notIn contains notContains",
    'Value 종류: {"kind":"string","value":"..."} {"kind":"long","value":0} {"kind":"decimal","value":"0.0"} {"kind":"bool","value":true} {"kind":"set","values":["0x..."]} {"kind":"field","path":"principal.address"}',
    '주소 비교는 보통 context.recipient 등 address 필드. "내 지갑"은 {"kind":"field","path":"principal.address"} 로 표현.',
    "차단=deny, 경고=warn. reason 은 영어 한 문장.",
    "",
    "사용 가능한 trigger 액션 (EntityType|ActionId = 라벨):",
    actions,
    "",
    "사용 가능한 필드 (path = 라벨 [타입]):",
    fields,
    "",
    "사용자 의도: " + JSON.stringify(intent),
    "JSON:",
  ].join("\n");

  const raw = await window.claude.complete(prompt);
  let txt = String(raw || "").trim();
  const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
  if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
  let model;
  try { model = JSON.parse(txt); } catch (e) { throw new Error("LLM 응답을 해석하지 못했어요. 다시 시도해 주세요."); }
  const warnings = [];
  if (model && model.trigger && model.trigger.kind === "actionEq") {
    const ok = (Cedar.KNOWN_ACTIONS || []).some((x) => x.entityType === model.trigger.entityType && x.id === model.trigger.id);
    if (!ok) { warnings.push("LLM이 고른 동작을 찾지 못해 '모든 거래'로 두었어요 — 폼에서 골라주세요."); model.trigger = { kind: "any" }; }
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
    setBusy(true); setError(null);
    try {
      const { model, warnings } = await llmDraftPolicy(text);
      await onModel(model, warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="ev2-llm-pane">
      <div className="ev2-llm-card">
        <div className="ev2-llm-head">
          <span className="ev2-llm-spark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7z" /></svg>
          </span>
          <div className="ev2-llm-headtext">
            <div className="ev2-llm-title">정책을 자연어로 설명하세요</div>
            <div className="ev2-llm-sub">의도를 적으면 LLM이 정책으로 변환해 폼 탭에 넣어줘요. 변환 후 검토·수정할 수 있어요.</div>
          </div>
        </div>

        <div className={`ev2-llm-inputwrap${busy ? " busy" : ""}`}>
          <textarea
            className="ev2-llm-textarea"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="예: 스왑으로 산 토큰이 내 지갑이 아닌 다른 주소로 가면 차단"
            disabled={busy}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } }}
          />
          <div className="ev2-llm-inputbar">
            <button type="button" className="ev2-llm-gen" onClick={submit} disabled={busy || !intent.trim()}>
              {busy ? (
                <><span className="ev2-llm-spin" />변환 중…</>
              ) : (
                <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /></svg>정책 생성</>
              )}
            </button>
          </div>
        </div>

        {error && <div className="ev2-llm-error"><WarnIcon />{error}</div>}
      </div>
    </div>
  );
}

function slugify(s) {
  return (
    (s || "policy")
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "policy"
  ) + "-" + Math.random().toString(36).slice(2, 6);
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
    updatedAtMs: Date.now(),
  };
}
function structureOf(model) {
  const strip = (nodes) => nodes.map((n) => (Cedar.isGroupNode(n) ? { g: strip(n.conds) } : { f: n.fieldPath, o: n.op, k: n.value.kind, j: n.joiner }));
  return { trigger: model.trigger, when: strip(model.when), unless: strip(model.unless) };
}
