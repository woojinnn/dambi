import { beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard server-api client", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
  });

  it("uses the Vite server URL when it is defined", async () => {
    vi.stubEnv("VITE_DAMBI_SERVER_URL", "https://dambi-policy.duckdns.org");

    const { SERVER_BASE_URL } = await import("./client");

    expect(SERVER_BASE_URL).toBe("https://dambi-policy.duckdns.org");
  });

  it("normalizes only trusted server base URL overrides", async () => {
    const { normalizeServerBaseUrl } = await import("./client");

    expect(normalizeServerBaseUrl("https://dambi-policy.duckdns.org/")).toBe(
      "https://dambi-policy.duckdns.org",
    );
    expect(normalizeServerBaseUrl("https://pasu-policy.duckdns.org/")).toBe(
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

  it("ignores an untrusted stored server URL instead of sending tokens to it", async () => {
    window.localStorage.setItem("dambi_server_url", "https://evil.example");
    window.localStorage.setItem("dambi_jwt", "access-token");
    const { request, SERVER_BASE_URL } = await import("./client");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/auth/me")).resolves.toEqual({ ok: true });

    expect(SERVER_BASE_URL).toBe("https://dambi-policy.duckdns.org");
    expect(fetchMock.mock.calls[0][0]).toBe("https://dambi-policy.duckdns.org/auth/me");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: {
        Authorization: "Bearer access-token",
      },
    });
  });

  it("refuses absolute requests to untrusted hosts before attaching auth", async () => {
    window.localStorage.setItem("dambi_jwt", "access-token");
    const { request } = await import("./client");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("https://evil.example/wallets")).rejects.toThrow(
      "untrusted server URL",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes the access token once and retries after a 401", async () => {
    window.localStorage.setItem("dambi_jwt", "old-access");
    window.localStorage.setItem("dambi_jwt_refresh", "refresh-token");
    const { request, setTokenRefreshObserver } = await import("./client");
    const tokenRefreshObserver = vi.fn();
    setTokenRefreshObserver(tokenRefreshObserver);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
        }),
      )
      .mockResolvedValueOnce(Response.json({ user_id: "u_1", email: "a@example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request("/auth/me");

    expect(result).toEqual({ user_id: "u_1", email: "a@example.com" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dambi-policy.duckdns.org/auth/refresh",
    );
    expect(window.localStorage.getItem("dambi_jwt")).toBe("new-access");
    expect(window.localStorage.getItem("dambi_jwt_refresh")).toBe("new-refresh");
    expect(tokenRefreshObserver).toHaveBeenCalledWith("new-access", "new-refresh");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      headers: {
        Authorization: "Bearer new-access",
      },
    });
  });

  it("preserves plain-text error bodies", async () => {
    const { request, ServerError } = await import("./client");
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

  it("does not expose a helper that places bearer tokens in URLs", async () => {
    const client = await import("./client");

    expect(client).not.toHaveProperty("urlWithTokenQuery");
  });
});
