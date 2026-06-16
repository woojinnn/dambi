/**
 * useAssetsData — the shared data layer for the Assets views.
 *
 * Both MonitoringPage (current Assets) and Assets2Page (ASS_v2 design) render
 * the SAME live portfolio data with different layouts. This hook owns all of
 * it — wallet selection (URL-synced), the react-query fan-out (summary +
 * per-wallet holdings/approvals/positions/pending), the L2 verdicts query,
 * wallet sync, and the derived memos (approval index, aggregate, donut data,
 * fail-row count) — so neither page duplicates the join/parse logic.
 *
 * Page-local UI state (lens, holdings filter, banner dismissal, add-wallet
 * modal) deliberately stays in each page; it's view chrome, not shared data.
 *
 * Query keys are kept identical to the originals (`["holdings", addr]`, …) so
 * the two pages share react-query cache — switching between them shows data
 * instantly instead of refetching.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  getDashboardSummary,
  getWalletApprovalsWithRisk,
  getWalletHoldings,
  getWalletPending,
  getWalletPositions,
  listAuditVerdicts,
  ServerError,
  syncWallet,
} from "../../server-api";
import { buildApprovalIndexes, riskTagsFor } from "./risk";
import { aggregate, buildDonutData } from "./data";

export function useAssetsData() {
  const [params, setParams] = useSearchParams();
  const [sel, setSel] = useState<"all" | string>(() => params.get("wallet") ?? "all");

  const summaryQ = useQuery({ queryKey: ["dashboard", "summary"], queryFn: getDashboardSummary });
  const wallets = summaryQ.data?.wallets ?? [];

  useEffect(() => {
    const want = params.get("wallet");
    if (want && want !== sel) setSel(want);
    if (!want && sel !== "all") setSel("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const setSelectionAndUrl = (next: "all" | string) => {
    setSel(next);
    const p = new URLSearchParams(params);
    if (next === "all") p.delete("wallet");
    else p.set("wallet", next);
    setParams(p, { replace: true });
  };

  const targetWallets = useMemo(() => {
    if (sel === "all") return wallets;
    return wallets.filter((w) => w.address === sel);
  }, [sel, wallets]);

  const holdingsQs = useQueries({
    queries: targetWallets.map((w) => ({
      queryKey: ["holdings", w.address],
      queryFn: () => getWalletHoldings(w.address),
      enabled: summaryQ.isSuccess,
    })),
  });
  const approvalsQs = useQueries({
    queries: targetWallets.map((w) => ({
      queryKey: ["approvals", w.address, "with_risk"],
      queryFn: () => getWalletApprovalsWithRisk(w.address),
      enabled: summaryQ.isSuccess,
    })),
  });
  const positionsQs = useQueries({
    queries: targetWallets.map((w) => ({
      queryKey: ["positions", w.address],
      queryFn: () => getWalletPositions(w.address),
      enabled: summaryQ.isSuccess,
      // Re-read the server's stored state every 30s so HL positions/orders
      // reflect backend syncs without a manual refresh. (Fresh HL data still
      // requires a backend sync — `POST /sync` or the sync_worker tick.)
      refetchInterval: 30_000,
    })),
  });
  const pendingQs = useQueries({
    queries: targetWallets.map((w) => ({
      queryKey: ["pending", w.address],
      queryFn: () => getWalletPending(w.address),
      enabled: summaryQ.isSuccess,
      refetchInterval: 30_000,
    })),
  });

  // Wallet sync — re-pull on-chain state for the wallet(s) currently in view
  // (all wallets in L1, the selected one in L2), then refresh every asset query
  // so the tables reflect the new state. Replaces the old Home's sync button.
  const qc = useQueryClient();
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const syncMut = useMutation({
    // Sequential, NOT Promise.all: the server holds a per-USER sync lock, so
    // concurrent /sync calls 409 ("sync already running for this user"). The
    // handler blocks until each wallet's refresh finishes, so awaiting in turn
    // means the data is fresh by the time we invalidate.
    mutationFn: async (addrs: string[]) => {
      for (const a of addrs) await syncWallet(a);
    },
    onMutate: () => setSyncErr(null),
    onError: (e) => {
      // ServerError carries the real reason in `.body` (the handler's
      // `internal(reason)` text); `.message` is just "500 …". Prefer the body.
      const reason =
        e instanceof ServerError && typeof e.body === "string" && e.body
          ? e.body
          : e instanceof Error
            ? e.message
            : "동기화에 실패했어요";
      setSyncErr(reason);
    },
    onSuccess: (_v, addrs) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      for (const a of addrs) {
        qc.invalidateQueries({ queryKey: ["holdings", a] });
        qc.invalidateQueries({ queryKey: ["approvals", a] });
        qc.invalidateQueries({ queryKey: ["positions", a] });
        qc.invalidateQueries({ queryKey: ["pending", a] });
      }
      qc.invalidateQueries({ queryKey: ["wallet-findings"] });
      setSyncedAt(Date.now());
    },
  });

  // Per-wallet recent verdicts — only fetched in L2 mode (single wallet).
  const findingsQ = useQuery({
    queryKey: ["wallet-findings", sel],
    queryFn: () => listAuditVerdicts({ wallet: sel, range: "24h", limit: 50 }),
    enabled: sel !== "all",
  });

  // Per-wallet approval+holding index — used for risk overlay + VaR.
  const indexes = useMemo(() => buildApprovalIndexes(targetWallets, approvalsQs.map((q) => q.data)), [
    targetWallets,
    approvalsQs,
  ]);

  const aggregateSummary = useMemo(() => aggregate(targetWallets), [targetWallets]);

  // Donut data (L1 only) — 지갑별 자산 비율 + 자산 분포 + 상호 연관(인접).
  // Both donuts + their cross-link adjacency derive from the same source as the
  // tables: wallet totals from `summary.wallets`, asset distribution from
  // chain/venue breakdown, and "which wallet holds which chain/venue" from the
  // per-wallet holdings (HL venue inferred from positions).
  const donutData = useMemo(
    () => buildDonutData(wallets, summaryQ.data, holdingsQs.map((q) => q.data), positionsQs.map((q) => q.data)),
    [wallets, summaryQ.data, holdingsQs, positionsQs],
  );

  // FAIL signal across the current view — used by the risk suggest banner.
  const totalFailRows = useMemo(() => {
    let n = 0;
    targetWallets.forEach((w, i) => {
      const apIdx = indexes.get(w.address);
      const holdings = holdingsQs[i]?.data ?? [];
      holdings.forEach((h) => {
        const risk = riskTagsFor(h, apIdx);
        if (risk.includes("BLOCKED")) n++;
      });
    });
    return n;
  }, [targetWallets, holdingsQs, indexes]);

  const isL2 = sel !== "all";
  const selectedWallet = isL2 ? wallets.find((w) => w.address === sel) ?? null : null;

  return {
    sel,
    setSelectionAndUrl,
    isL2,
    wallets,
    selectedWallet,
    targetWallets,
    summaryQ,
    holdingsQs,
    approvalsQs,
    positionsQs,
    pendingQs,
    findingsQ,
    indexes,
    aggregateSummary,
    donutData,
    totalFailRows,
    syncMut,
    syncedAt,
    syncErr,
  };
}
