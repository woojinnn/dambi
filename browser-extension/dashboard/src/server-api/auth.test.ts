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
    vi.unstubAllGlobals();
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

  it("clears malformed callback tokens and clears the service-worker mirror", async () => {
    window.localStorage.setItem("dambi_jwt", "old-access");
    window.localStorage.setItem("dambi_jwt_refresh", "old-refresh");
    window.history.replaceState(
      null,
      "",
      "/auth/callback#access_token=bad%0Aaccess&refresh_token=refresh",
    );
    const { consumeTokensFromHash } = await import("./auth");

    expect(consumeTokensFromHash()).toBeNull();

    expect(window.localStorage.getItem("dambi_jwt")).toBeNull();
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
    expect(window.location.hash).toBe("");
    expect(bridge.sendToExtension).toHaveBeenCalledWith({
      type: "dambi-auth-sync-tokens",
      access: null,
      refresh: null,
    });
  });

  it("clears token-bearing callback fragments when the access token is missing", async () => {
    window.localStorage.setItem("dambi_jwt", "old-access");
    window.localStorage.setItem("dambi_jwt_refresh", "old-refresh");
    window.history.replaceState(null, "", "/auth/callback#refresh_token=refresh-only");
    const { consumeTokensFromHash } = await import("./auth");

    expect(consumeTokensFromHash()).toBeNull();

    expect(window.localStorage.getItem("dambi_jwt")).toBeNull();
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
    expect(window.location.hash).toBe("");
    expect(bridge.sendToExtension).toHaveBeenCalledWith({
      type: "dambi-auth-sync-tokens",
      access: null,
      refresh: null,
    });
  });

  it("clears the service-worker mirror when /auth/me rejects the stored token", async () => {
    window.localStorage.setItem("dambi_jwt", "old-access");
    window.localStorage.setItem("dambi_jwt_refresh", "old-refresh");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("unauthorized", { status: 401, statusText: "Unauthorized" }),
        )
        .mockResolvedValueOnce(
          new Response("refresh denied", { status: 401, statusText: "Unauthorized" }),
        ),
    );
    const { fetchMe } = await import("./auth");

    await expect(fetchMe()).rejects.toMatchObject({ status: 401 });

    expect(window.localStorage.getItem("dambi_jwt")).toBeNull();
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
    expect(bridge.sendToExtension).toHaveBeenCalledWith({
      type: "dambi-auth-sync-tokens",
      access: null,
      refresh: null,
    });
  });

  it("mirrors logout to the service-worker token store", async () => {
    window.localStorage.setItem("dambi_jwt", "old-access");
    window.localStorage.setItem("dambi_jwt_refresh", "old-refresh");
    const { logout } = await import("./auth");

    logout();

    expect(window.localStorage.getItem("dambi_jwt")).toBeNull();
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBeNull();
    expect(bridge.sendToExtension).toHaveBeenCalledWith({
      type: "dambi-auth-sync-tokens",
      access: null,
      refresh: null,
    });
  });
});
