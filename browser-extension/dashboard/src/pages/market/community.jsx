/* Scopeball Market — Community (검증된 평가 + 자유 토론)
   기존 자산 재사용: Cloudy Pond 토큰, Market 데이터레이어, 카드/배지/칩, KO-EN.
   정직성: 모든 시드는 "예시" 배지. 이 별점은 카탈로그 카드 rating으로 역주입하지 않음.

   SEED_REVIEWS는 ES 모듈화하며 data.js로 옮겨 순환 import를 피했다 — 여기선
   data에서 re-export 하지 않고 필요 곳에서 직접 가져다 쓴다. */
import React, { useState, Fragment } from "react";
import { Market } from "./data";

// 프로토타입 기준 시각
export const CMTY_NOW = new Date("2026-06-03T00:00:00Z");

// ── Discussion 시드 (스레드) ──
// { id, kind:'discussion', title{ko,en}, target{type,id}, body{ko,en}, author, createdAt, replies[] }
export const SEED_THREADS = [
  { id: "t1", kind: "discussion", author: "cowswapper", createdAt: "2026-06-01", target: { type: "policy", id: "swap-price-impact-warn" }, status: "resolved", topics: ["question", "threshold"], helpful: 8,
    title: { ko: "슬리피지 가드, 어느 정도가 적정선일까?", en: "Slippage guard — what's a sane threshold?" },
    body: { ko: "프라이스 임팩트 경고 임계값을 다들 몇 %로 두는지 궁금합니다. 풀 깊이마다 다를 텐데 기준이 있을까요?", en: "Curious what % everyone sets the price-impact warning to. It must vary by pool depth — is there a rule of thumb?" },
    replies: [
      { author: "node_runner", createdAt: "2026-06-01", best: true, helpful: 6, body: { ko: "풀 깊이에 따라 다르지만 보통 0.5~1%로 시작합니다.", en: "Depends on pool depth, but I usually start at 0.5–1%." } },
      { author: "vault.eth", createdAt: "2026-06-02", body: { ko: "메인넷 대형 풀이면 0.3%도 충분하더라고요.", en: "On a deep mainnet pool 0.3% has been plenty for me." } },
      { author: "cowswapper", createdAt: "2026-06-02", body: { ko: "참고됐어요, 감사합니다.", en: "Super helpful, thanks both." } },
    ] },
  { id: "t2", kind: "discussion", author: "saltykimchi", createdAt: "2026-05-31", target: { type: "package", id: "drainer-shield" }, status: "pinned", topics: ["review"], helpful: 14,
    title: { ko: "드레이너·피싱 차단팩 실사용 후기 모음", en: "Drainer & Phishing Shield — field reports" },
    body: { ko: "이 팩 설치하고 한 달 썼습니다. 실제로 막힌 사례 있으면 공유해요.", en: "Ran this pack for a month. Share any real blocks you've seen." },
    replies: [
      { author: "minteddao", createdAt: "2026-05-31", best: true, helpful: 11, body: { ko: "가짜 에어드랍 사이트에서 permit 서명 차단됐습니다.", en: "Blocked a permit signature on a fake airdrop site." } },
      { author: "0xharin", createdAt: "2026-06-01", body: { ko: "Blur 위조 서명도 잡혔어요. 체감 효과 큽니다.", en: "Caught a spoofed Blur signature too. Noticeable difference." } },
    ] },
  { id: "t3", kind: "discussion", author: "frog.eth", createdAt: "2026-05-25", target: { type: "policy", id: "nft-bid-weth-unlimited-warn" }, status: null, topics: ["question", "threshold"], helpful: 5,
    title: { ko: "무제한 승인, 0으로 막는 건 너무 공격적일까?", en: "Is blocking unlimited approvals to zero too aggressive?" },
    body: { ko: "한도 승인으로 바꾸면 거래마다 서명이 늘어 불편한데, 다들 어떻게 타협하나요?", en: "Switching to capped approvals adds a signature per trade. How do you balance UX vs safety?" },
    replies: [
      { author: "gasfeehater", createdAt: "2026-05-26", best: true, helpful: 4, body: { ko: "자주 쓰는 마켓만 한도를 넉넉히 주고 나머진 0으로 둡니다.", en: "Generous cap on the markets I use often, zero everywhere else." } },
    ] },
  { id: "t4", kind: "discussion", author: "chainhopper", createdAt: "2026-05-20", target: { type: "policy", id: "bridge-target-not-allowlisted-deny" }, status: null, topics: ["question"], helpful: 2,
    title: { ko: "브릿지 허용목록은 어디서 관리되나요?", en: "Where is the bridge allowlist maintained?" },
    body: { ko: "허용목록 기준과 갱신 주기가 궁금합니다. 새 브릿지는 어떻게 등록되나요?", en: "Curious about the allowlist criteria and update cadence. How does a new bridge get added?" },
    replies: [] },
  { id: "t5", kind: "discussion", author: "lurking_anon", createdAt: "2026-05-18", target: { type: "package", id: "liq-pack" }, status: "resolved", topics: ["review", "question"], helpful: 9,
    title: { ko: "청산 방어팩 vs 개별 정책, 뭐가 나을까", en: "Liquidation pack vs picking policies individually" },
    body: { ko: "팩으로 통째로 담는 것과 필요한 것만 고르는 것, 운영상 차이가 큰가요?", en: "Is there a real operational difference between the whole pack and hand-picking?" },
    replies: [
      { author: "vault.eth", createdAt: "2026-05-19", best: true, helpful: 7, body: { ko: "팩이 업데이트 추적이 편합니다. 개별은 빠뜨리기 쉬워요.", en: "The pack is easier to keep updated. Hand-picking, you miss things." } },
      { author: "node_runner", createdAt: "2026-05-19", body: { ko: "저는 팩 담고 안 맞는 것만 빼는 식으로 씁니다.", en: "I add the pack and remove the few that don't fit." } },
    ] },
];

