/**
 * PolicyIR → Blockly Workspace.
 *
 * Used by:
 *   - irToWorkspace(ws, [policy]) on initial mount to seed an empty policy
 *     skeleton in Phase A;
 *   - the textToBlocks path in Phase D once it lands (paste Cedar → blocks).
 *
 * Clears the workspace first, then creates blocks for each PolicyIR. Block
 * positions are left to Blockly's auto-layout — callers can centerOnBlock
 * afterwards for nicer initial viewport.
 *
 * Phase A scope matches workspaceToIR: only the skeleton block set is
 * materializable. Unsupported Expr.kinds fall back to a placeholder lit_bool
 * block until Phase B/C add their real renderers.
 */

import * as Blockly from "blockly";
import type {
  ActionScope,
  Condition,
  Expr,
  PolicyIR,
  Scope,
} from "../../cedar/blocks";
import { BLOCK_TYPES } from "./block-types";

export function irToWorkspace(ws: Blockly.WorkspaceSvg, policies: PolicyIR[]): void {
  ws.clear();
  let yCursor = 30;
  for (const policy of policies) {
    const hat = createPolicyHat(ws, policy);
    hat.moveBy(50, yCursor);
    yCursor += 400;
  }
}

function createPolicyHat(ws: Blockly.WorkspaceSvg, policy: PolicyIR): Blockly.BlockSvg {
  const hat = ws.newBlock(BLOCK_TYPES.policy_hat) as Blockly.BlockSvg;
  hat.setFieldValue(policy.effect, "EFFECT");
  attachScope(ws, hat, "PRINCIPAL", policy.scope.principal);
  attachActionScope(ws, hat, "ACTION", policy.scope.action);
  attachScope(ws, hat, "RESOURCE", policy.scope.resource);
  attachConditions(ws, hat, "CONDITIONS", policy.conditions);
  hat.initSvg();
  hat.render();
  return hat;
}

function attachScope(
  ws: Blockly.WorkspaceSvg,
  parent: Blockly.BlockSvg,
  inputName: string,
  scope: Scope,
): void {
  // Phase A: only scopeAll is renderable. scopeEq / scopeIn / scopeIs / slot
  // fall back to scope_all until Phase B adds their blocks. This is a lossy
  // render — round-trip test will catch any silent downgrade.
  const child = ws.newBlock(BLOCK_TYPES.scope_all) as Blockly.BlockSvg;
  child.initSvg();
  child.render();
  // Suppress unused-variable warning until scope variants land.
  void scope;
  parent.getInput(inputName)?.connection?.connect(child.outputConnection);
}

function attachActionScope(
  ws: Blockly.WorkspaceSvg,
  parent: Blockly.BlockSvg,
  inputName: string,
  scope: ActionScope,
): void {
  const child = ws.newBlock(BLOCK_TYPES.action_scope_all) as Blockly.BlockSvg;
  child.initSvg();
  child.render();
  void scope;
  parent.getInput(inputName)?.connection?.connect(child.outputConnection);
}

function attachConditions(
  ws: Blockly.WorkspaceSvg,
  parent: Blockly.BlockSvg,
  inputName: string,
  conditions: Condition[],
): void {
  let prev: Blockly.BlockSvg | null = null;
  for (const cond of conditions) {
    if (cond.kind !== "when") continue; // unless arrives in Phase B
    const block = ws.newBlock(BLOCK_TYPES.cond_when) as Blockly.BlockSvg;
    attachExpr(ws, block, "BODY", cond.body);
    block.initSvg();
    block.render();
    if (prev === null) {
      parent.getInput(inputName)?.connection?.connect(block.previousConnection);
    } else {
      prev.nextConnection?.connect(block.previousConnection);
    }
    prev = block;
  }
}

function attachExpr(
  ws: Blockly.WorkspaceSvg,
  parent: Blockly.BlockSvg,
  inputName: string,
  expr: Expr,
): void {
  const child = createExprBlock(ws, expr);
  if (!child) return;
  child.initSvg();
  child.render();
  parent.getInput(inputName)?.connection?.connect(child.outputConnection);
}

function createExprBlock(ws: Blockly.WorkspaceSvg, expr: Expr): Blockly.BlockSvg | null {
  switch (expr.kind) {
    case "lit":
      if (expr.litType === "bool") {
        const b = ws.newBlock(BLOCK_TYPES.expr_lit_bool) as Blockly.BlockSvg;
        b.setFieldValue(expr.value ? "true" : "false", "VALUE");
        return b;
      }
      // Other lit types fall through to placeholder.
      return placeholderBool(ws);
    default:
      // Phase A: every other Expr.kind renders as a placeholder bool block.
      // Phase B+ replaces this branch with real blocks.
      return placeholderBool(ws);
  }
}

function placeholderBool(ws: Blockly.WorkspaceSvg): Blockly.BlockSvg {
  const b = ws.newBlock(BLOCK_TYPES.expr_lit_bool) as Blockly.BlockSvg;
  b.setFieldValue("true", "VALUE");
  return b;
}
