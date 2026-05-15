import { createPublicClient, http, type PublicClient } from "viem";

import { rpcUrlForChain } from "./chain-config.js";
import { RpcMethodError } from "./types.js";

export interface EthProviderOptions {
  /**
   * Optional override for the per-chain RPC URL. When set the env / default
   * lookup is skipped. Primarily used by tests.
   */
  rpcUrl?: string;
  /** Per-call request timeout in milliseconds. */
  timeoutMs?: number;
  /** Number of retries on transient transport failures. */
  retryCount?: number;
  /** Delay between retries in milliseconds. */
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

interface CacheKey {
  chainId: number;
  rpcUrl: string;
}

const clientCache = new Map<string, PublicClient>();

function cacheKey(key: CacheKey): string {
  return `${key.chainId}::${key.rpcUrl}`;
}

/**
 * Memoised viem `PublicClient` per (chainId, rpcUrl) pair. Tests can pass an
 * explicit `rpcUrl` (or call `resetPublicClientCache()`) to avoid sharing
 * state.
 */
export function getPublicClient(
  chainId: number,
  options: EthProviderOptions = {},
): PublicClient {
  const rpcUrl = options.rpcUrl ?? rpcUrlForChain(chainId);

  if (!rpcUrl) {
    throw new RpcMethodError(
      "unsupported_chain",
      `No RPC URL configured for chain_id ${chainId}`,
    );
  }

  const key = cacheKey({ chainId, rpcUrl });
  const cached = clientCache.get(key);

  if (cached) {
    return cached;
  }

  const client = createPublicClient({
    transport: http(rpcUrl, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retryCount: options.retryCount ?? DEFAULT_RETRY_COUNT,
      retryDelay: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    }),
  }) as PublicClient;

  clientCache.set(key, client);

  return client;
}

/**
 * Clears the memoisation cache. Intended for tests that swap providers
 * between cases.
 */
export function resetPublicClientCache(): void {
  clientCache.clear();
}
