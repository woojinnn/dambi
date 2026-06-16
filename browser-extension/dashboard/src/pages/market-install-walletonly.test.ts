import { beforeEach, describe, expect, it, vi } from "vitest";

// installListingWalletOnlyV2의 지갑별 파라미터 라우팅만 검증한다 — 변환/cedar는
// 가볍게 모킹하고, ps2 server-api 호출(bindDef 등)을 spy 해서 어떤 주소에 어떤
// params로 바인딩이 생기는지 본다.
const mocks = vi.hoisted(() => ({
  bindDef: vi.fn(
    async (_arg: { addresses: string[]; params?: Record<string, unknown> }) => undefined,
  ),
  installMarket: vi.fn(async () => undefined),
  putWalletPackage: vi.fn(async () => undefined),
}));

vi.mock("../server-api", () => ({
  installListing: vi.fn(async () => ({
    cedar_text: "permit(...);",
    manifest: { id: "m" },
    members: [],
  })),
  pickI18n: (v: unknown) => (typeof v === "string" ? v : "리스팅"),
}));

vi.mock("../server-api/policy-store", () => ({
  bindDef: mocks.bindDef,
  installMarket: mocks.installMarket,
  putWalletPackage: mocks.putWalletPackage,
  UNCATEGORIZED_PKG: "pkg::uncat",
}));

vi.mock("../cedar", () => ({
  textToBlocks: vi.fn(async () => ({ kind: "policy" })),
}));

// def 1개에 required hole v1(address) 하나가 있는 것처럼 변환된다.
vi.mock("./market-install-convert", () => ({
  listingToDefs: vi.fn(async () => [
    {
      id: "def::market.L1",
      displayName: "한도",
      skeleton: { ir: { kind: "policy" }, manifest: { id: "m" } },
      holes: [{ name: "v1", type: "address", label: "받는 주소", required: true }],
      defaults: { enabled: false, params: {} },
      source: "market",
      updatedAtMs: 1,
    },
  ]),
  requiredHolesOf: vi.fn(() => []),
  holeInputToValue: vi.fn(),
}));

import { installListingWalletOnlyV2 } from "./market-install-v2";

const detail = {
  id: "L1",
  kind: "policy",
  slug: "lim",
  display_name: "한도",
  current_version: "1.0.0",
  latest_version: { cedar_text: "permit(...);", manifest: { id: "m" }, members: [] },
} as never;

const emptySnap = { library: { defs: {}, packages: {} }, wallets: { byAddress: {} } } as never;

beforeEach(() => {
  mocks.bindDef.mockClear();
  mocks.installMarket.mockClear();
});

describe("installListingWalletOnlyV2 per-wallet params", () => {
  it("binds each address with its own params from paramsByAddress", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    const B = "0xbbbb000000000000000000000000000000000002";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A, B],
      walletPackages: { [A]: { id: "pkg::uncat" }, [B]: { id: "pkg::uncat" } },
      snap: emptySnap,
      paramsByAddress: {
        [A]: { "def::market.L1": { v1: "0xa1" } },
        [B]: { "def::market.L1": { v1: "0xb2" } },
      },
    });
    const byAddr = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.addresses[0], arg.params]),
    );
    expect(byAddr.get(A)).toEqual({ v1: "0xa1" });
    expect(byAddr.get(B)).toEqual({ v1: "0xb2" });
  });

  it("falls back to common params when an address has no per-wallet entry", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: { id: "pkg::uncat" } },
      snap: emptySnap,
      params: { "def::market.L1": { v1: "0xcommon" } },
      paramsByAddress: {},
    });
    expect(mocks.bindDef).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: [A], params: { v1: "0xcommon" } }),
    );
  });
});
