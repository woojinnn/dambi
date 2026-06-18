/**
 * LLM 정책 초안 — 자연어 의도 → FormModel.
 *
 * 에디터의 "LLM" 탭이 호출한다. 액션·필드 카탈로그(프론트가 소유)와 자연어 의도를
 * 백엔드(policy-server)의 POST /v2/policy/llm-draft 로 보낸다. 서버가 유저별로 저장된
 * OpenAI 키로 모델을 호출하고, 생성된 Cedar 를 policy-engine 으로 컴파일 검증한 뒤
 * FormModel 을 돌려준다 — 키는 브라우저에 노출되지 않는다.
 *
 * OpenAI 키는 프로필 페이지에서 설정한다(server-api/settings.ts).
 */

import { i18n } from "../i18n";
import { KNOWN_ACTIONS } from "../cedar/form/actions";
import { isRawNumericStringLeaf } from "../cedar/form/field-catalog";
import { SCHEMA_CATALOG } from "../cedar/form/schema-catalog.generated";
import type { FormModel, FormTrigger } from "../cedar/form/model";
import { methodDerivedFields } from "../pages/editor/v2/custom-field-methods";
import { ENRICHMENT_FIELDS } from "../editor-v9/manifest-gen";
import { request, ServerError } from "./client";

export interface LlmDraftInput {
  /** 사용자가 적은 정책 의도(자연어). */
  intent: string;
  /** 이미 고른 액션이 있으면 힌트로 전달(없으면 LLM 이 직접 고른다). */
  trigger?: FormTrigger | null;
}

/** LLM 생성 결과 — FormModel + LLM 이 남긴 경고(예: mock 메서드 필요). */
export interface LlmDraftResult {
  model: FormModel;
  warnings: string[];
}

type EnrichEntry = { path: string; type: string; label: string };

/** `"Perp::PlaceOrder"` → 액션 태그 `"place_order"` (manifest-gen 의 actionTag 와 동일). */
const tagOfKey = (key: string): string =>
  (key.split("::")[1] ?? "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** LLM 에 줄 카탈로그 — 정렬 비교가 안 되는 원시 숫자-String 필드(amount/gas/price
 *  원본 등)는 제외한다. 폼이 고급으로 숨기는 것과 동일 판정(isRawNumericStringLeaf)
 *  이라, LLM 이 "gas > X" 같은 의도에 잘못된 String 필드를 고르지 않게 한다. */
function cleanedCatalog(): typeof SCHEMA_CATALOG {
  const out: Record<string, (typeof SCHEMA_CATALOG)[string]> = {};
  for (const [k, rows] of Object.entries(SCHEMA_CATALOG)) {
    out[k] = rows.filter(
      ([path, type]) => !(type === "String" && isRawNumericStringLeaf(path.split(".").pop() ?? "")),
    );
  }
  return out;
}

/** 액션 선택용 목록 — 카탈로그 키("Ns::Id")에 사람이 읽는 한국어 라벨을 붙인다.
 *  서버 step1(액션 선택)이 라벨로 의도를 더 정확히 매칭하게 한다. */
function actionList(): Array<{ key: string; label: string }> {
  return KNOWN_ACTIONS.map((a) => ({
    key: `${a.entityType.split("::")[0]}::${a.id}`,
    label: a.label,
  }));
}

/** 액션별로 LLM 에 줄 (1) 사용 가능한 보강 필드 = 레지스트리 보강 + 실구현(real)
 *  메서드-파생 필드, (2) mock 메서드 개념 라벨(사용 불가, 경고용)을 만든다. */
function buildEnrichment(actions: Array<{ key: string }>): {
  enrichment: Record<string, EnrichEntry[]>;
  mockConcepts: Record<string, string[]>;
} {
  const en = i18n.language.startsWith("en");
  const enrichment: Record<string, EnrichEntry[]> = {};
  const mockConcepts: Record<string, string[]> = {};

  // 1) 레지스트리 보강 필드 (appliesTo 태그로).
  for (const [name, def] of Object.entries(ENRICHMENT_FIELDS)) {
    const entry: EnrichEntry = {
      path: `context.custom.${name}`,
      type: def.type,
      label: en ? def.label.en : def.label.ko,
    };
    for (const a of actions) {
      if (def.appliesTo.includes(tagOfKey(a.key))) (enrichment[a.key] ??= []).push(entry);
    }
  }

  // 2) 메서드-파생 필드 — real 은 사용 가능, mock 은 개념(경고)으로 분리.
  for (const a of actions) {
    const tag = tagOfKey(a.key);
    const paths = (SCHEMA_CATALOG[a.key] ?? []).map((r) => r[0]);
    for (const d of methodDerivedFields(tag, paths)) {
      const label = en ? d.field.label.en : d.field.label.ko;
      if (d.mock) (mockConcepts[a.key] ??= []).push(label);
      else (enrichment[a.key] ??= []).push({ path: d.path, type: d.field.type, label });
    }
  }
  return { enrichment, mockConcepts };
}

/** 자연어 의도를 FormModel 로 변환한다(백엔드 경유). 카탈로그 + 액션 라벨 + 액션별
 *  보강 필드(레지스트리+real 메서드) + mock 개념을 보내면, 서버가 액션을 골라 그
 *  액션의 정적·보강 필드만 LLM 에 주고, mock 개념은 경고용으로만 안내한다. */
export async function llmDraftPolicy({ intent, trigger }: LlmDraftInput): Promise<LlmDraftResult> {
  const actions = actionList();
  const { enrichment, mockConcepts } = buildEnrichment(actions);
  try {
    const resp = await request<{ formModel: FormModel; warnings?: string[] }>("/v2/policy/llm-draft", {
      method: "POST",
      body: {
        intent,
        catalog: cleanedCatalog(),
        actions,
        enrichment,
        mock_concepts: mockConcepts,
        trigger: trigger?.kind === "actionEq" ? { entityType: trigger.entityType, id: trigger.id } : null,
      },
    });
    return { model: resp.formModel, warnings: resp.warnings ?? [] };
  } catch (e) {
    // 서버 핸들러는 사람이 읽을 사유를 본문(plain text)으로 돌려준다 — status 줄
    // 대신 그 메시지를 노출한다(예: "OpenAI API key가 설정되지 않았습니다…").
    if (e instanceof ServerError && typeof e.body === "string" && e.body) {
      throw new Error(e.body);
    }
    throw e;
  }
}
