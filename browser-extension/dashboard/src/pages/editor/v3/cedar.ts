// @ts-nocheck
/* ────────────────────────────────────────────────────────────────────────
 * Cedar / form layer — ported from editor/js/cedar.js (global IIFE → ES module).
 * Exposes the same `Cedar` object the prototype put on window.Cedar.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── gloss field catalog (curated subset, verbatim labels) ── */
const G = (path, ko, role, fieldKind, unit, scale) => ({ path, label: ko, role, fieldKind, source: "base", unit, scale });
const GLOSS = [
  G("context.recipient", "수신자", "address", "primitive.String"),
  G("context.spender", "지출 승인 대상", "address", "primitive.String"),
  G("context.delegatee", "위임 대상", "address", "primitive.String"),
  G("context.onBehalfOf", "대리 대상", "address", "primitive.String"),
  G("context.contract", "컨트랙트 주소", "address", "primitive.String"),
  G("context.venue.name", "거래 장소 이름", "ref", "primitive.String"),
  G("context.tokenIn.key.address", "입력 토큰 주소", "address", "primitive.String"),
  G("context.tokenOut.key.address", "출력 토큰 주소", "address", "primitive.String"),
  G("context.asset.key.address", "자산 주소", "address", "primitive.String"),
  G("context.amountNano", "수량", "numeric", "primitive.Long", "토큰", "nano"),
  G("context.amountInNano", "입력 수량", "numeric", "primitive.Long", "토큰", "nano"),
  G("context.amountOutNano", "출력 수량", "numeric", "primitive.Long", "토큰", "nano"),
  G("context.amountUsd", "수량 (USD 환산)", "numeric", "primitive.decimal", "USD"),
  G("context.slippageBp", "가격 미끄러짐 허용치", "numeric", "primitive.Long", "bp"),
  G("context.priceImpactBp", "내 거래의 시세 영향", "numeric", "primitive.Long", "bp"),
  G("context.leverage", "유효 레버리지", "numeric", "primitive.Long", "x"),
  G("context.newLeverage", "새 레버리지", "numeric", "primitive.decimal", "x"),
  G("context.direction.kind", "스왑 방향", "enum", "primitive.String"),
  G("context.side", "방향 (롱/숏)", "enum", "primitive.String"),
  G("context.rateMode", "금리 모드", "enum", "primitive.String"),
  G("context.reduceOnly", "감소 전용", "enum", "primitive.Bool"),
  G("context.positionEffect", "포지션 효과", "enum", "primitive.String"),
  G("context.orderType.kind", "주문 유형", "enum", "primitive.String"),
  G("context.orderType.timeInForce.kind", "주문 유효기간", "enum", "primitive.String"),
  G("context.orderType.durationMinutes", "TWAP 시간", "numeric", "primitive.Long", "분"),
  G("context.proof", "머클 증명", "auth", "collection"),
  G("context.positionId", "포지션 ID", "auth", "primitive.String"),
  G("context.enrichment.validityDeltaSec", "마감까지 남은 시간", "derived", "primitive.Long", "초"),
  G("context.enrichment.recipientIsContract", "수신자가 컨트랙트", "derived", "primitive.Bool"),
  G("context.enrichment.totalInputUsd", "입력 가치 (USD)", "derived", "primitive.decimal", "USD"),
  G("context.enrichment.effectiveRateVsOracleBps", "기준 시세 대비 체결가 차이", "derived", "primitive.Long", "bp"),
];
const GLOSS_BY_PATH = new Map(GLOSS.map((g) => [g.path, g]));
function getGloss(path) {
  return GLOSS_BY_PATH.get(path);
}

