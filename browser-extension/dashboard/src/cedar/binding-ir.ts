import { concretizeIr } from "./blocks";
import type { PolicyIR } from "./blocks";
import type { Binding, HoleValue, PolicyDef } from "../server-api/policy-store";

/**
 * The param values that ACTUALLY apply to a wallet's instance of a def:
 * the def defaults overridden by the binding's per-wallet params, restricted
 * to the def's live holes.
 *
 * This is the single definition of that merge. The editor (binding-edit mode)
 * and the history diagram both go through it so they can't diverge — divergence
 * here is exactly what made history render a def's stale default values
 * (e.g. [DOGE, kPEPE, kSHIB]) instead of the wallet's edited override
 * (e.g. [DOGE, BTC]) that the engine actually evaluated.
 */
export function mergedBindingParams(
  def: Pick<PolicyDef, "holes" | "defaults">,
  binding: Pick<Binding, "params"> | null,
): Record<string, HoleValue> {
  const live = new Set(def.holes.map((h) => h.name));
  return Object.fromEntries(
    Object.entries({ ...def.defaults.params, ...(binding?.params ?? {}) }).filter(([k]) =>
      live.has(k),
    ),
  );
}

/**
 * Concretize a def's skeleton IR with a wallet binding's effective params —
 * i.e. the policy that actually applies to that wallet. Pass `binding = null`
 * to concretize with the def defaults only.
 */
export function concretizeDefIr(def: PolicyDef, binding: Binding | null): PolicyIR {
  return concretizeIr(def.skeleton.ir as PolicyIR, mergedBindingParams(def, binding) as never);
}
