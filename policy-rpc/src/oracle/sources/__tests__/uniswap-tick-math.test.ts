import { describe, expect, it } from "vitest";

import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  getSqrtRatioAtTick,
  tickFromTickCumulatives,
} from "../uniswap-tick-math";

describe("TickMath.getSqrtRatioAtTick", () => {
  it("returns 2^96 for tick 0", () => {
    expect(getSqrtRatioAtTick(0)).toBe(79228162514264337593543950336n);
  });

  it("returns MIN_SQRT_RATIO for MIN_TICK", () => {
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(MIN_SQRT_RATIO);
  });

  it("returns MAX_SQRT_RATIO for MAX_TICK", () => {
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(MAX_SQRT_RATIO);
  });

  it("monotonically increases with tick", () => {
    const r0 = getSqrtRatioAtTick(0);
    const r1 = getSqrtRatioAtTick(1);
    const rNeg1 = getSqrtRatioAtTick(-1);
    expect(r1).toBeGreaterThan(r0);
    expect(rNeg1).toBeLessThan(r0);
  });

  it("rejects out-of-range ticks", () => {
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow();
    expect(() => getSqrtRatioAtTick(MIN_TICK - 1)).toThrow();
    expect(() => getSqrtRatioAtTick(1.5)).toThrow();
  });
});

describe("tickFromTickCumulatives", () => {
  it("returns the tick exactly when divisible", () => {
    // 200 ticks * 1800 seconds = 360000 cumulative units
    const tick = tickFromTickCumulatives([0n, 360_000n], 1800);
    expect(tick).toBe(200);
  });

  it("rounds negative deltas toward negative infinity", () => {
    // -100 / 1800 with non-zero remainder -> -1 not 0
    const tick = tickFromTickCumulatives([0n, -100n], 1800);
    expect(tick).toBe(-1);
  });

  it("does not adjust when negative delta divides evenly", () => {
    const tick = tickFromTickCumulatives([0n, -1800n], 1800);
    expect(tick).toBe(-1);
  });
});
