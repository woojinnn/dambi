/**
 * HL order-time leverage enrichment (Phase 2): the SW-local `activeAssetData`
 * path that fills the order `account_leverage` injected into the v2 evaluate
 * input.
 *
 * Covers the four modules:
 *   - hl-info-client     — meta (asset_index→coin) + activeAssetData (leverage)
 *                          caches, TTL/set/invalidate, miss→null
 *   - hl-master-store    — per-origin connected-account get/set/clear
 *   - resolve-hl-master  — wallet_id > connected > signed agent > single synced wallet > null
 *   - collect-hl-leverage — hl_order → { idx: leverage }; best-effort `{}` misses
 *
 * `Browser.storage.local` is mocked (the standard `Map`-backed pattern); the HL
 * `/info` fetch is mocked via the client's injectable `fetchImpl`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    browser: {
      runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
      storage: {
        local: {
          get: vi.fn(
            async (key?: string | string[] | Record<string, unknown>) => {
              if (Array.isArray(key)) {
                return Object.fromEntries(
                  key.map((k) => [k, localStore.get(k)]),
                );
              }
              if (typeof key === "string")
                return { [key]: localStore.get(key) };
              if (key && typeof key === "object") {
                return Object.fromEntries(
                  Object.entries(key).map(([k, defaultValue]) => [
                    k,
                    localStore.has(k) ? localStore.get(k) : defaultValue,
                  ]),
                );
              }
              return Object.fromEntries(localStore);
            },
          ),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
        },
      },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: mocks.browser }));

import { HlInfoClient, normalizeRuntimeInfoBase } from "../hl-info-client";
import {
  clearConnectedAccount,
  getConnectedAccount,
  setConnectedAccount,
} from "../hl-master-store";
import { resolveHlMaster } from "../resolve-hl-master";
import { resetHlAgentMasterCacheForTests } from "../hl-agent-master";
import { hlL1ActionHash } from "../hl-signature-recovery";
import {
  collectHlLeverage,
  noteHlLeverageUpdate,
} from "../collect-hl-leverage";
import type { VenueOrderPayload } from "@lib/types";

const HOST = "app.hyperliquid.xyz";
const MASTER = "0x000000000000000000000000000000000000a01c";
const VAULT = "0x1111111111111111111111111111111111111111";
const SYNCED = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";
const UID = "u-hl-test";
const AGENT_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const AGENT = privateKeyToAccount(AGENT_KEY);

const AGENT_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;
const AGENT_TYPES = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A mock `/info` fetch that answers `meta` and `activeAssetData` by body type. */
function infoFetch(opts: {
  universe?: string[];
  leverage?: number | null;
  fail?: boolean;
}): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn(async (_url: unknown, init?: unknown) => {
    if (opts.fail) throw new Error("network down");
    const body = JSON.parse(
      ((init as RequestInit | undefined)?.body as string) ?? "{}",
    ) as { type?: string; user?: string; coin?: string };
    if (body.type === "meta") {
      const names = opts.universe ?? [
        "BTC",
        "ETH",
        "ATOM",
        "MATIC",
        "DYDX",
        "SOL",
      ];
      return jsonResponse({ universe: names.map((name) => ({ name })) });
    }
    if (body.type === "activeAssetData") {
      if (opts.leverage == null)
        return jsonResponse({ user: body.user, coin: body.coin });
      return jsonResponse({
        user: body.user,
        coin: body.coin,
        leverage: { type: "cross", value: opts.leverage },
      });
    }
    return jsonResponse({});
  }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>;
}

/** Minimal payload — only the fields resolve/collect read. */
function payload(over: Partial<VenueOrderPayload> = {}): VenueOrderPayload {
  return { hostname: HOST, ...over } as VenueOrderPayload;
}

function seedSyncedWallets(...addresses: string[]): void {
  mocks.localStore.set("dashboard:current-user-id", UID);
  mocks.localStore.set(`ps2:${UID}:wallets`, {
    schemaVersion: 1,
    byAddress: Object.fromEntries(
      addresses.map((address) => [
        address.toLowerCase(),
        { bindings: {}, packages: {}, packageEnabled: {} },
      ]),
    ),
  });
}

