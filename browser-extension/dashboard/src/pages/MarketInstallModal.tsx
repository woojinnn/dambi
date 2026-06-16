import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { getListing, pickI18n, type ListingSummary } from "../server-api";
import { getDashboardSummary } from "../server-api/dashboard";
import { getOverview, UNCATEGORIZED_PKG } from "../server-api/policy-store";
import { listWallets } from "../server-api/wallets";
import {
  holeInputToValue,
  installListingV2,
  installListingWalletOnlyV2,
  requiredHoleInputs,
  type InstallParams,
  type WalletPkgPick,
} from "./market-install-v2";
import {
  CATEGORY_COLOR,
  CategoryGlyph,
  categoryOf,
} from "./market-domain";
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

  // 게시 때 블랭킹된 required hole — 채워야 설치(바인딩)가 가능하다.
  const holesQ = useQuery({
    queryKey: ["market-required-holes", listing.slug, snap?.rev ?? -1],
    queryFn: () => requiredHoleInputs(detailQ.data!, locale, snap),
    enabled: !!detailQ.data && !!snap,
  });
  const holeReqs = holesQ.data ?? [];
  /** defId → hole 이름 → 입력 문자열 (공통값 / 라이브러리 경로). */
  const [holeVals, setHoleVals] = useState<Record<string, Record<string, string>>>({});
  const setHoleVal = (defId: string, name: string, v: string) =>
    setHoleVals((m) => ({ ...m, [defId]: { ...(m[defId] ?? {}), [name]: v } }));
  /** 지갑 경로의 지갑별 입력 — address → defId → hole 이름 → 문자열. */
  const [walletHoleVals, setWalletHoleVals] = useState<
    Record<string, Record<string, Record<string, string>>>
  >({});
  const setWalletHoleVal = (addr: string, defId: string, name: string, v: string) =>
    setWalletHoleVals((m) => ({
      ...m,
      [addr]: {
        ...(m[addr] ?? {}),
        [defId]: { ...(m[addr]?.[defId] ?? {}), [name]: v },
      },
    }));

  /** 파라미터 기본 입력값(리터럴/재설치 값) — 미입력 칸의 폴백. */
  const defaultOf = (defId: string, name: string): string =>
    holeReqs.find((r) => r.defId === defId)?.defaults[name] ?? "";
  /** 입력 문자열 맵을 HoleValue로 변환 — 전부 유효하면 InstallParams, 아니면 null.
   *  미입력 칸은 기본값으로 본다(리터럴은 그대로, required 미충전은 ""→null). */
  const computeFilled = (vals: Record<string, Record<string, string>>): InstallParams | null => {
    const out: InstallParams = {};
    for (const req of holeReqs) {
      for (const h of req.holes) {
        const raw = vals[req.defId]?.[h.name] ?? defaultOf(req.defId, h.name);
        const v = holeInputToValue(h.type, raw);
        if (v === null) return null;
        (out[req.defId] ??= {})[h.name] = v;
      }
    }
    return out;
  };
  /** 공통(라이브러리) 경로의 채워진 값. */
  const filledParams = useMemo<InstallParams | null>(
    () => computeFilled(holeVals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holeReqs, holeVals],
  );
  /** 지갑별 입력 getter — 지갑값 > 공통값(holeVals) > 파라미터 기본값(리터럴). */
  const walletHoleGet = (addr: string, defId: string, name: string): string =>
    walletHoleVals[addr]?.[defId]?.[name] ?? holeVals[defId]?.[name] ?? defaultOf(defId, name);
  /** 한 지갑의 채워진 값(공통값 폴백 포함). */
  const walletFilledFor = (addr: string): InstallParams | null => {
    const merged: Record<string, Record<string, string>> = {};
    for (const req of holeReqs) {
      for (const h of req.holes) {
        (merged[req.defId] ??= {})[h.name] = walletHoleGet(addr, req.defId, h.name);
      }
    }
    return computeFilled(merged);
  };

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
        for (const addr of picked) paramsByAddress[addr] = walletFilledFor(addr) ?? {};
        return installListingWalletOnlyV2(detailQ.data!, locale, {
          addresses: [...picked],
          walletPackages,
          snap: snap!,
          params: filledParams ?? {},
          paramsByAddress,
        });
      }
      return installListingV2(detailQ.data!, locale, {
        scope: applyToAllNow ? { kind: "all" } : { kind: "library-only" },
        applyToNewWallets,
        packageId: isSet ? null : packageId === UNCATEGORIZED_PKG ? null : packageId,
        params: filledParams ?? {},
        snap,
      });
    },
    onSuccess: async () => {
      setDone(true);
      await qc.invalidateQueries({ queryKey: ["ps2-overview"] });
      await qc.invalidateQueries({ queryKey: ["market-listing", listing.slug] });
    },
  });

  const hasHoles = holeReqs.length > 0;
  // 지갑 선택/패키지 지정이 유효한가 (파라미터는 다음 단계에서 검사).
  const walletSelectionInvalid =
    picked.size === 0 ||
    (bulk
      ? !bulkName.trim()
      : [...picked].some((a) => pkgOf(a) === "__new__" && !(walletNewName[a] ?? "").trim()));
  // 선택한 모든 지갑의 빈칸이 유효하게 채워졌는가.
  const walletParamsInvalid = [...picked].some((a) => walletFilledFor(a) === null);
  // 라이브러리 경로: 공통 빈칸이 전부 채워져야 설치 가능 (SW 가드와 동일 기준).
  const libraryInvalid = filledParams === null || holesQ.isLoading;

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

  // ── required hole 입력 폼 (프로토타입엔 없는 실기능). getVal/setVal로 값 소스를
  //    바꿔 끼워 공통(라이브러리) 폼과 지갑별 폼에 재사용한다. heading=false면
  //    상단 안내문을 생략(지갑별 카드에선 지갑 이름이 헤딩 역할).
  const renderHoleForm = (
    getVal: (defId: string, name: string) => string,
    setVal: (defId: string, name: string, v: string) => void,
    opts?: { keyPrefix?: string; heading?: boolean },
  ) => {
    if (holeReqs.length === 0) return null;
    const showHeading = opts?.heading !== false;
    return (
      <div className="im-holes">
        {showHeading && (
          <div className="im-holes-head">
            {ko
              ? "값을 확인하고 필요하면 바꿔주세요 — 빈 칸은 채워야 적용돼요"
              : "Review and adjust the values — fill any blanks to apply"}
          </div>
        )}
        {holeReqs.map((req) => (
          <div key={`${opts?.keyPrefix ?? ""}${req.defId}`} className="im-holes-def">
            {holeReqs.length > 1 && <div className="im-holes-defname">{req.defName}</div>}
            {req.holes.map((h) => {
              const raw = getVal(req.defId, h.name);
              const bad = raw.trim() !== "" && holeInputToValue(h.type, raw) === null;
              return (
                <label key={h.name} className="im-field im-hole">
                  <span className="im-hole-label">{h.label}</span>
                  {h.type === "addressSet" ? (
                    <textarea
                      value={raw}
                      rows={2}
                      onChange={(e) => setVal(req.defId, h.name, e.target.value)}
                      placeholder={
                        ko ? "0x… 주소 (쉼표/줄바꿈으로 여러 개)" : "0x… (comma/newline separated)"
                      }
                    />
                  ) : (
                    <input
                      value={raw}
                      onChange={(e) => setVal(req.defId, h.name, e.target.value)}
                      placeholder={
                        h.type === "address"
                          ? "0x…"
                          : h.type === "decimal"
                            ? ko
                              ? "예: 3.0"
                              : "e.g. 3.0"
                            : h.type === "long"
                              ? ko
                                ? "숫자"
                                : "number"
                              : ""
                      }
                    />
                  )}
                  {bad && (
                    <span className="im-hole-err">
                      {h.type === "address" || h.type === "addressSet"
                        ? ko
                          ? "0x로 시작하는 40자리 주소여야 해요"
                          : "Must be a 0x… address"
                        : h.type === "decimal"
                          ? ko
                            ? "소수점 형식이어야 해요 (예: 3.0)"
                            : "Decimal format (e.g. 3.0)"
                          : ko
                            ? "형식이 맞지 않아요"
                            : "Invalid format"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        ))}
      </div>
    );
  };
  // 공통(라이브러리/스텝1) 폼.
  const libraryHoleForm = renderHoleForm(
    (defId, name) => holeVals[defId]?.[name] ?? defaultOf(defId, name),
    (defId, name, v) => setHoleVal(defId, name, v),
  );

  return (
    <div className="im-overlay" onClick={onClose}>
      <div className="im-box" onClick={(e) => e.stopPropagation()}>
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
                disabled={!detailQ.data || !snap || holesQ.isLoading || walletSelectionInvalid}
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
                {hasHoles
                  ? ko
                    ? "지갑마다 값을 확인하고 필요하면 바꿔주세요. 빈 칸은 채워야 적용돼요."
                    : "Review the values per wallet and adjust as needed — fill any blanks."
                  : ko
                    ? "이 정책은 설정할 파라미터가 없어요. 바로 받을 수 있어요."
                    : "This policy has no parameters to set — you can install it directly."}
              </p>
              {hasHoles ? (
                [...picked].map((addr) => {
                  const w = wallets.find((x) => x.address === addr);
                  const wname = w?.label?.trim() || shortAddr(addr);
                  return (
                    <div key={addr} className="im-wparams">
                      <div className="im-wparams-head">{wname}</div>
                      {renderHoleForm(
                        (defId, name) => walletHoleGet(addr, defId, name),
                        (defId, name, v) => setWalletHoleVal(addr, defId, name, v),
                        { keyPrefix: `${addr}:`, heading: false },
                      )}
                    </div>
                  );
                })
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
              {libraryHoleForm}
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
