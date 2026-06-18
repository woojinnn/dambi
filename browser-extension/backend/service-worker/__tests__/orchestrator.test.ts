import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RequestType,
  isUntypedSignature,
  type Message,
  type VenueOrderPayload,
} from "@lib/types";

const OWNER = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";

const mocks = vi.hoisted(() => {
  class MockEngineError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  }
  class MockTypedDataRouteError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }

  const sessionStore = new Map<string, unknown>();
  const localStore = new Map<string, unknown>();
  const runtimeMessageListeners: Array<(message: unknown) => void> = [];
  const windowRemovedListeners: Array<(windowId: number) => void> = [];

  const readStore = async (
    store: Map<string, unknown>,
    keys?: string | string[] | Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    if (keys === undefined || keys === null)
      return Object.fromEntries(store.entries());
    const out: Record<string, unknown> = {};
    if (typeof keys === "string") {
      out[keys] = store.get(keys);
      return out;
    }
    if (Array.isArray(keys)) {
      for (const key of keys) out[key] = store.get(key);
      return out;
    }
    for (const [key, fallback] of Object.entries(keys)) {
      out[key] = store.has(key) ? store.get(key) : fallback;
    }
    return out;
  };

  return {
    MockEngineError,
    MockTypedDataRouteError,
    sessionStore,
    localStore,
    runtimeMessageListeners,
    windowRemovedListeners,
    ensureDefaultPoliciesInstalled: vi.fn(async () => undefined),
    pendingPut: vi.fn(async () => undefined),
    pendingDelete: vi.fn(async () => undefined),
    auditAppend: vi.fn(async () => undefined),
    // Phase 1 / P2 — v2 ActionBody verdict path. The v3 route defaults to a
    // miss so every EXISTING test fails closed; the v2 plan/dispatch/evaluate
    // mocks are only exercised by the dedicated v2-path cases that override
    // the v3 route to a hit.
    planActionRpcV2: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => [],
    ),
    evaluateActionV2: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({ kind: "pass" }),
    ),
    dispatchCallsV2: vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({}),
    ),
    resolveBundlesForWallet: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => [
      {
        id: "high-slippage-warning",
        policy: "forbid(...);",
        manifest: { id: "high-slippage-warning", schema_version: 2 },
      },
    ]),
    // WP7: controllable render-fault list for the venue deny-closed path; the
    // resolve mock factory threads it into resolveBundlesForWalletWithFaults.
    // Reset in beforeEach. A {severity:"deny"} entry must make a venue order
    // deny-close (a DENY policy that could not be rendered fail-opens if dropped).
    venueRenderFaults: [] as Array<{ defId: string; severity: string | undefined }>,
    tryDeclarativeRouteV3: vi.fn<
      (...args: unknown[]) => Promise<unknown>
    >(async () => ({
      kind: "miss",
      reason: "bundle_not_installed",
    })),
    // Typed-data signature router. Default `null` (no published manifest) so
    // existing typed-sig cases fail closed; the routed-hit case overrides it.
    routeTypedSignaturePayload: vi.fn<
      (...args: unknown[]) => Promise<unknown>
    >(async () => null),
    browser: {
      storage: {
        session: {
          get: vi.fn((keys?: string | string[] | Record<string, unknown>) =>
            readStore(sessionStore, keys),
          ),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(entries))
              sessionStore.set(key, value);
          }),
        },
        local: {
          get: vi.fn((keys?: string | string[] | Record<string, unknown>) =>
            readStore(localStore, keys),
          ),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(entries))
              localStore.set(key, value);
          }),
        },
      },
      windows: {
        create: vi.fn(async () => ({ id: 99 })),
        remove: vi.fn(async () => undefined),
        onRemoved: {
          addListener: vi.fn((listener: (windowId: number) => void) => {
            windowRemovedListeners.push(listener);
          }),
          removeListener: vi.fn((listener: (windowId: number) => void) => {
            const index = windowRemovedListeners.indexOf(listener);
            if (index >= 0) windowRemovedListeners.splice(index, 1);
          }),
        },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://dambi/${path}`),
        sendMessage: vi.fn(async () => undefined),
        onMessage: {
          addListener: vi.fn((listener: (message: unknown) => void) => {
            runtimeMessageListeners.push(listener);
          }),
          removeListener: vi.fn((listener: (message: unknown) => void) => {
            const index = runtimeMessageListeners.indexOf(listener);
            if (index >= 0) runtimeMessageListeners.splice(index, 1);
          }),
        },
      },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: mocks.browser }));
