import type { PolicyIR, Expr } from "../blocks/ir";
import { blocksToEst } from "../blocks/blocksToEst";
import { eachChild } from "./path";

/** Boolean-valued extension functions (from spike S3). */
const BOOL_EXT = new Set([
  "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual",
  "isInRange", "isIpv4", "isIpv6", "isLoopback", "isMulticast",
]);

const BOOL_BINARY = new Set([
  "==", "!=", "<", "<=", ">", ">=", "in", "contains", "containsAll", "containsAny",
]);

/** True iff this node is a boolean-valued expression (safe to wrap in `when`). */
export function isBooleanNode(e: Expr): boolean {
  switch (e.kind) {
    case "binary": return BOOL_BINARY.has(e.op) || e.op === "&&" || e.op === "||";
    case "unary": return e.op === "!" || e.op === "isEmpty";
    case "has":
    case "like":
    case "is": return true;
    case "ext": return BOOL_EXT.has(e.fn);
    default: return false; // var, lit, attr, set, record, if, litEntity, raw, hole
  }
}

/** A probe: a permit policy (EST) wrapping a boolean subtree, keyed by path. */
export interface Probe {
  id: string;
  est: unknown;
}

export interface ProbeSet {
  probes: Probe[];
  /** True iff the policy is fully diagnosable (no hole/raw under any clause). */
  diagnosable: boolean;
}

/** A synthetic unconstrained permit wrapping `body`, annotated with `@id(path)`. */
function probePolicy(path: string, body: Expr): PolicyIR {
  return {
    kind: "policy", effect: "permit", annotations: [{ name: "id", value: path }],
    scope: { principal: { kind: "scopeAll" }, action: { kind: "scopeAll" }, resource: { kind: "scopeAll" } },
    conditions: [{ kind: "when", body }],
  };
}

/** Enumerate every boolean node of `policy` and build one probe each. Subtrees
 *  containing `hole`/`raw` are skipped and flip `diagnosable` to false. */
export function buildProbes(policy: PolicyIR): ProbeSet {
  const probes: Probe[] = [];
  let diagnosable = true;

  const hasUninterpretable = (e: Expr): boolean => {
    if (e.kind === "hole" || e.kind === "raw") return true;
    for (const c of eachChild(e)) if (hasUninterpretable(c.node)) return true;
    return false;
  };

  // `forceBool` is true for a clause body root: a `when`/`unless` body is
  // boolean by Cedar's grammar even when its root is an `if` (which
  // `isBooleanNode` returns false for). Probing it ensures blame's clause-entry
  // `truth["c{i}.body"]` is always defined.
  const visit = (e: Expr, path: string, forceBool: boolean): void => {
    if (e.kind === "hole" || e.kind === "raw") { diagnosable = false; return; }
    if ((forceBool || isBooleanNode(e)) && !hasUninterpretable(e)) {
      probes.push({ id: path, est: blocksToEst(probePolicy(path, e)) });
    }
    for (const c of eachChild(e)) visit(c.node, `${path}.${c.step}`, false);
  };

  policy.conditions.forEach((cond, i) => visit(cond.body, `c${i}.body`, true));
  return { probes, diagnosable };
}