const RAW_ACTIONS = {
  "스왑·유동성 (AMM)": [["Amm::Action", "Swap", "스왑"], ["Amm::Action", "AddLiquidity", "유동성 추가"], ["Amm::Action", "RemoveLiquidity", "유동성 제거"], ["Amm::Action", "CollectFees", "수수료 수령"]],
  "토큰": [["Token::Action", "Erc20Transfer", "토큰 전송"], ["Token::Action", "Erc20Approve", "토큰 승인"], ["Token::Action", "Erc20Permit", "토큰 Permit 서명"], ["Token::Action", "RevokeApproval", "승인 취소"], ["Token::Action", "NftTransfer", "NFT 전송"], ["Token::Action", "NftApprove", "NFT 승인"], ["Token::Action", "NftSetApprovalForAll", "NFT 전체 승인"], ["Token::Action", "Permit2Approve", "Permit2 승인"], ["Token::Action", "WrapNative", "네이티브 랩핑"], ["Token::Action", "UnwrapNative", "네이티브 언랩"]],
  "선물 (Perp)": [["Perp::Action", "OpenPosition", "포지션 오픈"], ["Perp::Action", "ClosePosition", "포지션 종료"], ["Perp::Action", "IncreasePosition", "포지션 증가"], ["Perp::Action", "DecreasePosition", "포지션 감소"], ["Perp::Action", "ChangeLeverage", "레버리지 변경"], ["Perp::Action", "PlaceOrder", "주문 넣기"], ["Perp::Action", "CancelOrder", "주문 취소"]],
  "대출": [["Lending::Action", "Supply", "예치"], ["Lending::Action", "Withdraw", "출금"], ["Lending::Action", "Borrow", "차입"], ["Lending::Action", "Repay", "상환"], ["Lending::Action", "Liquidate", "청산"], ["Lending::Action", "EnableCollateral", "담보 활성화"]],
  "스테이킹": [["Staking::Action", "Stake", "스테이킹"], ["Staking::Action", "Lock", "락업"], ["Staking::Action", "Unlock", "언락"], ["Staking::Action", "ClaimRewards", "보상 수령"]],
  "거버넌스": [["Governance::Action", "Delegate", "투표권 위임"], ["Governance::Action", "Vote", "투표"], ["Governance::Action", "Propose", "제안"]],
  "에어드랍": [["Airdrop::Action", "Claim", "에어드랍 청구"], ["Airdrop::Action", "Delegate", "에어드랍 위임"]],
  "NFT 마켓": [["Marketplace::Action", "SignOrder", "주문 서명"], ["Marketplace::Action", "FulfillOrder", "주문 체결"], ["Marketplace::Action", "CancelOrder", "주문 취소"]],
  "기타": [["Core::Action", "Multicall", "멀티콜"], ["Core::Action", "Unknown", "알 수 없는 거래"]],
};
const KNOWN_ACTIONS = [];
const ACTION_GROUPS = Object.entries(RAW_ACTIONS).map(([group, arr]) => ({
  group,
  actions: arr.map(([entityType, id, label]) => {
    const a = { entityType, id, label, group };
    KNOWN_ACTIONS.push(a);
    return a;
  }),
}));

function fieldsForTrigger(_trigger) {
  return GLOSS.slice();
}

function operatorsFor(kind) {
  switch (kind) {
    case "primitive.Bool":
      return ["==", "!="];
    case "primitive.Long":
      return ["==", "!=", "<", "<=", ">", ">="];
    case "primitive.decimal":
      return ["<", "<=", ">", ">=", "==", "!="];
    case "primitive.String":
      return ["==", "!=", "in", "notIn"];
    case "collection":
      return ["contains", "notContains"];
    case "ref":
      return ["==", "!="];
    default:
      return [];
  }
}
function valueKindForField(kind) {
  switch (kind) {
    case "primitive.Bool":
      return "bool";
    case "primitive.Long":
      return "long";
    case "primitive.decimal":
      return "decimal";
    default:
      return "string";
  }
}