async function signedExchangePayload(
  signer: PrivateKeyAccount,
  over: Partial<VenueOrderPayload> = {},
): Promise<VenueOrderPayload> {
  const action = {
    type: "order",
    orders: [
      {
        a: 0,
        b: true,
        p: "60000",
        s: "0.1",
        r: false,
        t: { limit: { tif: "Gtc" } },
      },
    ],
    grouping: "na",
  };
  const nonce = 1_738_000_000_000;
  const connectionId = hlL1ActionHash(action, undefined, nonce, undefined);
  const sig = await signer.signTypedData({
    domain: AGENT_DOMAIN,
    types: AGENT_TYPES,
    primaryType: "Agent",
    message: { source: "a", connectionId },
  });
  return payload({
    endpoint: "https://api.hyperliquid.xyz/exchange",
    hlEnvelope: {
      action,
      nonce,
      signature: {
        r: `0x${sig.slice(2, 66)}`,
        s: `0x${sig.slice(66, 130)}`,
        v: Number.parseInt(sig.slice(130, 132), 16),
      },
    },
    ...over,
  });
}

function extraAgentsFetch(
  agentByMaster: Record<string, string[]>,
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn(async (_url: unknown, init?: unknown) => {
    const body = JSON.parse(
      ((init as RequestInit | undefined)?.body as string) ?? "{}",
    ) as { type?: string; user?: string };
    if (body.type === "extraAgents" && body.user) {
      return jsonResponse(
        (agentByMaster[body.user.toLowerCase()] ?? []).map((address) => ({
          address,
          name: "bot",
        })),
      );
    }
    return jsonResponse({});
  }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>;
}

beforeEach(() => {
  mocks.localStore.clear();
  resetHlAgentMasterCacheForTests();
  vi.clearAllMocks();
});

describe("HlInfoClient.coinForIndex", () => {
  it("resolves perp index → symbol and caches the universe (one fetch)", async () => {
    const fetchImpl = infoFetch({});
    const client = new HlInfoClient({ fetchImpl });
    expect(await client.coinForIndex(0)).toBe("BTC");
    expect(await client.coinForIndex(5)).toBe("SOL");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // universe cached
  });

  it("returns null for a spot index (>= 10000) without fetching", async () => {
    const fetchImpl = infoFetch({});
    const client = new HlInfoClient({ fetchImpl });
    expect(await client.coinForIndex(10042)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("HlInfoClient.leverageFor", () => {
  it("reads activeAssetData leverage.value and caches per (user,coin)", async () => {
    const fetchImpl = infoFetch({ leverage: 26 });
    const client = new HlInfoClient({ fetchImpl });
    expect(await client.leverageFor(MASTER, "BTC")).toBe(26);
    expect(await client.leverageFor(MASTER, "BTC")).toBe(26);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached
  });

  it("returns null on a network error (best-effort miss)", async () => {
    const client = new HlInfoClient({ fetchImpl: infoFetch({ fail: true }) });
    expect(await client.leverageFor(MASTER, "BTC")).toBeNull();
  });

  it("returns null when the shape lacks leverage.value", async () => {
    const client = new HlInfoClient({
      fetchImpl: infoFetch({ leverage: null }),
    });
    expect(await client.leverageFor(MASTER, "BTC")).toBeNull();
  });

  it("set() seeds the cache so leverageFor needs no fetch", async () => {
    const fetchImpl = infoFetch({ leverage: 5 });
    const client = new HlInfoClient({ fetchImpl });
    client.set(MASTER, "BTC", 13);
    expect(await client.leverageFor(MASTER, "BTC")).toBe(13);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invalidate() forces a refetch", async () => {
    const fetchImpl = infoFetch({ leverage: 7 });
    const client = new HlInfoClient({ fetchImpl });
    client.set(MASTER, "BTC", 7);
    client.invalidate(MASTER, "BTC");
    expect(await client.leverageFor(MASTER, "BTC")).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeRuntimeInfoBase", () => {
  it("allows only loopback /info overrides", () => {
    expect(normalizeRuntimeInfoBase("http://127.0.0.1:8789/info")).toBe(
      "http://127.0.0.1:8789/info",
    );
    expect(normalizeRuntimeInfoBase("http://localhost:8789/info")).toBe(
      "http://localhost:8789/info",
    );

    expect(normalizeRuntimeInfoBase("https://evil.example/info")).toBeNull();
    expect(normalizeRuntimeInfoBase("https://user@localhost/info")).toBeNull();
    expect(normalizeRuntimeInfoBase("http://localhost:8789/other")).toBeNull();
    expect(normalizeRuntimeInfoBase("http://localhost:8789/info?x=1")).toBeNull();
    expect(normalizeRuntimeInfoBase("javascript:alert(1)")).toBeNull();
  });
});

describe("hl-master-store", () => {
  it("round-trips a connected account, lowercased", async () => {
    await setConnectedAccount(HOST, MASTER.toUpperCase());
    expect(await getConnectedAccount(HOST)).toBe(MASTER.toLowerCase());
  });

  it("ignores an invalid address", async () => {
    await setConnectedAccount(HOST, "0xnotanaddress");
    expect(await getConnectedAccount(HOST)).toBeNull();
  });

  it("clears an origin's account", async () => {
    await setConnectedAccount(HOST, MASTER);
    await clearConnectedAccount(HOST);
    expect(await getConnectedAccount(HOST)).toBeNull();
  });
});

describe("resolveHlMaster", () => {
  const WALLET = "0x2222222222222222222222222222222222222222";

  it("IGNORES a page-supplied vaultAddress — trusted wallet_id wins (principal-confusion guard)", async () => {
    await setConnectedAccount(HOST, MASTER);
    // A hostile frontend sets vaultAddress to an unregistered address to dodge
    // the connected wallet's per-wallet deny bindings and point enrichment at a
    // healthy decoy. It must NOT decide the principal — the trusted wallet_id
    // (stamped by the fetch-hook from eth_accounts) wins.
    const m = await resolveHlMaster(
      payload({
        vaultAddress: VAULT,
        wallet_id: { address: WALLET, chains: [] },
      }),
    );
    expect(m).toBe(WALLET.toLowerCase());
  });

  it("IGNORES vaultAddress even without wallet_id — uses the stored account, never the page vault", async () => {
    await setConnectedAccount(HOST, MASTER);
    const m = await resolveHlMaster(payload({ vaultAddress: VAULT }));
    expect(m).toBe(MASTER.toLowerCase());
  });

  it("uses the fetch-hook-stamped wallet_id when there is no vault", async () => {
    await setConnectedAccount(HOST, MASTER); // store present...
    seedSyncedWallets(SYNCED);
    const m = await resolveHlMaster(
      payload({ wallet_id: { address: WALLET, chains: [] } }),
    );
    expect(m).toBe(WALLET.toLowerCase()); // ...but wallet_id wins over both
  });

  it("falls back to the stored connected account for the origin", async () => {
    await setConnectedAccount(HOST, MASTER);
    seedSyncedWallets(SYNCED);
    expect(await resolveHlMaster(payload())).toBe(MASTER.toLowerCase());
  });

  it("falls back to the only synced wallet when wallet_id and origin store are absent", async () => {
    seedSyncedWallets(SYNCED);
    expect(await resolveHlMaster(payload())).toBe(SYNCED.toLowerCase());
  });

  it("uses a recovered direct HL signer when it matches a synced master", async () => {
    const signer = privateKeyToAccount(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    seedSyncedWallets(signer.address, OTHER);
    expect(await resolveHlMaster(await signedExchangePayload(signer))).toBe(
      signer.address.toLowerCase(),
    );
  });

  it("matches a recovered API agent to exactly one synced master extraAgents entry", async () => {
    seedSyncedWallets(SYNCED, OTHER);
    const fetchImpl = extraAgentsFetch({
      [SYNCED.toLowerCase()]: [AGENT.address],
      [OTHER.toLowerCase()]: [],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(fetchImpl);
    try {
      expect(await resolveHlMaster(await signedExchangePayload(AGENT))).toBe(
        SYNCED.toLowerCase(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not guess when a recovered API agent matches more than one synced master", async () => {
    seedSyncedWallets(SYNCED, OTHER);
    const fetchImpl = extraAgentsFetch({
      [SYNCED.toLowerCase()]: [AGENT.address],
      [OTHER.toLowerCase()]: [AGENT.address],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(fetchImpl);
    try {
      expect(
        await resolveHlMaster(await signedExchangePayload(AGENT)),
      ).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not run agent matching for non-L1-signed HL action types", async () => {
    seedSyncedWallets(SYNCED, OTHER);
    const p = await signedExchangePayload(AGENT);
    p.hlEnvelope = {
      ...p.hlEnvelope,
      action: { type: "withdraw3", destination: VAULT, amount: "5" },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        extraAgentsFetch({ [SYNCED.toLowerCase()]: [AGENT.address] }),
      );
    try {
      expect(await resolveHlMaster(p)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not guess from synced wallets when more than one wallet is present", async () => {
    seedSyncedWallets(SYNCED, OTHER);
    expect(await resolveHlMaster(payload())).toBeNull();
  });

  it("returns null when none is known", async () => {
    expect(await resolveHlMaster(payload())).toBeNull();
  });
});

describe("collectHlLeverage", () => {
  // The built `Perp::PlaceOrder` body. `market.symbol` is the key the result is
  // returned under (what the lowering looks leverage up by).
  const order = (symbol: string): Record<string, unknown> => ({
    domain: "perp",
    action: "place_order",
    venue: { name: "hyperliquid", chain: "hyperliquid:mainnet" },
    market: { symbol, venue: { name: "hyperliquid" } },
    side: "long",
    size: { kind: "base_decimal", amount: "0.1" },
    reduce_only: false,
    order_type: {
      kind: "limit",
      price: "60000",
      time_in_force: { kind: "gtc" },
    },
  });
  // The raw wire payload carrying the numeric asset index `collect` reads (the
  // built body no longer carries it).
  const orderPayload = (
    assetIndex: number,
    over: Partial<VenueOrderPayload> = {},
  ): VenueOrderPayload =>
    payload({
      hlAction: {
        kind: "order",
        order: {
          a: assetIndex,
          b: true,
          p: "60000",
          s: "0.1",
          r: false,
          t: { limit: { tif: "Gtc" } },
        },
      },
      ...over,
    } as Partial<VenueOrderPayload>);

  it("returns { symbol: leverage } for a place_order with a resolvable master", async () => {
    await setConnectedAccount(HOST, MASTER);
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 26 }) });
    const out = await collectHlLeverage(order("BTC"), orderPayload(0), client);
    expect(out).toEqual({ BTC: 26 });
  });

  it("uses the only synced wallet fallback for order-time leverage", async () => {
    seedSyncedWallets(SYNCED);
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 26 }) });
    const out = await collectHlLeverage(order("BTC"), orderPayload(0), client);
    expect(out).toEqual({ BTC: 26 });
  });

  it("returns {} for a non-order action", async () => {
    await setConnectedAccount(HOST, MASTER);
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 26 }) });
    const withdraw = { action: "hl_withdraw", destination: VAULT, amount: "1" };
    expect(await collectHlLeverage(withdraw, payload(), client)).toEqual({});
  });

  it("returns {} when the master is unknown (best-effort dormancy)", async () => {
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 26 }) });
    expect(
      await collectHlLeverage(order("BTC"), orderPayload(0), client),
    ).toEqual({});
  });

  it("returns {} for a spot asset_index (no perp leverage)", async () => {
    await setConnectedAccount(HOST, MASTER);
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 26 }) });
    expect(
      await collectHlLeverage(
        order("ASSET-10042"),
        orderPayload(10042),
        client,
      ),
    ).toEqual({});
  });

  it("returns {} when the leverage lookup misses", async () => {
    await setConnectedAccount(HOST, MASTER);
    const client = new HlInfoClient({
      fetchImpl: infoFetch({ leverage: null }),
    });
    expect(
      await collectHlLeverage(order("BTC"), orderPayload(0), client),
    ).toEqual({});
  });

  it("resolves the master from the stamped wallet_id (not a page vaultAddress)", async () => {
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 11 }) });
    const out = await collectHlLeverage(
      order("ETH"),
      orderPayload(1, { wallet_id: { address: VAULT, chains: [] } }),
      client,
    );
    expect(out).toEqual({ ETH: 11 });
  });

  it("ALSO enriches a TWAP order (closes the TWAP bypass of the order-leverage cap)", async () => {
    await setConnectedAccount(HOST, MASTER);
    const client = new HlInfoClient({ fetchImpl: infoFetch({ leverage: 26 }) });
    const twap = order("BTC"); // place_order body...
    twap.order_type = { kind: "twap", duration_minutes: 30, randomize: true }; // ...with twap kind
    const twapPayload = payload({
      hlAction: {
        kind: "twap_order",
        assetIndex: 0,
        isBuy: true,
        size: "10",
        reduceOnly: false,
        minutes: 30,
        randomize: true,
      },
    } as Partial<VenueOrderPayload>);
    expect(await collectHlLeverage(twap, twapPayload, client)).toEqual({
      BTC: 26,
    });
  });
});

