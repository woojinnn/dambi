// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addStorageListener: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      sendMessage: mocks.sendMessage,
    },
    storage: {
      onChanged: {
        addListener: mocks.addStorageListener,
      },
    },
  },
}));

function bridgeRequest(id: string) {
  return {
    source: "dambi-dashboard",
    id,
    payload: { type: "dashboard:ping" },
  };
}

describe("dashboard content-script bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.sendMessage.mockReset();
    mocks.addStorageListener.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards dashboard messages only from allowlisted localhost origins", async () => {
    mocks.sendMessage.mockResolvedValue({ ok: true, data: "ok" });
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    await import("../dashboard-bridge");

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "https://evil.example",
        data: bridgeRequest("blocked"),
      }),
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "http://localhost:5173",
        data: bridgeRequest("allowed"),
      }),
    );

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith({ type: "dashboard:ping" });
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "dambi-extension",
        id: "allowed",
        response: { ok: true, data: "ok" },
      }),
      "http://localhost:5173",
    );
  });
});
