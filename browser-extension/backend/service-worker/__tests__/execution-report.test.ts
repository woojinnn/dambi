import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestType, type ExecutionReportPayload } from "@lib/types";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  request: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../scopeball-auth", () => ({
  getAccessToken: mocks.getAccessToken,
  request: mocks.request,
}));

import { reportExecutionOutcome } from "../execution-report";

function report(): ExecutionReportPayload {
  return {
    type: RequestType.EXECUTION_REPORT,
    hostname: "app.hyperliquid.xyz",
    wallet_id: {
      address: "0x362E7e9e630481631D7C804dfe50e24b53250925",
      chains: ["hyperliquid"],
    },
    outcome: {
      kind: "venue_accepted",
      venue: "hyperliquid",
      venue_order_id: "123",
    },
    metadata: { source: "test" },
  };
}

describe("reportExecutionOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts through the authenticated Scopeball client", async () => {
    mocks.getAccessToken.mockResolvedValue("jwt");
    mocks.request.mockResolvedValue(undefined);

    await reportExecutionOutcome(report());

    expect(mocks.request).toHaveBeenCalledWith("/execution-report", {
      method: "POST",
      body: {
        wallet_id: {
          address: "0x362E7e9e630481631D7C804dfe50e24b53250925",
          chains: ["hyperliquid"],
        },
        outcome: {
          kind: "venue_accepted",
          venue: "hyperliquid",
          venue_order_id: "123",
        },
        metadata: { source: "test" },
      },
    });
  });

  it("skips reports when the user is not signed in", async () => {
    mocks.getAccessToken.mockResolvedValue(null);

    await reportExecutionOutcome(report());

    expect(mocks.request).not.toHaveBeenCalled();
  });
});
