import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    browser: {
      storage: {
        local: {
          get: vi.fn(async (key?: string | string[] | null) => {
            if (key == null) return Object.fromEntries(localStore);
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(keys.filter((k) => localStore.has(k)).map((k) => [k, localStore.get(k)]));
          }),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) localStore.set(k, v);
          }),
          remove: vi.fn(async (key: string | string[]) => {
            for (const k of Array.isArray(key) ? key : [key]) localStore.delete(k);
          }),
        },
      },
    },
  };
});
vi.mock("webextension-polyfill", () => ({ default: mocks.browser }));

import {
  bind,
  copyBindings,
  deleteDef,
  deletePackage,
  duplicateDef,
  installMarket,
  provisionWallets,
  putDef,
  putPackage,
  putWalletFolder,
  removeBinding,
  removeWalletFolder,
  putWalletPackage,
  removePackageFromWallet,
  setPackageEnabled,
  updateBinding,
} from "./ops";
import { readStore } from "./store";
import { isEffectiveOn, UNCATEGORIZED_PKG, type PolicyDef } from "./types";

const def = (id: string): PolicyDef => ({
  id,
  displayName: id,
  skeleton: { ir: { kind: "policy" } },
  holes: [],
  defaults: { enabled: true, params: {} },
  source: "mine",
  updatedAtMs: 1,
});

beforeEach(() => mocks.localStore.clear());

