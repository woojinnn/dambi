/** 에디터 저장 → ps2 페이로드 변환(순수). 신규 def는 범위 모달 입력을 defaults에 기록. */
import { attrExprToPath, extractParams } from "../../../cedar/blocks";
import type { PolicyIR } from "../../../cedar/blocks";
import {
  missingRequiredHoles,
  type HoleSpec,
  type HoleValue,
  type PolicyDef,
  type PolicyDoc,
  type StoreSnapshot,
} from "../../../server-api/policy-store";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FORBIDDEN_STORAGE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function normalizeWalletAddress(value: string, label = "wallet address"): string {
  if (!EVM_ADDRESS_RE.test(value)) throw new Error(`${label} must be an EVM address`);
  return value.toLowerCase();
}

function assertSafeStorageKey(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    FORBIDDEN_STORAGE_KEYS.has(value)
  ) {
    throw new Error(`${label} is not a safe storage key`);
  }
}

/** holed IR에서 def.holes + 기본 파라미터 값을 파생한다. expected → HoleSpec.type
 *  매핑은 입력 위젯 선택용(평가에는 영향 없음). */
export function holesFromIr(ir: PolicyIR): {
  holes: HoleSpec[];
  paramDefaults: Record<string, HoleValue>;
} {
  const holes: HoleSpec[] = [];
  const paramDefaults: Record<string, HoleValue> = {};
  let specs: ReturnType<typeof extractParams>;
  try {
    specs = extractParams(ir);
  } catch {
    return { holes, paramDefaults }; // 비정형/홀 없는 IR — 파라미터 없음으로 처리
  }
  for (const spec of specs) {
    const d = spec.default;
    let type: HoleSpec["type"] = "string";
    let value: HoleValue = "";
    if (d.kind === "lit" && d.litType === "long") {
      type = "long";
      value = Number(d.value);
    } else if (d.kind === "lit" && d.litType === "bool") {
      type = "bool";
      value = Boolean(d.value);
    } else if (d.kind === "lit" && d.litType === "string") {
      // decimal 홀은 ext("decimal", [lit string]) 안의 lit — 표기상 string과 같다.
      type = String(d.value).startsWith("0x") ? "address" : "string";
      value = String(d.value);
    } else if (d.kind === "set") {
      type = "addressSet";
      value = d.elements.flatMap((e) => (e.kind === "lit" ? [String(e.value)] : []));
    } else if (d.kind === "attr" || d.kind === "var") {
      type = "field";
      value = { field: attrExprToPath(d) ?? "" };
    }
    holes.push({ name: spec.name, type, label: spec.label ?? spec.name });
    paramDefaults[spec.name] = value;
  }
  return { holes, paramDefaults };
}

export type SaveScope =
  | { kind: "wallets"; addresses: string[] }
  /** "모든 지갑" — 호출 시점에 알려진 전체 주소를 명시 전달(이후 새 지갑은 defaults가 처리). */
  | { kind: "all-wallets"; addresses: string[] }
  | { kind: "library-only" };

export interface BindPlan {
  defId: string;
  packageId: string;
  addresses: string[];
}

export interface WalletScopeApplyInput {
  addresses: string[];
  walletPackages: Record<string, string[]>;
  walletNewName: Record<string, string>;
  paramsByCombo: Record<string, Record<string, Record<string, HoleValue>>>;
  severityByCombo: Record<string, Record<string, "deny" | "warn">>;
}

export interface WalletScopePlan {
  packages: { address: string; pkg: { id: string; displayName: string } }[];
  bindings: {
    defId: string;
    packageId: string;
    addresses: string[];
    params?: Record<string, HoleValue>;
    severity?: "deny" | "warn";
  }[];
}

