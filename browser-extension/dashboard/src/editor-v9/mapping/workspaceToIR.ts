/**
 * Blockly Workspace → PolicyIR.
 *
 * Walks all top-level `policy_hat` blocks and produces one PolicyIR each.
 * Empty workspace → empty array (caller decides how to surface; usually
 * "정책이 비어있습니다").
 *
 * Error policy: structural problems (missing required inputs, unmapped block
 * types) DO NOT throw — they push onto the supplied `errors` array. Callers
 * inspect `errors.length` to decide whether to allow save. This mirrors how
 * cedar/blocks' blocksToEst throws only on semantic violations (unfilled
 * holes); we keep structural reporting cooperative so the UI can show a list.
 *
 * Phase A scope: policy_hat / scope_all / action_scope_all / cond_when /
 * expr_lit_bool. Unhandled block types in expression slots produce an
 * `expr_raw` IR node carrying nothing (acts as a placeholder; will be replaced
 * by real `raw` in Phase C when EST escape hatch lands).
 */

import * as Blockly from "blockly";
import type {
  ActionScope,
  Condition,
  Effect,
  Expr,
  PolicyIR,
  Scope,
} from "../../cedar/blocks";
import { BLOCK_TYPES } from "./block-types";
import type { EditorError } from "../errors";

export function workspaceToIR(
  ws: Blockly.Workspace,
  errors: EditorError[],
): PolicyIR[] {
  const policies: PolicyIR[] = [];
  for (const block of ws.getTopBlocks(true)) {
    if (block.type !== BLOCK_TYPES.policy_hat) {
      // Unknown top-level block — record and skip (e.g. user dropped an
      // orphan expression block in the workspace background).
      errors.push({
        kind: "structural",
        message: `최상위에 정책(policy_hat) 블록이 아닌 "${block.type}"이 있습니다`,
        blockId: block.id,
      });
      continue;
    }
    const ir = policyHatToIR(block, errors);
    if (ir) policies.push(ir);
  }
  return policies;
}

function policyHatToIR(
  block: Blockly.Block,
  errors: EditorError[],
): PolicyIR | null {
  const effect = (block.getFieldValue("EFFECT") ?? "permit") as Effect;
  const principal = readScope(block, "PRINCIPAL", errors);
  const action = readActionScope(block, "ACTION", errors);
  const resource = readScope(block, "RESOURCE", errors);
  const conditions = readConditionStatements(block, "CONDITIONS", errors);

  return {
    kind: "policy",
    effect,
    annotations: [],
    scope: { principal, action, resource },
    conditions,
  };
}

function readScope(parent: Blockly.Block, inputName: string, errors: EditorError[]): Scope {
  const child = parent.getInputTargetBlock(inputName);
  if (!child) {
    errors.push({
      kind: "structural",
      message: `${inputName} 슬롯이 비어있습니다`,
      blockId: parent.id,
    });
    return { kind: "scopeAll" }; // fail-safe default keeps the IR shape valid
  }
  switch (child.type) {
    case BLOCK_TYPES.scope_all:
      return { kind: "scopeAll" };
    default:
      errors.push({
        kind: "structural",
        message: `${inputName} 슬롯에 알 수 없는 블록 "${child.type}"`,
        blockId: child.id,
      });
      return { kind: "scopeAll" };
  }
}

function readActionScope(parent: Blockly.Block, inputName: string, errors: EditorError[]): ActionScope {
  const child = parent.getInputTargetBlock(inputName);
  if (!child) {
    errors.push({
      kind: "structural",
      message: `${inputName} 슬롯이 비어있습니다`,
      blockId: parent.id,
    });
    return { kind: "scopeAll" };
  }
  switch (child.type) {
    case BLOCK_TYPES.action_scope_all:
      return { kind: "scopeAll" };
    default:
      errors.push({
        kind: "structural",
        message: `${inputName} 슬롯에 알 수 없는 블록 "${child.type}"`,
        blockId: child.id,
      });
      return { kind: "scopeAll" };
  }
}

function readConditionStatements(
  parent: Blockly.Block,
  inputName: string,
  errors: EditorError[],
): Condition[] {
  const out: Condition[] = [];
  let cur = parent.getInputTargetBlock(inputName);
  while (cur) {
    if (cur.type === BLOCK_TYPES.cond_when) {
      const body = readExpr(cur, "BODY", errors);
      out.push({ kind: "when", body });
    } else {
      errors.push({
        kind: "structural",
        message: `조건 슬롯에 예상치 못한 블록 "${cur.type}"`,
        blockId: cur.id,
      });
    }
    cur = cur.getNextBlock();
  }
  return out;
}

function readExpr(parent: Blockly.Block, inputName: string, errors: EditorError[]): Expr {
  const child = parent.getInputTargetBlock(inputName);
  if (!child) {
    errors.push({
      kind: "structural",
      message: `식 슬롯 ${inputName} 가 비어있습니다`,
      blockId: parent.id,
    });
    // Cooperative fallback so downstream blocksToEst doesn't crash on a
    // half-built IR. Surfaced as a `raw` placeholder until Phase B fills in
    // real exprs.
    return { kind: "raw", est: null };
  }
  switch (child.type) {
    case BLOCK_TYPES.expr_lit_bool: {
      const raw = child.getFieldValue("VALUE") ?? "true";
      return { kind: "lit", litType: "bool", value: raw === "true" };
    }
    default:
      errors.push({
        kind: "structural",
        message: `식 슬롯에 알 수 없는 블록 "${child.type}"`,
        blockId: child.id,
      });
      return { kind: "raw", est: null };
  }
}
