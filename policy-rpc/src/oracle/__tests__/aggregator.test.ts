import { describe, expect, it } from "vitest";

import {
  AggregatorError,
  OracleAggregator,
  formatScaledUsd,
  median,
} from "../aggregator";
import {
  OracleSourceError,
  ORACLE_USD_SCALE,
  type AssetRef,
  type OracleSample,
  type OracleSource,
} from "../source";

const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

class FakeSource implements OracleSource {
  readonly id: string;
  private readonly fetcher: (chainId: number, token: AssetRef) => Promise<OracleSample>;

  constructor(
    id: string,
    fetcher: (chainId: number, token: AssetRef) => Promise<OracleSample>,
  ) {
    this.id = id;
    this.fetcher = fetcher;
  }

  fetch(chainId: number, token: AssetRef): Promise<OracleSample> {
    return this.fetcher(chainId, token);
  }
}

function fixedSample(id: string, usdDecimal: number, observedAt: number): OracleSample {
  return {
    usd: BigInt(Math.round(usdDecimal * Number(ORACLE_USD_SCALE))),
    decimals: 8,
    observedAt,
    sourceId: id,
  };
}

describe("median", () => {
  it("returns the middle value for odd-sized arrays", () => {
    expect(median([3n, 1n, 2n])).toBe(2n);
  });

  it("averages the two middle values for even-sized arrays", () => {
    expect(median([1n, 4n, 2n, 3n])).toBe(2n); // (2+3)/2 floored
  });
});

describe("formatScaledUsd", () => {
  it("formats 1e8-scaled values down to the requested output precision", () => {
    const oneEthInUsd = BigInt(2500) * ORACLE_USD_SCALE; // $2500
    expect(formatScaledUsd(oneEthInUsd, 4)).toBe("2500.0000");
    expect(formatScaledUsd(0n, 4)).toBe("0.0000");
  });

  it("rounds to zero precision deterministically", () => {
    expect(formatScaledUsd(ORACLE_USD_SCALE * 12n + ORACLE_USD_SCALE / 2n, 0)).toBe("12");
  });
});

