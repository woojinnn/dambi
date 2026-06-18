// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Identifier } from "@lib/identifier";
import { RequestType } from "@lib/types";

const mocks = vi.hoisted(() => {
  type DataHandler = (message: unknown) => void | Promise<void>;

  class MockWindowPostMessageStream {
    public dataHandler: DataHandler | null = null;
    public readonly name: string;
    public readonly target: string;

    constructor(options: { name: string; target: string }) {
      this.name = options.name;
      this.target = options.target;
      mocks.streams.push(this);
    }

    on(event: string, callback: DataHandler): void {
      if (event === "data") this.dataHandler = callback;
    }

    write(): boolean {
      return true;
    }

    async emit(message: unknown): Promise<void> {
      await this.dataHandler?.(message);
    }
  }

  const mocks = {
    streams: [] as MockWindowPostMessageStream[],
    connect: vi.fn(),
    createVerdictSender: vi.fn(),
    verdictSend: vi.fn(),
    sendToPortAndAwaitResponse: vi.fn(),
    sendToPortAndDisregard: vi.fn(),
    MockWindowPostMessageStream,
  };
  return mocks;
});

vi.mock("@metamask/post-message-stream", () => ({
  WindowPostMessageStream: mocks.MockWindowPostMessageStream,
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      connect: mocks.connect,
    },
  },
}));

vi.mock("@lib/verdict-channel", () => ({
  createVerdictSender: mocks.createVerdictSender,
}));

vi.mock("@lib/messages", () => ({
  sendToPortAndAwaitResponse: mocks.sendToPortAndAwaitResponse,
  sendToPortAndDisregard: mocks.sendToPortAndDisregard,
}));

describe("content bridge service-worker disconnect fail-closed behavior", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mocks.streams.length = 0;
    mocks.connect.mockReset();
    mocks.createVerdictSender.mockReset();
    mocks.verdictSend.mockReset();
    mocks.sendToPortAndAwaitResponse.mockReset();
    mocks.sendToPortAndDisregard.mockReset();
    mocks.connect.mockImplementation(() => {
      throw new Error("service worker unavailable");
    });
    mocks.createVerdictSender.mockReturnValue({ send: mocks.verdictSend });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("denies wallet provider requests when runtime.connect throws", async () => {
    await import("../window-ethereum-messages");
    expect(mocks.createVerdictSender).toHaveBeenCalledWith(
      Identifier.VERDICT_PORT_INIT,
    );

    await mocks.streams[0].emit({
      requestId: "rid-wallet",
      data: {
        type: RequestType.TRANSACTION,
        chainId: 1,
        hostname: "example.test",
        transaction: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          data: "0x",
        },
      },
    });

    expect(mocks.connect).toHaveBeenCalledWith({
      name: Identifier.CONTENT_SCRIPT,
    });
    expect(mocks.verdictSend).toHaveBeenCalledWith({
      requestId: "rid-wallet",
      data: false,
    });
    expect(mocks.sendToPortAndAwaitResponse).not.toHaveBeenCalled();
  });

  it("denies HyperLiquid venue requests when runtime.connect throws", async () => {
    await import("../fetch-bridge");
    expect(mocks.createVerdictSender).toHaveBeenCalledWith(
      Identifier.FETCH_VERDICT_PORT_INIT,
    );

    await mocks.streams[0].emit({
      requestId: "rid-venue",
      data: {
        type: RequestType.VENUE_ORDER,
        chainId: 0,
        hostname: "app.hyperliquid.xyz",
        venue: "hyperliquid",
        endpoint: "https://api.hyperliquid.xyz/exchange",
        hlAction: {
          kind: "unknown",
          actionType: "convertToMultiSigUser",
        },
      },
    });

    expect(mocks.connect).toHaveBeenCalledWith({
      name: Identifier.CONTENT_SCRIPT,
    });
    expect(mocks.verdictSend).toHaveBeenCalledWith({
      requestId: "rid-venue",
      data: false,
    });
    expect(mocks.sendToPortAndAwaitResponse).not.toHaveBeenCalled();
    expect(mocks.sendToPortAndDisregard).not.toHaveBeenCalled();
  });
});
