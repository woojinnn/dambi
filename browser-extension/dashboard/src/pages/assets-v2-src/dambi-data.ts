/* dambi-data.ts — adapter: useAssetsData() live data → the ASS_v2 DAMBI_DATA shape.
 *
 * The ASS_v2 prototype (assets-app.ts / donuts.ts / layout-modes.ts) reads six
 * data definitions (WLABEL/WMETA/AGG/PW/APPR/PEND) + sel + donut + HL from
 * window.DAMBI_DATA. This builds that object from the live server DTOs, reusing
 * the shared data/risk helpers so numbers match the rest of the dashboard.
 *
 * Wallet key = the wallet's real address (no id↔address alias). Every transform
 * is best-effort and must never throw — opaque/unknown fields degrade to "—".
 */

import i18n from "i18next";

import {
  hlAccountOf,
  type ClassifiedApprovals,
  type DashboardWalletSummary,
  type HlAccount,
  type PendingTx,
  type Position,
  type TokenHolding,
} from "../../server-api";
import {
  chainColor,
  chainName,
  chainOf,
  addressOf,
  groupKeyOf,
  kindOfStandard,
  shortAddr,
  standardOf,
  type DonutData,
} from "../monitoring/data";
import {
  riskTagsFor,
  toHuman,
  varOfHolding,
  visibleRisk,
  type ApprovalIndex,
} from "../monitoring/risk";

