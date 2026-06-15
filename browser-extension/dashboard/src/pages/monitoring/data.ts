/**
 * Shared data-layer helpers for the Assets views (MonitoringPage + Assets2Page).
 *
 * Pure transforms over the server DTOs — chain/venue/wallet naming + colors,
 * TokenHolding key extraction, portfolio aggregation, donut data, and the
 * alert-strip summary. Moved out of MonitoringPage verbatim so both the
 * existing Assets page and the new ASS_v2-design Assets2 page derive numbers
 * from one source of truth (no duplicated join/parse logic).
 */

import {
  hlAccountOf,
  type ClassifiedApprovals,
  type DashboardSummary,
  type DashboardWalletSummary,
  type Position,
  type TokenHolding,
} from "../../server-api";
/** Donut legend/segment item — derived from live data by buildDonutData.
 *  (Self-contained here; the ASS_v2 donut script consumes the same shape.) */
export interface DonutItem {
  key: string;
  name: string;
  color: string;
  usd: number;
  pct: number;
  /** When set, the legend shows the chain brand logo instead of a color bar. */
  chainName?: string;
}
import {
  varOfHolding,
  visibleRisk,
  type ApprovalIndex,
} from "./risk";

// ── Chain / venue naming + colors ───────────────────────────────────────

export const CHAIN_COLORS: Record<string, string> = {
  "eip155:1": "#627EEA",
  "eip155:42161": "#2D9BF0",
  "eip155:8453": "#0052FF",
  "eip155:10": "#FF0420",
  "eip155:137": "#8247E5",
  "eip155:56": "#F0B90B",
};
export const CHAIN_NAMES: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:42161": "Arbitrum",
  "eip155:8453": "Base",
  "eip155:10": "Optimism",
  "eip155:137": "Polygon",
  "eip155:56": "BNB",
};
export const VENUE_COLORS: Record<string, string> = {
  hyperliquid: "#0EA5A6",
};
export const VENUE_NAMES: Record<string, string> = {
  hyperliquid: "Hyperliquid",
};
export function chainColor(chain: string): string {
  return CHAIN_COLORS[chain] ?? "#9099A5";
}
export function chainName(chain: string): string {
  return CHAIN_NAMES[chain] ?? chain;
}
export function venueColor(venue: string): string {
  return VENUE_COLORS[venue] ?? "#6366F1";
}
export function venueName(venue: string): string {
  return VENUE_NAMES[venue] ?? venue;
}

// ── Wallet palette (donut 지갑별 자산 비율 segments) ─────────────────────
export const WALLET_COLORS = [
  "#0EA5A6", "#7C9CFF", "#F59E0B", "#EC4899", "#6366F1",
  "#10B981", "#F97316", "#06B6D4", "#A855F7", "#EF4444",
];
export function walletColor(i: number): string {
  return WALLET_COLORS[i % WALLET_COLORS.length];
}

// ── TokenHolding key extraction (opaque `key` → chain/address/standard) ──

export function groupKeyOf(h: TokenHolding): string {
  const k = (h.key ?? {}) as Record<string, unknown>;
  const standard = typeof k.standard === "string" ? k.standard : "unknown";
  const chain = typeof k.chain === "string" ? k.chain : "";
  const address = addressOf(h) ?? "";
  return `${standard}|${chain}|${address || h.symbol || ""}`;
}
export function chainOf(h: TokenHolding): string | null {
  const k = (h.key ?? {}) as Record<string, unknown>;
  return typeof k.chain === "string" ? k.chain : null;
}
export function addressOf(h: TokenHolding): string | null {
  const k = (h.key ?? {}) as Record<string, unknown>;
  const raw =
    typeof k.address === "string"
      ? (k.address as string)
      : typeof k.contract === "string"
        ? (k.contract as string)
        : null;
  return raw ? raw.toLowerCase() : null;
}
export function standardOf(h: TokenHolding): string {
  const k = (h.key ?? {}) as Record<string, unknown>;
  return typeof k.standard === "string" ? k.standard : "unknown";
}