// ── 헬퍼 ──
export function tt(obj, locale) { return obj ? (locale === "en" ? obj.en : obj.ko) : ""; }
export function relTime(iso, locale) {
  const d = new Date(iso + (iso.length <= 10 ? "T00:00:00Z" : ""));
  const days = Math.max(0, Math.round((CMTY_NOW - d) / 86400000));
  if (locale === "en") {
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 7) return days + "d ago";
    if (days < 30) return Math.floor(days / 7) + "w ago";
    return Math.floor(days / 30) + "mo ago";
  }
  if (days <= 0) return "오늘";
  if (days < 7) return days + "일 전";
  if (days < 30) return Math.floor(days / 7) + "주 전";
  return Math.floor(days / 30) + "개월 전";
}
export function authorInitial(a) { return (a.replace(/[^a-zA-Z0-9]/g, "")[0] || "?").toUpperCase(); }

// 표시이름 + @handle (너무 트위터스럽지 않게 절제)
export const AUTHORS = {
  cowswapper: { n: "Cow Swapper" }, "vault.eth": { n: "Vault" }, "0xharin": { n: "Harin" },
  saltykimchi: { n: "Salty Kimchi" }, node_runner: { n: "Node Runner" }, minteddao: { n: "Minted" },
  "frog.eth": { n: "Frog" }, gasfeehater: { n: "Gas Fee Hater" }, merkletree: { n: "Merkle" },
  chainhopper: { n: "Chain Hopper" }, lurking_anon: { n: "Lurker" }, you: { n: "You" },
};
export function authorName(h) { return (AUTHORS[h] && AUTHORS[h].n) || h; }
export function authorHandle(h) { return "@" + h; }

