/**
 * Membership semantics — the SINGLE place that decides how a `contains` / `in` /
 * `containsAny` / `containsAll` over a **literal set** decomposes into per-member
 * tests. Three consumers share it so they can never drift:
 *   - {@link ../diagram/PolicyDiagram} fans the node into one leaf per member;
 *   - {@link ./probes} emits one boolean probe per member (so the oracle says
 *     WHICH member matched);
 *   - {@link ./blame} blames the matched member path, not the whole node.
 *
 * A node only decomposes when one operand is a NON-EMPTY set literal — a scalar
 * membership like `context.tags contains "x"` (no literal set) stays a single
 * leaf. The member paths produced here are exactly the `…elements[i]` paths
 * `eachChild`/`enumeratePaths` assign, so highlight lines up byte-for-byte.
 */

import type { Expr } from "../blocks/ir";

/** Binary ops whose truth is "is X a member of set Y". */
export const MEMBERSHIP_OPS = new Set(["contains", "in", "containsAny", "containsAll"]);

/** A membership node decomposed: the literal `set` operand (the list of
 *  members), the path `step` reaching it (`left`/`right` — mirrors `eachChild`),
 *  and the `other` operand (the value/runtime-set being tested against it). */
export interface MembershipSplit {
  set: Extract<Expr, { kind: "set" }>;
  step: "left" | "right";
  other: Expr;
}

function nonEmptySetLit(e: Expr): e is Extract<Expr, { kind: "set" }> {
  return e.kind === "set" && e.elements.length > 0;
}

/**
 * If `e` is a membership binary with a literal-set operand, return how it splits;
 * else null. Per-operator, because the literal set sits on a different side
 * depending on the op:
 *   - `contains`         → `[set] contains needle`     (set = left,  other = needle)
 *   - `in`               → `needle in [set]`           (set = right, other = needle)
 *   - `containsAny/All`  → `haystack contains? [set]`  (set = right, other = haystack)
 */
export function setLiteralOperand(e: Expr): MembershipSplit | null {
  if (e.kind !== "binary" || !MEMBERSHIP_OPS.has(e.op)) return null;
  if (e.op === "contains") {
    return nonEmptySetLit(e.left) ? { set: e.left, step: "left", other: e.right } : null;
  }
  // `in`, `containsAny`, `containsAll` — the literal set is the right operand.
  return nonEmptySetLit(e.right) ? { set: e.right, step: "right", other: e.left } : null;
}

/**
 * The boolean test deciding whether `member` is the matched one, given the
 * membership op and the `other` operand:
 *   - `contains` / `in`        → `other == member`        (needle equals member)
 *   - `containsAny` / `All`    → `other contains member`   (member is in haystack)
 */
export function memberTestExpr(op: string, other: Expr, member: Expr): Expr {
  if (op === "containsAny" || op === "containsAll") {
    return { kind: "binary", op: "contains", left: other, right: member };
  }
  return { kind: "binary", op: "==", left: other, right: member };
}

/** True for `containsAll` — every member is required (rendered "다음 전부"),
 *  vs the ANY-OF ops rendered "다음 중 하나". */
export function isAllOf(op: string): boolean {
  return op === "containsAll";
}
