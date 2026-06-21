/** 마켓 설치 v2 — 리스팅을 ps2 def로 변환해 `ps2:install-market`로 설치한다.
 *  재설치(같은 def id)는 SW가 업데이트로 처리(바인딩 params 보존).
 *
 *  required hole(게시 때 블랭킹된 칸)이 있는 리스팅은 설치 모달이
 *  {@link requiredHoleInputs}로 입력 칸을 그리고, 채워진 값이 choice.params로
 *  들어온다 — defaults.params(라이브러리 기본값)와 바인딩 params 양쪽에
 *  기록된다. 안 채우면 SW의 install-market/bind-def 가드가 거부한다. */
import {
  getListingVersion,
  installListing,
  pickI18n,
  type ListingDetail,
} from "../server-api";
import {
  bindDef,
  installMarket,
  putWalletPackage,
  type HoleSpec,
  type HoleValue,
  type MarketInstallScope,
  type PackageDef,
  type StoreSnapshot,
} from "../server-api/policy-store";
import { missingRequiredHoles } from "../../../sdk/policy-store-types";
import { textToBlocks } from "../cedar";
import type { PolicyIR } from "../cedar/blocks";
import { irToForm, type FormModel } from "../cedar/form";
import { holeInputToValue, listingToDefs, type ListingMeta } from "./market-install-convert";

export { listingToDefs } from "./market-install-convert";
export { diffParamValues } from "../cedar/form/parameterize";

/** defId → (hole 이름 → 값). 설치 모달의 "빈칸 채우기" 출력. */
export type InstallParams = Record<string, Record<string, HoleValue>>;

export interface InstallChoice {
  scope: MarketInstallScope;
  applyToNewWallets: boolean;
  /** kind=policy일 때 사용자가 고른 폴더 (set은 자동 패키지). */
  packageId: string | null;
  /** 채워진 required hole 값. */
  params?: InstallParams;
  /** 재설치 시 기존 def의 채워진 값을 보존하기 위한 현재 스냅샷. */
  snap?: StoreSnapshot | null;
}

/** 서버의 원자 install/download 경로 → def 변환 → ps2:install-market. 설치된 def id들을 반환. */
export async function installListingV2(
  detail: ListingDetail,
  locale: "ko" | "en",
  choice: InstallChoice,
): Promise<{ kind: "policy" | "set"; defIds: string[] }> {
  const filled = choice.params ?? {};
  const preflight = await convertListing(detail, locale);
  const preflightPackageId =
    detail.kind === "set" ? `pkg::market.${detail.id}` : choice.packageId ?? undefined;
  applyStandardInstallDefaults(preflight.defs, choice, preflightPackageId, filled);
  assertInstallDefsReady(preflight.defs, locale);

  const { meta, defs } = await convertListing(detail, locale, { recordInstall: true });

  const pkg: PackageDef | undefined =
    detail.kind === "set"
      ? {
          id: `pkg::market.${detail.id}`,
          displayName: meta.displayName,
          source: "market",
          sourceListingId: detail.id,
          sourceVersion: detail.current_version!,
          updatedAtMs: Date.now(),
        }
      : undefined;

  const packageId = pkg?.id ?? choice.packageId ?? undefined;
  applyStandardInstallDefaults(defs, choice, packageId, filled);
  assertInstallDefsReady(defs, locale);

  await installMarket({ defs, ...(pkg ? { pkg } : {}), scope: choice.scope, params: filled });
  return { kind: detail.kind, defIds: defs.map((d) => d.id) };
}

function applyStandardInstallDefaults(
  defs: Awaited<ReturnType<typeof listingToDefs>>,
  choice: InstallChoice,
  packageId: string | undefined,
  filled: InstallParams,
): void {
  for (const d of defs) {
    // 기본값 병합 순서: 변환이 파생한 추천값 < 재설치 전 채워둔 값 < 이번에 채운 값.
    const prev = choice.snap?.library.defs[d.id];
    d.defaults = {
      enabled: choice.applyToNewWallets,
      params: { ...d.defaults.params, ...(prev?.defaults.params ?? {}), ...(filled[d.id] ?? {}) },
      packageId,
    };
  }
}

function assertInstallDefsReady(
  defs: Awaited<ReturnType<typeof listingToDefs>>,
  locale: "ko" | "en",
): void {
  for (const d of defs) {
    const missing = missingRequiredHoles(d);
    if (missing.length > 0) {
      throw new Error(
        locale === "ko"
          ? `정책 "${d.displayName}"의 빈칸(${missing.join(", ")})을 채워야 설치할 수 있어요`
          : `Fill required fields for "${d.displayName}" before installing: ${missing.join(", ")}`,
      );
    }
  }
}

