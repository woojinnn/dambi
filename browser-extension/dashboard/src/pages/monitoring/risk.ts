/**
 * Shared risk-overlay helpers for the Assets views (MonitoringPage + Assets2Page).
 *
 * Approval-risk classification, the per-wallet approval index, and Value-at-Risk
 * (VaR = min(allowance, balance) × price). Moved out of MonitoringPage verbatim
 * so both Assets pages compute risk identically from one source of truth.
 */

import {
  type ClassifiedApprovals,
  type DashboardWalletSummary,
  type TokenHolding,
} from "../../server-api";
import { chainOf, addressOf } from "./data";

// 평판 레지스트리(악성주소 차단·거래소 평판) 연결 여부.
// 현재 백엔드는 spender 라벨 카탈로그가 제거되어 UNLIMITED/OLD/EXPIRED만 내보냄.
// 레지스트리가 다시 연결되면 true로 바꾸면 BLOCKED(차단) 신호가 자동으로 살아남.
export const REPUTATION_CONNECTED = false;

// 승인 위험 태그 — 한글 라벨 + 설명(툴팁).
export const RISK_LABEL: Record<string, string> = {
  UNLIMITED: "무제한 승인",
  KNOWN_VENUE: "검증된 거래소",
  BLOCKED: "차단 대상",
  OLD: "오래된 승인",
  EXPIRED: "만료됨",
};
export const RISK_DESC: Record<string, string> = {
  UNLIMITED: "한도 없이 토큰을 꺼내갈 수 있는 승인 — 자산 전액이 노출됩니다.",
  KNOWN_VENUE: "검증된 거래소·프로토콜에 대한 승인 — 위험 낮음(정보).",
  BLOCKED: "차단 목록에 오른 악성/위험 주소에 대한 승인 — 즉시 철회 권장.",
  OLD: "오래 사용하지 않은 승인 — 정리 대상.",
  EXPIRED: "기한이 지난 승인.",
};

// 평판 레지스트리가 없으면 BLOCKED/KNOWN_VENUE(평판 의존 태그)는 표시하지 않음 — 온체인 태그만 남김.
export function visibleRisk(risk: string[]): string[] {
  if (REPUTATION_CONNECTED) return risk;
  return risk.filter((t) => t !== "BLOCKED" && t !== "KNOWN_VENUE");
}

export type RiskTag = "UNLIMITED" | "KNOWN_VENUE" | "BLOCKED" | "OLD" | "EXPIRED";

export interface ApprovalIndexEntry {
  chain: string;
  tokenAddr: string;
  spender: string;
  spenderLabel?: string;
  allowance: number; // Number, may be Infinity for unlimited
  risk: Set<RiskTag>;
}

/** Per-wallet, then `(chain|tokenAddr)` → list of approvals targeting it. */
export type ApprovalIndex = Map<string, ApprovalIndexEntry[]>;

export function buildApprovalIndexes(
  wallets: DashboardWalletSummary[],
  approvals: Array<ClassifiedApprovals | undefined>,
): Map<string, ApprovalIndex> {
  const out = new Map<string, ApprovalIndex>();
  wallets.forEach((w, i) => {
    const map: ApprovalIndex = new Map();
    const data = approvals[i];
    if (!data) {
      out.set(w.address, map);
      return;
    }
    const add = (e: ApprovalIndexEntry) => {
      const k = `${e.chain}|${e.tokenAddr}`;
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    };
    data.erc20.forEach((a) => {
      add({
        chain: a.chain,
        tokenAddr: a.token.toLowerCase(),
        spender: a.spender.toLowerCase(),
        spenderLabel: undefined,
        allowance: a.is_unlimited ? Infinity : Number(a.amount) || 0,
        risk: new Set(a.risk as RiskTag[]),
      });
    });
    data.permit2.forEach((a) => {
      add({
        chain: a.chain,
        tokenAddr: a.token.toLowerCase(),
        spender: a.spender.toLowerCase(),
        spenderLabel: undefined,
        allowance: Number(a.amount) || 0,
        risk: new Set(a.risk as RiskTag[]),
      });
    });
    data.set_for_all.forEach((a) => {
      add({
        chain: a.chain,
        tokenAddr: a.collection.toLowerCase(),
        spender: a.operator.toLowerCase(),
        spenderLabel: undefined,
        allowance: Infinity,
        risk: new Set(a.risk as RiskTag[]),
      });
    });
    out.set(w.address, map);
  });
  return out;
}

