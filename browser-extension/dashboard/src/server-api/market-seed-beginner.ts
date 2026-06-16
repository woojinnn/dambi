/**
 * ⚠️ 임시 시드 — PASU Beginner Pack V1 (Wallet Guardians 공식 docs 기반).
 * 출처: https://wallet-guardians.gitbook.io/wallet-guardians-docs/standard-packages/pasu-beginner-pack-v1
 *
 * 정책 서버(8788)에 아직 실제 listing 이 거의 없어 마켓 화면을 확인하기 위한
 * 데모용 데이터다. server-api/market 의 listListings/getListing 이 빈 결과를
 * 돌려줄 때만 폴백으로 끼워 넣는다(아래 mergeSeed). 실제 데이터가 올라오면
 * 이 파일과 호출부(market.ts 의 SEED 분기)를 통째로 지우면 된다.
 */
import type {
  ListingDetail,
  ListingDoc,
  ListingSummary,
  Review,
  SetMember,
} from "./market";

const RELEASED = Date.UTC(2026, 5, 10) / 1000; // 2026-06-10
const NOW = RELEASED;

/** 패키지에 묶인 정책 5종(문서 표 그대로). cedar_text 는 데모 placeholder. */
interface SeedPolicy {
  slug: string;
  code: string; // TOKEN-001 등 문서상 ID
  nameKo: string;
  nameEn: string;
  category: string;
  severity: "deny" | "warn";
  lineKo: string;
  lineEn: string;
  installs: number;
  /** 상세 페이지 "정책 설명"(정의/범위/대상/데이터). 없으면 섹션 숨김. */
  doc?: ListingDoc;
}

