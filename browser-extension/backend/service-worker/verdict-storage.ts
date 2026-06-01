/**
 * `verdict-storage` — chrome.storage.local backing for the Cedar policy
 * verdict log that the dashboard's Audit / History / Findings pages
 * consume.
 *
 * Replaces the previous server-mediated DB schema (`verdicts` table +
 * `POST /verdicts` + `GET /audit/*` + `GET /history/verdicts` +
 * `GET /findings/feed`). Decision: this is per-user, per-device,
 * sensitive (reveals which dApps the user visits), and high-write —
 * device-local storage is the right home.
 *
 * Shape
 * - One row per Cedar evaluation result. Append at the end of
 *   `decideMessage` in orchestrator.ts.
 * - Each row carries `id` (UUID string — replaces the old i64 PK),
 *   `ts`, `verdict`, `severity`, optional decoded fn / dApp / contract /
 *   policy reference, and the user's resolution if a `warn` row was
 *   trusted or cancelled later.
 *
 * Storage
 * - Stored at `verdicts:log` as a newest-first JS array.
 * - Bounded to `MAX_ROWS` (default 1000) to keep chrome.storage.local
 *   inside the 10 MB quota even with bursty dApp activity.
 * - Trim happens at every append; old rows fall off the tail.
 *
 * Concurrency
 * - The SW is single-threaded; the read-mutate-write pattern below is
 *   safe as long as the whole operation is awaited before the next
 *   `appendVerdict` runs. We do not serialize across multiple SW
 *   instances (MV3 SW always single-instance).
 */

import Browser from "webextension-polyfill";

// ─── Mirror types ──────────────────────────────────────────────────────
//
// Kept in sync with `browser-extension/dashboard/src/server-api/types.ts`.
// Re-declared here (not imported) because the extension backend doesn't
// have a path-mapped alias into the dashboard package, and the shapes
// are tiny — duplication is cheaper than a cross-package types module.

export type Verdict = "pass" | "warn" | "fail";
export type PolicySeverity = "deny" | "warn" | "info";

export interface ContractRef {
  addr: string;
  symbol?: string | null;
}

export interface SelectorRef {
  sig: string;
  decoded?: string | null;
}

export interface PolicyRef {
  id: number;
  name?: string | null;
}

const STORAGE_KEY = "verdicts:log";

/** Hard cap on rows kept in `chrome.storage.local`. Past this, the
 *  oldest entries fall off. */
export const MAX_ROWS = 1000;

/** One verdict row as stored locally. Mirrors the server-side
 *  `VerdictDto` shape (kept the same field names so the dashboard's
 *  React Query hooks don't need to translate) but the `id` is a UUID
 *  string instead of the DB autoincrement. */
export interface VerdictRow {
  /** Stable id assigned at append time (`crypto.randomUUID`). */
  id: string;
  /** Unix seconds. */
  ts: number;
  /** Lowercase 0x address; null when the verdict isn't tied to a
   *  specific wallet (e.g. off-chain sig without a domain). */
  wallet: string | null;
  /** Severity of the matched policy at evaluation time. */
  severity: PolicySeverity;
  /** Runtime outcome of the policy evaluation. */
  verdict: Verdict;
  /** RPC method on the wallet side, e.g. `eth_sendTransaction`. */
  method?: string | null;
  /** Decoded function name, e.g. `swapExactTokensForTokens`. */
  decoded_fn?: string | null;
  /** dApp origin that fired the request, e.g. `app.uniswap.org`. */
  dapp_origin?: string | null;
  /** Contract being interacted with (address + optional symbol). */
  contract?: ContractRef;
  /** 4-byte selector + decoded label. */
  selector?: SelectorRef;
  /** Matched policy id + display name. */
  policy?: PolicyRef;
  /** Reason copy (ko + en). The dashboard picks one based on locale. */
  reason: { ko?: string | null; en?: string | null };
  /** Set when the user resolved a `warn` row from the dashboard. */
  user_decision: "trusted" | "cancelled" | null;
  /** Unix seconds when `user_decision` was set. */
  decided_at: number | null;
  /** Optional link to the originating state_delta on the server (kept
   *  as number for compatibility with the existing server-side state
   *  tracking; null when the verdict didn't land in `state_deltas`). */
  delta_id: number | null;
}

/** Input shape for `appendVerdict` — same as `VerdictRow` minus the
 *  fields the storage layer assigns (`id`, `user_decision`, `decided_at`). */
export type VerdictInsert = Omit<VerdictRow, "id" | "user_decision" | "decided_at">;

// ─── reads ────────────────────────────────────────────────────────────

/** Return the full log (newest-first). Empty array when storage is
 *  blank or corrupted. */
