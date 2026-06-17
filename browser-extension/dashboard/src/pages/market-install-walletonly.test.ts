import { beforeEach, describe, expect, it, vi } from "vitest";

// installListingWalletOnlyV2의 지갑별 파라미터 라우팅만 검증한다 — 변환/cedar는
// 가볍게 모킹하고, ps2 server-api 호출(bindDef 등)을 spy 해서 어떤 주소에 어떤
// params로 바인딩이 생기는지 본다.
const mocks = vi.hoisted(() => ({
  bindDef: vi.fn(
    async (_arg: {
      addresses: string[];
      packageId?: string;
      params?: Record<string, unknown>;
      severity?: "deny" | "warn";
    }) => undefined,
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

describe("installListingWalletOnlyV2 per-package params", () => {
  it("binds each (wallet,package) combo with its own params from paramsByAddressPkg", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    const B = "0xbbbb000000000000000000000000000000000002";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A, B],
      walletPackages: { [A]: ["pkg::uncat"], [B]: ["pkg::uncat"] },
      snap: emptySnap,
      paramsByAddressPkg: {
        [A]: { "pkg::uncat": { "def::market.L1": { v1: "0xa1" } } },
        [B]: { "pkg::uncat": { "def::market.L1": { v1: "0xb2" } } },
      },
    });
    const byAddr = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.addresses[0], arg.params]),
    );
    expect(byAddr.get(A)).toEqual({ v1: "0xa1" });
    expect(byAddr.get(B)).toEqual({ v1: "0xb2" });
  });

  it("binds the same def to multiple packages of one wallet, each with its own params", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: ["pkg::uncat", "pkg::p2"] },
      snap: emptySnap,
      paramsByAddressPkg: {
        [A]: {
          "pkg::uncat": { "def::market.L1": { v1: "0x1" } },
          "pkg::p2": { "def::market.L1": { v1: "0x2" } },
        },
      },
    });
    const byPkg = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.packageId, arg.params]),
    );
    expect(byPkg.get("pkg::uncat")).toEqual({ v1: "0x1" });
    expect(byPkg.get("pkg::p2")).toEqual({ v1: "0x2" });
  });

  it("falls back to common params when a combo has no per-package entry", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: ["pkg::uncat"] },
      snap: emptySnap,
      params: { "def::market.L1": { v1: "0xcommon" } },
      paramsByAddressPkg: {},
    });
    expect(mocks.bindDef).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: [A], params: { v1: "0xcommon" } }),
    );
  });

  it("creates no bindings for a wallet with no selected package (library only)", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: [] },
      snap: emptySnap,
    });
    expect(mocks.bindDef).not.toHaveBeenCalled();
  });

  it("threads per-package severity override to the binding", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    const B = "0xbbbb000000000000000000000000000000000002";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A, B],
      walletPackages: { [A]: ["pkg::uncat"], [B]: ["pkg::uncat"] },
      snap: emptySnap,
      severityByAddressPkg: { [A]: { "pkg::uncat": { "def::market.L1": "warn" } } },
    });
    const sevByAddr = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.addresses[0], arg.severity]),
    );
    expect(sevByAddr.get(A)).toBe("warn"); // override
    expect(sevByAddr.get(B)).toBeUndefined(); // def 선언값 따름
  });
});