// 아바타 톤 (Cloudy Pond 저채도 — 단색 원, 사진/이모지 없음)
export const AV_TONES = [["#EBF3E8", "#44583D"], ["#DCEAED", "#2B3639"], ["#D7DBDF", "#2A3441"], ["#EDF4F6", "#485A5E"], ["#E4EFE1", "#354E2C"], ["#EFF0F2", "#475569"]];
export function avatarTone(h) { let s = 0; for (let i = 0; i < h.length; i++) s += h.charCodeAt(i); return AV_TONES[s % AV_TONES.length]; }
export function Avatar({ handle, size = 44 }) {
  const [bg, fg] = avatarTone(handle);
  return <span className="cav" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: bg, color: fg }}>{authorInitial(handle)}</span>;
}
export function VerifiedTick() {
  return <svg className="vtick" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>;
}

// 리포스트 예시 카운트 (결정적 — 표기는 항상 "예시", 동작 비활성)
export function repostCount(id) { let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 211; return s % 19; }

// 로컬 저장 (북마크/도움 토글 — 새로고침 후에도 유지)
export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

// 액션 행 (트위터식 라인 아이콘 — 이모지 금지)
export const ACT_ICONS = {
  reply: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  repost: "M17 2l4 4-4 4M21 6H7a4 4 0 0 0-4 4v1M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 4-4v-1",
  like: "M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z",
  bookmark: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
};
export function ActBtn({ icon, label, count, active, disabled, tone, title, onClick }) {
  return (
    <button className={"act act-" + icon + (active ? " on" : "") + (disabled ? " off" : "")} title={title} onClick={(e) => { e.stopPropagation(); if (!disabled && onClick) onClick(); }}>
      <span className="act-ico">
        <svg width="18" height="18" viewBox="0 0 24 24" fill={active && (icon === "like" || icon === "bookmark" || icon === "repost") ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ACT_ICONS[icon]}/></svg>
      </span>
      {count != null && <span className="act-n">{count}</span>}
      {label && <span className="act-label">{label}</span>}
    </button>
  );
}
export function ActionRow({ id, replyCount, likeCount, liked, bookmarked, reposted, repostN, locale, onReply, onLike, onBookmark, onRepost, onShare, compact }) {
  return (
    <div className={"action-row" + (compact ? " compact" : "")}>
      <ActBtn icon="reply" count={replyCount} title={locale === "en" ? "Reply" : "답글"} onClick={onReply} />
      <ActBtn icon="repost" count={repostN != null ? repostN : repostCount(id)} active={reposted} title={locale === "en" ? "Repost" : "리포스트"} onClick={onRepost} />
      <ActBtn icon="like" count={likeCount} active={liked} title={locale === "en" ? "Helpful" : "도움"} onClick={onLike} />
      <ActBtn icon="bookmark" active={bookmarked} title={locale === "en" ? "Bookmark" : "북마크"} onClick={onBookmark} />
      <ActBtn icon="share" title={locale === "en" ? "Share link" : "공유 링크"} onClick={onShare} />
    </div>
  );
}

// 칩 행: 대상 + 주제태그, 최대 max개 + "+N"
export function ChipsRow({ target, topics, locale, ctx, max }) {
  const chips = [];
  if (target) chips.push({ k: "t" });
  (topics || []).forEach((tp) => chips.push({ k: "tp", tp: tp }));
  if (chips.length === 0) return null;
  const lim = max || 2;
  const shown = chips.slice(0, lim);
  const extra = chips.length - shown.length;
  return (
    <div className="chips-row">
      {shown.map((ch, i) => ch.k === "t"
        ? <TargetChip key={i} target={target} locale={locale} ctx={ctx} neutral />
        : <TopicTag key={i} topic={ch.tp} locale={locale} />)}
      {extra > 0 && <span className="chip-more">+{extra}</span>}
    </div>
  );
}

// 별점 (중립 강조색 — 상태색 사용 금지)
export function Stars({ value, size = 15 }) {
  const star = "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.8 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z";
  return (
    <span className="stars" style={{ display: "inline-flex", gap: 1 }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        const cls = fill >= 0.75 ? "full" : fill >= 0.25 ? "half" : "empty";
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" className={"star " + cls}>
            <defs><linearGradient id={"sg" + i}><stop offset="50%" stopColor="currentColor" /><stop offset="50%" stopColor="transparent" /></linearGradient></defs>
            <path d={star} fill={cls === "full" ? "currentColor" : cls === "half" ? ("url(#sg" + i + ")") : "none"}
              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        );
      })}
    </span>
  );
}

