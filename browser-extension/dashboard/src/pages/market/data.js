/* Scopeball Market — 데이터 레이어
   - 정책 121개 정규화
   - 도메인 색 매핑 (Cloudy Pond 베이스 3색 → 명도 단계로 12 구분)
   - 공식 패키지 큐레이션 (의도태그 기준, 런타임 계산 → 카운트 정직)
   - i18n / 검색 / 필터 / 정렬 / 게이팅

   SEED_REVIEWS는 이 모듈 안에 있다 — 원본 standalone 번들에서는 community에
   있었으나, aggregateRating이 그걸 참조하면서 data → community 단방향이
   필요했기 때문에 ES 모듈 그래프에선 여기로 흡수. community 쪽은 다시
   data에서 import 해서 쓴다.

   주의: glossary엔 publisher·rating·install 필드가 없음 → 소셜 지표는 만들지 않음.
   카탈로그 전체가 default_policies 큐레이션이므로 작성자=공식(official). */

import { MARKET_GLOSSARY } from "./glossary";

const G = MARKET_GLOSSARY;

// ── 도메인 표시 순서 (security 앵커 최상단, 이후 큰 도메인 순) ──
export const DOMAIN_ORDER = ["security", "swap", "perp", "lending", "nft", "airdrop",
                    "portfolio", "ammlp", "bridge", "sale", "staking", "gov"];

// ── 도메인 액센트색: 베이스 팔레트(Cyan/Sage/Slate)를 명도 단계로 ──
// family: trading=Cyan, safety/holding=Sage, assets/infra=Slate
export const DOMAIN_COLOR = {
  // Cyan family — 거래(trading)
  swap:      { family: "cyan",  hex: "#688186", soft: "#DCEAED", ink: "#2B3639" },
  perp:      { family: "cyan",  hex: "#485A5E", soft: "#CAE0E4", ink: "#2B3639" },
  ammlp:     { family: "cyan",  hex: "#85A4AB", soft: "#EDF4F6", ink: "#2B3639" },
  bridge:    { family: "cyan",  hex: "#A4C9D1", soft: "#EDF4F6", ink: "#485A5E" },
  // Sage family — 보안·보유(safety / holding)
  security:  { family: "sage",  hex: "#637E59", soft: "#EBF3E8", ink: "#283523" },
  portfolio: { family: "sage",  hex: "#7FA172", soft: "#EBF3E8", ink: "#283523" },
  staking:   { family: "sage",  hex: "#9CC58D", soft: "#F8F9F6", ink: "#44583D" },
  airdrop:   { family: "sage",  hex: "#44583D", soft: "#D9E9D3", ink: "#283523" },
  // Slate family — 자산·인프라(assets / infra)
  lending:   { family: "slate", hex: "#384455", soft: "#D7DBDF", ink: "#0D1118" },
  nft:       { family: "slate", hex: "#697485", soft: "#EFF0F2", ink: "#1B222C" },
  sale:      { family: "slate", hex: "#2A3441", soft: "#D7DBDF", ink: "#0D1118" },
  gov:       { family: "slate", hex: "#9099A5", soft: "#EFF0F2", ink: "#2A3441" }
};

// 도메인 아이콘 (단순 라인 패스, 24x24 viewBox)
export const DOMAIN_ICON = {
  swap:      "M7 7h11l-3-3M17 17H6l3 3",
  perp:      "M3 17l5-6 4 3 5-7 4 4",
  lending:   "M3 10h18M5 10v8h14v-8M9 14h6",
  security:  "M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z",
  nft:       "M4 4h16v16H4zM8 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3M4 16l5-4 4 3 3-2 4 3",
  airdrop:   "M12 3a6 6 0 016 6c0 3-6 9-6 9S6 12 6 9a6 6 0 016-6M12 21v-3",
  portfolio: "M21 12a9 9 0 11-9-9v9z",
  ammlp:     "M12 3c3 4 6 7 6 10a6 6 0 01-12 0c0-3 3-6 6-10z",
  bridge:    "M3 16c0-4 3-7 9-7s9 3 9 7M3 16v3M21 16v3M8 13v6M16 13v6",
  sale:      "M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8",
  staking:   "M4 18h16M6 18V9M10 18V6M14 18V11M18 18V8",
  gov:       "M5 21h14M6 21V9M18 21V9M4 9l8-5 8 5M9 13v4M15 13v4"
};

export { G };

