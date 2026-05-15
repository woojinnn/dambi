import type { Abi, PublicClient } from "viem";

import { getPublicClient } from "../../eth-provider.js";
import type { NowMs } from "../../types.js";
import {
  OracleSourceError,
  ORACLE_USD_DECIMALS,
  ORACLE_USD_SCALE,
  type AssetRef,
  type OracleSample,
  type OracleSource,
} from "../source.js";
import {
  getSqrtRatioAtTick,
  tickFromTickCumulatives,
} from "./uniswap-tick-math.js";

const SOURCE_ID = "uniswap-v3-twap";

/** Default TWAP window in seconds. */
const DEFAULT_TWAP_SECONDS = 1800;

/** Stable quote tokens (treated as $1 for pricing). */
type QuoteKind = "stable" | "weth";

export interface UniswapPoolEntry {
  /** Address of the V3 pool. */
  pool: string;
  /** True when the priced token is `token0`, false when it is `token1`. */
  tokenIsToken0: boolean;
  /** Decimals of the priced token (the AssetRef). */
  tokenDecimals: number;
  /** Decimals of the quote token in the pool. */
  quoteDecimals: number;
  /** Whether the quote token prices in USD directly (stable) or through WETH. */
  quoteKind: QuoteKind;
}

/**
 * Per-chain registry: `(chainId, tokenAddress) → UniswapPoolEntry`.
 * Tokens MUST be lowercased.
 *
 * Seeded with the most-liquid USDC pairs on Ethereum mainnet:
 * - WETH/USDC 0.05% (0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640) - quote: USDC
 * - WBTC/USDC 0.3%  (0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35) - quote: USDC
 * - DAI/USDC 0.01%  (0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168) - quote: USDC
 *
 * USDC and USDT are themselves treated as $1 via the stable quote kind, so
 * they don't appear as priced tokens here. Users priced through Uniswap
 * therefore need at least one stable pool to anchor them.
 */
const DEFAULT_REGISTRY: Record<number, Record<string, UniswapPoolEntry>> = {
  1: {
    // WETH (priced) - USDC (quote, stable). USDC is token0, WETH is token1.
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
      pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
      tokenIsToken0: false,
      tokenDecimals: 18,
      quoteDecimals: 6,
      quoteKind: "stable",
    },
    // WBTC (priced) - USDC (quote, stable). WBTC is token0, USDC is token1.
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
      pool: "0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35",
      tokenIsToken0: true,
      tokenDecimals: 8,
      quoteDecimals: 6,
      quoteKind: "stable",
    },
    // DAI (priced) - USDC (quote, stable). DAI is token0, USDC is token1.
    "0x6b175474e89094c44da98b954eedeac495271d0f": {
      pool: "0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168",
      tokenIsToken0: true,
      tokenDecimals: 18,
      quoteDecimals: 6,
      quoteKind: "stable",
    },
  },
};

/** Pool used to anchor WETH -> USD when a non-WETH/stable token needs chaining. */
const WETH_ANCHOR_POOL_BY_CHAIN: Record<number, UniswapPoolEntry> = {
  1: {
    pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    tokenIsToken0: false,
    tokenDecimals: 18,
    quoteDecimals: 6,
    quoteKind: "stable",
  },
};

const UNISWAP_V3_POOL_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "observe",
    inputs: [{ type: "uint32[]", name: "secondsAgos" }],
    outputs: [
      { type: "int56[]", name: "tickCumulatives" },
      { type: "uint160[]", name: "secondsPerLiquidityCumulativeX128s" },
    ],
  },
] as const satisfies Abi;

export interface UniswapV3TwapSourceOptions {
  registry?: Record<number, Record<string, UniswapPoolEntry>>;
  wethAnchorPools?: Record<number, UniswapPoolEntry>;
  twapSeconds?: number;
  publicClient?: PublicClient;
  getPublicClient?: (chainId: number) => PublicClient;
  nowMs?: NowMs;
}

export class UniswapV3TwapSource implements OracleSource {
  readonly id = SOURCE_ID;
  private readonly registry: Record<number, Record<string, UniswapPoolEntry>>;
  private readonly anchors: Record<number, UniswapPoolEntry>;
  private readonly twapSeconds: number;
  private readonly publicClient: PublicClient | undefined;
  private readonly clientFactory: (chainId: number) => PublicClient;
  private readonly nowMs: NowMs;

  constructor(options: UniswapV3TwapSourceOptions = {}) {
    this.registry = options.registry ?? DEFAULT_REGISTRY;
    this.anchors = options.wethAnchorPools ?? WETH_ANCHOR_POOL_BY_CHAIN;
    this.twapSeconds = options.twapSeconds ?? DEFAULT_TWAP_SECONDS;
    this.publicClient = options.publicClient;
    this.clientFactory =
      options.getPublicClient ??
      ((chainId: number) => getPublicClient(chainId));
    this.nowMs = options.nowMs ?? Date.now;
  }

