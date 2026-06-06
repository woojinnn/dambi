// @vitest-environment node
/**
 * LIVE integration test (NETWORK) — `collectTokenDecimals` against the real
 * deployed registry-api `/tokens/{chain}/{addr}.json` endpoint. This is a
 * ONE-OFF verification (not part of the default suite — it is network-dependent
 * and is deleted after running). It proves the service-worker side of the
 * `amountNano` enrichment end-to-end: deep-walk an ActionBody → fetch each
 * ERC20's decimals from the live registry → produce the `token_decimals` map
 * the WASM lowering consumes, parsing the live response shape correctly and
 * omitting a 404 token gracefully.
 *
 * Run:
 *   REGISTRY_BASE_URL=https://registry-api-v3-891268973493.asia-northeast3.run.app \
 *     node .yarn/releases/yarn-4.14.1.cjs vitest run \
 *       backend/service-worker/registry/__tests__/collect-token-decimals.live.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    browser: {
      runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStore.get(key) })),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
        },
      },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: mocks.browser }));

import { collectTokenDecimals } from "../collect-token-decimals";
import { __resetTokenRegistryClientForTest } from "../token-client";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const UNKNOWN = "0x000000000000000000000000000000000000dead";

function erc20Ref(address: string, chain = "eip155:1") {
  return { key: { standard: "erc20", chain, address } };
}

// Network-guarded: skipped unless RUN_LIVE_REGISTRY_TESTS=1 so the default
// suite stays offline/deterministic.
describe.skipIf(process.env.RUN_LIVE_REGISTRY_TESTS !== "1")("collectTokenDecimals (LIVE registry-api)", () => {
  beforeEach(() => {
    mocks.localStore.clear();
    __resetTokenRegistryClientForTest(); // real global fetch, no stub
  });

  it("fetches real decimals USDC(6)+WETH(18) and omits a 404 token", async () => {
    // A swap-shaped body carrying two known tokens + one unknown (drained-burn
    // address → 404 in the registry). Exercises the recursive walk + live fetch.
    const body = {
      domain: "amm",
      action: "swap",
      tokenIn: erc20Ref(USDC),
      tokenOut: erc20Ref(WETH),
      direction: { kind: "exact_input", amountIn: "0x3b9aca00" },
      extra: { token: erc20Ref(UNKNOWN) },
    };
    const out = await collectTokenDecimals(body, 1);
    // eslint-disable-next-line no-console
    console.log("[LIVE] collectTokenDecimals →", JSON.stringify(out));
    expect(out[USDC]).toBe(6);
    expect(out[WETH]).toBe(18);
    expect(out[UNKNOWN]).toBeUndefined();
  }, 30000);
});
