/**
 * Phase 6 — declarative routing orchestrator entry.
 *
 * Pipeline (one tx in → envelope list out, or `null` for miss):
 *
 *   1. Compose `CallMatchKey` from `(chain_id, to, calldata.selector)`.
 *   2. Resolve via `resolveAdapter` — Layer 1 mount → negative cache →
 *      JIT fetch. Ensures the bundle is mounted in WASM and supplies
 *      `bundleId`/`source` for audit telemetry.
 *   3. Hand `(chain_id, to, selector, calldata, ctx)` to the WASM route
 *      entry `declarative_route_request_json`. The engine decodes the
 *      raw calldata using the bridge-resolved bundle's `abi_fragment.abi`
 *      and runs the declarative mapper.
 *   4. Return `{ envelopes, decoderId, bundleId }`. The caller (orchestrator
 *      in `service-worker/orchestrator.ts`) plugs these into the audit trail
 *      and continues to the existing Cedar pipeline. When this helper
 *      returns `null` (Layer 1/JIT miss, WASM decode failure, …) the caller
 *      falls through to the static Tier B pipeline.
 *
 * multicall_recurse: between step 2 (`resolveAdapter` for the outer bundle)
 * and step 3 (`declarativeRouteRequest`) the orchestrator runs a child-prefetch
 * pass. `declarativePlanChildren` decodes the outer multicall in WASM and
 * returns the inner sub-call callkeys; each is fetch+installed via
 * `prefetchChildAdapters` so the WASM-side `WasmChildResolver` finds every
 * child in the engine bridge. Best-effort — a planner fault or an
 * un-publishable child does not abort the route; the WASM resolver still
 * surfaces a precise `map_failed`. Depth-1 only (NFPM children are leaf
 * `single_emit` functions); nested multicalls are a follow-up.
 */

import type { CallMatchKey } from "../registry/client";
import {
  defaultTokenRegistryClient,
  type TokenRegistryClient,
} from "../registry/token-client";
import {
  EngineError,
  declarativePlanChildren,
  declarativeRouteRequest,
  declarativeRouteRequestV3,
  type DeclarativeRouteRequestResult,
  type DeclarativeRouteRequestV3Result,
} from "../wasm-bridge";
import { buildRouteInput, extractSelector } from "./declarative-decode";
import {
  prefetchChildAdapters,
  resolveAdapter,
  type AdapterOrVerdict,
} from "./jit-fetcher";
import {
  installDeclarativeBundleV3,
  InstallDeclarativeV3Error,
} from "./declarative-adapter-loader";

const DEFAULT_REGISTRY_BASE_URL =
  typeof process !== "undefined" && process.env?.REGISTRY_BASE_URL
    ? process.env.REGISTRY_BASE_URL
    : "http://localhost:8000";

export interface DeclarativeRouteHit {
  /**
   * ActionEnvelopes the declarative mapper produced, post-processed by
   * `enrichEnvelopeAssets` so every AssetRef carries `symbol`/`decimals`
   * when the registry can resolve it.
   */
  envelopes: Record<string, unknown>[];
  /** Bridge-resolved declarative decoder id (`declarative.<path>`). */
  decoderId: string;
  /** Bundle id (`<path>@<version>`) for audit telemetry. */
  bundleId: string;
  /** Where the bundle came from — kept for audit telemetry. */
  source: "layer1" | "layer2" | "jit";
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
  /**
   * Token metadata source for Phase 7E envelope post-processing. Injected
   * for tests; the orchestrator typically lets us fall back to the
   * process-wide singleton via `defaultTokenRegistryClient()`.
   */
  tokenClient?: TokenRegistryClient;
}

/**
 * Phase 7E — token metadata enrichment.
 *
 * The Rust declarative mapper emits envelopes with `AssetRef` skeletons
 * that carry `{kind, address}` only (per §8.1 with the user's
 * adapter-layer reassignment — `symbol`/`decimals` are NOT host:* fields).
 * The TS post-processing step walks every envelope, finds every
 * AssetRef-shaped object, and pulls `{symbol, decimals}` from the
 * registry-backed `TokenRegistryClient`.
 *
 * AssetRef detection is structural rather than positional: any object
 * with a string `kind` and a string `address` qualifies. This keeps the
 * traversal stable when new action types arrive (no per-action switch to
 * update) and side-steps the `serde(flatten)` shape `{category, action,
 * fields}` quirk where field names live inside the dynamic `fields`
 * payload.
 *
 * Native assets (kind="native", no address) are skipped — they have no
 * address to look up. Unknown tokens (registry returns null) are also
 * skipped so the original skeleton survives intact — a policy that
 * doesn't reference symbol/decimals still evaluates correctly.
 *
 * Concurrency: every lookup is fanned through `Promise.all`. Same-token
 * dedupe is delegated to the underlying `TokenRegistryClient`'s inflight
 * dedupe (one in-flight Promise per `${chainId}__${address}` slot), so a
 * swap with the same input and output token would only hit the network
 * once.
 */