export function buildDefPayload(opts: {
  existing: PolicyDef | null;
  displayName: string;
  cat: string | undefined;
  ir: unknown;
  manifest: unknown;
  scope: SaveScope | null; // 기존 def 저장이면 null
  packageId: string | null; // 〃
  applyToNewWallets: boolean | null; // 〃
  /** 작성자 문서(정의/범위/대상/데이터) — 비면 undefined. */
  doc?: PolicyDoc | undefined;
  /** 지갑 전용 정책(라이브러리 비노출) — homeWallet 지갑의 전용 폴더에 앵커. */
  walletOnly?: { homeWallet: string; walletFolderId?: string };
}): { def: PolicyDef; bindPlan: BindPlan | null } {
  const skeleton = { ir: opts.ir, manifest: opts.manifest };
  const { holes, paramDefaults } = holesFromIr(opts.ir as PolicyIR);
  if (opts.existing) {
    return {
      def: {
        ...opts.existing,
        displayName: opts.displayName,
        cat: opts.cat,
        doc: opts.doc,
        skeleton,
        holes,
        defaults: { ...opts.existing.defaults, params: paramDefaults },
        updatedAtMs: Date.now(),
      },
      bindPlan: null,
    };
  }
  const def: PolicyDef = {
    id: `def::${crypto.randomUUID()}`,
    ...(opts.walletOnly
      ? {
          hidden: true,
          homeWallet: opts.walletOnly.homeWallet.toLowerCase(),
          walletFolderId: opts.walletOnly.walletFolderId,
        }
      : {}),
    displayName: opts.displayName,
    cat: opts.cat,
    doc: opts.doc,
    skeleton,
    holes,
    defaults: {
      // 지갑 전용 정책은 신규 지갑 자동 적용/라이브러리 폴더와 무관하다.
      enabled: opts.walletOnly ? false : (opts.applyToNewWallets ?? false),
      params: paramDefaults,
      packageId: opts.walletOnly ? undefined : (opts.packageId ?? undefined),
    },
    source: "mine",
    updatedAtMs: Date.now(),
  };
  const bindPlan =
    opts.scope && opts.scope.kind !== "library-only" && opts.packageId
      ? { defId: def.id, packageId: opts.packageId, addresses: opts.scope.addresses }
      : null;
  return { def, bindPlan };
}

export function buildWalletScopePlan(
  def: PolicyDef,
  apply: WalletScopeApplyInput,
  snap: StoreSnapshot | null,
  defParamKey: string,
): WalletScopePlan {
  assertSafeStorageKey(def.id, "def id");
  const plan: WalletScopePlan = { packages: [], bindings: [] };
  const seenAddresses = new Set<string>();
  const plannedPackageByWalletName = new Map<string, string>();

  for (const rawAddress of apply.addresses) {
    const address = normalizeWalletAddress(rawAddress);
    if (seenAddresses.has(address)) continue;
    seenAddresses.add(address);

    const w = snap?.wallets.byAddress[address];
    const seenBindings = new Set(
      Object.values(w?.bindings ?? {}).map((b) => `${b.defId}\u0000${b.packageId}`),
    );
    const packageKeys = apply.walletPackages[rawAddress] ?? apply.walletPackages[address] ?? [];
    for (const key of packageKeys) {
      assertSafeStorageKey(key, "wallet package key");
      let pkgId: string;
      if (key === "__new__") {
        const newName = (apply.walletNewName[rawAddress] ?? apply.walletNewName[address] ?? "").trim();
        if (!newName) throw new Error("New package name is required");
        const existing = Object.values(w?.packages ?? {}).find((pkg) => pkg.displayName === newName);
        if (existing) {
          assertSafeStorageKey(existing.id, "existing wallet package id");
          pkgId = existing.id;
        } else {
          const plannedKey = `${address}\u0000${newName}`;
          const planned = plannedPackageByWalletName.get(plannedKey);
          if (planned) {
            pkgId = planned;
          } else {
            pkgId = `pkg::${crypto.randomUUID()}`;
            plannedPackageByWalletName.set(plannedKey, pkgId);
            plan.packages.push({ address, pkg: { id: pkgId, displayName: newName } });
          }
        }
      } else {
        pkgId = key;
      }
      assertSafeStorageKey(pkgId, "wallet package id");

      const bindingKey = `${def.id}\u0000${pkgId}`;
      if (seenBindings.has(bindingKey)) continue;
      const comboKey = `${rawAddress}|${key}`;
      const normalizedComboKey = `${address}|${key}`;
      const params =
        apply.paramsByCombo[comboKey]?.[defParamKey] ??
        apply.paramsByCombo[normalizedComboKey]?.[defParamKey] ??
        {};
      const missing = missingRequiredHoles(def, params);
      if (missing.length > 0) {
        throw new Error(`Fill required fields for "${def.displayName}" before applying: ${missing.join(", ")}`);
      }
      const severity =
        apply.severityByCombo[comboKey]?.[defParamKey] ??
        apply.severityByCombo[normalizedComboKey]?.[defParamKey];
      plan.bindings.push({
        defId: def.id,
        packageId: pkgId,
        addresses: [address],
        ...(Object.keys(params).length ? { params } : {}),
        ...(severity ? { severity } : {}),
      });
      seenBindings.add(bindingKey);
    }
  }
  return plan;
}
