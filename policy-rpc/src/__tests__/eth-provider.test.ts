import { describe, expect, it } from "vitest";

import { rpcUrlForChain, RPC_URL_BY_CHAIN } from "../chain-config";
import { getPublicClient, resetPublicClientCache } from "../eth-provider";
import { RpcMethodError } from "../types";

describe("eth-provider / chain-config", () => {
  it("returns the public default RPC URL for known chains", () => {
    expect(rpcUrlForChain(1, {})).toBe(RPC_URL_BY_CHAIN[1]);
  });

  it("honours the RPC_URL_<chainId> env override when set", () => {
    const override = "https://example.invalid/rpc";
    expect(rpcUrlForChain(1, { RPC_URL_1: override })).toBe(override);
  });

  it("returns undefined for chains not in RPC_URL_BY_CHAIN when no env override is set", () => {
    // chain 9999 has no default URL and no override -> undefined so callers can
    // throw a tailored error.
    expect(rpcUrlForChain(9999, {})).toBeUndefined();
  });

  it("throws unsupported_chain when getPublicClient is called for an unknown chain with no override", () => {
    resetPublicClientCache();
    try {
      let captured: unknown;
      try {
        getPublicClient(9999);
      } catch (error) {
        captured = error;
      }
      expect(captured).toBeInstanceOf(RpcMethodError);
      expect((captured as RpcMethodError).code).toBe("unsupported_chain");
      expect((captured as RpcMethodError).message).toMatch(/No RPC URL configured/);
    } finally {
      resetPublicClientCache();
    }
  });
});