// ── DAMBI_DATA shape (matches the prototype's var definitions) ────────────────
export interface DambiWMeta {
  label: string;
  full: string;
  totalUsd: string;
  fail: number;
  warn: number;
  pending: number;
  varUsd: string;
  unlimited: number;
}
export interface DambiAggRow {
  sym: string;
  kind: string;
  chain: string;
  cc: string;
  wallets?: string[];
  bal: string;
  unit: string;
  usd: string;
  usdNum: number;
  risk: string[];
  varTxt: string;
  varCls: string;
  varNum: number;
}
export interface DambiApprRow {
  w: string;
  type: string;
  token: string;
  spender: string;
  chain: string;
  amount: string;
  risk: string[];
  revoke: boolean;
}
export interface DambiPendRow {
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
export interface DambiHlPos {
  sym: string;
  side: string;
  size: number;
  entry: number;
  value: number;
  leverage: string;
}
export interface DambiHlOrder {
  sym: string;
  side: string;
  kind: string;
  trigger: string;
  limit: string;
  cond: string;
}
export interface DambiHlAccount {
  wallet: string;
  walletLabel: string;
  perpUsd: number;
  spotUsd: number;
  positions: DambiHlPos[];
  orders: DambiHlOrder[];
}
export interface DambiData {
  WLABEL: Record<string, string>;
  WMETA: Record<string, DambiWMeta>;
  AGG: DambiAggRow[];
  PW: Record<string, DambiAggRow[]>;
  APPR: DambiApprRow[];
  PEND: DambiPendRow[];
  HL: Record<string, DambiHlAccount>;
  donut: DonutData | null;
  sel: string;
}

// The subset of useAssetsData()'s return that the adapter consumes.
interface QueryLike<T> {
  data?: T;
}
export interface AssetsDataLike {
  sel: "all" | string;
  wallets: DashboardWalletSummary[];
  targetWallets: DashboardWalletSummary[];
  holdingsQs: Array<QueryLike<TokenHolding[]>>;
  approvalsQs: Array<QueryLike<ClassifiedApprovals>>;
  positionsQs: Array<QueryLike<Position[]>>;
  pendingQs: Array<QueryLike<PendingTx[]>>;
  indexes: Map<string, ApprovalIndex>;
  donutData: DonutData | null;
}

// i18n display helper (monitoring namespace). Order/position side + kind are
// emitted as SEMANTIC keys ("buy"/"sell"/"tp"/…) so assets-app can pick CSS
// classes; only the free-text display strings (leverage, condition, pending
// types) are localized here. Model rebuilds on language change (Assets2Page).
function T(key: string, vars?: Record<string, unknown>): string {
  return i18n.t(`monitoring:${key}`, vars ?? {});
}

// ── formatting ──────────────────────────────────────────────────────────────
function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtUsd0(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtBal(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

// ── small DTO helpers ───────────────────────────────────────────────────────
function num(s: unknown): number {
  const n = Number(s ?? "0");
  return isFinite(n) ? n : 0;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
/** Best-effort label out of an opaque {Token,Venue,Market}Ref-style object. */
function labelOf(ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") {
    const o = ref as Record<string, unknown>;
    return (
      str(o.symbol) ||
      str(o.name) ||
      str(o.venue) ||
      str(o.label) ||
      str(o.coin) ||
      (typeof o.address === "string" ? shortAddr(o.address) : "") ||
      ""
    );
  }
  return "";
}

// ── holdings → grouped AGG rows ─────────────────────────────────────────────
interface GroupAcc {
  sym: string;
  kind: string;
  chain: string;
  cc: string;
  walletsSet: Set<string>;
  balUnits: number;
  unit: string;
  usdNum: number;
  riskSet: Set<string>;
  varNum: number;
}

function decimalsOf(h: TokenHolding): number {
  return typeof h.decimals === "number" ? h.decimals : 0;
}

/** Group a set of (wallet, holding) pairs into the prototype's AGG/PW rows. */
function groupHoldings(
  pairs: Array<{ walletAddr: string; h: TokenHolding; apIdx?: ApprovalIndex }>,
  includeWallets: boolean,
): DambiAggRow[] {
  const groups = new Map<string, GroupAcc>();
  pairs.forEach(({ walletAddr, h, apIdx }) => {
    const key = groupKeyOf(h);
    const ch = chainOf(h);
    const std = standardOf(h);
    const kind = kindOfStandard(std);
    let g = groups.get(key);
    if (!g) {
      g = {
        sym: h.symbol || "?",
        kind: kind === "other" ? "erc20" : kind,
        chain: ch ? chainName(ch) : "",
        cc: ch ? chainColor(ch) : "#AEB6C2", // stone-300 (DEEP fallback)
        walletsSet: new Set<string>(),
        balUnits: 0,
        unit: kind === "nft" ? "" : h.symbol || "",
        usdNum: 0,
        riskSet: new Set<string>(),
        varNum: 0,
      };
      groups.set(key, g);
    }
    g.walletsSet.add(walletAddr);
    g.balUnits += toHuman(num(h.balance?.amount), decimalsOf(h));
    g.usdNum += num(h.value_usd);
    g.varNum += varOfHolding(h, apIdx);
    visibleRisk(riskTagsFor(h, apIdx) as string[]).forEach((t) => g!.riskSet.add(t));
  });

  return Array.from(groups.values()).map((g) => {
    const risk = Array.from(g.riskSet);
    const row: DambiAggRow = {
      sym: g.sym,
      kind: g.kind,
      chain: g.chain,
      cc: g.cc,
      bal: fmtBal(g.balUnits),
      unit: g.unit,
      usdNum: g.usdNum,
      usd: g.usdNum > 0 ? fmtUsd(g.usdNum) : "—",
      risk,
      varNum: g.varNum,
      varTxt: fmtUsd0(g.varNum),
      varCls: risk.length ? "warn" : "slate",
    };
    if (includeWallets) row.wallets = Array.from(g.walletsSet);
    return row;
  });
}

// ── approvals → APPR rows ───────────────────────────────────────────────────
/** Look up a token's decimals from the wallet's holdings (for human amounts). */
function buildDecLookup(holdings: TokenHolding[]): Map<string, number> {
  const m = new Map<string, number>();
  holdings.forEach((h) => {
    const ch = chainOf(h);
    const addr = addressOf(h);
    if (ch && addr) m.set(`${ch}|${addr}`, decimalsOf(h));
  });
  return m;
}

function apprRowsFor(walletAddr: string, ap: ClassifiedApprovals | undefined, decLookup: Map<string, number>): DambiApprRow[] {
  if (!ap) return [];
  const out: DambiApprRow[] = [];
  ap.erc20.forEach((a) => {
    const dec = decLookup.get(`${a.chain}|${a.token.toLowerCase()}`) ?? 0;
    // 무제한 승인은 서버 is_unlimited 플래그뿐 아니라 원시 금액 크기로도 판정한다.
    // maxUint256 같은 "사실상 무제한" 센티넬을 서버가 놓치면 raw 정수가 그대로
    // (또는 decimals 미상이라 더 크게) 출력되는데, 2^255 이상은 정상 승인일 수
    // 없으므로 무제한으로 본다.
    const rawBig = (() => {
      try {
        return BigInt(a.amount);
      } catch {
        return null;
      }
    })();
    const unlimited = a.is_unlimited || (rawBig !== null && rawBig >= 1n << 255n);
    const amount = unlimited ? "Unlimited" : fmtBal(toHuman(num(a.amount), dec));
    const riskTags = a.risk as string[];
    const risk = visibleRisk(
      unlimited && !riskTags.includes("UNLIMITED") ? [...riskTags, "UNLIMITED"] : riskTags,
    );
    out.push({
      w: walletAddr,
      type: "erc20",
      token: shortAddr(a.token),
      spender: shortAddr(a.spender),
      chain: a.chain,
      amount,
      risk,
      revoke: true,
    });
  });
  ap.permit2.forEach((a) => {
    out.push({
      w: walletAddr,
      type: "permit2",
      token: shortAddr(a.token),
      spender: shortAddr(a.spender),
      chain: a.chain,
      amount: a.amount,
      risk: visibleRisk(a.risk as string[]),
      revoke: true,
    });
  });
  ap.set_for_all.forEach((a) => {
    out.push({
      w: walletAddr,
      type: "set_for_all",
      token: shortAddr(a.collection),
      spender: shortAddr(a.operator),
      chain: a.chain,
      amount: "—",
      risk: visibleRisk(a.risk as string[]),
      revoke: true,
    });
  });
  return out;
}

// ── pending → PEND rows ─────────────────────────────────────────────────────
function pendRowsFor(walletAddr: string, pending: PendingTx[] | undefined): DambiPendRow[] {
  if (!pending) return [];
  const locale = i18n.language === "en" ? "en-US" : "ko-KR";
  return pending.map((pt) => {
    const at = pt.signed_at ? new Date(pt.signed_at * 1000).toLocaleString(locale) : "—";
    const k = pt.kind;
    switch (k.kind) {
      case "offchain_limit_order": {
        const sell = labelOf(k.sell);
        const buy = labelOf(k.buy);
        return {
          w: walletAddr,
          kind: "intent",
          type: T("assets.pending.offchainOrder"),
          venue: labelOf(k.venue) || undefined,
          sell: (k.sell_max ? k.sell_max + " " : "") + sell || "—",
          buy: (k.buy_min ? k.buy_min + " " : "") + buy || "—",
          at,
        };
      }
      case "perp_venue_order": {
        const market = labelOf(k.market);
        return {
          w: walletAddr,
          kind: "intent",
          type: T("assets.pending.perpOrder"),
          venue: labelOf(k.venue) || undefined,
          sell: (k.side ? k.side + " " : "") + (k.size_base || "") + (market ? " " + market : "") || "—",
          buy: k.price ? "@ " + k.price : "—",
          at,
        };
      }
      case "signed_permit2":
      case "signed_permit2_transfer":
      case "signed_e_i_p2612": {
        const spender = k.spender ? shortAddr(k.spender) : "—";
        const amount = k.amount || "—";
        return {
          w: walletAddr,
          kind: "permit",
          type: k.kind === "signed_e_i_p2612" ? "Permit (EIP-2612)" : "Permit2",
          venue: T("assets.pending.tokenApproval"),
          amount,
          spender,
          at,
        };
      }
      default:
        return { w: walletAddr, kind: "permit", type: T("assets.pending.signature"), venue: "—", line: "—", at };
    }
  });
}

// ── HL → DAMBI_DATA.HL ───────────────────────────────────────────────────────
function levForFactory(hl: HlAccount): (assetIndex: number) => string {
  const map = new Map<number, { is_cross: boolean; leverage: number }>();
  (hl.leverage_settings ?? []).forEach((s) => map.set(s.asset_index, { is_cross: s.is_cross, leverage: s.leverage }));
  return (assetIndex: number) => {
    const s = map.get(assetIndex);
    if (!s) return "";
    return s.leverage + "x " + T("assets.hl." + (s.is_cross ? "cross" : "isolated"));
  };
}

function hlAccountView(walletAddr: string, walletLabel: string, hl: HlAccount): DambiHlAccount {
  const levFor = levForFactory(hl);
  const positions: DambiHlPos[] = (hl.positions ?? []).map((p) => {
    const size = num(p.size);
    const entry = num(p.entry_price);
    return {
      sym: p.symbol ?? "#" + p.asset_index,
      side: p.is_long ? "long" : "short",
      size,
      entry,
      value: Math.abs(size) * entry,
      leverage: levFor(p.asset_index),
    };
  });
  const orders: DambiHlOrder[] = (hl.open_orders ?? []).map((o) => {
    const trig = o.trigger_price ? num(o.trigger_price) : num(o.price);
    const limit = num(o.price);
    // TP/SL classification: a reduce-only trigger ≈ take-profit, else stop-loss.
    // Without a live mark we fall back to is_trigger-only labeling. Emitted as a
    // SEMANTIC key — assets-app translates + picks the CSS class.
    const kind = o.is_trigger ? (o.reduce_only ? "tp" : "sl") : o.reduce_only ? "liquidation" : "limit";
    const cond =
      T("assets.hl." + (o.is_position_tpsl ? "fullSize" : o.reduce_only ? "reduceOnly" : "new")) +
      " · " +
      (o.tif || "GTC") +
      (o.reduce_only ? " · " + T("assets.hl.reduceOnly") : "");
    return {
      sym: o.symbol ?? "#" + o.asset_index,
      side: o.is_buy ? "buy" : "sell",
      kind,
      trigger: o.trigger_price ? String(trig) : String(limit),
      limit: String(limit),
      cond,
    };
  });
  return {
    wallet: walletAddr,
    walletLabel,
    perpUsd: num(hl.perp_account_value_usd ?? hl.perp_usdc),
    spotUsd: 0, // GAP: spot USD requires mark prices not in the HL snapshot.
    positions,
    orders,
  };
}

// ── main ────────────────────────────────────────────────────────────────────
export function toDambiData(d: AssetsDataLike): DambiData {
  const WLABEL: Record<string, string> = {};
  const WMETA: Record<string, DambiWMeta> = {};
  const APPR: DambiApprRow[] = [];
  const PEND: DambiPendRow[] = [];
  const HL: Record<string, DambiHlAccount> = {};
  const PW: Record<string, DambiAggRow[]> = {};
  const aggPairs: Array<{ walletAddr: string; h: TokenHolding; apIdx?: ApprovalIndex }> = [];

  // The wallet switcher must ALWAYS show every tracked wallet (L1 and L2 alike),
  // so WLABEL/WMETA are built from the full wallet list (summary). Per-holding
  // detail (fail/warn/VaR, PW rows, APPR, PEND, HL) only exists for the wallets
  // currently fetched (targetWallets = all in L1, the selected one in L2), so it
  // is filled from the query arrays and left at summary-derived defaults for the
  // wallets not in view.
  const targets = d.targetWallets;
  const targetIndexByAddr = new Map<string, number>();
  targets.forEach((w, i) => targetIndexByAddr.set(w.address, i));

  d.wallets.forEach((w) => {
    const addr = w.address;
    WLABEL[addr] = w.label ?? shortAddr(addr);

    const ti = targetIndexByAddr.get(addr);
    const inView = ti !== undefined;
    const apIdx = inView ? d.indexes.get(addr) : undefined;
    const holdings = inView ? d.holdingsQs[ti]?.data ?? [] : [];
    const approvals = inView ? d.approvalsQs[ti]?.data : undefined;
    const positions = inView ? d.positionsQs[ti]?.data ?? [] : [];
    const pending = inView ? d.pendingQs[ti]?.data ?? [] : [];

    // WMETA — fail = holdings whose visible risk includes BLOCKED;
    // warn = holdings with any visible risk tag; varUsd = Σ VaR.
    // For wallets not in view, fall back to the summary's unlimited/pending
    // counts so the chip still shows a meaningful status dot.
    let fail = 0;
    let warn = 0;
    let varSum = 0;
    holdings.forEach((h) => {
      const tags = visibleRisk(riskTagsFor(h, apIdx) as string[]);
      if (tags.includes("BLOCKED")) fail++;
      if (tags.length) warn++;
      varSum += varOfHolding(h, apIdx);
    });
    if (!inView && w.unlimited_count > 0) warn = w.unlimited_count;
    WMETA[addr] = {
      label: WLABEL[addr],
      full: addr,
      totalUsd: fmtUsd0(num(w.total_usd)),
      fail,
      warn,
      pending: inView ? pending.length : w.pending_count,
      varUsd: fmtUsd0(varSum),
      unlimited: w.unlimited_count,
    };

    if (!inView) return; // no per-holding detail fetched for off-view wallets

    // PW — this wallet's holdings grouped (no `wallets` field), using its apIdx.
    const myPairs = holdings.map((h) => ({ walletAddr: addr, h, apIdx }));
    PW[addr] = groupHoldings(myPairs, false);

    // accumulate for the cross-wallet AGG
    holdings.forEach((h) => aggPairs.push({ walletAddr: addr, h, apIdx }));

    // APPR
    const decLookup = buildDecLookup(holdings);
    apprRowsFor(addr, approvals, decLookup).forEach((r) => APPR.push(r));

    // PEND
    pendRowsFor(addr, pending).forEach((r) => PEND.push(r));

    // HL (capability-based — any wallet may have an account)
    const hl = hlAccountOf(positions);
    if (hl) HL[addr] = hlAccountView(addr, WLABEL[addr], hl);
  });

  // AGG — cross-wallet grouping over every in-view wallet's holdings.
  const AGG = groupHoldings(aggPairs, true);

  return {
    WLABEL,
    WMETA,
    AGG,
    PW,
    APPR,
    PEND,
    HL,
    // Donut is L1-only (the prototype hides #l1-extra in L2). In L1 it shows the
    // full-portfolio chain/venue distribution from the summary — correct.
    donut: d.donutData,
    sel: d.sel,
  };
}