vi.mock("../policies-loader", () => ({
  ensureDefaultPoliciesInstalled: mocks.ensureDefaultPoliciesInstalled,
}));
vi.mock("../storage", () => ({
  pendingPut: mocks.pendingPut,
  pendingDelete: mocks.pendingDelete,
  auditAppend: mocks.auditAppend,
}));
vi.mock("../wasm-bridge", () => ({
  EngineError: mocks.MockEngineError,
  planActionRpcV2: mocks.planActionRpcV2,
  evaluateActionV2: mocks.evaluateActionV2,
}));
vi.mock("../policy-store/resolve", () => ({
  resolveBundlesForWallet: mocks.resolveBundlesForWallet,
  // Delegates to the same bundle mock so existing venue tests are unchanged;
  // `venueRenderFaults` (default []) lets a test inject a faulted DENY policy.
  resolveBundlesForWalletWithFaults: async (...args: unknown[]) => ({
    bundles: await (
      mocks.resolveBundlesForWallet as (...a: unknown[]) => Promise<unknown[]>
    )(...args),
    renderFaults: mocks.venueRenderFaults,
  }),
  isWalletRegistered: vi.fn(async () => true),
  defRefForPolicyId: vi.fn(async () => null),
  // 픽스처 번들은 trigger 인덱스가 없으므로(=항상 포함) 필터는 패스스루로 충분.
  filterForAction: (bundles: unknown[]) => bundles,
  collectActionMetas: () => [{}],
}));
vi.mock("../dashboard/current-user", () => ({
  getCurrentUserId: vi.fn(async () => "u-test"),
}));
vi.mock("../policy-rpc", () => ({
  dispatchCallsV2: mocks.dispatchCallsV2,
  // Pass-through so the orchestrator's audit-log builder behaves like
  // the real `formatAuditMatched` for synthetic diagnostics.
  formatAuditMatched: (verdict: { matched?: { policy_id: string; severity: string; reason?: string }[] }) =>
    (verdict.matched ?? []).map((m) => {
      const base: { id: string; severity: string; reason?: string } = {
        id: m.policy_id,
        severity: m.severity,
      };
      const isSynthetic =
        m.policy_id === "__system__" ||
        m.policy_id.startsWith("__engine::") ||
        m.policy_id.startsWith("__venue::");
      if (isSynthetic && typeof m.reason === "string") {
        base.reason = m.reason;
      }
      return base;
    }),
}));
// Phase 4B / P3 — the orchestrator calls `tryDeclarativeRouteV3` on every
// transaction; we stub it to a fast miss so tests that don't care about the
// v3 decode path don't have to mock the WASM bridge + JIT fetcher. The v1
// `tryDeclarativeRoute` export was removed in the Phase 1/P3 v1 cutover.
vi.mock("../adapter-loader/declarative-route", () => ({
  tryDeclarativeRouteV3: mocks.tryDeclarativeRouteV3,
}));
// Typed-data signature router (`typedSignatureLifecycle` calls this). Mocked so
// tests don't pull in the real WASM `declarative_route_typed_data_v3_json` +
// registry `by-typed-data/` fetch.
vi.mock("../sig-routing", () => ({
  routeTypedSignaturePayload: mocks.routeTypedSignaturePayload,
  TypedDataRouteError: mocks.MockTypedDataRouteError,
  normalizeTypedDataPayload: (raw: unknown) => {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  },
  typedDataDomainChainId: (raw: unknown) => {
    let typedData = raw;
    if (typeof typedData === "string") {
      try {
        typedData = JSON.parse(typedData) as unknown;
      } catch {
        return null;
      }
    }
    if (!typedData || typeof typedData !== "object" || Array.isArray(typedData)) {
      return null;
    }
    const chainId = (typedData as { domain?: { chainId?: unknown } }).domain
      ?.chainId;
    if (typeof chainId === "number") {
      return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
    }
    if (typeof chainId === "string") {
      if (/^0x[0-9a-fA-F]+$/.test(chainId)) {
        const parsed = Number.parseInt(chainId, 16);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
      }
      if (/^[0-9]+$/.test(chainId)) {
        const parsed = Number.parseInt(chainId, 10);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
      }
    }
    return null;
  },
}));
// Venue (HL) order enrichment collectors hit the HL info API; stub them inert so
// the venue lifecycle test stays network-free. `resolve-hl-master` is NOT mocked
// (it reads `payload.wallet_id` / storage — no network), so the master-resolution
// wiring is exercised for real.
vi.mock("../venue/collect-hl-leverage", () => ({
  collectHlLeverage: vi.fn(async () => ({})),
  noteHlLeverageUpdate: vi.fn(() => undefined),
}));
vi.mock("../venue/collect-order-enrichment", () => ({
  collectOrderEnrichment: vi.fn(async () => ({})),
}));
vi.mock("../venue/resolve-order-symbol", () => ({
  resolveOrderSymbol: vi.fn(async () => undefined),
}));

import { decideMessage, inferActor } from "../orchestrator";

function txMessage(requestId = "req-1"): Message {
  return {
    requestId,
    data: {
      type: RequestType.TRANSACTION,
      chainId: 1,
      hostname: "app.example",
      transaction: {
        from: OWNER,
        to: ROUTER,
        value: "0xde0b6b3a7640000",
        data: "0x",
      },
    },
  } as Message;
}

function typedSigMessage(
  requestId = "typed-1",
  typedData: unknown = {
    primaryType: "Permit",
    domain: { verifyingContract: ROUTER },
  },
): Message {
  return {
    requestId,
    data: {
      type: RequestType.TYPED_SIGNATURE,
      chainId: 1,
      hostname: "app.example",
      address: OWNER,
      typedData,
    },
  } as Message;
}

function untypedMessage(requestId = "sig-1"): Message {
  return {
    requestId,
    data: {
      type: RequestType.UNTYPED_SIGNATURE,
      hostname: "app.example",
      message: "sign this opaque payload",
    },
  };
}

/** A Hyperliquid venue order. When `walletAddress` is set it rides on the
 *  payload as `wallet_id` (what the fetch-hook stamps from `eth_accounts`), so
 *  `resolveHlMaster` can recover the master for per-wallet policy resolution. */