export async function enrichEnvelopeAssets(
  envelopes: Record<string, unknown>[],
  chainId: number,
  tokenClient: TokenRegistryClient,
): Promise<Record<string, unknown>[]> {
  if (envelopes.length === 0) return envelopes;
  return Promise.all(
    envelopes.map((env) => enrichValue(env, chainId, tokenClient)) as Promise<
      Record<string, unknown>
    >[],
  );
}

/**
 * Recursive walker — clones the input value with AssetRef-shaped objects
 * replaced by enriched copies. Pure values and arrays are traversed
 * structurally so the call graph terminates on JSON-shaped data.
 */
async function enrichValue(
  value: unknown,
  chainId: number,
  tokenClient: TokenRegistryClient,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => enrichValue(item, chainId, tokenClient)),
    );
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (looksLikeAssetRef(obj)) {
      return enrichAssetRef(obj, chainId, tokenClient);
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const enriched = await Promise.all(
      keys.map((k) => enrichValue(obj[k], chainId, tokenClient)),
    );
    keys.forEach((k, i) => {
      out[k] = enriched[i];
    });
    return out;
  }
  return value;
}

/**
 * AssetRef shape probe — accepts both the always-camelCase JSON wire
 * form (`{kind, address, tokenId?, symbol?, decimals?}`) and the
 * subset that the mapper actually emits (`{kind, address}`). We require
 * a string `kind` AND a string `address` so we don't accidentally
 * enrich `{kind: "native"}` (no address) or unrelated shapes such as
 * `{kind: "exact", value: "1000"}` (AmountConstraint).
 */
function looksLikeAssetRef(obj: Record<string, unknown>): boolean {
  return typeof obj.kind === "string" && typeof obj.address === "string";
}

/**
 * Fill in `symbol` and `decimals` on a single AssetRef. Existing values
 * are preserved — a publisher that emits enriched payloads up-front
 * doesn't get clobbered by a registry miss. Lookup failures fall
 * through silently so the verdict path stays alive when the registry
 * has gaps.
 */