describe("policy-store ops", () => {
  it("deleteDef cascades bindings on every wallet", async () => {
    await putDef("u", def("def::a"));
    await bind("u", { defId: "def::a", packageId: UNCATEGORIZED_PKG, addresses: ["0xA100000000000000000000000000000000000001", "0xa200000000000000000000000000000000000002"] });
    await deleteDef("u", "def::a");
    const s = await readStore("u");
    expect(Object.values(s.wallets.byAddress).flatMap((w) => Object.keys(w.bindings))).toEqual([]);
    expect(s.library.defs["def::a"]).toBeUndefined();
  });

  it("기본 안전팩(builtin)은 삭제·수정·이름변경이 막힌다", async () => {
    const builtin: PolicyDef = { ...def("def::builtin.x"), source: "builtin" };
    await putDef("u", builtin); // 신규 생성(시드 경로)은 허용 — 기존 builtin만 보호
    await putPackage("u", { id: "pkg::builtin.day1-safety", displayName: "기본 안전팩", source: "builtin", updatedAtMs: 1 });

    await expect(deleteDef("u", "def::builtin.x")).rejects.toThrow();
    await expect(putDef("u", { ...builtin, displayName: "변경 시도" })).rejects.toThrow();
    await expect(deletePackage("u", "pkg::builtin.day1-safety")).rejects.toThrow();
    await expect(
      putPackage("u", { id: "pkg::builtin.day1-safety", displayName: "rename", source: "builtin", updatedAtMs: 2 }),
    ).rejects.toThrow();

    const s = await readStore("u");
    expect(s.library.defs["def::builtin.x"]?.displayName).toBe("def::builtin.x");
    expect(s.library.packages["pkg::builtin.day1-safety"]?.displayName).toBe("기본 안전팩");
  });

  it("기본 안전팩은 지갑에서 빼기(removePackageFromWallet)도 막힌다", async () => {
    await putPackage("u", { id: "pkg::builtin.day1-safety", displayName: "기본 안전팩", source: "builtin", updatedAtMs: 1 });
    // builtin 정의는 기본 안전팩 폴더에 들어간다(시드와 동일). 사용자 bind()로는
    // 더 이상 기본 안전팩에 추가할 수 없으므로(읽기 전용), 시드/프로비저닝 경로로 적용.
    await putDef("u", { ...def("def::b1"), source: "builtin", defaults: { enabled: true, params: { cap: 1 }, packageId: "pkg::builtin.day1-safety" } });
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await expect(removePackageFromWallet("u", { address: "0xa100000000000000000000000000000000000001", packageId: "pkg::builtin.day1-safety" })).rejects.toThrow();
    const s = await readStore("u");
    expect(Object.values(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings).length).toBe(1);
  });

  it("기본 안전팩은 추가도 막힌다 — bind/putDef(내 정의)/duplicate 모두 거부 (읽기 전용)", async () => {
    await putPackage("u", { id: "pkg::builtin.day1-safety", displayName: "기본 안전팩", source: "builtin", updatedAtMs: 1 });
    await putDef("u", def("def::mine"));
    const addr = "0xa100000000000000000000000000000000000001";
    // 기본 안전팩 패키지에 바인딩(적용) 금지
    await expect(bind("u", { defId: "def::mine", packageId: "pkg::builtin.day1-safety", addresses: [addr] })).rejects.toThrow();
    // 내 정의를 기본 안전팩 템플릿 폴더에 넣기 금지
    await expect(putDef("u", { ...def("def::mine"), defaults: { enabled: true, params: { cap: 1 }, packageId: "pkg::builtin.day1-safety" } })).rejects.toThrow();
    // 기본 안전팩 폴더로 복제 금지
    await expect(duplicateDef("u", "def::mine", "pkg::builtin.day1-safety")).rejects.toThrow();
    // 미분류(pkg::uncategorized)는 영향 없음 — 정상 바인딩
    await expect(bind("u", { defId: "def::mine", packageId: UNCATEGORIZED_PKG, addresses: [addr] })).resolves.toBeUndefined();
  });

  it("builtin을 duplicateDef하면 source:'mine' 사본이 생겨 편집할 수 있다", async () => {
    await putDef("u", { ...def("def::builtin.y"), source: "builtin" });
    const newId = await duplicateDef("u", "def::builtin.y");
    const s = await readStore("u");
    expect(s.library.defs[newId]?.source).toBe("mine");
    // 사본은 더 이상 잠겨 있지 않다 — 수정/삭제 가능.
    await expect(putDef("u", { ...s.library.defs[newId], displayName: "내 사본" })).resolves.toBeUndefined();
  });

  it("market install cannot overwrite or reserve builtin safety-pack ids", async () => {
    await putDef("u", { ...def("def::builtin.x"), source: "builtin" });
    await putPackage("u", {
      id: "pkg::builtin.day1-safety",
      displayName: "기본 안전팩",
      source: "builtin",
      updatedAtMs: 1,
    });

    await expect(
      installMarket("u", {
        defs: [{ ...def("def::builtin.x"), displayName: "evil market shadow" }],
        scope: { kind: "library-only" },
      }),
    ).rejects.toThrow(/builtin/);
    await expect(
      installMarket("u", {
        defs: [def("def::market.safe")],
        pkg: {
          id: "pkg::builtin.day1-safety",
          displayName: "evil market package",
          source: "market",
          updatedAtMs: 2,
        },
        scope: { kind: "library-only" },
      }),
    ).rejects.toThrow(/builtin/);
    await expect(
      installMarket("u", {
        defs: [def("def::builtin.future")],
        scope: { kind: "library-only" },
      }),
    ).rejects.toThrow(/builtin/);

    const s = await readStore("u");
    expect(s.library.defs["def::builtin.x"]?.displayName).toBe("def::builtin.x");
    expect(s.library.defs["def::market.safe"]).toBeUndefined();
    expect(s.library.defs["def::builtin.future"]).toBeUndefined();
    expect(s.library.packages["pkg::builtin.day1-safety"]?.displayName).toBe("기본 안전팩");
    expect(s.library.packages["pkg::builtin.day1-safety"]?.source).toBe("builtin");
  });

  it("deletePackage(라이브러리 폴더 삭제)는 지갑 패키지/바인딩을 건드리지 않는다", async () => {
    await putDef("u", def("def::a"));
    await putPackage("u", { id: "pkg::x", displayName: "X", source: "mine", updatedAtMs: 1 });
    // bind가 같은 id의 지갑 패키지를 실체화한다 — 이후 폴더가 사라져도 지갑은 그대로.
    await bind("u", { defId: "def::a", packageId: "pkg::x", addresses: ["0xa100000000000000000000000000000000000001"] });
    await deletePackage("u", "pkg::x");
    const s = await readStore("u");
    const w = s.wallets.byAddress["0xa100000000000000000000000000000000000001"];
    const b = Object.values(w.bindings)[0];
    expect(b.packageId).toBe("pkg::x");
    expect(w.packages["pkg::x"]).toEqual(expect.objectContaining({ displayName: "X" }));
    expect(s.library.packages["pkg::x"]).toBeUndefined();
  });

  it("deleting 미분류 package throws", async () => {
    await expect(deletePackage("u", UNCATEGORIZED_PKG)).rejects.toThrow();
  });

  it("same def in different packages = independent instances", async () => {
    await putDef("u", def("def::a"));
    await putPackage("u", { id: "pkg::x", displayName: "X", source: "mine", updatedAtMs: 1 });
    await bind("u", { defId: "def::a", packageId: "pkg::x", addresses: ["0xa100000000000000000000000000000000000001"] });
    await bind("u", { defId: "def::a", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"] });
    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)).toHaveLength(2);
  });

  it("package toggle composes with binding toggle and restores partial state", async () => {
    await putDef("u", def("def::a"));
    await putDef("u", def("def::b"));
    await putPackage("u", { id: "pkg::x", displayName: "X", source: "mine", updatedAtMs: 1 });
    await bind("u", { defId: "def::a", packageId: "pkg::x", addresses: ["0xa100000000000000000000000000000000000001"] });
    await bind("u", { defId: "def::b", packageId: "pkg::x", addresses: ["0xa100000000000000000000000000000000000001"] });
    const s1 = await readStore("u");
    const all = Object.values(s1.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings);
    const ba = all.find((b) => b.defId === "def::a")!;
    const bb = all.find((b) => b.defId === "def::b")!;
    await updateBinding("u", { address: "0xa100000000000000000000000000000000000001", bindingId: bb.id, patch: { enabled: false } });
    await setPackageEnabled("u", { address: "0xa100000000000000000000000000000000000001", packageId: "pkg::x", enabled: false });
    let s = await readStore("u");
    let w = s.wallets.byAddress["0xa100000000000000000000000000000000000001"];
    expect(Object.values(w.bindings).some((b) => isEffectiveOn(w, b))).toBe(false);
    await setPackageEnabled("u", { address: "0xa100000000000000000000000000000000000001", packageId: "pkg::x", enabled: true });
    s = await readStore("u");
    w = s.wallets.byAddress["0xa100000000000000000000000000000000000001"];
    expect(isEffectiveOn(w, w.bindings[ba.id])).toBe(true); // 복원
    expect(isEffectiveOn(w, w.bindings[bb.id])).toBe(false); // 부분 끔 유지
  });

  it("provisionWallets auto-binds defaults.enabled defs once (idempotent, lowercases)", async () => {
    await putDef("u", def("def::a"));
    await putDef("u", { ...def("def::off"), defaults: { enabled: false, params: {} } });
    await provisionWallets("u", ["0xA100000000000000000000000000000000000001"]);
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress)).toEqual(["0xa100000000000000000000000000000000000001"]);
    const w = s.wallets.byAddress["0xa100000000000000000000000000000000000001"];
    expect(Object.values(w.bindings).map((b) => b.defId)).toEqual(["def::a"]);
  });

  it("rejects malformed wallet addresses before creating policy-store rows", async () => {
    await putDef("u", def("def::a"));
    await expect(
      bind("u", { defId: "def::a", packageId: UNCATEGORIZED_PKG, addresses: ["0xabc"] }),
    ).rejects.toThrow(/EVM address/);
    await expect(provisionWallets("u", ["__proto__"])).rejects.toThrow(/EVM address/);
    await expect(
      putWalletPackage("u", { address: "constructor", pkg: { id: "pkg::w1", displayName: "bad" } }),
    ).rejects.toThrow(/EVM address/);

    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress)).toEqual([]);
  });

  it("rejects unsafe structural ids before they become object keys", async () => {
    await expect(putDef("u", { ...def("__proto__"), id: "__proto__" })).rejects.toThrow(/safe storage key/);
    await expect(
      putPackage("u", { id: "constructor", displayName: "bad", source: "mine", updatedAtMs: 1 }),
    ).rejects.toThrow(/safe storage key/);
    await expect(
      putWalletPackage("u", {
        address: "0xa100000000000000000000000000000000000001",
        pkg: { id: "__proto__", displayName: "bad" },
      }),
    ).rejects.toThrow(/safe storage key/);
  });

  it("rejects unsafe policy definition internals before delayed provisioning failures", async () => {
    await expect(
      putDef("u", {
        ...def("def::unsafe-default-pkg"),
        defaults: { enabled: true, params: {}, packageId: "__proto__" },
      }),
    ).rejects.toThrow(/safe storage key/);

    await expect(
      putDef("u", {
        ...def("def::unsafe-hole"),
        holes: [{ name: "__proto__", type: "string", label: "bad", required: true }],
      }),
    ).rejects.toThrow(/safe storage key/);

    await expect(
      putDef("u", {
        ...def("def::duplicate-hole"),
        holes: [
          { name: "v1", type: "string", label: "first" },
          { name: "v1", type: "string", label: "second" },
        ],
      }),
    ).rejects.toThrow(/duplicate hole name/);

    const withUnsafeParam = def("def::unsafe-param");
    Object.defineProperty(withUnsafeParam.defaults.params, "__proto__", {
      value: "0xa100000000000000000000000000000000000001",
      enumerable: true,
    });
    await expect(putDef("u", withUnsafeParam)).rejects.toThrow(/safe storage key/);
  });

  it("rejects malformed runtime booleans and severity enums before committing state", async () => {
    await expect(
      putDef("u", {
        ...def("def::bad-default-enabled"),
        defaults: { enabled: "false", params: {} },
      } as unknown as PolicyDef),
    ).rejects.toThrow(/default enabled/);

    await putDef("u", def("def::a"));
    await expect(
      bind("u", {
        defId: "def::a",
        packageId: UNCATEGORIZED_PKG,
        addresses: ["0xa100000000000000000000000000000000000001"],
        enabled: "false",
      } as never),
    ).rejects.toThrow(/binding enabled/);
    await expect(
      bind("u", {
        defId: "def::a",
        packageId: UNCATEGORIZED_PKG,
        addresses: ["0xa100000000000000000000000000000000000001"],
        severity: "block",
      } as never),
    ).rejects.toThrow(/binding severity/);
    await expect(
      setPackageEnabled("u", {
        address: "0xa100000000000000000000000000000000000001",
        packageId: "pkg::x",
        enabled: "false",
      } as never),
    ).rejects.toThrow(/wallet package gate/);

    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress)).toEqual([]);
  });

  it("rejects unsafe binding param keys before committing the binding", async () => {
    await putDef("u", def("def::a"));
    const params: Record<string, unknown> = {};
    Object.defineProperty(params, "__proto__", {
      value: "0xa100000000000000000000000000000000000001",
      enumerable: true,
    });

    await expect(
      bind("u", {
        defId: "def::a",
        packageId: UNCATEGORIZED_PKG,
        addresses: ["0xa100000000000000000000000000000000000001"],
        params: params as Record<string, never>,
      }),
    ).rejects.toThrow(/safe storage key/);

    const s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"]).toBeUndefined();
  });

  it("provisioning respects defaults.packageId", async () => {
    await putPackage("u", { id: "pkg::safe", displayName: "안전팩", source: "builtin", updatedAtMs: 1 });
    await putDef("u", { ...def("def::a"), defaults: { enabled: true, params: {}, packageId: "pkg::safe" } });
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    const s = await readStore("u");
    expect(Object.values(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)[0].packageId).toBe("pkg::safe");
  });

  it("non-binding wallet ops provision default protections before creating first wallet rows", async () => {
    await putDef("u", def("def::auto"));
    const A = "0xa100000000000000000000000000000000000001";
    const B = "0xb200000000000000000000000000000000000002";
    const C = "0xc300000000000000000000000000000000000003";

    await setPackageEnabled("u", { address: A, packageId: "pkg::ghost", enabled: false });
    await putWalletPackage("u", { address: B, pkg: { id: "pkg::w1", displayName: "전용" } });
    await putWalletFolder("u", { address: C, folder: { id: "fold::f1", displayName: "폴더" } });

    const s = await readStore("u");
    for (const address of [A, B, C]) {
      expect(Object.values(s.wallets.byAddress[address].bindings).some((b) => b.defId === "def::auto")).toBe(true);
    }
    expect(s.wallets.byAddress[B].packages["pkg::w1"]).toBeDefined();
    expect(s.wallets.byAddress[C].folders?.["fold::f1"]).toBeDefined();
  });

  it("duplicateDef makes an independent definition", async () => {
    await putDef("u", def("def::a"));
    const newId = await duplicateDef("u", "def::a");
    const s = await readStore("u");
    expect(newId).not.toBe("def::a");
    expect(s.library.defs[newId].displayName).toContain("복제");
    expect(s.library.defs[newId].source).toBe("mine");
  });

  it("copyBindings copies instances to another wallet (params preserved)", async () => {
    await putDef("u", def("def::a"));
    await bind("u", { defId: "def::a", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"], params: { x: 1 } });
    const src = await readStore("u");
    const ids = Object.keys(src.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings);
    await copyBindings("u", { fromAddress: "0xa100000000000000000000000000000000000001", toAddress: "0xA200000000000000000000000000000000000002", bindingIds: ids });
    const s = await readStore("u");
    const copied = Object.values(s.wallets.byAddress["0xa200000000000000000000000000000000000002"].bindings)[0];
    expect(copied.params).toEqual({ x: 1 });
    expect(copied.id).not.toBe(ids[0]); // 새 인스턴스
  });

  it("removeBinding deletes just that instance", async () => {
    await putDef("u", def("def::a"));
    await bind("u", { defId: "def::a", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"] });
    const s1 = await readStore("u");
    const id = Object.keys(s1.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)[0];
    await removeBinding("u", { address: "0xa100000000000000000000000000000000000001", bindingId: id });
    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)).toEqual([]);
  });
});

