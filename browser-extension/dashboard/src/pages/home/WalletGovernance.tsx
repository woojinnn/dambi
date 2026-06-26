/**
 * Wallet-dial governance — the Home centerpiece.
 *
 *   ┌ WalletDial (left) ┐   ┌ WalletPanel (right) ──────────────┐
 *   │  vertical card     │   │ folder(package) ▸ policy ▸ param  │
 *   │  dial, drag/step    │   │ package on/off  → setPackageEnabled
 *   └────────────────────┘   │ param   on/off  → updateBinding   │
 *   click active card → WalletOverview (all-wallets grid)        │
 *
 * Ported from the Home.html prototype. The dial physics are imperative
 * (refs + rAF) like the prototype; everything else is React state.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  setPackageEnabled,
  updateBinding,
  type StoreSnapshot,
} from "../../server-api/policy-store";
import {
  appliedCount,
  buildFolders,
  totalPolicyCount,
  type FolderVM,
  type PolicyVM,
} from "./home-model";

import "./home-dial.css";

export interface DialWallet {
  address: string;
  label: string | null;
  balanceUsd: number;
  tone: "calm" | "warn" | "fail";
}

interface Props {
  wallets: DialWallet[];
  snap: StoreSnapshot | null;
  onSync: (address: string) => void;
  syncingAddress?: string | null;
  onRename: (w: DialWallet) => void;
  onDelete: (w: DialWallet) => void;
  onAddWallet: () => void;
}

// ── tiny icons ────────────────────────────────────────────────────────────
const Folder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
const Sync = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
);
const Rename = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.58a2 2 0 0 1 0 2.83z" /><path d="M7.5 7.5h.01" /></svg>
);
const Trash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
);
const Palette = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /><circle cx="17.5" cy="10.5" r=".8" fill="currentColor" stroke="none" /><circle cx="8.5" cy="7.5" r=".8" fill="currentColor" stroke="none" /><circle cx="6.5" cy="12.5" r=".8" fill="currentColor" stroke="none" /><path d="M12 2C6.5 2 2 6 2 11c0 4 3 7 7 7 1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H14c3.3 0 6-2.4 6-5.5C20 4.9 16.4 2 12 2z" /></svg>
);
const ArrowOut = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const Flip = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg>
);
const Back = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
);

const initialOf = (w: DialWallet) => (w.label ?? w.address).slice(0, 1).toUpperCase();

/** 지갑 색 = 주소 해시 기반 3색 순환(blue/violet/navy). 같은 지갑은 좌측 카드·우측 패널·
 *  패키지 아이콘에서 동일 색을 쓴다(위치별 색 불일치 방지). risk(fail/warn) tone 은 별도 우선. */
const WALLET_HUES = ["blue", "violet", "navy"] as const;
// 주소는 소문자로 정규화 — 홈/에디터(iframe)가 같은 키·해시로 같은 색을 내도록.
function hueOf(addr: string): (typeof WALLET_HUES)[number] {
  const s = addr.toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return WALLET_HUES[h % WALLET_HUES.length];
}

