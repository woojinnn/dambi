import { beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard capabilities API client", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    storage = new Map([["dambi_jwt", "access-token"]]);
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

  it("requests server-supported sync chains", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({ chains: ["eip155:1", "eip155:42161", "eip155:8453"] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listSyncChains } = await import("./capabilities");
    const resp = await listSyncChains();

    expect(resp.chains).toEqual(["eip155:1", "eip155:42161", "eip155:8453"]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dambi-policy.duckdns.org/capabilities/sync-chains",
    );
  });
});
