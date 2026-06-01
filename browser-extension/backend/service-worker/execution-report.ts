import { RequestType, type ExecutionReportPayload } from "@lib/types";

import { appendExecutionReport } from "./execution-report-storage";

/**
 * Best-effort execution report sink.
 *
 * Replaces the old `POST /execution-report` HTTP call to the simulation
 * server. Reports are now written into `chrome.storage.local` so the
 * dashboard can read them through the SW message bus (no server round-trip,
 * no JWT, no CORS).
 *
 * Skipped silently for non-execution-report message types — keeps the
 * existing call-site contract (the message dispatcher in `index.ts`
 * forwards every message here and we just no-op on the unrelated ones).
 *
 * Storage writes are best-effort: a quota error or chrome.storage flake
 * must NOT throw out of this function (the caller's reply path is already
 * done with the wallet, and there's no UI affordance for a "we couldn't
 * record this" warning). Errors are logged so they surface in DevTools.
 */
export async function reportExecutionOutcome(
  report: ExecutionReportPayload,
): Promise<void> {
  if (report.type !== RequestType.EXECUTION_REPORT) return;

  try {
    await appendExecutionReport(report);
  } catch (err) {
    console.warn("[Scopeball] execution report storage failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
