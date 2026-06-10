/**
 * CustomFieldModal — "+ 새 보강 필드 만들기".
 *
 * policy-server 메서드를 골라 파라미터(셀렉터/리터럴)를 매핑하면
 * `context.custom.<이름>` 필드가 생긴다: 즉시 필드 선택기에 나타나고, 저장 시
 * manifest의 `policy_rpc` + `custom_context`로 직렬화된다(생성 자체는 기존
 * generateManifest가 registry 병합으로 수행).
 */
import { useState } from "react";

import type { EnrichmentField } from "../../../editor-v9/manifest-gen";

import { METHOD_CATALOG, type MethodSpec } from "./custom-field-methods";

export interface CustomFieldDraft {
  name: string;
  field: EnrichmentField;
}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function CustomFieldModal({
  existingNames,
  actionTag,
  onCreate,
  onClose,
}: {
  /** 이미 쓰는 custom 필드 이름들 (중복 방지). */
  existingNames: readonly string[];
  /** 현재 trigger의 action tag (appliesTo로 기록). null = 모든 동작. */
  actionTag: string | null;
  onCreate: (draft: CustomFieldDraft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [method, setMethod] = useState<MethodSpec>(METHOD_CATALOG[0]);
  // 파라미터 값은 메서드 템플릿이 기본값 — 메서드를 바꾸면 그 템플릿으로 리셋.
  const [params, setParams] = useState<Record<string, string>>(() => paramStrings(METHOD_CATALOG[0]));
  const [projection, setProjection] = useState(METHOD_CATALOG[0].projection);

  const nameErr = !name
    ? null
    : !NAME_RE.test(name)
      ? "영문/숫자/_ 만, 숫자로 시작 불가"
      : existingNames.includes(name)
        ? "이미 있는 이름이에요"
        : null;
  const canCreate = name.length > 0 && !nameErr;

  const pickMethod = (m: MethodSpec) => {
    setMethod(m);
    setParams(paramStrings(m));
    setProjection(m.projection);
  };

  const create = () => {
    if (!canCreate) return;
    onCreate({
      name,
      field: {
        type: method.type,
        label: { ko: label || name, en: name },
        appliesTo: actionTag ? [actionTag] : [],
        method: method.method,
        projection,
        params: Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, parseParam(v)]),
        ),
      },
    });
    onClose();
  };

  return (
    <div className="cfm-bd" role="dialog" aria-modal onClick={onClose}>
      <div className="cfm" onClick={(e) => e.stopPropagation()}>
        <div className="cfm-h">
          새 보강 필드 만들기
          <button type="button" className="pf-iconbtn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="cfm-sub">
          policy-server 메서드를 호출해 채워지는 <code>context.custom.*</code> 필드를 정의해요.
          저장 시 manifest에 자동 반영됩니다.
        </p>

        <label className="cfm-row">
          <span className="cfm-label">필드 이름</span>
          <span className="cfm-name">
            <code>context.custom.</code>
            <input
              className={`pf-val${nameErr ? " invalid" : ""}`}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value.trim())}
              placeholder="myRiskScore"
            />
          </span>
        </label>
        {nameErr && <div className="cfm-err">{nameErr}</div>}

        <label className="cfm-row">
          <span className="cfm-label">표시 이름</span>
          <input
            className="pf-val wide"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="예: 상대 주소 위험 점수 (비우면 필드 이름)"
          />
        </label>

        <label className="cfm-row">
          <span className="cfm-label">메서드</span>
          <select
            className="pf-select"
            value={method.method}
            onChange={(e) => {
              const m = METHOD_CATALOG.find((x) => x.method === e.target.value);
              if (m) pickMethod(m);
            }}
          >
            {METHOD_CATALOG.map((m) => (
              <option key={m.method} value={m.method}>
                {m.label} — {m.method}
              </option>
            ))}
          </select>
        </label>
        <div className="cfm-desc">
          {method.desc}
          {method.mock && <span className="cfm-mock"> · 서버 미구현 예시 — 저장은 되지만 아직 값이 채워지지 않아요</span>}
        </div>

        <div className="cfm-params">
          <div className="cfm-params-h">
            파라미터 <span className="cfm-hint">`$.`로 시작하면 거래에서 뽑는 셀렉터, 아니면 고정값</span>
          </div>
          {Object.entries(params).map(([key, v]) => (
            <label key={key} className="cfm-row">
              <span className="cfm-label mono">{key}</span>
              <input
                className="pf-val wide mono"
                value={v}
                onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="cfm-row">
            <span className="cfm-label mono">결과 위치</span>
            <input
              className="pf-val wide mono"
              value={projection}
              onChange={(e) => setProjection(e.target.value)}
            />
          </label>
          <div className="cfm-row">
            <span className="cfm-label">값 타입</span>
            <span className="cfm-type">{method.type === "decimal" ? "소수 (decimal)" : method.type === "Long" ? "숫자 (Long)" : method.type === "Bool" ? "참/거짓" : "문자"}</span>
          </div>
        </div>

        <div className="cfm-actions">
          <button type="button" className="pf-add-cond" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cfm-create" disabled={!canCreate} onClick={create}>
            필드 만들기
          </button>
        </div>
      </div>
    </div>
  );
}

/** Param template → editable string form (`{literal: 6}` → `6`). */
function paramStrings(m: MethodSpec): Record<string, string> {
  return Object.fromEntries(
    Object.entries(m.params).map(([k, v]) => [
      k,
      typeof v === "object" && v !== null && "literal" in v ? String(v.literal) : String(v),
    ]),
  );
}

/** Editable string → ParamSpec: `$.`-prefixed stays a selector; otherwise a
 *  literal (number when numeric, true/false when boolean, else string). */
function parseParam(v: string): string | { literal: number | string | boolean } {
  const t = v.trim();
  if (t.startsWith("$.")) return t;
  if (t === "true" || t === "false") return { literal: t === "true" };
  if (t !== "" && !Number.isNaN(Number(t))) return { literal: Number(t) };
  return { literal: t };
}
