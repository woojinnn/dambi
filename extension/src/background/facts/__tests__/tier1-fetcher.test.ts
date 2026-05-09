import { beforeEach, describe, expect, it, vi } from "vitest";
import { NATIVE_TOKEN_ADDRESS } from "../../oracle/oracle-snapshot";

const rpcMocks = vi.hoisted(() => ({
  readBalances: vi.fn(),
  readAllowances: vi.fn(),
}));

vi.mock("../../chains/rpc-client", () => ({
  readBalances: rpcMocks.readBalances,
  readAllowances: rpcMocks.readAllowances,
}));

import { fetchTier1, intoHostSnapshot, type Tier1Plan } from "../tier1-fetcher";

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const OWNER = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";
const storage = new Map<string, unknown>();

function token(address: string, decimals = 18, is_native = false) {
  return {
    chain_id: 1,
    address,
    symbol: is_native ? "ETH" : "TKN",
    decimals,
    is_native,
  };
}

function plan(overrides: Partial<Tier1Plan> = {}): Tier1Plan {
  return {
    tokens_for_oracle: [],
    balances: [],
    allowances: [],
    clock_required: false,
    sig_oracle_requirements: [],
    ...overrides,
  };
}

function installChromeStorageMock(): void {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const out: Record<string, unknown> = {};
            for (const key of Array.isArray(keys) ? keys : [keys])
              out[key] = storage.get(key);
            return out;
          }),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(entries))
              storage.set(key, value);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys])
              storage.delete(key);
          }),
        },
      },
    },
  });
}

describe("fetchTier1", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    storage.clear();
    installChromeStorageMock();
    rpcMocks.readBalances.mockResolvedValue([100n]);
    rpcMocks.readAllowances.mockResolvedValue([50n]);
  });

  it("combines oracle prices, balances, and allowances", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            [WETH]: { usd: 3500, last_updated_at: 8 },
            [USDC]: { usd: 1, last_updated_at: 8 },
          }),
        ),
    );

    const result = await fetchTier1(
      plan({
        tokens_for_oracle: [token(WETH), token(USDC, 6)],
        balances: [{ owner: OWNER, token: token(WETH) }],
        allowances: [{ owner: OWNER, token: token(WETH), spender: SPENDER }],
      }),
      fetchMock as any,
      10_000,
    );

    expect(result.oracle).toHaveLength(2);
    expect(result.balances).toEqual([
      { owner: OWNER, token_key: `1:${WETH}`, balance: "100" },
    ]);
    expect(result.allowances).toEqual([
      {
        owner: OWNER,
        token_key: `1:${WETH}`,
        spender: SPENDER,
        allowance: "50",
      },
    ]);
    expect(result.now_ts).toBe(10);
  });

  it("includes sig_oracle_requirements and propagates native flags", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/simple/price");
      return new Response(
        JSON.stringify({ ethereum: { usd: 3500, last_updated_at: 8 } }),
      );
    });

    const result = await fetchTier1(
      plan({
        tokens_for_oracle: [token(NATIVE_TOKEN_ADDRESS, 18, true)],
      }),
      fetchMock as any,
      10_000,
    );

    expect(result.oracle[0]).toMatchObject({
      token_key: `1:${NATIVE_TOKEN_ADDRESS.toLowerCase()}`,
      usd_price: 3500,
    });
  });

  it("preserves oracle entries when balances and allowances time out", async () => {
    vi.useFakeTimers();
    rpcMocks.readBalances.mockReturnValue(new Promise(() => undefined));
    rpcMocks.readAllowances.mockReturnValue(new Promise(() => undefined));

    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  [WETH]: { usd: 3500, last_updated_at: 8 },
                }),
              ),
            );
          }, 50);
        }),
    );

    const resultPromise = fetchTier1(
      plan({
        tokens_for_oracle: [token(WETH)],
        balances: [{ owner: OWNER, token: token(WETH) }],
        allowances: [{ owner: OWNER, token: token(WETH), spender: SPENDER }],
      }),
      fetchMock as any,
      10_000,
    );
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await resultPromise;
    expect(result.oracle).toEqual([
      expect.objectContaining({
        token_key: `1:${WETH}`,
        usd_price: 3500,
      }),
    ]);
    expect(result.balances).toEqual([]);
    expect(result.allowances).toEqual([]);
  });

  it("returns an empty fail-open snapshot after the outer timeout", async () => {
    vi.useFakeTimers();
    rpcMocks.readBalances.mockReturnValue(new Promise(() => undefined));
    rpcMocks.readAllowances.mockResolvedValue([]);

    const resultPromise = fetchTier1(
      plan({ balances: [{ owner: OWNER, token: token(WETH) }] }),
      vi.fn() as any,
      10_000,
    );
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).resolves.toEqual({
      oracle: [],
      balances: [],
      allowances: [],
      now_ts: 10,
    });
  });

  it("merges tier-1 results into a full HostSnapshot", () => {
    const snapshot = intoHostSnapshot(
      { oracle: [], balances: [], allowances: [], now_ts: 10 },
      [{ actor: OWNER, name: "swapVolumeUsd24h", value: "1" }],
    );
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.now_ts).toBe(10);
  });
});