function isGroupNode(n) {
  return n && typeof n === "object" && n.kind === "group";
}
function splitRuns(nodes) {
  const runs = [];
  let cur = null;
  nodes.forEach((n, i) => {
    if (i === 0 || n.joiner === "or") {
      cur = [n];
      runs.push(cur);
    } else {
      cur.push(n);
    }
  });
  return runs;
}
function situationsOf(nodes) {
  return nodes.length === 0 ? [] : splitRuns(nodes);
}
const withJoiner = (n, j) => (n.joiner === j ? n : { ...n, joiner: j });
function flattenSituations(runs) {
  const out = [];
  for (const run of runs) run.forEach((n, i) => out.push(withJoiner(n, i === 0 ? "or" : "and")));
  return out;
}
function normalizeChildren(children) {
  const out = [];
  for (const n of children) {
    if (!isGroupNode(n)) {
      out.push(n);
      continue;
    }
    const kids = normalizeChildren(n.conds);
    if (kids.length === 0) continue;
    if (kids.length === 1) {
      const only = kids[0];
      if (isGroupNode(only)) out.push(...only.conds);
      else out.push(only);
      continue;
    }
    out.push({ ...n, conds: kids.map((k, i) => withJoiner(k, i === 0 ? "and" : "or")) });
  }
  return out;
}
function normalizeSituations(nodes) {
  const runs = situationsOf(nodes)
    .map((run) => normalizeChildren(run))
    .filter((r) => r.length > 0);
  return flattenSituations(runs);
}
function removeDeep(nodes, cond) {
  let changed = false;
  const out = [];
  for (const n of nodes) {
    if (n === cond) {
      changed = true;
      continue;
    }
    if (isGroupNode(n)) {
      const r = removeDeep(n.conds, cond);
      if (r.changed) {
        changed = true;
        if (r.nodes.length > 0) out.push({ ...n, conds: r.nodes });
      } else out.push(n);
    } else out.push(n);
  }
  return { nodes: out, changed };
}
function appendToGroup(nodes, group, cond) {
  let found = false;
  const out = nodes.map((n) => {
    if (!isGroupNode(n) || found) return n;
    if (n === group) {
      found = true;
      return { ...n, conds: [...n.conds, { ...cond, joiner: "or" }] };
    }
    const r = appendToGroup(n.conds, group, cond);
    if (r.found) {
      found = true;
      return { ...n, conds: r.nodes };
    }
    return n;
  });
  return { nodes: out, found };
}
function moveCondTo(nodes, cond, target) {
  if (target.kind === "group" && target.group.conds.includes(cond)) return nodes;
  const removed = removeDeep(nodes, cond).nodes;
  if (target.kind === "group") {
    const r = appendToGroup(removed, target.group, cond);
    return r.found ? r.nodes : nodes;
  }
  const runs = situationsOf(removed);
  if (target.kind === "new-situation" || runs.length === 0) {
    return flattenSituations([...runs, [{ ...cond, joiner: "and" }]]);
  }
  const i = Math.min(target.index, runs.length - 1);
  runs[i] = [...runs[i], { ...cond, joiner: "and" }];
  return flattenSituations(runs);
}

function normalizeDecimal(s) {
  const t = String(s).trim();
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  if (!t.includes(".")) return t + ".0";
  return t;
}
function isValidDecimal(s) {
  const t = String(s).trim();
  return /^-?\d+\.\d{1,4}$/.test(t);
}
function findInvalidModelDecimals(model) {
  const bad = [];
  const walk = (nodes) =>
    nodes.forEach((n) => {
      if (isGroupNode(n)) walk(n.conds);
      else if (n.value && n.value.kind === "decimal" && !isValidDecimal(n.value.value)) bad.push(n.value.value);
    });
  walk(model.when);
  walk(model.unless);
  return bad;
}