// ── i18n ──
export function pick(node, locale) {
  if (!node) return "";
  return node[locale] != null ? node[locale] : (node.ko != null ? node.ko : node.en || "");
}
export function tChrome(path, locale) {
  const parts = path.split(".");
  let n = G.chrome;
  for (let i = 0; i < parts.length; i++) { n = n && n[parts[i]]; }
  return pick(n, locale);
}
export function domainName(key, locale) { return pick(G.domains[key], locale); }
export function intentMeta(key) { return G.intents[key]; }
export function intentTag(key, locale) {
  const m = G.intents[key]; if (!m) return "#" + key;
  return locale === "en" ? m.tag_en : m.tag_ko;
}
export function intentLabel(key, locale) { const m = G.intents[key]; return m ? pick(m, locale) : key; }
export function readinessMeta(key) { return G.chrome.readiness[key]; }
export function severityMeta(key) { return G.chrome.severity[key]; }

// ── 정책 정규화 ──
export const POLICIES = Object.keys(G.policies).map(function (slug) {
  const p = G.policies[slug];
  return {
    slug: slug,
    domain: p.domain,
    intents: p.intents || [],
    severity: p.severity,
    evalClass: p.evalClass,
    readiness: p.readiness,
    name: p.display_name,        // {en, ko}
    publisher: "official"        // 카탈로그 전체가 공식 큐레이션
  };
});
export const BY_SLUG = {};
POLICIES.forEach(function (p) { BY_SLUG[p.slug] = p; });

export function policiesByDomain(d) { return POLICIES.filter(function (p) { return p.domain === d; }); }
export function domainCount(d) { return policiesByDomain(d).length; }

// ── 공식 패키지 큐레이션 (의도/도메인 기준, 카운트는 실제 매칭으로) ──
function matchPolicies(crit) {
  return POLICIES.filter(function (p) {
    if (crit.domain && p.domain !== crit.domain) return false;
    if (crit.intents && !crit.intents.some(function (i) { return p.intents.indexOf(i) >= 0; })) return false;
    if (crit.domains && crit.domains.indexOf(p.domain) < 0) return false;
    return true;
  });
}
const PACKAGE_DEFS = [
  { id: "essentials", anchor: true,
    name: { ko: "지갑 보안 기본 세트", en: "Wallet Essentials" },
    tagline: { ko: "모든 지갑에 권장하는 필수 방어선", en: "The baseline defense every wallet should run" },
    crit: { domain: "security" }, intents: ["drainer", "phishing", "unlimited"] },
  { id: "swap-kit",
    name: { ko: "스왑 안전 키트", en: "Swap Safety Kit" },
    tagline: { ko: "슬리피지·샌드위치로부터 모든 스왑을 보호", en: "Shield every swap from slippage and sandwiches" },
    crit: { domain: "swap", intents: ["slippage", "sandwich"] }, intents: ["slippage", "sandwich"] },
  { id: "liq-pack",
    name: { ko: "청산 방어팩", en: "Liquidation Defense Pack" },
    tagline: { ko: "레버리지·담보 포지션을 급락에서 지킨다", en: "Keep leveraged positions safe through a crash" },
    crit: { intents: ["liquidation"] }, intents: ["liquidation"] },
  { id: "drainer-shield",
    name: { ko: "드레이너·피싱 차단팩", en: "Drainer & Phishing Shield" },
    tagline: { ko: "악성 승인과 위장 서명을 입구에서 차단", en: "Block malicious approvals and spoofed signatures at the door" },
    crit: { intents: ["drainer", "phishing"] }, intents: ["drainer", "phishing"] },
  { id: "approval-hygiene",
    name: { ko: "승인 위생팩", en: "Approval Hygiene Pack" },
    tagline: { ko: "무제한·방치 승인이라는 공격면을 정리", en: "Trim the attack surface of unlimited and stale approvals" },
    crit: { intents: ["approval", "unlimited"] }, intents: ["approval", "unlimited"] },
  { id: "stable-guard",
    name: { ko: "디페그·컴플라이언스 가드", en: "De-peg & Compliance Guard" },
    tagline: { ko: "스테이블 붕괴와 제재 위반을 동시에 감시", en: "Watch for de-pegs and sanctions in one set" },
    crit: { intents: ["depeg", "compliance"] }, intents: ["depeg", "compliance"] },
  { id: "discipline-guard",
    name: { ko: "수령자·거래규율 가드", en: "Recipient & Discipline Guard" },
    tagline: { ko: "잘못된 수령자와 충동 거래로부터 보호", en: "Guard against wrong recipients and impulsive trades" },
    crit: { intents: ["recipient", "overtrade"] }, intents: ["recipient", "overtrade"] }
];
export const PACKAGES = PACKAGE_DEFS.map(function (def) {
  const members = matchPolicies(def.crit);
  // readiness 비중
  const ready = members.filter(function (m) { return m.readiness === "ready"; }).length;
  // 대표 도메인 (가장 많이 등장)
  const domCount = {};
  members.forEach(function (m) { domCount[m.domain] = (domCount[m.domain] || 0) + 1; });
  const primaryDomain = Object.keys(domCount).sort(function (a, b) { return domCount[b] - domCount[a]; })[0] || "security";
  return {
    id: def.id, anchor: !!def.anchor, name: def.name, tagline: def.tagline,
    intents: def.intents, members: members, count: members.length,
    readyCount: ready, primaryDomain: primaryDomain, publisher: "official"
  };
}).filter(function (p) { return p.count > 0; });
export const PKG_BY_ID = {};
PACKAGES.forEach(function (p) { PKG_BY_ID[p.id] = p; });