export async function listAllVerdicts(): Promise<VerdictRow[]> {
  const r = await Browser.storage.local.get(STORAGE_KEY);
  const raw = r[STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw as VerdictRow[];
}

/** Filter shape mirroring the server's `VerdictListOpts`. */
export interface VerdictFilter {
  /** "1h" | "6h" | "24h" | "7d" — alias for `since = now - delta`. */
  range?: "1h" | "6h" | "24h" | "7d";
  /** Unix seconds. Rows with `ts < since` are excluded. */
  since?: number;
  /** Unix seconds. Rows with `ts > until` are excluded. */
  until?: number;
  /** Match on `verdict` field. */
  verdict?: Verdict;
  /** Substring match on `dapp_origin`. */
  origin?: string;
  /** Match on `policy.id`. */
  policy_id?: number;
  /** Max rows after filtering. */
  limit?: number;
  /** Cursor — rows with `ts >= before` are excluded (history pagination). */
  before?: number;
}

/** Apply the server-style filter in JS. Pure; safe to call repeatedly. */
export function applyFilter(rows: VerdictRow[], opts?: VerdictFilter): VerdictRow[] {
  if (!opts) return rows;
  const now = Math.floor(Date.now() / 1000);
  const since =
    opts.since ??
    (opts.range
      ? now -
        ({ "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800 }[opts.range] ?? 0)
      : undefined);
  const until = opts.until ?? undefined;
  const before = opts.before ?? undefined;
  const originNeedle = opts.origin?.toLowerCase();

  let out = rows;
  if (since !== undefined) out = out.filter((r) => r.ts >= since);
  if (until !== undefined) out = out.filter((r) => r.ts <= until);
  if (before !== undefined) out = out.filter((r) => r.ts < before);
  if (opts.verdict) out = out.filter((r) => r.verdict === opts.verdict);
  if (originNeedle)
    out = out.filter((r) => (r.dapp_origin ?? "").toLowerCase().includes(originNeedle));
  if (opts.policy_id !== undefined)
    out = out.filter((r) => r.policy?.id === opts.policy_id);
  if (opts.limit !== undefined) out = out.slice(0, opts.limit);
  return out;
}

/** Filtered list. */
export async function listVerdicts(opts?: VerdictFilter): Promise<VerdictRow[]> {
  return applyFilter(await listAllVerdicts(), opts);
}

export interface VerdictCounts {
  pass: number;
  warn: number;
  fail: number;
}

/** Pass/warn/fail tally under the same filter as `listVerdicts`. */
export async function countVerdicts(opts?: VerdictFilter): Promise<VerdictCounts> {
  const rows = await listVerdicts(opts);
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const r of rows) {
    if (r.verdict === "pass") pass++;
    else if (r.verdict === "warn") warn++;
    else if (r.verdict === "fail") fail++;
  }
  return { pass, warn, fail };
}

// ─── writes ───────────────────────────────────────────────────────────

/** Append a row. Returns the newly inserted row (with assigned id). */
export async function appendVerdict(insert: VerdictInsert): Promise<VerdictRow> {
  const row: VerdictRow = {
    ...insert,
    id: crypto.randomUUID(),
    user_decision: null,
    decided_at: null,
  };
  const existing = await listAllVerdicts();
  existing.unshift(row);
  if (existing.length > MAX_ROWS) existing.length = MAX_ROWS;
  await Browser.storage.local.set({ [STORAGE_KEY]: existing });
  return row;
}

/** Set a row's `user_decision` + `decided_at`. Returns `false` when
 *  the id isn't in the log (race vs trim). */
export async function setVerdictDecision(
  id: string,
  decision: "trusted" | "cancelled",
): Promise<boolean> {
  const list = await listAllVerdicts();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  list[idx] = {
    ...list[idx],
    user_decision: decision,
    decided_at: Math.floor(Date.now() / 1000),
  };
  await Browser.storage.local.set({ [STORAGE_KEY]: list });
  return true;
}

/** Wipe the whole log (dashboard "Clear audit" button, mainly). */
export async function clearVerdicts(): Promise<void> {
  await Browser.storage.local.remove(STORAGE_KEY);
}

// ─── CSV export ───────────────────────────────────────────────────────

/** Materialise a filtered slice as CSV text. The dashboard wraps this
 *  in a `Blob` + `URL.createObjectURL` and offers a download. */
export async function exportVerdictsAsCsv(opts?: VerdictFilter): Promise<string> {
  const rows = await listVerdicts(opts);
  const header = [
    "id",
    "ts",
    "wallet",
    "severity",
    "verdict",
    "method",
    "decoded_fn",
    "dapp_origin",
    "contract_addr",
    "contract_symbol",
    "selector_sig",
    "selector_decoded",
    "policy_id",
    "policy_name",
    "reason_ko",
    "reason_en",
    "user_decision",
    "decided_at",
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.ts,
        r.wallet,
        r.severity,
        r.verdict,
        r.method,
        r.decoded_fn,
        r.dapp_origin,
        r.contract?.addr,
        r.contract?.symbol,
        r.selector?.sig,
        r.selector?.decoded,
        r.policy?.id,
        r.policy?.name,
        r.reason.ko,
        r.reason.en,
        r.user_decision,
        r.decided_at,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}
