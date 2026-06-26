import { describe, expect, it, vi } from "vitest";

import {
  createEthereumProviderDiscovery,
  resolveUniqueConnectedAccount,
  type InpageEthProvider,
} from "../connected-account";

const A = "0x676fa5b94067c2be14bc025df6c5c80dedf49a54";
const B = "0x7777777777777777777777777777777777777777";

function provider(account: string | null): InpageEthProvider {
  return {
    request: vi.fn(async (request: { method: string }) => {
      if (request.method !== "eth_accounts") return [];
      return account ? [account] : [];
    }),
  };
}

describe("resolveUniqueConnectedAccount", () => {
  it("returns the only connected account across discovered providers", async () => {
    const resolved = await resolveUniqueConnectedAccount(
      [provider(A.toUpperCase()), provider(A)],
      10,
    );

    expect(resolved).toEqual({
      account: A,
      reason: "single",
      accounts: [A],
      providerCount: 2,
    });
  });

  it("returns multiple instead of guessing across distinct connected providers", async () => {
    const resolved = await resolveUniqueConnectedAccount(
      [provider(A), provider(B)],
      10,
    );

    expect(resolved).toEqual({
      account: null,
      reason: "multiple",
      accounts: [A, B],
      providerCount: 2,
    });
  });

  it("returns none when no provider exposes an account", async () => {
    const resolved = await resolveUniqueConnectedAccount([provider(null)], 10);

    expect(resolved).toEqual({
      account: null,
      reason: "none",
      accounts: [],
      providerCount: 1,
    });
  });
});

describe("createEthereumProviderDiscovery", () => {
  it("discovers nested window.ethereum.providers entries", () => {
    const nested = provider(A);
    (window as unknown as { ethereum?: unknown }).ethereum = {
      providers: [nested],
    };

    const discovery = createEthereumProviderDiscovery(window);
    try {
      expect(discovery.providers()).toEqual([nested]);
    } finally {
      discovery.dispose();
      delete (window as unknown as { ethereum?: unknown }).ethereum;
    }
  });

  it("discovers EIP-6963 announced providers", () => {
    const announced = provider(A);
    const discovery = createEthereumProviderDiscovery(window);
    try {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { provider: announced },
        }),
      );

      expect(discovery.providers()).toContain(announced);
    } finally {
      discovery.dispose();
    }
  });

  it("fires the change callback on account changes", () => {
    const accountListeners: Array<() => void> = [];
    const eth: InpageEthProvider = {
      request: vi.fn(async () => [A]),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "accountsChanged") {
          accountListeners.push(() => cb([B]));
        }
      }),
    };
    (window as unknown as { ethereum?: unknown }).ethereum = eth;
    const changed = vi.fn();

    const discovery = createEthereumProviderDiscovery(window, changed);
    try {
      changed.mockClear();
      expect(accountListeners).toHaveLength(1);
      accountListeners[0]();
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      discovery.dispose();
      delete (window as unknown as { ethereum?: unknown }).ethereum;
    }
  });
});
