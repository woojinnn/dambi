import type { PolicyIR, Expr } from "../blocks/ir";

/** A labelled child edge of an Expr. `step` is the path segment. */
export interface Child {
  step: string;
  node: Expr;
}

/** Yield each direct child Expr with its canonical path step. THIS is the only
 *  place step labels are defined — `blame.ts` and `irToWorkspace.ts` must derive
 *  paths from here (via `enumeratePaths`/`pathByNode`), never hand-build strings. */
export function* eachChild(e: Expr): Generator<Child> {
  switch (e.kind) {
    case "binary":
      yield { step: "left", node: e.left };
      yield { step: "right", node: e.right };
      return;
    case "unary":
      yield { step: "operand", node: e.operand };
      return;
    case "attr":
    case "has":
    case "like":
      yield { step: "of", node: e.of };
      return;
    case "is":
      yield { step: "of", node: e.of };
      if (e.in) yield { step: "in", node: e.in };
      return;
    case "if":
      yield { step: "cond", node: e.cond };
      yield { step: "then", node: e.then };
      yield { step: "else", node: e.else };
      return;
    case "set":
      for (let i = 0; i < e.elements.length; i++)
        yield { step: `elements[${i}]`, node: e.elements[i] };
      return;
    case "record":
      for (let i = 0; i < e.pairs.length; i++)
        yield { step: `pairs[${i}]`, node: e.pairs[i].value };
      return;
    case "ext":
      for (let i = 0; i < e.args.length; i++)
        yield { step: `args[${i}]`, node: e.args[i] };
      return;
    // leaves: var, lit, litEntity, raw, hole — no children
    default:
      return;
  }
}

/** Resolve a single path step against a node. Returns null if absent. */
export function nodeAtPath(e: Expr, step: string): Expr | null {
  for (const c of eachChild(e)) if (c.step === step) return c.node;
  return null;
}

/** Every node in the policy with its canonical path, via `eachChild` only.
 *  Single producer used by probes, blame, and the editor path map. */
export function enumeratePaths(policy: PolicyIR): { path: string; node: Expr }[] {
  const out: { path: string; node: Expr }[] = [];
  const visit = (node: Expr, path: string): void => {
    out.push({ path, node });
    for (const c of eachChild(node)) visit(c.node, `${path}.${c.step}`);
  };
  policy.conditions.forEach((cond, i) => visit(cond.body, `c${i}.body`));
  return out;
}

/** Identity map node → canonical path. blame.ts looks up paths here instead of
 *  building strings, so its step labels CANNOT drift from `eachChild`. */
export function pathByNode(policy: PolicyIR): Map<Expr, string> {
  const m = new Map<Expr, string>();
  for (const { path, node } of enumeratePaths(policy)) m.set(node, path);
  return m;
}

/** Combine `enumeratePaths` with an Expr→blockId map (recorded by irToWorkspace,
 *  keyed by node identity) into the path→blockId map the highlighter needs.
 *  PURE — testable with no Blockly workspace. */
export function pathToBlockId(
  policy: PolicyIR,
  blockIdByNode: Map<Expr, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const { path, node } of enumeratePaths(policy)) {
    const id = blockIdByNode.get(node);
    if (id) out.set(path, id);
  }
  return out;
}
