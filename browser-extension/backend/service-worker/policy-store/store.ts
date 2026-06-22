/**
 * policy-store — 정책 스토리지 v2의 유일한 읽기/쓰기 게이트.
 * 모든 변경은 mutate()의 직렬 큐를 지나 불변식 검증 후 멀티키 atomic set으로
 * 커밋된다. 대시보드/popup은 SW 메시지로만 접근하므로 멀티탭 race가 없다.
 */
import Browser from "webextension-polyfill";

import {
  UNCATEGORIZED_PKG,
  type Binding,
  type HoleValue,
  type LibraryDoc,
  type PolicyDef,
  type StoreSnapshot,
  type WalletPolicyState,
  type WalletsDoc,
} from "./types";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const libKey = (uid: string) => `ps2:${uid}:library`;
const walKey = (uid: string) => `ps2:${uid}:wallets`;
const revKey = (uid: string) => `ps2:${uid}:rev`;

export function normalizeWalletAddress(value: unknown, label = "wallet address"): string {
  if (typeof value !== "string" || !EVM_ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be an EVM address`);
  }
  return value.toLowerCase();
}

export function assertSafeRecordKey(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    FORBIDDEN_RECORD_KEYS.has(value)
  ) {
    throw new Error(`${label} is not a safe storage key`);
  }
}

function validateParamKeys(
  params: Record<string, HoleValue> | undefined,
  label: string,
): void {
  for (const key of Object.keys(params ?? {})) {
    assertSafeRecordKey(key, label);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
}

function assertOptionalSeverity(
  value: unknown,
  label: string,
): asserts value is "deny" | "warn" | undefined {
  if (value !== undefined && value !== "deny" && value !== "warn") {
    throw new Error(`${label} must be deny or warn`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePolicyDef(def: PolicyDef): void {
  assertBoolean(def.defaults.enabled, "default enabled");
  if (def.defaults.packageId !== undefined) {
    assertSafeRecordKey(def.defaults.packageId, "default package id");
  }
  if (def.walletFolderId !== undefined) {
    assertSafeRecordKey(def.walletFolderId, "wallet folder id");
  }
  validateParamKeys(def.defaults.params, "default param key");

  const holeNames = new Set<string>();
  for (const hole of def.holes) {
    assertSafeRecordKey(hole.name, "hole name");
    if (holeNames.has(hole.name)) {
      throw new Error(`duplicate hole name: ${hole.name}`);
    }
    holeNames.add(hole.name);
  }
}

function emptyLibrary(): LibraryDoc {
  return {
    schemaVersion: 1,
    defs: {},
    packages: {
      [UNCATEGORIZED_PKG]: {
        id: UNCATEGORIZED_PKG,
        displayName: "미분류",
        source: "builtin",
        updatedAtMs: 0,
      },
    },
  };
}
const emptyWallets = (): WalletsDoc => ({ schemaVersion: 1, byAddress: {} });

export async function readStore(uid: string): Promise<StoreSnapshot> {
  const got = (await Browser.storage.local.get([libKey(uid), walKey(uid), revKey(uid)])) as Record<string, unknown>;
  const snap: StoreSnapshot = {
    library: (got[libKey(uid)] as LibraryDoc | undefined) ?? emptyLibrary(),
    wallets: (got[walKey(uid)] as WalletsDoc | undefined) ?? emptyWallets(),
    rev: (got[revKey(uid)] as number | undefined) ?? 0,
  };
  normalizeRuntimeShape(snap);
  normalizeWallets(snap);
  normalizeHiddenDefs(snap);
  return snap;
}

/** 읽기 시점 방어: 과거 런타임 메시지/스토리지 오염으로 boolean/enum 필드가
 *  문자열 같은 truthy 값으로 남아 있어도 정책이 켜지지 않게 inert 값으로
 *  정규화한다. 다음 mutate 때 정규화된 값이 자연히 영속화된다. */
function normalizeRuntimeShape(s: StoreSnapshot): void {
  if (!isRecord(s.library)) s.library = emptyLibrary();
  if (!isRecord(s.library.defs)) s.library.defs = {};
  if (!isRecord(s.library.packages)) s.library.packages = emptyLibrary().packages;
  if (!isRecord(s.wallets)) s.wallets = emptyWallets();
  if (!isRecord(s.wallets.byAddress)) s.wallets.byAddress = {};

  type RuntimePolicyDef = Omit<PolicyDef, "defaults" | "holes"> & {
    defaults?: Partial<PolicyDef["defaults"]> | null;
    holes?: unknown;
  };
  for (const raw of Object.values(s.library.defs)) {
    const def = raw as RuntimePolicyDef;
    if (!isRecord(def.defaults)) {
      def.defaults = { enabled: false, params: {} };
    }
    if (typeof def.defaults.enabled !== "boolean") {
      def.defaults.enabled = false;
    }
    if (!isRecord(def.defaults.params)) {
      def.defaults.params = {};
    }
    if (!Array.isArray(def.holes)) {
      def.holes = [];
    }
  }
  type RuntimeWallet = Omit<WalletPolicyState, "bindings" | "packages" | "packageEnabled"> & {
    bindings?: unknown;
    packages?: unknown;
    packageEnabled?: unknown;
  };
  type RuntimeBinding = Binding & { enabled?: unknown; severity?: unknown };
  for (const raw of Object.values(s.wallets.byAddress)) {
    const w = raw as RuntimeWallet;
    if (!isRecord(w.bindings)) w.bindings = {};
    if (!isRecord(w.packages)) w.packages = {};
    if (!isRecord(w.packageEnabled)) w.packageEnabled = {};
    const bindings = w.bindings as Record<string, unknown>;
    const packageEnabled = w.packageEnabled as Record<string, unknown>;
    for (const b of Object.values(bindings)) {
      const binding = b as RuntimeBinding;
      if (typeof binding.enabled !== "boolean") {
        binding.enabled = false;
      }
      if (binding.severity !== undefined && binding.severity !== "deny" && binding.severity !== "warn") {
        binding.severity = undefined;
      }
    }
    for (const [pkgId, enabled] of Object.entries(packageEnabled)) {
      if (typeof enabled !== "boolean") {
        packageEnabled[pkgId] = false;
      }
    }
  }
}

/** 불변식: 바인딩의 defId 실재 + packageId는 그 지갑의 패키지(또는 미분류),
 *  미분류 라이브러리 폴더 존재, 소문자 주소 키. */
function validate(s: StoreSnapshot): void {
  if (!s.library.packages[UNCATEGORIZED_PKG]) {
    throw new Error("미분류 패키지(pkg::uncategorized)는 삭제할 수 없습니다");
  }
  for (const [defId, def] of Object.entries(s.library.defs)) {
    assertSafeRecordKey(defId, "def id");
    if (def.id !== defId) throw new Error(`정의 키와 id가 다릅니다: ${defId}`);
    validatePolicyDef(def);
    if (def.homeWallet) {
      const home = normalizeWalletAddress(def.homeWallet, "home wallet");
      if (def.homeWallet !== home) throw new Error(`homeWallet은 소문자여야 합니다: ${def.homeWallet}`);
    }
  }
  for (const [pkgId, pkg] of Object.entries(s.library.packages)) {
    assertSafeRecordKey(pkgId, "package id");
    if (pkg.id !== pkgId) throw new Error(`패키지 키와 id가 다릅니다: ${pkgId}`);
  }
  for (const [addr, w] of Object.entries(s.wallets.byAddress)) {
    const normalized = normalizeWalletAddress(addr);
    if (addr !== normalized) throw new Error(`지갑 주소는 소문자여야 합니다: ${addr}`);
    for (const [folderId, folder] of Object.entries(w.folders ?? {})) {
      assertSafeRecordKey(folderId, "wallet folder id");
      if (folder.id !== folderId) throw new Error(`지갑 폴더 키와 id가 다릅니다: ${folderId}`);
    }
    for (const [pkgId, pkg] of Object.entries(w.packages)) {
      assertSafeRecordKey(pkgId, "wallet package id");
      if (pkg.id !== pkgId) throw new Error(`지갑 패키지 키와 id가 다릅니다: ${pkgId}`);
    }
    for (const [bindingId, b] of Object.entries(w.bindings)) {
      assertSafeRecordKey(bindingId, "binding id");
      if (b.id !== bindingId) throw new Error(`바인딩 키와 id가 다릅니다: ${bindingId}`);
      assertSafeRecordKey(b.defId, "binding def id");
      assertSafeRecordKey(b.packageId, "binding package id");
      assertBoolean(b.enabled, "binding enabled");
      assertOptionalSeverity(b.severity, "binding severity");
      validateParamKeys(b.params, "binding param key");
      if (!s.library.defs[b.defId]) throw new Error(`바인딩 ${b.id}의 defId가 라이브러리에 없습니다: ${b.defId}`);
      if (b.packageId !== UNCATEGORIZED_PKG && !w.packages[b.packageId]) {
        throw new Error(`바인딩 ${b.id}의 packageId가 지갑에 없습니다: ${b.packageId}`);
      }
    }
    for (const [pkgId, enabled] of Object.entries(w.packageEnabled)) {
      assertSafeRecordKey(pkgId, "wallet package gate id");
      assertBoolean(enabled, "wallet package gate");
    }
  }
}

/** 구 스토어 마이그레이션(읽기 시 정규화): 지갑 패키지 분리 이전에는 바인딩이
 *  계정(라이브러리) 패키지를 가리켰다 — 같은 id의 지갑 패키지를 이름을 복사해
 *  실체화한다. 다음 mutate 때 자연히 영속화된다. */
function normalizeWallets(s: StoreSnapshot): void {
  for (const w of Object.values(s.wallets.byAddress)) {
    w.packages ??= {};
    for (const b of Object.values(w.bindings)) {
      if (b.packageId === UNCATEGORIZED_PKG || w.packages[b.packageId]) continue;
      w.packages[b.packageId] = {
        id: b.packageId,
        displayName: s.library.packages[b.packageId]?.displayName ?? b.packageId,
        updatedAtMs: 0,
      };
    }
  }
}

/** 모델 A 마이그레이션(읽기 시 정규화, 멱등·추론 전용): 지갑 전용(hidden)
 *  def의 homeWallet이 없으면 첫 바인딩의 지갑으로 추론하고, walletFolderId가
 *  존재하지 않는 폴더를 가리키면 미분류(undefined)로 돌린다. hidden 해제
 *  (라이브러리 승격)는 여기서 하지 않는다 — "방금 만들었고 아직 바인딩 전"인
 *  def를 다음 읽기가 승격해버리는 레이스가 생긴다. 앵커를 잃은 def의 승격은
 *  mutation 시점의 pruneHiddenDefs(ops)가 맡는다. */
function normalizeHiddenDefs(s: StoreSnapshot): void {
  for (const def of Object.values(s.library.defs)) {
    if (def.hidden !== true) continue;
    if (!def.homeWallet) {
      outer: for (const [addr, w] of Object.entries(s.wallets.byAddress)) {
        for (const b of Object.values(w.bindings)) {
          if (b.defId === def.id) {
            def.homeWallet = addr;
            break outer;
          }
        }
      }
    }
    if (def.homeWallet && def.walletFolderId) {
      const w = s.wallets.byAddress[def.homeWallet];
      if (!w?.folders?.[def.walletFolderId]) def.walletFolderId = undefined;
    }
  }
}

// 단일 직렬 큐 — 모든 계정의 쓰기가 순서대로 커밋된다.
let chain: Promise<unknown> = Promise.resolve();

export function mutate<T>(uid: string, fn: (draft: StoreSnapshot) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const current = await readStore(uid);
    const draft = structuredClone(current);
    const out = await fn(draft);
    validate(draft);
    // 정책(def) 추가/삭제를 콘솔에 로그 — 마켓 설치 / 에디터 저장 / 삭제 등
    // 모든 라이브러리 변경이 이 mutate 게이트를 지난다.
    const beforeIds = Object.keys(current.library.defs);
    const afterIds = Object.keys(draft.library.defs);
    const added = afterIds.filter((id) => !beforeIds.includes(id));
    const removed = beforeIds.filter((id) => !afterIds.includes(id));
    if (added.length > 0 || removed.length > 0) {
      console.info("[Dambi] policy-store defs changed", { uid, added, removed });
    }
    // 정책 토글(켜기/끄기)을 콘솔에 로그 — 대시보드의 per-policy 초록 스위치
    // (binding.enabled)와 패키지 마스터 토글(packageEnabled)이 모두 이 게이트를
    // 지난다. before·after를 합집합으로 비교해 enable flip 뿐 아니라 제거(=off)와
    // 추가(=on)까지 잡는다. 지갑 통째 추가/삭제(프로비저닝)는 토글이 아니므로
    // 양쪽 지갑이 모두 있을 때만 본다. packageEnabled는 키 부재 = 켜짐.
    const toggles: { address: string; defId: string; enabled: boolean }[] = [];
    const pkgToggles: { address: string; packageId: string; enabled: boolean }[] = [];
    const addrs = new Set([
      ...Object.keys(current.wallets.byAddress),
      ...Object.keys(draft.wallets.byAddress),
    ]);
    for (const addr of addrs) {
      const w0 = current.wallets.byAddress[addr];
      const w1 = draft.wallets.byAddress[addr];
      if (!w0 || !w1) continue; // 지갑 단위 추가/삭제는 토글이 아님
      const bids = new Set([...Object.keys(w0.bindings), ...Object.keys(w1.bindings)]);
      for (const bid of bids) {
        const b0 = w0.bindings[bid];
        const b1 = w1.bindings[bid];
        const e0 = b0?.enabled; // undefined = 추가 전
        const e1 = b1?.enabled; // undefined = 제거됨(=off)
        if (e0 !== e1) {
          toggles.push({ address: addr, defId: (b1 ?? b0)!.defId, enabled: e1 ?? false });
        }
      }
      const pids = new Set([...Object.keys(w0.packageEnabled), ...Object.keys(w1.packageEnabled)]);
      for (const pid of pids) {
        const en0 = w0.packageEnabled[pid] ?? true; // 부재 = 켜짐
        const en1 = w1.packageEnabled[pid] ?? true;
        if (en0 !== en1) {
          pkgToggles.push({ address: addr, packageId: pid, enabled: en1 });
        }
      }
    }
    if (toggles.length > 0) console.info("[Dambi] policy-store bindings toggled", { uid, toggles });
    if (pkgToggles.length > 0) console.info("[Dambi] policy-store package toggled", { uid, pkgToggles });
    draft.rev = current.rev + 1;
    await Browser.storage.local.set({
      [libKey(uid)]: draft.library,
      [walKey(uid)]: draft.wallets,
      [revKey(uid)]: draft.rev,
    });
    return out;
  });
  chain = run.catch(() => undefined); // 실패해도 큐는 계속
  return run;
}
