import { describe, expect, it } from "vitest";

import { generateRequestId } from "../messages";
import { RequestType } from "../types";

describe("message request ids", () => {
  it("uses per-request correlation ids, not only deterministic payload hashes", () => {
    const typedData = {
      domain: { chainId: 1, verifyingContract: "0x0000000000000000000000000000000000000001" },
      primaryType: "Permit",
      message: { value: "1" },
    };
    const payload = {
      type: RequestType.TYPED_SIGNATURE,
      chainId: 1,
      hostname: "app.example",
      address: "0x1111111111111111111111111111111111111111",
      typedData,
    } as const;

    expect(generateRequestId(payload)).not.toBe(generateRequestId(payload));
  });

  it("keeps actor and venue attribution in the diagnostic fingerprint suffix", () => {
    const first = generateRequestId({
      type: RequestType.VENUE_ORDER,
      chainId: 0,
      hostname: "app.example",
      venue: "hyperliquid",
      endpoint: "https://api.hyperliquid.xyz/exchange",
      hlAction: {
        kind: "withdraw",
        destination: "0x2222222222222222222222222222222222222222",
        amount: "1",
      },
      wallet_id: {
        address: "0x1111111111111111111111111111111111111111",
        chains: ["eip155:42161"],
      },
    });
    const second = generateRequestId({
      type: RequestType.VENUE_ORDER,
      chainId: 0,
      hostname: "app.example",
      venue: "hyperliquid",
      endpoint: "https://api.hyperliquid.xyz/exchange",
      hlAction: {
        kind: "withdraw",
        destination: "0x2222222222222222222222222222222222222222",
        amount: "1",
      },
      wallet_id: {
        address: "0x3333333333333333333333333333333333333333",
        chains: ["eip155:42161"],
      },
    });

    const firstFingerprint = first.split(":").at(-1);
    const secondFingerprint = second.split(":").at(-1);
    expect(firstFingerprint).toBeDefined();
    expect(secondFingerprint).toBeDefined();
    expect(firstFingerprint).not.toBe(secondFingerprint);
  });
});
