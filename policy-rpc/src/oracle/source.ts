/**
 * Common interface shared by every oracle data source (Chainlink, Uniswap V3
 * TWAP, CoinGecko, ...). A source resolves the USD price of a single token on
 * a single chain, returning a price scaled to 1e8 with the wall-clock time it
 * was observed at. Sources fail by throwing `OracleSourceError`.
 */

/** Reference to an asset to price. */
export interface AssetRef {
  /** Lowercase 0x-prefixed ERC-20 address (or wrapped-native address). */
  address: string;
  /** Underlying token decimals (informational - not required for USD lookups). */
  decimals?: number;
}

export interface OracleSample {
  /** USD price per single token, scaled by 10^8 (matches Chainlink USD feeds). */
  usd: bigint;
  /** Scale of the USD value. Always 8 for now but kept explicit for safety. */
  decimals: number;
  /** Wall-clock timestamp (unix milliseconds) when the price was observed. */
  observedAt: number;
  /** Stable identifier for this source (e.g. "chainlink", "uniswap-v3-twap"). */
  sourceId: string;
}

export type OracleSourceErrorCode =
  | "stale"
  | "unavailable"
  | "unsupported_token"
  | "invalid_response";

export class OracleSourceError extends Error {
  readonly code: OracleSourceErrorCode;
  readonly sourceId: string;

  constructor(code: OracleSourceErrorCode, sourceId: string, message: string) {
    super(message);
    this.name = "OracleSourceError";
    this.code = code;
    this.sourceId = sourceId;
  }
}

export interface OracleSource {
  /** Stable identifier - mirrored on `OracleSample.sourceId` for traceability. */
  readonly id: string;
  /**
   * Resolve the USD price of `token` on `chainId`. Throws
   * `OracleSourceError` on any failure (stale, unavailable, unsupported).
   */
  fetch(chainId: number, token: AssetRef): Promise<OracleSample>;
}

/** Standard scale shared by `OracleSample` and Chainlink USD feeds. */
export const ORACLE_USD_DECIMALS = 8;

/** Multiplier for scaling a unitless integer to `ORACLE_USD_DECIMALS`. */
export const ORACLE_USD_SCALE: bigint = 10n ** BigInt(ORACLE_USD_DECIMALS);