function fmtValue(v) {
  switch (v.kind) {
    case "bool":
      return v.value ? "true" : "false";
    case "long":
      return String(v.value);
    case "decimal":
      return `decimal("${v.value}")`;
    case "string":
      return `"${v.value}"`;
    case "set":
      return "[" + v.values.map((x) => `"${x}"`).join(", ") + "]";
    case "field":
      return v.path;
    default:
      return '""';
  }
}
function fmtLeaf(c) {
  const lhs = c.fieldPath;
  const rhs = fmtValue(c.value);
  switch (c.op) {
    case "==":
      return `${lhs} == ${rhs}`;
    case "!=":
      return `${lhs} != ${rhs}`;
    case "<":
      return `${lhs} < ${rhs}`;
    case "<=":
      return `${lhs} <= ${rhs}`;
    case ">":
      return `${lhs} > ${rhs}`;
    case ">=":
      return `${lhs} >= ${rhs}`;
    case "contains":
      return `${lhs}.contains(${rhs})`;
    case "notContains":
      return `!${lhs}.contains(${rhs})`;
    case "in":
      return `${lhs} in ${rhs}`;
    case "notIn":
      return `!(${lhs} in ${rhs})`;
    default:
      return `${lhs} == ${rhs}`;
  }
}
function renderNodes(nodes, or) {
  const parts = nodes.map((n) => (isGroupNode(n) ? "(" + renderNodes(n.conds, !or) + ")" : fmtLeaf(n)));
  return parts.join(or ? " || " : " && ");
}
function renderClause(nodes) {
  const runs = situationsOf(nodes);
  if (runs.length === 0) return "";
  const rendered = runs.map((run) => {
    const inner = renderNodes(run, false);
    return runs.length > 1 && run.length > 1 ? "(" + inner + ")" : inner;
  });
  return rendered.join(" || ");
}
function actionScope(trigger) {
  if (trigger.kind === "actionEq") return `  action == ${trigger.entityType}::"${trigger.id}",`;
  return "  action,";
}
function serializeCedar(model, slug, severity, reason) {
  const sev = severity || model.severity || "warn";
  const rs = (reason != null ? reason : model.reason) || "";
  const lines = [];
  lines.push(`@id("${slug}")`);
  lines.push(`@severity("${sev}")`);
  if (rs) lines.push(`@reason("${rs.replace(/"/g, '\\"')}")`);
  lines.push("forbid (");
  lines.push("  principal,");
  lines.push(actionScope(model.trigger));
  lines.push("  resource");
  lines.push(")");
  const when = renderClause(model.when);
  const unless = renderClause(model.unless);
  if (when) lines.push("when { " + when + " }");
  if (unless) lines.push("unless { " + unless + " }");
  return lines.join("\n") + ";";
}
function severityFromCedar(text) {
  const m = String(text || "").match(/@severity\(\s*"([^"]+)"\s*\)/);
  const s = m ? m[1] : "";
  return s === "deny" || s === "warn" || s === "info" ? s : "warn";
}
function reasonFromCedar(text) {
  const m = String(text || "").match(/@reason\(\s*"((?:[^"\\]|\\.)*)"\s*\)/);
  return m ? m[1].replace(/\\"/g, '"') : "";
}

const ENRICHMENT_FIELDS = {
  inputUsd: {
    type: "decimal",
    label: { ko: "입력 USD 가치", en: "Input USD value" },
    appliesTo: ["swap"],
    method: "oracle.usd_value",
    projection: "$.result.usd",
    params: { chain_id: "$.root.chain_id", asset: "$.action.tokenIn.key.address", amount: "$.action.direction.amountIn" },
  },
  inputAmountNano: {
    type: "Long",
    label: { ko: "입력 토큰 수량 (nano)", en: "Input token amount (nano)" },
    appliesTo: ["swap"],
    method: "token.normalize_to_nano",
    projection: "$.result.nano",
    params: { amount: "$.action.direction.amountIn", chain_id: "$.root.chain_id", asset: "$.action.tokenIn.key.address" },
  },
};

const METHOD_CATALOG = [
  { method: "oracle.usd_value", type: "decimal", projection: "$.result.usd", label: { ko: "토큰 USD 가치 조회", en: "Token USD value" }, desc: { ko: "오라클 시세로 자산×수량의 USD 가치를 계산해요.", en: "USD value of asset×amount from the oracle." }, params: { chain_id: "$.root.chain_id", asset: "$.action.tokenIn.key.address", amount: "$.action.direction.amountIn" } },
  { method: "token.normalize_to_nano", type: "Long", projection: "$.result.nano", label: { ko: "토큰 수량 → nano 정규화", en: "Normalize amount to nano" }, desc: { ko: "토큰 소수점을 반영해 수량을 nano(×10⁹) 정수로 바꿔요.", en: "Convert amount to nano (×10⁹) using token decimals." }, params: { amount: "$.action.direction.amountIn", chain_id: "$.root.chain_id", asset: "$.action.tokenIn.key.address" } },
  { method: "address.risk_score", type: "Long", projection: "$.result.score", label: { ko: "주소 위험 점수", en: "Address risk score" }, desc: { ko: "상대 주소의 위험 점수(0–100)를 조회해요.", en: "Risk score (0–100) for the counterparty address." }, params: { chain_id: "$.root.chain_id", address: "$.action.spender" }, mock: true },
  { method: "intent.pending_exposure_usd", type: "decimal", projection: "$.result.usd", label: { ko: "미체결 노출 USD", en: "Pending exposure USD" }, desc: { ko: "이 지갑의 미체결 주문 노출을 USD로 합산해요.", en: "Sum of pending order exposure for this wallet in USD." }, params: { chain_id: "$.root.chain_id", wallet: "$.root.from" }, mock: true },
  { method: "token.price_change_24h", type: "decimal", projection: "$.result.pct", label: { ko: "24h 가격 변동률", en: "24h price change" }, desc: { ko: "자산의 24시간 가격 변동률(%)을 조회해요.", en: "24h price change (%) for the asset." }, params: { chain_id: "$.root.chain_id", asset: "$.action.tokenIn.key.address" }, mock: true },
];
function methodLabel(m) { return (m.label && m.label.ko) || m.method; }
function methodDesc(m) { return (m.desc && m.desc.ko) || ""; }