describe("OracleAggregator", () => {
  const observedAt = 1_778_750_000_000;
  const nowMs = () => observedAt + 1_000;

  it("returns the median when sources agree", async () => {
    const sources = [
      new FakeSource("a", async () => fixedSample("a", 100, observedAt)),
      new FakeSource("b", async () => fixedSample("b", 101, observedAt)),
      new FakeSource("c", async () => fixedSample("c", 99, observedAt)),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs, outputDecimals: 4 });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.value).toBe("100.0000");
    expect(valuation.sources).toHaveLength(3);
    expect(valuation.confidence).toBe("high");
    expect(valuation.staleSec).toBe(1);
    expect(valuation.sourceBreakdown.every((s) => s.included)).toBe(true);
  });

  it("returns single-source with low confidence when only one source survives", async () => {
    const sources = [
      new FakeSource("ok", async () => fixedSample("ok", 200, observedAt)),
      new FakeSource("err", async () => {
        throw new OracleSourceError("unavailable", "err", "boom");
      }),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs, outputDecimals: 4 });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.value).toBe("200.0000");
    expect(valuation.sources).toEqual(["ok"]);
    expect(valuation.confidence).toBe("low");
    expect(valuation.sourceBreakdown).toEqual([
      { sourceId: "ok", value: "200.0000", asOfTs: observedAt / 1000, included: true },
      { sourceId: "err", value: "0.0000", asOfTs: 0, included: false, reason: "unavailable" },
    ]);
  });

  it("drops outliers > 3% deviation from the median", async () => {
    const sources = [
      new FakeSource("anchor1", async () => fixedSample("anchor1", 100, observedAt)),
      new FakeSource("anchor2", async () => fixedSample("anchor2", 100, observedAt)),
      // 10% off => dropped
      new FakeSource("outlier", async () => fixedSample("outlier", 110, observedAt)),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs, outputDecimals: 4 });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.value).toBe("100.0000");
    expect(valuation.sources).toEqual(["anchor1", "anchor2"]);
    expect(valuation.confidence).toBe("high");
    const outlier = valuation.sourceBreakdown.find((s) => s.sourceId === "outlier");
    expect(outlier).toMatchObject({ included: false, reason: "outlier" });
  });

  it("throws all_sources_failed when every source errors", async () => {
    const sources = [
      new FakeSource("a", async () => {
        throw new OracleSourceError("unavailable", "a", "down");
      }),
      new FakeSource("b", async () => {
        throw new OracleSourceError("invalid_response", "b", "bad");
      }),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs });

    await expect(aggregator.aggregate(1, { address: wethAddress })).rejects.toBeInstanceOf(
      AggregatorError,
    );
    await expect(aggregator.aggregate(1, { address: wethAddress })).rejects.toMatchObject({
      code: "all_sources_failed",
    });
  });

  it("throws all_sources_stale when every survivor is stale", async () => {
    const sources = [
      new FakeSource("a", async () => {
        throw new OracleSourceError("stale", "a", "stale a");
      }),
      new FakeSource("b", async () => {
        throw new OracleSourceError("stale", "b", "stale b");
      }),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs });

    await expect(aggregator.aggregate(1, { address: wethAddress })).rejects.toMatchObject({
      code: "all_sources_stale",
    });
  });

  it("throws oracle_disagreement when two surviving sources are >3% apart", async () => {
    const sources = [
      new FakeSource("a", async () => fixedSample("a", 100, observedAt)),
      // 6% deviation from a's value -> initial median is (100+106)/2 = 103.
      // |100-103| = 3 and 3% of 103 = 3.09, so 100 is *just* inside tolerance,
      // but 106 is at 3 too. Push further: 110.
      new FakeSource("b", async () => fixedSample("b", 110, observedAt)),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs });

    await expect(aggregator.aggregate(1, { address: wethAddress })).rejects.toMatchObject({
      code: "oracle_disagreement",
    });
  });

  it("propagates non-OracleSourceError rejections as unknown breakdown reasons", async () => {
    const sources = [
      new FakeSource("ok", async () => fixedSample("ok", 50, observedAt)),
      new FakeSource("crash", async () => {
        throw new Error("boom unrelated");
      }),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.sources).toEqual(["ok"]);
    expect(valuation.sourceBreakdown.find((s) => s.sourceId === "crash")).toMatchObject({
      included: false,
      reason: "boom unrelated",
    });
  });

  it("rejects no-source aggregator construction", () => {
    expect(() => new OracleAggregator({ sources: [], nowMs })).toThrowError(
      AggregatorError,
    );
  });

  it("treats sources returning non-positive USD as failures", async () => {
    const sources = [
      new FakeSource("zero", async () => ({
        ...fixedSample("zero", 0, observedAt),
        usd: 0n,
      })),
      new FakeSource("ok", async () => fixedSample("ok", 25, observedAt)),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.sources).toEqual(["ok"]);
    expect(valuation.confidence).toBe("low");
  });

  it("uses configurable outlier threshold", async () => {
    // With a tight 100bps threshold even 2% deviation triggers drop.
    const sources = [
      new FakeSource("a", async () => fixedSample("a", 100, observedAt)),
      new FakeSource("b", async () => fixedSample("b", 100, observedAt)),
      new FakeSource("c", async () => fixedSample("c", 102, observedAt)),
    ];
    const aggregator = new OracleAggregator({
      sources,
      nowMs,
      outlierBps: 100, // 1%
    });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.sources).toEqual(["a", "b"]);
    const drop = valuation.sourceBreakdown.find((s) => s.sourceId === "c");
    expect(drop?.included).toBe(false);
    expect(drop?.reason).toBe("outlier");
  });

  it("rejects when one survivor is itself > tolerance vs the only other", async () => {
    // Two-source case with no median rescue: the deviation check throws when
    // dropping leaves zero in.
    const sources = [
      new FakeSource("a", async () => fixedSample("a", 100, observedAt)),
      new FakeSource("b", async () => fixedSample("b", 110, observedAt)),
    ];
    const aggregator = new OracleAggregator({
      sources,
      nowMs,
      outlierBps: 100, // 1% - both end up > tolerance from median (105)
    });

    await expect(aggregator.aggregate(1, { address: wethAddress })).rejects.toMatchObject({
      code: "oracle_disagreement",
    });
  });

  it("computes staleSec from the most recent surviving observation", async () => {
    const old = observedAt - 60_000;
    const recent = observedAt;
    const sources = [
      new FakeSource("old", async () => fixedSample("old", 100, old)),
      new FakeSource("new", async () => fixedSample("new", 101, recent)),
    ];
    const aggregator = new OracleAggregator({ sources, nowMs, outputDecimals: 4 });

    const valuation = await aggregator.aggregate(1, { address: wethAddress });
    expect(valuation.asOfTs).toBe(Math.floor(recent / 1000));
    expect(valuation.staleSec).toBe(1);
  });
});
