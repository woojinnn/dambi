import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  sendToExtension: vi.fn(),
}));

vi.mock("./extension-bridge", () => ({
  sendToExtension: bridge.sendToExtension,
  ExtensionBridgeTimeout: class ExtensionBridgeTimeout extends Error {},
}));

describe("dashboard server-api auth", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storage = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    bridge.sendToExtension.mockResolvedValue({ ok: true, data: null });
    window.history.replaceState(null, "", "/");
  });

  it("consumes access-only dashboard callbacks without storing a refresh token", async () => {
    window.localStorage.setItem("dambi_jwt_refresh", "stale-refresh");
    window.history.replaceState(null, "", "/auth/callback#access_token=access-only");
    const { consumeTokensFromHash } = await import("./auth");

    expect(consumeTokensFromHash()).toBe("access-only");

    expect(window.localStorage.getItem("dambi_jwt")).toBe("access-only");
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
    expect(window.location.hash).toBe("");
    expect(bridge.sendToExtension).toHaveBeenCalledWith({
      type: "dambi-auth-sync-tokens",
      access: "access-only",
      refresh: null,
    });
  });

  it("keeps optional refresh tokens for extension OAuth redirects", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/callback#access_token=access&refresh_token=refresh",
    );
    const { consumeTokensFromHash } = await import("./auth");

    expect(consumeTokensFromHash()).toBe("access");

    expect(window.localStorage.getItem("dambi_jwt")).toBe("access");
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBe("refresh");
    expect(bridge.sendToExtension).toHaveBeenCalledWith({
      type: "dambi-auth-sync-tokens",
      access: "access",
      refresh: "refresh",
    });
  });
});
