/**
 * `collectTokenDecimals` — deep-walk a decoded ActionBody for ERC20 token keys
 * and resolve each address's decimals from the registry singleton, for the
 * `amountNano` lowering enrichment.
 *
 * Coverage:
 *   - flat body: every ERC20 `{ standard:"erc20", chain, address }` collected
 *   - multicall nesting: child tokens reached via the recursive walk
 *   - native keys ignored (lowering hardcodes 18); NFT keys ignored
 *   - no tokens → `{}` with zero fetches
 *   - per-token fetch failure is non-fatal (that token omitted, others kept)
 *   - addresses lowercased; chain parsed from each token's own `eip155:<n>`
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
import { __resetTokenRegistryClientForTest, type TokenMetadata } from "../token-client";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";

const DECIMALS: Record<string, number> = { [USDC]: 6, [WETH]: 18, [DAI]: 18 };

function meta(address: string): TokenMetadata {
  return {
    erc_kind: "erc20",
    chainId: 1,
    address,
    symbol: "TKN",
    decimals: DECIMALS[address] ?? 18,
    name: "Token",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** ERC20 TokenKey ref, the serde shape `policy_state::token::TokenKey::Erc20` */
function erc20Ref(address: string, chain = "eip155:1") {
  return { key: { standard: "erc20", chain, address } };
}

function nativeRef(chain = "eip155:1") {
  return { key: { standard: "native", chain } };
}

describe("collectTokenDecimals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localStore.clear();
    __resetTokenRegistryClientForTest();
    // The singleton (used by collectTokenDecimals) reads the global `fetch`.
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = [USDC, WETH, DAI].find((a) => url.includes(a));
      if (hit) return jsonResponse(meta(hit));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("collects every ERC20 token in a flat swap body, keyed by lowercase address", async () => {
    const swap = {
      domain: "amm",
      action: "swap",
      tokenIn: erc20Ref(USDC),
      tokenOut: erc20Ref(WETH),
      direction: { kind: "exact_input", amountIn: "0x3b9aca00" },
    };
    const out = await collectTokenDecimals(swap, 1);
    expect(out).toEqual({ [USDC]: 6, [WETH]: 18 });
  });

  it("walks into multicall children (recursive)", async () => {
    const batch = {
      domain: "multicall",
      actions: [
        { domain: "token", action: "erc20_transfer", token: erc20Ref(DAI), amount: "0x1" },
        {
          domain: "amm",
          action: "swap",
          tokenIn: erc20Ref(USDC),
          tokenOut: erc20Ref(WETH),
        },
      ],
    };
    const out = await collectTokenDecimals(batch, 1);
    expect(out).toEqual({ [DAI]: 18, [USDC]: 6, [WETH]: 18 });
  });

  it("lowercases checksum-cased addresses before lookup + keying", async () => {
    const checksum = USDC.toUpperCase().replace("0X", "0x");
    const out = await collectTokenDecimals({ token: erc20Ref(checksum) }, 1);
    expect(out).toEqual({ [USDC]: 6 });
  });

  it("ignores native and NFT keys (no fetch, no entry)", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const body = {
      domain: "token",
      action: "erc20_transfer",
      token: nativeRef(),
      nft: { key: { standard: "erc721", chain: "eip155:1", contract: WETH, tokenId: "0x1" } },
    };
    const out = await collectTokenDecimals(body, 1);
    expect(out).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns {} for a body with no tokens, without fetching", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const out = await collectTokenDecimals({ domain: "perp", action: "cancel_order" }, 1);
    expect(out).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is non-fatal: an unknown token (404) is omitted, known siblings kept", async () => {
    const unknown = "0x0000000000000000000000000000000000000099";
    const out = await collectTokenDecimals(
      { tokenIn: erc20Ref(USDC), tokenOut: erc20Ref(unknown) },
      1,
    );
    expect(out).toEqual({ [USDC]: 6 });
  });

  it("never throws even if fetch rejects outright → {}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new Error("network down");
      }),
    );
    const out = await collectTokenDecimals({ tokenIn: erc20Ref(USDC) }, 1);
    expect(out).toEqual({});
  });

  it("parses chain from each token's own eip155 tag, not just the hint", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await collectTokenDecimals({ tokenIn: erc20Ref(USDC, "eip155:8453") }, 1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    // token-client builds `/tokens/<chainId>/<addr>.json`; chain 8453 from the tag.
    expect(calledUrl).toContain(`/tokens/8453/${USDC}.json`);
  });
});
