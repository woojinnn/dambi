import { CoinGeckoClient, type CoinGeckoClientOptions } from "../../coingecko-client.js";
import type { NowMs } from "../../types.js";
import {
  OracleSourceError,
  ORACLE_USD_DECIMALS,
  type AssetRef,
  type OracleSample,
  type OracleSource,
} from "../source.js";

const SOURCE_ID = "coingecko";

/** Reject CoinGecko responses whose observation is older than 5 minutes. */
const DEFAULT_MAX_AGE_SEC = 5 * 60;

export interface CoinGeckoSourceOptions extends CoinGeckoClientOptions {
  /** Pre-built client (allows tests to inject a custom fetch). */
  client?: CoinGeckoClient;
  /** Override staleness budget in seconds. */
  maxAgeSec?: number;
  /** Override `Date.now`. */
  nowMs?: NowMs;
}

export class CoinGeckoSource implements OracleSource {
  readonly id = SOURCE_ID;
  private readonly client: CoinGeckoClient;
  private readonly maxAgeSec: number;
  private readonly nowMs: NowMs;

  constructor(options: CoinGeckoSourceOptions = {}) {
    this.client = options.client ?? new CoinGeckoClient(options);
    this.maxAgeSec = options.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;
    this.nowMs = options.nowMs ?? Date.now;
  }

  async fetch(chainId: number, token: AssetRef): Promise<OracleSample> {
    let tokenPrice;
    try {
      tokenPrice = await this.client.tokenUsdPrice(chainId, token.address);
    } catch (error) {
      throw new OracleSourceError(
        toCoingeckoErrorCode(error),
        SOURCE_ID,
        error instanceof Error ? error.message : "CoinGecko request failed",
      );
    }

    const nowSec = Math.floor(this.nowMs() / 1000);
    const ageSec = Math.max(0, nowSec - tokenPrice.asOfTs);

    if (ageSec > this.maxAgeSec) {
      throw new OracleSourceError(
        "stale",
        SOURCE_ID,
        `CoinGecko price is ${ageSec}s old (> ${this.maxAgeSec}s budget)`,
      );
    }

    const usd = decimalToScaledBigInt(tokenPrice.priceUsd, ORACLE_USD_DECIMALS);

    if (usd <= 0n) {
      throw new OracleSourceError(
        "invalid_response",
        SOURCE_ID,
        `CoinGecko returned non-positive price ${tokenPrice.priceUsd}`,
      );
    }

    return {
      usd,
      decimals: ORACLE_USD_DECIMALS,
      observedAt: tokenPrice.asOfTs * 1000,
      sourceId: SOURCE_ID,
    };
  }
}

function toCoingeckoErrorCode(error: unknown): "unavailable" | "unsupported_token" | "invalid_response" {
  if (!error || typeof error !== "object") {
    return "unavailable";
  }
  const code = (error as { code?: unknown }).code;
  if (code === "not_found") {
    return "unsupported_token";
  }
  if (code === "unsupported_chain") {
    return "unsupported_token";
  }
  if (code === "upstream_error") {
    return "unavailable";
  }
  return "unavailable";
}

/**
 * Parse a decimal string (e.g. `"2.5000"`, `"1e-3"`) and scale it to an
 * integer with `scale` fractional places. Mirrors the helper that previously
 * lived in `oracle-usd-value.ts` so legacy callers and the new source share
 * one implementation.
 */
export function decimalToScaledBigInt(input: string, scale: number): bigint {
  const normalized = expandExponentialDecimal(input.trim());
  const matched = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/.exec(normalized);

  if (!matched) {
    throw new OracleSourceError(
      "invalid_response",
      SOURCE_ID,
      `CoinGecko returned an invalid USD price: ${input}`,
    );
  }

  const [, sign, whole, fraction = ""] = matched;
  const scaledFraction = fraction.padEnd(scale, "0").slice(0, scale);
  const digits = `${whole}${scaledFraction}`.replace(/^0+(?=\d)/, "");
  const scaled = BigInt(digits === "" ? "0" : digits);

  return sign === "-" ? -scaled : scaled;
}

function expandExponentialDecimal(input: string): string {
  const matched = /^([+-]?)([0-9]+)(?:\.([0-9]+))?[eE]([+-]?[0-9]+)$/.exec(input);

  if (!matched) {
    return input;
  }

  const [, sign, whole, fraction = "", exponentString] = matched;
  const exponent = Number(exponentString);
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  }

  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }

  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
