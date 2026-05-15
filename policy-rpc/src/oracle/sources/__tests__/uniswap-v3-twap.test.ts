import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { ORACLE_USD_SCALE } from "../../source";
import { priceFromTick, UniswapV3TwapSource, type UniswapPoolEntry } from "../uniswap-v3-twap";

const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const fakePool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const anchorPool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5641";

const wethUsdcEntry: UniswapPoolEntry = {
  pool: fakePool,
  tokenIsToken0: false, // USDC is token0, WETH is token1
  tokenDecimals: 18,
  quoteDecimals: 6,
  quoteKind: "stable",
};

const wbtcUsdcEntry: UniswapPoolEntry = {
  pool: fakePool,
  tokenIsToken0: true, // WBTC is token0, USDC is token1
  tokenDecimals: 8,
  quoteDecimals: 6,
  quoteKind: "stable",
};

/**
 * Build a pool tick that approximates a desired token1/token0 ratio (raw
 * smallest-unit price). The tick for ratio r is `floor(log(r)/log(1.0001))`.
 */
function tickForRawRatio(token1PerToken0: number): number {
  return Math.floor(Math.log(token1PerToken0) / Math.log(1.0001));
}

function buildClient(
  responses: ReadonlyArray<{ pool: string; tickDelta: bigint }>,
): PublicClient {
  return {
    readContract: vi.fn(async (params: { address: string; args: [readonly number[]] }) => {
      const match = responses.find((entry) => entry.pool.toLowerCase() === params.address.toLowerCase());
      if (!match) {
        throw new Error(`unexpected pool ${params.address}`);
      }
      const seconds = BigInt(params.args[0][0]);
      // tickCumulatives[0] (older) and tickCumulatives[1] (now).
      // mean tick = (tc1 - tc0) / seconds.
      const tc1 = match.tickDelta * seconds;
      return [[0n, tc1], [0n, 0n]] as const;
    }),
  } as unknown as PublicClient;
}

describe("priceFromTick", () => {
  it("prices token0 (WBTC) against USDC quote", () => {
    // WBTC has 8 dp, USDC has 6 dp. If 1 WBTC = $30,000 then
    // raw ratio token1/token0 = 30_000 * 10^6 / 10^8 = 300.
    const tick = tickForRawRatio(300);
    const price = priceFromTick(tick, wbtcUsdcEntry);
    // Allow ~0.2% slack from tick rounding (log->int).
    const expected = 30_000n * ORACLE_USD_SCALE;
    const tolerance = (expected * 20n) / 10_000n; // 0.2%
    expect(price).toBeGreaterThan(expected - tolerance);
    expect(price).toBeLessThan(expected + tolerance);
  });

  it("prices token1 (WETH) against USDC quote via inversion", () => {
    // 1 WETH = $2,500 -> raw token1/token0 = 1e18 / (2500 * 1e6) = 1e18 / 2.5e9 = 4e8.
    const tick = tickForRawRatio(4e8);
    const price = priceFromTick(tick, wethUsdcEntry);
    const expected = 2_500n * ORACLE_USD_SCALE;
    const tolerance = (expected * 20n) / 10_000n;
    expect(price).toBeGreaterThan(expected - tolerance);
    expect(price).toBeLessThan(expected + tolerance);
  });
});

