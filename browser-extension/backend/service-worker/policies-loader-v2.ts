/**
 * Phase 1 / P2 — default v2 policy set loader (ADDITIVE).
 *
 * v2 policy evaluation (`evaluate_action_v2_json`) is STATELESS: each call
 * takes its policy `bundles` INLINE and composes their per-policy schema
 * internally. There is NO install step — unlike the v1 stateful path in
 * `policies-loader.ts` (`install_policies_json` / `installFiltered`, which
 * "REPLACE engine state"). So this module does NOT touch WASM at boot; it
 * just fetches the shipped `default-policies/policy-set-v2.json` asset once
 * and HOLDS it in a module-level cache that a future `evaluateActionV2`
 * orchestrator call site can read synchronously.
 *
 * Mirrors `loadDefaultPolicySet()` (the fetch) + `ensureSeedBundlesInstalled()`
 * (the cached boot-latch). Best-effort: a fetch failure logs + yields `[]` so
 * it can never brick SW boot.
 *
 * Do NOT route these bundles through `installPolicies`/`installFiltered` and
 * do NOT pass a `schema_text` — both belong to the v1 path and would clobber
 * or collide with v2's per-call schema composition.
 */

import Browser from "webextension-polyfill";

/**
 * On-disk asset row (one element of `policy-set-v2.json`). `manifest` is left
 * opaque: it is validated by the Rust `default_policies_v2.rs` gate at
 * fixture-author time, not re-validated here (mirrors how
 * `loadDefaultPolicySet` treats `manifest?: unknown`).
 */
export interface V2Bundle {
  /**
   * Bundle directory name (== `manifest.id` by the `default_policies_v2.rs`
   * invariant). Kept for deterministic ordering and a future enable/disable
   * layer (the v2 analog of v1 `getEnabledIds`). NOT consumed by WASM.
   */
  id: string;
  /** Raw `policy.cedar` text, verbatim. */
  policy: string;
  /** Parsed `manifest.json`, verbatim. */
  manifest: unknown;
}

/**
 * Exact WASM `BundleInput` row for `evaluate_action_v2_json` — DROPS `id`.
 * `BundleInput` has no `id` field today and (currently) no
 * `deny_unknown_fields`, but we map to `{ policy, manifest }` so a later
 * `deny_unknown_fields` addition on the Rust side cannot break the call.
 */
export interface EngineBundleInput {
  policy: string;
  manifest: unknown;
}

let cachedV2Bundles: V2Bundle[] | null = null;
let inflight: Promise<V2Bundle[]> | null = null;

/**
 * Fetch `default-policies/policy-set-v2.json` and hold it in a module-level
 * cache. Idempotent within a single SW lifetime: subsequent calls return the
 * cached set without re-fetching. Concurrent callers share one in-flight
 * fetch.
 *
 * Best-effort: on any fetch/parse failure this logs a warning and resolves to
 * `[]` (mirrors the v1 `[]` fallback + seed-bundle resilience) so it can never
 * throw out of the boot sequence.
 */
export async function loadDefaultPolicySetV2(): Promise<V2Bundle[]> {
  if (cachedV2Bundles) return [...cachedV2Bundles];
  if (inflight) return inflight.then((b) => [...b]);

  inflight = (async () => {
    try {
      const setUrl = Browser.runtime.getURL(
        "default-policies/policy-set-v2.json",
      );
      const response = await fetch(setUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${setUrl}`);
      }
      const parsed = JSON.parse(await response.text()) as V2Bundle[];
      cachedV2Bundles = parsed;
      return parsed;
    } catch (err) {
      console.warn(
        "[Scopeball] v2 default policy set load failed:",
        err instanceof Error ? err.message : err,
      );
      // Cache the empty result so a transient failure doesn't re-fetch on
      // every read; the boot latch retries on the next SW lifetime.
      cachedV2Bundles = [];
      return cachedV2Bundles;
    } finally {
      inflight = null;
    }
  })();

  return inflight.then((b) => [...b]);
}

/**
 * Return the held v2 set mapped to the WASM `bundles` arg shape
 * (`{ policy, manifest }`, `id` dropped). Synchronous — the orchestrator
 * reads this on the decision path after `loadDefaultPolicySetV2()` warmed the
 * cache at boot. Returns `[]` if the cache hasn't been warmed yet.
 */
export function getDefaultPolicyBundlesV2(): EngineBundleInput[] {
  if (!cachedV2Bundles) return [];
  return cachedV2Bundles.map(({ policy, manifest }) => ({ policy, manifest }));
}

/**
 * Test helper — drop the cached set so successive vitest cases re-fetch from
 * a cold slate. Mirrors `__resetSeedBundlesForTest` for the seed-bundle path.
 */
export function __resetV2BundlesForTest(): void {
  cachedV2Bundles = null;
  inflight = null;
}
