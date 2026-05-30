import { describe, it, expect } from "vitest";

import { hlOrderToAction } from "../hl-order-to-action";
import { RequestType, type VenueOrderPayload } from "@lib/types";

/**
 * The canonical JSON the Rust v2 model emits for the same order, captured from
 * `crates/policy-engine-wasm/tests/hl_exchange_deny_e2e.rs` (which builds the
 * body from the real structs and feeds it through `evaluate_action_v2_json`).
 * If serde renaming/tagging changes on the Rust side, OR this converter drifts,
 * this exact-match assertion fails — pinning the TS wire shape to the engine.
 */
const CANONICAL_ACTION = {
  domain: "perp",
  action: "place_limit_order",
  venue: { name: "hyperliquid", chain: "hl-mainnet" },
  market: { symbol: "BTC-USD", venue: { name: "hyperliquid" } },
  side: "short",
  size: { kind: "base_amount", amount: "0" },
  price: "60000",
  time_in_force: { kind: "gtc" },
  reduce_only: false,
  live_inputs: {
    mark_price: { value: "60000", source: { kind: "user_supplied" }, synced_at: 0 },
    best_bid_ask: {
      value: ["0", "0"],
      source: { kind: "user_supplied" },
      synced_at: 0,
    },
    open_orders_count: {
      value: 0,
      source: { kind: "user_supplied" },
      synced_at: 0,
    },
    user_account_state: {
      value: {
        total_collateral_usd: "0",
        used_margin_usd: "0",
        free_margin_usd: "0",
        open_positions: [],
      },
      source: { kind: "user_supplied" },
      synced_at: 0,
    },
  },
};

const CANONICAL_META = {
  submitted_at: 1_738_000_000,
  submitter: "0x000000000000000000000000000000000000a01c",
  nature: {
    kind: "offchain_sig",
    domain: { name: "Hyperliquid", version: "1" },
    deadline: 1_738_000_600,
  },
};

function shortBtc(): VenueOrderPayload {
  return {
    type: RequestType.VENUE_ORDER,
    chainId: 0,
    hostname: "app.hyperliquid.xyz",
    venue: "hyperliquid",
    endpoint: "https://api.hyperliquid.xyz/exchange",
    order: { a: 0, b: false, p: "60000", s: "0.1", r: false, t: { limit: { tif: "Gtc" } } },
    symbol: "BTC-USD",
  };
}

describe("hlOrderToAction", () => {
  it("produces the exact canonical v2 ActionBody + meta (pinned to Rust serde)", () => {
    const { action, meta } = hlOrderToAction(shortBtc());
    expect(action).toEqual(CANONICAL_ACTION);
    expect(meta).toEqual(CANONICAL_META);
  });

  it("maps isBuy=true ⇒ side long", () => {
    const p = shortBtc();
    p.order.b = true;
    expect(hlOrderToAction(p).action.side).toBe("long");
  });

  it("maps tif Ioc/Alo and defaults to gtc", () => {
    const ioc = shortBtc();
    ioc.order.t = { limit: { tif: "Ioc" } };
    expect(hlOrderToAction(ioc).action.time_in_force).toEqual({ kind: "ioc" });

    const alo = shortBtc();
    alo.order.t = { limit: { tif: "Alo" } };
    expect(hlOrderToAction(alo).action.time_in_force).toEqual({ kind: "post_only" });

    const trigger = shortBtc();
    trigger.order.t = { trigger: { isMarket: true } };
    expect(hlOrderToAction(trigger).action.time_in_force).toEqual({ kind: "gtc" });
  });

  it("falls back to ASSET-<index> when symbol is unresolved", () => {
    const p = shortBtc();
    delete p.symbol;
    p.order.a = 7;
    expect((hlOrderToAction(p).action.market as { symbol: string }).symbol).toBe(
      "ASSET-7",
    );
  });
});
