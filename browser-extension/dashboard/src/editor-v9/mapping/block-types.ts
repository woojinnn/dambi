/**
 * Single source of truth for Blockly block type ↔ PolicyIR node mapping.
 *
 * Two registries are derived from this file:
 *   1. `blocks/register.ts` iterates EXPR_BLOCK_DEFS and POLICY_BLOCK_DEFS to
 *      register Blockly block JSON.
 *   2. `mapping/workspaceToIR.ts` and `mapping/irToWorkspace.ts` switch on the
 *      same ids to convert between Blockly Workspace and PolicyIR.
 *
 * Phase A only declares the skeleton set (policy_hat, scope_all, action_scope_all,
 * cond_when, expr_lit_bool). Later phases extend EXPR_BLOCK_DEFS.
 *
 * Adding a new Expr.kind: append here, add a block JSON in blocks/, and add
 * round-trip arms in workspaceToIR.ts / irToWorkspace.ts. coverage.test.ts
 * fails if any of the three is missing.
 */

import type { Expr } from "../../cedar/blocks";

/** Blockly value-input connector check kinds. Used to gate which blocks can plug
 *  into which slots. */
export type ConnectorCheck = "Expr" | "Scope" | "ActionScope" | "Cond";

/** Block type ids — short kebab-snake mix to play nice with Blockly DOM ids. */
export const BLOCK_TYPES = {
  // ── policy / scope / condition (structural) ──
  policy_hat: "policy_hat",
  scope_all: "scope_all",
  action_scope_all: "action_scope_all",
  cond_when: "cond_when",
  // ── expressions (Phase A: bool literal only; extended in later phases) ──
  expr_lit_bool: "expr_lit_bool",
} as const;

export type BlockTypeId = (typeof BLOCK_TYPES)[keyof typeof BLOCK_TYPES];

/** Which Expr.kind a given expression block produces. Structural blocks
 *  (policy_hat, scope_*, cond_*) are NOT here — they don't map to `Expr`. */
export const EXPR_BLOCK_TO_KIND: Partial<Record<BlockTypeId, Expr["kind"]>> = {
  [BLOCK_TYPES.expr_lit_bool]: "lit",
};

/** Reverse — given a (kind, discriminator), pick the block type. For `lit`
 *  the discriminator is `litType`. Filled out as Phase B/C land. */
export function blockTypeForExpr(e: Expr): BlockTypeId | null {
  switch (e.kind) {
    case "lit":
      if (e.litType === "bool") return BLOCK_TYPES.expr_lit_bool;
      return null;
    default:
      return null;
  }
}
