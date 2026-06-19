import { afterEach, describe, expect, it, vi } from "vitest";

import { sendToExtension } from "./extension-bridge";

describe("extension bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses chrome.runtime.sendMessage when the dashboard runs inside the extension", async () => {
    const payload = { type: "dashboard:ping" };
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { version: 1 } });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    // The direct runtime path is only taken on the extension's own pages.
    vi.stubGlobal("location", { protocol: "chrome-extension:" });

    await expect(sendToExtension(payload, 10)).resolves.toEqual({ version: 1 });
    expect(sendMessage).toHaveBeenCalledWith(payload);
  });

  it("surfaces direct runtime error envelopes", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: { kind: "parse_failed", message: "bad cedar" },
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    vi.stubGlobal("location", { protocol: "chrome-extension:" });

    await expect(
      sendToExtension({ type: "dashboard:put-raw" }, 10),
    ).rejects.toMatchObject({
      name: "ExtensionBridgeError",
      kind: "parse_failed",
      message: "bad cedar",
    });
  });

  it("accepts postMessage bridge responses only from the same window, origin, and request id", async () => {
    const requestId = "00000000-0000-4000-8000-000000000000";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);

    const pending = sendToExtension<string>({ type: "dashboard:ping" }, 100);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "https://evil.example",
        data: {
          source: "dambi-extension",
          id: requestId,
          response: { ok: true, data: "evil-origin" },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: {
          source: "dambi-extension",
          id: "wrong-id",
          response: { ok: true, data: "wrong-id" },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: {
          source: "dambi-extension",
          id: "__broadcast__",
          response: { ok: true, data: "broadcast" },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: window.location.origin,
        data: {
          source: "dambi-extension",
          id: requestId,
          response: { ok: true, data: "accepted" },
        },
      }),
    );

    await expect(pending).resolves.toBe("accepted");
  });
});