function venueMessage(requestId: string, walletAddress?: string): Message {
  const data: VenueOrderPayload = {
    type: RequestType.VENUE_ORDER,
    chainId: 0,
    hostname: "app.hyperliquid.xyz",
    venue: "hyperliquid",
    endpoint: "https://api-ui.hyperliquid.xyz/exchange",
    hlAction: {
      kind: "order",
      order: { a: 0, b: false, p: "60000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } },
    },
  };
  if (walletAddress) data.wallet_id = { address: walletAddress, chains: [] };
  return { requestId, data };
}

function approve(requestId: string, ok: boolean): void {
  for (const listener of [...mocks.runtimeMessageListeners]) {
    listener({ type: "dambi:verdict-decision", requestId, ok });
  }
}

describe("inferActor — per-actor lock key (venue coverage)", () => {
  it("returns the tx `from` for a transaction", () => {
    expect(inferActor(txMessage())).toBe(OWNER);
  });

  it("returns the typed-signature signer for a typed signature", () => {
    expect(inferActor(typedSigMessage())).toBe(OWNER);
  });

  it("does not actor-lock untyped signatures", () => {
    expect(inferActor(untypedMessage())).toBeUndefined();
  });

  it("returns the trusted wallet_id for a venue order (shares the lock with that wallet's tx/sig)", () => {
    const WALLET = "0x000000000000000000000000000000000000a01c";
    expect(inferActor(venueMessage("v1", WALLET))).toBe(WALLET);
  });

  it("falls back to the page origin when a venue order has no wallet_id (same-page orders still serialize)", () => {
    // Previously returned undefined → NO lock → concurrent same-page orders
    // raced (stacked modals / clobbered read-evaluate-reserve rows).
    expect(inferActor(venueMessage("v2"))).toBe("venue:app.hyperliquid.xyz");
  });

  it("IGNORES a page-supplied vaultAddress for the lock key", () => {
    const m = venueMessage("v3");
    (m.data as VenueOrderPayload).vaultAddress =
      "0x000000000000000000000000000000000000dead";
    expect(inferActor(m)).toBe("venue:app.hyperliquid.xyz");
  });
});

/**
 * Drive a request that is expected to fail closed (a warn verdict that opens
 * the verdict window and AWAITS the user's choice). We must NOT `await
 * decideMessage` before approving — that would deadlock and (because the
 * per-actor lock is still held) cascade into later same-actor cases.
 */
async function decideAndApprove(message: Message, ok: boolean) {
  const callsBefore = mocks.browser.windows.create.mock.calls.length;
  const result = decideMessage(message, { onAwaitingUser: vi.fn() });
  await vi.waitFor(() =>
    expect(mocks.browser.windows.create.mock.calls.length).toBe(
      callsBefore + 1,
    ),
  );
  approve(message.requestId, ok);
  return result;
}

describe("orchestrator", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.venueRenderFaults = [];
    mocks.sessionStore.clear();
    mocks.localStore.clear();
    mocks.runtimeMessageListeners.length = 0;
    mocks.windowRemovedListeners.length = 0;
    // v3 route default: miss → fail-closed path. The v2 plan/dispatch/evaluate
    // mocks resolve to inert pass-shaped values; only the v2-path cases below
    // override the v3 route to a hit.
    mocks.tryDeclarativeRouteV3.mockResolvedValue({
      kind: "miss",
      reason: "bundle_not_installed",
    });
    mocks.planActionRpcV2.mockResolvedValue([]);
    mocks.dispatchCallsV2.mockResolvedValue({});
    mocks.evaluateActionV2.mockResolvedValue({ kind: "pass" });
    mocks.resolveBundlesForWallet.mockResolvedValue([
      {
        id: "high-slippage-warning",
        policy: "forbid(...);",
        manifest: { id: "high-slippage-warning", schema_version: 2 },
      },
    ]);
    // Typed-sig router default: miss → fail-closed warn. The typed-sig hit
    // case overrides it.
    mocks.routeTypedSignaturePayload.mockResolvedValue(null);
  });

  // ── Phase 1 / P2 — v2 ActionBody verdict path ───────────────────────
  // When the v3 route HITS with a real (non-`Unknown`) ActionBody, the
  // stateless v2 pipeline (planActionRpcV2 → dispatchCallsV2 →
  // evaluateActionV2) drives the verdict (verdictSource="declarative-v2").
  // A v3 miss/fault, an all-`Unknown` hit, no v2 bundle, or a plan/dispatch
  // throw fails closed (verdictSource="fail_closed", warn + user-proceed).

  // One real swap Action: `{ meta, body }` where `body.domain !== "unknown"`.
  const v3SwapAction = {
    meta: {
      submitted_at: { unix: 1_738_000_000 },
      submitter: OWNER,
      nature: { kind: "onchain_tx" },
    },
    body: { domain: "amm", swap: { recipient: OWNER } },
  };
  const v3HitOutcome = {
    kind: "hit" as const,
    value: {
      actions: [v3SwapAction],
      decoderId: "registry-v2.uniswap/v3/exactInputSingle",
    },
  };

  it("p2: v3 hit with a real ActionBody drives the v2 verdict (verdictSource=declarative-v2)", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce(v3HitOutcome);
    const planned = [
      {
        manifest_id: "large-swap-usd-warning",
        call_id: "large-swap-usd-warning::total-input-usd",
        method: "oracle.usd_value",
        params: {},
        outputs: [],
        optional: false,
      },
    ];
    mocks.planActionRpcV2.mockResolvedValueOnce(planned);
    mocks.dispatchCallsV2.mockResolvedValueOnce({
      "large-swap-usd-warning::total-input-usd": { usd: "3500.1200" },
    });
    // Warn is the realistic v2 verdict — BOTH shipped default v2 policies are
    // `@severity("warn")`. The user must then approve via the verdict window.
    mocks.evaluateActionV2.mockResolvedValueOnce({
      kind: "warn",
      matched: [
        {
          policy_id: "large-input",
          reason: "large USD input",
          severity: "warn",
          origin: "action",
        },
      ],
    });

    const decided = await decideAndApprove(txMessage("v2-hit-1"), true);

    expect(decided.ok).toBe(true);
    expect(decided.verdict.kind).toBe("warn");
    // v2 pipeline drove the decision.
    expect(mocks.planActionRpcV2).toHaveBeenCalledOnce();
    expect(mocks.dispatchCallsV2).toHaveBeenCalledOnce();
    expect(mocks.evaluateActionV2).toHaveBeenCalledOnce();
    // The plan + evaluate calls split `action=a.body` / `meta=a.meta` and use
    // the CAIP-2 chain id.
    const planArgs = mocks.planActionRpcV2.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(planArgs.action).toEqual(v3SwapAction.body);
    expect(planArgs.meta).toEqual(v3SwapAction.meta);
    expect((planArgs.tx as { chain_id: string }).chain_id).toBe("eip155:1");
    // evaluate receives the per-action results map verbatim + the bundles.
    const evalArgs = mocks.evaluateActionV2.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(evalArgs.results).toEqual({
      "large-swap-usd-warning::total-input-usd": { usd: "3500.1200" },
    });
    expect((evalArgs.bundles as unknown[]).length).toBe(1);
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "declarative-v2" }),
    );
  });

  it("p2: a v2 fail verdict is honoured, not treated as a fail-close", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce(v3HitOutcome);
    mocks.planActionRpcV2.mockResolvedValueOnce([]);
    mocks.dispatchCallsV2.mockResolvedValueOnce({});
    mocks.evaluateActionV2.mockResolvedValueOnce({
      kind: "fail",
      matched: [
        {
          policy_id: "__system__",
          reason: "required policy-rpc result missing",
          severity: "deny",
          origin: "tx",
        },
      ],
    });

    const result = await decideMessage(txMessage("v2-fail-1"));

    // Fail verdicts surface as a non-ok decision via the v2 path.
    expect(result.verdict.kind).toBe("fail");
    expect(result.ok).toBe(false);
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "declarative-v2" }),
    );
  });

  it("WASM-1: a sibling leg's plan throw does NOT demote an already-computed FAIL to a warn", async () => {
    // Two real top-level actions. Leg 0 evaluates to a deny `fail`; leg 1's
    // planActionRpcV2 throws (a flaky WASM/RPC fault). The fault must NOT
    // discard leg 0's computed Fail — deny-overrides means the tx stays `fail`,
    // never silently downgraded to an approvable warn. (Before the fix the
    // per-leg `return undefined` dropped the whole tx into the warn tail.)
    const legA = {
      meta: v3SwapAction.meta,
      body: { domain: "amm", swap: { recipient: OWNER } },
    };
    const legB = {
      meta: v3SwapAction.meta,
      body: { domain: "amm", swap: { recipient: ROUTER } },
    };
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "hit" as const,
      value: { actions: [legA, legB], decoderId: "registry-v2.test/multi-leg" },
    });
    // Leg 0: no planned calls → evaluates to a deny fail. Leg 1: plan throws.
    mocks.planActionRpcV2
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("plan_failed: flaky leg"));
    mocks.evaluateActionV2.mockResolvedValueOnce({
      kind: "fail",
      matched: [
        {
          policy_id: "deny-policy",
          reason: "blocked by policy",
          severity: "deny",
          origin: "action",
        },
      ],
    });

    const result = await decideMessage(txMessage("wasm1-fail-survives"));

    // The computed FAIL from leg 0 survives leg 1's fault (was "warn" pre-fix).
    expect(result.verdict.kind).toBe("fail");
    expect(result.ok).toBe(false);
    expect(mocks.evaluateActionV2).toHaveBeenCalledOnce();
  });

  // ── Phase A — multicall per-child fan-out (evaluateBodyTree) ─────────────
  // A UR `execute` decodes to ONE `Multicall` Action whose `body.actions` are
  // full child ActionBodies. The SW must evaluate the outer batch AND re-enter
  // the v2 pipeline for EACH child (parent meta shared), so per-child-detail
  // (Inner-scoped) policies see the wrapped swap/transfer. Aggregation is
  // deny-overrides across all positions.

  const swapChild = { domain: "amm", swap: { recipient: OWNER, slippageBp: 50 } };
  const transferChild = {
    domain: "token",
    token: { action: "erc20_transfer", erc20_transfer: { recipient: ROUTER } },
  };
  const multicallAction = {
    meta: {
      submitted_at: { unix: 1_738_000_000 },
      submitter: OWNER,
      nature: { kind: "onchain_tx" },
    },
    body: { domain: "multicall", actions: [swapChild, transferChild] },
  };

  it("phaseA: a multicall fans out — outer batch + each inner child evaluated", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "hit",
      value: {
        actions: [multicallAction],
        decoderId: "registry-v2.uniswap/universal-router/execute",
      },
    });
    // All positions pass (beforeEach default) → decideMessage resolves w/o a window.

    const { ok, verdict } = await decideMessage(txMessage("v2-multicall-1"), {
      onAwaitingUser: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(verdict.kind).toBe("pass");
    // THE fan-out: the outer multicall + BOTH children are each evaluated.
    expect(mocks.evaluateActionV2).toHaveBeenCalledTimes(3);
    expect(mocks.planActionRpcV2).toHaveBeenCalledTimes(3);
    const evaluatedBodies = mocks.evaluateActionV2.mock.calls.map(
      (c) => (c[0] as { action: unknown }).action,
    );
    expect(evaluatedBodies).toEqual([
      multicallAction.body, // outer batch (Outer-scoped policies fire here)
      swapChild, //            inner child #1 (Inner-scoped policies fire here)
      transferChild, //        inner child #2
    ]);
    // Children share the parent meta (the decoded multicall has no per-child meta).
    const metas = mocks.evaluateActionV2.mock.calls.map(
      (c) => (c[0] as { meta: unknown }).meta,
    );
    expect(metas).toEqual([
      multicallAction.meta,
      multicallAction.meta,
      multicallAction.meta,
    ]);
  });

  it("phaseA: a failing inner child blocks the whole multicall (deny-overrides)", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "hit",
      value: {
        actions: [multicallAction],
        decoderId: "registry-v2.uniswap/universal-router/execute",
      },
    });
    // Outer batch + transfer child pass; the inner SWAP child trips a deny.
    mocks.evaluateActionV2.mockImplementation(async (input: unknown) => {
      const body = (input as { action: { domain?: string } }).action;
      if (body.domain === "amm") {
        return {
          kind: "fail",
          matched: [
            {
              policy_id: "swap-recipient-deny",
              reason: "recipient not allow-listed",
              severity: "deny",
              origin: "action",
            },
          ],
        };
      }
      return { kind: "pass" };
    });

    const result = await decideMessage(txMessage("v2-multicall-fail-1"));

    expect(result.ok).toBe(false);
    expect(result.verdict.kind).toBe("fail");
    // All three positions were evaluated; the child's fail wins by deny-overrides.
    expect(mocks.evaluateActionV2).toHaveBeenCalledTimes(3);
    expect(result.verdict.matched?.[0]?.policy_id).toBe("swap-recipient-deny");
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "declarative-v2" }),
    );
  });

  it("phaseA/N2-N3: an unknown inner child WARN-closes the batch (not pass), siblings still evaluate", async () => {
    const unknownChild = { domain: "unknown", target: ROUTER, calldata: "0x" };
    const mixed = {
      meta: multicallAction.meta,
      body: { domain: "multicall", actions: [swapChild, unknownChild] },
    };
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "hit",
      value: {
        actions: [mixed],
        decoderId: "registry-v2.uniswap/universal-router/execute",
      },
    });

    // The unknown leg now contributes a `__engine::partial_decode` warn instead
    // of vanishing, so the batch warn-closes and opens the modal — the user can
    // still Trust-and-proceed, but a partially-decoded batch can no longer PASS
    // silently on its legible siblings alone (N2/N3).
    const { ok, verdict } = await decideAndApprove(
      txMessage("v2-multicall-unknown-1"),
      true,
    );

    expect(verdict.kind).toBe("warn");
    expect(ok).toBe(true);
    // Outer batch + the swap child still call the v2 pipeline; the unknown child
    // does NOT (it contributes a synthetic warn), so still exactly 2 evaluations.
    expect(mocks.evaluateActionV2).toHaveBeenCalledTimes(2);
    const evaluatedBodies = mocks.evaluateActionV2.mock.calls.map(
      (c) => (c[0] as { action: unknown }).action,
    );
    expect(evaluatedBodies).toEqual([mixed.body, swapChild]);
  });

  it("phaseA/N3: [deny-leg, unknown-leg] still FAILS — deny outranks the partial-decode warn", async () => {
    const denyChild = { domain: "amm", swap: { recipient: ROUTER } };
    const unknownChild = { domain: "unknown", target: ROUTER, calldata: "0x" };
    const mixed = {
      meta: multicallAction.meta,
      body: { domain: "multicall", actions: [denyChild, unknownChild] },
    };
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "hit",
      value: { actions: [mixed], decoderId: "registry-v2.test/deny-plus-unknown" },
    });
    mocks.evaluateActionV2.mockImplementation(async (input: unknown) => {
      const body = (input as { action: { domain?: string } }).action;
      if (body.domain === "amm") {
        return {
          kind: "fail",
          matched: [
            {
              policy_id: "swap-deny",
              reason: "recipient not allow-listed",
              severity: "deny",
              origin: "action",
            },
          ],
        };
      }
      return { kind: "pass" }; // the outer multicall batch position
    });

    const result = await decideMessage(txMessage("v2-deny-plus-unknown"));

    expect(result.ok).toBe(false);
    expect(result.verdict.kind).toBe("fail");
    expect(result.verdict.matched?.[0]?.policy_id).toBe("swap-deny");
  });

  // ── Phase 1 / P3 — FAIL-CLOSED tail ──────────────────────────────────
  // Every case the deleted legacy declarative/static path used to
  // catch now emits the `__engine::no_decoder` warn verdict, which requires
  // the user to explicitly proceed. The v2 plan/evaluate path never runs.

  it("p3: a v3 hit with only an Unknown ActionBody fails closed", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "hit",
      value: {
        actions: [
          {
            meta: { submitter: OWNER },
            body: { domain: "unknown", target: ROUTER, calldata: "0x" },
          },
        ],
        decoderId: "",
      },
    });

    const result = await decideAndApprove(txMessage("p3-unknown-1"), true);

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    // Unknown body → v2 skipped entirely.
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictSource: "fail_closed",
        matchedPolicies: [
          expect.objectContaining({ id: "__engine::no_decoder" }),
        ],
      }),
    );
  });

  it("p3: a v3 miss fails closed (verdictSource=fail_closed)", async () => {
    // v3 route default (beforeEach) is a miss → fail-closed.
    const result = await decideAndApprove(txMessage("p3-miss-1"), true);

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("p3: a user-cancelled fail-close yields a non-ok decision", async () => {
    const result = await decideAndApprove(txMessage("p3-cancel-1"), false);
    expect(result.ok).toBe(false);
    expect(result.verdict.kind).toBe("warn");
  });

  it("p3: a v3 fault fails closed (verdictSource=fail_closed)", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce({
      kind: "fault",
      reason: "engine_error",
      cause: new mocks.MockEngineError("engine_error", "v3 decode blew up"),
    });

    const result = await decideAndApprove(txMessage("p3-fault-1"), true);

    expect(result.ok).toBe(true);
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("p3: a transaction hard timeout warn-closes and requires user approval", async () => {
    vi.useFakeTimers();
    mocks.tryDeclarativeRouteV3.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    const pending = decideMessage(txMessage("p3-tx-timeout-1"), {
      onAwaitingUser: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await Promise.resolve();

    expect(mocks.browser.windows.create).toHaveBeenCalledTimes(1);
    approve("p3-tx-timeout-1", true);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    expect(result.verdict.matched?.[0]).toMatchObject({
      policy_id: "__engine::timeout",
      severity: "warn",
    });
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("p3: a planActionRpcV2 throw fails closed", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce(v3HitOutcome);
    mocks.planActionRpcV2.mockRejectedValueOnce(
      new mocks.MockEngineError("plan_failed", "cannot lower action"),
    );

    const result = await decideAndApprove(txMessage("p3-plan-throw-1"), true);

    expect(result.ok).toBe(true);
    expect(mocks.planActionRpcV2).toHaveBeenCalledOnce();
    // evaluate never ran; the lifecycle fell through to the fail-closed tail.
    expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("p3: an evaluate EngineError surfaces its kind + message in the fail-closed warn", async () => {
    // 깨진 정책(예: decimal("3"))의 install_failed가 일반 no_decoder로 뭉개지면
    // 사용자가 원인을 알 수 없다 — kind/message가 그대로 verdict에 실려야 한다.
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce(v3HitOutcome);
    mocks.evaluateActionV2.mockRejectedValueOnce(
      new mocks.MockEngineError(
        "install_failed",
        'Failed to parse as a decimal value: "3"',
      ),
    );

    const result = await decideAndApprove(txMessage("p3-eval-engineerr-1"), true);

    expect(result.ok).toBe(true); // 여전히 승인 가능한 warn (fail-closed)
    expect(result.verdict.kind).toBe("warn");
    expect(result.verdict.matched?.[0]).toEqual(
      expect.objectContaining({
        policy_id: "__engine::install_failed",
        reason: 'Failed to parse as a decimal value: "3"',
      }),
    );
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("p3: a v3 hit but no v2 bundles loaded fails closed", async () => {
    mocks.tryDeclarativeRouteV3.mockResolvedValueOnce(v3HitOutcome);
    mocks.resolveBundlesForWallet.mockResolvedValueOnce([]);

    const result = await decideAndApprove(txMessage("p3-nobundles-1"), true);

    expect(result.ok).toBe(true);
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("p3: a typed signature with no published manifest fails closed (route miss)", async () => {
    // `typedSignatureLifecycle` routes through the by-typed-data index; a miss
    // (router → null, the default) warn-closes (no decoder, user-proceed).
    const result = await decideAndApprove(typedSigMessage("p3-typed-1"), true);

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    // The typed-sig path uses `routeTypedSignaturePayload`, NOT the tx v3 route;
    // a miss never reaches the v2 plan/dispatch/evaluate loop.
    expect(mocks.tryDeclarativeRouteV3).not.toHaveBeenCalled();
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictSource: "fail_closed",
        matchedPolicies: [
          expect.objectContaining({ id: "__engine::no_decoder" }),
        ],
      }),
    );
  });

  it("branch confusion: typed-signature messages never fall through to the transaction route, even with tx-shaped extras", async () => {
    const message = typedSigMessage("typed-with-tx-extra");
    (message.data as unknown as { transaction: unknown }).transaction = {
      from: OWNER,
      to: ROUTER,
      data: "0x",
    };

    const result = await decideAndApprove(message, true);

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    expect(mocks.routeTypedSignaturePayload).toHaveBeenCalledOnce();
    expect(mocks.tryDeclarativeRouteV3).not.toHaveBeenCalled();
  });

  it("p3: a typed signature route throw fails closed (route fault)", async () => {
    mocks.routeTypedSignaturePayload.mockRejectedValueOnce(
      new Error("typed route exploded"),
    );

    const result = await decideAndApprove(typedSigMessage("p3-typed-fault-1"), true);

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    expect(mocks.tryDeclarativeRouteV3).not.toHaveBeenCalled();
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictSource: "fail_closed",
        declarativeV3: expect.objectContaining({
          outcome: "fault",
          reason: "typed_sig_route_threw",
        }),
      }),
    );
  });

  it("preserves typed-data route fault reasons in declarativeV3 audit metadata", async () => {
    mocks.routeTypedSignaturePayload.mockRejectedValueOnce(
      new mocks.MockTypedDataRouteError("typed_sig_install_verify_failed"),
    );

    const result = await decideAndApprove(
      typedSigMessage("p3-typed-install-fault-1"),
      true,
    );

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictSource: "fail_closed",
        declarativeV3: expect.objectContaining({
          outcome: "fault",
          reason: "typed_sig_install_verify_failed",
        }),
      }),
    );
  });

  // ── Venue (HL) order — per-wallet policy resolution ──────────────────────
  // HL `/exchange` bodies are agent-key submissions and do not carry the master
  // wallet directly. The fetch-hook stamps the trusted connected account onto
  // `payload.wallet_id`; the venue lifecycle uses that master for policy-set
  // selection and for the v2 eval actor (`tx.from` / `meta.submitter`), so
  // per-wallet policy bindings and principal-scoped Cedar checks evaluate
  // against the same user identity.
  describe("venue order resolves the policy set against the connected master", () => {
    const MASTER = "0x676fa5b94067c2be14bc025df6c5c80dedf49a54";
    const SUBMITTER_SENTINEL = "0x000000000000000000000000000000000000a01c";

    it("keys the policy set by the wallet_id master (not the sentinel)", async () => {
      await decideMessage(venueMessage("venue-master-1", MASTER), { onAwaitingUser: vi.fn() });
      expect(mocks.resolveBundlesForWallet).toHaveBeenCalledWith("u-test", MASTER);
    });

    it("falls back to the submitter sentinel when no master is resolvable", async () => {
      await decideMessage(venueMessage("venue-nomaster-1"), { onAwaitingUser: vi.fn() });
      expect(mocks.resolveBundlesForWallet).toHaveBeenCalledWith("u-test", SUBMITTER_SENTINEL);
    });

    it("uses the wallet_id master as the v2 eval principal and meta submitter", async () => {
      await decideMessage(venueMessage("venue-master-principal-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });

      const planInput = mocks.planActionRpcV2.mock.calls[0][0] as {
        tx: { from: string };
        meta: { submitter: string };
      };
      expect(planInput.tx.from).toBe(MASTER);
      expect(planInput.meta.submitter).toBe(MASTER);

      const evalInput = mocks.evaluateActionV2.mock.calls[0][0] as {
        tx: { from: string };
        meta: { submitter: string };
      };
      expect(evalInput.tx.from).toBe(MASTER);
      expect(evalInput.meta.submitter).toBe(MASTER);
    });

    it("keeps the sentinel eval actor when no master is resolvable", async () => {
      await decideMessage(venueMessage("venue-nomaster-principal-1"), {
        onAwaitingUser: vi.fn(),
      });

      const evalInput = mocks.evaluateActionV2.mock.calls[0][0] as {
        tx: { from: string };
        meta: { submitter: string };
      };
      expect(evalInput.tx.from).toBe(SUBMITTER_SENTINEL);
      expect(evalInput.meta.submitter).toBe(SUBMITTER_SENTINEL);
    });

    it("DENY-CLOSES hl_unknown before policy resolution, even with no bundle installed", async () => {
      const message = venueMessage("venue-hl-unknown-1", MASTER);
      (message.data as VenueOrderPayload).hlAction = {
        kind: "unknown",
        actionType: "convertToMultiSigUser",
      };

      const result = await decideMessage(message, { onAwaitingUser: vi.fn() });

      expect(result.ok).toBe(false);
      expect(result.verdict.kind).toBe("fail");
      expect(result.verdict.matched?.[0]).toMatchObject({
        policy_id: "__venue::deny_closed",
        severity: "deny",
      });
      expect(result.verdict.matched?.[0]?.reason).toContain(
        "unknown HL action: convertToMultiSigUser",
      );
      expect(mocks.resolveBundlesForWallet).not.toHaveBeenCalled();
      expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
      expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    });

    it("branch confusion: venue messages never route as typed signatures, even with typed-signature-shaped extras", async () => {
      const message = venueMessage("venue-with-typed-extra", MASTER);
      (message.data as unknown as { typedData: unknown; address: string }).typedData = {
        primaryType: "Permit",
        domain: { verifyingContract: ROUTER, chainId: 1 },
      };
      (message.data as unknown as { address: string }).address = OWNER;

      await decideMessage(message, { onAwaitingUser: vi.fn() });

      expect(mocks.routeTypedSignaturePayload).not.toHaveBeenCalled();
      expect(mocks.tryDeclarativeRouteV3).not.toHaveBeenCalled();
      expect(mocks.planActionRpcV2).toHaveBeenCalled();
    });

    it("DENY-CLOSES when a DENY policy fails to render (must not silently drop → fail-open)", async () => {
      // A deny-closed venue order whose DENY policy threw during render must be
      // BLOCKED — dropping it would let an order that should have been denied ride
      // through (the WP7 fail-open).
      mocks.venueRenderFaults = [{ defId: "no-new-short-deny", severity: "deny" }];
      const result = await decideMessage(venueMessage("venue-deny-fault-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });
      expect(result.verdict.kind).toBe("fail");
      expect(result.ok).toBe(false);
      // The order must be blocked BEFORE the engine evaluates (deny-close).
      expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    });

    it("does NOT deny-close when only a WARN policy fails to render", async () => {
      // A warn fault must not hard-block the order (only a faulted DENY does);
      // the remaining bundles evaluate normally (mock → pass).
      mocks.venueRenderFaults = [{ defId: "some-warn", severity: "warn" }];
      const result = await decideMessage(venueMessage("venue-warn-fault-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });
      expect(result.verdict.kind).not.toBe("fail");
    });

    // SW prereq for HL server-state methods (`perp.*`): the server loads
    // wallet state by the dispatch ctx identity. With a trusted `wallet_id`, the
    // venue eval `tx.from` is the master and the explicit `walletAddress`
    // override carries the same identity for the authenticated /evaluate path.
    const plannedServerCall = {
      manifest_id: "order-daily-loss-limit-warn",
      call_id: "order-daily-loss-limit-warn::equity-drawdown",
      method: "perp.equity_drawdown_bps",
      params: { chain_id: "hl-mainnet" },
      outputs: [],
      optional: true,
    };

    it("passes the resolved master as walletAddress in the dispatch ctx", async () => {
      mocks.planActionRpcV2.mockResolvedValueOnce([plannedServerCall]);
      await decideMessage(venueMessage("venue-dispatch-master-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });
      expect(mocks.dispatchCallsV2).toHaveBeenCalledTimes(1);
      const ctx = mocks.dispatchCallsV2.mock.calls[0][2] as {
        tx: { from: string };
        walletAddress?: string;
      };
      expect(ctx.walletAddress).toBe(MASTER);
      expect(ctx.tx.from).toBe(MASTER);
    });

    it("omits walletAddress from the dispatch ctx when no master is resolvable", async () => {
      mocks.planActionRpcV2.mockResolvedValueOnce([plannedServerCall]);
      await decideMessage(venueMessage("venue-dispatch-nomaster-1"), {
        onAwaitingUser: vi.fn(),
      });
      expect(mocks.dispatchCallsV2).toHaveBeenCalledTimes(1);
      const ctx = mocks.dispatchCallsV2.mock.calls[0][2] as Record<string, unknown>;
      // Absent key (not `undefined`) — the fallback to tx.from happens inside
      // serveEnrichmentViaEvaluate, and an explicit-undefined would violate
      // exactOptionalPropertyTypes.
      expect("walletAddress" in ctx).toBe(false);
    });

    it("DENY-CLOSES when venue planning throws", async () => {
      mocks.planActionRpcV2.mockRejectedValueOnce(
        new mocks.MockEngineError("plan_failed", "venue plan failed"),
      );

      const result = await decideMessage(venueMessage("venue-plan-fault-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });

      expect(result.ok).toBe(false);
      expect(result.verdict.kind).toBe("fail");
      expect(result.verdict.matched?.[0]).toMatchObject({
        policy_id: "__venue::deny_closed",
        severity: "deny",
      });
      expect(result.verdict.matched?.[0]?.reason).toContain(
        "policy evaluation failed",
      );
      expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    });

    it("DENY-CLOSES when venue policy RPC dispatch throws", async () => {
      mocks.planActionRpcV2.mockResolvedValueOnce([plannedServerCall]);
      mocks.dispatchCallsV2.mockRejectedValueOnce(new Error("venue rpc down"));

      const result = await decideMessage(
        venueMessage("venue-dispatch-fault-1", MASTER),
        { onAwaitingUser: vi.fn() },
      );

      expect(result.ok).toBe(false);
      expect(result.verdict.kind).toBe("fail");
      expect(result.verdict.matched?.[0]?.reason).toContain(
        "policy evaluation failed",
      );
      expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    });

    it("DENY-CLOSES when venue evaluation throws", async () => {
      mocks.evaluateActionV2.mockRejectedValueOnce(
        new mocks.MockEngineError("install_failed", "venue eval failed"),
      );

      const result = await decideMessage(venueMessage("venue-eval-fault-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });

      expect(result.ok).toBe(false);
      expect(result.verdict.kind).toBe("fail");
      expect(result.verdict.matched?.[0]?.reason).toContain(
        "policy evaluation failed",
      );
    });

    it("DENY-CLOSES when a venue order hits the hard timeout", async () => {
      vi.useFakeTimers();
      mocks.resolveBundlesForWallet.mockImplementationOnce(
        () => new Promise(() => undefined),
      );

      const pending = decideMessage(venueMessage("venue-timeout-1", MASTER), {
        onAwaitingUser: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(8_000);
      await Promise.resolve();
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.verdict.kind).toBe("fail");
      expect(result.verdict.matched?.[0]).toMatchObject({
        policy_id: "__venue::deny_closed",
        severity: "deny",
      });
      expect(result.verdict.matched?.[0]?.reason).toContain("engine timeout");
      expect(mocks.auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({ verdictSource: "fail_closed" }),
      );
    });
  });

  // ── Typed-data signature verdict path (typedSignatureLifecycle) ──────────
  // A routed hit decodes the EIP-712 message into an Action[] and drives the
  // SAME v2 pipeline the tx path uses; the only difference is the `tx` context
  // (`from`=signer, `to`=verifyingContract). warn-closed on miss/fault.

  const sigPermitAction = {
    meta: {
      submitted_at: { unix: 1_700_000_000 },
      submitter: OWNER,
      nature: { kind: "offchain_sig" },
    },
    body: {
      domain: "token",
      token: {
        action: "permit2_sign_allowance",
        permit2_sign_allowance: { spender: ROUTER, amount: "1000" },
      },
    },
  };

  it("typed sig: a routed hit drives the v2 verdict (verdictSource=declarative-v2, tx.to=verifyingContract)", async () => {
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [sigPermitAction],
      decoderId: "uniswap/permit2/permitSingle@1.0.0",
    });
    // evaluate → pass (beforeEach default) → decideMessage resolves w/o a window.

    const { ok, verdict } = await decideMessage(typedSigMessage("typed-hit-1"), {
      onAwaitingUser: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(verdict.kind).toBe("pass");
    // v2 pipeline drove the verdict from the SIG decode (not the tx v3 route).
    expect(mocks.tryDeclarativeRouteV3).not.toHaveBeenCalled();
    expect(mocks.planActionRpcV2).toHaveBeenCalledOnce();
    expect(mocks.evaluateActionV2).toHaveBeenCalledOnce();
    // typed-sig `tx` context: from=signer, to=verifyingContract (lowercased),
    // CAIP-2 chain id. `action`/`meta` split from the routed Action.
    const planArgs = mocks.planActionRpcV2.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(planArgs.action).toEqual(sigPermitAction.body);
    expect(planArgs.meta).toEqual(sigPermitAction.meta);
    const tx = planArgs.tx as { chain_id: string; from: string; to: string };
    expect(tx.chain_id).toBe("eip155:1");
    expect(tx.from).toBe(OWNER);
    expect(tx.to).toBe(ROUTER.toLowerCase());
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "declarative-v2" }),
    );
  });

  it("typed sig: JSON-stringified typedData still sets tx.to=verifyingContract", async () => {
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [sigPermitAction],
      decoderId: "uniswap/permit2/permitSingle@1.0.0",
    });

    const typedData = {
      primaryType: "Permit",
      domain: { verifyingContract: ROUTER.toUpperCase() },
    };
    const { ok, verdict } = await decideMessage(
      typedSigMessage("typed-hit-json-string", JSON.stringify(typedData)),
      { onAwaitingUser: vi.fn() },
    );

    expect(ok).toBe(true);
    expect(verdict.kind).toBe("pass");
    const planArgs = mocks.planActionRpcV2.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const tx = planArgs.tx as { chain_id: string; from: string; to: string };
    expect(tx.to).toBe(ROUTER.toLowerCase());
  });

  it("typed sig: routed all-Unknown bodies warn-close even when no policies are installed", async () => {
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [
        {
          meta: sigPermitAction.meta,
          body: { domain: "unknown", action: "unknown" },
        },
      ],
      decoderId: "unknown/typed@1.0.0",
    });

    const decided = await decideAndApprove(
      typedSigMessage("typed-all-unknown-no-policies"),
      true,
    );

    expect(decided.ok).toBe(true);
    expect(decided.verdict.kind).toBe("warn");
    expect(mocks.resolveBundlesForWallet).not.toHaveBeenCalled();
    expect(mocks.planActionRpcV2).not.toHaveBeenCalled();
    expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "fail_closed" }),
    );
  });

  it("typed sig: v2 evaluation uses the signed EIP-712 domain chainId, not the provider chain", async () => {
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [sigPermitAction],
      decoderId: "uniswap/permit2/permitSingle@1.0.0",
    });

    const typedData = {
      primaryType: "Permit",
      domain: {
        chainId: "0x89",
        verifyingContract: ROUTER.toUpperCase(),
      },
    };
    const message = typedSigMessage("typed-domain-chain-1", typedData);
    if (message.data.type !== RequestType.TYPED_SIGNATURE) {
      throw new Error("expected typed signature");
    }
    message.data.chainId = 1;

    const { ok, verdict } = await decideMessage(message, {
      onAwaitingUser: vi.fn(),
    });

    expect(ok).toBe(true);
    expect(verdict.kind).toBe("pass");
    const planArgs = mocks.planActionRpcV2.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const evalArgs = mocks.evaluateActionV2.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect((planArgs.tx as { chain_id: string }).chain_id).toBe("eip155:137");
    expect((evalArgs.tx as { chain_id: string }).chain_id).toBe("eip155:137");
  });

  it("typed sig: a routed hit logs a readable off-chain signature summary to DevTools", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [sigPermitAction],
      decoderId: "uniswap/permit2/permitSingle@1.0.0",
    });

    await decideMessage(typedSigMessage("typed-log-1"), {
      onAwaitingUser: vi.fn(),
    });

    const summary = infoSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.startsWith("[Dambi] off-chain signature parsed"));
    expect(summary).toBeDefined();
    // EIP-712 primaryType + routing decoder + the decoded action tag/fields are
    // all surfaced in one readable line.
    expect(summary).toContain("Permit");
    expect(summary).toContain("uniswap/permit2/permitSingle@1.0.0");
    expect(summary).toContain("permit2_sign_allowance");
    expect(summary).toContain("spender=");
    expect(summary).toContain("amount=1000");
    infoSpy.mockRestore();
  });

  it("typed sig: a routed hit with a warn verdict opens the verdict window", async () => {
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [sigPermitAction],
      decoderId: "uniswap/permit2/permitSingle@1.0.0",
    });
    mocks.evaluateActionV2.mockResolvedValueOnce({
      kind: "warn",
      matched: [
        {
          policy_id: "permit2-unlimited-approve-warning",
          reason: "unlimited Permit2 approval",
          severity: "warn",
          origin: "action",
        },
      ],
    });

    const decided = await decideAndApprove(typedSigMessage("typed-warn-1"), true);

    expect(decided.ok).toBe(true);
    expect(decided.verdict.kind).toBe("warn");
    expect(mocks.evaluateActionV2).toHaveBeenCalledOnce();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ verdictSource: "declarative-v2" }),
    );
  });

  it("typed sig: a v2 plan fault warn-closes and surfaces the engine error", async () => {
    mocks.routeTypedSignaturePayload.mockResolvedValueOnce({
      actions: [sigPermitAction],
      decoderId: "uniswap/permit2/permitSingle@1.0.0",
    });
    mocks.planActionRpcV2.mockRejectedValueOnce(
      new mocks.MockEngineError("plan_failed", "typed plan failed"),
    );

    const result = await decideAndApprove(typedSigMessage("typed-plan-fault-1"), true);

    expect(result.ok).toBe(true);
    expect(result.verdict.kind).toBe("warn");
    expect(result.verdict.matched?.[0]).toMatchObject({
      policy_id: "__engine::plan_failed",
      reason: "typed plan failed",
    });
    expect(mocks.evaluateActionV2).not.toHaveBeenCalled();
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictSource: "fail_closed",
        declarativeV3: expect.objectContaining({
          outcome: "fault",
          reason: "evaluate_failed",
        }),
      }),
    );
  });

  it("does not call the v3 route for untyped signatures", async () => {
    const result = await decideAndApprove(untypedMessage("sig-skip"), true);
    expect(result.ok).toBe(true);
    expect(mocks.tryDeclarativeRouteV3).not.toHaveBeenCalled();
  });

  it("passes a readable untyped signature preview to the confirmation window", async () => {
    const message = untypedMessage("sig-preview");
    if (!isUntypedSignature(message))
      throw new Error("expected untyped signature");
    message.data.message = "EigenLayer Terms of Service\nI agree to the terms.";

    const result = await decideAndApprove(message, true);

    expect(result.ok).toBe(true);
    const lastCreateCall = mocks.browser.windows.create.mock.calls.at(-1) as
      | [{ url: string }]
      | undefined;
    expect(lastCreateCall).toBeDefined();
    const url = new URL(lastCreateCall![0].url);
    const detailsRaw = url.searchParams.get("details");
    expect(detailsRaw).toBeTruthy();
    expect(JSON.parse(detailsRaw!)).toMatchObject({
      kind: "untyped_signature",
      title: "Plain-text signature",
      messagePreview: "EigenLayer Terms of Service\nI agree to the terms.",
    });
  });

  it("lets the user explicitly approve unsupported untyped signatures", async () => {
    const result = await decideAndApprove(untypedMessage(), true);
    await expect(Promise.resolve(result)).resolves.toMatchObject({
      ok: true,
      verdict: { kind: "warn" },
    });
    expect(mocks.auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        verdictSource: "fail_closed",
        matchedPolicies: [
          expect.objectContaining({
            id: "__engine::unsupported_untyped_signature",
          }),
        ],
      }),
    );
  });
});
