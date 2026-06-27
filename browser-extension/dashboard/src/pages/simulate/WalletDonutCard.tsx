/**
 * Step-1 wallet card — a donut of the wallet's token allocation with an
 * expandable token list, collapsible position/approval sections, and a bottom
 * "include in simulation" toggle. Ported from the simulation-frontend prototype
 * (Simulation.dc.html `WalletDonutCard`), adapted to the wizard's WalletStateView
 * + i18n. The non-embed (card-grid) variant only.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { WalletStateView } from "./types";

// DEEP categorical (무지개 제거): navy-300/lemon-300/red-300/stone-300/navy-200/navy-400
const ALLOC_COLORS = ["#6F91B8", "#F0DB7F", "#E4948B", "#AEB6C2", "#B6C5D8", "#294970"];

// CAIP-2 → 짧은 체인 이름. 같은 심볼(USDC 등)이 여러 체인에 있어 목록에 중복으로
// 보이던 걸 구분해 준다. 모르는 체인은 숫자 id 그대로.
const CHAIN_NAMES: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:10": "Optimism",
  "eip155:56": "BNB",
  "eip155:130": "Unichain",
  "eip155:137": "Polygon",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
  "eip155:43114": "Avalanche",
  "eip155:59144": "Linea",
};
function chainName(caip2?: string): string {
  if (!caip2) return "";
  return CHAIN_NAMES[caip2] ?? caip2.replace(/^eip155:/, "Chain ");
}

function short(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function WalletDonutCard({
  s,
  on = false,
  onToggle,
  embed = false,
}: {
  s: WalletStateView;
  /** Selection state — only meaningful for the step-1 selectable card. */
  on?: boolean;
  onToggle?: () => void;
  /** Read-only embed (step-2 "관련 상태" pane): no select toggle, scrolls. */
  embed?: boolean;
}) {
  const { t } = useTranslation("simulation");
  const [sel, setSel] = useState<string | null>(null);
  const [openPos, setOpenPos] = useState(false);
  const [openApr, setOpenApr] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const toggleRow = (id: string) =>
    setOpenRows((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const tokens = s.tokens.filter((tk) => (tk.usdNum ?? 0) > 0);
  const total = tokens.reduce((a, tk) => a + (tk.usdNum || 0), 0);
  const size = 118;
  const stroke = 14;
  // -4: 선택 시 stroke 가 +3 굵어져 viewBox 밖으로 넘쳐 도넛이 잘리던 문제 → 여유 패딩.
  const r = (size - stroke) / 2 - 4;
  const C = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let acc = 0;
  const segs = tokens.map((tk, i) => {
    const pct = total > 0 ? tk.usdNum! / total : 0;
    const g = { tk, pct, off: acc, color: ALLOC_COLORS[i % ALLOC_COLORS.length] };
    acc += pct;
    return g;
  });
  const selSeg = sel != null ? segs.find((g) => g.tk.symbol === sel) : null;
  // 같은 심볼(USDC 등)이 여러 체인에 흩어져 있어도, 심볼을 누르면 전부 선택된다.
  // 중앙엔 그 심볼 "하나"가 아니라 전체 합(비율·금액)을 보여준다.
  const selGroup = sel != null ? segs.filter((g) => g.tk.symbol === sel) : [];
  const selPct = selGroup.reduce((a, g) => a + g.pct, 0);
  const selUsd = selGroup.reduce((a, g) => a + (g.tk.usdNum || 0), 0);
  const pick = (sym: string) => setSel((prev) => (prev === sym ? null : sym));

  const perps = s.positions.filter((p) => p.kind === "perp");
  const lends = s.positions.filter((p) => p.kind !== "perp");

  const kv = (label: string, val: React.ReactNode) => (
    <div className="w1-kv">
      <span className="w1-kv-l">{label}</span>
      <span className="w1-kv-v">{val}</span>
    </div>
  );

  return (
    <div className={`w1-card${on ? " on" : ""}${embed ? " embed" : ""}`}>
      <div className="w1-head">
        <div className="w1-id">
          <b className="w1-name">{s.name}</b>
          <span className="w1-addr">{short(s.address)}</span>
        </div>
      </div>

      <div className="w1-body">
        {/* donut + token list */}
        <div className="w1-donutarea expanded">
          <div className="w1-donut">
            <svg className="w1-donut-svg" viewBox={`0 0 ${size} ${size}`}>
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--fog-200)" strokeWidth={stroke} />
              {segs.map((g, i) => (
                <circle
                  key={`${g.tk.symbol}-${g.tk.chain ?? ""}-${i}`}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={g.color}
                  strokeWidth={selSeg && selSeg.tk.symbol === g.tk.symbol ? stroke + 3 : stroke}
                  strokeDasharray={`${g.pct * C} ${C - g.pct * C}`}
                  strokeDashoffset={`${-g.off * C}`}
                  transform={`rotate(-90 ${cx} ${cy})`}
                  className={`w1-seg${sel && sel !== g.tk.symbol ? " dim" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => pick(g.tk.symbol)}
                />
              ))}
            </svg>
            <div className="w1-donut-center">
              {selSeg ? (
                <>
                  <span className="w1-c-sym">{selSeg.tk.symbol}</span>
                  <span className="w1-c-pct">{(selPct * 100).toFixed(1)}%</span>
                  <span className="w1-c-usd">
                    ${selUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </>
              ) : (
                <>
                  <span className="w1-c-total">
                    {s.portfolioUsd ?? `$${total.toLocaleString("en-US")}`}
                  </span>
                  <span className="w1-c-l">{t("wizard.state.totalAssets")}</span>
                </>
              )}
            </div>
          </div>
          <div className="w1-tlist-wrap open">
            <div className="w1-tlist-in">
              <div className="w1-tlist">
                {segs.map((g, i) => (
                  <button
                    key={`${g.tk.symbol}-${g.tk.chain ?? ""}-${i}`}
                    type="button"
                    className={`w1-trow${sel === g.tk.symbol ? " on" : ""}`}
                    onClick={() => pick(g.tk.symbol)}
                  >
                    <span className="w1-trow-dot" style={{ background: g.color }} />
                    <span className="w1-trow-sym">{g.tk.symbol}</span>
                    {g.tk.chain && <span className="w1-trow-chain">{chainName(g.tk.chain)}</span>}
                    <span className="w1-trow-pct">{(g.pct * 100).toFixed(0)}%</span>
                    <span className="w1-trow-usd">{g.tk.usd}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* positions + approvals */}
        <div className="w1-cols">
          <div className="w1-side-sec">
            <button
              type="button"
              className="w1-side-head"
              onClick={() => setOpenPos((v) => !v)}
              aria-expanded={openPos}
            >
              <span className={`w1-side-chev${openPos ? " open" : ""}`}>›</span>
              <span className="w1-side-title">{t("wizard.state.positions")}</span>
              <span className="w1-side-n">{s.positions.length}</span>
            </button>
            {openPos &&
              (s.positions.length === 0 ? (
                <div className="w1-side-empty">{t("wizard.state.noPositions")}</div>
              ) : (
                <div className="w1-side-list">
                  {perps.map((p) => (
                    <div key={p.id} className="w1-prow">
                      <span className="w1-prow-name">{p.label}</span>
                      {p.side && (
                        <span className={`sd-side ${p.side}`}>
                          {p.side === "long" ? t("wizard.state.long") : t("wizard.state.short")}
                        </span>
                      )}
                      {p.leverage && <span className="sd-lev">{p.leverage}</span>}
                      {p.pnlUsd && <span className={`w1-prow-pnl ${p.pnlSign ?? "up"}`}>{p.pnlUsd}</span>}
                    </div>
                  ))}
                  {lends.map((p) => (
                    <div key={p.id} className="w1-prow">
                      <span className="sd-lend-proto">{p.protocol}</span>
                      <span className="w1-prow-name">{p.label}</span>
                      {p.health && (
                        <span className={`sd-health${Number(p.health) < 1.5 ? " low" : ""}`}>HF {p.health}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>

          <div className="w1-side-sec">
            <button
              type="button"
              className="w1-side-head"
              onClick={() => setOpenApr((v) => !v)}
              aria-expanded={openApr}
            >
              <span className={`w1-side-chev${openApr ? " open" : ""}`}>›</span>
              <span className="w1-side-title">{t("wizard.state.approvals")}</span>
              <span className="w1-side-n">{s.approvals.length}</span>
            </button>
            {openApr &&
              (s.approvals.length === 0 ? (
                <div className="w1-side-empty">{t("wizard.state.noApprovals")}</div>
              ) : (
                <div className="w1-side-list">
                  {s.approvals.map((a) => {
                    const risk = a.risk ?? (a.unlimited ? "high" : "low");
                    const rl =
                      risk === "high"
                        ? t("wizard.state.riskHigh")
                        : risk === "med"
                          ? t("wizard.state.riskMed")
                          : t("wizard.state.riskLow");
                    const rid = `apr-${a.id}`;
                    const ro = openRows.has(rid);
                    return (
                      <div key={a.id} className={`w1-arow-wrap${ro ? " open" : ""}`}>
                        <button
                          type="button"
                          className="w1-arow"
                          onClick={() => toggleRow(rid)}
                          aria-expanded={ro}
                        >
                          <span className="w1-arow-tok">{a.token}</span>
                          <span className="w1-arow-arrow">→</span>
                          <span className="w1-arow-spend">{a.spender}</span>
                          <span className={`sd-risk ${risk}`}>{rl}</span>
                          <span className={`w1-rowchev${ro ? " open" : ""}`}>›</span>
                        </button>
                        {ro && (
                          <div className="w1-rowdetail">
                            {kv(
                              t("wizard.state.spender"),
                              <code>{a.spenderAddress ? short(a.spenderAddress) : a.spender}</code>,
                            )}
                            {kv(t("wizard.state.allowance"), a.amount ?? (a.unlimited ? t("wizard.state.unlimited") : "—"))}
                            {kv(t("wizard.state.scope"), a.scope ?? "ERC-20")}
                            {kv(t("wizard.state.token"), <code>{a.tokenAddress ? short(a.tokenAddress) : a.token}</code>)}
                            {kv(t("wizard.state.grantedAt"), a.grantedAt ?? "—")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        </div>
      </div>

      {!embed && (
        <button
          type="button"
          className={`sw-selbar${on ? " on" : ""}`}
          onClick={onToggle}
          aria-pressed={on}
        >
          <span className="sw-selbar-tog">
            <span className="sw-selbar-tog-dot" />
          </span>
          <span className="sw-selbar-label">
            {on ? t("wizard.step1.included") : t("wizard.step1.include")}
          </span>
        </button>
      )}
    </div>
  );
}
