/**
 * Stub for the Cedar wasm bridge.
 *
 * Original implementation in `apps/web/src/cedar/index.ts` called the
 * `@scopeball/cedar-wasm` package directly. After the dashboard merge,
 * Cedar wasm functionality lives in `crates/policy-engine-wasm` and is
 * loaded by the extension's service worker; the dashboard reaches it
 * via `window.postMessage` through the extension's `dashboard-bridge`
 * content_script that injects into `localhost:5174`.
 *
 * Wiring that SW bridge is a follow-up task. For now, every entry
 * point throws so callers compile and render their UI shells; Cedar
 * evaluation (validate / test / simulate) is simply disabled at
 * runtime until the bridge is in place.
 */

import type { PolicySeverity, Verdict } from "../server-api";

const STUB_MESSAGE = "Cedar wasm bridge not yet wired — see follow-up";

// ── public types (match the old api-client shapes) ──────────────────────

export interface ValidateResp {
  ok: boolean;
  error?: string;
}

export interface CedarRequestInput {
  principal: string;
  action: string;
  resource: string;
  entities?: unknown[];
  context?: Record<string, unknown>;
}

export interface MatchedPolicyDto {
  policy_id: string;
  severity: "deny" | "warn";
  reason?: string;
}

export interface TestPolicyResp {
  verdict: Verdict;
  matched: MatchedPolicyDto[];
}

export interface PolicyInput {
  policy_id: number;
  policy_name: string;
  severity: PolicySeverity;
  cedar_text: string;
}

export interface SequenceStepInput {
  label?: string;
  principal: string;
  action: string;
  resource: string;
  entities?: unknown[];
  context?: Record<string, unknown>;
}

export interface PolicyOutcome {
  policy_id: number;
  policy_name: string;
  severity: PolicySeverity;
  decision: "allow" | "deny";
  matched?: string[];
}

export interface SequenceStepResult {
  label: string | null;
  verdict: Verdict;
  policy_results: PolicyOutcome[];
}

export interface SequenceResp {
  overall: Verdict;
  steps: SequenceStepResult[];
}

// ── stubs ───────────────────────────────────────────────────────────────

/** Idempotent wasm init — stub that always rejects. */
export function ensureCedarReady(): Promise<void> {
  throw new Error(STUB_MESSAGE);
}

/** Replacement for the old `validatePolicy()` api-client wrapper. */
export async function validatePolicyLocal(
  _cedarText: string,
): Promise<ValidateResp> {
  throw new Error(STUB_MESSAGE);
}

/** Replacement for the old `testPolicy(id, req)` api-client wrapper. */
export async function testPolicyLocal(
  _cedarText: string,
  _request: CedarRequestInput,
): Promise<TestPolicyResp> {
  throw new Error(STUB_MESSAGE);
}

/** Replacement for the old `simulateSequence(steps, policyIds)`. */
export async function simulateSequenceLocal(
  _steps: SequenceStepInput[],
  _policies: PolicyInput[],
): Promise<SequenceResp> {
  throw new Error(STUB_MESSAGE);
}
