/* Dambi Assets — wallet drilldown (L1 ↔ L2) + lens toggle (assets/risk).
   Ported from the ASS_v2 prototype (assets-app.js). The render functions are
   UNCHANGED — same output HTML (class names / structure / text). Only:
     · the six data definitions (WLABEL/WMETA/AGG/PW/APPR/PEND + sel) read from
       window.DAMBI_DATA (live data), falling back to the original demo literals
       so the prototype still runs standalone,
     · renderWalletChips() rebuilds the wallet switcher from WLABEL/WMETA,
     · renderHl() fills the HL card body from window.DAMBI_DATA.HL,
     · the HL gate is capability-based (any wallet may have an HL account),
     · DOM access is scoped to `root` (no document.getElementById),
     · inline onerror= is removed (CSP) in favor of a delegated capture listener,
     · render/buildSummary are exposed on window for the React wrapper + layout-modes,
     · wallet-chip clicks bridge to window.DAMBI_SET_SEL (URL-driven reselection). */

import {
  escapeAttr,
  escapeHtml,
  safeClassToken,
} from "./html-safe";

// ── DAMBI_DATA shapes (the adapter fills these; demo literals share the shape) ──
type RiskTagArr = string[];
interface AggRow {
  sym: string;
  kind: string;
  chain: string;
  cc: string;
  wallets?: string[];
  bal: string;
  unit: string;
  usd: string;
  usdNum: number;
  risk: RiskTagArr;
  varTxt: string;
  varCls: string;
  varNum: number;
  spam?: boolean;
  logoUrl?: string;
  logoURI?: string;
  logo?: string;
}
interface WMetaEntry {
  label: string;
  full: string;
  totalUsd: string;
  fail: number;
  warn: number;
  pending: number;
  varUsd: string;
  unlimited: number;
}
interface ApprRow {
  w: string;
  type: string;
  token: string;
  spender: string;
  chain: string;
  amount: string;
  risk: RiskTagArr;
  revoke: boolean;
}
interface PendRow {
  w: string;
  kind: string;
  type: string;
  venue?: string;
  sell?: string;
  buy?: string;
  line?: string;
  amount?: string;
  spender?: string;
  at: string;
}
interface HlPos {
  sym: string;
  side: string;
  size: number;
  entry: number;
  value: number;
  leverage: string;
}
interface HlOrder {
  sym: string;
  side: string;
  kind: string;
  trigger: string;
  limit: string;
  cond: string;
}
interface HlAccountView {
  wallet: string;
  walletLabel: string;
  perpUsd: number;
  spotUsd: number;
  positions: HlPos[];
  orders: HlOrder[];
}
interface DambiDataShape {
  WLABEL?: Record<string, string>;
  WMETA?: Record<string, WMetaEntry>;
  AGG?: AggRow[];
  PW?: Record<string, AggRow[]>;
  APPR?: ApprRow[];
  PEND?: PendRow[];
  HL?: Record<string, HlAccountView>;
  sel?: string;
  donut?: unknown;
}

