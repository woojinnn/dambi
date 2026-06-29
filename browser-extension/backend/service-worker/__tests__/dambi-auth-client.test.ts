import { beforeEach, describe, expect, it, vi } from "vitest";

const legacyPolicyBase = `https://${"pa" + "su"}-policy.duckdns.org`;

const tokenStore = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  getRefreshToken: vi.fn<() => Promise<string | null>>(),
  setTokens: vi.fn<(access: string | null, refresh?: string | null) => Promise<void>>(),
}));

vi.mock("../dambi-auth/tokenStore", () => tokenStore);

import {
  addWallet,
  deleteWallet,
  getServerBaseUrl,
  normalizeWalletAddress,
  normalizeServerBaseUrl,
  request,
  ServerError,
  setOnSessionExpired,
  resetSessionExpiredGuard,
  updateWallet,
} from "../dambi-auth/client";

describe("dambi-auth client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    setOnSessionExpired(null);
    resetSessionExpiredGuard();
  });

  it("normalizes only trusted server base URL overrides", () => {
    expect(normalizeServerBaseUrl("https://dambi-policy.duckdns.org/")).toBe(
      "https://dambi-policy.duckdns.org",
    );
    expect(normalizeServerBaseUrl(`${legacyPolicyBase}/`)).toBe(
      "https://dambi-policy.duckdns.org",
    );
    expect(normalizeServerBaseUrl("http://127.0.0.1:8788")).toBe(
      "http://127.0.0.1:8788",
    );
    expect(normalizeServerBaseUrl("https://evil.example")).toBeNull();
    expect(normalizeServerBaseUrl("https://dambi-policy.duckdns.org.evil.example")).toBeNull();
    expect(normalizeServerBaseUrl("https://user@dambi-policy.duckdns.org")).toBeNull();
    expect(normalizeServerBaseUrl("https://dambi-policy.duckdns.org/api")).toBeNull();
  });

  it("normalizes wallet addresses before constructing authenticated wallet requests", async () => {
    tokenStore.getAccessToken.mockResolvedValue("access-token");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(normalizeWalletAddress("0xA100000000000000000000000000000000000001")).toBe(
      "0xa100000000000000000000000000000000000001",
    );

    await addWallet({
      address: "0xA100000000000000000000000000000000000001",
      chains: ["eip155:1"],
      label: "cold",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      address: "0xa100000000000000000000000000000000000001",
      chains: ["eip155:1"],
      label: "cold",
    });

    await updateWallet("0xA100000000000000000000000000000000000001", { label: "cold" });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001",
    );
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      label: "cold",
    });

    await deleteWallet("0xA100000000000000000000000000000000000001");
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001",
    );
  });

  it("rejects malformed wallet addresses before authenticated wallet fetches", async () => {
    tokenStore.getAccessToken.mockResolvedValue("access-token");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateWallet("0xabc", { label: "bad" })).rejects.toThrow(/EVM address/);
    await expect(deleteWallet("../auth/refresh")).rejects.toThrow(/EVM address/);
    await expect(
      addWallet({ address: "0xa100000000000000000000000000000000000001/permits" }),
    ).rejects.toThrow(/EVM address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps runtime storage server overrides on the trusted allowlist", async () => {
    vi.resetModules();
    const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            dambi_server_url: "https://evil.example",
          }),
        },
        onChanged: {
          addListener: vi.fn(
            (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) =>
              listeners.push(listener),
          ),
        },
      },
    });

    const client = await import("../dambi-auth/client");
    await Promise.resolve();

    expect(client.getServerBaseUrl()).toBe("https://dambi-policy.duckdns.org");
    expect(getServerBaseUrl()).toBe("https://dambi-policy.duckdns.org");
    expect(listeners).toHaveLength(1);
    const onChanged = listeners[0]!;

    onChanged(
      {
        dambi_server_url: { newValue: "http://127.0.0.1:8788" },
      },
      "local",
    );
    expect(client.getServerBaseUrl()).toBe("http://127.0.0.1:8788");

    onChanged(
      {
        dambi_server_url: { newValue: "https://evil.example" },
      },
      "local",
    );
    expect(client.getServerBaseUrl()).toBe("https://dambi-policy.duckdns.org");
  });

  it("refuses absolute requests to untrusted hosts before attaching auth", async () => {
    tokenStore.getAccessToken.mockResolvedValue("access-token");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("https://evil.example/wallets")).rejects.toThrow(
      "untrusted server URL",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed explicit access-token overrides before fetch", async () => {
    tokenStore.getAccessToken.mockResolvedValue("stored-token");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/wallets", { token: "" })).rejects.toThrow(
      /request access token/,
    );
    await expect(request("/wallets", { token: "bad\naccess" })).rejects.toThrow(
      /request access token/,
    );
    await expect(request("/wallets", { token: " access " })).rejects.toThrow(
      /request access token/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes the access token once and retries after a 401", async () => {
    tokenStore.getAccessToken.mockResolvedValue("old-access");
    tokenStore.getRefreshToken.mockResolvedValue("refresh-token");
    tokenStore.setTokens.mockResolvedValue(undefined);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
        }),
      )
      .mockResolvedValueOnce(Response.json([{ address: "0x1", chains: [] }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request("/wallets");

    expect(result).toEqual([{ address: "0x1", chains: [] }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dambi-policy.duckdns.org/auth/refresh",
    );
    expect(tokenStore.setTokens).toHaveBeenCalledWith("new-access", "new-refresh");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      headers: {
        Authorization: "Bearer new-access",
      },
    });
  });

  it("clears tokens when refresh returns a malformed token", async () => {
    tokenStore.getAccessToken.mockResolvedValue("old-access");
    tokenStore.getRefreshToken.mockResolvedValue("refresh-token");
    tokenStore.setTokens
      .mockRejectedValueOnce(new Error("access token must be a non-empty token string"))
      .mockResolvedValueOnce(undefined);

    const onExpired = vi.fn();
    setOnSessionExpired(onExpired);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          access_token: "bad\naccess",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/auth/me")).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tokenStore.setTokens).toHaveBeenNthCalledWith(1, "bad\naccess", "refresh-token");
    expect(tokenStore.setTokens).toHaveBeenNthCalledWith(2, null, null);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("preserves plain-text error bodies", async () => {
    tokenStore.getAccessToken.mockResolvedValue("access-token");
    tokenStore.getRefreshToken.mockResolvedValue(null);

    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("no chains configured on the server", { status: 400 }),
        ),
    );

    await expect(request("/wallets", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ServerError",
      status: 400,
      body: "no chains configured on the server",
    } satisfies Partial<InstanceType<typeof ServerError>>);
  });

  it("fires onSessionExpired once when the refresh fails (logged-in → out)", async () => {
    tokenStore.getAccessToken.mockResolvedValue("old-access");
    tokenStore.getRefreshToken.mockResolvedValue("refresh-token");
    tokenStore.setTokens.mockResolvedValue(undefined);

    const onExpired = vi.fn();
    setOnSessionExpired(onExpired);

    // 401 → refresh attempt fails (401) → setTokens(null,null), no retry.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("refresh denied", { status: 401 }))
      // The original 401 response is parsed → ServerError.
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/wallets")).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.setTokens).toHaveBeenCalledWith(null, null);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire onSessionExpired on a second failed refresh (guard)", async () => {
    tokenStore.getAccessToken.mockResolvedValue("old-access");
    tokenStore.getRefreshToken.mockResolvedValue("refresh-token");
    tokenStore.setTokens.mockResolvedValue(undefined);

    const onExpired = vi.fn();
    setOnSessionExpired(onExpired);

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("unauthorized", { status: 401 }),
      ),
    );

    // Two separate requests both hit a 401 → failed refresh. The guard means
    // only the first logged-in→out transition notifies.
    await expect(request("/wallets")).rejects.toMatchObject({ status: 401 });
    await expect(request("/wallets")).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
