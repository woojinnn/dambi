/**
 * Phase 6 — declarative routing orchestrator entry.
 *
 * Pipeline (one tx in → envelope list out, or `null` for miss):
 *
 *   1. Compose `CallMatchKey` from `(chain_id, to, calldata.selector)`.
 *   2. Resolve via `resolveAdapter` — Layer 1 mount → negative cache →
 *      JIT fetch. A hit gives us the parsed bundle in addition to the
 *      decoder id.
 *   3. Decode calldata against `bundle.abi_fragment.abi` (viem).
 *   4. Hand `(chain_id, to, selector, decoded, ctx)` to the WASM route
 *      entry `declarative_route_request_json`. The engine looks up the
 *      bridge-installed mapper and runs it.
 *   5. Return `{ envelopes, decoderId, bundleId }`. The caller (orchestrator
 *      in `service-worker/orchestrator.ts`) plugs these into the audit trail
 *      and continues to the existing Cedar pipeline. When this helper
 *      returns `null` (Layer 1/JIT miss, decode failure, …) the caller
 *      falls through to the static Tier B pipeline.
 *
 * Out of scope for this PoC: multicall_recurse host resolver wiring (V2
 * single_emit only). A bundle that requires recursion hits the existing
 * `MapperError("multicall_recurse requires ctx.resolver")` path inside
 * the WASM and surfaces as `EngineError("map_failed", …)` to the caller.
 */

import type { CallMatchKey } from "../registry/client";
import {
  EngineError,
  declarativeRouteRequest,
  type DeclarativeRouteRequestResult,
} from "../wasm-bridge";
import {
  buildRouteInput,
  decodeBundleCalldata,
  DeclarativeDecodeError,
  extractSelector,
} from "./declarative-decode";
import { resolveAdapter, type AdapterOrVerdict } from "./jit-fetcher";

const DEFAULT_REGISTRY_BASE_URL =
  typeof process !== "undefined" && process.env?.REGISTRY_BASE_URL
    ? process.env.REGISTRY_BASE_URL
    : "http://localhost:8000";

export interface DeclarativeRouteHit {
  /** ActionEnvelopes the declarative mapper produced. */
  envelopes: Record<string, unknown>[];
  /** Bridge-resolved declarative decoder id (`declarative.<path>`). */
  decoderId: string;
  /** Bundle id (`<path>@<version>`) for audit telemetry. */
  bundleId: string;
  /** Where the bundle came from — kept for audit telemetry. */
  source: "layer1" | "jit";
}

export type DeclarativeRouteOutcome =
  | { kind: "hit"; value: DeclarativeRouteHit }
  | { kind: "miss"; reason: DeclarativeRouteMissReason }
  | { kind: "fault"; reason: DeclarativeRouteFaultReason; cause: unknown };

export type DeclarativeRouteMissReason =
  | "no_selector" // calldata too short to host a 4-byte selector
  | "no_publisher" // resolveAdapter returned a negative cache hit
  | "no_declarative_mapper" // bridge had no entry (bundle install failed silently)
  | "integrity_failed" // JIT bundle hash mismatch
  | "timeout"; // JIT fetch timed out or other transient error

export type DeclarativeRouteFaultReason =
  | "decode_failed" // calldata could not be decoded against bundle ABI
  | "map_failed" // declarative mapper rejected the decoded call
  | "engine_error" // unexpected engine error
  | "unexpected"; // anything else

export interface DeclarativeRouteOptions {
  /** Base URL for the registry index server. Defaults to localhost:8000. */
  registryBaseUrl?: string;
  /** Override the block timestamp the engine sees. Defaults to `now()`. */
  blockTimestamp?: number;
}

/**
 * Try to route a tx through the declarative pipeline. Returns an outcome
 * the orchestrator can switch on.
 */
export async function tryDeclarativeRoute(args: {
  chainId: number;
  from: string;
  to: string;
  valueWei?: string;
  calldataHex: string | undefined;
  options?: DeclarativeRouteOptions;
}): Promise<DeclarativeRouteOutcome> {
  const selector = extractSelector(args.calldataHex);
  if (!selector) {
    return { kind: "miss", reason: "no_selector" };
  }

  const key: CallMatchKey = {
    chain_id: args.chainId,
    to: args.to,
    selector,
  };

  let resolution: AdapterOrVerdict;
  try {
    resolution = await resolveAdapter(key, {
      registry: { baseUrl: args.options?.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL },
    });
  } catch (err) {
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  if (resolution.kind === "verdict") {
    return { kind: "miss", reason: resolution.reason };
  }

  const adapter = resolution.adapter;
  let decoded;
  try {
    decoded = decodeBundleCalldata(adapter.bundle, args.calldataHex!);
  } catch (err) {
    if (err instanceof DeclarativeDecodeError) {
      return { kind: "fault", reason: "decode_failed", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  const blockTimestamp =
    args.options?.blockTimestamp ?? Math.floor(Date.now() / 1000);
  const routeInput = buildRouteInput({
    chainId: args.chainId,
    to: args.to,
    selector,
    from: args.from,
    ...(args.valueWei !== undefined ? { valueWei: args.valueWei } : {}),
    blockTimestamp,
    decoded,
  });

  let result: DeclarativeRouteRequestResult;
  try {
    result = await declarativeRouteRequest(routeInput);
  } catch (err) {
    if (err instanceof EngineError) {
      if (err.kind === "no_declarative_mapper") {
        // Bridge was empty for this callkey — the JIT install must have
        // silently dropped, e.g. due to a race. Treat as miss so the
        // orchestrator falls through to the static path.
        return { kind: "miss", reason: "no_declarative_mapper" };
      }
      if (err.kind === "map_failed") {
        return { kind: "fault", reason: "map_failed", cause: err };
      }
      return { kind: "fault", reason: "engine_error", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  return {
    kind: "hit",
    value: {
      envelopes: result.envelopes,
      decoderId: result.decoder_id,
      bundleId: adapter.bundleId,
      source: resolution.source,
    },
  };
}