describe("패키지 삭제/지갑 차원 제거의 분리", () => {
  it("deletePackage: def의 라이브러리 폴더 소속도 미분류로 돌린다", async () => {
    await putPackage("u", { id: "pkg::x", displayName: "X", source: "mine", updatedAtMs: 1 });
    await putDef("u", {
      ...def("def::a"),
      defaults: { enabled: true, params: {}, packageId: "pkg::x" },
    });
    await deletePackage("u", "pkg::x");
    const snap = await readStore("u");
    expect(snap.library.defs["def::a"].defaults.packageId).toBeUndefined();
  });

  it("removePackageFromWallet: 이 지갑의 바인딩+게이트만 제거, 계정 패키지/def 불변", async () => {
    await putPackage("u", { id: "pkg::x", displayName: "X", source: "mine", updatedAtMs: 1 });
    await putDef("u", def("def::a"));
    await bind("u", { defId: "def::a", packageId: "pkg::x", addresses: ["0xa100000000000000000000000000000000000001", "0xb200000000000000000000000000000000000002"] });
    await removePackageFromWallet("u", { address: "0xA100000000000000000000000000000000000001", packageId: "pkg::x" });
    const snap = await readStore("u");
    expect(Object.keys(snap.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)).toHaveLength(0);
    expect(snap.wallets.byAddress["0xa100000000000000000000000000000000000001"].packageEnabled["pkg::x"]).toBeUndefined();
    // 다른 지갑과 계정 차원 객체는 그대로
    expect(Object.keys(snap.wallets.byAddress["0xb200000000000000000000000000000000000002"].bindings)).toHaveLength(1);
    expect(snap.library.packages["pkg::x"]).toBeDefined();
    expect(snap.library.defs["def::a"]).toBeDefined();
  });
});