const snakeCase = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const projectionType = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function resolveParams(params) {
  const out = {};
  for (const [k, spec] of Object.entries(params)) out[k] = (spec && typeof spec === "object" && "literal" in spec) ? spec.literal : spec;
  return out;
}
function collectCustomFields(model) {
  const found = new Set();
  const PFX = "context.custom.";
  const visit = (nodes) =>
    nodes.forEach((n) => {
      if (isGroupNode(n)) return visit(n.conds);
      if (typeof n.fieldPath === "string" && n.fieldPath.startsWith(PFX)) found.add(n.fieldPath.slice(PFX.length));
      if (n.value && n.value.kind === "field" && typeof n.value.path === "string" && n.value.path.startsWith(PFX)) found.add(n.value.path.slice(PFX.length));
    });
  visit(model.when);
  visit(model.unless);
  return [...found];
}
function generateManifest(model, registry, overrides) {
  registry = registry || ENRICHMENT_FIELDS;
  overrides = overrides || {};
  const fields = collectCustomFields(model);
  if (fields.length === 0) return { manifest: undefined, errors: [] };
  const errors = [];
  const id = overrides.id;
  const severity = overrides.severity;
  const tag = model.trigger.kind === "actionEq" ? snakeCase(model.trigger.id) : undefined;
  if (!id) errors.push({ message: "정책 id가 비어 있어요" });
  if (!tag) errors.push({ message: "보강 필드는 단일 동작에만 쓸 수 있어요 — 먼저 동작을 하나 골라주세요" });
  const policyRpc = [];
  const customFields = {};
  for (const field of fields) {
    const entry = registry[field];
    if (!entry) { errors.push({ field, message: `보강 필드 '${field}'에 연결된 메서드가 없어요` }); continue; }
    if (tag && !entry.appliesTo.includes(tag)) { errors.push({ field, message: `'${field}'는 이 동작(${tag})에 쓸 수 없어요 — 지원: ${entry.appliesTo.join(", ")}` }); continue; }
    const required = severity === "deny";
    policyRpc.push({ id: field, method: entry.method, params: resolveParams(entry.params), outputs: [{ kind: "context", field, type: projectionType(entry.type), from: entry.projection, required }], optional: !required });
    customFields[field] = entry.type;
  }
  if (errors.length > 0) return { manifest: undefined, errors };
  return { manifest: { id, schema_version: 2, trigger: { where: { "action.tag": { eq: tag } } }, policy_rpc: policyRpc, custom_context: { fields: customFields } }, errors: [] };
}
function userFieldsFromManifest(manifest, actionTag) {
  const out = {};
  const m = manifest;
  if (!m || !Array.isArray(m.policy_rpc)) return out;
  const types = (m.custom_context && m.custom_context.fields) || {};
  for (const rpc of m.policy_rpc) {
    if (!rpc || typeof rpc.id !== "string" || typeof rpc.method !== "string") continue;
    if (rpc.id in ENRICHMENT_FIELDS) continue;
    const type = types[rpc.id];
    if (type !== "decimal" && type !== "Long" && type !== "Bool" && type !== "String") continue;
    const from = rpc.outputs && rpc.outputs[0] && rpc.outputs[0].from;
    out[rpc.id] = { type, label: { ko: rpc.id, en: rpc.id }, appliesTo: actionTag ? [actionTag] : [], method: rpc.method, projection: typeof from === "string" ? from : "$.result.value", params: rpc.params || {} };
  }
  return out;
}
const KIND_BY_TYPE = { decimal: "primitive.decimal", Long: "primitive.Long", Bool: "primitive.Bool", String: "primitive.String" };
function actionTagOf(trigger) {
  if (trigger.kind !== "actionEq") return null;
  return snakeCase(trigger.id);
}

