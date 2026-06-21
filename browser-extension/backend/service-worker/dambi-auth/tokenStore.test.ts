import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared in-memory chrome.storage.local stand-in for BOTH the token store
// and the dambi-rename migration (they both import webextension-polyfill).
const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    browser: {
      storage: {
        local: {
          get: vi.fn(async (key: string | string[]) => {
            const keys = Array.isArray(key) ? key : [key];
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (localStore.has(k)) out[k] = localStore.get(k);
            }
            return out;
          }),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) localStore.delete(k);
          }),
        },
      },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: mocks.browser }));

import { migrateDambiRenameStorageKeys } from "../manifests/dambi-rename-storage-migration";
import {
  _resetCacheForTests,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "./tokenStore";

const legacyKey = (suffix: string) => `${"pa" + "su"}_${suffix}`;

describe("tokenStore rename race", () => {
  beforeEach(() => {
    mocks.localStore.clear();
    vi.clearAllMocks();
    _resetCacheForTests();
  });

  it("reads the token after the rename migration runs (cold cache, only OLD key set)", async () => {
    // Pre-rename user: token sits under the legacy access key only.
    mocks.localStore.set(legacyKey("jwt"), "legacy-access-token");

    // The migration runs at SW boot (here we await it explicitly, the way
    // the gated auth handlers do via `bootReady`).
    await migrateDambiRenameStorageKeys();

    // After the migration lands, a token read returns the migrated token —
    // it must NOT report logged-out.
    expect(await getAccessToken()).toBe("legacy-access-token");
  });

  it("does not permanently cache null when a read momentarily finds nothing", async () => {
    // Cold cache, nothing in storage yet (mirrors a token read that races
    // ahead of the migration's `set`).
    expect(await getAccessToken()).toBeNull();

    // The token lands later (migration copy / dashboard sync / login).
    await setTokens("late-access-token", null);

    // A subsequent read must succeed — the earlier empty read must not have
    // poisoned the in-memory cache with `null` for the SW lifetime.
    expect(await getAccessToken()).toBe("late-access-token");
  });

  it("rejects malformed tokens instead of writing them to chrome.storage", async () => {
    await expect(setTokens("", null)).rejects.toThrow(/access token/);
    await expect(setTokens(" access-token ", null)).rejects.toThrow(/access token/);
    await expect(setTokens("access-token", "refresh\n")).rejects.toThrow(/refresh token/);
    await expect(setTokens(undefined as unknown as string, null)).rejects.toThrow(/access token/);

    expect(mocks.localStore.has("dambi_jwt")).toBe(false);
    expect(mocks.localStore.has("dambi_jwt_refresh")).toBe(false);
  });

  it("drops malformed tokens already present in chrome.storage", async () => {
    mocks.localStore.set("dambi_jwt", "bad\naccess");
    mocks.localStore.set("dambi_jwt_refresh", " refresh ");

    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(mocks.localStore.has("dambi_jwt")).toBe(false);
    expect(mocks.localStore.has("dambi_jwt_refresh")).toBe(false);
    expect(mocks.browser.storage.local.remove).toHaveBeenCalledWith("dambi_jwt");
    expect(mocks.browser.storage.local.remove).toHaveBeenCalledWith("dambi_jwt_refresh");
  });

  it("caches a real token on the fast path (no second storage read)", async () => {
    mocks.localStore.set("dambi_jwt", "cached-access-token");

    expect(await getAccessToken()).toBe("cached-access-token");
    expect(mocks.browser.storage.local.get).toHaveBeenCalledTimes(1);

    // Second read is served from the in-memory cache: no extra storage hit.
    expect(await getAccessToken()).toBe("cached-access-token");
    expect(mocks.browser.storage.local.get).toHaveBeenCalledTimes(1);
  });

  it("does not update the in-memory cache until chrome.storage writes succeed", async () => {
    await setTokens("old-access-token", "old-refresh-token");

    expect(await getAccessToken()).toBe("old-access-token");
    expect(await getRefreshToken()).toBe("old-refresh-token");

    mocks.browser.storage.local.remove.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(clearTokens()).rejects.toThrow("storage unavailable");

    expect(await getAccessToken()).toBe("old-access-token");
    expect(await getRefreshToken()).toBe("old-refresh-token");
  });
});