/** 사용자가 지갑별로 고르는 색 팔레트(프론트 쿨 계열) — home-dial.css 의 --wallet-* 와 1:1. */
export const WALLET_PALETTE = ["navy", "blue", "violet", "slate", "teal"] as const;
export type WalletHue = (typeof WALLET_PALETTE)[number];
const COLOR_KEY = "dambi:wallet-colors"; // { [address]: hue } — 계정 무관 로컬 취향, 백엔드 미변경
function loadWalletColors(): Record<string, WalletHue> {
  try {
    const r = JSON.parse(localStorage.getItem(COLOR_KEY) || "{}") as unknown;
    return r && typeof r === "object" ? (r as Record<string, WalletHue>) : {};
  } catch { return {}; }
}
function saveWalletColors(m: Record<string, WalletHue>): void {
  try { localStorage.setItem(COLOR_KEY, JSON.stringify(m)); } catch { /* best-effort */ }
}
const usd = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// ════════════════════════════════════════════════════════════════════════
export function WalletGovernance({ wallets, snap, onSync, syncingAddress, onRename, onDelete, onAddWallet }: Props) {
  const [active, setActive] = useState(0);
  const [overview, setOverview] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  // 삭제 직후처럼 active 가 범위를 벗어날 수 있다 — effect 가 보정하기 전 렌더에서
  // wallets[active] 가 undefined 가 되어 크래시하므로 렌더 시점에 clamp 한다.
  const activeIdx = Math.min(Math.max(active, 0), Math.max(0, wallets.length - 1));
  useEffect(() => {
    if (active !== activeIdx) setActive(activeIdx);
  }, [active, activeIdx]);

  const { t } = useTranslation("home");
  const activeWallet = wallets[activeIdx];

  // 지갑별 사용자 지정 색(localStorage). 없으면 주소-해시 기본값. 좌측 카드·우측 패널·패키지 공유.
  const [walletColors, setWalletColors] = useState<Record<string, WalletHue>>(loadWalletColors);
  const hueFor = (addr: string): string => walletColors[addr.toLowerCase()] ?? hueOf(addr);
  const setWalletColor = (addr: string, hue: WalletHue) =>
    setWalletColors((m) => { const next = { ...m, [addr.toLowerCase()]: hue }; saveWalletColors(next); return next; });

  if (wallets.length === 0) {
    return (
      <section className="dial-section">
        <DialHead />
        <div className="dp-empty" style={{ minHeight: 240, border: "1px solid var(--hairline)", borderRadius: "var(--r-md)", background: "var(--surface)" }}>
          <div className="et"><b>{t("empty.noWallets")}</b><br />{t("empty.addFirst")}</div>
          <button className="btn primary" onClick={onAddWallet}>{t("addWallet")}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="dial-section">
      <DialHead />
      <div className="dial-split" ref={splitRef}>
        <WalletDial
          wallets={wallets}
          active={activeIdx}
          hueFor={hueFor}
          onSelect={(i) => { setOverview(false); setActive(i); }}
          onActiveClick={() => setOverview((v) => !v)}
          onAddWallet={onAddWallet}
        />
        <div className="dial-panel">
          {overview ? (
            <WalletOverview
              wallets={wallets}
              snap={snap}
              active={activeIdx}
              onPick={(i) => { setActive(i); setOverview(false); }}
              onAddWallet={onAddWallet}
            />
          ) : (
            <WalletPanel
              key={activeWallet.address}
              wallet={activeWallet}
              snap={snap}
              hue={hueFor(activeWallet.address)}
              onSetColor={(h) => setWalletColor(activeWallet.address, h)}
              onOpenOverview={() => setOverview(true)}
              onSync={onSync}
              syncing={syncingAddress === activeWallet.address}
              onRename={() => onRename(activeWallet)}
              onDelete={() => onDelete(activeWallet)}
            />
          )}
        </div>
      </div>
      <ResizeGrip splitRef={splitRef} />
    </section>
  );
}

function DialHead() {
  const { t } = useTranslation("home");
  return (
    <div className="dial-head">
      <div className="gov-title">
        <h2>{t("head.title")} <span className="scope-pill wallet">{t("head.scopeWallet")}</span></h2>
        <span className="gov-sub">{t("head.sub")}</span>
      </div>
    </div>
  );
}

// ── LEFT: the dial ─────────────────────────────────────────────────────────
function WalletDial({
  wallets,
  active,
  hueFor,
  onSelect,
  onActiveClick,
  onAddWallet,
}: {
  wallets: DialWallet[];
  active: number;
  hueFor: (addr: string) => string;
  onSelect: (i: number) => void;
  onActiveClick: () => void;
  onAddWallet: () => void;
}) {
  const { t } = useTranslation("home");
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const offset = useRef(active);
  const spacing = useRef(152);
  const drag = useRef<{ y: number; o: number; moved: boolean; vel: number; lastY: number; lastT: number } | null>(null);
  const n = wallets.length;

  const recalc = () => {
    const ch = cardRefs.current[0]?.offsetHeight ?? 176;
    const sh = stageRef.current?.clientHeight ?? 472;
    spacing.current = Math.max(140, Math.min(ch + 34, sh * 0.32));
  };
  const layout = () => {
    const sp = spacing.current;
    cardRefs.current.forEach((tk, i) => {
      if (!tk) return;
      let rel = i - offset.current;
      rel = rel - n * Math.round(rel / n);
      const dist = Math.abs(rel);
      const scale = Math.max(0.66, 1 - dist * 0.18);
      const op = dist > 1.7 ? 0 : Math.max(0, 1 - dist * 0.45);
      tk.style.transform = `translateY(${rel * sp}px) scale(${scale})`;
      tk.style.opacity = String(op);
      tk.style.zIndex = String(100 - Math.round(dist * 10));
      tk.style.pointerEvents = op < 0.25 ? "none" : "auto";
      tk.classList.toggle("is-active", dist < 0.5);
    });
  };
  const activeIndex = () => ((Math.round(offset.current) % n) + n) % n;

  // keep the dial centered on `active` when it changes externally
  useEffect(() => {
    const k = Math.round((offset.current - active) / n);
    offset.current = active + k * n;
    recalc();
    layout();
    const s = stageRef.current;
    if (s) { s.classList.remove("wd-ready"); requestAnimationFrame(() => s.classList.add("wd-ready")); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, n]);

  useEffect(() => {
    recalc(); layout();
    const t = setTimeout(() => stageRef.current?.classList.add("wd-ready"), 60);
    const onResize = () => { recalc(); layout(); };
    window.addEventListener("resize", onResize);
    return () => { clearTimeout(t); window.removeEventListener("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => onSelect(activeIndex());
  const step = (d: number) => { offset.current = Math.round(offset.current) + d; layout(); commit(); };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, o: offset.current, moved: false, vel: 0, lastY: e.clientY, lastT: e.timeStamp };
    stageRef.current?.classList.add("dragging");
    stageRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 4) d.moved = true;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vel = 0.7 * d.vel + 0.3 * ((e.clientY - d.lastY) / dt);
    d.lastY = e.clientY; d.lastT = e.timeStamp;
    offset.current = d.o - dy / spacing.current;
    layout();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    stageRef.current?.classList.remove("dragging");
    try { stageRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const base = Math.round(offset.current);
    let target = Math.round(offset.current - (d.vel * 130) / spacing.current);
    target = Math.max(base - 2, Math.min(base + 2, target));
    offset.current = target;
    layout(); commit();
  };
  const onClick = (e: React.MouseEvent) => {
    const d = drag.current;
    if (d?.moved) return;
    const card = (e.target as HTMLElement).closest(".wcard");
    if (card && card.classList.contains("is-active")) { onActiveClick(); return; }
    const r = stageRef.current!.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) step(-1); else step(1);
  };

  return (
    <div className="wd-col">
      <div
        className="wd-stage"
        ref={stageRef}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); step(-1); } else if (e.key === "ArrowDown") { e.preventDefault(); step(1); } }}
      >
        {wallets.map((w, i) => (
          <div
            key={w.address}
            className="wcard"
            data-tone={w.tone}
            data-hue={hueFor(w.address)}
            ref={(el) => { if (el) cardRefs.current[i] = el; }}
          >
            <div className="wc-top">
              <span className="wc-mono">{initialOf(w)}</span>
              <span className="wc-sev"><span className="d" />{t("card.wallet")}</span>
            </div>
            <div className="wc-mid">
              <div className="wc-name">{w.label ?? "—"}</div>
              <div className="wc-addr">{w.address.slice(0, 6)} ·· {w.address.slice(-4)}</div>
            </div>
            <div className="wc-bot">
              <div><div className="lbl">{t("card.balance")}</div><div className="wc-bal">{usd(w.balanceUsd)}</div></div>
            </div>
          </div>
        ))}
      </div>
      <div className="wd-dots">
        {wallets.map((w, i) => (
          <button key={w.address} type="button" className={i === active ? "on" : ""} aria-label={w.label ?? w.address} onClick={() => onSelect(i)} />
        ))}
      </div>
      <button type="button" className="wd-add" onClick={onAddWallet}>
        <span className="wd-add-plus" aria-hidden>+</span> {t("addWallet")}
      </button>
    </div>
  );
}