const POLICIES: SeedPolicy[] = [
  {
    slug: "unapproved-contract-token-max-approval",
    code: "TOKEN-001",
    nameKo: "미승인 컨트랙트 토큰 무제한 승인",
    nameEn: "Unapproved Contract Token Max Approval",
    category: "Token",
    severity: "warn",
    lineKo: "미승인 컨트랙트가 토큰 무제한 승인을 요청하면 경고합니다.",
    lineEn: "Warn when unapproved contracts request unlimited token approvals.",
    installs: 1280,
    doc: {
      definition: "승인되지 않은 컨트랙트가 ERC-20 승인(Approve)을 요청하는 경우 경고합니다.\n\n토큰(ERC-20) 사용을 승인하는 것은 Spender(토큰 사용자)에게 허용 금액만큼 내 토큰 사용 권한을 주는 것과 같습니다. 따라서 허가를 받지 않은 컨트랙트가 토큰을 무제한 승인 요청하는 경우 서명 전에 한 번 더 확인하도록 경고합니다.",
      scope: "승인되지 않은 컨트랙트가 ERC-20 무제한 승인 요청 시 적용됩니다.",
      audience: "ERC-20 토큰을 보유중인 모든 사용자",
      usedData: "승인하는 토큰의 양(context.amount)이 최대값인 경우 토큰 사용자(context.spender)가 승인 목록에 포함되었는지 확인합니다.",
    },
  },
  {
    slug: "swap-asset-redirect",
    code: "AMM-001",
    nameKo: "스왑 자산 리다이렉트",
    nameEn: "Swap Asset Redirect",
    category: "DEX",
    severity: "warn",
    lineKo: "스왑한 자산이 제3자에게 전송되면 경고합니다.",
    lineEn: "Alert if swap assets are sent to third parties.",
    installs: 940,
    doc: {
      definition: "Swap할 때 토큰을 수령할 주소가 제3자의 것으로 되어 있는 경우, 사용자가 수령할 주소를 검토할 수 있도록 경고합니다.\n\nSwap은 내가 보유한 토큰을 다른 토큰으로 교환하는 것을 말합니다. 이때 토큰을 받는 주소가 다른 주소로 지정되어 있을 수도 있기 때문에, 토큰을 받을 주소가 내 주소가 아닌 다른 것으로 되어 있으면 경고를 표시합니다.",
      scope: "AMM 기반의 DEX에서 Swap할 때 적용됩니다. (Beta: Uniswap Only)",
      audience: "DEX를 사용하는 모든 사용자",
      usedData: "서명에 사용할 지갑의 주소(principal.address)와 Swap을 통해 토큰을 받을 주소",
    },
  },
  {
    slug: "burn-address-transfer",
    code: "TOKEN-002",
    nameKo: "소각 주소 전송",
    nameEn: "Burn Address Transfer",
    category: "Token",
    severity: "warn",
    lineKo: "토큰이 소각 주소(0x00…00, 0x00…dead)로 전송되면 경고합니다.",
    lineEn: "Warn when tokens transfer to burn addresses.",
    installs: 760,
    doc: {
      definition: "토큰이 소각될 수 있는 주소로 전송되는 경우 차단합니다.\n\nERC-20 토큰 소각(Burning)은 토큰을 영구히 파괴하여 유통된 전체 토큰에서 특정 토큰의 수량 일부를 제거하는 행위입니다. 사용자가 소각 주소로 토큰을 전송하려고 하면 서명 자체를 차단합니다.",
      scope: "모든 ERC-20 transfer에 적용됩니다.",
      audience: "ERC-20 토큰을 보유중인 모든 사용자",
      usedData: "토큰을 받을 주소(context.recipient)가 토큰을 소각 시키는 지정된 주소인지 확인합니다.",
    },
  },
  {
    slug: "unapproved-marketplace-delegation",
    code: "NFT-001",
    nameKo: "미승인 마켓플레이스 위임",
    nameEn: "Unapproved Marketplace Delegation",
    category: "NFT",
    severity: "warn",
    lineKo: "미승인 마켓플레이스로 NFT 위임이 일어나면 경고합니다.",
    lineEn: "Alert on NFT delegation to unapproved marketplaces.",
    installs: 610,
    doc: {
      definition: "알려진 거래소 위임처가 아닌 곳에 컬렉션 전체를 옮길 권한을 주는 경우 경고를 표시합니다.\n\nNFT의 setApprovalForAll은 특정 토큰 하나가 아니라 그 컬렉션에 든 NFT 전부를 상대가 마음대로 옮길 수 있게 위임하는 것입니다. OpenSea나 Blur 같은 거래소에서 리스팅하려면 한 번씩 거쳐야 하는 정상적인 단계이지만, 같은 위임을 악의적인 사용자가 받아 가면 그 NFT 전부를 가져갈 수 있습니다. 그래서 알려지지 않은 곳에 위임을 할 경우, 정말 그 상대에게 컬렉션 전체를 맡길 것인지 한 번 더 확인하도록 알립니다.",
      scope: "NFT의 setApprovalForAll 서명에 적용됩니다. 새로운 권한 위임이면서, 받아 가는 주소가 알려진 거래소(OpenSea Conduit, Blur ExecutionDelegate, LooksRare v2 TransferManager, X2Y2 ERC721Delegate)가 아닐 때 발동합니다.",
      audience: "NFT를 보유하고 거래를 하는 모든 Wallet 사용자",
      usedData: "* 새로운 권한 위임 여부\n* 위임을 받아 가는 위임처 주소",
    },
  },
  {
    slug: "unsupported-protocol",
    code: "OTHER-001",
    nameKo: "미지원 프로토콜",
    nameEn: "Unsupported Protocol",
    category: "Others",
    severity: "warn",
    lineKo: "미지원 프로토콜로 서명 요청이 오면 경고합니다.",
    lineEn: "Warn if signing requests use unsupported protocols.",
    installs: 430,
    doc: {
      definition: "PASU에서 지원하지 않는 행위 또는 프로토콜의 요청에 서명하는 경우 경고를 표시합니다.\n\nPASU 시스템은 지속적인 업데이트가 예정되어 있지만, 현실적인 문제로 인하여 TVL이 작거나 출시된 지 얼마 되지 않은 프로토콜까지는 모두 곧바로 지원하지 못할 수 있습니다. 이 경우, 안전한 거래를 위해 사용자가 직접 거래 대상을 검토하여야 하므로 이 서명은 PASU의 보호 범위 외에 있음을 명시하는 경고를 표시합니다.",
      scope: "PASU 지원 범위 외",
      audience: "PASU 사용자",
    },
  },
  // ── [Token] Beginner Shield 전용 신규 정책 3종 (Wallet Guardians docs) ──
  {
    slug: "token-self-contract-transfer-warn",
    code: "TOKEN-003",
    nameKo: "토큰 컨트랙트 자기 전송",
    nameEn: "Token Contract Self-Transfer",
    category: "Token",
    severity: "warn",
    lineKo: "토큰을 그 토큰의 컨트랙트 주소로 보내면 경고합니다.",
    lineEn: "Warn when tokens are sent to their own contract address.",
    installs: 540,
    doc: {
      definition: "토큰을 그 토큰 자신의 컨트랙트 주소로 전송하는 경우 경고합니다.\n\n토큰 주소와 받는 사람 주소를 헷갈려, 보내려는 토큰의 컨트랙트 주소를 수신자 칸에 그대로 붙여넣는 실수가 발생할 수 있습니다. 대부분의 ERC-20 컨트랙트는 이렇게 들어온 토큰을 돌려주는 기능이 없어, 한 번 보내면 자산이 컨트랙트에 묶여버립니다. 토큰을 받는 주소가 바로 그 토큰의 컨트랙트 주소와 같으면 서명 전에 한 번 더 확인하도록 경고합니다.",
      scope: "토큰을 받는 주소가 전송하려는 토큰의 컨트랙트 주소와 같은 경우에 적용됩니다.",
      audience: "ERC-20 토큰을 보유중인 모든 사용자",
      usedData: "보내려는 토큰의 컨트랙트 주소(token.key.address)와 받는 주소(context.recipient)가 동일한지 확인합니다.",
    },
  },
  {
    slug: "permit2-max-signature-warn",
    code: "TOKEN-004",
    nameKo: "Permit2 최대 서명",
    nameEn: "Permit2 Maximum Signature",
    category: "Token",
    severity: "warn",
    lineKo: "Permit2 최대 한도 서명 요청이 오면 경고합니다.",
    lineEn: "Warn on maximum Permit2 allowance signing requests.",
    installs: 690,
    doc: {
      definition: "Permit2 승인을 무제한 한도로 서명하려는 경우 경고합니다.\n\nPermit2는 토큰 승인 방식으로, 서명 한 번으로 토큰 사용 권한을 위임합니다. 이때 한도를 최대치(무제한)로 설정하면, 위임받은 상대는 그 권한이 살아 있는 동안 내 토큰 잔액 전부를 언제든 옮길 수 있습니다. 무제한 서명이 감지되면 그 대상이 신뢰할 수 있는 대상인지 서명 전에 한 번 더 확인하도록 경고합니다.",
      scope: "Permit2 승인 한도가 최대치(uint160 max)로 설정된 경우에 적용됩니다.",
      audience: "ERC-20 토큰을 보유중인 모든 사용자",
      usedData: "Permit2 서명에 담긴 허용 한도(context.amount)가 최댓값인지 확인합니다.",
    },
  },
  {
    slug: "malicious-address-approval-deny",
    code: "TOKEN-005",
    nameKo: "악성 주소 승인 차단",
    nameEn: "Malicious Address Approval",
    category: "Token",
    severity: "deny",
    lineKo: "알려진 악성 주소로의 토큰 승인 요청을 차단합니다.",
    lineEn: "Block token approval requests to known malicious addresses.",
    installs: 820,
    doc: {
      definition: "악성으로 신고된 주소가 ERC-20 토큰 사용 권한(Approve)을 요청하는 경우, 서명을 차단합니다.\n\n토큰을 승인하면 그 대상(Spender)은 허용한 한도 안에서 언제든 내 토큰을 가져갈 수 있습니다. 악성 주소로 권한을 내어주는 순간 토큰이 드레인될 수 있으므로 서명 자체를 차단합니다.",
      scope: "승인 대상(Spender)이 악성 주소로 분류됐는지 조회해, 악성이라면 적용됩니다.",
      audience: "ERC-20 토큰을 보유중인 모든 사용자",
      usedData: "승인 대상(Spender) 주소의 악성 여부(spenderFlagged )를 확인합니다.",
    },
  },
];

