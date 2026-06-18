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

/* ── ir(PolicyIR) → 사람이 읽는 문장 ─────────────────────────────────────
 * 기본 안전팩 같은 실제 정책은 프로토타입의 model(when/unless 노드)이 아니라
 * skeleton.ir(Cedar 블록 IR)만 갖는다. 편집은 못 해도 "무엇을 막는지"는 보여줘야
 * 하므로 조건식을 한국어 문장으로 풀어 읽기 전용으로 렌더한다. */
const IR_LABELS = { "context.amount": "수량 (원본)", "principal.address": "내 지갑", principal: "내 지갑" };
function irHasBatchim(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false; // 한글 음절이 아니면 받침 없음으로 취급
  return (code - 0xac00) % 28 !== 0;
}
// 주격 조사: 받침 있으면 "이", 없으면 "가"
function irSubj(word) {
  return irHasBatchim(word[word.length - 1]) ? "이" : "가";
}
function irPath(e) {
  if (!e) return "";
  if (e.kind === "var") return e.name;
  if (e.kind === "attr") {
    const p = irPath(e.of);
    return p ? p + "." + e.attr : e.attr;
  }
  return "";
}
function irFieldLabel(e) {
  const p = irPath(e);
  if (IR_LABELS[p]) return IR_LABELS[p];
  const g = Cedar.getGloss && Cedar.getGloss(p);
  if (g) return g.label;
  return p.replace(/^context\./, "").replace(/^principal\./, "내 지갑 ") || "값";
}
function irIsAddrField(e) {
  const p = irPath(e);
  if (p === "principal.address") return true;
  const g = Cedar.getGloss && Cedar.getGloss(p);
  if (g) return g.role === "address";
  return /recipient|spender|address|delegatee|contract|onbehalf/i.test(p);
}
function irVal(e, asAddr) {
  if (!e) return "";
  if (e.kind === "lit") {
    const v = e.value;
    if (typeof v === "string") {
      if (asAddr) return Cedar.shortAddress ? Cedar.shortAddress(v) : v; // 주소는 따옴표 없이 축약
      return '"' + v + '"';
    }
    return String(v);
  }
  if (e.kind === "litEntity") return asAddr && Cedar.shortAddress ? Cedar.shortAddress(e.entity.id) : e.entity.id;
  if (e.kind === "attr" || e.kind === "var") return irFieldLabel(e);
  if (e.kind === "set") return e.elements.map((x) => irVal(x, asAddr)).join(", ");
  return "값";
}
// set.contains(field) / field in set → 멤버 나열용 (field, members) 추출
function irMembership(inner) {
  if (inner && inner.kind === "binary" && inner.op === "contains")
    return { field: inner.right, members: irVal(inner.left, irIsAddrField(inner.right)) };
  if (inner && inner.kind === "binary" && inner.op === "in")
    return { field: inner.left, members: irVal(inner.right, irIsAddrField(inner.left)) };
  return null;
}
const IR_CMP = { "==": "와 같으면", "!=": "와 다르면", "<": "보다 작으면", "<=": "이하이면", ">": "보다 크면", ">=": "이상이면" };
function irClause(e) {
  if (!e) return "";
  if (e.kind === "binary") {
    if (e.op === "&&") return irClause(e.left) + " 그리고 " + irClause(e.right);
    if (e.op === "||") return irClause(e.left) + " 또는 " + irClause(e.right);
    const m = irMembership(e);
    if (m) {
      const lbl = irFieldLabel(m.field);
      return lbl + irSubj(lbl) + " " + m.members + " 중 하나이면";
    }
    const lbl = irFieldLabel(e.left);
    return lbl + irSubj(lbl) + " " + irVal(e.right, irIsAddrField(e.left)) + " " + (IR_CMP[e.op] || e.op + " 이면");
  }
  if (e.kind === "unary" && e.op === "!") {
    const m = irMembership(e.operand);
    if (m) {
      const lbl = irFieldLabel(m.field);
      return lbl + irSubj(lbl) + " " + m.members + " 중 어느 것도 아니면";
    }
    return irClause(e.operand) + "이 아니면";
  }
  if (e.kind === "has") return irFieldLabel({ kind: "attr", of: e.of, attr: e.attr }) + " 값이 있으면";
  return "조건";
}
// ir 주석에서 값 찾기
function irAnno(ir, name) {
  const a = (ir.annotations || []).find((x) => x.name === name);
  return a ? a.value : undefined;
}
function irTriggerLabel(ir) {
  const act = ir.scope && ir.scope.action;
  if (!act || act.kind === "scopeAll") return "모든 거래";
  if (act.kind === "scopeEq" && act.entity) {
    const a = (Cedar.KNOWN_ACTIONS || []).find((x) => x.entityType === act.entity.type && x.id === act.entity.id);
    return a ? a.label : act.entity.id;
  }
  return "특정 상황";
}

function E2IrPreview({ ir, displayName, hover }) {
  const sev = E2_SEV[irAnno(ir, "severity")] || E2_SEV.warn;
  const conds = ir.conditions || [];
  const whenTxt = conds.filter((c) => c.kind === "when").map((c) => irClause(c.body)).join(" 그리고 ");
  const unlessTxt = conds.filter((c) => c.kind === "unless").map((c) => irClause(c.body)).join(" 그리고 ");
  const reason = (irAnno(ir, "reason") || "").trim();
  return (
    <div className={`e2pop${hover ? " hoverpop" : ""}`} role="tooltip">
      <div className="e2pop-head">
        <span className={`e2pop-sev ${sev.cls}`}><Ic id={sev.ic} cls="sm" />{sev.label}</span>
        <span className="e2pop-title" title={displayName}>{displayName}</span>
      </div>
      <div className="e2pop-body">
        <div className="e2pop-line"><span className="k">상황</span><span className="v">{irTriggerLabel(ir)}</span></div>
        <div className="e2pop-line"><span className="k">조건</span><span className="v">{whenTxt || "항상"}</span></div>
        {unlessTxt && <div className="e2pop-line"><span className="k">예외</span><span className="v">{unlessTxt}</span></div>}
        <div className="e2pop-sentence">{(whenTxt || "이 거래일 때") + " " + sev.label}</div>
        {reason && <div className="e2pop-msg">{reason}</div>}
      </div>
      <div className="e2pop-foot"><span className="e2pop-ro"><Ic id="lock" cls="sm" />읽기 전용 미리보기 · 기본 안전팩</span></div>
    </div>
  );
}

function E2PolicyPreview({ binding, def, displayName, hover }) {
  const model = (binding && binding.modelOverride) || (def && def.skeleton && def.skeleton.model) || null;
  const ctx = React.useMemo(e2PreviewCtx, []);
  if (!model) {
    const ir = def && def.skeleton && def.skeleton.ir;
    if (ir && ir.kind === "policy") return <E2IrPreview ir={ir} displayName={displayName} hover={hover} />;
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