  async fetch(chainId: number, token: AssetRef): Promise<OracleSample> {
    const entry = this.lookupPool(chainId, token.address);
    const client = this.publicClient ?? this.clientFactory(chainId);

    const meanTick = await this.observeTwapTick(client, entry.pool);
    const directPrice = priceFromTick(meanTick, entry);

    if (directPrice <= 0n) {
      throw new OracleSourceError(
        "invalid_response",
        SOURCE_ID,
        `Uniswap V3 TWAP for ${token.address} yielded a non-positive price`,
      );
    }

    const observedAt = this.nowMs();

    if (entry.quoteKind === "stable") {
      return {
        usd: directPrice,
        decimals: ORACLE_USD_DECIMALS,
        observedAt,
        sourceId: SOURCE_ID,
      };
    }

    const anchor = this.anchors[chainId];
    if (!anchor) {
      throw new OracleSourceError(
        "unsupported_token",
        SOURCE_ID,
        `No WETH anchor pool configured for chain ${chainId}`,
      );
    }

    // The anchor read goes through the same `observeTwapTick` path as the
    // primary read, which maps OLD/cardinality reverts to `stale` (not
    // `unavailable`). That mapping is intentional: a stale anchor is a
    // transient observation-cardinality issue the aggregator can handle via
    // its all_sources_stale path, identical to a stale primary pool.
    const anchorTick = await this.observeTwapTick(client, anchor.pool);
    const wethUsd = priceFromTick(anchorTick, anchor);

    if (wethUsd <= 0n) {
      throw new OracleSourceError(
        "invalid_response",
        SOURCE_ID,
        `WETH anchor pool returned non-positive price on chain ${chainId}`,
      );
    }

    // directPrice is "token in WETH" scaled 1e8; wethUsd is "WETH in USD" scaled 1e8.
    // Combine: token in USD = (token-in-WETH * weth-in-USD) / 1e8.
    const usd = (directPrice * wethUsd) / ORACLE_USD_SCALE;

    return {
      usd,
      decimals: ORACLE_USD_DECIMALS,
      observedAt,
      sourceId: SOURCE_ID,
    };
  }

  private lookupPool(chainId: number, tokenAddress: string): UniswapPoolEntry {
    const chain = this.registry[chainId];
    const lower = tokenAddress.toLowerCase();
    const entry = chain ? chain[lower] : undefined;
    if (!entry) {
      throw new OracleSourceError(
        "unsupported_token",
        SOURCE_ID,
        `No Uniswap V3 pool registered for token ${tokenAddress} on chain ${chainId}`,
      );
    }
    return entry;
  }

  private async observeTwapTick(
    client: PublicClient,
    poolAddress: string,
  ): Promise<number> {
    let result: readonly bigint[];
    try {
      const raw = (await client.readContract({
        address: poolAddress as `0x${string}`,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "observe",
        args: [[this.twapSeconds, 0]],
      })) as readonly [readonly bigint[], readonly bigint[]];
      result = raw[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Pools without enough observation cardinality revert with "OLD" - treat as stale.
      if (/OLD\b/.test(message) || /cardinality/i.test(message)) {
        throw new OracleSourceError(
          "stale",
          SOURCE_ID,
          `Uniswap V3 pool ${poolAddress} has insufficient observations: ${message}`,
        );
      }
      throw new OracleSourceError(
        "unavailable",
        SOURCE_ID,
        `Uniswap V3 observe failed for ${poolAddress}: ${message}`,
      );
    }

    if (result.length !== 2) {
      throw new OracleSourceError(
        "invalid_response",
        SOURCE_ID,
        `Uniswap V3 observe returned ${result.length} tick cumulatives, expected 2`,
      );
    }

    return tickFromTickCumulatives(result, this.twapSeconds);
  }
}

/**
 * Convert an arithmetic-mean tick into a USD-scaled price (1e8) given the
 * pool entry. The result is "price of one priced-token unit, scaled to 1e8,
 * denominated in the pool's quote token". The caller is responsible for
 * chaining through a USD anchor when `quoteKind === "weth"`.
 *
 * Steps:
 *   sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick)   // Q64.96
 *   priceX192    = sqrtPriceX96^2                       // Q128.192, equals token1/token0 * 2^192
 *
 * For tokenIsToken0=true (priced token is token0, quote is token1):
 *   price_token0_in_token1 = (priceX192 * 10^pricedDecimals * 1e8)
 *                            / (10^quoteDecimals * 2^192)
 *
 * For tokenIsToken0=false (priced token is token1, quote is token0):
 *   price_token1_in_token0 = (10^pricedDecimals * 1e8 * 2^192)
 *                            / (priceX192 * 10^quoteDecimals)
 */
export function priceFromTick(tick: number, entry: UniswapPoolEntry): bigint {
  const sqrtPriceX96 = getSqrtRatioAtTick(tick);
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  const twoPow192 = 1n << 192n;
  const pricedScale = 10n ** BigInt(entry.tokenDecimals);
  const quoteScale = 10n ** BigInt(entry.quoteDecimals);

  if (entry.tokenIsToken0) {
    // priceX192 / 2^192 == raw token1/token0 ratio (in their smallest units).
    // Multiply by 10^pricedDecimals to convert from "one priced unit" to "10^d
    // smallest units", divide by 10^quoteDecimals to convert quote back to its
    // human price, and finally multiply by 1e8 for ORACLE_USD_DECIMALS.
    return (priceX192 * pricedScale * ORACLE_USD_SCALE) / (twoPow192 * quoteScale);
  }
  // priceX192 / 2^192 == raw token1/token0, but we want token0 per token1, so
  // invert: take reciprocal of the same expression with priced/quote swapped.
  return (pricedScale * ORACLE_USD_SCALE * twoPow192) / (priceX192 * quoteScale);
}