export function ExampleBadge({ locale }) {
  return <span className="ex-badge"><span data-lang="ko">예시</span><span data-lang="en">sample</span></span>;
}

// 자유 주제 태그 (무채색 칩)
export const TOPIC = {
  question: { ko: "#질문", en: "#question" },
  review: { ko: "#후기", en: "#review" },
  threshold: { ko: "#임계값", en: "#threshold" },
};
export function TopicTag({ topic, locale }) {
  const m = TOPIC[topic]; if (!m) return null;
  return <span className="topic-tag">{tt(m, locale)}</span>;
}
// 상태 칩 (이모지 금지 · 베이스 팔레트 저채도 · 상태색 금지)
export function StatusChip({ status, locale }) {
  if (!status) return null;
  const lab = status === "pinned" ? { ko: "고정", en: "Pinned" } : { ko: "해결됨", en: "Resolved" };
  return <span className={"status-chip " + status}>{tt(lab, locale)}</span>;
}

// 공유 별점 표시: agg = {avg,count} 또는 null.
// 별 색은 중립 강조색(상태색 금지). "★4.x (N)" 동일 표기, 툴팁만 locale.
// variant: 'card'(컴팩트) | 'bar'(신뢰바). onClick 있으면 버튼.
export function RatingInline({ agg, locale, onClick, variant }) {
  if (!agg) return null;
  const tip = locale === "en" ? (agg.count + " reviews") : (agg.count + "개 평가");
  const inner = (
    <Fragment>
      <svg className="ri-star" width={variant === "bar" ? 15 : 13} height={variant === "bar" ? 15 : 13} viewBox="0 0 24 24">
        <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.8 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" fill="currentColor" />
      </svg>
      <b className="ri-num">{agg.avg.toFixed(1)}</b>
      <span className="ri-n">({agg.count})</span>
      <ExampleBadge locale={locale} />
    </Fragment>
  );
  if (onClick) return <button className={"rating-inline " + (variant || "card")} title={tip} onClick={(e) => { e.stopPropagation(); onClick(); }}>{inner}</button>;
  return <span className={"rating-inline " + (variant || "card")} title={tip}>{inner}</span>;
}

// 대상(정책/패키지) 칩 → 클릭 시 상세로 이동. neutral=무채색(토론용)
export function TargetChip({ target, locale, ctx, neutral }) {
  if (!target) return null;
  if (target.type === "package") {
    const pk = Market.PKG_BY_ID[target.id];
    if (!pk) return null;
    return <button className={"tgt-chip pkg" + (neutral ? " neutral" : "")} onClick={(e) => { e.stopPropagation(); ctx.openPackage(target.id); }}>
      <svg className="tc-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6z"/></svg>
      {Market.pick(pk.name, locale)}</button>;
  }
  const p = Market.BY_SLUG[target.id];
  if (!p) return null;
  const c = Market.DOMAIN_COLOR[p.domain];
  if (neutral) {
    return <button className="tgt-chip neutral" onClick={(e) => { e.stopPropagation(); ctx.openPolicy(target.id); }}>
      <span className="tc-dot neutral"></span>{Market.pick(p.name, locale)}</button>;
  }
  return <button className="tgt-chip" style={{ borderColor: c.hex, color: c.ink }} onClick={(e) => { e.stopPropagation(); ctx.openPolicy(target.id); }}>
    <span className="tc-dot" style={{ background: c.hex }}></span>{Market.pick(p.name, locale)}</button>;
}

