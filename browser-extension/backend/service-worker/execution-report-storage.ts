/**
 * `execution-report-storage` — chrome.storage.local backing for the
 * post-policy lifecycle log.
 *
 * Replaces the previous server-mediated `POST /execution-report` +
 * `execution_reports` DB table. Same rationale as `verdict-storage`:
 * the data is per-user / per-device, reveals dApp activity, and isn't
 * useful cross-device — local storage is the right home.
 *
 * The SW writes here after the wallet rejects / signs / submits a
 * transaction (or after a venue accepts / fills / rejects an
 * order). Dashboard summary widgets read aggregate counts (e.g.
 * "today's signed txs") via the SW message bus.
 *
 * Storage
 * - Stored at `execution-reports:log` as a newest-first array.
 * - Bounded to `MAX_ROWS` (default 500). Execution reports are written
 *   less frequently than verdicts but each row is heavier.
 */

import Browser from "webextension-polyfill";

import type { ExecutionReportPayload } from "@lib/types";

const STORAGE_KEY = "execution-reports:log";

/** Hard cap on rows kept in storage. */
export const MAX_ROWS = 500;

/** One execution report as stored locally. We persist the full payload
 *  shape extension-side fires (`ExecutionReportPayload`) plus a stable
 *  id and ingest timestamp. */
export interface ExecutionReportRow extends ExecutionReportPayload {
  /** Stable id assigned at append time. */
  id: string;
  /** Unix seconds when the SW appended this row. */
  ts: number;
}

export type ExecutionReportInsert = ExecutionReportPayload;

// ─── reads ────────────────────────────────────────────────────────────

export async function listAllExecutionReports(): Promise<ExecutionReportRow[]> {
  const r = await Browser.storage.local.get(STORAGE_KEY);
  const raw = r[STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw as ExecutionReportRow[];
}

export interface ExecutionReportFilter {
  /** Wallet address (lowercase 0x) — exact match. */
  wallet?: string;
  /** Substring match on `hostname`. */
  hostname?: string;
  /** Earliest unix-seconds timestamp to keep. */
  since?: number;
  /** Latest unix-seconds timestamp to keep. */
  until?: number;
  /** Cap rows after filter. */
  limit?: number;
}

export function applyFilter(
  rows: ExecutionReportRow[],
  opts?: ExecutionReportFilter,
): ExecutionReportRow[] {
  if (!opts) return rows;
  const hostNeedle = opts.hostname?.toLowerCase();
  let out = rows;
  if (opts.wallet)
    out = out.filter((r) => {
      const w = (r.wallet_id as { address?: string } | undefined)?.address;
      return w?.toLowerCase() === opts.wallet?.toLowerCase();
    });
  if (hostNeedle)
    out = out.filter((r) => (r.hostname ?? "").toLowerCase().includes(hostNeedle));
  if (opts.since !== undefined) out = out.filter((r) => r.ts >= opts.since!);
  if (opts.until !== undefined) out = out.filter((r) => r.ts <= opts.until!);
  if (opts.limit !== undefined) out = out.slice(0, opts.limit);
  return out;
}

export async function listExecutionReports(
  opts?: ExecutionReportFilter,
): Promise<ExecutionReportRow[]> {
  return applyFilter(await listAllExecutionReports(), opts);
}

/** Aggregate counts by `outcome.kind` — the dashboard summary card
 *  uses this for "Today: 3 signed, 1 rejected" style display. */
export interface ExecutionReportCounts {
  total: number;
  byKind: Record<string, number>;
}

export async function countExecutionReports(
  opts?: ExecutionReportFilter,
): Promise<ExecutionReportCounts> {
  const rows = await listExecutionReports(opts);
  const byKind: Record<string, number> = {};
  for (const r of rows) {
    const kind = (r.outcome as { kind?: string } | undefined)?.kind ?? "unknown";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return { total: rows.length, byKind };
}

// ─── writes ───────────────────────────────────────────────────────────

export async function appendExecutionReport(
  insert: ExecutionReportInsert,
): Promise<ExecutionReportRow> {
  const row: ExecutionReportRow = {
    ...insert,
    id: crypto.randomUUID(),
    ts: Math.floor(Date.now() / 1000),
  };
  const existing = await listAllExecutionReports();
  existing.unshift(row);
  if (existing.length > MAX_ROWS) existing.length = MAX_ROWS;
  await Browser.storage.local.set({ [STORAGE_KEY]: existing });
  return row;
}

export async function clearExecutionReports(): Promise<void> {
  await Browser.storage.local.remove(STORAGE_KEY);
}