describe("UniswapV3TwapSource", () => {
  it("returns a TWAP-based USD sample for stable pools", async () => {
    const tick = tickForRawRatio(4e8); // $2500 ETH
    const client = buildClient([{ pool: fakePool, tickDelta: BigInt(tick) }]);
    const source = new UniswapV3TwapSource({
      registry: { 1: { [wethAddress]: wethUsdcEntry } },
      publicClient: client,
      twapSeconds: 1800,
      nowMs: () => 1_778_750_000_000,
    });

    const sample = await source.fetch(1, { address: wethAddress });
    expect(sample.sourceId).toBe("uniswap-v3-twap");
    expect(sample.decimals).toBe(8);
    expect(sample.observedAt).toBe(1_778_750_000_000);
    const expected = 2_500n * ORACLE_USD_SCALE;
    const tolerance = (expected * 20n) / 10_000n;
    expect(sample.usd).toBeGreaterThan(expected - tolerance);
    expect(sample.usd).toBeLessThan(expected + tolerance);
  });

  it("chains through WETH anchor for non-stable quote pools", async () => {
    // Hypothetical token TKN priced against WETH (entry quote = WETH).
    const tknAddress = "0x1111111111111111111111111111111111111111";
    // 1 TKN = 0.01 WETH; both 18 dp, so raw ratio token1/token0 = 0.01.
    const tknPoolTick = tickForRawRatio(0.01);
    // 1 WETH = $2,000; anchor pool USDC token0 (6 dp), WETH token1 (18 dp).
    // directPrice = 10^20 / 1.0001^tick = 2000 * 1e8 -> 1.0001^tick = 5e8
    const anchorTick = tickForRawRatio(5e8);

    const tknEntry: UniswapPoolEntry = {
      pool: "0x2222222222222222222222222222222222222222",
      tokenIsToken0: true,
      tokenDecimals: 18,
      quoteDecimals: 18,
      quoteKind: "weth",
    };

    const anchorEntry: UniswapPoolEntry = {
      pool: anchorPool,
      tokenIsToken0: false,
      tokenDecimals: 18,
      quoteDecimals: 6,
      quoteKind: "stable",
    };

    const client = buildClient([
      { pool: tknEntry.pool, tickDelta: BigInt(tknPoolTick) },
      { pool: anchorPool, tickDelta: BigInt(anchorTick) },
    ]);

    const source = new UniswapV3TwapSource({
      registry: { 1: { [tknAddress]: tknEntry } },
      wethAnchorPools: { 1: anchorEntry },
      publicClient: client,
      twapSeconds: 1800,
      nowMs: () => 1_778_750_000_000,
    });

    const sample = await source.fetch(1, { address: tknAddress });
    // 0.01 WETH * $2000 = $20
    const expected = 20n * ORACLE_USD_SCALE;
    const tolerance = (expected * 40n) / 10_000n; // 0.4% (two cascaded tick roundings)
    expect(sample.usd).toBeGreaterThan(expected - tolerance);
    expect(sample.usd).toBeLessThan(expected + tolerance);
  });

  it("rejects tokens missing from the registry", async () => {
    const source = new UniswapV3TwapSource({
      registry: { 1: {} },
      publicClient: buildClient([]),
    });

    await expect(
      source.fetch(1, { address: "0x9999999999999999999999999999999999999999" }),
    ).rejects.toMatchObject({
      code: "unsupported_token",
      sourceId: "uniswap-v3-twap",
    });
  });

  it("maps cardinality reverts to stale", async () => {
    const client = {
      readContract: vi.fn(async () => {
        throw new Error("execution reverted: OLD");
      }),
    } as unknown as PublicClient;

    const source = new UniswapV3TwapSource({
      registry: { 1: { [wethAddress]: wethUsdcEntry } },
      publicClient: client,
    });

    await expect(source.fetch(1, { address: wethAddress })).rejects.toMatchObject({
      code: "stale",
      sourceId: "uniswap-v3-twap",
    });
  });

  it("maps transport failures to unavailable", async () => {
    const client = {
      readContract: vi.fn(async () => {
        throw new Error("network timeout");
      }),
    } as unknown as PublicClient;

    const source = new UniswapV3TwapSource({
      registry: { 1: { [wethAddress]: wethUsdcEntry } },
      publicClient: client,
    });

    await expect(source.fetch(1, { address: wethAddress })).rejects.toMatchObject({
      code: "unavailable",
      sourceId: "uniswap-v3-twap",
    });
  });

  it("propagates stale (not unavailable) when the WETH anchor pool reverts with OLD", async () => {
    // Non-stable quoted token forces the source to chain through the WETH
    // anchor. If the anchor pool itself has insufficient observations the
    // failure must surface as 'stale' so the aggregator routes through the
    // same code path as a stale primary read.
    const tknAddress = "0x1111111111111111111111111111111111111111";
    const tknEntry: UniswapPoolEntry = {
      pool: "0x2222222222222222222222222222222222222222",
      tokenIsToken0: true,
      tokenDecimals: 18,
      quoteDecimals: 18,
      quoteKind: "weth",
    };
    const anchorEntry: UniswapPoolEntry = {
      pool: anchorPool,
      tokenIsToken0: false,
      tokenDecimals: 18,
      quoteDecimals: 6,
      quoteKind: "stable",
    };

    // Direct pool resolves normally, anchor reverts with "OLD".
    const tknTick = tickForRawRatio(0.01);
    const client = {
      readContract: vi.fn(async (params: { address: string; args: [readonly number[]] }) => {
        if (params.address.toLowerCase() === tknEntry.pool.toLowerCase()) {
          const seconds = BigInt(params.args[0][0]);
          return [[0n, BigInt(tknTick) * seconds], [0n, 0n]] as const;
        }
        throw new Error("execution reverted: OLD");
      }),
    } as unknown as PublicClient;

    const source = new UniswapV3TwapSource({
      registry: { 1: { [tknAddress]: tknEntry } },
      wethAnchorPools: { 1: anchorEntry },
      publicClient: client,
    });

    await expect(source.fetch(1, { address: tknAddress })).rejects.toMatchObject({
      code: "stale",
      sourceId: "uniswap-v3-twap",
    });
  });
});
