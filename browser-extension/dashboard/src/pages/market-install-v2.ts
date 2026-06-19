/** 마켓 설치 v2 — 리스팅을 ps2 def로 변환해 `ps2:install-market`로 설치한다.
 *  재설치(같은 def id)는 SW가 업데이트로 처리(바인딩 params 보존).
 *
 *  required hole(게시 때 블랭킹된 칸)이 있는 리스팅은 설치 모달이
 *  {@link requiredHoleInputs}로 입력 칸을 그리고, 채워진 값이 choice.params로
 *  들어온다 — defaults.params(라이브러리 기본값)와 바인딩 params 양쪽에
 *  기록된다. 안 채우면 SW의 install-market/bind-def 가드가 거부한다. */
import { installListing, pickI18n, type ListingDetail } from "../server-api";
import type { PolicyDoc } from "../../../sdk/policy-store-types";
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
import { textToBlocks } from "../cedar";
import type { PolicyIR } from "../cedar/blocks";
import { irToForm, type FormModel } from "../cedar/form";
import { holeInputToValue, listingToDefs, type ListingMeta } from "./market-install-convert";

export { listingToDefs } from "./market-install-convert";
export { diffParamValues } from "../cedar/form/parameterize";

/** 리스팅 상세 → 설치될 def 의 doc(정의/범위/대상/데이터). 구조화된 doc 이 있으면 그대로,
 *  없으면 일반 설명(description)을 '정책 정의' 칸으로 넣는다. set 리스팅은 convert 가
 *  멤버에 적용하지 않으므로 안전하다. */
function listingDocOf(detail: ListingDetail): PolicyDoc | undefined {
  const d = detail.doc;
  if (d && (d.definition || d.scope || d.audience || d.usedData)) return d;
  const desc = pickI18n(detail.description);
  return desc ? { definition: desc } : undefined;
}

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

/** 서버 install 기록 → def 변환 → ps2:install-market. 설치된 def id들을 반환. */
export async function installListingV2(
  detail: ListingDetail,
  locale: "ko" | "en",
  choice: InstallChoice,
): Promise<{ kind: "policy" | "set"; defIds: string[] }> {
  const { meta, defs } = await convertListing(detail, locale);

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
  const filled = choice.params ?? {};
  for (const d of defs) {
    // 기본값 병합 순서: 변환이 파생한 추천값 < 재설치 전 채워둔 값 < 이번에 채운 값.
    const prev = choice.snap?.library.defs[d.id];
    d.defaults = {
      enabled: choice.applyToNewWallets,
      params: { ...d.defaults.params, ...(prev?.defaults.params ?? {}), ...(filled[d.id] ?? {}) },
      packageId,
    };
  }

  await installMarket({ defs, ...(pkg ? { pkg } : {}), scope: choice.scope, params: filled });
  return { kind: detail.kind, defIds: defs.map((d) => d.id) };
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

/** 지갑 전용 설치(이름 유지, 동작 변경): 템플릿 def는 **라이브러리에 보이게**
 *  넣고(숨김 개념 폐기), 지갑마다 선택한 **여러 패키지**에 각각 바인딩한다 —
 *  패키지별로 채운 값(params)을 따로 적용. 선택 패키지가 없는 지갑은 바인딩 없이
 *  라이브러리에만 둔다. */
export async function installListingWalletOnlyV2(
  detail: ListingDetail,
  locale: "ko" | "en",
  choice: WalletOnlyInstallChoice,
): Promise<{ kind: "policy" | "set"; defIds: string[] }> {
  const { defs } = await convertListing(detail, locale);
  const filled = choice.params ?? {};

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
  await installMarket({ defs, scope: { kind: "library-only" }, params: {} });

  for (const address of choice.addresses) {
    const w = choice.snap.wallets.byAddress[address];
    const keys = choice.walletPackages[address] ?? [];
    for (const key of keys) {
      let pkgId: string;
      if (key === "__new__") {
        const newName = (choice.walletNewName?.[address] ?? "").trim();
        const existing = Object.values(w?.packages ?? {}).find((p) => p.displayName === newName);
        if (existing) {
          pkgId = existing.id;
        } else {
          pkgId = `pkg::${crypto.randomUUID()}`;
          await putWalletPackage({ address, pkg: { id: pkgId, displayName: newName } });
        }
      } else {
        pkgId = key; // UNCATEGORIZED_PKG 또는 기존 패키지 id
      }
      const pkgFilled = choice.paramsByAddressPkg?.[address]?.[key] ?? filled;
      for (const d of defs) {
        // 같은 패키지에 이미 들어 있으면 줄을 또 만들지 않는다(재설치 멱등).
        const dup = Object.values(w?.bindings ?? {}).some(
          (b) => b.defId === d.id && b.packageId === pkgId,
        );
        if (!dup) {
          const params = pkgFilled[d.id];
          const sev = choice.severityByAddressPkg?.[address]?.[key]?.[d.id];
          await bindDef({
            defId: d.id,
            packageId: pkgId,
            addresses: [address],
            ...(params && Object.keys(params).length ? { params } : {}),
            ...(sev ? { severity: sev } : {}),
          });
        }
      }
    }
  }
  return { kind: detail.kind, defIds: defs.map((d) => d.id) };
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
    doc: listingDocOf(detail),
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
    doc: listingDocOf(detail),
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

/** 공통: 서버 install 기록 → meta + ps2 def 변환. */
async function convertListing(
  detail: ListingDetail,
  locale: "ko" | "en",
): Promise<{ meta: ListingMeta; defs: Awaited<ReturnType<typeof listingToDefs>> }> {
  if (!detail.current_version) {
    throw new Error(
      locale === "ko" ? "이 listing에는 발행된 버전이 없습니다." : "This listing has no published version.",
    );
  }
  const body = await installListing(detail.id, detail.current_version);
  const meta: ListingMeta = {
    id: detail.id,
    kind: detail.kind,
    displayName: pickI18n(detail.display_name) || detail.slug,
    version: detail.current_version,
    cat: detail.category ?? detail.domain ?? undefined,
    doc: listingDocOf(detail),
  };
  const defs = await listingToDefs(meta, body, textToBlocks);
  return { meta, defs };
}