// ── RIGHT: the package/policy/param panel ──────────────────────────────────
function WalletPanel({
  wallet,
  snap,
  hue,
  onSetColor,
  onOpenOverview,
  onSync,
  syncing,
  onRename,
  onDelete,
}: {
  wallet: DialWallet;
  snap: StoreSnapshot | null;
  hue: string;
  onSetColor: (h: WalletHue) => void;
  onOpenOverview: () => void;
  onSync: (address: string) => void;
  syncing: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("home");
  const qc = useQueryClient();
  const folders = useMemo(() => (snap ? buildFolders(snap, wallet.address) : []), [snap, wallet.address]);
  const applied = snap ? appliedCount(snap, wallet.address) : 0;
  const polTotal = snap ? totalPolicyCount(snap, wallet.address) : 0;

  // 카드 클릭 → 뒤집어 내부 정책(o/x)을 보여준다.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ps2-overview"] });
  const pkgMut = useMutation({ mutationFn: setPackageEnabled, onSettled: invalidate });
  const bindMut = useMutation({ mutationFn: updateBinding, onSettled: invalidate });

  const toggleFlip = (id: string) => setFlipped((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [colorOpen, setColorOpen] = useState(false); // 색 선택 팝오버

  return (
    <div className="dp-fade">
      <div className="dp-head" data-hue={hue}>
        <button className="dp-coin" type="button" data-tone={wallet.tone} data-hue={hue} title={t("panel.viewAllWallets")} onClick={onOpenOverview}>
          {initialOf(wallet)}
        </button>
        <div className="dp-id">
          <div className="nr">
            <span className="name">{wallet.label ?? "—"}</span>
            <span className="addr">{wallet.address}</span>
          </div>
        </div>
        <div className="dp-bal">
          <div className="dp-acts">
            <div className="dp-color-wrap">
              <button className="dp-ib" type="button" title={t("panel.walletColor", "지갑 색")} aria-haspopup="true" aria-expanded={colorOpen} onClick={() => setColorOpen((v) => !v)}><Palette /></button>
              {colorOpen && (
                <>
                  <div className="dp-color-backdrop" onClick={() => setColorOpen(false)} />
                  <div className="dp-color-pop" role="menu">
                    {WALLET_PALETTE.map((h) => (
                      <button key={h} type="button" className={`dp-sw${h === hue ? " on" : ""}`} data-hue={h} title={h} aria-label={h} role="menuitemradio" aria-checked={h === hue}
                        onClick={() => { onSetColor(h); setColorOpen(false); }} />
                    ))}
                  </div>
                </>
              )}
            </div>
            <button className={`dp-ib${syncing ? " spinning" : ""}`} type="button" title={t("panel.syncNow")} onClick={() => onSync(wallet.address)}><Sync /></button>
            <button className="dp-ib" type="button" title={t("panel.rename")} onClick={onRename}><Rename /></button>
            <button className="dp-ib danger" type="button" title={t("panel.deleteWallet")} onClick={onDelete}><Trash /></button>
          </div>
          <b>{usd(wallet.balanceUsd)}</b>
          <div><Link className="open" to={`/monitoring?wallet=${wallet.address}`}>{t("panel.openAssets")} <ArrowOut /></Link></div>
        </div>
      </div>

      <div className="dp-stack">
        <span className="seg">{t("panel.packages")} <b>{folders.length}</b><span className="mute"> {t("panel.policiesCount", { count: polTotal })}</span></span>
        <span className="arrow">→</span>
        <span className="seg">{t("panel.appliedToWallet")} <b>{applied}</b></span>
      </div>

      {folders.length === 0 ? (
        <div className="dp-empty">
          <div className="et"><b>{t("panel.noPackages")}</b><br />{t("panel.baselineOnly")}</div>
          <Link className="btn" to="/market">{t("panel.getPackages")}</Link>
        </div>
      ) : (
        <div className="dp-policies dp-cardgrid">
          {folders.map((f) => (
            <FolderCard
              key={f.packageId}
              folder={f}
              hue={hue}
              flipped={flipped.has(f.packageId)}
              onFlip={() => toggleFlip(f.packageId)}
              onTogglePackage={(on) => pkgMut.mutate({ address: wallet.address, packageId: f.packageId, enabled: on })}
              onToggleEnabled={(p, on) =>
                bindMut.mutate({ address: wallet.address, bindingId: p.bindingId, patch: { enabled: on } })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 패키지(폴더) = 뒤집기 카드. 앞: 아이콘·이름·요약·패키지 on/off 토글. 뒤(클릭
 *  하면 뒤집힘): 내부 정책 목록(각 정책 o/x 만 — 게시·수정 없음). */
/** 보호 도장 토글 — OFF=점선 빈 틀, ON=발자국(paw-navy.png)이 스프링으로 꾹 찍힘. controlled. */
function PawStampToggle({ on, onChange, label, title }: { on: boolean; onChange: (next: boolean) => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      className="paw-tog"
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
    >
      <span className="paw-glyph">
        <span className="paw-ring" />
        <img className="paw-img" src="picture/paw-navy.png" alt="" />
      </span>
    </button>
  );
}

function FolderCard({
  folder,
  hue,
  flipped,
  onFlip,
  onTogglePackage,
  onToggleEnabled,
}: {
  folder: FolderVM;
  hue: string;
  flipped: boolean;
  onFlip: () => void;
  onTogglePackage: (on: boolean) => void;
  onToggleEnabled: (p: PolicyVM, on: boolean) => void;
}) {
  const { t } = useTranslation("home");
  const activeN = folder.policies.filter((p) => p.effective).length;
  return (
    <div className={`pkc${flipped ? " flip" : ""}${folder.on ? "" : " off"}`}>
      <div className="pkc-in">
        {/* front */}
        <div className="pkc-face pkc-front" onClick={onFlip}>
          <div className="pkc-ftop">
            <span className="pkc-ic" data-hue={hue}><Folder /></span>
            <span className="pkc-name">{folder.name}</span>
            <Switch checked={folder.on} onChange={onTogglePackage} className="pkc-sw" />
          </div>
          <div className="pkc-fmeta">
            <span className="pkc-mline"><b>{folder.policies.length}</b> {t("folder.policies")}</span>
            <span className="pkc-dot">·</span>
            <span className="pkc-active">{t("folder.activeCount", { count: activeN })}</span>
          </div>
          <div className="pkc-ffoot">
            <span className="pkc-fliphint"><Flip /> {t("folder.flip")}</span>
          </div>
        </div>
        {/* back */}
        <div className="pkc-face pkc-back">
          <div className="pkc-bhead">
            <button
              type="button"
              className="pkc-bback"
              aria-label={t("folder.flip")}
              onClick={(e) => { e.stopPropagation(); onFlip(); }}
            >
              <Back />
            </button>
            <span className="pkc-bname">{folder.name}</span>
          </div>
          <div className="pkc-blist">
            {folder.policies.length === 0 ? (
              <div className="pkc-empty">{t("folder.emptyPackage")}</div>
            ) : (
              folder.policies.map((p) => (
                <div className={`pkc-pol${p.enabled ? "" : " off"}`} key={p.bindingId}>
                  <span className={`pr-dot ${p.severity}`} />
                  <span className="pkc-pol-name" title={p.name}>{p.name}</span>
                  <span className={`pkc-pol-state${p.effective ? " on" : ""}`}>
                    {p.effective ? t("policy.active") : t("policy.off")}
                  </span>
                  <PawStampToggle
                    on={p.enabled}
                    onChange={(next) => onToggleEnabled(p, next)}
                    label={p.enabled ? t("policy.exclude") : t("policy.include")}
                    title={p.enabled ? t("policy.excludeTitle") : t("policy.includeTitle")}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── overview grid ──────────────────────────────────────────────────────────
function WalletOverview({
  wallets,
  snap,
  active,
  onPick,
  onAddWallet,
}: {
  wallets: DialWallet[];
  snap: StoreSnapshot | null;
  active: number;
  onPick: (i: number) => void;
  onAddWallet: () => void;
}) {
  const { t } = useTranslation("home");
  return (
    <div className="dp-fade wv-wrap">
      <div className="wv-head">
        <div className="wv-title">{t("overview.allWallets")} <b>{wallets.length}</b></div>
        <button className="btn wv-add" type="button" onClick={onAddWallet}>{t("addWallet")}</button>
      </div>
      <div className="wv-grid">
        {wallets.map((w, i) => {
          const pkgs = snap ? buildFolders(snap, w.address).length : 0;
          const ap = snap ? appliedCount(snap, w.address) : 0;
          return (
            <button key={w.address} type="button" className={`wv-card${i === active ? " is-active" : ""}`} onClick={() => onPick(i)}>
              <div className="wv-top"><span className="wv-coin" data-tone={w.tone}>{initialOf(w)}</span></div>
              <div className="wv-name">{w.label ?? "—"}</div>
              <div className="wv-addr">{w.address}</div>
              <div className="wv-foot">
                <span className="wv-bal">{usd(w.balanceUsd)}</span>
                <span className="wv-meta">{t("overview.meta", { packages: pkgs, applied: ap })}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="wv-hint">{t("overview.hint")}</div>
    </div>
  );
}

// ── reusable toggle (matches the .sw markup used across the dashboard) ──────
function Switch({ checked, onChange, className, small }: { checked: boolean; onChange: (on: boolean) => void; className?: string; small?: boolean }) {
  return (
    <label className={`sw${small ? " sw-sm" : ""}${className ? " " + className : ""}`} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="thumb" />
    </label>
  );
}

// ── drag-resize the split height (no persistence) ──────────────────────────
function ResizeGrip({ splitRef }: { splitRef: React.RefObject<HTMLDivElement> }) {
  const { t } = useTranslation("home");
  const rs = useRef<{ y: number; h: number } | null>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const MIN = 360;
  const maxH = () => Math.max(MIN, window.innerHeight - 150);
  return (
    <div
      className="split-resize"
      ref={gripRef}
      title={t("resizeHint")}
      onPointerDown={(e) => {
        const el = splitRef.current; if (!el) return;
        rs.current = { y: e.clientY, h: el.offsetHeight };
        try { gripRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
        gripRef.current?.classList.add("dragging");
      }}
      onPointerMove={(e) => {
        const d = rs.current; const el = splitRef.current; if (!d || !el) return;
        el.style.height = Math.min(maxH(), Math.max(MIN, d.h + (e.clientY - d.y))) + "px";
        window.dispatchEvent(new Event("resize"));
      }}
      onPointerUp={(e) => {
        if (!rs.current) return;
        rs.current = null;
        try { gripRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        gripRef.current?.classList.remove("dragging");
      }}
      onDoubleClick={() => { if (splitRef.current) { splitRef.current.style.height = ""; window.dispatchEvent(new Event("resize")); } }}
    >
      <span className="grip" />
    </div>
  );
}