describe("지갑 패키지 분리", () => {
  it("putWalletPackage는 지갑 안에서만 — 라이브러리 packages 불변", async () => {
    await putWalletPackage("u", { address: "0xA100000000000000000000000000000000000001", pkg: { id: "pkg::w1", displayName: "콜드 전용" } });
    const s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].packages["pkg::w1"].displayName).toBe("콜드 전용");
    expect(s.library.packages["pkg::w1"]).toBeUndefined();
  });

  it("bind는 라이브러리 폴더 id를 받으면 같은 이름의 지갑 패키지를 실체화한다", async () => {
    await putDef("u", def("def::a"));
    await putPackage("u", { id: "pkg::x", displayName: "안전팩", source: "mine", updatedAtMs: 1 });
    await bind("u", { defId: "def::a", packageId: "pkg::x", addresses: ["0xa100000000000000000000000000000000000001"] });
    const s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].packages["pkg::x"].displayName).toBe("안전팩");
  });
});

describe("지갑 전용 정책 (hidden def) — 모델 A: 폴더 앵커", () => {
  it("마지막 인스턴스를 지워도 템플릿은 homeWallet 폴더에 남는다", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putDef("u", { ...def("def::w"), hidden: true, homeWallet: "0xa100000000000000000000000000000000000001" });
    await bind("u", { defId: "def::w", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"] });
    const bid = Object.keys((await readStore("u")).wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)[0];

    await removeBinding("u", { address: "0xa100000000000000000000000000000000000001", bindingId: bid });

    const s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings[bid]).toBeUndefined();
    expect(s.library.defs["def::w"].hidden).toBe(true);
    expect(s.library.defs["def::w"].homeWallet).toBe("0xa100000000000000000000000000000000000001");
  });

  it("앵커 지갑이 사라진 hidden def는 라이브러리로 승격된다 (안전망)", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putDef("u", { ...def("def::w"), hidden: true, homeWallet: "0xc300000000000000000000000000000000000003" });
    await bind("u", { defId: "def::w", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"] });
    const bid = Object.keys((await readStore("u")).wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)[0];

    await removeBinding("u", { address: "0xa100000000000000000000000000000000000001", bindingId: bid }); // prune 트리거

    const s = await readStore("u");
    expect(s.library.defs["def::w"].hidden).not.toBe(true);
    expect(s.library.defs["def::w"].homeWallet).toBeUndefined();
  });

  it("normalize: homeWallet 없는 hidden def는 첫 바인딩의 지갑으로 추론된다", async () => {
    await putDef("u", { ...def("def::w"), hidden: true });
    await bind("u", { defId: "def::w", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"] });

    const s = await readStore("u");
    expect(s.library.defs["def::w"].homeWallet).toBe("0xa100000000000000000000000000000000000001");
    expect(s.library.defs["def::w"].hidden).toBe(true);
  });

  it("앵커도 바인딩도 없는 hidden def는 다음 정리 mutation에서 라이브러리로 승격", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putDef("u", { ...def("def::w"), hidden: true });

    // 읽기만으로는 안 건드린다 (방금 만들어 바인딩 전일 수 있음)
    expect((await readStore("u")).library.defs["def::w"].hidden).toBe(true);

    // 정리 경로(prune)가 도는 mutation에서 승격된다
    await removeBinding("u", { address: "0xa100000000000000000000000000000000000001", bindingId: "bind::nope" });
    expect((await readStore("u")).library.defs["def::w"].hidden).not.toBe(true);
  });

  it("provisionWallets는 hidden def를 새 지갑에 자동 적용하지 않는다", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putDef("u", {
      ...def("def::w"),
      hidden: true,
      homeWallet: "0xa100000000000000000000000000000000000001",
      defaults: { enabled: true, params: {} },
    });

    await provisionWallets("u", ["0xb200000000000000000000000000000000000002"]);

    const s = await readStore("u");
    const bound = Object.values(s.wallets.byAddress["0xb200000000000000000000000000000000000002"].bindings).some((b) => b.defId === "def::w");
    expect(bound).toBe(false);
  });
});

describe("지갑 전용 폴더 (wallet folders)", () => {
  it("폴더 생성/이름변경 + def 소속", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putWalletFolder("u", { address: "0xa100000000000000000000000000000000000001", folder: { id: "fold::f1", displayName: "내 폴더" } });
    await putDef("u", { ...def("def::w"), hidden: true, homeWallet: "0xa100000000000000000000000000000000000001", walletFolderId: "fold::f1" });

    let s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].folders?.["fold::f1"]?.displayName).toBe("내 폴더");

    await putWalletFolder("u", { address: "0xa100000000000000000000000000000000000001", folder: { id: "fold::f1", displayName: "새 이름" } });
    s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].folders?.["fold::f1"]?.displayName).toBe("새 이름");
  });

  it("폴더 삭제 시 멤버 def는 미분류(undefined)로", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putWalletFolder("u", { address: "0xa100000000000000000000000000000000000001", folder: { id: "fold::f1", displayName: "F" } });
    await putDef("u", { ...def("def::w"), hidden: true, homeWallet: "0xa100000000000000000000000000000000000001", walletFolderId: "fold::f1" });

    await removeWalletFolder("u", { address: "0xa100000000000000000000000000000000000001", folderId: "fold::f1" });

    const s = await readStore("u");
    expect(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].folders?.["fold::f1"]).toBeUndefined();
    expect(s.library.defs["def::w"].walletFolderId).toBeUndefined();
    expect(s.library.defs["def::w"].hidden).toBe(true);
  });

  it("normalize: 존재하지 않는 폴더를 가리키면 미분류로 정리", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await putDef("u", { ...def("def::w"), hidden: true, homeWallet: "0xa100000000000000000000000000000000000001", walletFolderId: "fold::ghost" });

    const s = await readStore("u");
    expect(s.library.defs["def::w"].walletFolderId).toBeUndefined();
  });
});

