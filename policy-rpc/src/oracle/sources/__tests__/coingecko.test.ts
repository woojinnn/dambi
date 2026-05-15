import { describe, expect, it } from "vitest";

import { CoinGeckoSource } from "../coingecko";
import { OracleSourceError } from "../../source";

const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("CoinGeckoSource", () => {
  it("scales the USD price to ORACLE_USD_DECIMALS", async () => {
    const observedAtSec = 1778750000;
    const source = new CoinGeckoSource({
      fetch: async () =>
        jsonResponse({
          [wethAddress]: { usd: "2500.5", last_updated_at: observedAtSec },
        }),
      nowMs: () => observedAtSec * 1000 + 1_000,
    });

    const sample = await source.fetch(1, { address: wethAddress });

    expect(sample.sourceId).toBe("coingecko");
    expect(sample.decimals).toBe(8);
    expect(sample.usd).toBe(250_050_000_000n); // 2500.5 * 1e8
    expect(sample.observedAt).toBe(observedAtSec * 1000);
  });

  it("rejects responses older than the staleness budget", async () => {
    const source = new CoinGeckoSource({
      fetch: async () =>
        jsonResponse({
          [wethAddress]: { usd: "2500", last_updated_at: 1000 },
        }),
      nowMs: () => (1000 + 6 * 60) * 1000, // 6 minutes elapsed
      maxAgeSec: 300,
    });

    await expect(source.fetch(1, { address: wethAddress })).rejects.toMatchObject({
      code: "stale",
      sourceId: "coingecko",
    });
  });

  it("maps not_found from the underlying client to unsupported_token", async () => {
    const source = new CoinGeckoSource({
      fetch: async () => jsonResponse({}),
      nowMs: () => 1778750000_000,
    });

    await expect(source.fetch(1, { address: wethAddress })).rejects.toMatchObject({
      code: "unsupported_token",
      sourceId: "coingecko",
    });
  });

  it("maps HTTP errors to the unavailable code", async () => {
    const source = new CoinGeckoSource({
      fetch: async () => jsonResponse({}, 503),
      nowMs: () => 1778750000_000,
    });

    await expect(source.fetch(1, { address: wethAddress })).rejects.toMatchObject({
      code: "unavailable",
      sourceId: "coingecko",
    });
  });

  it("rejects non-positive prices as invalid_response", async () => {
    const observedAtSec = 1778750000;
    const source = new CoinGeckoSource({
      fetch: async () =>
        jsonResponse({
          [wethAddress]: { usd: "0", last_updated_at: observedAtSec },
        }),
      nowMs: () => observedAtSec * 1000,
    });

    const rejection = source.fetch(1, { address: wethAddress });
    await expect(rejection).rejects.toBeInstanceOf(OracleSourceError);
    await expect(rejection).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("flags unsupported chains as unsupported_token", async () => {
    const source = new CoinGeckoSource({
      fetch: async () => jsonResponse({}),
      nowMs: () => 1778750000_000,
    });

    await expect(source.fetch(99999, { address: wethAddress })).rejects.toMatchObject({
      code: "unsupported_token",
      sourceId: "coingecko",
    });
  });
});
