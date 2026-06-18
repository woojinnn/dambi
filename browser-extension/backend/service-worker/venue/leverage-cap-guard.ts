/**
 * Fail-soft VISIBILITY for HL order-leverage caps.
 *
 * An order-leverage cap policy reads `context.leverage`, but that field is
 * OPTIONAL service-worker enrichment ({@link ../collect-hl-leverage}): the HL
 * `/exchange` order wire carries no leverage, so the SW resolves it from
 * `activeAssetData` at decision time. When the master cannot be resolved (agent
 * wallet not yet linked, signed out, transient `/info` miss), the field is
 * omitted and the cap policy stays DORMANT — the order then passes with NO
 * signal, even though the user installed a leverage limit. For a SAFETY cap a
 * silent under-block is the wrong default.
 *
 * This module decides when to convert that silent pass into a user-approvable
 * WARN, WITHOUT becoming noisy: it fires ONLY when (1) the engine returned
 * pass, (2) the action is an order, (3) leverage could NOT be resolved for this
 * order, and (4) a leverage-reading policy is actually installed. A
 * resolved-but-under-threshold order keeps `account_leverage` non-empty (no
 * warn); an order with no leverage policy gets no warn.
 */
import type { VerdictDto } from "../wasm-bridge.types";

/** The built `Perp::PlaceOrder` body tag (HL orders + TWAPs decode to this). */
const ORDER_TAG = "place_order";

/** Synthetic policy id for an unevaluated leverage cap. */
export const LEVERAGE_UNEVALUATED_POLICY_ID = "__venue::leverage_unevaluated";

/** True for the built HL `Perp::PlaceOrder` body. */
export function isHlOrderAction(action: unknown): boolean {
  return (
    typeof action === "object" &&
    action !== null &&
    (action as { action?: unknown }).action === ORDER_TAG
  );
}

/**
 * True if any installed policy reads the `context.leverage` field — i.e. an
 * order-leverage cap is active. Matches the field precisely so it does NOT
 * trip on the distinct `context.maxLeverage` / `context.leverageType` fields
 * (which come from order-enrichment, not `account_leverage`).
 */
export function policiesReadLeverage(
  bundles: readonly { readonly policy: string }[],
): boolean {
  return bundles.some((b) => /context\.leverage\b/.test(b.policy));
}

/**
 * Should a place_order be WARNed because its leverage cap could not be
 * evaluated? Only when the engine passed, this is an order, `account_leverage`
 * is empty (unresolved for this order), and a leverage-reading policy exists.
 */
export function leverageCapUnevaluated(args: {
  readonly verdictKind: VerdictDto["kind"];
  readonly action: unknown;
  readonly accountLeverage: Readonly<Record<string, number>>;
  readonly bundles: readonly { readonly policy: string }[];
}): boolean {
  return (
    args.verdictKind === "pass" &&
    isHlOrderAction(args.action) &&
    Object.keys(args.accountLeverage).length === 0 &&
    policiesReadLeverage(args.bundles)
  );
}

/**
 * Synthetic WARN verdict: the order matched a leverage cap's shape but the cap
 * could not be evaluated (account leverage unresolved). User-approvable — it
 * does NOT block, but it makes the unevaluated guard visible instead of a
 * silent pass.
 */
export function leverageUnevaluatedVerdict(): VerdictDto {
  return {
    kind: "warn",
    matched: [
      {
        policy_id: LEVERAGE_UNEVALUATED_POLICY_ID,
        reason:
          "Leverage cap not evaluated: your HyperLiquid account leverage could not " +
          "be resolved for this order, so a leverage-limit policy could not be checked. " +
          "The cap did NOT apply — approve only if you intend this leverage.",
        severity: "warn",
        origin: "engine_error",
      },
    ],
  };
}
