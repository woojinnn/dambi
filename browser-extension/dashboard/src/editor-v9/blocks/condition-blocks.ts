/**
 * Condition wrappers for `policy_hat`'s CONDITIONS statement list.
 *
 * Phase A: `cond_when` only. Phase B adds `cond_unless` (same shape, different
 * id + colour). Multiple `cond_*` blocks stack vertically and are ANDed by Cedar
 * semantics.
 */

export const COND_WHEN_BLOCK_JSON = {
  type: "cond_when",
  message0: "when %1",
  args0: [{ type: "input_value", name: "BODY", check: "Expr" }],
  previousStatement: "Cond",
  nextStatement: "Cond",
  colour: 290,
  tooltip: "조건 (when) — 안의 식이 true일 때 정책 적용",
} as const;