// ── 별점 분포 요약 ──
export function RatingSummary({ reviews, locale, subtitle }) {
  const n = reviews.length;
  const avg = n ? reviews.reduce((a, r) => a + r.rating, 0) / n : 0;
  const dist = [5, 4, 3, 2, 1].map((s) => reviews.filter((r) => r.rating === s).length);
  const max = Math.max(1, ...dist);
  return (
    <div className="rating-sum">
      <div className="rs-top">
        <div className="rs-avg">{avg.toFixed(1)}</div>
        <div className="rs-stars"><Stars value={avg} size={16} /><div className="rs-n">{n}<span data-lang="ko">개 평가</span><span data-lang="en"> reviews</span></div></div>
      </div>
      {subtitle && <div className="rs-sub">{subtitle}</div>}
      <div className="rs-bars">
        {[5, 4, 3, 2, 1].map((s, i) => (
          <div className="rs-row" key={s}>
            <span className="rs-label">{s}<svg width="11" height="11" viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.8 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" fill="currentColor"/></svg></span>
            <span className="rs-track"><span className="rs-fill" style={{ width: (dist[i] / max * 100) + "%" }}></span></span>
            <span className="rs-c">{dist[i]}</span>
          </div>
        ))}
      </div>
      <div className="rs-note"><span data-lang="ko">예시 데이터 — 실제 리뷰 누적 시 detail에 자동 반영</span><span data-lang="en">Sample data — real reviews roll up into detail automatically</span></div>
    </div>
  );
}

// ── 통합 피드 카드 (검증 평가 / 라운지 글 공용, 트위터형) ──
export function FeedCard({ item, kind, locale, ctx, onOpen, liked, likeCount, bookmarked, replyCount, reposted, repostN, onReply, onLike, onBookmark, onRepost, onShare, expanded }) {
  const isReview = kind === "review";
  const rc = replyCount != null ? replyCount : (item.replies || []).length;
  return (
    <article className={"tw-card" + (expanded ? " expanded" : "")} onClick={() => onOpen(item.id)}>
      <div className="tw-avcol"><Avatar handle={item.author} /></div>
      <div className="tw-main">
        <div className="tw-head">
          <span className="tw-name">{authorName(item.author)}</span>
          {isReview && <span className="tw-tick" title={locale === "en" ? "Verified reviewer" : "검증된 작성자"}><VerifiedTick /></span>}
          <span className="tw-handle">{authorHandle(item.author)}</span>
          <span className="tw-dot">·</span>
          <span className="tw-time">{relTime(item.createdAt, locale)}</span>
          {!isReview && item.status && <StatusChip status={item.status} locale={locale} />}
          <span className="tw-ex" title={locale === "en" ? "Sample data — not real metrics" : "예시 데이터 — 실제 지표 아님"}><span data-lang="ko">예시</span><span data-lang="en">sample</span></span>
        </div>
        {isReview && <div className="tw-stars"><Stars value={item.rating} size={15} /></div>}
        {!isReview && item.title && <div className="tw-title">{tt(item.title, locale)}</div>}
        <div className="tw-body">{tt(item.body, locale)}</div>
        <ChipsRow target={isReview ? { type: "policy", id: item.policySlug } : item.target} topics={item.topics} locale={locale} ctx={ctx} max={2} />
        <ActionRow id={item.id} replyCount={rc} likeCount={likeCount} liked={liked} bookmarked={bookmarked} reposted={reposted} repostN={repostN} locale={locale}
          onReply={() => onReply ? onReply(item.id) : onOpen(item.id)} onLike={onLike} onBookmark={onBookmark} onRepost={onRepost} onShare={onShare} />
      </div>
    </article>
  );
}

// 리포스트 라벨 (피드 상단)
export function RepostLabel({ author, locale }) {
  return (
    <div className="repost-label">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4M21 6H7a4 4 0 0 0-4 4v1M7 22l-4-4 4-4M3 18h14a4 4 0 0 0 4-4v-1"/></svg>
      <span>{authorName(author)}<span data-lang="ko">님이 리포스트함</span><span data-lang="en"> reposted</span></span>
    </div>
  );
}

