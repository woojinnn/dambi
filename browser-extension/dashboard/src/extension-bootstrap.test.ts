import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  isExtensionContext: () => true,
}));

describe("extension dashboard bootstrap", () => {
  let pageStore: Map<string, string>;
  let extensionStore: Map<string, string>;
  let onChanged: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null;

  beforeEach(() => {
    vi.resetModules();
    pageStore = new Map();
    extensionStore = new Map();
    onChanged = null;

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => pageStore.get(key) ?? null,
        setItem: (key: string, value: string) => pageStore.set(key, value),
        removeItem: (key: string) => pageStore.delete(key),
        clear: () => pageStore.clear(),
      },
    });

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn(async (keys: string[]) => {
              const out: Record<string, unknown> = {};
              for (const key of keys) {
                if (extensionStore.has(key)) out[key] = extensionStore.get(key);
              }
              return out;
            }),
            remove: vi.fn(async (keys: string[]) => {
              for (const key of keys) extensionStore.delete(key);
            }),
          },
          onChanged: {
            addListener: vi.fn(
              (cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
                onChanged = cb;
              },
            ),
          },
        },
      },
    });
  });

  it("removes stale page tokens when service-worker storage has no token", async () => {
    pageStore.set("dambi_jwt", "stale-access");
    pageStore.set("dambi_jwt_refresh", "stale-refresh");
    const { syncTokensFromExtensionStorage } = await import("./extension-bootstrap");

    await syncTokensFromExtensionStorage();

    expect(window.localStorage.getItem("dambi_jwt")).toBeNull();
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
  });

  it("removes a stale page refresh token when service-worker storage is access-only", async () => {
    pageStore.set("dambi_jwt", "old-access");
    pageStore.set("dambi_jwt_refresh", "stale-refresh");
    extensionStore.set("dambi_jwt", "new-access");
    const { syncTokensFromExtensionStorage } = await import("./extension-bootstrap");

    await syncTokensFromExtensionStorage();

    expect(window.localStorage.getItem("dambi_jwt")).toBe("new-access");
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
  });

  it("mirrors token removal events from service-worker storage", async () => {
    pageStore.set("dambi_jwt", "access");
    pageStore.set("dambi_jwt_refresh", "refresh");
    const { bootstrapExtensionEnv } = await import("./extension-bootstrap");

    await bootstrapExtensionEnv();
    onChanged?.(
      {
        dambi_jwt: {},
        dambi_jwt_refresh: {},
      },
      "local",
    );

    expect(window.localStorage.getItem("dambi_jwt")).toBeNull();
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
  });
});