const PACKAGE_SLUG = "pasu-beginner-pack-v1";

/** [Token] Beginner Shield — Wallet Guardians 공식 docs 기반 두 번째 데모 패키지.
 * 출처: .../standard-packages/market-offered-packages/erc-20/token (= [Token] 기본 정책 모음) */
const TOKEN_SHIELD_SLUG = "token-beginner-shield";
const TOKEN_SHIELD_MEMBERS = [
  "unapproved-contract-token-max-approval", // TOKEN-001 (재사용)
  "burn-address-transfer", // TOKEN-002 (재사용)
  "token-self-contract-transfer-warn", // TOKEN-003
  "permit2-max-signature-warn", // TOKEN-004
  "malicious-address-approval-deny", // TOKEN-005
];

function seedCedar(p: SeedPolicy): string {
  return `// ${p.code} — ${p.nameEn}\n// severity: ${p.severity}\n// (데모 placeholder — 실제 Cedar 원문은 게시 시 주입됩니다)\npermit (\n  principal,\n  action == Action::"signTransaction",\n  resource\n) when {\n  context.flagged == true\n};`;
}

function policySummary(p: SeedPolicy): ListingSummary {
  return {
    id: `seed-${p.slug}`,
    slug: p.slug,
    kind: "policy",
    publisher_id: "seed-wallet-guardians",
    publisher_tier: "official",
    publisher_email: undefined,
    display_name: { en: p.nameEn, ko: p.nameKo },
    description: { en: p.lineEn, ko: p.lineKo },
    doc: p.doc,
    category: p.category,
    severity: p.severity,
    status: "published",
    current_version: "1.0.0",
    created_at: RELEASED,
    updated_at: NOW,
    install_count: p.installs,
    rating_avg: 4.8,
    rating_count: 36,
    is_installed: false,
  };
}

