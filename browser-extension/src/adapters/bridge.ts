import type {
  AdapterResult,
  DecodedCall,
  ActionEnvelope,
  Manifest,
  Hex,
} from "./types";

export interface AdapterExports {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  dealloc: (ptr: number, size: number) => void;
  decode_call?: (ctxPtr: number, ctxLen: number, dataPtr: number, dataLen: number) => bigint;
  map_to_action?: (ctxPtr: number, ctxLen: number, decodedPtr: number, decodedLen: number) => bigint;
  decode_sign?: (ctxPtr: number, ctxLen: number, reqPtr: number, reqLen: number) => bigint;
  manifest_json?: () => bigint;
}

export class AdapterBridge {
  private exports: AdapterExports;

  constructor(
    public readonly instance: WebAssembly.Instance,
    public readonly manifest: Manifest
  ) {
    this.exports = instance.exports as unknown as AdapterExports;
  }

  decodeCall(
    ctx: { chain_id: number; target: Hex; selector: Hex },
    calldata: Uint8Array
  ): AdapterResult<DecodedCall> {
    const fn = this.exports.decode_call;
    if (!fn) throw new Error("adapter exports no decode_call");
    return this.callTwoArg(fn, ctx, calldata) as AdapterResult<DecodedCall>;
  }

  mapToAction(
    ctx: { chain_id: number; target: Hex; selector: Hex },
    decoded: DecodedCall
  ): AdapterResult<ActionEnvelope[]> {
    const fn = this.exports.map_to_action;
    if (!fn) throw new Error("adapter exports no map_to_action");
    return this.callTwoArg(fn, ctx, decoded) as AdapterResult<ActionEnvelope[]>;
  }

  decodeSign(
    ctx: { chain_id: number; verifying_contract: Hex; primary_type: string },
    req: unknown
  ): AdapterResult<ActionEnvelope[]> {
    const fn = this.exports.decode_sign;
    if (!fn) throw new Error("adapter exports no decode_sign");
    return this.callTwoArg(fn, ctx, req) as AdapterResult<ActionEnvelope[]>;
  }

  /**
   * Generic two-argument export caller.
   * arg1 is always JSON-stringified.
   * arg2 is either JSON-stringified (object) or copied raw (Uint8Array).
   */
  private callTwoArg(
    fn: (ap: number, al: number, bp: number, bl: number) => bigint,
    arg1: unknown,
    arg2: unknown
  ): unknown {
    const a = this.copyIn(new TextEncoder().encode(JSON.stringify(arg1)));
    const b =
      arg2 instanceof Uint8Array
        ? this.copyIn(arg2)
        : this.copyIn(new TextEncoder().encode(JSON.stringify(arg2)));
    try {
      const packed = fn(a.ptr, a.len, b.ptr, b.len);
      return this.unpackJson(packed);
    } finally {
      this.exports.dealloc(a.ptr, a.len);
      this.exports.dealloc(b.ptr, b.len);
    }
  }

  private copyIn(bytes: Uint8Array): { ptr: number; len: number } {
    const ptr = this.exports.alloc(bytes.length);
    const view = new Uint8Array(this.exports.memory.buffer, ptr, bytes.length);
    view.set(bytes);
    return { ptr, len: bytes.length };
  }

  private unpackJson(packed: bigint): unknown {
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffff_ffffn);
    if (ptr === 0 && len === 0) {
      // Adapter signaled no-result (e.g. NotFound) — treat as decode_failed.
      return { Err: { kind: "decode_failed", message: "adapter returned null packed result" } };
    }
    const bytes = new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
    this.exports.dealloc(ptr, len);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  }

  /** Read the embedded manifest_json export and parse it. */
  manifestJson(): Manifest | null {
    const fn = this.exports.manifest_json;
    if (!fn) return null;
    return this.unpackJson(fn()) as Manifest;
  }
}