// ── 검색: 의도태그가 도메인 경계를 넘어 결과를 모은다 ──
export function search(q, locale) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return { policies: POLICIES.slice(), packages: PACKAGES.slice(), matchedIntents: [] };
  const matchedIntents = Object.keys(G.intents).filter(function (k) {
    const m = G.intents[k];
    const hay = [m.en, m.ko, m.tag_en, m.tag_ko, k].join(" ").toLowerCase();
    return query.split(/\s+/).some(function (tok) { return hay.indexOf(tok) >= 0; });
  });
  function policyMatch(p) {
    if (matchedIntents.length && p.intents.some(function (i) { return matchedIntents.indexOf(i) >= 0; })) return true;
    const hay = [pick(p.name, "en"), pick(p.name, "ko"), p.slug, domainName(p.domain, "en"), domainName(p.domain, "ko")].join(" ").toLowerCase();
    return query.split(/\s+/).every(function (tok) { return hay.indexOf(tok) >= 0; });
  }
  const pols = POLICIES.filter(policyMatch);
  const pkgs = PACKAGES.filter(function (pk) {
    if (matchedIntents.length && pk.intents.some(function (i) { return matchedIntents.indexOf(i) >= 0; })) return true;
    const hay = [pick(pk.name, "en"), pick(pk.name, "ko")].join(" ").toLowerCase();
    return query.split(/\s+/).some(function (tok) { return hay.indexOf(tok) >= 0; });
  });
  return { policies: pols, packages: pkgs, matchedIntents: matchedIntents };
}

// ── 필터 (데이터에 있는 축만: readiness, severity) ──
export function applyFilters(list, f) {
  return list.filter(function (p) {
    if (f.readiness && f.readiness.length && f.readiness.indexOf(p.readiness) < 0) return false;
    if (f.severity && f.severity.length && f.severity.indexOf(p.severity) < 0) return false;
    if (f.intent && f.intent.length && !f.intent.some(function (i) { return p.intents.indexOf(i) >= 0; })) return false;
    if (f.domain && f.domain.length && f.domain.indexOf(p.domain) < 0) return false;
    return true;
  });
}

// ── 정렬: 즉시작동 우선 ──
const READY_RANK = { ready: 0, external: 1, soon: 2 };
export function sortForDisplay(list, mode) {
  const arr = list.slice();
  if (mode === "new") { arr.reverse(); return arr; }
  if (mode === "rating") {
    // 리뷰 있는 항목만 별점 내림차순, 리뷰 없는 항목은 뒤로 (0점으로 끌어올리지 않음)
    arr.sort(function (a, b) {
      const ra = ratingForPolicy(a.slug), rb = ratingForPolicy(b.slug);
      if (ra && rb) { if (rb.avg !== ra.avg) return rb.avg - ra.avg; return rb.count - ra.count; }
      if (ra && !rb) return -1;
      if (!ra && rb) return 1;
      return READY_RANK[a.readiness] - READY_RANK[b.readiness];
    });
    return arr;
  }
  arr.sort(function (a, b) {
    const d = READY_RANK[a.readiness] - READY_RANK[b.readiness];
    if (d) return d;
    return pick(a.name, "ko").localeCompare(pick(b.name, "ko"));
  });
  return arr;
}

// ── 게이팅: 준비중은 세트에 담을 수 없음 ──
export function canAddToSet(readiness) { return readiness !== "soon"; }

// ── 포함 패키지 조회 ──
export function packagesContaining(slug) {
  return PACKAGES.filter(function (pk) {
    return pk.members.some(function (m) { return m.slug === slug; });
  });
}

