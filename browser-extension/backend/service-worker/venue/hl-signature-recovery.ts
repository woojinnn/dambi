import {
  concatHex,
  keccak256,
  numberToHex,
  recoverTypedDataAddress,
  toBytes,
  toHex,
  type Hex,
} from "viem";
import type { HyperliquidExchangeEnvelopeWire } from "@lib/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;

const AGENT_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: ZERO_ADDRESS,
} as const;

const AGENT_TYPES = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
} as const;

const L1_SIGNED_ACTION_TYPES = new Set([
  "order",
  "modify",
  "batchModify",
  "cancel",
  "cancelByCloid",
  "scheduleCancel",
  "updateLeverage",
  "updateIsolatedMargin",
  "twapOrder",
]);

class ByteWriter {
  private readonly bytes: number[] = [];

  push(...values: number[]): void {
    for (const value of values) this.bytes.push(value & 0xff);
  }

  pushBytes(values: Uint8Array): void {
    for (const value of values) this.bytes.push(value);
  }

  pushUint(value: number | bigint, byteLength: 1 | 2 | 4 | 8): void {
    let n = typeof value === "bigint" ? value : BigInt(value);
    const out = new Array<number>(byteLength);
    for (let i = byteLength - 1; i >= 0; i -= 1) {
      out[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    this.push(...out);
  }

  pushInt(value: bigint, byteLength: 1 | 2 | 4 | 8): void {
    const bits = BigInt(byteLength * 8);
    const mod = 1n << bits;
    this.pushUint(value < 0n ? mod + value : value, byteLength);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function encodeStringLength(writer: ByteWriter, length: number): void {
  if (length < 32) {
    writer.push(0xa0 | length);
  } else if (length <= 0xff) {
    writer.push(0xd9);
    writer.pushUint(length, 1);
  } else if (length <= 0xffff) {
    writer.push(0xda);
    writer.pushUint(length, 2);
  } else {
    writer.push(0xdb);
    writer.pushUint(length, 4);
  }
}

function encodeArrayLength(writer: ByteWriter, length: number): void {
  if (length < 16) {
    writer.push(0x90 | length);
  } else if (length <= 0xffff) {
    writer.push(0xdc);
    writer.pushUint(length, 2);
  } else {
    writer.push(0xdd);
    writer.pushUint(length, 4);
  }
}

function encodeMapLength(writer: ByteWriter, length: number): void {
  if (length < 16) {
    writer.push(0x80 | length);
  } else if (length <= 0xffff) {
    writer.push(0xde);
    writer.pushUint(length, 2);
  } else {
    writer.push(0xdf);
    writer.pushUint(length, 4);
  }
}

function encodeInteger(writer: ByteWriter, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error("msgpack integer is outside the safe JS range");
  }
  if (value >= 0) {
    if (value <= 0x7f) writer.push(value);
    else if (value <= 0xff) {
      writer.push(0xcc);
      writer.pushUint(value, 1);
    } else if (value <= 0xffff) {
      writer.push(0xcd);
      writer.pushUint(value, 2);
    } else if (value <= 0xffffffff) {
      writer.push(0xce);
      writer.pushUint(value, 4);
    } else {
      writer.push(0xcf);
      writer.pushUint(BigInt(value), 8);
    }
    return;
  }
  if (value >= -32) writer.push(0xe0 | (value + 32));
  else if (value >= -0x80) {
    writer.push(0xd0);
    writer.pushInt(BigInt(value), 1);
  } else if (value >= -0x8000) {
    writer.push(0xd1);
    writer.pushInt(BigInt(value), 2);
  } else if (value >= -0x80000000) {
    writer.push(0xd2);
    writer.pushInt(BigInt(value), 4);
  } else {
    writer.push(0xd3);
    writer.pushInt(BigInt(value), 8);
  }
}

function encodeFloat(writer: ByteWriter, value: number): void {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  writer.push(0xcb);
  writer.pushBytes(new Uint8Array(buf));
}

function encodeMsgpackValue(writer: ByteWriter, value: unknown): void {
  if (value === null) {
    writer.push(0xc0);
    return;
  }
  if (typeof value === "boolean") {
    writer.push(value ? 0xc3 : 0xc2);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("msgpack cannot encode non-finite numbers");
    if (Number.isInteger(value)) encodeInteger(writer, value);
    else encodeFloat(writer, value);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    encodeStringLength(writer, bytes.length);
    writer.pushBytes(bytes);
    return;
  }
  if (Array.isArray(value)) {
    encodeArrayLength(writer, value.length);
    for (const item of value) encodeMsgpackValue(writer, item);
    return;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    encodeMapLength(writer, entries.length);
    for (const [key, v] of entries) {
      encodeMsgpackValue(writer, key);
      encodeMsgpackValue(writer, v);
    }
    return;
  }
  throw new Error(`msgpack cannot encode ${typeof value}`);
}

function msgpack(value: unknown): Uint8Array {
  const writer = new ByteWriter();
  encodeMsgpackValue(writer, value);
  return writer.finish();
}

function uint64Bytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("uint64 value must be a non-negative safe integer");
  }
  const writer = new ByteWriter();
  writer.pushUint(BigInt(value), 8);
  return writer.finish();
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_RE.test(value)
    ? value.toLowerCase()
    : null;
}

function padHex32(value: unknown): Hex | null {
  if (typeof value !== "string" || !HEX_RE.test(value)) return null;
  const raw = value.slice(2);
  if (raw.length === 0 || raw.length > 64) return null;
  return `0x${raw.padStart(64, "0")}` as Hex;
}

function normalizeV(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)
        ? Number.parseInt(value.slice(2), 16)
        : typeof value === "string" && /^[0-9]+$/.test(value)
          ? Number.parseInt(value, 10)
          : NaN;
  if (!Number.isInteger(n)) return null;
  if (n === 0 || n === 1) return n + 27;
  return n === 27 || n === 28 ? n : null;
}

