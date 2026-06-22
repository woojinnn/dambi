import { afterEach, describe, expect, it, vi } from "vitest";

async function loadStore(sendHandler) {
  vi.resetModules();
  delete window.DambiStore;
  window.DambiPs2 = {
    deriveBaseline: () => [],
    derivePopupPackages: () => [],
  };

  const runtime = {
    lastError: null,
    sendMessage: vi.fn((msg, cb) => {
      queueMicrotask(() => sendHandler(msg, cb));
    }),
  };
  const chromeStub = {
    runtime,
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      sync: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
  globalThis.chrome = chromeStub;
  window.chrome = chromeStub;

  await import("./store.js");
  return window.DambiStore;
}

afterEach(() => {
  delete globalThis.chrome;
  delete window.chrome;
  delete window.DambiStore;
  delete window.DambiPs2;
  vi.restoreAllMocks();
});

describe("DambiStore popup wallet normalization", () => {
  it("filters malformed wallet summaries before exposing popup state", async () => {
    const valid = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const longLabel = "x".repeat(90);
    const store = await loadStore((msg, cb) => {
      if (msg.type === "dambi-auth-status") {
        cb({ ok: true, data: { email: "user@example.com", user_id: "u1" } });
        return;
      }
      if (msg.type === "dambi-list-wallet-summaries") {
        cb({
          ok: true,
          data: [
            { address: '<img src=x onerror="alert(1)">', label: "bad" },
            { address: valid.toUpperCase(), label: "  " + longLabel + "  " },
          ],
        });
        return;
      }
      if (msg.type === "ps2:get-library") {
        cb({ ok: true, data: { library: { defs: {}, packages: {} } } });
        return;
      }
      if (msg.type === "ps2:get-wallet-state") {
        cb({ ok: true, data: { bindings: {}, packageEnabled: {} } });
        return;
      }
      cb({ ok: false, error: { kind: "unexpected", message: msg.type } });
    });

    const state = await store.loadState();

    expect(state.wallets).toEqual([
      {
        address: valid,
        nickname: longLabel.slice(0, 80),
        pinned: false,
      },
    ]);
    expect(state.activeAddress).toBe(valid);
    expect(store.shortAddr('<img src=x onerror="alert(1)">')).toBe("");
    expect(store.shortAddr(valid.toUpperCase())).toBe("0xd8da…6045");
  });
});