// ── Review 시드 (원래 community에 있던 것; 순환 회피 위해 data로 이동) ──
// { id, kind, verified, rating(1~5, verified만), body{ko,en}, author, policySlug, createdAt, helpful }
export const SEED_REVIEWS = [
  { id: "r1", kind: "verified", verified: true, rating: 5, author: "vault.eth", policySlug: "aave-hf-floor-warn", createdAt: "2026-05-28", helpful: 24,
    body: { ko: "HF 바닥 경고 덕분에 변동성 장에서 청산 직전 포지션을 정리했다. 임계값이 보수적이라 안심된다.", en: "The HF-floor warning let me trim a position right before liquidation in a volatile session. Conservative threshold — reassuring." } },
  { id: "r2", kind: "verified", verified: true, rating: 4, author: "0xharin", policySlug: "aave-hf-floor-warn", createdAt: "2026-05-19", helpful: 11,
    body: { ko: "유용하지만 가끔 너무 일찍 울린다. 임계값을 직접 조절할 수 있으면 좋겠다.", en: "Useful, though it sometimes fires too early. Wish the threshold were tunable." } },
  { id: "r3", kind: "verified", verified: true, rating: 5, author: "saltykimchi", policySlug: "air-permit-on-held-token-deny", createdAt: "2026-05-30", helpful: 31,
    body: { ko: "permit 드레인을 실제로 막아줬다. 서명 직전에 차단돼서 식은땀 흘렸다.", en: "Actually blocked a permit drain for me — stopped right at signing. Cold sweat." } },
  { id: "r4", kind: "verified", verified: true, rating: 5, author: "node_runner", policySlug: "air-permit-on-held-token-deny", createdAt: "2026-05-12", helpful: 9,
    body: { ko: "에어드랍 클레임 사칭 사이트에서 바로 작동했다. 필수.", en: "Triggered instantly on a fake claim site. Essential." } },
  { id: "r5", kind: "verified", verified: true, rating: 4, author: "frog.eth", policySlug: "nft-untrusted-blur-root-deny", createdAt: "2026-05-22", helpful: 7,
    body: { ko: "위조 마켓 서명을 잘 잡는다. 정상 Blur 거래엔 영향이 없었다.", en: "Catches spoofed market signatures well. No false positives on legit Blur trades." } },
  { id: "r6", kind: "verified", verified: true, rating: 5, author: "minteddao", policySlug: "unknown-blind-sign-warning", createdAt: "2026-05-26", helpful: 18,
    body: { ko: "블라인드 서명 경고는 모두가 켜야 한다. 하드웨어 지갑 쓸 때 특히.", en: "Everyone should enable the blind-sign warning, especially on a hardware wallet." } },
  { id: "r7", kind: "verified", verified: true, rating: 3, author: "lurking_anon", policySlug: "unknown-blind-sign-warning", createdAt: "2026-05-08", helpful: 4,
    body: { ko: "취지는 좋지만 dApp을 많이 쓰면 경고가 잦아 피로하다.", en: "Good intent, but heavy dApp users will see it a lot — alert fatigue." } },
  { id: "r8", kind: "verified", verified: true, rating: 4, author: "cowswapper", policySlug: "swap-price-impact-warn", createdAt: "2026-05-24", helpful: 14,
    body: { ko: "프라이스 임팩트를 서명 전에 숫자로 보여줘서 좋다. 얇은 풀에서 특히 유용.", en: "Shows price impact as a number before signing — great on thin pools." } },
  { id: "r9", kind: "verified", verified: true, rating: 5, author: "gasfeehater", policySlug: "gas-cost-usd-cap-deny", createdAt: "2026-05-29", helpful: 22,
    body: { ko: "가스비 상한 덕에 혼잡한 블록에서 말도 안 되는 수수료 트랜잭션을 막았다.", en: "The gas cap saved me from an absurd-fee transaction during a congested block." } },
  { id: "r10", kind: "verified", verified: true, rating: 4, author: "0xharin", policySlug: "nft-bid-weth-unlimited-warn", createdAt: "2026-05-15", helpful: 6,
    body: { ko: "무제한 WETH 입찰 승인을 경고해줘서 한도를 다시 설정했다.", en: "Warned me about an unlimited WETH bid approval — re-set it to a cap." } },
  { id: "r11", kind: "verified", verified: true, rating: 4, author: "merkletree", policySlug: "air-merkle-without-proof-warn", createdAt: "2026-05-10", helpful: 5,
    body: { ko: "증명 없는 클레임을 잡아낸다. 가끔 정상 클레임도 경고하지만 합리적.", en: "Catches proofless claims. Occasionally flags legit ones, but reasonable." } },
  { id: "r12", kind: "verified", verified: true, rating: 5, author: "chainhopper", policySlug: "bridge-target-not-allowlisted-deny", createdAt: "2026-05-27", helpful: 12,
    body: { ko: "허용목록 외 브릿지 타깃을 차단한다. 피싱 브릿지 UI에서 작동 확인.", en: "Blocks non-allowlisted bridge targets. Confirmed it works against a phishing bridge UI." } },
];

