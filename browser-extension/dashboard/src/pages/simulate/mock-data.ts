/**
 * Fixtures for the /simulate wizard's MockProvider. Everything the UI needs is
 * fabricated here so the whole 4-step flow is clickable before any backend is
 * wired. Shapes match {@link types} exactly, so the RealProvider can later drop
 * in by producing the same view-models.
 *
 * The deny diagram uses a REAL PolicyIR + the canonical `enumeratePaths` scheme,
 * so the red "어디가 막혔는지" highlight is genuine (not a picture).
 */

import type { Expr, PolicyIR } from "../../cedar/blocks/ir";
import { enumeratePaths } from "../../cedar/diagnosis/path";

import type {
  PackageView,
  PolicyView,
  RunResult,
  TxRow,
  WalletStateView,
  WalletView,
} from "./types";

// ── known mainnet tokens (address ⇄ symbol) ────────────────────────────────
export const TOKENS = {
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  DAI: "0x6b175474e89094c44da98b954eedeac495271d0f",
  WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  LINK: "0x514910771af9ca656af840dff83e8264ecf986ca",
} as const;

const SYMBOL_BY_ADDR: Record<string, string> = Object.fromEntries(
  Object.entries(TOKENS).map(([sym, addr]) => [addr, sym]),
);

/** Address → "SYMBOL(0xabcd…wxyz)" for diagram chip labels. */
export function humanizeAddr(text: string): string {
  return text.replace(/0x[a-fA-F0-9]{40}/g, (m) => {
    const sym = SYMBOL_BY_ADDR[m.toLowerCase()];
    const short = `${m.slice(0, 6)}…${m.slice(-4)}`;
    return sym ? `${sym}(${short})` : m;
  });
}

// ── wallets ─────────────────────────────────────────────────────────────────
const W_BUJA = "0x1111111111111111111111111111111111111111";
const W_PLAIN = "0x2222222222222222222222222222222222222222";

export const MOCK_WALLETS: WalletView[] = [
  { address: W_BUJA, name: "부자성준", chains: ["eip155:1"] },
  { address: W_PLAIN, name: "일반지갑", chains: ["eip155:1", "eip155:42161"] },
];

// ── per-wallet state (s0) ────────────────────────────────────────────────────
function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}
function holding(
  symbol: keyof typeof TOKENS,
  balance: string,
  usdNum: number,
  extra?: { priceUsd?: string; committed?: string },
) {
  return {
    symbol,
    address: TOKENS[symbol],
    balance,
    usd: usd(usdNum),
    usdNum,
    chain: "eip155:1",
    ...extra,
  };
}