function signatureHex(envelope: HyperliquidExchangeEnvelopeWire): Hex | null {
  const sig = envelope.signature;
  if (!sig) return null;
  const r = padHex32(sig.r);
  const s = padHex32(sig.s);
  const v = normalizeV(sig.v);
  if (!r || !s || v === null) return null;
  return concatHex([r, s, numberToHex(v, { size: 1 })]);
}

function isMainnetEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return true;
  try {
    return !new URL(endpoint).hostname.includes("testnet");
  } catch {
    return !endpoint.includes("testnet");
  }
}

function isRecoverableL1Action(action: unknown): boolean {
  return (
    action !== null &&
    typeof action === "object" &&
    !Array.isArray(action) &&
    L1_SIGNED_ACTION_TYPES.has(
      String((action as { type?: unknown }).type ?? ""),
    )
  );
}

export function hlL1ActionHash(
  action: unknown,
  vaultAddress: string | undefined,
  nonce: number,
  expiresAfter: number | undefined,
): Hex {
  const writer = new ByteWriter();
  writer.pushBytes(msgpack(action));
  writer.pushBytes(uint64Bytes(nonce));
  const vault = normalizeAddress(vaultAddress);
  if (vault) {
    writer.push(0x01);
    writer.pushBytes(toBytes(vault as Hex));
  } else {
    writer.push(0x00);
  }
  if (expiresAfter !== undefined) {
    writer.push(0x00);
    writer.pushBytes(uint64Bytes(expiresAfter));
  }
  return keccak256(toHex(writer.finish()));
}

export async function recoverHlL1Signer(
  envelope: HyperliquidExchangeEnvelopeWire | undefined,
  endpoint: string | undefined,
): Promise<string | null> {
  try {
    if (!envelope || typeof envelope.nonce !== "number") return null;
    if (!isRecoverableL1Action(envelope.action)) return null;
    const signature = signatureHex(envelope);
    if (!signature) return null;
    const connectionId = hlL1ActionHash(
      envelope.action,
      envelope.vaultAddress,
      envelope.nonce,
      envelope.expiresAfter,
    );
    const address = await recoverTypedDataAddress({
      domain: AGENT_DOMAIN,
      types: AGENT_TYPES,
      primaryType: "Agent",
      message: {
        source: isMainnetEndpoint(endpoint) ? "a" : "b",
        connectionId,
      },
      signature,
    });
    return address.toLowerCase();
  } catch {
    return null;
  }
}