// 평가 작성 모달에서 고를 수 있는 정책(리뷰 없는 것 포함 → 빈 상태 시연)
export const REVIEWABLE_EXTRA = ["aave-emode-leverage-warn", "ammlp-remove-exit-asymmetry-warn"];

// ── 별점 집계 — SEED_REVIEWS 단일 출처 ──
// 리뷰 없으면 null 반환 — 숫자를 만들지 않는다.
export function aggregateRating(slugs) {
  const revs = SEED_REVIEWS.filter(function (r) { return r.rating && slugs.indexOf(r.policySlug) >= 0; });
  if (!revs.length) return null;
  const sum = revs.reduce(function (a, r) { return a + r.rating; }, 0);
  return { avg: sum / revs.length, count: revs.length };
}
export function ratingForPolicy(slug) { return aggregateRating([slug]); }
export function ratingForPackage(pkg) {
  return aggregateRating(pkg.members.map(function (m) { return m.slug; }));
}

// ── 버전 (단일 출처 시드 맵) — 정책 slug / 패키지 id → "vX.Y" ──
// 값 없는 항목은 버전 미표시. detail·카드·업데이트가 전부 이 맵에서만 읽는다.
export const VERSIONS = {
  // packages
  "essentials": "v2.3", "swap-kit": "v1.6", "liq-pack": "v2.0", "drainer-shield": "v2.1",
  "approval-hygiene": "v1.4", "stable-guard": "v1.1", "discipline-guard": "v1.0",
  // policies
  "aave-hf-floor-warn": "v1.5", "aave-borrow-fraction-warn": "v1.2", "aave-emode-leverage-warn": "v1.1",
  "aave-withdraw-hf-floor-deny": "v1.3", "aave-utilization-high-warn": "v1.0", "aave-oracle-stale-borrow-warn": "v1.1",
  "air-permit-on-held-token-deny": "v2.0", "air-merkle-without-proof-warn": "v1.2", "air-recipient-not-self-deny": "v1.4",
  "air-unknown-token-warn": "v1.1", "air-upfront-payment-warn": "v1.0",
  "ammlp-remove-exit-asymmetry-warn": "v1.0", "ammlp-uni-v3v4-out-of-range-warn": "v1.2", "ammlp-collect-recipient-not-self-deny": "v1.1",
  "bridge-target-not-allowlisted-deny": "v1.7", "bridge-min-out-haircut-warn": "v1.0", "bridge-permission-change-deny": "v1.3",
  "nft-untrusted-blur-root-deny": "v1.6", "nft-bid-weth-unlimited-warn": "v1.3", "nft-setapprovalforall-conduit-warn": "v1.2",
  "nft-seaport-wildcard-zone-deny": "v1.1",
  "gov-delegatee-allowlist-deny": "v1.0", "gov-redelegate-large-power-warn": "v1.1",
  "gas-cost-usd-cap-deny": "v1.4", "gas-cost-ratio-warn": "v1.2", "unknown-blind-sign-warning": "v2.2",
  "swap-price-impact-warn": "v1.8", "swap-permit2-spender-not-router-deny": "v1.3",
  "signature-chain-mismatch-permit-warn": "v1.1", "permit-allowance-horizon-warn": "v1.0",
  "market-order-verifyingcontract-spoof-deny": "v1.5", "multicall-hidden-approval-warn": "v1.2",
  "lp-commit-platform-allowlist-deny": "v1.0"
};
export function versionFor(id) { return VERSIONS[id] || null; }

// 편의: 원래 standalone 번들에서 window.Market.* 로 접근하던 헬퍼들
// 모인 namespace (옛 코드의 `Market.X` 호출을 새 import 형식으로 갈아끼우기
// 전, 동일 표면을 한 번에 받고 싶을 때).
export const Market = {
  G,
  DOMAIN_ORDER, DOMAIN_COLOR, DOMAIN_ICON,
  POLICIES, BY_SLUG, PACKAGES, PKG_BY_ID,
  pick, tChrome, domainName,
  intentMeta, intentTag, intentLabel,
  readinessMeta, severityMeta,
  policiesByDomain, domainCount,
  search, applyFilters, sortForDisplay,
  canAddToSet, packagesContaining,
  aggregateRating, ratingForPolicy, ratingForPackage,
  VERSIONS, versionFor,
};
