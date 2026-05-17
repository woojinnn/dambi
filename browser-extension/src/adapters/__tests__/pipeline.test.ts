import { describe, expect, it, vi } from "vitest";
import { Pipeline } from "../pipeline";
import { Loader } from "../loader";
import { RegistryClient } from "../registry-client";
import { AdapterCache, type CacheBackend } from "../cache";

class MemBackend implements CacheBackend {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k); }
  async set(k: string, v: string) { this.store.set(k, v); }
  async delete(k: string) { this.store.delete(k); }
  async keys() { return Array.from(this.store.keys()); }
}

function fakePipeline() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
  const reg = new RegistryClient("http://r", fetchMock);
  const cache = new AdapterCache(new MemBackend(), { capacity: 32, ttlMs: 60_000 });
  const loader = new Loader({ registry: reg, cache });
  return new Pipeline({ loader });
}

describe("Pipeline.run", () => {
  it("write miss returns one Action::Other envelope + registry_miss diagnostic", async () => {
    const p = fakePipeline();
    const res = await p.run(
      "eth_sendTransaction",
      [{ to: "0xabcd", data: "0xa9059cbb" }],
      1
    );
    expect(res.envelopes).toHaveLength(1);
    expect(res.envelopes[0]!.action.kind).toBe("other");
    expect(res.diagnostics?.registry_miss).toBe(true);
  });

  it("write without `to` returns no envelopes", async () => {
    const p = fakePipeline();
    const res = await p.run("eth_sendTransaction", [{}], 1);
    expect(res.envelopes).toHaveLength(0);
  });

  it("personal_sign without pe-wasm helper returns Action::Other + sign_parse_error diagnostic", async () => {
    const p = fakePipeline();
    const res = await p.run("personal_sign", ["0xdeadbeef", "0x1234"], 1);
    expect(res.envelopes).toHaveLength(1);
    expect(res.envelopes[0]!.action.kind).toBe("other");
    expect(res.diagnostics?.sign_parse_error).toContain("not wired");
  });

  it("personal_sign with stub pe-wasm helper returns Action::Other (non-typed-data path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const reg = new RegistryClient("http://r", fetchMock);
    const cache = new AdapterCache(new MemBackend(), { capacity: 32, ttlMs: 60_000 });
    const loader = new Loader({ registry: reg, cache });
    const helpers = {
      parseSignRequestJson: () => JSON.stringify({
        kind: "ok",
        method: "personalsign",
        signer: "0xabcd",
        chain_id: 1,
        payload: "0xdeadbeef",
      }),
    };
    const p = new Pipeline({ loader, helpers });
    const res = await p.run("personal_sign", ["0xdeadbeef", "0xabcd"], 1);
    expect(res.envelopes).toHaveLength(1);
    expect(res.envelopes[0]!.action.kind).toBe("other");
  });
});
