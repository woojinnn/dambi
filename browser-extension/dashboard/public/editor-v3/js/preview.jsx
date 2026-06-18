/* ════════════════════ 정책 읽기 전용 미리보기 (아래 패키지 영역) ════════════════════
 * 패키지 안의 정책을 클릭하면 뜨는 가벼운 읽기 전용 패널.
 * 상황(트리거) · 조건 · 결과(차단/경고) · 경고문 · 핵심 파라미터만 보여준다.
 * 실제 편집은 "정책 편집 →"으로 풀 에디터에서. (흐름도는 의도적으로 생략)
 */

// 트리거 → 사람이 읽는 라벨
function e2TriggerLabel(trigger) {
  if (!trigger || trigger.kind === "any") return "모든 거래";
  if (trigger.kind === "actionEq") {
    const a = (Cedar.KNOWN_ACTIONS || []).find((x) => x.entityType === trigger.entityType && x.id === trigger.id);
    return a ? a.label : (trigger.id || "특정 동작");
  }
  return "특정 상황";
}

// 미리보기용 ctx (조건 문장 렌더에 필요한 필드 카탈로그)
function e2PreviewCtx() {
  const fields = Cedar.fieldsForTrigger();
  const fieldByPath = new Map(fields.map((f) => [f.path, f]));
  if (window.PRINCIPAL_ADDRESS) fieldByPath.set(window.PRINCIPAL_ADDRESS.path, window.PRINCIPAL_ADDRESS);
  return { fieldByPath, rhsFields: fields };
}

// 조건 노드 배열 → 사람이 읽는 칩들 (그룹은 평탄화해 간단히)
function e2Conds(nodes, ctx) {
  const out = [];
  const walk = (arr) => {
    for (const n of arr || []) {
      if (Cedar.isGroupNode && Cedar.isGroupNode(n)) walk(n.conds);
      else out.push(n);
    }
  };
  walk(nodes);
  return out.map((c, i) => ({ key: i, text: window.condChip ? window.condChip(c, ctx) : (c.fieldPath || "조건") }));
}

const E2_SEV = {
  deny: { label: "차단", cls: "deny", ic: "block", desc: "이 거래를 막아요" },
  warn: { label: "경고", cls: "warn", ic: "warn", desc: "진행 전 경고를 띄워요" },
  info: { label: "정보", cls: "info", ic: "info", desc: "기록만 남겨요" },
};

function E2PolicyPreview({ binding, def, displayName, hover }) {
  const model = (binding && binding.modelOverride) || (def && def.skeleton && def.skeleton.model) || null;
  const ctx = React.useMemo(e2PreviewCtx, []);
  if (!model) {
    return (
      <div className="e2pop hoverpop">
        <div className="e2pop-body"><span className="e2pop-empty">내용을 불러올 수 없어요.</span></div>
      </div>
    );
  }
  const sev = E2_SEV[model.severity] || E2_SEV.warn;
  const when = e2Conds(model.when, ctx);
  const unless = e2Conds(model.unless, ctx);
  const reason = (model.reason || "").trim();

  return (
    <div className={`e2pop${hover ? " hoverpop" : ""}`} role="tooltip">
      <div className="e2pop-head">
        <span className={`e2pop-sev ${sev.cls}`}><Ic id={sev.ic} cls="sm" />{sev.label}</span>
        <span className="e2pop-title" title={displayName}>{displayName}</span>
      </div>
      <div className="e2pop-body">
        <div className="e2pop-line"><span className="k">상황</span><span className="v">{e2TriggerLabel(model.trigger)}</span></div>
        <div className="e2pop-line"><span className="k">조건</span>{when.length === 0 ? <span className="v">항상</span> : <span className="v conds">{when.map((c) => <span className="cd" key={c.key}>{c.text}</span>)}</span>}</div>
        {unless.length > 0 && <div className="e2pop-line"><span className="k">예외</span><span className="v conds">{unless.map((c) => <span className="cd" key={c.key}>{c.text}</span>)}</span></div>}
        {reason && <div className="e2pop-msg">{reason}</div>}
      </div>
      <div className="e2pop-foot"><span className="e2pop-ro"><Ic id="lock" cls="sm" />읽기 전용 미리보기 · 누르면 값 수정</span></div>
    </div>
  );
}

Object.assign(window, { E2PolicyPreview, e2TriggerLabel });
