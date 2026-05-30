/**
 * Hyperliquid `/exchange` order-wire → v2 `ActionBody` + `ActionMeta`.
 *
 * The fetch hook intercepts the `/exchange` POST and hands the parsed order to
 * the service worker as a {@link VenueOrderPayload}. This converter turns that
 * into the exact JSON the v2 policy entry point (`evaluate_action_v2_json`)
 * deserializes — an `ActionBody::Perp(PlaceLimitOrder)` plus an off-chain-sig
 * `ActionMeta`.
 *
 * The emitted shape is byte-pinned to the Rust serde output (see
 * `crates/policy-engine-wasm/tests/hl_exchange_deny_e2e.rs`, which builds the
 * same body from the real structs). `hl-order-to-action.test.ts` asserts this
 * converter reproduces that canonical JSON exactly, so a serde drift on either
 * side fails a test rather than silently mis-deserializing at runtime.
 *
 * Notes / current limits (intentional for the PoC, tracked separately):
 *   - `size` carries only the integer part of the decimal `s` (the deny
 *     conditions read side/venue/symbol, not size); precise base-unit scaling
 *     is a converter refinement.
 *   - `symbol` must be resolved from the venue `meta` cache (the wire only has
 *     the numeric index `a`); absent a resolution we fall back to `ASSET-<a>`.
 *   - only the `{ limit: { tif } }` order type is mapped; `trigger` orders fall
 *     back to GTC for the limit-order body.
 */

import type { VenueOrderPayload } from "@lib/types";

/** The off-chain venue chain id used for Hyperliquid in the v2 model. */
export const HL_CHAIN_ID = "hl-mainnet";

/** `tx.to` sentinel — Hyperliquid orders have no on-chain settlement address. */
export const HL_TO_SENTINEL = "0x0000000000000000000000000000000000000000";

/** Result of {@link hlOrderToAction}: the two JSON inputs the v2 path needs. */
export interface HlActionInput {
  action: Record<string, unknown>;
  meta: Record<string, unknown>;
}

function userSuppliedLive(value: unknown): Record<string, unknown> {
  return { value, source: { kind: "user_supplied" }, synced_at: 0 };
}

/** Integer part of a decimal string, as a base-10 string (`"0.1"` → `"0"`). */
function integerPart(decimal: string): string {
  const whole = decimal.split(".")[0]?.trim() ?? "0";
  return /^\d+$/.test(whole) ? whole : "0";
}

function timeInForceFromWire(t: unknown): Record<string, unknown> {
  const tif = (t as { limit?: { tif?: string } })?.limit?.tif;
  switch (tif) {
    case "Ioc":
      return { kind: "ioc" };
    case "Alo": // Add-Liquidity-Only == post-only
      return { kind: "post_only" };
    default:
      return { kind: "gtc" };
  }
}

/**
 * Convert a {@link VenueOrderPayload} into the `{ action, meta }` JSON pair the
 * v2 entry point consumes. Pure and synchronous.
 */
export function hlOrderToAction(payload: VenueOrderPayload): HlActionInput {
  const { order } = payload;
  const side = order.b ? "long" : "short";
  const price = String(order.p);
  const symbol = payload.symbol ?? `ASSET-${order.a}`;

  const action: Record<string, unknown> = {
    domain: "perp",
    action: "place_limit_order",
    venue: { name: "hyperliquid", chain: HL_CHAIN_ID },
    market: { symbol, venue: { name: "hyperliquid" } },
    side,
    size: { kind: "base_amount", amount: integerPart(String(order.s)) },
    price,
    time_in_force: timeInForceFromWire(order.t),
    reduce_only: order.r ?? false,
    live_inputs: {
      mark_price: userSuppliedLive(price),
      best_bid_ask: userSuppliedLive(["0", "0"]),
      open_orders_count: userSuppliedLive(0),
      user_account_state: userSuppliedLive({
        total_collateral_usd: "0",
        used_margin_usd: "0",
        free_margin_usd: "0",
        open_positions: [],
      }),
    },
  };

  const meta: Record<string, unknown> = {
    submitted_at: 1_738_000_000,
    submitter: "0x000000000000000000000000000000000000a01c",
    nature: {
      kind: "offchain_sig",
      domain: { name: "Hyperliquid", version: "1" },
      deadline: 1_738_000_600,
    },
  };

  return { action, meta };
}
