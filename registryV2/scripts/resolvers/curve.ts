/**
 * Curve protocol source resolvers.
 *
 * Curve sources are intentionally file-backed by checked-in P0 universe
 * artifacts. The public Curve API already feeds those universes during P0;
 * build-index should consume the reviewed artifacts instead of performing a
 * second live fetch with a different boundary.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Hex, ProtocolResolvedAddress, ProtocolResolver, ResolverOpts } from "./types.ts";

const REGISTRY_ROOT = process.env.BUILD_INDEX_REGISTRY_ROOT
  ? resolve(process.env.BUILD_INDEX_REGISTRY_ROOT)
  : resolve(new URL("../..", import.meta.url).pathname);
const POOL_UNIVERSE_PATH = join(REGISTRY_ROOT, "surface", "curve", "_pool_universe.json");
const GAUGE_UNIVERSE_PATH = join(REGISTRY_ROOT, "surface", "curve", "_gauge_universe.json");
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS_RE = /^0x0{40}$/i;

interface CurvePoolCandidate {
  chainId?: number;
  chain_id?: number;
  address?: string;
  curve_id?: string;
  name?: string;
  symbol?: string;
  lpTokenAddress?: string;
  lp_token_address?: string;
  gaugeAddress?: string;
  gauge_address?: string;
  coins?: string[];
  families?: string[];
  decision?: string;
}

interface CurvePoolUniverse {
  candidates?: CurvePoolCandidate[];
}

interface CurveGaugeCandidate {
  chainId?: number;
  chain_id?: number;
  address?: string;
  decision?: string;
}

interface CurveGaugeUniverse {
  candidates?: CurveGaugeCandidate[];
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadPoolUniverse(): CurvePoolCandidate[] {
  const parsed = loadJson<CurvePoolUniverse | CurvePoolCandidate[]>(POOL_UNIVERSE_PATH);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.candidates)) return parsed.candidates;
  throw new Error(`curve: ${POOL_UNIVERSE_PATH} has no candidates[]`);
}

function loadGaugeUniverse(): CurveGaugeCandidate[] {
  if (existsSync(GAUGE_UNIVERSE_PATH)) {
    const parsed = loadJson<CurveGaugeUniverse | CurveGaugeCandidate[]>(GAUGE_UNIVERSE_PATH);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.candidates)) return parsed.candidates;
    throw new Error(`curve:gauges: ${GAUGE_UNIVERSE_PATH} has no candidates[]`);
  }

  const candidates = loadPoolUniverse();
  return candidates
    .map((candidate) => ({
      chainId: candidate.chainId ?? candidate.chain_id,
      address: candidate.gaugeAddress ?? candidate.gauge_address,
      decision: candidate.decision,
    }))
    .filter((candidate) => candidate.address);
}

function gaugeAddressesFor(chainId: number): Hex[] {
  const out = new Set<Hex>();
  for (const candidate of loadGaugeUniverse()) {
    const candidateChain = candidate.chainId ?? candidate.chain_id;
    if (candidateChain !== chainId) continue;
    if (candidate.decision && candidate.decision !== "cover") continue;
    const gauge = candidate.address;
    if (!gauge || !ADDRESS_RE.test(gauge) || ZERO_ADDRESS_RE.test(gauge)) continue;
    out.add(gauge.toLowerCase() as Hex);
  }
  return [...out].sort();
}

function candidateAddress(candidate: CurvePoolCandidate): Hex | undefined {
  const address = candidate.address?.toLowerCase();
  if (!address || !ADDRESS_RE.test(address) || ZERO_ADDRESS_RE.test(address)) return undefined;
  return address as Hex;
}

function activeCoins(candidate: CurvePoolCandidate): Hex[] {
  return (candidate.coins ?? [])
    .map((coin) => coin.toLowerCase())
    .filter((coin) => ADDRESS_RE.test(coin) && !ZERO_ADDRESS_RE.test(coin)) as Hex[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function stableNg2CoinEntries(chainId: number): ProtocolResolvedAddress[] {
  const out: ProtocolResolvedAddress[] = [];
  for (const candidate of loadPoolUniverse()) {
    const candidateChain = candidate.chainId ?? candidate.chain_id;
    if (candidateChain !== chainId) continue;
    if (candidate.decision && candidate.decision !== "cover") continue;
    if (!(candidate.families ?? []).includes("factory-stable-ng")) continue;
    const address = candidateAddress(candidate);
    if (!address) continue;
    const coins = activeCoins(candidate);
    if (coins.length !== 2) continue;
    const curveId = candidate.curve_id ?? address;
    const name = candidate.name ?? curveId;
    const symbol = candidate.symbol ?? curveId;
    const lpToken = (candidate.lpTokenAddress ?? candidate.lp_token_address ?? address).toLowerCase();
    if (!ADDRESS_RE.test(lpToken) || ZERO_ADDRESS_RE.test(lpToken)) continue;
    const suffix = `${chainId}-${slugify(curveId)}-${address.slice(2, 10)}`;
    out.push({
      address,
      id_suffix: suffix,
      context: {
        curve_id: curveId,
        pool_name: name,
        symbol,
        lp_token: lpToken,
        coins,
        n_coins: 2,
      },
    });
  }
  return out.sort((a, b) => a.address.localeCompare(b.address));
}

export const gaugesResolver: ProtocolResolver = {
  source: "curve:gauges",
  async resolve(chainId: number, _opts: ResolverOpts): Promise<Hex[]> {
    return gaugeAddressesFor(chainId);
  },
};

function makeStableNg2CoinResolver(
  source: "curve:factory_stable_ng_2coin_mainnet" | "curve:factory_stable_ng_2coin_base",
  expectedChainId: 1 | 8453,
): ProtocolResolver {
  return {
    source,
    async resolve(chainId: number, _opts: ResolverOpts): Promise<Hex[]> {
      if (chainId !== expectedChainId) return [];
      return stableNg2CoinEntries(chainId).map((entry) => entry.address);
    },
    async resolveWithContext(
      chainId: number,
      _opts: ResolverOpts,
    ): Promise<ProtocolResolvedAddress[]> {
      if (chainId !== expectedChainId) return [];
      return stableNg2CoinEntries(chainId);
    },
  };
}

export const stableNg2CoinMainnetResolver = makeStableNg2CoinResolver(
  "curve:factory_stable_ng_2coin_mainnet",
  1,
);

export const stableNg2CoinBaseResolver = makeStableNg2CoinResolver(
  "curve:factory_stable_ng_2coin_base",
  8453,
);
