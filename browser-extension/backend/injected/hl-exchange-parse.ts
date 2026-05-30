/**
 * Pure parser: a Hyperliquid `/exchange` POST body → one
 * {@link VenueOrderPayload} per order leg.
 *
 * Kept in its own module (no DOM / `@metamask/post-message-stream` imports) so
 * it is trivially unit-testable and so importing it never triggers the
 * MAIN-world `fetch` install side effect in `fetch-hook.ts`.
 */
import {
  RequestType,
  type HyperliquidOrderWire,
  type VenueOrderPayload,
} from "@lib/types";

/**
 * Venue endpoints we police. Each entry maps a URL test → venue id.
 *
 * The live web app actually POSTs to `api-ui.hyperliquid.xyz/exchange` (the
 * `-ui` gateway), not the bare `api.hyperliquid.xyz` documented for SDKs — so
 * the host pattern matches an optional `-ui` (and `-testnet`) sub-label. Both
 * mainnet hosts (`api`, `api-ui`) and their testnet variants are covered.
 */
export const VENUE_MATCHERS: { test: (url: string) => boolean; venue: string }[] =
  [
    {
      test: (url) =>
        /(^|\/\/)api(-ui)?\.hyperliquid(-testnet)?\.xyz\/exchange\b/.test(url),
      venue: "hyperliquid",
    },
  ];

export function matchVenue(url: string): string | undefined {
  return VENUE_MATCHERS.find((m) => m.test(url))?.venue;
}

/**
 * Parse a Hyperliquid `/exchange` POST body into one {@link VenueOrderPayload}
 * per order. Returns `null` when the body is not a recognizable `order` action
 * (info calls, cancels, leverage updates, …) — those are out of scope and must
 * pass through untouched.
 */
export function parseHyperliquidExchangeOrders(
  venue: string,
  endpoint: string,
  hostname: string,
  rawBody: unknown,
): VenueOrderPayload[] | null {
  let body: unknown = rawBody;
  if (typeof rawBody === "string") {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object") return null;

  const action = (body as { action?: unknown }).action;
  if (!action || typeof action !== "object") return null;
  if ((action as { type?: unknown }).type !== "order") return null;

  const orders = (action as { orders?: unknown }).orders;
  if (!Array.isArray(orders) || orders.length === 0) return null;

  const payloads: VenueOrderPayload[] = [];
  for (const o of orders) {
    if (!o || typeof o !== "object") continue;
    const order = o as Record<string, unknown>;
    // An order-wire entry must at least carry the numeric asset index `a` and
    // the boolean side `b`; anything else is not an order leg.
    if (typeof order.a !== "number" || typeof order.b !== "boolean") continue;
    const wire: HyperliquidOrderWire = {
      a: order.a,
      b: order.b,
      p: String(order.p ?? ""),
      s: String(order.s ?? ""),
      r: typeof order.r === "boolean" ? order.r : false,
      t: order.t,
    };
    // Only set the optional `c` (cloid) when present — keeps the payload clean
    // under `exactOptionalPropertyTypes`.
    if (typeof order.c === "string") wire.c = order.c;
    payloads.push({
      type: RequestType.VENUE_ORDER,
      chainId: 0,
      hostname,
      venue,
      endpoint,
      order: wire,
      // symbol is resolved SW-side from the venue meta cache (the wire only has
      // the numeric index `a`); omitted here.
    });
  }
  return payloads.length > 0 ? payloads : null;
}