/** 패키지 선택 키 — 기존 패키지 id, 미분류 센티널(UNCATEGORIZED_PKG), 또는
 *  "__new__"(그 지갑에 새 패키지 만들기, 이름은 walletNewName). */
export type WalletPkgKey = string;
/** (구) 단일 패키지 결정 — 호환용. */
export type WalletPkgPick = { id: string } | { newName: string };

export interface WalletOnlyInstallChoice {
  addresses: string[];
  /** 지갑별 선택 패키지 키 목록(다중). 빈 배열 = 그 지갑은 적용 안 함(라이브러리만). */
  walletPackages: Record<string, WalletPkgKey[]>;
  /** "__new__" 키 해석용 — 지갑별 새 패키지 이름. */
  walletNewName?: Record<string, string>;
  /** find-or-create·중복 바인딩 가드용 현재 스토어 스냅샷. */
  snap: StoreSnapshot;
  /** 채워진 required hole 값(모든 바인딩 공통 폴백 / 라이브러리 def 기본값). */
  params?: InstallParams;
  /** 지갑·패키지키별 params — 선택한 패키지마다 값을 따로 채운다(공통보다 우선). */
  paramsByAddressPkg?: Record<string, Record<WalletPkgKey, InstallParams>>;
  /** 지갑·패키지키·def별 심각도 override(차단/경고). */
  severityByAddressPkg?: Record<string, Record<WalletPkgKey, Record<string, "deny" | "warn">>>;
}

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

interface WalletOnlyPlan {
  packages: { address: string; pkg: { id: string; displayName: string } }[];
  bindings: {
    address: string;
    defId: string;
    packageId: string;
    params?: Record<string, HoleValue>;
    severity?: "deny" | "warn";
  }[];
}

function walletOnlyParamsFor(
  choice: WalletOnlyInstallChoice,
  address: string,
  packageKey: string,
  fallback: InstallParams,
): InstallParams {
  const normalized = normalizeWalletAddress(address);
  return (
    choice.paramsByAddressPkg?.[address]?.[packageKey] ??
    choice.paramsByAddressPkg?.[normalized]?.[packageKey] ??
    fallback
  );
}

function walletOnlySeverityFor(
  choice: WalletOnlyInstallChoice,
  address: string,
  packageKey: string,
  defId: string,
): "deny" | "warn" | undefined {
  const normalized = normalizeWalletAddress(address);
  return (
    choice.severityByAddressPkg?.[address]?.[packageKey]?.[defId] ??
    choice.severityByAddressPkg?.[normalized]?.[packageKey]?.[defId]
  );
}

