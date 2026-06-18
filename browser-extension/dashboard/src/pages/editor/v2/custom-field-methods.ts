/**
 * policy-server 메서드 카탈로그 — "+ 새 보강 필드 만들기" 모달의 메서드 선택지.
 *
 * 실제로 서버가 구현한 메서드 2개(oracle.usd_value, token.normalize_to_nano —
 * manifest-gen/registry.ts의 hand-authored 항목과 같은 계약) + 형태를 보여주기
 * 위한 예시(mock) 항목들. 서버의 메서드 디스커버리 API가 생기면 이 정적 목록을
 * 그 응답으로 대체한다.
 *
 * 파라미터 값 문법은 manifest `policy_rpc[].params`와 동일: `$.`로 시작하면
 * plan-time 셀렉터(`$.root.*` = tx/체인, `$.action.*` = lowered 액션 컨텍스트),
 * 아니면 리터럴.
 */

import { i18n } from "../../../i18n";
import type { CustomType, EnrichmentField, ParamSpec } from "../../../editor-v9/manifest-gen";

export interface MethodSpec {
  /** Opaque policy-server method name (manifest `policy_rpc[].method`). */
  method: string;
  /** Output type the projection yields (`custom_context` spelling). */
  type: CustomType;
  /** Default `$.result.*` projection. */
  projection: string;
  /** Param template — key 고정, 값(셀렉터/리터럴)은 모달에서 편집 가능. */
  params: Record<string, ParamSpec>;
  /** True = 서버 미구현 예시(형태 시연용). 모달에 "(예시)"로 표시. */
  mock?: boolean;
}

/** 메서드 표시 이름 — i18n 키 `editor:methods.<method>.label` (점은 `_`로). */
export function methodLabel(m: MethodSpec): string {
  return i18n.t(`editor:methods.${m.method.replace(/\./g, "_")}.label`);
}

/** 메서드 설명 — i18n 키 `editor:methods.<method>.desc`. */
export function methodDesc(m: MethodSpec): string {
  return i18n.t(`editor:methods.${m.method.replace(/\./g, "_")}.desc`);
}

export const METHOD_CATALOG: MethodSpec[] = [
  {
    method: "oracle.usd_value",
    type: "decimal",
    projection: "$.result.usd",
    params: {
      chain_id: "$.root.chain_id",
      asset: "$.action.tokenIn.key.address",
      amount: "$.action.direction.amountIn",
    },
  },
  {
    method: "token.normalize_to_nano",
    type: "Long",
    projection: "$.result.nano",
    params: {
      amount: "$.action.direction.amountIn",
      chain_id: "$.root.chain_id",
      asset: "$.action.tokenIn.key.address",
    },
  },
  {
    method: "address.risk_score",
    type: "Long",
    projection: "$.result.score",
    params: {
      chain_id: "$.root.chain_id",
      address: "$.action.spender",
    },
    mock: true,
  },
  {
    method: "intent.pending_exposure_usd",
    type: "decimal",
    projection: "$.result.usd",
    params: {
      chain_id: "$.root.chain_id",
      wallet: "$.root.from",
    },
    mock: true,
  },
  {
    method: "token.price_change_24h",
    type: "decimal",
    projection: "$.result.pct",
    params: {
      chain_id: "$.root.chain_id",
      asset: "$.action.tokenIn.key.address",
    },
    mock: true,
  },
];

/** 내부 필드 이름 자동 생성(CustomFieldModal 과 동일): 메서드 꼬리 camelCase + 충돌 시 숫자. */
function autoName(methodName: string, existing: readonly string[]): string {
  const tail = methodName.split(".").pop() ?? "value";
  const base = tail.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}${i}`;
    if (!existing.includes(cand)) return cand;
  }
}

/** 액션에 적용 가능한 메서드를 보강 필드로 전개한 것. */
export interface DerivedField {
  /** `context.custom.<name>` 의 name. */
  name: string;
  /** 전체 경로 `context.custom.<name>`. */
  path: string;
  /** manifest 생성용 바인딩(레지스트리 항목과 동형). */
  field: EnrichmentField;
  /** 서버 미구현(mock) 메서드면 true — 실제 생성 불가, 경고 대상. */
  mock: boolean;
}

/** `$.action.<rest>` 셀렉터가 모두 이 액션의 필드로 해석되는 메서드만 = 적용 가능.
 *  (`$.root.*` / 리터럴은 항상 OK.) */
function methodApplies(m: MethodSpec, actionPaths: ReadonlySet<string>): boolean {
  return Object.values(m.params).every((spec) => {
    if (typeof spec === "object" && spec !== null && "literal" in spec) return true;
    const raw = String(spec);
    if (!raw.startsWith("$.action.")) return true; // $.root.* 등은 항상 가능
    return actionPaths.has(`context.${raw.slice("$.action.".length)}`);
  });
}

/** 이 액션(태그)에 적용 가능한 METHOD_CATALOG 메서드를, CustomFieldModal 이 만드는
 *  것과 동일한 형태의 보강 필드로 전개한다. 이름이 deterministic 이라 폼·LLM·서버가
 *  같은 필드를 가리킨다. real 은 실제 생성/사용, mock 은 경고용으로 분리해 둔다. */
export function methodDerivedFields(
  actionTag: string,
  actionPaths: readonly string[],
): DerivedField[] {
  const pathset = new Set(actionPaths);
  const used: string[] = [];
  const out: DerivedField[] = [];
  for (const m of METHOD_CATALOG) {
    if (!methodApplies(m, pathset)) continue;
    const name = autoName(m.method, used);
    used.push(name);
    const label = methodLabel(m);
    out.push({
      name,
      path: `context.custom.${name}`,
      field: {
        type: m.type,
        label: { ko: label, en: label },
        appliesTo: actionTag ? [actionTag] : [],
        method: m.method,
        projection: m.projection,
        params: m.params,
      },
      mock: !!m.mock,
    });
  }
  return out;
}