const shortAddress = (a) => { a = String(a).trim(); return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; };
const AB_ENTRIES = [
  { address: "0xa3731f5e0a4c2b9d8e6f1a0b3c5d7e9f2a4bebec", name: "내 메인 지갑", kind: "wallet", sub: "내 지갑" },
  { address: "0x3d7e1f0a2b4c6d8e9f0a1b2c3d4e5f6a7b8c9d0e", name: "내 거래 지갑", kind: "wallet", sub: "내 지갑" },
  { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", name: "USDC", kind: "token", sub: "토큰" },
  { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", name: "WETH", kind: "token", sub: "토큰" },
  { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", name: "USDT", kind: "token", sub: "토큰" },
  { address: "0x6b175474e89094c44da98b954eedeac495271d0f", name: "DAI", kind: "token", sub: "토큰" },
  { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", name: "WBTC", kind: "token", sub: "토큰" },
  { address: "0x000000000022d473030f116ddee9f6b43ac78ba3", name: "Permit2", kind: "token", sub: "컨트랙트" },
];
const AB_MAP = new Map(AB_ENTRIES.map((e) => [e.address.toLowerCase(), e]));
const AddressBook = {
  lookup: (a) => AB_MAP.get(String(a).trim().toLowerCase()),
  suggestions: AB_ENTRIES,
};

function applyParams(model, params) {
  if (!params) return model;
  const apply = (nodes) =>
    nodes.map((n) => {
      if (isGroupNode(n)) return { ...n, conds: apply(n.conds) };
      if (n.param && params[n.param.name] !== undefined) {
        const pv = params[n.param.name];
        let value;
        if (Array.isArray(pv)) value = { kind: "set", values: pv };
        else if (typeof pv === "number") value = { kind: n.value.kind === "decimal" ? "decimal" : "long", value: n.value.kind === "decimal" ? String(pv) : pv };
        else if (typeof pv === "boolean") value = { kind: "bool", value: pv };
        else value = { ...n.value, kind: n.value.kind, value: pv };
        if (n.value.kind === "decimal") value = { kind: "decimal", value: String(pv) };
        else if (n.value.kind === "long") value = { kind: "long", value: Number(pv) };
        else if (n.value.kind === "set") value = { kind: "set", values: Array.isArray(pv) ? pv : [pv] };
        else if (n.value.kind === "bool") value = { kind: "bool", value: !!pv };
        else value = { kind: "string", value: String(pv) };
        return { ...n, value };
      }
      return n;
    });
  return { ...model, when: apply(model.when), unless: apply(model.unless) };
}

export const Cedar = {
  GLOSS,
  getGloss,
  fieldsForTrigger,
  KNOWN_ACTIONS,
  ACTION_GROUPS,
  operatorsFor,
  valueKindForField,
  isGroupNode,
  situationsOf,
  flattenSituations,
  normalizeSituations,
  moveCondTo,
  normalizeDecimal,
  isValidDecimal,
  findInvalidModelDecimals,
  serializeCedar,
  severityFromCedar,
  reasonFromCedar,
  applyParams,
  ENRICHMENT_FIELDS,
  METHOD_CATALOG,
  methodLabel,
  methodDesc,
  snakeCase,
  collectCustomFields,
  generateManifest,
  userFieldsFromManifest,
  KIND_BY_TYPE,
  actionTagOf,
  shortAddress,
  AddressBook,
  emptyFormModel: (id) => ({ trigger: { kind: "any" }, when: [], unless: [], id: id || "untitled-policy", severity: "warn", reason: "" }),
};
