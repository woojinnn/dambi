import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { getListing, pickI18n, type ListingSummary } from "../server-api";
import { getDashboardSummary } from "../server-api/dashboard";
import { getOverview, UNCATEGORIZED_PKG, type HoleValue } from "../server-api/policy-store";
import { listWallets } from "../server-api/wallets";
import type { FormModel } from "../cedar/form";
import {
  diffParamValues,
  installFormDefs,
  installListingV2,
  installListingWalletOnlyV2,
  type InstallParams,
  type WalletPkgPick,
} from "./market-install-v2";
import {
  CATEGORY_COLOR,
  CategoryGlyph,
  categoryOf,
} from "./market-domain";
import { PolicyFormPane } from "./editor/v2/PolicyFormPane";
import type { MarketLocale } from "./market-locale";

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Inline SVG matching the prototype's `g(path, size, color, stroke)` helper. */
function Glyph({
  d,
  size,
  color = "currentColor",
  sw = 1.8,
}: {
  d: string;
  size: number;
  color?: string;
  sw?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const CHEVRON = "M9 6l6 6-6 6";

/** "받기" 모달 v3 — 프로토타입 MK_v2 im-* 마크업(헤드/스코프/지갑/스위치/성공)에
 *  맞춘 구조. 상태·핸들러·설치 API(installListingV2 / installListingWalletOnlyV2)와
 *  required-hole 입력 폼은 그대로 유지한다(실제 백엔드 연결). */
export function MarketInstallModal({
  listing,
  locale,
  onClose,
}: {
  listing: ListingSummary;
  locale: MarketLocale;
  onClose: () => void;
}) {
  const ko = locale === "ko";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ["market-listing", listing.slug],
    queryFn: () => getListing(listing.slug),
  });
  const walletsQ = useQuery({ queryKey: ["wallets"], queryFn: listWallets });
  const overviewQ = useQuery({ queryKey: ["ps2-overview"], queryFn: getOverview });
  // The wallet *label* lives on the dashboard summary (the GET /wallets list
  // returns only address + chains). Reuse it so the prototype's named-wallet
  // rows ("메인 지갑") render instead of address-as-name (server has no label
  // on the wallets list endpoint). Falls back to a short address when unlabeled.
  const summaryQ = useQuery({ queryKey: ["dashboard-summary"], queryFn: getDashboardSummary });
  const snap = overviewQ.data ?? null;

  const wallets = useMemo(() => {
    const labelOf = new Map(
      (summaryQ.data?.wallets ?? []).map((w) => [w.address.toLowerCase(), w.label ?? null] as const),
    );
    const addrs = new Set([
      ...(walletsQ.data ?? []).map((w) => w.address.toLowerCase()),
      ...Object.keys(snap?.wallets.byAddress ?? {}),
    ]);
    return [...addrs].sort().map((address) => ({
      address,
      label: labelOf.get(address.toLowerCase()) ?? null,
      packages: Object.values(snap?.wallets.byAddress[address]?.packages ?? {})
        .map((p) => ({ id: p.id, displayName: p.displayName }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko")),
    }));
  }, [walletsQ.data, snap, summaryQ.data]);
  const libPackages = useMemo(
    () => Object.values(snap?.library.packages ?? {}),
    [snap],
  );

  const isSet = listing.kind === "set";
  const name = pickI18n(listing.display_name, locale) || listing.slug;
  const memberCount = detailQ.data?.latest_version?.members?.length ?? 0;
  const cat = categoryOf(listing.slug);
  const catColor = CATEGORY_COLOR[cat];

  // 설치 모달의 문장형 파라미터 폼 — 폼으로 열리는 def 마다 기준 FormModel.
  // 에디터 ValueSheet 를 그대로 임베드해 값을 편집하고, diffParamValues 로
  // 바인딩 params 를 뽑는다.
  const formDefsQ = useQuery({
    queryKey: ["market-form-defs", listing.slug, detailQ.data?.current_version ?? ""],
    queryFn: () => installFormDefs(detailQ.data!, locale),
    enabled: !!detailQ.data,
  });
  const formDefs = useMemo(() => formDefsQ.data ?? [], [formDefsQ.data]);
  const baseModelOf = (defId: string): FormModel | undefined =>
    formDefs.find((f) => f.defId === defId)?.model;

  // 편집된 모델은 ref 에 모은다(키 입력마다 부모 리렌더 방지). 유효성만 state.
  const libModelsRef = useRef<Record<string, FormModel>>({});
  const walletModelsRef = useRef<Record<string, Record<string, FormModel>>>({});
  const [libValidity, setLibValidity] = useState<Record<string, boolean>>({});
  const [walletValidity, setWalletValidity] = useState<Record<string, Record<string, boolean>>>({});
  // 지갑·def 별 심각도(차단/경고) — 셀렉트가 즉시 반영되도록 state. 미설정이면
  // def 선언값을 따른다.
  const [walletSeverity, setWalletSeverity] = useState<
    Record<string, Record<string, "deny" | "warn">>
  >({});
  // 지갑별 파라미터 탭의 활성 지갑.
  const [activeTab, setActiveTab] = useState<string | null>(null);

  /** 한 def 의 바인딩 params — 기준 모델 대비 바뀐 leaf 값만(diffParamValues). */
  const paramsForModel = (defId: string, edited: FormModel | undefined): Record<string, HoleValue> => {
    const base = baseModelOf(defId);
    if (!base || !edited) return {};
    return diffParamValues(base, edited);
  };
  /** 라이브러리 경로 params(defId → params). */
  const libParams = (): InstallParams => {
    const out: InstallParams = {};
    for (const f of formDefs) out[f.defId] = paramsForModel(f.defId, libModelsRef.current[f.defId]);
    return out;
  };
  /** 한 지갑의 params(defId → params). */
  const walletParamsFor = (addr: string): InstallParams => {
    const out: InstallParams = {};
    for (const f of formDefs) out[f.defId] = paramsForModel(f.defId, walletModelsRef.current[addr]?.[f.defId]);
    return out;
  };

  const hasParams = formDefs.length > 0;
  const libParamsInvalid = formDefs.some((f) => libValidity[f.defId] === false);

  const [kind, setKind] = useState<"wallet" | "library" | null>(null);
  // 지갑 경로 — 지갑 선택 → (빈칸 있으면) 지갑별 파라미터 설정.
  const [walletStep, setWalletStep] = useState<"select" | "params">("select");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [walletPkg, setWalletPkg] = useState<Record<string, string>>({});
  const [walletNewName, setWalletNewName] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState(false);
  const [bulkName, setBulkName] = useState(name); // 기본값 = 리스팅 이름
  // 라이브러리 경로.
  const [packageId, setPackageId] = useState(UNCATEGORIZED_PKG);
  const [applyToAllNow, setApplyToAllNow] = useState(false);
  const [applyToNewWallets, setApplyToNewWallets] = useState(true);
  const [done, setDone] = useState(false);

  const pkgOf = (addr: string) => walletPkg[addr] ?? UNCATEGORIZED_PKG;

  const bulkCollisions = useMemo(() => {
    const n = bulkName.trim();
    if (!bulk || !n) return [];
    return [...picked].filter((a) =>
      (wallets.find((w) => w.address === a)?.packages ?? []).some((p) => p.displayName === n),
    );
  }, [bulk, bulkName, picked, wallets]);

  const mut = useMutation({
    mutationFn: async () => {
      if (kind === "wallet") {
        const walletPackages: Record<string, WalletPkgPick> = {};
        for (const addr of picked) {
          if (bulk) {
            walletPackages[addr] = { newName: bulkName.trim() };
          } else {
            const sel = pkgOf(addr);
            walletPackages[addr] =
              sel === "__new__" ? { newName: (walletNewName[addr] ?? "").trim() } : { id: sel };
          }
        }
        const paramsByAddress: Record<string, InstallParams> = {};
        const severityByAddress: Record<string, Record<string, "deny" | "warn">> = {};
        for (const addr of picked) {
          paramsByAddress[addr] = walletParamsFor(addr);
          // def 선언값과 다른 심각도만 override 로 기록.
          const sevs: Record<string, "deny" | "warn"> = {};
          for (const f of formDefs) {
            const chosen = walletSeverity[addr]?.[f.defId];
            if (chosen && chosen !== f.model.severity) sevs[f.defId] = chosen;
          }
          if (Object.keys(sevs).length) severityByAddress[addr] = sevs;
        }
        return installListingWalletOnlyV2(detailQ.data!, locale, {
          addresses: [...picked],
          walletPackages,
          snap: snap!,
          params: {},
          paramsByAddress,
          ...(Object.keys(severityByAddress).length ? { severityByAddress } : {}),
        });
      }
      return installListingV2(detailQ.data!, locale, {
        scope: applyToAllNow ? { kind: "all" } : { kind: "library-only" },
        applyToNewWallets,
        packageId: isSet ? null : packageId === UNCATEGORIZED_PKG ? null : packageId,
        params: libParams(),
        snap,
      });
    },
    onSuccess: async () => {
      setDone(true);
      await qc.invalidateQueries({ queryKey: ["ps2-overview"] });
      await qc.invalidateQueries({ queryKey: ["market-listing", listing.slug] });
    },
  });

  // 지갑 선택/패키지 지정이 유효한가 (파라미터는 다음 단계에서 검사).
  const walletSelectionInvalid =
    picked.size === 0 ||
    (bulk
      ? !bulkName.trim()
      : [...picked].some((a) => pkgOf(a) === "__new__" && !(walletNewName[a] ?? "").trim()));
  // 선택한 지갑 중 폼이 형식 오류(잘못된 decimal 등)면 설치 불가.
  const walletParamsInvalid = [...picked].some((a) =>
    formDefs.some((f) => walletValidity[a]?.[f.defId] === false),
  );
  // 라이브러리 경로: 폼 형식 오류가 있으면 설치 불가.
  const libraryInvalid = libParamsInvalid || formDefsQ.isLoading;

  const togglePick = (a: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  // ── 헤더 (아이콘 + 종류/이름) — 모든 단계 공통.
  const kindLabel = isSet ? (ko ? "패키지" : "Package") : ko ? "정책" : "Policy";
  const head = (
    <div className="im-head">
      {isSet ? (
        <span className="im-ico pkg">
          <Glyph d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8" size={22} color="var(--warn-700)" sw={1.7} />
        </span>
      ) : (
        <span className="im-ico" style={{ background: catColor.soft }}>
          <CategoryGlyph category={cat} size={22} color={catColor.hex} />
        </span>
      )}
      <div className="im-headmeta">
        <span className="im-kind">{kindLabel}</span>
        <h3 className="im-title">{name}</h3>
      </div>
    </div>
  );

  // ── 파라미터 폼: 에디터 ValueSheet(문장형)를 그대로 임베드한다. scope 가
  //    address(지갑)면 그 지갑 모델로, undefined 면 라이브러리(공통) 모델로 편집.
  //    diffParamValues 로 바인딩 params 를 뽑으므로 여기선 model 만 ref 에 모은다.
  const renderParamForm = (scope: string | undefined) => {
    if (formDefs.length === 0) {
      return (
        <div className="im-noparams">
          {ko ? "설정할 파라미터가 없습니다." : "No parameters to set."}
        </div>
      );
    }
    const setModel = (defId: string, model: FormModel) => {
      if (scope) (walletModelsRef.current[scope] ??= {})[defId] = model;
      else libModelsRef.current[defId] = model;
    };
    const setValid = (defId: string, valid: boolean) => {
      if (scope) {
        setWalletValidity((m) => ({ ...m, [scope]: { ...(m[scope] ?? {}), [defId]: valid } }));
      } else {
        setLibValidity((m) => ({ ...m, [defId]: valid }));
      }
    };
    return (
      <div className="im-paramforms">
        {formDefs.map((f) => {
          // 탭 전환으로 폼이 언마운트돼도 편집값을 잃지 않게 ref 값으로 다시 연다.
          const seeded = (scope ? walletModelsRef.current[scope]?.[f.defId] : libModelsRef.current[f.defId]) ?? f.model;
          // 차단/경고 셀렉트는 지갑 경로에서만, def 선언값이 deny/warn 일 때만.
          const defSev = f.model.severity;
          const sevEditable = scope !== undefined && (defSev === "deny" || defSev === "warn");
          const sevProps = sevEditable
            ? {
                severityValue: walletSeverity[scope]?.[f.defId] ?? (defSev as "deny" | "warn"),
                onSeverityChange: (s: "deny" | "warn") =>
                  setWalletSeverity((m) => ({ ...m, [scope]: { ...(m[scope] ?? {}), [f.defId]: s } })),
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

  // 문장형 폼이 보이는 단계에선 모달을 넓혀 가독성을 높인다.
  const wideForForms =
    hasParams &&
    !done &&
    ((kind === "wallet" && walletStep === "params") || kind === "library");

  return (
    <div className="im-overlay" onClick={onClose}>
      <div className={`im-box${wideForForms ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="im-x" onClick={onClose} aria-label="close">
          <Glyph d="M6 6l12 12M18 6L6 18" size={16} sw={2} />
        </button>

        {/* ── 성공 화면 ───────────────────────────────────────────── */}
        {done ? (
          <>
            <div className="im-success">
              <div className="im-ok">
                <Glyph d="M5 12.5l4.5 4.5L19 7.5" size={26} sw={2.6} />
              </div>
              <h3 className="im-success-t">{ko ? "받았어요" : "Installed"}</h3>
              <p className="im-success-s">
                {kind === "wallet"
                  ? ko
                    ? `"${name}"을(를) 지갑 ${picked.size}개에 적용했어요.`
                    : `Applied "${name}" to ${picked.size} wallet(s).`
                  : ko
                    ? `"${name}"을(를) 정책 라이브러리에 추가했어요.`
                    : `Added "${name}" to your library.`}
              </p>
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={onClose}>
                {ko ? "닫기" : "Close"}
              </button>
              <button type="button" className="pri" onClick={() => navigate("/editor?tab=apply")}>
                {ko ? "지갑별 정책 보기" : "View wallet policies"}
              </button>
            </div>
          </>
        ) : kind === null ? (
          /* ── 단계 1: 받는 방식 선택 ─────────────────────────────── */
          <>
            {head}
            <div className="im-body">
              <p className="im-sub">
                {ko
                  ? isSet
                    ? `이 패키지${memberCount ? ` · 정책 ${memberCount}개` : ""}를 어떻게 받을까요?`
                    : "이 정책을 어떻게 받을까요?"
                  : "How should this be installed?"}
              </p>
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
                    <Glyph
                      d="M3 7.5h18v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7.5l2.5-3h13L21 7.5M16.5 13h2.5"
                      size={20}
                      color="var(--slate-500)"
                      sw={1.7}
                    />
                  </span>
                  <span className="im-opt-main">
                    <span className="im-opt-t">{ko ? "지갑 전용으로 받기" : "Wallet-only"}</span>
                    <span className="im-opt-d">
                      {ko
                        ? `선택한 지갑에만 존재해요 — 라이브러리에는 보이지 않아요.${wallets.length === 0 ? " (등록된 지갑이 없어요)" : ""}`
                        : "Exists only on the selected wallets."}
                    </span>
                  </span>
                  <span className="im-opt-go">
                    <Glyph d={CHEVRON} size={15} color="var(--slate-300)" sw={2} />
                  </span>
                </button>
                <button type="button" className="im-opt" onClick={() => setKind("library")}>
                  <span className="im-opt-ic">
                    <Glyph
                      d="M5 4h5v16H5zM12.5 4l4.5 1 2.5 14.5-4.5-1zM5 8h5M5 16h5"
                      size={20}
                      color="var(--slate-500)"
                      sw={1.7}
                    />
                  </span>
                  <span className="im-opt-main">
                    <span className="im-opt-t">{ko ? "라이브러리로 받기" : "Into the library"}</span>
                    <span className="im-opt-d">
                      {ko
                        ? "지갑 간 공유되는 템플릿으로 저장 — 언제든 적용할 수 있어요."
                        : "Saved as a shared template you can apply to wallets later."}
                    </span>
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
          /* ── 단계 2a: 지갑 선택 ─────────────────────────────────── */
          <>
            {head}
            <div className="im-body">
              <p className="im-sub">
                {ko
                  ? "어느 지갑에 적용할까요? 패키지는 지갑마다 따로 골라요."
                  : "Pick wallets — each wallet gets its own package."}
              </p>
              <div className="im-wallets">
                {wallets.map((w) => {
                  const on = picked.has(w.address);
                  const sel = pkgOf(w.address);
                  // Prototype 2-line hierarchy: name (지갑 이름) over a SHORT
                  // address (0x6f1c…a3e2), never the full 42-char hex (which
                  // overflows the row). With a label → name=label + 단축주소
                  // 보조줄. Without → name=단축주소만, 보조줄 생략(동어반복 방지).
                  const label = w.label?.trim();
                  const short = shortAddr(w.address);
                  const name = label || short;
                  const subAddr = label ? short : null;
                  const avatar = (label || w.address.replace(/^0x/i, "")).slice(0, 1).toUpperCase();
                  return (
                    <div key={w.address} className={`im-wallet${on ? " on" : ""}`}>
                      <div className="im-wrow" onClick={() => togglePick(w.address)}>
                        <input
                          type="checkbox"
                          checked={on}
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                        />
                        <span className="im-wav">{avatar}</span>
                        <span className="im-wmeta">
                          <span className="im-wname">{name}</span>
                          {subAddr && <span className="im-waddr">{subAddr}</span>}
                        </span>
                        {w.packages.length > 0 && (
                          <span className="im-wtag">
                            {ko ? `패키지 ${w.packages.length}` : `${w.packages.length} pkg`}
                          </span>
                        )}
                      </div>
                      {on && !bulk && (
                        <div className="im-pkgrow">
                          <span className="im-pkglabel">{ko ? "패키지" : "Package"}</span>
                          <div className="im-pkgchips">
                            <button
                              type="button"
                              className={`im-pkgchip${sel === UNCATEGORIZED_PKG ? " on" : ""}`}
                              onClick={() =>
                                setWalletPkg((m) => ({ ...m, [w.address]: UNCATEGORIZED_PKG }))
                              }
                            >
                              {ko ? "미분류" : "Uncategorized"}
                            </button>
                            {w.packages.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className={`im-pkgchip${sel === p.id ? " on" : ""}`}
                                onClick={() => setWalletPkg((m) => ({ ...m, [w.address]: p.id }))}
                              >
                                {p.displayName}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={`im-pkgchip new${sel === "__new__" ? " on" : ""}`}
                              onClick={() => setWalletPkg((m) => ({ ...m, [w.address]: "__new__" }))}
                            >
                              {ko ? "+ 새 패키지" : "+ New"}
                            </button>
                          </div>
                          {sel === "__new__" && (
                            <input
                              className="im-textfield sm"
                              value={walletNewName[w.address] ?? ""}
                              onChange={(e) =>
                                setWalletNewName((m) => ({ ...m, [w.address]: e.target.value }))
                              }
                              placeholder={ko ? "새 패키지 이름" : "Package name"}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <label className="im-check">
                <input
                  type="checkbox"
                  checked={bulk}
                  onChange={(e) => {
                    setBulk(e.target.checked);
                    // 일괄 모드를 켜면 모든 지갑을 선택해 준다(편의 기능).
                    if (e.target.checked) setPicked(new Set(wallets.map((w) => w.address)));
                  }}
                />
                <span>{ko ? "모든 지갑에 새 패키지를 만들어 넣기" : "Create one new package on every wallet"}</span>
              </label>
              {bulk && (
                <input
                  className="im-textfield"
                  value={bulkName}
                  onChange={(e) => setBulkName(e.target.value)}
                  placeholder={ko ? "새 패키지 이름" : "Package name"}
                />
              )}
              {bulk && bulkCollisions.length > 0 && (
                <div className="im-note">
                  {ko
                    ? `같은 이름의 패키지가 이미 있는 지갑은 그 패키지에 넣어요: ${bulkCollisions.map(shortAddr).join(", ")}`
                    : `Wallets with a same-name package reuse it: ${bulkCollisions.map(shortAddr).join(", ")}`}
                </div>
              )}
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={() => setKind(null)}>
                {ko ? "← 이전" : "← Back"}
              </button>
              <button
                type="button"
                className="pri"
                disabled={!detailQ.data || !snap || formDefsQ.isLoading || walletSelectionInvalid}
                onClick={() => setWalletStep("params")}
              >
                {ko ? "다음 →" : "Next →"}
              </button>
            </div>
          </>
          ) : (
          /* ── 단계 2a-2: 지갑별 파라미터 설정 ────────────────────── */
          <>
            {head}
            <div className="im-body">
              <p className="im-sub">
                {hasParams
                  ? ko
                    ? "지갑마다 값을 확인하고 필요하면 바꿔주세요. 빈 칸은 채워야 적용돼요."
                    : "Review the values per wallet and adjust as needed — fill any blanks."
                  : ko
                    ? "이 정책은 설정할 파라미터가 없어요. 바로 받을 수 있어요."
                    : "This policy has no parameters to set — you can install it directly."}
              </p>
              {hasParams ? (
                (() => {
                  const tabs = [...picked];
                  const active = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0];
                  const nameOf = (a: string) =>
                    wallets.find((x) => x.address === a)?.label?.trim() || shortAddr(a);
                  return (
                    <div className="im-wparams">
                      {tabs.length > 1 && (
                        <div className="im-wtabs" role="tablist">
                          {tabs.map((a) => (
                            <button
                              key={a}
                              type="button"
                              role="tab"
                              aria-selected={a === active}
                              className={`im-wtab${a === active ? " on" : ""}`}
                              onClick={() => setActiveTab(a)}
                            >
                              {nameOf(a)}
                            </button>
                          ))}
                        </div>
                      )}
                      {active && renderParamForm(active)}
                    </div>
                  );
                })()
              ) : (
                <div className="im-noparams">
                  {ko ? "설정할 파라미터가 없습니다." : "No parameters to set."}
                </div>
              )}
              {mut.isError && <div className="publish-error">{(mut.error as Error).message}</div>}
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={() => setWalletStep("select")}>
                {ko ? "← 이전" : "← Back"}
              </button>
              <button
                type="button"
                className="pri"
                disabled={!detailQ.data || !snap || mut.isPending || walletParamsInvalid}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? (ko ? "받는 중…" : "Installing…") : ko ? "받기" : "Install"}
              </button>
            </div>
          </>
          )
        ) : (
          /* ── 단계 2b: 라이브러리 옵션 ───────────────────────────── */
          <>
            {head}
            <div className="im-body">
              <p className="im-sub">{ko ? "라이브러리 설정을 골라주세요." : "Library options."}</p>
              {isSet ? (
                <div className="im-infocard">
                  <Glyph d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8" size={20} color="var(--warn-700)" sw={1.7} />
                  <div className="im-infocard-tx">
                    <b>{ko ? "패키지로 묶여 저장" : "Saved as a package"}</b>
                    <span>
                      {ko
                        ? `"${name}" 정책들이 하나의 패키지로 라이브러리에 저장돼요.`
                        : `"${name}" policies are saved as one library package.`}
                    </span>
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
                  </div>
                </div>
              )}
              <div className="im-toggles">
                <label className="im-toggle">
                  <span className="im-toggle-main">
                    <span className="im-toggle-t">{ko ? "지금 모든 지갑에 적용" : "Apply to all wallets now"}</span>
                    <span className="im-toggle-d">
                      {ko
                        ? `등록된 지갑 ${wallets.length}개에 바로 적용해요.`
                        : `Applies to all ${wallets.length} wallet(s) immediately.`}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={applyToAllNow}
                    disabled={wallets.length === 0}
                    onChange={(e) => setApplyToAllNow(e.target.checked)}
                  />
                  <span className="im-switch" />
                </label>
                <label className="im-toggle">
                  <span className="im-toggle-main">
                    <span className="im-toggle-t">{ko ? "새 지갑에도 기본 적용" : "Apply to future wallets"}</span>
                    <span className="im-toggle-d">
                      {ko
                        ? "앞으로 추가되는 지갑에 자동으로 적용해요."
                        : "Automatically applies to wallets you add later."}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={applyToNewWallets}
                    onChange={(e) => setApplyToNewWallets(e.target.checked)}
                  />
                  <span className="im-switch" />
                </label>
              </div>
              {renderParamForm(undefined)}
              {mut.isError && <div className="publish-error">{(mut.error as Error).message}</div>}
            </div>
            <div className="im-actions">
              <button type="button" className="sec" onClick={() => setKind(null)}>
                {ko ? "← 이전" : "← Back"}
              </button>
              <button
                type="button"
                className="pri"
                disabled={!detailQ.data || !snap || mut.isPending || libraryInvalid}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? (ko ? "받는 중…" : "Installing…") : ko ? "받기" : "Install"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
