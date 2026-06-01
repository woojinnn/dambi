import { RequestType, type ExecutionReportPayload } from "@lib/types";
import { getAccessToken, request } from "./scopeball-auth";

/**
 * Best-effort execution report sink.
 *
 * Reports are authenticated with the same OAuth/JWT token used by `/evaluate`.
 * A signed-out user does not have a server-side namespace, so we skip rather
 * than POST an unauthenticated report that the server will reject.
 */
export async function reportExecutionOutcome(
  report: ExecutionReportPayload,
): Promise<void> {
  const {
    type: _type,
    hostname: _hostname,
    bypassed: _bypassed,
    ...body
  } = report;
  if (_type !== RequestType.EXECUTION_REPORT) return;

  try {
    if (!(await getAccessToken())) return;
    await request("/execution-report", {
      method: "POST",
      body,
    });
  } catch (err) {
    console.warn("[Scopeball] execution report failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
