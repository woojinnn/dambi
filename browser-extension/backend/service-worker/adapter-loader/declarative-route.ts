/**
 * Phase 4B — v3 declarative routing orchestrator entry.
 *
 * Pipeline (one tx in → Action[] out, or a miss for no-match):
 *
 *   1. Extract the 4-byte selector from `(chain_id, to, calldata)`.
 *   2. JIT install via `installDeclarativeBundleV3` — registry-api-v3 fetch +
 *      WASM `declarative_install_v3_json`. A registry miss surfaces as a clean
 *      `miss` so the caller falls through to the static Tier B pipeline.
 *   3. Hand `(chain_id, to, selector, calldata, meta)` to the WASM route entry
 *      `declarative_route_request_v3_json`. The engine decodes the raw
 *      calldata using the bridge-resolved bundle's `abi_fragment.abi` and
 *      emits the PDF FSM `simulation_reducer::action::Action` tree.
 *   4. Return `{ actions, decoderId }`. The caller (orchestrator in
 *      `service-worker/orchestrator.ts`) plugs these into the audit trail.
 */

import { EngineError, declarativeRouteRequestV3, type DeclarativeRouteRequestV3Result } from "../wasm-bridge";
import { extractSelector } from "./declarative-decode";
import {
  installDeclarativeBundleV3,
  InstallDeclarativeV3Error,
} from "./declarative-adapter-loader";

/**
 * Phase 4B — v3 outcome shape. The hit payload carries the new `Action[]`
 * (PDF FSM `Vec<Action>`). `decoder_id` is empty under the Phase 4B stub —
 * Phase 4D populates it from the registry-v2 manifest match.
 */
export interface DeclarativeRouteV3Hit {
  actions: Record<string, unknown>[];
  decoderId: string;
}

export type DeclarativeRouteV3Outcome =
  | { kind: "hit"; value: DeclarativeRouteV3Hit }
  | {
      kind: "miss";
      reason: "no_selector" | "bundle_not_installed";
    }
  | {
      kind: "fault";
      reason: "engine_error" | "install_failed" | "unexpected";
      cause: unknown;
    };

/**
 * Phase M4 — v3 route entry. Pipeline:
 *   1. extract 4-byte selector,
 *   2. JIT install (registry-api-v3 fetch + WASM `declarative_install_v3_json`)
 *      via `installDeclarativeBundleV3` — same callkey ((chainId, to, selector))
 *      gets `null` on registry miss (returns `miss/bundle_not_installed`),
 *   3. forward meta fields (value / gas_limit / gas_price / submitter /
 *      submitted_at / nonce) to WASM `declarative_route_request_v3_json`,
 *   4. unwrap the WASM result into a TS-friendly outcome.
 *
 * registry-v3 anonymous fetch is enabled via Cloud Run `allUsers/run.invoker`
 * grant (Plan §M0). Bundle hydration lives in `declarative-adapter-loader.ts`
 * (Plan §M3 — JIT + 2-layer cache; v1 path is untouched).
 *
 * On `fault` the caller falls back to the legacy v1 path.
 */
export async function tryDeclarativeRouteV3(args: {
  chainId: number;
  from: string;
  to: string;
  valueWei?: string;
  gasLimit?: string;
  gasPrice?: string;
  nonce?: number;
  submittedAt?: number;
  blockTimestamp?: number;
  calldataHex: string | undefined;
}): Promise<DeclarativeRouteV3Outcome> {
  const selector = extractSelector(args.calldataHex);
  if (!selector) {
    return { kind: "miss", reason: "no_selector" };
  }
  const submittedAt = args.submittedAt ?? Math.floor(Date.now() / 1000);

  // Plan §M4 — JIT install via registry-api-v3. If the callkey has no
  // matching v3 manifest (404 / `matched: false`), `installDeclarativeBundleV3`
  // returns `null`; we surface that as a clean miss so the caller falls
  // through to v1 without surfacing it as a fault.
  try {
    const installed = await installDeclarativeBundleV3({
      chainId: args.chainId,
      to: args.to,
      selector,
    });
    if (installed === null) {
      return { kind: "miss", reason: "bundle_not_installed" };
    }
  } catch (err) {
    if (err instanceof InstallDeclarativeV3Error) {
      return { kind: "fault", reason: "install_failed", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  let result: DeclarativeRouteRequestV3Result;
  try {
    result = await declarativeRouteRequestV3({
      chain_id: args.chainId,
      to: args.to,
      selector,
      calldata: args.calldataHex!,
      ...(args.valueWei !== undefined ? { value: args.valueWei } : {}),
      ...(args.gasLimit !== undefined ? { gas_limit: args.gasLimit } : {}),
      ...(args.gasPrice !== undefined ? { gas_price: args.gasPrice } : {}),
      submitter: args.from,
      submitted_at: submittedAt,
      ...(args.nonce !== undefined ? { nonce: args.nonce } : {}),
      ...(args.blockTimestamp !== undefined
        ? { block_timestamp: args.blockTimestamp }
        : {}),
    });
  } catch (err) {
    // The Phase 4B WASM stub only throws on malformed input — promote any
    // EngineError to `engine_error` so the caller can audit it. Other
    // throws (network glitch, etc.) bucket into `unexpected`.
    if (err instanceof EngineError) {
      return { kind: "fault", reason: "engine_error", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  return {
    kind: "hit",
    value: {
      actions: result.actions,
      decoderId: result.decoder_id,
    },
  };
}