function packageSummary(): ListingSummary {
  return {
    id: `seed-${PACKAGE_SLUG}`,
    slug: PACKAGE_SLUG,
    kind: "set",
    publisher_id: "seed-wallet-guardians",
    publisher_tier: "official",
    publisher_email: undefined,
    display_name: { en: "PASU Beginner Pack V1", ko: "PASU 입문자 팩 V1" },
    description: {
      en: "Protection package for Web3 newcomers — token approvals, transfers, swaps, and NFT trading.",
      ko: "Web3 입문자를 위한 보호 패키지 — 토큰 승인·전송·스왑·NFT 거래를 한 번에 지킵니다.",
    },
    status: "published",
    current_version: "1.0.0",
    created_at: RELEASED,
    updated_at: NOW,
    install_count: 2150,
    rating_avg: 4.9,
    rating_count: 58,
    is_installed: false,
  };
}

function tokenShieldSummary(): ListingSummary {
  return {
    id: `seed-${TOKEN_SHIELD_SLUG}`,
    slug: TOKEN_SHIELD_SLUG,
    kind: "set",
    publisher_id: "seed-wallet-guardians",
    publisher_tier: "official",
    publisher_email: undefined,
    display_name: { en: "[Token] Beginner Shield", ko: "[Token] 기본 정책 모음" },
    description: {
      en: "Prevents common mistakes by new Web3 users during token approvals, transfers, and signatures.",
      ko: "Web3에 갓 입문한 사용자가 첫 승인·첫 송금·첫 서명 시 겪을 수 있는 사고를 방지합니다.",
    },
    status: "published",
    current_version: "1.0.0",
    created_at: RELEASED,
    updated_at: NOW,
    install_count: 1640,
    rating_avg: 4.8,
    rating_count: 41,
    is_installed: false,
  };
}