async function enrichAssetRef(
  assetRef: Record<string, unknown>,
  chainId: number,
  tokenClient: TokenRegistryClient,
): Promise<Record<string, unknown>> {
  const address = assetRef.address;
  if (typeof address !== "string" || address.length === 0) return assetRef;

  let meta;
  try {
    meta = await tokenClient.lookup(chainId, address);
  } catch {
    // Token registry hiccups must NOT take out the route. Skip
    // enrichment and let the static path observe the bare skeleton.
    return assetRef;
  }
  if (!meta) return assetRef;

  const enriched: Record<string, unknown> = { ...assetRef };
  if (enriched.symbol === undefined) enriched.symbol = meta.symbol;
  if (enriched.decimals === undefined) enriched.decimals = meta.decimals;
  return enriched;
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

  const blockTimestamp =
    args.options?.blockTimestamp ?? Math.floor(Date.now() / 1000);
  const routeInput = buildRouteInput({
    chainId: args.chainId,
    to: args.to,
    selector,
    from: args.from,
    ...(args.valueWei !== undefined ? { valueWei: args.valueWei } : {}),
    blockTimestamp,
    calldata: args.calldataHex!,
  });

  // ── child-prefetch (multicall_recurse + opcode_stream_dispatch) ────────
  // The WASM-side `WasmChildResolver` is synchronous — it can only resolve an
  // inner sub-call if the child bundle is already mounted in
  // `DECLARATIVE_STATE`. For two outer strategies we ask the engine to plan
  // the inner callkeys, then fetch+install each one before
  // `declarativeRouteRequest`:
  //   - `multicall_recurse`: self-multicall (child to == outer to). Covers
  //     V3 NFPM `multicall(bytes[])`, SR02 multicall overloads, Multicall3.
  //   - `opcode_stream_dispatch`: cross-target dispatch (UR V2 family commands
  //     `0x11 V3_POSITION_MANAGER_PERMIT` / `0x12 V3_POSITION_MANAGER_CALL` /
  //     `0x14 V4_POSITION_MANAGER_CALL`). Track B Fix 3 — registry-v2 cutover.
  //
  // Other strategies (`single_emit`, `enum_tagged_dispatch`, `array_emit`,
  // and `opcode_stream_dispatch` with dispatcher_id = "v4_position_manager"
  // which has no cross-target opcodes) skip the planner WASM call entirely —
  // the engine planner returns `children:[]` for them and the resolver
  // works without prefetch.
  //
  // Strictly best-effort: a planner fault or a child that 404s must NOT abort
  // the route. `declarativeRouteRequest` still runs; the WASM resolver
  // produces a precise `map_failed` for any child it cannot find, which the
  // orchestrator degrades to the static path.
  const PREFETCH_STRATEGIES = new Set([
    "multicall_recurse",
    "opcode_stream_dispatch",
  ]);
  console.log("[Scopeball][DBG] prefetch-eval", {
    strategy: adapter.bundle.emit.strategy,
    shouldPrefetch: PREFETCH_STRATEGIES.has(adapter.bundle.emit.strategy),
  });
  if (PREFETCH_STRATEGIES.has(adapter.bundle.emit.strategy)) {
    try {
      console.log("[Scopeball][DBG] prefetch-begin", {
        chainId: args.chainId,
        to: args.to,
        selector,
      });
      const plan = await declarativePlanChildren(routeInput);
      console.log("[Scopeball][DBG] prefetch-plan", {
        childrenCount: plan.children.length,
        children: plan.children,
      });
      if (plan.children.length > 0) {
        await prefetchChildAdapters(plan.children, {
          registry: {
            baseUrl:
              args.options?.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL,
          },
        });
        console.log("[Scopeball][DBG] prefetch-installed", {
          childrenCount: plan.children.length,
        });
        // post-verification — 5 child 의 bridge 등록 결과 직접 재확인
        for (const c of plan.children) {
          try {
            const verif = await resolveAdapter(c as CallMatchKey, {
              registry: {
                baseUrl:
                  args.options?.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL,
              },
            });
            console.log("[Scopeball][DBG] prefetch-child-verify", {
              callkey: `${c.chain_id}__${c.to}__${c.selector}`,
              kind: verif.kind,
              reason:
                verif.kind === "verdict" ? verif.reason : undefined,
              source:
                verif.kind === "adapter" ? verif.source : undefined,
              bundleId:
                verif.kind === "adapter" ? verif.adapter.bundleId : undefined,
            });
          } catch (verifyErr) {
            console.warn("[Scopeball][DBG] prefetch-child-verify-error", {
              callkey: `${c.chain_id}__${c.to}__${c.selector}`,
              error:
                verifyErr instanceof Error
                  ? verifyErr.message
                  : String(verifyErr),
            });
          }
        }
      }
    } catch (err) {
      console.warn("[Scopeball][DBG] prefetch-error", {
        chainId: args.chainId,
        to: args.to,
        selector,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  let result: DeclarativeRouteRequestResult;
  try {
    result = await declarativeRouteRequest(routeInput);
  } catch (err) {
    console.error("[Scopeball][DBG] route-request-error", {
      chainId: args.chainId,
      to: args.to,
      selector,
      kind: err instanceof EngineError ? err.kind : "unknown",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
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
      if (err.kind === "decode_failed" || err.kind === "invalid_calldata") {
        // WASM could not decode the calldata against the bundle ABI.
        return { kind: "fault", reason: "decode_failed", cause: err };
      }
      return { kind: "fault", reason: "engine_error", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  // Phase 7E — token metadata enrichment runs after the mapper produces
  // the skeleton envelopes. Failures here are absorbed (`enrichAssetRef`
  // catches them per-token) so a flaky registry never escalates into a
  // route fault.
  let enrichedEnvelopes = result.envelopes;
  if (result.envelopes.length > 0) {
    const tokenClient =
      args.options?.tokenClient ?? defaultTokenRegistryClient();
    enrichedEnvelopes = await enrichEnvelopeAssets(
      result.envelopes,
      args.chainId,
      tokenClient,
    );
  }

  return {
    kind: "hit",
    value: {
      envelopes: enrichedEnvelopes,
      decoderId: result.decoder_id,
      bundleId: adapter.bundleId,
      source: resolution.source,
    },
  };
}

/**
 * Phase 4B — v3 outcome shape. Mirrors [`DeclarativeRouteOutcome`] but the
 * hit payload carries the new `Action[]` (PDF FSM `Vec<Action>`) instead of
 * the flat envelope list. `decoder_id` is empty under the Phase 4B stub —
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