function buildWalletOnlyPlan(
  defs: Awaited<ReturnType<typeof listingToDefs>>,
  choice: WalletOnlyInstallChoice,
  filled: InstallParams,
  locale: "ko" | "en",
): WalletOnlyPlan {
  const plan: WalletOnlyPlan = { packages: [], bindings: [] };
  const seenAddresses = new Set<string>();
  const plannedPackageByWalletName = new Map<string, string>();
  for (const rawAddress of choice.addresses) {
    const address = normalizeWalletAddress(rawAddress);
    if (seenAddresses.has(address)) continue;
    seenAddresses.add(address);
    const w = choice.snap.wallets.byAddress[address];
    const seenBindings = new Set(
      Object.values(w?.bindings ?? {}).map((b) => `${b.defId}\u0000${b.packageId}`),
    );
    const packageKeys = choice.walletPackages[rawAddress] ?? choice.walletPackages[address] ?? [];
    for (const key of packageKeys) {
      assertSafeStorageKey(key, "wallet package key");
      let pkgId: string;
      if (key === "__new__") {
        const newName = (choice.walletNewName?.[rawAddress] ?? choice.walletNewName?.[address] ?? "").trim();
        if (!newName) {
          throw new Error(locale === "ko" ? "새 패키지 이름을 입력해야 해요" : "New package name is required");
        }
        const existing = Object.values(w?.packages ?? {}).find((p) => p.displayName === newName);
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

      const pkgFilled = walletOnlyParamsFor(choice, rawAddress, key, filled);
      for (const d of defs) {
        assertSafeStorageKey(d.id, "market def id");
        const bindingKey = `${d.id}\u0000${pkgId}`;
        if (seenBindings.has(bindingKey)) continue;
        const params = pkgFilled[d.id];
        const missing = missingRequiredHoles(d, params);
        if (missing.length > 0) {
          throw new Error(
            locale === "ko"
              ? `정책 "${d.displayName}"의 빈칸(${missing.join(", ")})을 채워야 적용할 수 있어요`
              : `Fill required fields for "${d.displayName}" before applying: ${missing.join(", ")}`,
          );
        }
        const severity = walletOnlySeverityFor(choice, rawAddress, key, d.id);
        plan.bindings.push({
          address,
          defId: d.id,
          packageId: pkgId,
          ...(params && Object.keys(params).length ? { params } : {}),
          ...(severity ? { severity } : {}),
        });
        seenBindings.add(bindingKey);
      }
    }
  }
  return plan;
}

/** 지갑 전용 설치(이름 유지, 동작 변경): 템플릿 def는 **라이브러리에 보이게**
 *  넣고(숨김 개념 폐기), 지갑마다 선택한 **여러 패키지**에 각각 바인딩한다 —
 *  패키지별로 채운 값(params)을 따로 적용. 선택 패키지가 없는 지갑은 바인딩 없이
 *  라이브러리에만 둔다. */
export async function installListingWalletOnlyV2(
  detail: ListingDetail,
  locale: "ko" | "en",
  choice: WalletOnlyInstallChoice,
): Promise<{ kind: "policy" | "set"; defIds: string[] }> {
  const filled = choice.params ?? {};

  // Wallet-only installs can fail during local planning before any policy-store
  // write. Run that pure preflight against the non-mutating version body first;
  // after it succeeds, use the server's atomic install/download body for the
  // actual local write so archived listings cannot race between read and install.
  const { defs: preflightDefs } = await convertListing(detail, locale);
  applyWalletOnlyDefaults(preflightDefs, choice, filled);
  buildWalletOnlyPlan(preflightDefs, choice, filled, locale);

  const { defs } = await convertListing(detail, locale, { recordInstall: true });
  applyWalletOnlyDefaults(defs, choice, filled);
  const plan = buildWalletOnlyPlan(defs, choice, filled, locale);

  await installMarket({ defs, scope: { kind: "library-only" }, params: {} });

  for (const pkg of plan.packages) {
    await putWalletPackage(pkg);
  }
  for (const binding of plan.bindings) {
    await bindDef({
      defId: binding.defId,
      packageId: binding.packageId,
      addresses: [binding.address],
      ...(binding.params ? { params: binding.params } : {}),
      ...(binding.severity ? { severity: binding.severity } : {}),
    });
  }
  return { kind: detail.kind, defIds: defs.map((d) => d.id) };
}

function applyWalletOnlyDefaults(
  defs: Awaited<ReturnType<typeof listingToDefs>>,
  choice: WalletOnlyInstallChoice,
  filled: InstallParams,
): void {
  for (const d of defs) {
    const prev = choice.snap.library.defs[d.id];
    if (prev) {
      // 재설치(업데이트): 기존 노출 상태·기본값 보존, 새로 채운 값만 얹는다.
      if (prev.hidden) d.hidden = true;
      d.defaults = {
        ...prev.defaults,
        params: { ...d.defaults.params, ...prev.defaults.params, ...(filled[d.id] ?? {}) },
      };
    } else {
      // 숨김 저장 폐기 — 템플릿은 라이브러리에 그대로 보인다.
      d.defaults = {
        enabled: false,
        params: { ...d.defaults.params, ...(filled[d.id] ?? {}) },
        packageId: undefined,
      };
    }
  }
}

/** 설치 전에 사용자가 조정할 수 있는 칸 — def별 파라미터 목록.
 *  게시자가 비워 둔 required 칸뿐 아니라, 폼 정책의 모든 값(리터럴도 설치 변환
 *  때 v1..vN 홀로 승격됨)을 노출해 지갑별로 튜닝할 수 있게 한다. 다른 필드를
 *  가리키는 참조(type "field")는 사용자가 손댈 값이 아니므로 제외. */
export interface ListingHoleRequirement {
  defId: string;
  defName: string;
  holes: HoleSpec[];
  /** hole 이름 → 입력칸 기본 문자열(리터럴/재설치 값). required 미충전은 "". */
  defaults: Record<string, string>;
}

/** HoleValue → 입력칸 문자열(holeInputToValue 의 역). field 객체는 제외 대상이라 빈칸. */
function holeValueToInputStr(v: HoleValue): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v !== null && typeof v === "object") return "";
  return String(v);
}