const SEED_REVIEWS: Review[] = [
  {
    id: "seed-rev-1",
    listing_id: `seed-${PACKAGE_SLUG}`,
    user_id: "seed-user-1",
    version: "1.0.0",
    rating: 5,
    body: {
      en: "Great starter pack — caught an unlimited approval right away.",
      ko: "입문용으로 딱이에요. 무제한 승인을 바로 잡아줬습니다.",
    },
    helpful_count: 24,
    created_at: NOW,
  },
  {
    id: "seed-rev-2",
    listing_id: `seed-${PACKAGE_SLUG}`,
    user_id: "seed-user-2",
    version: "1.0.0",
    rating: 5,
    body: { en: "Low false positives, easy to set up.", ko: "오탐도 거의 없고 설정이 쉬워요." },
    helpful_count: 11,
    created_at: NOW,
  },
];

const TOKEN_SHIELD_REVIEWS: Review[] = [
  {
    id: "seed-ts-rev-1",
    listing_id: `seed-${TOKEN_SHIELD_SLUG}`,
    user_id: "seed-user-3",
    version: "1.0.0",
    rating: 5,
    body: {
      en: "Perfect for my first wallet — blocked a malicious approval on day one.",
      ko: "첫 지갑에 딱이에요. 첫날 악성 승인을 바로 막아줬습니다.",
    },
    helpful_count: 18,
    created_at: NOW,
  },
  {
    id: "seed-ts-rev-2",
    listing_id: `seed-${TOKEN_SHIELD_SLUG}`,
    user_id: "seed-user-4",
    version: "1.0.0",
    rating: 4,
    body: {
      en: "Good basics. The Permit2 warning saved me once.",
      ko: "기본기가 탄탄해요. Permit2 경고 덕분에 한 번 살았습니다.",
    },
    helpful_count: 7,
    created_at: NOW,
  },
];

/** 주어진 slug 목록을 SetMember[] 로(순서 유지, 없는 slug 는 스킵). */
function membersFor(slugs: string[]): SetMember[] {
  return slugs
    .map((s) => POLICIES.find((p) => p.slug === s))
    .filter((p): p is SeedPolicy => !!p)
    .map((p) => ({
      slug: p.slug,
      display_name: p.nameKo,
      cedar_text: seedCedar(p),
      manifest: undefined,
    }));
}

/** PASU Beginner Pack 멤버 = 처음 정의된 5종(기존 동작 유지). */
const BEGINNER_PACK_MEMBERS = [
  "unapproved-contract-token-max-approval",
  "swap-asset-redirect",
  "burn-address-transfer",
  "unapproved-marketplace-delegation",
  "unsupported-protocol",
];

/** 시드 listing 요약 전체(패키지 2종 + 정책 전부). */
export function seedListings(): ListingSummary[] {
  return [packageSummary(), tokenShieldSummary(), ...POLICIES.map(policySummary)];
}

/** slug 로 시드 상세를 찾는다(없으면 null). */
export function seedDetail(slug: string): ListingDetail | null {
  if (slug === PACKAGE_SLUG) {
    return {
      ...packageSummary(),
      latest_version: {
        listing_id: `seed-${PACKAGE_SLUG}`,
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        members: membersFor(BEGINNER_PACK_MEMBERS),
        published_at: RELEASED,
      },
      recent_reviews: SEED_REVIEWS,
    };
  }
  if (slug === TOKEN_SHIELD_SLUG) {
    return {
      ...tokenShieldSummary(),
      latest_version: {
        listing_id: `seed-${TOKEN_SHIELD_SLUG}`,
        version: "1.0.0",
        major: 1,
        minor: 0,
        patch: 0,
        members: membersFor(TOKEN_SHIELD_MEMBERS),
        published_at: RELEASED,
      },
      recent_reviews: TOKEN_SHIELD_REVIEWS,
    };
  }
  const p = POLICIES.find((x) => x.slug === slug);
  if (!p) return null;
  return {
    ...policySummary(p),
    latest_version: {
      listing_id: `seed-${p.slug}`,
      version: "1.0.0",
      major: 1,
      minor: 0,
      patch: 0,
      cedar_text: seedCedar(p),
      published_at: RELEASED,
    },
    recent_reviews: [],
  };
}