// 인라인 미니 답글 입력
export function MiniComposer({ locale, onSubmit, onCancel }) {
  const [t, setT] = useState("");
  return (
    <div className="mini-composer">
      <textarea value={t} rows={1} placeholder={locale === "en" ? "Write a reply" : "답글을 입력하세요"}
        onChange={(e) => setT(e.target.value)} onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} autoFocus />
      <div className="mc-row">
        <button className="addbtn ghost sm" onClick={onCancel}><span data-lang="ko">취소</span><span data-lang="en">Cancel</span></button>
        <button className="addbtn sm" disabled={!t.trim()} onClick={() => { if (t.trim()) { onSubmit(t.trim()); setT(""); } }}><span data-lang="ko">답글</span><span data-lang="en">Reply</span></button>
      </div>
    </div>
  );
}

// 답글 노드 (대댓글 2단계까지)
export function ReplyNode({ reply, depth, childrenOf, locale, replyLikes, onLikeReply, replyingId, setReplyingId, onAddReply }) {
  const kids = depth === 0 ? childrenOf(reply.id) : [];
  const liked = !!replyLikes[reply.id];
  const baseHelp = typeof reply.helpful === "number" ? reply.helpful : 0;
  const targetParent = depth === 0 ? reply.id : (reply.parentId || reply.id);
  return (
    <div className={"tw-reply d" + depth}>
      <div className="re-avcol"><Avatar handle={reply.author} size={34} /></div>
      <div className="re-main">
        {reply.best && <span className="best-label"><span data-lang="ko">베스트 답글</span><span data-lang="en">Best answer</span></span>}
        <div className="re-head">
          <span className="tw-name">{authorName(reply.author)}</span>
          <span className="tw-handle">{authorHandle(reply.author)}</span>
          <span className="tw-dot">·</span><span className="tw-time">{relTime(reply.createdAt, locale)}</span>
        </div>
        <div className="tw-body">{tt(reply.body, locale)}</div>
        <div className="re-actions">
          <button className="re-act" onClick={() => setReplyingId(replyingId === reply.id ? null : reply.id)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span data-lang="ko">답글 달기</span><span data-lang="en">Reply</span>
          </button>
          <button className={"re-act" + (liked ? " on" : "")} onClick={() => onLikeReply(reply.id)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z"/></svg>
            <span data-lang="ko">도움 {baseHelp + (liked ? 1 : 0)}</span><span data-lang="en">Helpful {baseHelp + (liked ? 1 : 0)}</span>
          </button>
        </div>
        {replyingId === reply.id && <MiniComposer locale={locale} onSubmit={(txt) => { onAddReply(txt, targetParent); setReplyingId(null); }} onCancel={() => setReplyingId(null)} />}
        {kids.length > 0 && <div className="re-children">{kids.map((k) => <ReplyNode key={k.id} reply={k} depth={1} childrenOf={childrenOf} locale={locale} replyLikes={replyLikes} onLikeReply={onLikeReply} replyingId={replyingId} setReplyingId={setReplyingId} onAddReply={onAddReply} />)}</div>}
      </div>
    </div>
  );
}

// 답글 스레드 (베스트 상단 고정)
export function RepliesThread({ replies, locale, replyLikes, onLikeReply, replyingId, setReplyingId, onAddReply }) {
  const childrenOf = (pid) => replies.filter((r) => (r.parentId || null) === (pid || null));
  const top = childrenOf(null).slice().sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0));
  if (top.length === 0) return <div className="tw-noreply"><span data-lang="ko">아직 답글이 없습니다. 첫 답글을 남겨보세요.</span><span data-lang="en">No replies yet. Be the first to reply.</span></div>;
  return (
    <div className="tw-replies inline">
      {top.map((r) => <ReplyNode key={r.id} reply={r} depth={0} childrenOf={childrenOf} locale={locale} replyLikes={replyLikes} onLikeReply={onLikeReply} replyingId={replyingId} setReplyingId={setReplyingId} onAddReply={onAddReply} />)}
    </div>
  );
}
