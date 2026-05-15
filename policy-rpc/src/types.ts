export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type NowMs = () => number;

export interface PolicyRpcCall {
  id: string;
  method: string;
  params: JsonObject;
}

export interface PolicyRpcRequest {
  request_id: string;
  calls: PolicyRpcCall[];
}

export interface RpcErrorBody {
  code: string;
  message: string;
}

export interface RpcSuccessResult {
  id: string;
  ok: true;
  result: JsonObject;
}

export interface RpcFailureResult {
  id: string;
  ok: false;
  error: RpcErrorBody;
}

export type RpcResult = RpcSuccessResult | RpcFailureResult;

export interface PolicyRpcResponse {
  request_id: string;
  results: RpcResult[];
}

export interface OracleUsdValueParams {
  chain_id: number;
  address: string;
  amount: string;
  decimals: number;
}

/**
 * Per-source detail returned alongside aggregated USD valuations. Lists every
 * source that was queried, the value it observed (as a decimal string in USD)
 * and whether the aggregator kept or dropped it. Additive next to the legacy
 * `sources: string[]` field so callers reading the existing shape continue to
 * work.
 */
export interface UsdValuationSource extends JsonObject {
  sourceId: string;
  value: string;
  asOfTs: number;
  included: boolean;
  reason?: string;
}

export interface UsdValuation extends JsonObject {
  value: string;
  asOfTs: number;
  staleSec: number;
  /** Identifiers of sources that were included in the final aggregate. */
  sources: string[];
  /** Detailed per-source breakdown (additive over `sources`). */
  sourceBreakdown: UsdValuationSource[];
  /** Optional confidence tag - "low" when a single source survived. */
  confidence?: "high" | "low";
}

export class RpcMethodError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcMethodError";
    this.code = code;
  }
}