export const MOCK_STATES: Record<string, WalletStateView> = {
  [W_BUJA]: {
    address: W_BUJA,
    name: "부자성준",
    portfolioUsd: usd(73_450),
    tokens: [
      holding("WBTC", "0.45", 29_250, { priceUsd: "$65,000", committed: "0.00" }),
      holding("WETH", "8.20", 28_700, { priceUsd: "$3,500", committed: "0.50" }),
      holding("USDC", "12,500.00", 12_500, { priceUsd: "$1.00", committed: "1,000.00" }),
      holding("USDT", "3,000.00", 3_000, { priceUsd: "$1.00", committed: "0.00" }),
    ],
    positions: [
      {
        id: "p-hl-1",
        label: "BTC-PERP",
        protocol: "hyperliquid",
        kind: "perp",
        side: "long",
        leverage: "2x",
        sizeUsd: usd(58_400),
        entryPrice: "$62,100",
        markPrice: "$64,250",
        pnlUsd: "+$1,240",
        pnlSign: "up",
        liqPrice: "$41,800",
        marginUsd: usd(29_200),
        roe: "+4.2%",
      },
      {
        id: "p-hl-2",
        label: "ETH-PERP",
        protocol: "hyperliquid",
        kind: "perp",
        side: "short",
        leverage: "5x",
        sizeUsd: usd(17_500),
        entryPrice: "$3,420",
        markPrice: "$3,500",
        pnlUsd: "-$410",
        pnlSign: "down",
        liqPrice: "$3,910",
        marginUsd: usd(3_500),
        roe: "-11.7%",
      },
      {
        id: "p-aave-1",
        label: "WETH 담보 대출",
        protocol: "aave",
        kind: "lending",
        sizeUsd: usd(9_800),
        health: "1.82",
        collateralUsd: usd(17_500),
        debtUsd: usd(7_700),
      },
    ],
    approvals: [
      {
        id: "a1",
        token: "USDC",
        spender: "Uniswap V3",
        spenderAddress: "0xe592427a0aece92de3edee1f18e0157c05861564",
        unlimited: true,
        amount: "무제한",
        risk: "high",
        scope: "ERC-20",
        tokenAddress: TOKENS.USDC,
        grantedAt: "2024-09-12",
        riskReason: "무제한 한도 — 스펜더가 잔액 전부를 인출할 수 있어요",
      },
      {
        id: "a2",
        token: "WETH",
        spender: "Aave V3",
        spenderAddress: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
        unlimited: false,
        amount: "10.0",
        risk: "low",
        scope: "ERC-20",
        tokenAddress: TOKENS.WETH,
        grantedAt: "2024-10-01",
        riskReason: "한도가 잔액 수준으로 제한됨 — 검증된 프로토콜",
      },
      {
        id: "a4",
        token: "USDT",
        spender: "0x알수없는컨트랙트",
        spenderAddress: "0x000000000000c2e074ec69a0dfb2997ba6c7d2e1",
        unlimited: true,
        amount: "무제한",
        risk: "high",
        scope: "ERC-20",
        tokenAddress: TOKENS.USDT,
        grantedAt: "2024-11-02",
        riskReason: "미확인 컨트랙트에 무제한 승인 — 즉시 회수 권장",
      },
    ],
  },
  [W_PLAIN]: {
    address: W_PLAIN,
    name: "일반지갑",
    portfolioUsd: usd(1_760),
    tokens: [
      holding("LINK", "85.00", 1_190, { priceUsd: "$14.00", committed: "0.00" }),
      holding("USDC", "420.00", 420, { priceUsd: "$1.00", committed: "0.00" }),
      holding("DAI", "150.00", 150, { priceUsd: "$1.00", committed: "0.00" }),
    ],
    positions: [],
    approvals: [
      {
        id: "a3",
        token: "DAI",
        spender: "Curve",
        spenderAddress: "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
        unlimited: true,
        amount: "무제한",
        risk: "high",
        scope: "ERC-20",
        tokenAddress: TOKENS.DAI,
        grantedAt: "2024-08-20",
        riskReason: "무제한 한도 — 사용 안 하면 회수 권장",
      },
    ],
  },
};

// ── policies ─────────────────────────────────────────────────────────────────
export const MOCK_POLICIES: PolicyView[] = [
  {
    id: "swap-token-allowlist",
    name: "스왑 토큰 화이트리스트 (부자성준)",
    action: "Amm::Swap",
    tokens: ["USDC", "USDT", "WETH", "DAI", "WBTC", "LINK"],
    protocols: [],
    walletAddress: W_BUJA,
  },
  { id: "large-transfer-block", name: "대량 송금 차단", action: "Token::Erc20Transfer", tokens: ["USDC", "USDT"], protocols: [] },
  { id: "unlimited-approve-warn", name: "무제한 승인 경고", action: "Token::Erc20Approve", tokens: [], protocols: [] },
  { id: "perp-leverage-cap", name: "레버리지 상한 (Hyperliquid)", action: "Perp::PlaceOrder", tokens: [], protocols: ["hyperliquid"] },
  { id: "aave-withdraw-guard", name: "Aave 출금 제한", action: "Lending::Withdraw", tokens: ["WETH"], protocols: ["aave"] },
  { id: "blind-sign-warn", name: "블라인드 서명 경고", action: "Token::Erc20Permit", tokens: [], protocols: [] },
];

export const MOCK_PACKAGES: PackageView[] = [
  { id: "pkg-safe", name: "기본 안전팩", policyIds: ["large-transfer-block", "unlimited-approve-warn", "blind-sign-warn"] },
  { id: "pkg-defi", name: "DeFi 보호팩", policyIds: ["perp-leverage-cap", "aave-withdraw-guard"] },
];

/** Initially "선택된" policies (what the real getEnabledPolicyIds would seed). */
export const MOCK_ENABLED_IDS = ["swap-token-allowlist", "large-transfer-block", "unlimited-approve-warn"];

/**
 * Per-wallet enabled policy ids. Policies are now managed PER WALLET (the
 * redesign), so each registered wallet carries its own on/off set. The
 * RealProvider would seed this from `getEnabledPolicyIds(walletAddress)`.
 */
export const MOCK_ENABLED_BY_WALLET: Record<string, string[]> = {
  [W_BUJA]: ["swap-token-allowlist", "large-transfer-block", "unlimited-approve-warn", "perp-leverage-cap"],
  [W_PLAIN]: ["unlimited-approve-warn"],
};

