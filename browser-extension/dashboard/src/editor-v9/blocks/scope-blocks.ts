/**
 * Scope head blocks plug into `policy_hat`'s PRINCIPAL/RESOURCE/ACTION slots.
 *
 * Phase A:
 *   - `scope_all`        → `{ kind: "scopeAll" }`. The bare `principal` / `resource`
 *                          form. One block reused for both PRINCIPAL and RESOURCE
 *                          slots (both `check: "Scope"`).
 *   - `action_scope_all` → ActionScope variant; same shape, different check
 *                          (`check: "ActionScope"`).
 *
 * Later phases add scope_eq / scope_in / scope_is / scope_slot (PRINCIPAL/RESOURCE)
 * and action_scope_eq / action_scope_in (ACTION).
 */

export const SCOPE_BLOCK_JSON = {
  type: "scope_all",
  message0: "any",
  output: "Scope",
  colour: 200,
  tooltip: "제약 없음 (어떤 principal / resource 든)",
} as const;

export const ACTION_SCOPE_BLOCK_JSON = {
  type: "action_scope_all",
  message0: "any action",
  output: "ActionScope",
  colour: 200,
  tooltip: "제약 없음 (어떤 action 이든)",
} as const;
