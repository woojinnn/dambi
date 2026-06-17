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

import { SCHEMA_CATALOG } from "../cedar/form/schema-catalog.generated";
import type { FormModel, FormTrigger } from "../cedar/form/model";
import { request, ServerError } from "./client";

export interface LlmDraftInput {
  /** 사용자가 적은 정책 의도(자연어). */
  intent: string;
  /** 이미 고른 액션이 있으면 힌트로 전달(없으면 LLM 이 직접 고른다). */
  trigger?: FormTrigger | null;
}

/** 자연어 의도를 FormModel 로 변환한다(백엔드 경유). 카탈로그 전체를 객체로 보내면
 *  서버가 의도에 맞는 액션 하나만 골라 그 액션의 필드만 LLM 에 준다(토큰 절약). */
export async function llmDraftPolicy({ intent, trigger }: LlmDraftInput): Promise<FormModel> {
  try {
    return await request<FormModel>("/v2/policy/llm-draft", {
      method: "POST",
      body: {
        intent,
        catalog: SCHEMA_CATALOG,
        trigger: trigger?.kind === "actionEq" ? { entityType: trigger.entityType, id: trigger.id } : null,
      },
    });
  } catch (e) {
    // 서버 핸들러는 사람이 읽을 사유를 본문(plain text)으로 돌려준다 — status 줄
    // 대신 그 메시지를 노출한다(예: "OpenAI API key가 설정되지 않았습니다…").
    if (e instanceof ServerError && typeof e.body === "string" && e.body) {
      throw new Error(e.body);
    }
    throw e;
  }
}