// ── transaction queue ─────────────────────────────────────────────────────────
export const MOCK_TX_ROWS: TxRow[] = [
  {
    id: "tx-1",
    label: "USDC 송금 1,000",
    fromWallet: W_BUJA,
    to: "0xbeef000000000000000000000000000000000001",
    calldata: "0xa9059cbb…",
    value: "0",
  },
  {
    id: "tx-2",
    label: "USDT → WETH 스왑",
    fromWallet: W_BUJA,
    to: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    calldata: "0x5ae401dc…",
    value: "0",
  },
];

// ── deny diagram: a real PolicyIR (forbid Swap when tokenIn ∈ allowlist) ──────
const attr = (of: Expr, name: string): Expr => ({ kind: "attr", of, attr: name });
const ctx = (path: string): Expr =>
  path.split(".").reduce<Expr>((e, p) => attr(e, p), { kind: "var", name: "context" });

const ALLOWLIST = ["USDC", "USDT", "WETH", "DAI", "WBTC", "LINK"] as const;

/** forbid(Amm::Swap) when [allowlist].contains(context.tokenIn.key.address) */
export const SWAP_ALLOWLIST_IR: PolicyIR = {
  kind: "policy",
  effect: "forbid",
  annotations: [{ name: "id", value: "swap-token-allowlist" }],
  scope: {
    principal: { kind: "scopeAll" },
    action: { kind: "scopeEq", entity: { type: "Amm::Action", id: "Swap" } },
    resource: { kind: "scopeAll" },
  },
  conditions: [
    {
      kind: "when",
      body: {
        kind: "binary",
        op: "contains",
        left: { kind: "set", elements: ALLOWLIST.map((s) => ({ kind: "lit", litType: "string", value: TOKENS[s] })) },
        right: ctx("tokenIn.key.address"),
      },
    },
  ],
};

/** The canonical path of the set element matching `addr` — the chip to trace red. */
function memberPath(ir: PolicyIR, addr: string): string {
  const hit = enumeratePaths(ir).find((p) => p.node.kind === "lit" && String(p.node.value).toLowerCase() === addr);
  return hit?.path ?? "";
}

// Step 2 (USDT→WETH swap) is blocked because tokenIn USDT is on the allowlist.
const USDT_HIGHLIGHT = [memberPath(SWAP_ALLOWLIST_IR, TOKENS.USDT)];

// ── run result: s0 → s1 → s2 with one pass + one deny ────────────────────────
function delta(base: WalletStateView, tokens: { symbol: string; newBalance: string }[]): WalletStateView {
  const map = new Map(tokens.map((t) => [t.symbol, t.newBalance]));
  return { ...base, tokens: base.tokens.map((t) => (map.has(t.symbol) ? { ...t, balance: map.get(t.symbol)! } : t)) };
}

const buja0 = MOCK_STATES[W_BUJA];
const plain0 = MOCK_STATES[W_PLAIN];

// s1: tx-1 USDC 1,000 송금 → 부자성준 USDC 12,500 → 11,500
const buja1 = delta(buja0, [{ symbol: "USDC", newBalance: "11,500.00" }]);
// s2: tx-2 swap DENIED → state unchanged from s1
const buja2 = buja1;

export const MOCK_RUN: RunResult = {
  wallets: [W_BUJA, W_PLAIN],
  histories: {
    [W_BUJA]: [buja0, buja1, buja2],
    [W_PLAIN]: [plain0, plain0, plain0],
  },
  steps: [
    {
      index: 1,
      rowId: "tx-1",
      fromWallet: W_BUJA,
      label: "USDC 송금 1,000",
      verdict: "pass",
      diff: { tokens: [{ symbol: "USDC", delta: "-1,000.00", sign: "down" }], gas: "0.0012 ETH" },
      denies: [],
    },
    {
      index: 2,
      rowId: "tx-2",
      fromWallet: W_BUJA,
      label: "USDT → WETH 스왑",
      verdict: "fail",
      diff: { tokens: [], note: "정책 차단으로 상태 변화 없음" },
      denies: [
        {
          policyId: "swap-token-allowlist",
          policyName: "스왑 토큰 화이트리스트 (부자성준)",
          reason: "입력 토큰 USDT 가 차단 목록에 있어 스왑이 거부되었습니다",
          severity: "deny",
          step: 2,
          ir: SWAP_ALLOWLIST_IR,
          highlightPaths: USDT_HIGHLIGHT,
        },
      ],
    },
  ],
};
