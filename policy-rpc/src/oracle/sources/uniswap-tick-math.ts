/**
 * Bit-accurate port of Uniswap V3's `TickMath.getSqrtRatioAtTick`. The output
 * is `sqrtPriceX96 = sqrt(1.0001^tick) * 2^96` as a Q64.96 unsigned integer.
 *
 * Reference: https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
 *
 * All arithmetic is done in unsigned 256-bit space using bigint masks. The
 * algorithm uses pre-computed multipliers indexed by the binary expansion of
 * `|tick|` and inverts the final ratio for positive ticks.
 */

const MASK_256: bigint =
  (1n << 256n) - 1n;

export const MIN_TICK = -887_272;
export const MAX_TICK = 887_272;
export const MIN_SQRT_RATIO = 4_295_128_739n;
export const MAX_SQRT_RATIO =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

const ONE_FF: bigint = 0xfffcb933bd6fad37aa2d162d1a594001n;
const STEPS: ReadonlyArray<readonly [bigint, bigint]> = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

function mulMod256(left: bigint, right: bigint): bigint {
  return (left * right) & MASK_256;
}

export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick)) {
    throw new RangeError(`tick must be an integer, received ${tick}`);
  }
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`tick ${tick} outside [${MIN_TICK}, ${MAX_TICK}]`);
  }

  const absTickBig = BigInt(tick < 0 ? -tick : tick);
  let ratio = (absTickBig & 0x1n) !== 0n ? ONE_FF : (1n << 128n);

  for (const [bit, factor] of STEPS) {
    if ((absTickBig & bit) !== 0n) {
      ratio = (mulMod256(ratio, factor)) >> 128n;
    }
  }

  if (tick > 0) {
    ratio = MASK_256 / ratio;
  }

  // ratio is Q128.128; round up to Q128.96 by adding (1 << 32) - 1 before shift.
  const sqrtPriceX96 = (ratio >> 32n) + ((ratio & ((1n << 32n) - 1n)) === 0n ? 0n : 1n);

  return sqrtPriceX96;
}

/**
 * Compute the arithmetic mean tick over `secondsAgo`. Mirrors
 * `OracleLibrary.consult`'s rounding: divide tickCumulatives delta by the
 * elapsed seconds and round toward negative infinity when the result is
 * negative and the delta is not a multiple of `secondsAgo`.
 */
export function tickFromTickCumulatives(
  tickCumulatives: readonly bigint[],
  secondsAgo: number,
): number {
  if (tickCumulatives.length !== 2) {
    throw new RangeError("tickCumulatives must have exactly two entries");
  }
  if (secondsAgo <= 0) {
    throw new RangeError("secondsAgo must be positive");
  }

  const delta = tickCumulatives[1] - tickCumulatives[0];
  const period = BigInt(secondsAgo);
  let meanTick = delta / period;

  if (delta < 0n && delta % period !== 0n) {
    meanTick -= 1n;
  }

  return Number(meanTick);
}
