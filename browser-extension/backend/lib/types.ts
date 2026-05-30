import type { Address, Hex } from "viem";

export enum RequestType {
  TRANSACTION = "transaction",
  TYPED_SIGNATURE = "typed-signature",
  UNTYPED_SIGNATURE = "untyped-signature",
  // Off-chain venue order intercepted from a network POST (e.g. Hyperliquid
  // `/exchange`). Unlike the three above, it never flows through
  // `window.ethereum` — the dApp signs with an agent key and POSTs directly —
  // so it is captured by the MAIN-world fetch hook, not the provider proxy.
  VENUE_ORDER = "venue-order",
}

export interface TransactionPayload {
  type: RequestType.TRANSACTION;
  chainId: number;
  hostname: string;
  bypassed?: boolean;
  transaction: {
    from?: Address;
    to?: Address;
    data?: Hex;
    value?: string;
  };
}

export interface TypedSignaturePayload {
  type: RequestType.TYPED_SIGNATURE;
  chainId: number;
  hostname: string;
  bypassed?: boolean;
  address: Address;
  typedData: unknown;
}

export interface UntypedSignaturePayload {
  type: RequestType.UNTYPED_SIGNATURE;
  hostname: string;
  bypassed?: boolean;
  message: string;
}

/** One Hyperliquid `/exchange` order-wire entry (`action.orders[i]`). */
export interface HyperliquidOrderWire {
  /** Asset index (perp = meta.universe index; spot = 10000 + spotMeta index). */
  a: number;
  /** isBuy — `true` ⇒ long/buy, `false` ⇒ short/sell. */
  b: boolean;
  /** Limit price, decimal string. */
  p: string;
  /** Size in base units, decimal string. */
  s: string;
  /** reduceOnly. */
  r?: boolean;
  /** Order type — `{ limit: { tif } }` or `{ trigger: {...} }`. */
  t?: unknown;
  /** Optional client order id (128-bit hex). */
  c?: string;
}

/**
 * An off-chain venue order intercepted from a network POST. Carries the parsed
 * order intent plus the resolved asset `symbol` (the wire only has the numeric
 * index `a`; the fetch hook / SW resolves it from a `meta` cache).
 */
export interface VenueOrderPayload {
  type: RequestType.VENUE_ORDER;
  /** Settlement/venue chain hint. `0` for pure off-chain venues (Hyperliquid). */
  chainId: number;
  hostname: string;
  bypassed?: boolean;
  /** Venue id, e.g. `"hyperliquid"`. */
  venue: string;
  /** The intercepted endpoint URL (the `/exchange` POST target). */
  endpoint: string;
  /** The parsed order-wire entry. */
  order: HyperliquidOrderWire;
  /** Resolved asset symbol (e.g. `"BTC-USD"`); `undefined` until meta resolves. */
  symbol?: string;
}

export interface RawTransactionAdvisoryPayload {
  type: "raw-transaction-advisory";
  hostname: string;
  rawPreview: string;
}

export interface FrozenProviderWarningPayload {
  type: "provider-frozen-warning";
  hostname: string;
  providerName: string;
}

export type MessageData =
  | TransactionPayload
  | TypedSignaturePayload
  | UntypedSignaturePayload
  | VenueOrderPayload
  | RawTransactionAdvisoryPayload
  | FrozenProviderWarningPayload;

export interface Message {
  requestId: string;
  data: MessageData;
}

export interface MessageResponse {
  requestId: string;
  data: boolean;
}

export interface AwaitingUserMessage {
  requestId: string;
  kind: "awaiting-user";
}

export type StreamResponse = MessageResponse | AwaitingUserMessage;

export const isTransaction = (
  message: Message,
): message is Message & { data: TransactionPayload } =>
  message.data.type === RequestType.TRANSACTION;

export const isTypedSignature = (
  message: Message,
): message is Message & { data: TypedSignaturePayload } =>
  message.data.type === RequestType.TYPED_SIGNATURE;

export const isUntypedSignature = (
  message: Message,
): message is Message & { data: UntypedSignaturePayload } =>
  message.data.type === RequestType.UNTYPED_SIGNATURE;

export const isVenueOrder = (
  message: Message,
): message is Message & { data: VenueOrderPayload } =>
  message.data.type === RequestType.VENUE_ORDER;