describe("noteHlLeverageUpdate (invalidation, NOT page-seed)", () => {
  function activeAssetDataCalls(
    fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
  ): number {
    return fetchImpl.mock.calls.filter((c) => {
      try {
        return (
          JSON.parse(((c[1] as RequestInit).body as string) ?? "{}").type ===
          "activeAssetData"
        );
      } catch {
        return false;
      }
    }).length;
  }

  it("invalidates the cache so the next order re-fetches authoritative leverage — the page wire value is NEVER served", async () => {
    await setConnectedAccount(HOST, MASTER);
    // Authoritative API value is 99; the page will lie and claim 1.
    const fetchImpl = infoFetch({ leverage: 99 });
    const client = new HlInfoClient({ fetchImpl });

    // Prime the cache with the authoritative value.
    expect(await client.leverageFor(MASTER, "BTC")).toBe(99);

    // A page-asserted updateLeverage (now the generic `change_leverage` body)
    // claiming leverage:1 must NOT poison the deny-path cache (the historical
    // under-block vector). The asset index is read from the wire payload.
    const update = {
      domain: "perp",
      action: "change_leverage",
      venue: { name: "hyperliquid", chain: "hyperliquid:mainnet" },
      market: { symbol: "BTC", venue: { name: "hyperliquid" } },
      new_leverage: "1",
    };
    const updatePayload = payload({
      hlAction: {
        kind: "update_leverage",
        assetIndex: 0,
        isCross: true,
        leverage: 1,
      },
    } as Partial<VenueOrderPayload>);
    await noteHlLeverageUpdate(update, updatePayload, client);

    // The next read returns the AUTHORITATIVE 99 — never the wire-asserted 1 —
    // and a fresh activeAssetData fetch happened (cache was invalidated, not seeded).
    expect(await client.leverageFor(MASTER, "BTC")).toBe(99);
    expect(activeAssetDataCalls(fetchImpl)).toBeGreaterThanOrEqual(2);
  });

  it("does nothing for a non-updateLeverage action", async () => {
    await setConnectedAccount(HOST, MASTER);
    const fetchImpl = infoFetch({ leverage: 5 });
    const client = new HlInfoClient({ fetchImpl });
    client.set(MASTER, "BTC", 5);
    await noteHlLeverageUpdate(
      { domain: "perp", action: "place_order" },
      payload(),
      client,
    );
    // Cache untouched → served from cache, no activeAssetData fetch.
    expect(await client.leverageFor(MASTER, "BTC")).toBe(5);
    expect(activeAssetDataCalls(fetchImpl)).toBe(0);
  });
});
