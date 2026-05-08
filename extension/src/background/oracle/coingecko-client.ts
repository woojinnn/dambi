import { chainConfig } from '../chains/chain-config';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const MAX_BATCH = 30;

const tokenUpdatedAt = new WeakMap<ReadonlyMap<string, number>, Map<string, number>>();
const nativeUpdatedAt = new WeakMap<ReadonlyMap<number, number>, Map<number, number>>();

export function priceLastUpdatedAt(
  prices: ReadonlyMap<string, number>,
  address: string,
): number | undefined {
  return tokenUpdatedAt.get(prices)?.get(address.toLowerCase());
}

export function nativePriceLastUpdatedAt(
  prices: ReadonlyMap<number, number>,
  chainId: number,
): number | undefined {
  return nativeUpdatedAt.get(prices)?.get(chainId);
}

function unixSecondsToMs(value: number | undefined): number {
  return typeof value === 'number' ? value * 1000 : Date.now();
}

/**
 * Fetch USD prices for ERC-20 tokens on one chain. Results are keyed by
 * lowercased contract address. Network failures, HTTP errors, malformed JSON,
 * and unsupported chains all return an empty Map — never throw.
 */
export async function fetchUsdPrices(
  chainId: number,
  addresses: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const updated = new Map<string, number>();
  tokenUpdatedAt.set(out, updated);

  try {
    if (addresses.length === 0) return out;
    const platform = chainConfig(chainId).coingeckoPlatform;
    const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];

    for (let i = 0; i < unique.length; i += MAX_BATCH) {
      const batch = unique.slice(i, i + MAX_BATCH);
      const url = new URL(`${COINGECKO_BASE}/simple/token_price/${platform}`);
      url.searchParams.set('contract_addresses', batch.join(','));
      url.searchParams.set('vs_currencies', 'usd');
      url.searchParams.set('include_last_updated_at', 'true');

      const response = await fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return new Map<string, number>();

      const body = (await response.json()) as Record<
        string,
        { usd?: number; last_updated_at?: number }
      >;
      for (const [address, entry] of Object.entries(body)) {
        if (typeof entry.usd !== 'number') continue;
        const lower = address.toLowerCase();
        out.set(lower, entry.usd);
        updated.set(lower, unixSecondsToMs(entry.last_updated_at));
      }
    }
    return out;
  } catch {
    return new Map<string, number>();
  }
}

/**
 * Fetch USD prices for native chain assets via /simple/price?ids=. Multiple
 * chains can share one CoinGecko id, so the returned Map is keyed by chain id.
 */
export async function fetchNativeUsdPrices(
  chainIds: readonly number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const updated = new Map<number, number>();
  nativeUpdatedAt.set(out, updated);

  try {
    if (chainIds.length === 0) return out;
    const idsByCoin = new Map<string, number[]>();
    for (const chainId of new Set(chainIds)) {
      const coinId = chainConfig(chainId).coingeckoNativeId;
      const chains = idsByCoin.get(coinId) ?? [];
      chains.push(chainId);
      idsByCoin.set(coinId, chains);
    }

    const url = new URL(`${COINGECKO_BASE}/simple/price`);
    url.searchParams.set('ids', [...idsByCoin.keys()].join(','));
    url.searchParams.set('vs_currencies', 'usd');
    url.searchParams.set('include_last_updated_at', 'true');

    const response = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return new Map<number, number>();

    const body = (await response.json()) as Record<
      string,
      { usd?: number; last_updated_at?: number }
    >;
    for (const [coinId, entry] of Object.entries(body)) {
      if (typeof entry.usd !== 'number') continue;
      const chains = idsByCoin.get(coinId) ?? [];
      for (const chainId of chains) {
        out.set(chainId, entry.usd);
        updated.set(chainId, unixSecondsToMs(entry.last_updated_at));
      }
    }
    return out;
  } catch {
    return new Map<number, number>();
  }
}