export function kindOfStandard(std: string): "native" | "erc20" | "nft" | "other" {
  if (std === "native") return "native";
  if (std === "erc20") return "erc20";
  if (std === "erc721" || std === "erc1155") return "nft";
  return "other";
}

// ── Short address helper ────────────────────────────────────────────────

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}···${addr.slice(-4)}`;
}

// ── Portfolio aggregation (L1 summary bar) ──────────────────────────────

export interface Aggregate {
  totalUsd: number;
  unlimited: number;
  pending: number;
  walletCount: number;
}

export function aggregate(rows: DashboardWalletSummary[]): Aggregate {
  return rows.reduce(
    (acc, w) => ({
      totalUsd: acc.totalUsd + Number(w.total_usd ?? "0"),
      unlimited: acc.unlimited + w.unlimited_count,
      pending: acc.pending + w.pending_count,
      walletCount: acc.walletCount + 1,
    }),
    { totalUsd: 0, unlimited: 0, pending: 0, walletCount: 0 } as Aggregate,
  );
}

// ── Donut data (L1) ─────────────────────────────────────────────────────

export interface DonutData {
  wallets: { id: "wallets"; title: string; centerLabel: string; total: number; items: DonutItem[] };
  assets: { id: "assets"; title: string; centerLabel: string; total: number; items: DonutItem[] };
  adjacency: {
    walletToAsset: Record<string, string[]>;
    assetToWallet: Record<string, string[]>;
  };
}

/**
 * Build both donuts + their cross-link adjacency from live data.
 *
 *   · 지갑별 자산 비율 → `summary.wallets[*].total_usd` (item key = address).
 *   · 자산 분포       → `chain_breakdown` + `venue_breakdown`
 *                       (item key = `chain:<id>` / `venue:<name>`).
 *   · adjacency       → per-wallet holdings tell us which chains a wallet holds;
 *                       HL venue exposure is inferred from that wallet's
 *                       positions. A wallet with 0-USD holdings on a chain still
 *                       counts as adjacent (the link is "holds something there").
 *
 * `holdings[i]` / `positions[i]` are aligned to `wallets[i]` (the L1 query fan-out
 * uses the same wallet order), so we index by position.
 */
export function buildDonutData(
  wallets: DashboardWalletSummary[],
  summary: DashboardSummary | undefined,
  holdings: Array<TokenHolding[] | undefined>,
  positions: Array<Position[] | undefined>,
): DonutData | null {
  if (!summary) return null;

  const walletTotal = wallets.reduce((s, w) => s + Number(w.total_usd ?? "0"), 0);
  const walletItems: DonutItem[] = wallets
    .map((w, i) => {
      const usd = Number(w.total_usd ?? "0");
      return {
        key: w.address,
        name: w.label ?? shortAddr(w.address),
        color: walletColor(i),
        usd,
        pct: walletTotal > 0 ? (usd / walletTotal) * 100 : 0,
      };
    })
    .filter((it) => it.usd > 0)
    .sort((a, b) => b.usd - a.usd);

  const assetTotal =
    summary.chain_breakdown.reduce((s, c) => s + Number(c.usd), 0) +
    summary.venue_breakdown.reduce((s, v) => s + Number(v.usd), 0);
  const assetItems: DonutItem[] = [
    ...summary.chain_breakdown.map((c) => ({
      key: `chain:${c.chain}`,
      name: chainName(c.chain),
      color: chainColor(c.chain),
      usd: Number(c.usd),
      pct: c.pct,
      chainName: chainName(c.chain),
    })),
    ...summary.venue_breakdown.map((v) => ({
      key: `venue:${v.venue}`,
      name: venueName(v.venue),
      color: venueColor(v.venue),
      usd: Number(v.usd),
      pct: v.pct,
      chainName: venueName(v.venue),
    })),
  ]
    .filter((it) => it.usd > 0)
    .sort((a, b) => b.usd - a.usd);

  // Adjacency from holdings (+ HL positions for the venue side).
  const walletToAsset: Record<string, string[]> = {};
  const assetToWallet: Record<string, string[]> = {};
  const link = (walletKey: string, assetKey: string) => {
    (walletToAsset[walletKey] ??= []).includes(assetKey) || walletToAsset[walletKey].push(assetKey);
    (assetToWallet[assetKey] ??= []).includes(walletKey) || assetToWallet[assetKey].push(walletKey);
  };
  wallets.forEach((w, i) => {
    (holdings[i] ?? []).forEach((h) => {
      const chain = chainOf(h);
      if (chain) link(w.address, `chain:${chain}`);
    });
    if (hlAccountOf(positions[i] ?? [])) link(w.address, "venue:hyperliquid");
  });

  return {
    wallets: { id: "wallets", title: "지갑별 자산 비율", centerLabel: "합산 자산", total: walletTotal, items: walletItems },
    assets: { id: "assets", title: "자산 분포", centerLabel: "총 자산", total: assetTotal, items: assetItems },
    adjacency: { walletToAsset, assetToWallet },
  };
}

// ── Alert-strip summary (ASS_v2 buildSummary, live-data version) ─────────

export interface AssetsSummary {
  blocked: number;
  unlimited: number;
  old: number;
  pending: number;
  exposureUsd: number;
  holdingsUsd: number;
  holdingsTokenCount: number;
  apprCount: number;
  hlAvailable: boolean;
}

/**
 * Aggregate the current view (L1 = all wallets, L2 = selected) into the
 * counts the ASS_v2 alert strip + jump-nav badges need. Mirrors the prototype's
 * `buildSummary()` but reads live server data:
 *   · approval risk counts go through `visibleRisk` (so BLOCKED is gated by
 *     REPUTATION_CONNECTED, exactly like the Assets tables),
 *   · exposure is the real per-holding VaR sum (not a demo `varNum`),
 *   · pending uses the actual pending-row count (matches the Pending table),
 *   · HL availability is derived from live positions (`hlAccountOf`).
 */
export function buildAssetsSummary(
  targetWallets: DashboardWalletSummary[],
  holdings: Array<TokenHolding[] | undefined>,
  approvals: Array<ClassifiedApprovals | undefined>,
  positions: Array<Position[] | undefined>,
  pending: Array<unknown[] | undefined>,
  indexes: Map<string, ApprovalIndex>,
): AssetsSummary {
  let blocked = 0;
  let unlimited = 0;
  let old = 0;
  let apprCount = 0;
  let exposureUsd = 0;
  let pendingCount = 0;
  let holdingsTokenCount = 0;
  let hlAvailable = false;

  targetWallets.forEach((w, i) => {
    const apIdx = indexes.get(w.address);
    const hs = holdings[i] ?? [];
    holdingsTokenCount += hs.length;
    hs.forEach((h) => {
      exposureUsd += varOfHolding(h, apIdx);
    });

    const ap = approvals[i];
    if (ap) {
      const all = [...ap.erc20, ...ap.permit2, ...ap.set_for_all];
      apprCount += all.length;
      all.forEach((a) => {
        const vis = visibleRisk(a.risk as string[]);
        if (vis.includes("BLOCKED")) blocked++;
        if (vis.includes("UNLIMITED")) unlimited++;
        if (vis.includes("OLD")) old++;
      });
    }

    pendingCount += (pending[i] ?? []).length;
    if (hlAccountOf(positions[i] ?? [])) hlAvailable = true;
  });

  const holdingsUsd = targetWallets.reduce((s, w) => s + Number(w.total_usd ?? "0"), 0);

  return { blocked, unlimited, old, pending: pendingCount, exposureUsd, holdingsUsd, holdingsTokenCount, apprCount, hlAvailable };
}