export function riskTagsFor(h: TokenHolding, idx?: ApprovalIndex): RiskTag[] {
  if (!idx) return [];
  const chain = chainOf(h);
  const addr = addressOf(h);
  if (!chain || !addr) return [];
  const entries = idx.get(`${chain}|${addr}`);
  if (!entries) return [];
  const tags = new Set<RiskTag>();
  entries.forEach((e) => e.risk.forEach((t) => tags.add(t)));
  return [...tags];
}

/** Raw on-chain integer amount (`balance.amount`, approval allowances) → human
 *  token units. The server stores amounts in base units (wei-like); the UI must
 *  divide by 10^decimals before display or USD/VaR math. */
export function toHuman(rawUnits: number, decimals: number): number {
  return decimals > 0 ? rawUnits / 10 ** decimals : rawUnits;
}

export function varOfHolding(h: TokenHolding, idx?: ApprovalIndex): number {
  if (!idx) return 0;
  const chain = chainOf(h);
  const addr = addressOf(h);
  if (!chain || !addr) return 0;
  const entries = idx.get(`${chain}|${addr}`);
  if (!entries) return 0;
  const balance = Number(h.balance.amount ?? "0");
  if (!isFinite(balance) || balance === 0) return 0;
  const price = h.price_usd ? Number(h.price_usd.value) : 0;
  if (price === 0) return 0;
  // VaR = sum over distinct spenders of min(allowance, balance) × price.
  // Sum is bounded by balance × price (an attacker can't move more than
  // the wallet holds, even across many spenders). `balance` and the approval
  // `allowance` are both raw base units (same decimals), so the min/cap is done
  // in base units and converted to human units once before applying the price.
  const exposureUnits = entries.reduce((s, e) => s + Math.min(e.allowance, balance), 0);
  const cappedUnits = Math.min(exposureUnits, balance);
  return toHuman(cappedUnits, h.decimals) * price;
}

// 위험 노출 — 심각도(점) + 노출 금액 + 대표 한마디. 온체인 신호로만 산정:
// 무제한 > (한도 노출 + 오래됨/만료) > 없음. BLOCKED(악성주소)는 평판
// 레지스트리가 연결된 경우(REPUTATION_CONNECTED)에만 'fail'로 승격.
export type ExpSeverity = "fail" | "warn" | "low" | "none";

export function expSeverity(tags: RiskTag[], varUsd: number): ExpSeverity {
  if (REPUTATION_CONNECTED && tags.includes("BLOCKED")) return "fail";
  if (tags.includes("UNLIMITED")) return "warn";
  if (varUsd > 0 || tags.includes("OLD") || tags.includes("EXPIRED")) return "low";
  return "none";
}
export function expLabel(tags: RiskTag[], varUsd: number): string {
  if (REPUTATION_CONNECTED && tags.includes("BLOCKED")) return "차단 대상";
  if (tags.includes("UNLIMITED")) return "무제한 승인";
  if (tags.includes("OLD")) return "오래된 승인";
  if (tags.includes("EXPIRED")) return "만료됨";
  if (varUsd > 0) return "한도 승인";
  return "";
}

export function riskScore(tags: RiskTag[]): number {
  if (tags.includes("BLOCKED")) return 0;
  if (tags.includes("UNLIMITED")) return 1;
  if (tags.includes("OLD") || tags.includes("EXPIRED")) return 2;
  return 3;
}
