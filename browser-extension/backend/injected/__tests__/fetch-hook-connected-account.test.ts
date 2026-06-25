import { beforeEach, describe, expect, it, vi } from "vitest";

const streamState = vi.hoisted(() => ({
  instances: [] as MockStream[],
}));

class MockStream {
  writes: Array<{ requestId: string; data: unknown }> = [];

  write(message: { requestId: string; data: unknown }): boolean {
    this.writes.push(message);
    return true;
  }
}

function policyWrites(): Array<{ requestId: string; data: unknown }> {
  return (streamState.instances[0]?.writes ?? []).filter(
    (write) => (write.data as { type?: string }).type !== "execution-report",
  );
}

vi.mock("@metamask/post-message-stream", () => ({
  WindowPostMessageStream: class extends MockStream {
    constructor() {
      super();
      streamState.instances.push(this);
    }
  },
}));

vi.mock("@lib/verdict-channel", () => ({
  createVerdictReceiver: () => ({
    awaitVerdict: async () => true,
  }),
}));

describe("fetch-hook connected account stamping", () => {
  beforeEach(() => {
    vi.resetModules();
    streamState.instances.length = 0;
    delete (window as unknown as { ethereum?: unknown }).ethereum;
    delete (window as unknown as Record<PropertyKey, unknown>)[
      Symbol.for("__dambi_fetch_hook_install_state__")
    ];
    vi.stubGlobal("location", {
      href: "https://app.hyperliquid.xyz/trade",
      hostname: "app.hyperliquid.xyz",
      origin: "https://app.hyperliquid.xyz",
    });
    (window as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
  });

  it("stamps wallet_id from a connected EIP-6963 provider", async () => {
    const connected = "0x676fa5b94067c2be14bc025df6c5c80dedf49a54";
    const provider = {
      request: vi.fn(async (request: { method: string }) => {
        if (request.method === "eth_accounts") return [connected];
        return [];
      }),
    };
    window.addEventListener(
      "eip6963:requestProvider",
      () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: { provider },
          }),
        );
      },
      { once: true },
    );

    await import("../fetch-hook");

    await window.fetch("https://api-ui.hyperliquid.xyz/exchange", {
      method: "POST",
      body: JSON.stringify({
        action: {
          type: "order",
          orders: [
            {
              a: 0,
              b: false,
              p: "147.71",
              s: "0.06",
              r: false,
              t: { limit: { tif: "Gtc" } },
            },
          ],
          grouping: "na",
        },
      }),
    });

    expect(policyWrites()).toHaveLength(1);
    expect(policyWrites()[0].data).toMatchObject({
      wallet_id: { address: connected, chains: [] },
    });
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  it("leaves wallet_id unstamped when connected providers disagree", async () => {
    const first = {
      request: vi.fn(async (request: { method: string }) => {
        if (request.method === "eth_accounts") {
          return ["0x676fa5b94067c2be14bc025df6c5c80dedf49a54"];
        }
        return [];
      }),
    };
    const second = {
      request: vi.fn(async (request: { method: string }) => {
        if (request.method === "eth_accounts") {
          return ["0x7777777777777777777777777777777777777777"];
        }
        return [];
      }),
    };
    window.addEventListener(
      "eip6963:requestProvider",
      () => {
        for (const provider of [first, second]) {
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
              detail: { provider },
            }),
          );
        }
      },
      { once: true },
    );

    await import("../fetch-hook");

    await window.fetch("https://api-ui.hyperliquid.xyz/exchange", {
      method: "POST",
      body: JSON.stringify({
        action: {
          type: "order",
          orders: [
            {
              a: 0,
              b: false,
              p: "147.71",
              s: "0.06",
              r: false,
              t: { limit: { tif: "Gtc" } },
            },
          ],
          grouping: "na",
        },
      }),
    });

    expect(policyWrites()).toHaveLength(1);
    expect(policyWrites()[0].data).not.toHaveProperty("wallet_id");
  });
});
