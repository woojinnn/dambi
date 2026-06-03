/**
 * Blockly toolbox builder — categories of draggable blocks.
 *
 * Returns the JSON shape Blockly expects (`Blockly.utils.toolbox.ToolboxDefinition`).
 * Locale-aware (ko/en) for category labels.
 *
 * Phase A categories: 정책 (policy_hat), 범위 (scope_all / action_scope_all),
 * 조건 (cond_when), 식 (expr_lit_bool). Phase B+ wires more blocks into the
 * 식 category and adds a 파라미터 category for hole blocks.
 */

import { BLOCK_TYPES } from "../mapping/block-types";

const STRINGS = {
  ko: {
    policy: "정책",
    scope: "범위",
    cond: "조건",
    expr: "식",
  },
  en: {
    policy: "Policy",
    scope: "Scope",
    cond: "Condition",
    expr: "Expression",
  },
} as const;

export function buildToolbox(locale: "ko" | "en" = "ko"): object {
  const s = STRINGS[locale];
  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: s.policy,
        colour: "230",
        contents: [{ kind: "block", type: BLOCK_TYPES.policy_hat }],
      },
      {
        kind: "category",
        name: s.scope,
        colour: "200",
        contents: [
          { kind: "block", type: BLOCK_TYPES.scope_all },
          { kind: "block", type: BLOCK_TYPES.action_scope_all },
        ],
      },
      {
        kind: "category",
        name: s.cond,
        colour: "290",
        contents: [{ kind: "block", type: BLOCK_TYPES.cond_when }],
      },
      {
        kind: "category",
        name: s.expr,
        colour: "160",
        contents: [{ kind: "block", type: BLOCK_TYPES.expr_lit_bool }],
      },
    ],
  };
}
