/**
 * Layer 2 — persistent v3 adapter bundle cache (plan §M3 mirror).
 *
 * Mirrors {@link adapter-cache.ts}'s `PersistentAdapterCache` but stores
 * v3 ({@link V3Bundle}) hydrations keyed by the already-serialized
 * callkey string produced by `v3CallkeyCacheKey`. Layer 1
 * (`v3InstallCache` + WASM `DECLARATIVE_V3_STATE`) is in-memory and
 * disappears with the SW (~30s idle). Layer 2 persists each JIT-fetched
 * v3 bundle into `chrome.storage.local` so a cold SW can re-install
 * without another `registry-api-v3` round-trip.
 *
 * Eviction: insertion-order LRU (Map order) + TTL (24h). Identical
 * semantics to the v1 cache so DevTools / debug tooling can treat the
 * two storage records uniformly.
 */
import Browser from "webextension-polyfill";
import type { V3Bundle } from "./bundle-schema";

const STORAGE_KEY_V3 = "registry:adapter-bundles-v3";
const MAX_V3_CACHE_ENTRIES = 256;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface DeclarativeV3CacheEntry {
  bundle: V3Bundle;
  bundleId: string;
  decoderId: string;
  bundleSha256: string;
  fetchedAtMs: number;
}

function isDeclarativeV3CacheEntry(v: unknown): v is DeclarativeV3CacheEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.bundle === "object" && o.bundle !== null &&
    typeof o.bundleId === "string" &&
    typeof o.decoderId === "string" &&
    typeof o.bundleSha256 === "string" &&
    typeof o.fetchedAtMs === "number"
  );
}

class PersistentDeclarativeV3Cache {
  private readonly mem = new Map<string, DeclarativeV3CacheEntry>();
  private hydrated = false;

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const got = (await Browser.storage.local.get(
        STORAGE_KEY_V3,
      )) as Record<string, unknown>;
      const stored = got[STORAGE_KEY_V3] as
        | Record<string, DeclarativeV3CacheEntry>
        | undefined;
      if (stored) {
        const now = Date.now();
        for (const [k, v] of Object.entries(stored)) {
          if (isDeclarativeV3CacheEntry(v) && now - v.fetchedAtMs < TTL_MS) {
            this.mem.set(k, v);
          }
        }
      }
    } catch {
      /* degrade to fetch-every-time */
    }
    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    try {
      const record: Record<string, DeclarativeV3CacheEntry> = {};
      for (const [k, v] of this.mem) record[k] = v;
      await Browser.storage.local.set({ [STORAGE_KEY_V3]: record });
    } catch {
      /* non-fatal — in-memory copy still serves this lifetime */
    }
  }

  /**
   * Look up a v3 cache entry by the already-serialized callkey string
   * (matches what `v3CallkeyCacheKey` produces). Returns `null` when
   * absent or TTL-expired; touches the entry on hit to refresh its LRU
   * position.
   */
  async get(callkey: string): Promise<DeclarativeV3CacheEntry | null> {
    await this.hydrate();
    const entry = this.mem.get(callkey);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAtMs >= TTL_MS) {
      this.mem.delete(callkey);
      void this.persist();
      return null;
    }
    this.mem.delete(callkey); // touch — LRU 갱신
    this.mem.set(callkey, entry);
    return entry;
  }

  /**
   * Persist a v3 cache entry under `callkey`. Evicts the oldest entry
   * (Map insertion order) once the cap is exceeded, then writes the
   * entire record back to `chrome.storage.local`.
   */
  async put(callkey: string, entry: DeclarativeV3CacheEntry): Promise<void> {
    await this.hydrate();
    this.mem.delete(callkey);
    this.mem.set(callkey, entry);
    while (this.mem.size > MAX_V3_CACHE_ENTRIES) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
    await this.persist();
  }

  /**
   * Debug / inspection helper — returns a shallow copy of the current
   * in-memory map (after hydrating from storage). Callers MUST treat
   * the returned map as read-only.
   */
  async getAllEntries(): Promise<Map<string, DeclarativeV3CacheEntry>> {
    await this.hydrate();
    return new Map(this.mem);
  }

  reset(): void {
    this.mem.clear();
    this.hydrated = false;
  }
}

export const declarativeV3Cache = new PersistentDeclarativeV3Cache();

/**
 * Test helper — drops the in-memory map and clears the hydration
 * latch. Mirrors `__resetAdapterCacheForTest` so vitest cases start
 * from a cold slate. Does NOT touch `chrome.storage.local` itself;
 * the caller must clear the mock store separately when needed.
 */
export function __resetDeclarativeV3CacheStorageForTest(): void {
  declarativeV3Cache.reset();
}
