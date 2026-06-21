import { beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard wallet API client", () => {
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

  it("normalizes wallet addresses before constructing authenticated wallet requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const {
      addWallet,
      deleteWallet,
      getWalletApprovalsWithRisk,
      normalizeWalletAddress,
      patchWallet,
      syncWallet,
    } = await import("./wallets");

    expect(normalizeWalletAddress("0xA100000000000000000000000000000000000001")).toBe(
      "0xa100000000000000000000000000000000000001",
    );

    await addWallet({
      address: "0xA100000000000000000000000000000000000001",
      chains: ["eip155:1"],
      label: "Cold",
    });
    await syncWallet("0xA100000000000000000000000000000000000001");
    await getWalletApprovalsWithRisk("0xA100000000000000000000000000000000000001");
    await patchWallet("0xA100000000000000000000000000000000000001", { label: "Vault" });
    await deleteWallet("0xA100000000000000000000000000000000000001");

    expect(fetchMock.mock.calls[0][0]).toBe("https://dambi-policy.duckdns.org/wallets");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      address: "0xa100000000000000000000000000000000000001",
      chains: ["eip155:1"],
      label: "Cold",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001/sync",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001/approvals?with_risk=true",
    );
    expect(fetchMock.mock.calls[3][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001",
    );
    expect(fetchMock.mock.calls[4][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001",
    );
  });

  it("rejects malformed wallet addresses before attaching bearer tokens to fetches", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { addWallet, deleteWallet, getWalletState, syncWallet } = await import("./wallets");

    await expect(addWallet({ address: "0xabc" })).rejects.toThrow(/EVM address/);
    await expect(syncWallet("../auth/refresh")).rejects.toThrow(/EVM address/);
    await expect(getWalletState("0xa100000000000000000000000000000000000001/approvals")).rejects.toThrow(
      /EVM address/,
    );
    await expect(deleteWallet("constructor")).rejects.toThrow(/EVM address/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes other dashboard address path wrappers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const { getSpender } = await import("./catalog");
    const { getWalletPending, getWalletPositions } = await import("./positions");

    await getWalletPositions("0xA100000000000000000000000000000000000001");
    await getWalletPending("0xA100000000000000000000000000000000000001");
    await getSpender("0xA100000000000000000000000000000000000001");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001/positions",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dambi-policy.duckdns.org/wallets/0xa100000000000000000000000000000000000001/pending",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://dambi-policy.duckdns.org/spenders/0xa100000000000000000000000000000000000001",
    );
  });

  it("rejects malformed addresses in other dashboard address path wrappers", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { getSpender } = await import("./catalog");
    const { getWalletPending, getWalletPositions } = await import("./positions");

    await expect(getWalletPositions("../auth/me")).rejects.toThrow(/EVM address/);
    await expect(getWalletPending("0xabc")).rejects.toThrow(/EVM address/);
    await expect(getSpender("0xa100000000000000000000000000000000000001/labels")).rejects.toThrow(
      /EVM address/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
