import type { VenueOrderPayload } from "@lib/types";
import { infoBaseForEndpoint } from "./hl-info-client";
import { recoverHlL1Signer } from "./hl-signature-recovery";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const AGENTS_TTL_MS = 60_000;
const MAX_AGENT_CACHE_ENTRIES = 256;
const DEFAULT_TIMEOUT_MS = 1_000;

interface CacheEntry {
  agents: ReadonlySet<string>;
  fetchedAtMs: number;
}

const agentCache = new Map<string, CacheEntry>();
const agentInflight = new Map<string, Promise<ReadonlySet<string> | null>>();

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_RE.test(value)
    ? value.toLowerCase()
    : null;
}

function cacheKey(endpoint: string, master: string): string {
  return `${endpoint}:${master.toLowerCase()}`;
}

function extractAgents(value: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    const agent =
      item && typeof item === "object"
        ? normalizeAddress((item as { address?: unknown }).address)
        : null;
    if (agent) out.add(agent);
  }
  return out;
}

async function fetchExtraAgents(
  infoEndpoint: string,
  master: string,
): Promise<ReadonlySet<string> | null> {
  const key = cacheKey(infoEndpoint, master);
  const cached = agentCache.get(key);
  if (cached && Date.now() - cached.fetchedAtMs < AGENTS_TTL_MS) {
    return cached.agents;
  }
  const existing = agentInflight.get(key);
  if (existing) return existing;
  if (agentInflight.size >= MAX_AGENT_CACHE_ENTRIES) return null;

  const p = (async (): Promise<ReadonlySet<string> | null> => {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(infoEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "extraAgents", user: master }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const agents = extractAgents(await res.json());
      agentCache.delete(key);
      agentCache.set(key, { agents, fetchedAtMs: Date.now() });
      while (agentCache.size > MAX_AGENT_CACHE_ENTRIES) {
        const oldest = agentCache.keys().next().value;
        if (oldest === undefined) break;
        agentCache.delete(oldest);
      }
      return agents;
    } catch {
      return null;
    } finally {
      clearTimeout(handle);
      agentInflight.delete(key);
    }
  })();

  agentInflight.set(key, p);
  return p;
}

function uniqueAddresses(addresses: readonly string[]): string[] {
  return [
    ...new Set(
      addresses.map(normalizeAddress).filter((a): a is string => a !== null),
    ),
  ];
}

/**
 * Deterministically bind a signed HL `/exchange` request to one synced master.
 *
 * Safe cases only:
 *   - recovered signer is itself one synced master (direct master signing), or
 *   - recovered signer is listed as an `extraAgents` API wallet for exactly one
 *     synced master.
 *
 * Ambiguous, missing, or failed API data returns `null`; callers may still use a
 * weaker fallback such as "only one synced wallet".
 */
export async function resolveHlMasterFromSignedAgent(
  payload: VenueOrderPayload,
  syncedMasters: readonly string[],
): Promise<string | null> {
  const masters = uniqueAddresses(syncedMasters);
  if (masters.length === 0) return null;

  const signer = await recoverHlL1Signer(payload.hlEnvelope, payload.endpoint);
  if (!signer) return null;

  const direct = masters.filter((master) => master === signer);
  if (direct.length === 1) return direct[0];

  const infoEndpoint = infoBaseForEndpoint(payload.endpoint);
  const matches = (
    await Promise.all(
      masters.map(async (master) => {
        const agents = await fetchExtraAgents(infoEndpoint, master);
        return agents?.has(signer) ? master : null;
      }),
    )
  ).filter((master): master is string => master !== null);

  return matches.length === 1 ? matches[0] : null;
}

export function resetHlAgentMasterCacheForTests(): void {
  agentCache.clear();
  agentInflight.clear();
}
