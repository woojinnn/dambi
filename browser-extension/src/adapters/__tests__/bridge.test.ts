import { describe, expect, it } from "vitest";
import { AdapterBridge, type AdapterExports } from "../bridge";
import type { Manifest } from "../types";

/**
 * Build a fake WASM instance that pretends to allocate, copy, and decode.
 * Holds a single byte-buffer "memory"; alloc bump-allocates; decode_call
 * echoes the encoded ctx+calldata length into a JSON Ok object.
 */
function fakeInstance() {
  const mem = new WebAssembly.Memory({ initial: 1 });
  let bump = 16; // skip the first 16 bytes to leave room for sentinels

  const alloc = (n: number) => {
    const ptr = bump;
    bump += n;
    return ptr;
  };
  const dealloc = (_p: number, _n: number) => {};

  // decode_call: reads (ctx_len + data_len) and returns Ok JSON with that count.
  const decode_call = (ctxPtr: number, ctxLen: number, dataPtr: number, dataLen: number) => {
    void ctxPtr; void dataPtr;
    const result = { Ok: { chain_id: 1, target: "0x" + "00".repeat(20), selector: "0x00000000", function: `echo:${ctxLen}+${dataLen}`, args: [], nested: [] } };
    const enc = new TextEncoder().encode(JSON.stringify(result));
    const out = alloc(enc.length);
    new Uint8Array(mem.buffer, out, enc.length).set(enc);
    return (BigInt(out) << 32n) | BigInt(enc.length);
  };

  const exports: AdapterExports = {
    memory: mem,
    alloc,
    dealloc,
    decode_call,
  };

  return {
    instance: { exports } as unknown as WebAssembly.Instance,
    manifest: {
      name: "fake",
      version: "0.0.0",
      sdk_version: 1,
      description: "fake",
      capabilities: ["decoder"],
      applies_to: [],
      factory_of: [],
      proxy_of: [],
    } as Manifest,
  };
}

describe("AdapterBridge", () => {
  it("decodeCall round-trips ctx + calldata through fake adapter", () => {
    const { instance, manifest } = fakeInstance();
    const bridge = new AdapterBridge(instance, manifest);
    const result = bridge.decodeCall(
      { chain_id: 1, target: "0x0000000000000000000000000000000000000000", selector: "0xa9059cbb" },
      new Uint8Array([0xa9, 0x05, 0x9c, 0xbb, 1, 2, 3, 4])
    );
    expect("Ok" in result).toBe(true);
    if ("Ok" in result) {
      // echo:<ctxLen>+<dataLen>: data is 8 bytes; ctx JSON contains chain_id + target + selector
      expect(result.Ok.function).toContain("+8");
    }
  });

  it("throws when an export is missing", () => {
    const { instance, manifest } = fakeInstance();
    const bridge = new AdapterBridge(instance, manifest);
    expect(() => bridge.mapToAction({ chain_id: 1, target: "0x0000000000000000000000000000000000000000", selector: "0xa9059cbb" }, {} as any)).toThrow(/map_to_action/);
  });
});
