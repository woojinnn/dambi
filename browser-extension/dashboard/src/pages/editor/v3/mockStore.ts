/**
 * v3 에디터 — mock policy store (ps2).
 *
 * editor/js/store.js(프로토타입)를 TS로 옮긴 것. 확장의 `ps2:*` 메시지 API와 동일한
 * shape(sdk/policy-store-types.ts)을 localStorage에 두고, 변경 시 구독자에게 알린다.
 *
 * Phase 1: 이 mock으로 프론트를 띄운다. Phase 2에서 이 모듈을 실제
 * server-api/policy-store 로 갈아끼우면 백엔드와 연동된다(인터페이스 동일).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const LS_KEY = "ps2-mock-store-v3";
export const UNCATEGORIZED_PKG = "pkg::uncategorized";
const BUILTIN_PKG = "pkg::builtin.day1-safety";

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const now = () => Date.now();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function isEffectiveOn(w: any, b: any): boolean {
  return (w.packageEnabled[b.packageId] ?? true) && b.enabled;
}

// ── seed (간단·확장 가능) — 기본 안전팩 builtin + 사용자 정책 + 한 지갑 ──
function defOf(opts: any) {
  return {
    id: opts.id,
    displayName: opts.displayName,
    cat: opts.cat,
    method: opts.method || "form",
    skeleton: { model: opts.model ?? null, manifest: opts.manifest ?? null, rawCedar: opts.rawCedar },
    holes: opts.holes || [],
    defaults: { enabled: opts.enabled ?? true, params: opts.params || {}, packageId: opts.packageId },
    source: opts.source || "builtin",
    updatedAtMs: now(),
  };
}

export const WALLET_A = "0xa3731f5e0a4c2b9d8e6f1a0b3c5d7e9f2a4bebec";
export const WALLET_B = "0x3d7e1f0a2b4c6d8e9f0a1b2c3d4e5f6a7b8c9d0e";

function freshSeed(): any {
  const builtin = [
    ["unlimited-approval-deny", "무제한 토큰 승인 차단", "approve"],
    ["send-first-time-or-burn-recipient-warn", "소각·제로 주소 전송 차단", "transfer"],
    ["swap-recipient-not-self-deny", "스왑 수령처 본인 외 차단", "swap"],
    ["unknown-blind-sign-warning", "정체불명 블라인드 서명 경고", "sign"],
    ["permit2-sign-allowance-confirm", "Permit2 허용량 서명 확인", "approve"],
  ].map(([id, name, cat]) =>
    defOf({ id: `def::builtin.${id}`, displayName: name, cat, source: "builtin", packageId: BUILTIN_PKG }),
  );
  const mine = [
    defOf({ id: "def::mine.bridge-cap", displayName: "브릿지 한도 경고", cat: "bridge", source: "mine", packageId: "pkg::mine.guards" }),
    defOf({ id: "def::mine.swap-slippage", displayName: "스왑 슬리피지 경고", cat: "swap", source: "mine" }),
  ];
  const defs: any = {};
  for (const d of [...builtin, ...mine]) defs[d.id] = d;

  const packages: any = {
    [BUILTIN_PKG]: { id: BUILTIN_PKG, displayName: "기본 안전팩", source: "builtin", updatedAtMs: now() },
    "pkg::mine.guards": { id: "pkg::mine.guards", displayName: "내 가드", source: "mine", desc: "자주 쓰는 보호 정책", updatedAtMs: now() },
  };

  // 지갑 A: 기본 안전팩 + 가드 적용
  const bindingsA: any = {};
  const mk = (defId: string, packageId?: string) => {
    const id = "bind::" + uuid();
    bindingsA[id] = { id, defId, packageId, enabled: true, updatedAtMs: now() };
  };
  for (const d of builtin) mk(d.id, BUILTIN_PKG);
  mk("def::mine.bridge-cap", "pkg::mine.guards");

  return {
    rev: 1,
    library: { defs, packages },
    wallets: {
      byAddress: {
        [WALLET_A]: {
          bindings: bindingsA,
          packages: {
            [BUILTIN_PKG]: { id: BUILTIN_PKG, displayName: "기본 안전팩" },
            "pkg::mine.guards": { id: "pkg::mine.guards", displayName: "내 가드" },
          },
          packageEnabled: {},
          folders: {},
        },
        [WALLET_B]: { bindings: {}, packages: {}, packageEnabled: {}, folders: {} },
      },
    },
  };
}

// ── store ──
type Sub = (s: any) => void;
const subs = new Set<Sub>();
let snapshot: any = load();

function load(): any {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const seed = freshSeed();
  persist(seed);
  return seed;
}
function persist(s: any): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}
function commit(): void {
  snapshot = { ...snapshot, rev: snapshot.rev + 1 };
  persist(snapshot);
  subs.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (e) {
      console.error(e);
    }
  });
}

export function subscribe(cb: Sub): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function getOverview(): any {
  return clone(snapshot);
}
export function resetSeed(): void {
  snapshot = freshSeed();
  commit();
}

// 변경 op들 — 실제 policy-store.ts 와 같은 시그니처(async).
const A = <F extends (...a: any[]) => any>(fn: F) => (...args: Parameters<F>): Promise<ReturnType<F>> =>
  Promise.resolve().then(() => fn(...args));

function _putDef(d: any) { snapshot.library.defs[d.id] = clone(d); commit(); }
function _deleteDef(defId: string) {
  delete snapshot.library.defs[defId];
  for (const w of Object.values<any>(snapshot.wallets.byAddress))
    for (const [bid, b] of Object.entries<any>(w.bindings)) if (b.defId === defId) delete w.bindings[bid];
  commit();
}
function _duplicateDef(defId: string, packageId?: string): string {
  const src = snapshot.library.defs[defId];
  if (!src) throw new Error("not found");
  const id = "def::" + defId.replace(/^def::/, "") + "-copy-" + Math.random().toString(36).slice(2, 6);
  const copy = clone(src);
  copy.id = id;
  copy.displayName = src.displayName + " (복사)";
  copy.source = "mine";
  if (packageId !== undefined) copy.defaults.packageId = packageId === UNCATEGORIZED_PKG ? undefined : packageId;
  copy.updatedAtMs = now();
  snapshot.library.defs[id] = copy;
  commit();
  return id;
}
function _putPackage(pkg: any) { snapshot.library.packages[pkg.id] = clone(pkg); commit(); }
function _deletePackage(packageId: string) {
  delete snapshot.library.packages[packageId];
  for (const d of Object.values<any>(snapshot.library.defs)) if (d.defaults.packageId === packageId) d.defaults.packageId = undefined;
  commit();
}
function ensureWallet(address: string) {
  const a = address.toLowerCase();
  if (!snapshot.wallets.byAddress[a]) snapshot.wallets.byAddress[a] = { bindings: {}, packages: {}, packageEnabled: {}, folders: {} };
  return snapshot.wallets.byAddress[a];
}
function _bindDef(opts: any) {
  for (const address of opts.addresses) {
    const w = ensureWallet(address);
    const id = "bind::" + uuid();
    w.bindings[id] = { id, defId: opts.defId, packageId: opts.packageId, enabled: opts.enabled ?? true, alias: opts.alias, params: opts.params, updatedAtMs: now() };
  }
  commit();
}
function _updateBinding(opts: any) {
  const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
  const b = w && w.bindings[opts.bindingId];
  if (!b) throw new Error("binding not found");
  Object.assign(b, opts.patch);
  b.updatedAtMs = now();
  commit();
}
function _removeBinding(opts: any) {
  const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
  if (w) delete w.bindings[opts.bindingId];
  commit();
}
function _removeWalletPackage(opts: any) {
  const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
  if (!w) return commit();
  delete w.packages[opts.packageId];
  delete w.packageEnabled[opts.packageId];
  for (const [bid, b] of Object.entries<any>(w.bindings)) if (b.packageId === opts.packageId) delete w.bindings[bid];
  commit();
}
function _putWalletPackage(opts: any) { const w = ensureWallet(opts.address); w.packages[opts.pkg.id] = { ...opts.pkg, updatedAtMs: now() }; commit(); }
function _setPackageEnabled(opts: any) { const w = ensureWallet(opts.address); w.packageEnabled[opts.packageId] = opts.enabled; commit(); }
function _putWalletFolder(opts: any) { const w = ensureWallet(opts.address); if (!w.folders) w.folders = {}; w.folders[opts.folder.id] = { ...opts.folder, updatedAtMs: now() }; commit(); }
function _removeWalletFolder(opts: any) {
  const w = snapshot.wallets.byAddress[opts.address.toLowerCase()];
  if (!w || !w.folders) return commit();
  delete w.folders[opts.folderId];
  commit();
}

export const putDef = A(_putDef);
export const deleteDef = A(_deleteDef);
export const duplicateDef = A(_duplicateDef);
export const putPackage = A(_putPackage);
export const deletePackage = A(_deletePackage);
export const bindDef = A(_bindDef);
export const updateBinding = A(_updateBinding);
export const removeBinding = A(_removeBinding);
export const removeWalletPackage = A(_removeWalletPackage);
export const putWalletPackage = A(_putWalletPackage);
export const setPackageEnabled = A(_setPackageEnabled);
export const putWalletFolder = A(_putWalletFolder);
export const removeWalletFolder = A(_removeWalletFolder);