export async function requiredHoleInputs(
  detail: ListingDetail,
  snap: StoreSnapshot | null,
): Promise<ListingHoleRequirement[]> {
  // 미리보기 변환 — installListing(POST /install)은 설치 이벤트를 기록하므로
  // 여기서는 상세 응답에 이미 실려 온 latest_version 본문을 쓴다.
  const v = detail.latest_version;
  if (!v || !detail.current_version) return [];
  const meta: ListingMeta = {
    id: detail.id,
    kind: detail.kind,
    displayName: pickI18n(detail.display_name) || detail.slug,
    version: detail.current_version,
    cat: detail.category ?? detail.domain ?? undefined,
  };
  const defs = await listingToDefs(
    meta,
    { cedar_text: v.cedar_text, manifest: v.manifest, members: v.members },
    textToBlocks,
  );
  const out: ListingHoleRequirement[] = [];
  for (const d of defs) {
    const prevParams = snap?.library.defs[d.id]?.defaults.params ?? {};
    const usable: HoleSpec[] = [];
    const defaults: Record<string, string> = {};
    for (const h of d.holes) {
      if (h.type === "field") continue; // 다른 필드 참조 — 사용자가 손댈 값 아님
      const val = prevParams[h.name] ?? d.defaults.params[h.name];
      const str = val === undefined ? "" : holeValueToInputStr(val);
      // required(게시자가 비운 칸)는 반드시 채워야 하므로 항상 노출. 그 외(리터럴이
      // v1..vN 홀로 승격된 값)는 기본값이 그 타입으로 유효해 왕복되는 것만 — 주소가
      // 아닌 집합(eip155 체인ID 등)이 addressSet 으로 오분류돼 설치가 막히는 걸 방지.
      if (h.required || holeInputToValue(h.type, str) !== null) {
        usable.push(h);
        defaults[h.name] = str;
      }
    }
    if (usable.length) out.push({ defId: d.id, defName: d.displayName, holes: usable, defaults });
  }
  return out;
}

export { holeInputToValue } from "./market-install-convert";

/** 설치 모달의 문장형 폼(에디터 ValueSheet)용 — 폼으로 열리는 def 마다 기준
 *  FormModel + manifest. 설치 변환 def 의 skeleton.ir 은 이미 v1..vN 으로
 *  파라미터화돼 있어, irToForm 이 리터럴 값을 그대로 가진 모델을 돌려준다.
 *  바인딩 params 는 편집 후 diffParamValues(baseModel, editedModel) 로 뽑는다. */
export interface ListingFormDef {
  defId: string;
  defName: string;
  model: FormModel;
  manifest: unknown;
}

export async function installFormDefs(
  detail: ListingDetail,
): Promise<ListingFormDef[]> {
  const v = detail.latest_version;
  if (!v || !detail.current_version) return [];
  const meta: ListingMeta = {
    id: detail.id,
    kind: detail.kind,
    displayName: pickI18n(detail.display_name) || detail.slug,
    version: detail.current_version,
    cat: detail.category ?? detail.domain ?? undefined,
  };
  const defs = await listingToDefs(
    meta,
    { cedar_text: v.cedar_text, manifest: v.manifest, members: v.members },
    textToBlocks,
  );
  const out: ListingFormDef[] = [];
  for (const d of defs) {
    const model = irToForm(d.skeleton.ir as PolicyIR);
    // 폼으로 표현 못 하는 def(수기 Cedar 등)는 설치 모달에서 편집 대상이 아니다.
    if (model) out.push({ defId: d.id, defName: d.displayName, model, manifest: d.skeleton.manifest });
  }
  return out;
}

/** 공통: 버전 본문 fetch → meta + ps2 def 변환. */
async function convertListing(
  detail: ListingDetail,
  locale: "ko" | "en",
  opts: { recordInstall?: boolean } = {},
): Promise<{ meta: ListingMeta; defs: Awaited<ReturnType<typeof listingToDefs>> }> {
  if (!detail.current_version) {
    throw new Error(
      locale === "ko" ? "이 listing에는 발행된 버전이 없습니다." : "This listing has no published version.",
    );
  }
  const body = opts.recordInstall
    ? await installListing(detail.id, detail.current_version)
    : await getListingVersion(detail.id, detail.current_version);
  const meta: ListingMeta = {
    id: detail.id,
    kind: detail.kind,
    displayName: pickI18n(detail.display_name) || detail.slug,
    version: detail.current_version,
    cat: detail.category ?? detail.domain ?? undefined,
  };
  const defs = await listingToDefs(meta, body, textToBlocks);
  return { meta, defs };
}