describe("required hole guard (마켓 비식별 빈칸)", () => {
  const holed = (id: string): PolicyDef => ({
    ...def(id),
    holes: [
      { name: "v1", type: "address", label: "받는 주소", required: true },
      { name: "v2", type: "long", label: "한도" },
    ],
    defaults: { enabled: true, params: { v2: 150 } }, // v1은 미충전
  });

  it("bind: required hole이 안 채워진 def는 거부한다", async () => {
    await putDef("u", holed("def::m"));
    await expect(
      bind("u", { defId: "def::m", packageId: UNCATEGORIZED_PKG, addresses: ["0xa100000000000000000000000000000000000001"] }),
    ).rejects.toThrow(/받는 주소/);
    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress["0xa100000000000000000000000000000000000001"]?.bindings ?? {})).toHaveLength(0);
  });

  it("bind: 바인딩 params가 required를 덮으면 통과한다", async () => {
    await putDef("u", holed("def::m"));
    await bind("u", {
      defId: "def::m",
      packageId: UNCATEGORIZED_PKG,
      addresses: ["0xa100000000000000000000000000000000000001"],
      params: { v1: "0xabc4000000000000000000000000000000007e29" },
    });
    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)).toHaveLength(1);
  });

  it("bind: required hole 키가 있어도 타입이 틀리면 거부한다", async () => {
    await putDef("u", holed("def::m"));
    await expect(
      bind("u", {
        defId: "def::m",
        packageId: UNCATEGORIZED_PKG,
        addresses: ["0xa100000000000000000000000000000000000001"],
        params: { v1: "not-an-address" },
      }),
    ).rejects.toThrow(/받는 주소/);
    const s = await readStore("u");
    expect(Object.keys(s.wallets.byAddress["0xa100000000000000000000000000000000000001"]?.bindings ?? {})).toHaveLength(0);
  });

  it("installMarket: 바인딩이 생기는 scope에서 미충전이면 전체 거부(원자적)", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await expect(
      installMarket("u", { defs: [holed("def::m")], scope: { kind: "all" } }),
    ).rejects.toThrow(/빈칸/);
    // mutate가 draft에서 실패 → 라이브러리 등록까지 함께 롤백된다.
    const s = await readStore("u");
    expect(s.library.defs["def::m"]).toBeUndefined();
  });

  it("installMarket: library-only는 미충전이어도 들어간다 (바인딩이 없으니 안전)", async () => {
    await installMarket("u", { defs: [holed("def::m")], scope: { kind: "library-only" } });
    const s = await readStore("u");
    expect(s.library.defs["def::m"]).toBeDefined();
  });

  it("installMarket: invalid required params are rejected atomically", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await expect(
      installMarket("u", {
        defs: [holed("def::m")],
        scope: { kind: "all" },
        params: { "def::m": { v1: "0xabc" } },
      }),
    ).rejects.toThrow(/받는 주소/);
    const s = await readStore("u");
    expect(s.library.defs["def::m"]).toBeUndefined();
  });

  it("installMarket: opts.params 또는 defaults.params가 덮으면 통과한다", async () => {
    await provisionWallets("u", ["0xa100000000000000000000000000000000000001"]);
    await installMarket("u", {
      defs: [holed("def::m")],
      scope: { kind: "all" },
      params: { "def::m": { v1: "0xabc4000000000000000000000000000000007e29" } },
    });
    const s = await readStore("u");
    const b = Object.values(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)[0];
    expect(b.params).toEqual({ v1: "0xabc4000000000000000000000000000000007e29" });
  });

  it("installMarket: reinstall updates the def without duplicating existing wallet bindings", async () => {
    const address = "0xa100000000000000000000000000000000000001";
    await provisionWallets("u", [address]);
    await installMarket("u", {
      defs: [holed("def::m")],
      scope: { kind: "all" },
      params: { "def::m": { v1: "0xabc4000000000000000000000000000000007e29" } },
    });
    await installMarket("u", {
      defs: [{ ...holed("def::m"), displayName: "updated market policy" }],
      scope: { kind: "all" },
      params: { "def::m": { v1: "0xabc4000000000000000000000000000000007e30" } },
    });

    const s = await readStore("u");
    const bindings = Object.values(s.wallets.byAddress[address].bindings);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].params).toEqual({ v1: "0xabc4000000000000000000000000000000007e29" });
    expect(s.library.defs["def::m"].displayName).toBe("updated market policy");
  });

  it("installMarket: reinstall backfills newly required holes without overwriting existing binding params", async () => {
    const address = "0xa100000000000000000000000000000000000001";
    const oldRecipient = "0xabc4000000000000000000000000000000007e29";
    const newRecipient = "0xabc4000000000000000000000000000000007e30";
    const newApprover = "0xabc4000000000000000000000000000000007e31";
    await provisionWallets("u", [address]);
    await installMarket("u", {
      defs: [holed("def::m")],
      scope: { kind: "all" },
      params: { "def::m": { v1: oldRecipient } },
    });

    const updated = {
      ...holed("def::m"),
      displayName: "updated market policy",
      holes: [
        ...holed("def::m").holes,
        { name: "v3", type: "address" as const, label: "승인자", required: true },
      ],
    };
    await installMarket("u", {
      defs: [updated],
      scope: { kind: "all" },
      params: { "def::m": { v1: newRecipient, v3: newApprover } },
    });

    const s = await readStore("u");
    const bindings = Object.values(s.wallets.byAddress[address].bindings);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].params).toEqual({ v1: oldRecipient, v3: newApprover });
    expect(s.library.defs["def::m"].displayName).toBe("updated market policy");
  });

  it("installMarket: library-only update rejects when existing bindings would miss a new required hole", async () => {
    const address = "0xa100000000000000000000000000000000000001";
    await provisionWallets("u", [address]);
    await installMarket("u", {
      defs: [holed("def::m")],
      scope: { kind: "all" },
      params: { "def::m": { v1: "0xabc4000000000000000000000000000000007e29" } },
    });

    const updated = {
      ...holed("def::m"),
      displayName: "should not land",
      holes: [
        ...holed("def::m").holes,
        { name: "v3", type: "address" as const, label: "승인자", required: true },
      ],
    };
    await expect(
      installMarket("u", { defs: [updated], scope: { kind: "library-only" } }),
    ).rejects.toThrow(/승인자/);

    const s = await readStore("u");
    expect(s.library.defs["def::m"].displayName).not.toBe("should not land");
    const bindings = Object.values(s.wallets.byAddress[address].bindings);
    expect(bindings[0].params).toEqual({ v1: "0xabc4000000000000000000000000000000007e29" });
  });

  it("installMarket: duplicate def ids in one payload are rejected atomically", async () => {
    await expect(
      installMarket("u", {
        defs: [def("def::m"), { ...def("def::m"), displayName: "duplicate" }],
        scope: { kind: "library-only" },
      }),
    ).rejects.toThrow(/duplicate def id/);

    const s = await readStore("u");
    expect(s.library.defs["def::m"]).toBeUndefined();
  });

  it("provisionWallets: 미충전 def는 새 지갑에 적용하지 않고 건너뛴다", async () => {
    await putDef("u", def("def::ok"));
    await putDef("u", holed("def::m"));
    await provisionWallets("u", ["0x1000000000000000000000000000000000000000"]);
    const s = await readStore("u");
    const bound = Object.values(s.wallets.byAddress["0x1000000000000000000000000000000000000000"].bindings).map((b) => b.defId);
    expect(bound).toEqual(["def::ok"]);
  });

  it("updateBinding: params 패치로 required를 다시 비우는 것을 거부한다", async () => {
    await putDef("u", holed("def::m"));
    await bind("u", {
      defId: "def::m",
      packageId: UNCATEGORIZED_PKG,
      addresses: ["0xa100000000000000000000000000000000000001"],
      params: { v1: "0xabc4000000000000000000000000000000007e29" },
    });
    const s = await readStore("u");
    const b = Object.values(s.wallets.byAddress["0xa100000000000000000000000000000000000001"].bindings)[0];
    await expect(
      updateBinding("u", { address: "0xa100000000000000000000000000000000000001", bindingId: b.id, patch: { params: {} } }),
    ).rejects.toThrow(/받는 주소/);
  });
});
