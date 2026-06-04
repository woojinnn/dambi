export { buildProbes, isBooleanNode, type Probe, type ProbeSet } from "./probes";
export { blame, type TruthMap } from "./blame";
export { nodeAtPath, eachChild, type Child } from "./path";

import type { PolicyIR } from "../blocks/ir";
import { blame, type TruthMap } from "./blame";
import type { DiagnosisResultDto } from "../../server-api/diagnosis";

export interface Diagnosis {
  /** Structural paths of the responsible leaf nodes (highlight these). */
  culprits: string[];
  /** Paths whose probe errored (render a distinct "uneval" state). */
  errored: string[];
  /** False when the policy contains hole/raw → caller falls back to @reason. */
  diagnosable: boolean;
}

/** Turn a WASM truth-map result into culprit leaf paths via the blame walker. */
export function diagnoseFromResult(
  policy: PolicyIR,
  probeIds: string[],
  result: DiagnosisResultDto,
): Diagnosis {
  const trueSet = new Set(result.true_ids);
  const errSet = new Set(result.error_ids);
  const truth: TruthMap = {};
  for (const id of probeIds) truth[id] = trueSet.has(id);
  const culprits = blame(policy, truth).filter((p) => !errSet.has(p));
  return { culprits, errored: result.error_ids, diagnosable: true };
}
