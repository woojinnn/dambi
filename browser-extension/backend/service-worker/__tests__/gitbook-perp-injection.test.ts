import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import { parseHyperliquidExchangeOrders } from "../../injected/hl-exchange-parse";
import { hlOrderToAction } from "../hl-order-to-action";
import type { HlInfoClient } from "../venue/hl-info-client";
import { resolveOrderSymbol } from "../venue/resolve-order-symbol";

const ENDPOINT = "https://api.hyperliquid.xyz/exchange";
const HOSTNAME = "app.hyperliquid.xyz";
const HL_META_PATH = "/tmp/scopeball-hl-meta.json";
const HL_MIDS_PATH = "/tmp/scopeball-hl-allmids.json";
// Local-only fixtures (HL meta/allMids snapshots). Absent in CI -> skip the suite.
const HAS_FIXTURES = fs.existsSync(HL_META_PATH) && fs.existsSync(HL_MIDS_PATH);

type HlMeta = { universe: Array<{ name: string; maxLeverage: number }> };

function readMeta(): HlMeta {
  return JSON.parse(fs.readFileSync(HL_META_PATH, "utf8")) as HlMeta;
}

function readMids(): Record<string, string> {
  return JSON.parse(fs.readFileSync(HL_MIDS_PATH, "utf8")) as Record<string, string>;
}

function assetIndex(symbol: string): number {
  const index = readMeta().universe.findIndex((entry) => entry.name === symbol);
  if (index < 0) throw new Error(`missing HL official meta asset ${symbol}`);
  return index;
}

function mid(symbol: string): string {
  const px = readMids()[symbol];
  if (!px) throw new Error(`missing HL official allMids price ${symbol}`);
  return px;
}

function signedExchangeBody(action: Record<string, unknown>): Record<string, unknown> {
  return {
    action,
    nonce: 1_738_000_000_000,
    signature: {
      r: "0x0000000000000000000000000000000000000000000000000000000000000000",
      s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      v: 27,
    },
  };
}

function parseOne(body: Record<string, unknown>) {
  const payloads = parseHyperliquidExchangeOrders(
    "hyperliquid",
    ENDPOINT,
    HOSTNAME,
    JSON.stringify(body),
  );
  expect(payloads).not.toBeNull();
  expect(payloads).toHaveLength(1);
  return payloads![0];
}

function metaClient(): HlInfoClient {
  return {
    coinForIndex: async (index: number) =>
      readMeta().universe[index]?.name ?? null,
  } as unknown as HlInfoClient;
}

(HAS_FIXTURES ? describe : describe.skip)("GitBook PERP HL official endpoint injection", () => {
  it("parses official-shaped order body to Perp::PlaceOrder and resolves symbol", async () => {
    const btcIndex = assetIndex("BTC");
    const payload = parseOne(
      signedExchangeBody({
        type: "order",
        orders: [
          {
            a: btcIndex,
            b: false,
            p: mid("BTC"),
            s: "0.10",
            r: false,
            t: { limit: { tif: "Gtc" } },
          },
        ],
        grouping: "na",
      }),
    );

    expect(payload.hlAction.kind).toBe("order");
    const { action } = hlOrderToAction(payload);
    expect(action).toMatchObject({
      domain: "perp",
      action: "place_order",
      side: "short",
      reduce_only: false,
      order_type: { kind: "limit", price: mid("BTC") },
    });
    expect((action.market as { symbol: string }).symbol).toBe(`ASSET-${btcIndex}`);

    await resolveOrderSymbol(action, payload, metaClient());
    expect((action.market as { symbol: string }).symbol).toBe("BTC");
  });

  it("parses official-shaped updateLeverage body to Perp::ChangeLeverage", async () => {
    const btcIndex = assetIndex("BTC");
    const payload = parseOne(
      signedExchangeBody({
        type: "updateLeverage",
        asset: btcIndex,
        isCross: true,
        leverage: 11,
      }),
    );

    expect(payload.hlAction.kind).toBe("update_leverage");
    const { action } = hlOrderToAction(payload);
    expect(action).toMatchObject({
      domain: "perp",
      action: "change_leverage",
      new_leverage: "11",
    });
    await resolveOrderSymbol(action, payload, metaClient());
    expect((action.market as { symbol: string }).symbol).toBe("BTC");
  });

  it("parses official-shaped updateIsolatedMargin body to Perp::AdjustMargin", async () => {
    const btcIndex = assetIndex("BTC");
    const payload = parseOne(
      signedExchangeBody({
        type: "updateIsolatedMargin",
        asset: btcIndex,
        isBuy: true,
        ntli: "-1000",
      }),
    );

    expect(payload.hlAction.kind).toBe("update_isolated_margin");
    const { action } = hlOrderToAction(payload);
    expect(action).toMatchObject({
      domain: "perp",
      action: "adjust_margin",
      side: "long",
      delta: "-1000",
    });
    await resolveOrderSymbol(action, payload, metaClient());
    expect((action.market as { symbol: string }).symbol).toBe("BTC");
  });
});