export function initAssetsApp(root: HTMLElement): () => void {
  "use strict";

  let D: DambiDataShape = (window.DAMBI_DATA as DambiDataShape) || {};

  // i18n bridge (set by Assets2Page before boot). Read at render time so language
  // switches reflect without re-init. Falls back to the key in the standalone
  // prototype (DAMBI_T absent).
  const T = (k: string, vars?: Record<string, unknown>): string =>
    window.DAMBI_T ? window.DAMBI_T(k, vars) : k;

  let WLABEL: Record<string, string> =
    D.WLABEL || { main: "메인 지갑", trade: "트레이딩", cold: "콜드 스토리지", savings: "적립 지갑", airdrop: "에어드랍" };

  // 평판 레지스트리(악성주소 차단·거래소 평판) 연결 여부.
  const REPUTATION_CONNECTED = false;

  function visibleRisk(risk: string[]): string[] {
    if (REPUTATION_CONNECTED) return risk;
    return risk.filter(function (t) {
      return t !== "BLOCKED" && t !== "KNOWN_VENUE";
    });
  }

  // Render-time (not init-time) so language switches re-translate without re-boot.
  const RISK_LABEL_KEY: Record<string, string> = {
    UNLIMITED: "assets.risk.unlimited",
    KNOWN_VENUE: "assets.risk.knownVenue",
    BLOCKED: "assets.risk.blocked",
    OLD: "assets.risk.old",
    EXPIRED: "assets.risk.expired",
  };
  const RISK_DESC_KEY: Record<string, string> = {
    UNLIMITED: "assets.risk.descUnlimited",
    KNOWN_VENUE: "assets.risk.descKnownVenue",
    BLOCKED: "assets.risk.descBlocked",
    OLD: "assets.risk.descOld",
    EXPIRED: "assets.risk.descExpired",
  };
  function riskLabel(tag: string): string {
    return RISK_LABEL_KEY[tag] ? T(RISK_LABEL_KEY[tag]) : tag;
  }
  function riskDesc(tag: string): string {
    return RISK_DESC_KEY[tag] ? T(RISK_DESC_KEY[tag]) : "";
  }
  function riskLegend(): string {
    return (
      "<b>" + T("assets.exposure.legendTitle") + "</b>" +
      "<em>" + T("assets.exposure.legendDesc") + "</em>" +
      '<i><span class="exp-dot warn"></span><span class="lg-k">' + T("assets.exposure.warnK") + "</span> " + T("assets.exposure.warnV") + "</i>" +
      '<i><span class="exp-dot low"></span><span class="lg-k">' + T("assets.exposure.lowK") + "</span> " + T("assets.exposure.lowV") + "</i>" +
      '<i><span class="exp-dot none"></span><span class="lg-k">' + T("assets.exposure.noneK") + "</span> " + T("assets.exposure.noneV") + "</i>" +
      (REPUTATION_CONNECTED
        ? '<i><span class="exp-dot fail"></span><span class="lg-k">' + T("assets.exposure.failK") + "</span> " + T("assets.exposure.failV") + "</i>"
        : '<em class="lg-foot">' + T("assets.exposure.foot") + "</em>")
    );
  }

  function expSeverity(r: AggRow): string {
    const risk = r.risk;
    if (REPUTATION_CONNECTED && risk.indexOf("BLOCKED") >= 0) return "fail";
    if (risk.indexOf("UNLIMITED") >= 0) return "warn";
    if (r.varNum > 0 || risk.indexOf("OLD") >= 0 || risk.indexOf("EXPIRED") >= 0) return "low";
    return "none";
  }
  function expLabel(r: AggRow): string {
    const risk = r.risk;
    if (REPUTATION_CONNECTED && risk.indexOf("BLOCKED") >= 0) return T("assets.risk.blocked");
    if (risk.indexOf("UNLIMITED") >= 0) return T("assets.risk.unlimited");
    if (risk.indexOf("OLD") >= 0) return T("assets.risk.old");
    if (risk.indexOf("EXPIRED") >= 0) return T("assets.risk.expired");
    if (r.varNum > 0) return T("assets.risk.capped");
    return "";
  }
  function exposureCell(r: AggRow): string {
    const sev = expSeverity(r);
    if (sev === "none") return '<span class="r-safe">—</span>';
    const amt = r.varNum > 0 ? r.varTxt : T("assets.exposure.pendingEval");
    return (
      '<div class="exp-cell ' + safeClassToken(sev) + '" title="' + escapeAttr(expLabel(r) + " · " + T("assets.exposure.prefix") + " " + amt) + '">' +
      '<span class="exp-dot ' + safeClassToken(sev) + '"></span>' +
      '<span class="exp-amt">' + escapeHtml(amt) + "</span>" +
      '<span class="exp-lbl">' + escapeHtml(expLabel(r)) + "</span>" +
      "</div>"
    );
  }

  let WMETA: Record<string, WMetaEntry> = D.WMETA || {
    main: { label: "메인 지갑", full: "0x7a3F09B2e7C1d4A8F3b06E59aD21c4F88E1bc2D4", totalUsd: "$29,041", fail: 0, warn: 1, pending: 0, varUsd: "$4,432", unlimited: 1 },
    trade: { label: "트레이딩", full: "0x91bE4D7a02C3f1E89bA6c5d4017fE3b2A98c77a0", totalUsd: "$14,856", fail: 0, warn: 1, pending: 2, varUsd: "$5,834", unlimited: 1 },
    cold: { label: "콜드 스토리지", full: "0x04C9aE13b7F2086d4c1A9e5B3f70D82c6A4ee8B1", totalUsd: "$4,316", fail: 1, warn: 0, pending: 0, varUsd: "$0", unlimited: 1 },
    savings: { label: "적립 지갑", full: "0x3dF2c8A41e90B7654dCa1f0837Be29aB6c0e91Ac", totalUsd: "$5,000", fail: 0, warn: 0, pending: 0, varUsd: "$0", unlimited: 0 },
    airdrop: { label: "에어드랍", full: "0xBe0743f9C21aD5e8870b14c6395Fa0d2E71b5C13", totalUsd: "$1,200", fail: 0, warn: 1, pending: 0, varUsd: "$1,200", unlimited: 1 },
  };

  // L1 aggregate holdings (cross-wallet).
  let AGG: AggRow[] = D.AGG || [
    { sym: "ETH", kind: "native", chain: "Ethereum", cc: "#627EEA", wallets: ["main", "cold"], bal: "7.842215", unit: "ETH", usd: "$19,425.18", usdNum: 19425.18, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "USDC", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", wallets: ["main", "trade"], bal: "9,214.503311", unit: "USDC", usd: "$9,212.66", usdNum: 9212.66, risk: ["UNLIMITED"], varTxt: "$9,213", varCls: "warn", varNum: 9213 },
    { sym: "WETH", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["main"], bal: "1.62", unit: "WETH", usd: "$4,013.30", usdNum: 4013.3, risk: ["KNOWN_VENUE"], varTxt: "$812", varCls: "slate", varNum: 812 },
    { sym: "cbETH", kind: "erc20", chain: "Base", cc: "#0052FF", wallets: ["main"], bal: "1.05492", unit: "cbETH", usd: "$2,847.60", usdNum: 2847.6, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "ARB", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", wallets: ["trade"], bal: "3,120", unit: "ARB", usd: "$1,930.27", usdNum: 1930.27, risk: ["OLD"], varTxt: "$241", varCls: "slate", varNum: 241 },
    { sym: "MILADY", kind: "nft", chain: "Ethereum", cc: "#627EEA", wallets: ["cold"], bal: "2", unit: "", usd: "—", usdNum: 0, risk: ["BLOCKED", "UNLIMITED"], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "OP", kind: "erc20", chain: "Base", cc: "#0052FF", wallets: ["main"], bal: "84.2", unit: "OP", usd: "$132.18", usdNum: 132.18, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "LINK", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["trade"], bal: "6.4", unit: "LINK", usd: "$98.40", usdNum: 98.4, risk: ["UNLIMITED"], varTxt: "$98", varCls: "warn", varNum: 98 },
    { sym: "UNI", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["main"], bal: "9.1", unit: "UNI", usd: "$71.30", usdNum: 71.3, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "PEPE", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["trade"], bal: "4,210,000", unit: "PEPE", usd: "$44.06", usdNum: 44.06, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "AAVE", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", wallets: ["main"], bal: "0.18", unit: "AAVE", usd: "$33.12", usdNum: 33.12, risk: ["OLD"], varTxt: "$33", varCls: "slate", varNum: 33 },
    { sym: "CRV", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["trade"], bal: "52", unit: "CRV", usd: "$18.72", usdNum: 18.72, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "LDO", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["main"], bal: "8.3", unit: "LDO", usd: "$12.45", usdNum: 12.45, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "GMX", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", wallets: ["trade"], bal: "0.31", unit: "GMX", usd: "$7.04", usdNum: 7.04, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "SUSHI", kind: "erc20", chain: "Ethereum", cc: "#627EEA", wallets: ["main"], bal: "5.0", unit: "SUSHI", usd: "$3.85", usdNum: 3.85, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    { sym: "DUST", kind: "erc20", chain: "Base", cc: "#0052FF", wallets: ["main"], bal: "0.0042", unit: "DUST", usd: "$0.91", usdNum: 0.91, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
  ];

  // Per-wallet holdings (L2 drilldown).
  let PW: Record<string, AggRow[]> = D.PW || {
    main: [
      { sym: "ETH", kind: "native", chain: "Ethereum", cc: "#627EEA", bal: "6.10", unit: "ETH", usd: "$15,109.18", usdNum: 15109.18, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
      { sym: "WETH", kind: "erc20", chain: "Ethereum", cc: "#627EEA", bal: "1.62", unit: "WETH", usd: "$4,013.30", usdNum: 4013.3, risk: ["KNOWN_VENUE"], varTxt: "$812", varCls: "slate", varNum: 812 },
      { sym: "USDC", kind: "erc20", chain: "Ethereum", cc: "#627EEA", bal: "3,620.50", unit: "USDC", usd: "$3,619.78", usdNum: 3619.78, risk: ["UNLIMITED"], varTxt: "$3,620", varCls: "warn", varNum: 3620 },
      { sym: "cbETH", kind: "erc20", chain: "Base", cc: "#0052FF", bal: "1.05492", unit: "cbETH", usd: "$2,847.60", usdNum: 2847.6, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    ],
    trade: [
      { sym: "USDC", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", bal: "5,594.003311", unit: "USDC", usd: "$5,592.88", usdNum: 5592.88, risk: ["UNLIMITED", "KNOWN_VENUE"], varTxt: "$5,593", varCls: "warn", varNum: 5593 },
      { sym: "ARB", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", bal: "3,120", unit: "ARB", usd: "$1,930.27", usdNum: 1930.27, risk: ["OLD"], varTxt: "$241", varCls: "slate", varNum: 241 },
    ],
    cold: [
      { sym: "ETH", kind: "native", chain: "Ethereum", cc: "#627EEA", bal: "1.742215", unit: "ETH", usd: "$4,316.00", usdNum: 4316, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
      { sym: "MILADY", kind: "nft", chain: "Ethereum", cc: "#627EEA", bal: "2", unit: "", usd: "—", usdNum: 0, risk: ["BLOCKED", "UNLIMITED"], varTxt: "$0", varCls: "muted", varNum: 0 },
    ],
    savings: [
      { sym: "USDC", kind: "erc20", chain: "Base", cc: "#0052FF", bal: "3,200.00", unit: "USDC", usd: "$3,200.00", usdNum: 3200, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
      { sym: "ETH", kind: "native", chain: "Ethereum", cc: "#627EEA", bal: "0.727", unit: "ETH", usd: "$1,800.00", usdNum: 1800, risk: [], varTxt: "$0", varCls: "muted", varNum: 0 },
    ],
    airdrop: [
      { sym: "ARB", kind: "erc20", chain: "Arbitrum", cc: "#2D9BF0", bal: "1,940", unit: "ARB", usd: "$1,200.00", usdNum: 1200, risk: ["UNLIMITED"], varTxt: "$1,200", varCls: "warn", varNum: 1200 },
    ],
  };

  let APPR: ApprRow[] = D.APPR || [
    { w: "cold", type: "set_for_all", token: "0x5Af0···6c70", spender: "0xD1a9···4f2E", chain: "ethereum", amount: "—", risk: ["BLOCKED", "UNLIMITED"], revoke: false },
    { w: "main", type: "erc20", token: "0xaf88···5831", spender: "0x68b3···65F5", chain: "ethereum", amount: "Unlimited", risk: ["UNLIMITED"], revoke: true },
    { w: "trade", type: "erc20", token: "0xaf88···5831", spender: "0xE592···1564", chain: "arbitrum", amount: "Unlimited", risk: ["UNLIMITED", "KNOWN_VENUE"], revoke: true },
    { w: "main", type: "permit2", token: "0xC02a···6Cc2", spender: "0x2222···2222", chain: "ethereum", amount: "500,000", risk: ["KNOWN_VENUE"], revoke: false },
    { w: "trade", type: "erc20", token: "0x912C···0548", spender: "0x1b02···aD28", chain: "arbitrum", amount: "3,500", risk: ["OLD"], revoke: true },
  ];

  let PEND: PendRow[] = D.PEND || [
    { w: "trade", kind: "intent", type: "오프체인 주문", venue: "UniswapX", sell: "2,000 USDC", buy: "0.81 ETH", at: "2026. 6. 12. 09:42" },
    { w: "trade", kind: "permit", type: "Permit2", venue: "토큰 승인", line: "한도 500,000 · spender 0x2222···2222", at: "2026. 6. 12. 08:15" },
  ];

  // ── state ──────────────────────────────────────────────────────────────
  let sel: string = D.sel || "all"; // "all" | wallet key
  let hlSel: string = "all"; // Hyperliquid 패널 전용 지갑 탭 ("all" | wallet key)
  let lens: "assets" | "risk" = "assets";
  let bannerDismissed = false;
  let holdingsFilter = ""; // 토큰 검색어

  // ── helpers ──────────────────────────────────────────────────────────────
  function el(id: string): HTMLElement | null {
    return root.querySelector<HTMLElement>("#" + id);
  }
  function riskClass(risk: string[]): string {
    if (REPUTATION_CONNECTED && risk.indexOf("BLOCKED") >= 0) return "risk-fail";
    if (risk.indexOf("UNLIMITED") >= 0) return "risk-warn";
    return "";
  }
  function riskScore(risk: string[]): number {
    if (REPUTATION_CONNECTED && risk.indexOf("BLOCKED") >= 0) return 0;
    if (risk.indexOf("UNLIMITED") >= 0) return 1;
    if (risk.indexOf("OLD") >= 0 || risk.indexOf("EXPIRED") >= 0) return 2;
    return 3;
  }
  function kindTag(kind: string): string {
    if (kind === "native") return ' <span class="kind-tag native">native</span>';
    if (kind === "nft") return ' <span class="kind-tag nft">NFT</span>';
    return "";
  }
  function imgFail(img: HTMLImageElement): void {
    const span = img.parentNode as HTMLElement | null;
    if (!span) return;
    const s = img.getAttribute("data-sym") || "?";
    const k = img.getAttribute("data-kind") || "";
    span.outerHTML = '<span class="asset-ic ' + safeClassToken(k) + '">' + escapeHtml(s.slice(0, 1).toUpperCase()) + "</span>";
  }
  function badgeFail(img: HTMLImageElement): void {
    const span = img.parentNode as HTMLElement | null;
    if (span) span.style.display = "none";
  }
  // window 노출(원본 호환) — 다른 코드/디버그용.
  window.DAMBI_imgFail = imgFail;
  window.DAMBI_badgeFail = badgeFail;

  function tokenBase(r: AggRow): string {
    const F = window.DAMBI_TOKEN_LOGO_FILES || {};
    if (Object.prototype.hasOwnProperty.call(F, r.sym)) {
      // 로컬 번들 브랜드 로고(public/picture/tokens/, same-origin). 실패 시 글자 아바타 폴백.
      return (
        '<span class="asset-logo"><img src="picture/tokens/' + escapeAttr(F[r.sym]) +
        '.svg" alt="" loading="lazy" data-sym="' + escapeAttr(r.sym) +
        '" data-kind="' + escapeAttr(r.kind) +
        '" onerror="window.DAMBI_imgFail&&window.DAMBI_imgFail(this)"></span>'
      );
    }
    return '<span class="asset-ic ' + safeClassToken(r.kind) + '">' + escapeHtml(r.sym.slice(0, 1).toUpperCase()) + "</span>";
  }

  // ── holdings table ───────────────────────────────────────────────────────
  function rowHtml(r: AggRow, isAll: boolean, opts?: { tail?: boolean }): string {
    opts = opts || {};
    const usdEmph = lens === "assets" ? " col-emph" : "";
    const ovEmph = lens === "risk" ? " col-emph" : "";
    const rc = riskClass(r.risk);
    const dim = lens === "risk" && !rc ? " row-dim" : "";
    const tail = opts.tail ? " row-tail" : "";
    const walletCell = isAll ? walletChips(r.wallets || []) : '<span class="w-single">' + escapeHtml(WLABEL[sel]) + "</span>";
    const balUnit = r.unit ? ' <span class="bal-unit">' + escapeHtml(r.unit) + "</span>" : "";
    return (
      '<tr class="' + escapeAttr((rc + dim + tail).trim()) + '">' +
      '<td><div class="asset-cell">' + assetAvatar(r) +
      '<span class="asset-txt">' +
      '<span class="asset-sym">' + escapeHtml(r.sym) + kindTag(r.kind) + "</span>" +
      '<span class="asset-chain">' + escapeHtml(r.chain) + "</span>" +
      "</span></div></td>" +
      "<td>" + walletCell + "</td>" +
      '<td class="num">' + escapeHtml(r.bal) + balUnit + "</td>" +
      '<td class="num strong' + usdEmph + '">' + escapeHtml(r.usd) + "</td>" +
      '<td class="' + ovEmph.trim() + '">' + exposureCell(r) + "</td>" +
      "</tr>"
    );
  }

  // 자산 아바타 + 체인 배지(우하단). Extension pages must never fetch token or
  // chain logos from third-party CDNs because those image requests leak the
  // user's viewed holdings to the remote host. Token logos load from locally
  // bundled SVG files (public/picture/tokens/, same-origin); chain badges use
  // inline SVG seeded by donuts.ts. Unknown symbols/chains fall back (letter / no badge).
  function assetAvatar(r: AggRow): string {
    const base = tokenBase(r);
    const L = (window.DAMBI_CHAIN_LOGOS && window.DAMBI_CHAIN_LOGOS.byName) || {};
    const badge = Object.prototype.hasOwnProperty.call(L, r.chain) ? '<span class="chain-badge">' + L[r.chain] + "</span>" : "";
    return '<span class="asset-av">' + base + badge + "</span>";
  }

  // 지갑 칩 — 한 줄 고정, 많으면 +N
  function walletChips(wallets: string[]): string {
    const max = 2;
    const head = wallets
      .slice(0, max)
      .map(function (w) {
        return '<button class="wallet-jump" data-jump="' + escapeAttr(w) + '">' + escapeHtml(WLABEL[w]) + "</button>";
      })
      .join("");
    const more = wallets.length > max ? '<span class="w-more">+' + (wallets.length - max) + "</span>" : "";
    return '<div class="wallet-chips">' + head + more + "</div>";
  }

  // 구간 헤더 행
  function groupHead(cls: string, title: string, n: number, amountText: string): string {
    return (
      '<tr class="grp-head ' + safeClassToken(cls) + '"><td colspan="5"><div class="gh-row">' +
      (cls === "warn" ? '<span class="gh-ic">⚠</span>' : "") +
      '<span class="gh-t">' + escapeHtml(title) + "</span>" +
      '<span class="gh-n">' + escapeHtml(T("assets.holdings.count", { count: n })) + "</span>" +
      '<span class="gh-m">' + escapeHtml(amountText) + "</span>" +
      "</div></td></tr>"
    );
  }

  function renderHoldings(): void {
    const isAll = sel === "all";
    const all = (isAll ? AGG : PW[sel] || []).slice();

    const byValueRisk = function (a: AggRow, b: AggRow): number {
      if (lens === "risk") {
        const d = riskScore(a.risk) - riskScore(b.risk);
        if (d !== 0) return d;
      }
      return b.usdNum + b.varNum - (a.usdNum + a.varNum);
    };
    all.sort(byValueRisk);

    const usdEmph = lens === "assets" ? " col-emph" : "";
    const ovEmph = lens === "risk" ? " col-emph" : "";

    let bodyRows: string;
    const filtering = holdingsFilter.trim().length > 0;

    if (filtering) {
      const q = holdingsFilter.trim().toLowerCase();
      const hits = all.filter(function (r) {
        return r.sym.toLowerCase().indexOf(q) >= 0;
      });
      bodyRows = hits.length
        ? hits
            .map(function (r) {
              return rowHtml(r, isAll);
            })
            .join("")
        : '<tr><td colspan="5" class="lens-empty-note">' + escapeHtml(T("assets.holdings.searchEmpty", { q: holdingsFilter })) + "</td></tr>";
    } else {
      const atRisk = all.filter(function (r) {
        return expSeverity(r) !== "none";
      });
      const clean = all.filter(function (r) {
        return expSeverity(r) === "none";
      });
      const money2 = function (n: number) {
        return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
      };

      bodyRows = "";
      if (lens === "risk") {
        bodyRows += all
          .map(function (r) {
            return rowHtml(r, isAll);
          })
          .join("");
      } else {
        if (atRisk.length) {
          const riskUsd = atRisk.reduce(function (s, r) {
            return s + r.varNum;
          }, 0);
          bodyRows += groupHead("warn", T("assets.holdings.groupAtRisk"), atRisk.length, T("assets.holdings.exposureN", { amount: money2(riskUsd) }));
          bodyRows += atRisk
            .map(function (r) {
              return rowHtml(r, isAll);
            })
            .join("");
        }
        if (clean.length) {
          const cleanUsd = clean.reduce(function (s, r) {
            return s + r.usdNum;
          }, 0);
          bodyRows += groupHead("", T("assets.holdings.groupClean"), clean.length, money2(cleanUsd));
          bodyRows += clean
            .map(function (r) {
              return rowHtml(r, isAll);
            })
            .join("");
        }
      }
    }

    const scrollCls = filtering || all.length > 12 ? " scroll-cap" : "";
    const host = el("holdings-host");
    if (host) {
      host.innerHTML =
        '<div class="tbl-wrap lens-' + lens + scrollCls + '">' +
        "<table><thead><tr>" +
        "<th>" + escapeHtml(T("assets.cols.asset")) + "</th><th>" + escapeHtml(T("assets.cols.wallet")) + "</th>" +
        '<th class="num">' + escapeHtml(T("assets.cols.balance")) + "</th>" +
        '<th class="num' + usdEmph + '">' + escapeHtml(T("assets.cols.usd")) + "</th>" +
        '<th class="' + ovEmph.trim() + '"><span class="th-help">' + escapeHtml(T("assets.cols.riskExposure")) + '<span class="th-q">?</span><span class="th-tip">' +
        riskLegend() +
        "</span></span></th>" +
        "</tr></thead><tbody>" +
        bodyRows +
        "</tbody></table>" +
        "</div>";
    }

    const toggle = el("tail-toggle");
    if (toggle)
      toggle.addEventListener("click", function () {
        renderHoldings();
      });

    const allKeys = Object.keys(PW);
    const tokens = isAll ? all.length : (PW[sel] || []).length;
    const meta = el("holdings-meta");
    if (meta)
      meta.textContent = isAll
        ? T("assets.holdings.metaAll", { wallets: allKeys.length, tokens })
        : T("assets.holdings.metaOne", { tokens });
  }

  // ── approvals table ──────────────────────────────────────────────────────
  function sevOf(risk: string[]): number {
    return risk.indexOf("BLOCKED") >= 0 ? 0 : risk.indexOf("UNLIMITED") >= 0 ? 1 : risk.indexOf("OLD") >= 0 ? 2 : 3;
  }
  function renderApprovals(): void {
    const isAll = sel === "all";
    const rows = APPR.filter(function (a) {
      return isAll || a.w === sel;
    }).slice();
    rows.sort(function (a, b) {
      return sevOf(a.risk) - sevOf(b.risk);
    });

    const body = rows.length
      ? rows
          .map(function (r) {
            const action = r.revoke
              ? '<a class="btn danger" href="https://revoke.cash" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">revoke</a>'
              : '<span style="font-size:11px; color:var(--slate-400);">—</span>';
            return (
              "<tr>" +
              '<td class="strong" style="text-transform:uppercase; font-size:11px;">' + escapeHtml(r.type) + "</td>" +
              '<td class="mono">' + escapeHtml(r.token) + "</td>" +
              '<td class="mono">' + escapeHtml(WLABEL[r.w]) + "</td>" +
              '<td><span class="mono">' + escapeHtml(r.spender) + "</span></td>" +
              '<td class="mono num">' + escapeHtml(r.amount) + "</td>" +
              "<td>" +
              (function () {
                const v = visibleRisk(r.risk);
                return v.length
                  ? v
                      .map(function (t) {
                        return '<span class="risk-tag ' + safeClassToken(t) + '" title="' + escapeAttr(riskDesc(t)) + '">' + escapeHtml(riskLabel(t)) + "</span>";
                      })
                      .join("")
                  : '<span class="r-safe">—</span>';
              })() +
              "</td>" +
              "<td>" + action + "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="7" class="empty-cell">' + escapeHtml(T("assets.approvals.empty")) + "</td></tr>";

    const host = el("approvals-host");
    if (host) {
      host.innerHTML =
        '<div class="tbl-wrap"><table><thead><tr>' +
        "<th>" + escapeHtml(T("assets.cols.type")) + "</th><th>" + escapeHtml(T("assets.cols.tokenOrCollection")) + "</th><th>" + escapeHtml(T("assets.cols.wallet")) + "</th><th>" + escapeHtml(T("assets.cols.spenderOperator")) + "</th><th>" + escapeHtml(T("assets.cols.amount")) + "</th><th>" + escapeHtml(T("assets.cols.risk")) + "</th>" +
        '<th style="width:80px;">' + escapeHtml(T("assets.cols.action")) + "</th>" +
        "</tr></thead><tbody>" +
        body +
        "</tbody></table></div>";
    }

    const meta = el("approvals-meta");
    if (meta)
      meta.textContent = isAll
        ? REPUTATION_CONNECTED
          ? T("assets.approvals.metaBlocked")
          : T("assets.approvals.metaUnlimited")
        : T("assets.approvals.metaCount", { count: rows.length });
  }

  // ── pending table ────────────────────────────────────────────────────────
  function renderPending(): void {
    const isAll = sel === "all";
    const rows = PEND.filter(function (p) {
      return isAll || p.w === sel;
    });
    if (!rows.length) {
      const host0 = el("pending-host");
      if (host0)
        host0.innerHTML =
          '<div class="tbl-wrap"><table><thead><tr>' +
          "<th>" + escapeHtml(T("assets.cols.type")) + "</th><th>" + escapeHtml(T("assets.cols.wallet")) + "</th><th>" + escapeHtml(T("assets.cols.summary")) + "</th><th class=\"num\">" + escapeHtml(T("assets.cols.signedAt")) + "</th>" +
          "</tr></thead><tbody>" +
          '<tr><td colspan="4" class="empty-cell">' + escapeHtml(T("assets.pending.empty")) + "</td></tr>" +
          "</tbody></table></div>";
      return;
    }
    const icIntent =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4"></path><path d="M20 7H7a4 4 0 0 0-4 4"></path><path d="M8 21l-4-4 4-4"></path><path d="M4 17h13a4 4 0 0 0 4-4"></path></svg>';
    const icPermit =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"></path><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path></svg>';
    const body = rows
      .map(function (p) {
        const ic = p.kind === "intent" ? icIntent : icPermit;
        const summary =
          p.kind === "intent"
            ? '<span class="ps-leg"><span class="ps-k">' + escapeHtml(T("assets.pending.sellMax")) + "</span><b>" + escapeHtml(p.sell) + "</b></span>" +
              '<span class="ps-arrow"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg></span>' +
              '<span class="ps-leg"><span class="ps-k">' + escapeHtml(T("assets.pending.buyMin")) + "</span><b>" + escapeHtml(p.buy) + "</b></span>"
            : '<span class="ps-leg"><span class="ps-k">' + escapeHtml(T("assets.pending.allowance")) + "</span><b>" +
              escapeHtml(p.amount || "—") +
              "</b></span>" +
              '<span class="ps-spender">spender ' + escapeHtml(p.spender || "—") + "</span>";
        const venue = p.venue ? '<span class="pend-venue">' + escapeHtml(p.venue) + "</span>" : "";
        return (
          "<tr>" +
          '<td><span class="pend-type ' + safeClassToken(p.kind) + '"><span class="pt-ic">' + ic + "</span>" + escapeHtml(p.type) + "</span>" + venue + "</td>" +
          '<td class="mono">' + escapeHtml(WLABEL[p.w]) + "</td>" +
          '<td class="pend-sum">' + summary + "</td>" +
          '<td class="mono num pend-at">' + escapeHtml(p.at) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    const host = el("pending-host");
    if (host)
      host.innerHTML =
        '<div class="tbl-wrap"><table><thead><tr>' +
        "<th>" + escapeHtml(T("assets.cols.type")) + "</th><th>" + escapeHtml(T("assets.cols.wallet")) + "</th><th>" + escapeHtml(T("assets.cols.summary")) + "</th><th class=\"num\">" + escapeHtml(T("assets.cols.signedAt")) + "</th>" +
        "</tr></thead><tbody>" +
        body +
        "</tbody></table></div>";
  }

  // ── Hyperliquid (capability-gated: any wallet may hold an HL account) ──────
  function hlMap(): Record<string, HlAccountView> {
    return ((window.DAMBI_DATA as DambiDataShape | undefined)?.HL) || {};
  }
  function hlList(): HlAccountView[] {
    const HL = hlMap();
    if (sel === "all") return Object.keys(HL).map((k) => HL[k]);
    return HL[sel] ? [HL[sel]] : [];
  }
  function money2int(n: number): string {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function hlCardHtml(a: HlAccountView): string {
    // Mirror the static Dashboard Assets.html .hl-card structure exactly.
    const posRows = a.positions.length
      ? a.positions
          .map(function (p) {
            const sideCls = p.side === "long" ? "long" : "short";
            return (
              '<tr class="' + safeClassToken(sideCls) + '">' +
              '<td class="sym">' + escapeHtml(p.sym) + "</td>" +
              '<td><span class="hl-side ' + safeClassToken(sideCls) + '">' + escapeHtml(p.side === "long" ? T("hl.long") : T("hl.short")) + '</span><span class="hl-lev">' + escapeHtml(p.leverage) + "</span></td>" +
              '<td class="num">' + escapeHtml(p.size) + "</td>" +
              '<td class="num">' + escapeHtml(p.entry) + "</td>" +
              '<td class="num val">' + escapeHtml(money2int(p.value)) + "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5" class="empty-cell">' + escapeHtml(T("assets.hl.posEmpty")) + "</td></tr>";

    const ordRows = a.orders.length
      ? a.orders
          .map(function (o) {
            const sideCls = o.side === "buy" ? "long" : "short";
            const kindCls = o.kind === "tp" ? "hl-tp" : "hl-sl";
            return (
              "<tr>" +
              '<td class="sym">' + escapeHtml(o.sym) + "</td>" +
              '<td><span class="hl-side ' + safeClassToken(sideCls) + '">' + escapeHtml(T("assets.hl." + (o.side === "buy" ? "buy" : "sell"))) + '</span><span class="' + safeClassToken(kindCls) + '">' + escapeHtml(T("assets.hl." + o.kind)) + "</span></td>" +
              '<td class="num"><b>' + escapeHtml(o.trigger) + "</b> → <b>" + escapeHtml(o.limit) + "</b></td>" +
              '<td class="cond num">' + escapeHtml(o.cond) + "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="4" class="empty-cell">' + escapeHtml(T("assets.hl.ordEmpty")) + "</td></tr>";

    const head =
      '<div class="hl-card-head">' +
      '<span class="hl-wallet">' + escapeHtml(a.walletLabel) + "</span>" +
      '<div class="hl-meta">' +
      '<span class="hl-bal"><span class="bk">Perp</span><span class="bv">' + escapeHtml(money2dec(a.perpUsd)) + "</span></span>" +
      '<span class="hl-bal"><span class="bk">Spot</span><span class="bv">' + escapeHtml(money2dec(a.spotUsd)) + "</span></span>" +
      "</div></div>";
    // 활동(포지션·오픈오더) 전무 → 헤더만 달린 빈 테이블 2개(스캐폴드 느낌) 대신 단일 정돈된 빈 상태.
    if (!a.positions.length && !a.orders.length) {
      return (
        head +
        '<div class="hl-empty">' +
        '<span class="hl-empty-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v14h14"/><path d="M8.5 13h8" stroke-opacity=".4"/></svg></span>' +
        '<span class="hl-empty-txt">' + escapeHtml(T("assets.hl.noActivity")) + "</span>" +
        "</div>"
      );
    }
    return (
      head +
      '<div class="hl-cols">' +
      '<div class="hl-col">' +
      '<div class="hl-block-label">' + escapeHtml(T("assets.hl.positions")) + ' <span class="hl-n">' + escapeHtml(a.positions.length) + "</span></div>" +
      '<table class="hl-tbl">' +
      "<thead><tr><th>" + escapeHtml(T("assets.hl.sym")) + "</th><th>" + escapeHtml(T("assets.hl.side")) + "</th><th class=\"num\">" + escapeHtml(T("assets.hl.size")) + "</th><th class=\"num\">" + escapeHtml(T("assets.hl.entry")) + "</th><th class=\"num\">" + escapeHtml(T("assets.hl.value")) + "</th></tr></thead>" +
      "<tbody>" + posRows + "</tbody></table>" +
      "</div>" +
      '<div class="hl-col">' +
      '<div class="hl-block-label">' + escapeHtml(T("assets.hl.openOrders")) + ' <span class="hl-n">' + escapeHtml(a.orders.length) + "</span></div>" +
      '<table class="hl-tbl">' +
      "<thead><tr><th>" + escapeHtml(T("assets.hl.sym")) + "</th><th>" + escapeHtml(T("assets.hl.kind")) + "</th><th class=\"num\">" + escapeHtml(T("assets.hl.triggerLimit")) + "</th><th class=\"num\">" + escapeHtml(T("assets.hl.cond")) + "</th></tr></thead>" +
      "<tbody>" + ordRows + "</tbody></table>" +
      "</div>" +
      "</div>"
    );
  }
  function money2dec(n: number): string {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function renderHl(): void {
    const section = el("hl-section");
    if (!section) return;
    const baseList = hlList();
    if (!baseList.length) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    // 지갑별 탭 — HL 계정이 둘 이상일 때만(전역 sel=all). hlSel 로 그 안에서 한
    // 지갑만 골라 본다. 매 렌더마다 탭을 새로 그려 active 상태를 반영.
    const secHead = section.querySelector(".sec-head");
    const oldTabs = section.querySelector(".hl-tabs");
    if (oldTabs) oldTabs.remove();
    const multi = baseList.length > 1;
    if (!multi) hlSel = "all";
    if (multi && hlSel !== "all" && !baseList.some((a) => a.wallet === hlSel)) hlSel = "all";
    if (multi && secHead) {
      const mk = (key: string, label: string) =>
        '<button type="button" class="hl-tab' +
        (hlSel === key ? " on" : "") +
        '" data-hl="' + escapeAttr(key) + '">' + escapeHtml(label) + "</button>";
      const tabs = document.createElement("div");
      tabs.className = "hl-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.innerHTML = mk("all", T("assets.hl.tabAll")) + baseList.map((a) => mk(a.wallet, a.walletLabel)).join("");
      tabs.querySelectorAll(".hl-tab").forEach((b) =>
        b.addEventListener("click", function () {
          hlSel = (b as HTMLElement).getAttribute("data-hl") || "all";
          renderHl();
        }),
      );
      secHead.insertAdjacentElement("afterend", tabs);
    }

    const list = multi && hlSel !== "all" ? baseList.filter((a) => a.wallet === hlSel) : baseList;

    // The static markup ships a single .hl-card host. Reuse it for the first
    // account and emit one sibling .hl-card per additional account, keeping the
    // exact ASS_v2 card structure (so layout-modes hlSummary() still scrapes it).
    const extra = section.querySelectorAll(".hl-card");
    extra.forEach(function (c, i) {
      if (i > 0) c.remove();
    });
    const host = section.querySelector(".hl-card") as HTMLElement | null;
    if (!host) return;
    host.innerHTML = hlCardHtml(list[0]);
    let after: HTMLElement = host;
    for (let i = 1; i < list.length; i++) {
      const card = document.createElement("div");
      card.className = "hl-card";
      card.innerHTML = hlCardHtml(list[i]);
      after.insertAdjacentElement("afterend", card);
      after = card;
    }
  }

  // ── L2 header band + action queue ────────────────────────────────────────
  function renderL2Extra(): void {
    const host = el("l2-extra");
    if (!host) return;
    if (sel === "all") {
      host.innerHTML = "";
      return;
    }
    const m = WMETA[sel];
    if (!m) {
      host.innerHTML = "";
      return;
    }

    let statusChips = "";
    if (m.fail > 0) statusChips += '<span class="l2-chip fail"><span class="lc-dot"></span>FAIL <b>' + escapeHtml(m.fail) + "</b></span>";
    if (m.warn > 0) statusChips += '<span class="l2-chip warn"><span class="lc-dot"></span>WARN <b>' + escapeHtml(m.warn) + "</b></span>";
    if (m.fail === 0 && m.warn === 0) statusChips += '<span class="l2-chip calm"><span class="lc-dot"></span>Calm</span>';

    const short = m.full.slice(0, 6) + "···" + m.full.slice(-4);
    const varNum = parseInt(String(m.varUsd).replace(/[^0-9]/g, ""), 10) || 0;
    const calm = varNum === 0 && m.unlimited === 0;

    const riskRows =
      '<div class="wrisk-row' + (varNum > 0 ? " on" : "") + '">' +
      '<span class="wr-dot warn"></span><span class="wr-k">' + escapeHtml(T("assets.l2.currentVar")) + "</span>" +
      '<span class="wr-v' + (varNum > 0 ? " warn" : "") + '">' + escapeHtml(m.varUsd) + "</span></div>" +
      '<div class="wrisk-row' + (m.unlimited > 0 ? " on" : "") + '">' +
      '<span class="wr-dot warn"></span><span class="wr-k">' + escapeHtml(T("assets.l2.unlimitedApprovals")) + "</span>" +
      '<span class="wr-v' + (m.unlimited > 0 ? " warn" : "") + '">' + escapeHtml(T("assets.l2.countCases", { count: m.unlimited })) + "</span></div>" +
      (m.pending > 0
        ? '<div class="wrisk-row"><span class="wr-dot slate"></span><span class="wr-k">' + escapeHtml(T("assets.l2.pendingOrders")) + '</span><span class="wr-v">' + escapeHtml(T("assets.l2.countCases", { count: m.pending })) + "</span></div>"
        : "");

    const wriskBody = calm
      ? '<div class="wrisk-calm">' + escapeHtml(T("assets.l2.calm")) + "</div>"
      : '<div class="wrisk-rows">' + riskRows + "</div>";

    const band =
      '<div class="wsum-grid">' +
      '<div class="chain-card wsum-card">' +
      '<div class="cc-head"><span class="cc-ttl">' + escapeHtml(T("assets.l2.overview")) + "</span>" + statusChips + "</div>" +
      '<div class="wsum-total"><span class="wsum-k">' + escapeHtml(T("assets.l2.totalAssets")) + '</span><span class="wsum-v">' + escapeHtml(m.totalUsd) + "</span></div>" +
      '<div class="wsum-id"><span class="wsum-name">' + escapeHtml(m.label) + '</span><span class="wsum-addr mono">' + escapeHtml(short) + "</span></div>" +
      "</div>" +
      '<div class="chain-card wrisk-card">' +
      '<div class="cc-head"><span class="cc-ttl">' + escapeHtml(T("assets.l2.riskExposure")) + "</span></div>" +
      wriskBody +
      "</div>" +
      "</div>";

    host.innerHTML = band;

    const wsumEl = host.querySelector(".wsum-card") as HTMLElement | null;
    const wriskEl = host.querySelector(".wrisk-card") as HTMLElement | null;
    if (wsumEl && wriskEl) {
      wriskEl.style.height = "";
      const h = wsumEl.offsetHeight;
      if (h > 0) wriskEl.style.height = h + "px";
    }
  }

  // ── risk-suggest banner ──────────────────────────────────────────────────
  function bannerHit(): number {
    const rows = sel === "all" ? AGG : PW[sel] || [];
    const key = REPUTATION_CONNECTED ? "BLOCKED" : "UNLIMITED";
    return rows.filter(function (r) {
      return r.risk.indexOf(key) >= 0;
    }).length;
  }
  function renderBanner(): void {
    const host = el("banner-host");
    if (!host) return;
    const n = bannerHit();
    if (lens === "assets" && !bannerDismissed && n > 0) {
      const msg = REPUTATION_CONNECTED
        ? T("assets.banner.blocked", { count: n })
        : T("assets.banner.unlimited", { count: n });
      host.innerHTML =
        '<div class="risk-suggest">' +
        '<span class="rs-ic">⚠</span>' +
      '<span class="rs-txt">' + escapeHtml(msg) + "</span>" +
      '<button class="rs-act" id="banner-switch">' + escapeHtml(T("assets.banner.switch")) + "</button>" +
        '<button class="rs-dismiss" id="banner-x" aria-label="dismiss">✕</button>' +
        "</div>";
      const bs = el("banner-switch");
      if (bs)
        bs.addEventListener("click", function () {
          setLens("risk");
        });
      const bx = el("banner-x");
      if (bx)
        bx.addEventListener("click", function () {
          bannerDismissed = true;
          renderBanner();
        });
    } else {
      host.innerHTML = "";
    }
  }

  // ── wallet chips (rebuilt from WLABEL/WMETA) ──────────────────────────────
  function shortFull(full: string): string {
    if (!full || full.length < 12) return full;
    return full.slice(0, 6) + "···" + full.slice(-4);
  }
  function renderWalletChips(): void {
    const track = el("wallet-switch");
    if (!track) return;
    const keys = Object.keys(WMETA);
    const total = keys.length;
    let html = '<button class="ws-chip" data-wallet="all">' + escapeHtml(T("assets.allWallets")) + ' <span class="ws-amt">' + escapeHtml(total) + "</span></button>";
    keys.forEach(function (k) {
      const m = WMETA[k];
      const dot = m.fail > 0 ? "fail" : m.warn > 0 ? "warn" : "calm";
      const label = WLABEL[k] || m.label || k;
      html +=
        '<button class="ws-chip" data-wallet="' + escapeAttr(k) + '">' +
        '<span class="ws-dot ' + safeClassToken(dot) + '"></span>' +
        escapeHtml(label) +
        ' <span class="ws-amt">' + escapeHtml(shortFull(m.full)) + "</span></button>";
    });
    track.innerHTML = html;
  }

  // ── chrome (wallet chip state, lens buttons, l1 visibility, meta) ─────────
  function renderChrome(): void {
    const isAll = sel === "all";
    const ws = el("wallet-switch");
    if (ws)
      Array.prototype.forEach.call(ws.querySelectorAll(".ws-chip"), function (c: Element) {
        c.classList.toggle("on", c.getAttribute("data-wallet") === sel);
      });
    const lt = el("lens-toggle");
    if (lt)
      Array.prototype.forEach.call(lt.querySelectorAll(".lens-btn"), function (b: Element) {
        const on = b.getAttribute("data-lens") === lens;
        b.classList.toggle("on", on);
        b.classList.toggle("risk-on", on && lens === "risk");
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    const l1 = el("l1-extra");
    if (l1) l1.style.display = isAll ? "" : "none";
    const lm = el("lens-meta");
    if (lm) {
      lm.style.display = isAll ? "" : "none";
      lm.textContent = lens === "risk" ? T("assets.chrome.sortRisk") : T("assets.chrome.sortUsd");
    }
    const main = root.querySelector(".app-content");
    if (main) main.setAttribute("data-screen-label", isAll ? T("assets.screenAll") : T("assets.screenWallet", { label: WLABEL[sel] }));
  }

  // ── summary for layout-mode chrome (alert strip / segment counts) ────────
  function smoney(n: number): string {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function hlAvailableFor(s: string): boolean {
    const HL = hlMap();
    return s === "all" ? Object.keys(HL).length > 0 : !!HL[s];
  }
  function buildSummary() {
    const isAll = sel === "all";
    const apprRows = APPR.filter(function (a) {
      return isAll || a.w === sel;
    });
    let unlimited = 0,
      blocked = 0,
      oldCnt = 0;
    apprRows.forEach(function (a) {
      const v = visibleRisk(a.risk);
      if (v.indexOf("UNLIMITED") >= 0) unlimited++;
      if (v.indexOf("BLOCKED") >= 0) blocked++;
      if (v.indexOf("OLD") >= 0) oldCnt++;
    });
    const holds = isAll ? AGG : PW[sel] || [];
    const exposure = holds.reduce(function (s, r) {
      return s + (r.varNum || 0);
    }, 0);
    const holdingsUsd = holds.reduce(function (s, r) {
      return s + (r.usdNum || 0);
    }, 0);
    const pend = PEND.filter(function (p) {
      return isAll || p.w === sel;
    }).length;
    return {
      sel: sel,
      walletLabel: isAll ? T("assets.allWallets") : WLABEL[sel],
      unlimited: unlimited,
      blocked: blocked,
      old: oldCnt,
      pending: pend,
      exposureUsd: exposure,
      exposureTxt: smoney(exposure),
      holdingsUsd: holdingsUsd,
      holdingsUsdTxt: smoney(holdingsUsd),
      holdingsCount: holds.length,
      apprCount: apprRows.length,
      hlAvailable: hlAvailableFor(sel),
      flags: {
        holdings: exposure > 0 ? "warn" : null,
        approvals: blocked > 0 ? "fail" : unlimited > 0 ? "warn" : null,
        pending: null,
        hl: null,
      },
    };
  }

  // ── live-data sync ────────────────────────────────────────────────────────
  // React re-injects window.DAMBI_DATA on every data/selection change and then
  // calls DAMBI_RENDER(). Re-read the injected data into our locals each render so
  // the prototype's render fns (which read these vars) reflect the live model —
  // including `sel` (URL-driven wallet selection → L1↔L2 drilldown).
  function syncData(): void {
    const next = window.DAMBI_DATA as DambiDataShape | undefined;
    if (!next) return;
    D = next;
    if (next.WLABEL) WLABEL = next.WLABEL;
    if (next.WMETA) WMETA = next.WMETA;
    if (next.AGG) AGG = next.AGG;
    if (next.PW) PW = next.PW;
    if (next.APPR) APPR = next.APPR;
    if (next.PEND) PEND = next.PEND;
    if (typeof next.sel === "string") sel = next.sel;
  }

  // ── full render ──────────────────────────────────────────────────────────
  function render(): void {
    syncData();
    renderWalletChips();
    renderChrome();
    renderL2Extra();
    renderBanner();
    renderHoldings();
    renderApprovals();
    renderHl();
    renderPending();
    document.dispatchEvent(new CustomEvent("dambi:render", { detail: buildSummary() }));
  }

  function setSel(next: string): void {
    if (sel === next) return;
    sel = next;
    bannerDismissed = false;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function setLens(next: "assets" | "risk"): void {
    if (lens === next) return;
    lens = next;
    render();
  }

  // ── wiring (root-scoped) ──────────────────────────────────────────────────
  const wsHandler = function (e: Event) {
    const chip = (e.target as HTMLElement).closest(".ws-chip");
    if (chip) {
      const key = chip.getAttribute("data-wallet") || "all";
      if (window.DAMBI_SET_SEL) window.DAMBI_SET_SEL(key);
      else setSel(key);
    }
  };
  const lensHandler = function (e: Event) {
    const btn = (e.target as HTMLElement).closest(".lens-btn");
    if (btn) setLens((btn.getAttribute("data-lens") as "assets" | "risk") || "assets");
  };
  const holdingsHandler = function (e: Event) {
    const j = (e.target as HTMLElement).closest(".wallet-jump");
    if (j && j.getAttribute("data-jump")) {
      const key = j.getAttribute("data-jump") || "all";
      if (window.DAMBI_SET_SEL) window.DAMBI_SET_SEL(key);
      else setSel(key);
    }
  };
  const filterHandler = function (e: Event) {
    holdingsFilter = (e.target as HTMLInputElement).value;
    renderHoldings();
  };
  // CSP: delegated capture-phase img error handler (replaces inline onerror).
  const errHandler = function (e: Event) {
    const t = e.target as HTMLElement;
    if (t && t.tagName === "IMG") {
      const m = t.getAttribute("data-onerr");
      if (m === "img") imgFail(t as HTMLImageElement);
      else if (m === "badge") badgeFail(t as HTMLImageElement);
    }
  };

  const wsEl = el("wallet-switch");
  if (wsEl) wsEl.addEventListener("click", wsHandler);
  const lensToggleEl = el("lens-toggle");
  if (lensToggleEl) lensToggleEl.addEventListener("click", lensHandler);
  const holdingsHostEl = el("holdings-host");
  if (holdingsHostEl) holdingsHostEl.addEventListener("click", holdingsHandler);
  const filterEl = el("holdings-filter");
  if (filterEl) filterEl.addEventListener("input", filterHandler);
  root.addEventListener("error", errHandler, true);

  // ── window exposure for the React wrapper + layout-modes.ts ───────────────
  window.DAMBI_RENDER = render;
  window.DAMBI_RENDER_STATIC = function () {
    syncData();
    renderWalletChips();
    if (window.DAMBI_REBUILD_DONUTS) window.DAMBI_REBUILD_DONUTS();
  };
  window.DAMBI_getSummary = buildSummary;

  render();

  return function teardown() {
    if (wsEl) wsEl.removeEventListener("click", wsHandler);
    if (lensToggleEl) lensToggleEl.removeEventListener("click", lensHandler);
    if (holdingsHostEl) holdingsHostEl.removeEventListener("click", holdingsHandler);
    if (filterEl) filterEl.removeEventListener("input", filterHandler);
    root.removeEventListener("error", errHandler, true);
    window.DAMBI_RENDER = undefined;
    window.DAMBI_RENDER_STATIC = undefined;
    window.DAMBI_getSummary = undefined;
  };
}
