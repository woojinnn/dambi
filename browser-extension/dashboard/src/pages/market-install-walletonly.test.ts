import { beforeEach, describe, expect, it, vi } from "vitest";

// installListingWalletOnlyV2의 지갑별 파라미터 라우팅만 검증한다 — 변환/cedar는
// 가볍게 모킹하고, ps2 server-api 호출(bindDef 등)을 spy 해서 어떤 주소에 어떤
// params로 바인딩이 생기는지 본다.
const mocks = vi.hoisted(() => ({
  getListingVersion: vi.fn(async () => ({
    cedar_text: "permit(...);",
    manifest: { id: "m" },
    members: [],
  })),
  installListing: vi.fn(async () => ({
    cedar_text: "permit(...);",
    manifest: { id: "m" },
    members: [],
  })),
  bindDef: vi.fn(
    async (_arg: {
      addresses: string[];
      packageId?: string;
      params?: Record<string, unknown>;
      severity?: "deny" | "warn";
    }) => undefined,
  ),
  installMarket: vi.fn(async () => undefined),
  putWalletPackage: vi.fn(
    async (_arg: { address: string; pkg: { id: string; name?: string } }) =>
      undefined,
  ),
}));

vi.mock("../server-api", () => ({
  getListingVersion: mocks.getListingVersion,
  installListing: mocks.installListing,
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

import { installListingV2, installListingWalletOnlyV2 } from "./market-install-v2";

const detail = {
  id: "L1",
  kind: "policy",
  slug: "lim",
  display_name: "한도",
  current_version: "1.0.0",
  latest_version: { cedar_text: "permit(...);", manifest: { id: "m" }, members: [] },
} as never;

const emptySnap = { library: { defs: {}, packages: {} }, wallets: { byAddress: {} } } as never;
const PARAM_A = "0xa1c4000000000000000000000000000000007e29";
const PARAM_B = "0xb2c4000000000000000000000000000000007e29";
const PARAM_COMMON = "0xc0c4000000000000000000000000000000007e29";

beforeEach(() => {
  mocks.getListingVersion.mockClear();
  mocks.installListing.mockClear();
  mocks.bindDef.mockClear();
  mocks.installMarket.mockClear();
  mocks.putWalletPackage.mockClear();
  mocks.installMarket.mockResolvedValue(undefined);
});

describe("installListingV2 install event ordering", () => {
  it("uses the atomic install/download body before local install", async () => {
    await installListingV2(detail, "ko", {
      scope: { kind: "library-only" },
      applyToNewWallets: false,
      packageId: null,
      snap: emptySnap,
      params: { "def::market.L1": { v1: PARAM_COMMON } },
    });

    expect(mocks.getListingVersion).toHaveBeenCalledWith("L1", "1.0.0");
    expect(mocks.installListing).toHaveBeenCalledWith("L1", "1.0.0");
    expect(mocks.installMarket).toHaveBeenCalledTimes(1);
    expect(mocks.getListingVersion.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.installListing.mock.invocationCallOrder[0],
    );
    expect(mocks.installListing.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.installMarket.mock.invocationCallOrder[0],
    );
  });

  it("does not write locally when the atomic install/download is rejected", async () => {
    mocks.installListing.mockRejectedValueOnce(new Error("version not found"));

    await expect(
      installListingV2(detail, "ko", {
        scope: { kind: "library-only" },
        applyToNewWallets: false,
        packageId: null,
        snap: emptySnap,
        params: { "def::market.L1": { v1: PARAM_COMMON } },
      }),
    ).rejects.toThrow(/version not found/);

    expect(mocks.installMarket).not.toHaveBeenCalled();
  });

  it("does not download the body twice when local install fails", async () => {
    mocks.installMarket.mockRejectedValueOnce(new Error("local write failed"));

    await expect(
      installListingV2(detail, "ko", {
        scope: { kind: "library-only" },
        applyToNewWallets: false,
        packageId: null,
        snap: emptySnap,
        params: { "def::market.L1": { v1: PARAM_COMMON } },
      }),
    ).rejects.toThrow(/local write failed/);

    expect(mocks.installListing).toHaveBeenCalledTimes(1);
  });

  it("rejects missing required holes before the atomic install/download call", async () => {
    await expect(
      installListingV2(detail, "ko", {
        scope: { kind: "library-only" },
        applyToNewWallets: false,
        packageId: null,
        snap: emptySnap,
      }),
    ).rejects.toThrow(/빈칸/);

    expect(mocks.getListingVersion).toHaveBeenCalledWith("L1", "1.0.0");
    expect(mocks.installListing).not.toHaveBeenCalled();
    expect(mocks.installMarket).not.toHaveBeenCalled();
  });
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
        [A]: { "pkg::uncat": { "def::market.L1": { v1: PARAM_A } } },
        [B]: { "pkg::uncat": { "def::market.L1": { v1: PARAM_B } } },
      },
    });
    const byAddr = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.addresses[0], arg.params]),
    );
    expect(byAddr.get(A)).toEqual({ v1: PARAM_A });
    expect(byAddr.get(B)).toEqual({ v1: PARAM_B });
  });

  it("binds the same def to multiple packages of one wallet, each with its own params", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: ["pkg::uncat", "pkg::p2"] },
      snap: emptySnap,
      paramsByAddressPkg: {
        [A]: {
          "pkg::uncat": { "def::market.L1": { v1: PARAM_A } },
          "pkg::p2": { "def::market.L1": { v1: PARAM_B } },
        },
      },
    });
    const byPkg = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.packageId, arg.params]),
    );
    expect(byPkg.get("pkg::uncat")).toEqual({ v1: PARAM_A });
    expect(byPkg.get("pkg::p2")).toEqual({ v1: PARAM_B });
  });

  it("dedupes duplicate package keys within one wallet-only install run", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: ["pkg::uncat", "pkg::uncat"] },
      snap: emptySnap,
      paramsByAddressPkg: {
        [A]: { "pkg::uncat": { "def::market.L1": { v1: PARAM_A } } },
      },
    });

    expect(mocks.bindDef).toHaveBeenCalledTimes(1);
    expect(mocks.bindDef).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: [A], packageId: "pkg::uncat" }),
    );
  });

  it("dedupes duplicate new-package selections within one wallet-only install run", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: ["__new__", "__new__"] },
      walletNewName: { [A]: "거래소" },
      snap: emptySnap,
      paramsByAddressPkg: {
        [A]: { __new__: { "def::market.L1": { v1: PARAM_A } } },
      },
    });

    expect(mocks.putWalletPackage).toHaveBeenCalledTimes(1);
    expect(mocks.bindDef).toHaveBeenCalledTimes(1);
    const bindArg = mocks.bindDef.mock.calls[0]?.[0];
    const putArg = mocks.putWalletPackage.mock.calls[0]?.[0];
    if (!bindArg || !putArg) throw new Error("expected new-package bind call");
    expect(bindArg.packageId).toBe(putArg.pkg.id);
  });

  it("falls back to common params when a combo has no per-package entry", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    await installListingWalletOnlyV2(detail, "ko", {
      addresses: [A],
      walletPackages: { [A]: ["pkg::uncat"] },
      snap: emptySnap,
      params: { "def::market.L1": { v1: PARAM_COMMON } },
      paramsByAddressPkg: {},
    });
    expect(mocks.bindDef).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: [A], params: { v1: PARAM_COMMON } }),
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
      params: { "def::market.L1": { v1: PARAM_COMMON } },
      severityByAddressPkg: { [A]: { "pkg::uncat": { "def::market.L1": "warn" } } },
    });
    const sevByAddr = new Map(
      mocks.bindDef.mock.calls.map(([arg]) => [arg.addresses[0], arg.severity]),
    );
    expect(sevByAddr.get(A)).toBe("warn"); // override
    expect(sevByAddr.get(B)).toBeUndefined(); // def 선언값 따름
  });

  it("preflights required holes before any wallet-only local writes", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";
    const B = "0xbbbb000000000000000000000000000000000002";

    await expect(
      installListingWalletOnlyV2(detail, "ko", {
        addresses: [A, B],
        walletPackages: { [A]: ["pkg::uncat"], [B]: ["pkg::uncat"] },
        snap: emptySnap,
        paramsByAddressPkg: {
          [A]: { "pkg::uncat": { "def::market.L1": { v1: PARAM_A } } },
        },
      }),
    ).rejects.toThrow(/빈칸|받는 주소/);

    expect(mocks.installMarket).not.toHaveBeenCalled();
    expect(mocks.putWalletPackage).not.toHaveBeenCalled();
    expect(mocks.bindDef).not.toHaveBeenCalled();
    expect(mocks.installListing).not.toHaveBeenCalled();
  });

  it("rejects a blank new wallet package name before any local writes", async () => {
    const A = "0xaaaa000000000000000000000000000000000001";

    await expect(
      installListingWalletOnlyV2(detail, "ko", {
        addresses: [A],
        walletPackages: { [A]: ["__new__"] },
        walletNewName: { [A]: "   " },
        snap: emptySnap,
        paramsByAddressPkg: {
          [A]: { __new__: { "def::market.L1": { v1: PARAM_A } } },
        },
      }),
    ).rejects.toThrow(/새 패키지 이름|required/i);

    expect(mocks.installMarket).not.toHaveBeenCalled();
    expect(mocks.putWalletPackage).not.toHaveBeenCalled();
    expect(mocks.bindDef).not.toHaveBeenCalled();
    expect(mocks.installListing).not.toHaveBeenCalled();
  });
});
