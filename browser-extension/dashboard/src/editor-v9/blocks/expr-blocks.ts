/**
 * Expression blocks (Phase A: bool literal only).
 *
 * Each `expr_*` block carries `output: "Expr"` so it plugs into any value slot
 * with `check: "Expr"`. Phase B adds expr_var / expr_lit_long / expr_lit_string /
 * expr_attr / expr_has / expr_binary / expr_unary. Phase C adds the remaining
 * Expr.kind variants (set / record / like / is / if / ext / raw).
 */

export const EXPR_LIT_BOOL_BLOCK_JSON = {
  type: "expr_lit_bool",
  message0: "%1",
  args0: [{ type: "field_dropdown", name: "VALUE", options: [["true", "true"], ["false", "false"]] }],
  output: "Expr",
  colour: 160,
  tooltip: "true / false 리터럴",
} as const;
