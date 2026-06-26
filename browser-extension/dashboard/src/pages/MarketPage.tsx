import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  getActivitySummary,
  getListing,
  listListings,
  pickI18n,
  type ListingSort,
  type ListingSummary,
} from "../server-api";
import { publisherDisplay } from "../server-api/market";
import { MarketInstallModal } from "./MarketInstallModal";
import { MarketPagehead, useMarketContentClass } from "./MarketPagehead";

import {
  CATEGORY_COLOR,
  CATEGORY_ORDER,
  CategoryGlyph,
  categoryNameOf,
  categoryOf,
  isCategoryKey,
  type CategoryKey,
} from "./market-domain";
import { policyCopy } from "./market-copy";
import { useMarketLocale, type MarketLocale } from "./market-locale";

import "./market.css";

/**
 * `/market` — discovery landing by default; `?view=list` swaps in the full
 * filter-and-search grid.
 *
 * Landing layout (matches the reference Phantom/MagicEden hero +
 * trending + sidebar shape):
 *   ┌─ main ────────────────────────┬─ sidebar ─┐
 *   │ Hero: 3 official packages     │  Toggle   │
 *   │ Categories: 12 domain tiles   │  Top 10   │
 *   │                               │  더보기 → │
 *   └───────────────────────────────┴───────────┘
 *
 * Clicking a category navigates to `?view=list&domain=<d>`; clicking the
 * sidebar 더보기 navigates to `?view=list&kind=<k>&sort=popular`. The list
 * view reads those URL params on first render so deep links work.
 */
export function MarketPage() {
  // Locale is fixed to the stored preference here; the 한/EN toggle moved out
  // of the market header (language belongs in user Settings). Default is `ko`.
  const [locale] = useMarketLocale();
  const [params] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "landing";

  // Market route owns its frame: kill the shell padding so `.rm-page` is the
  // sole content frame (prototype `.app-content { padding: 0 }`), scoped here.
  useMarketContentClass();

  // Prototype `shell()` rule: the landing calls shell("", null, …) so it has
  // NO page header — only the body's `.rm-shead-ttl "Market"`. The list view
  // calls shell("전체 목록", {act:home}, …), so it gets the `.rm-pagehead`
  // crumb + back. Reproduce that here instead of an always-on global Topbar.
  return (
    <>
      {view === "list" ? (
        <>
          <MarketPagehead
            crumb={locale === "ko" ? "전체 목록" : "All listings"}
            back={{ to: "/market", label: locale === "ko" ? "← 정책허브 홈" : "← Policy Hub home" }}
          />
          <ListView locale={locale} initialParams={params} />
        </>
      ) : (
        <LandingView locale={locale} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Market-scoped search (replaces the global jump-search in the topbar)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Top-bar search for the market. Unlike the shared `GlobalSearch` (which jumps
 * to wallets / installed policies / verdicts), this searches the marketplace
 * itself: submitting routes to the list view with the query applied.
 */
const POPULAR_QUERIES = ["무제한 승인", "드레이너", "슬리피지", "블라인드 서명", "에어드랍", "Permit2"];
const RECENT_KEY = "market:recent-searches";

/** Items per page in the package / policy grids (numbered pagination). */
const PAGE_SIZE = 24;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* storage blocked — recent search is best-effort */
  }
}


// ─────────────────────────────────────────────────────────────────────────
// Landing view
// ─────────────────────────────────────────────────────────────────────────

function LandingView({ locale }: { locale: MarketLocale }) {
  const ko = locale === "ko";
  const [installTarget, setInstallTarget] = useState<ListingSummary | null>(null);
  // Single 100-item fetch powers everything on the landing page (counts,
  // coverage, official packages, popular policies) — minimal backend calls,
  // all real data. 35 seed policies + a few packages fit under the ceiling.
  // Count tiles must reflect the WHOLE catalog, so fetch up to the server cap
  // (LIST_LIMIT_MAX = 500). A small limit truncates by install-count sort and
  // drops whole categories of brand-new (0-install) listings from the counts.
  const allQ = useQuery({
    queryKey: ["market-all-for-landing"],
    queryFn: () => listListings({ limit: 500 }),
  });
  const all = allQ.data ?? [];

  // Per-category listing counts, split by kind (정책/패키지), + how many are
  // already installed (hero "gaps in coverage" fallback still uses this).
  // The browse list filters by the server `category` column for BOTH kinds, so
  // count by that same key (sets included) — listingCategoryKey() returns null
  // for sets and would zero out every package count.
  const { counts, policyCounts, pkgCounts, installed } = useMemo(() => {
    const counts = new Map<CategoryKey, number>();
    const policyCounts = new Map<CategoryKey, number>();
    const pkgCounts = new Map<CategoryKey, number>();
    const installed = new Map<CategoryKey, number>();
    const catOf = (l: ListingSummary): CategoryKey | null =>
      isCategoryKey(l.category) ? l.category : l.kind === "policy" ? categoryOf(l.slug) : null;
    all.forEach((l) => {
      const c = catOf(l);
      if (!c) return;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      const bucket = l.kind === "set" ? pkgCounts : policyCounts;
      bucket.set(c, (bucket.get(c) ?? 0) + 1);
      if (l.is_installed) installed.set(c, (installed.get(c) ?? 0) + 1);
    });
    return { counts, policyCounts, pkgCounts, installed };
  }, [all]);

  const officialPkgs = useMemo(
    () =>
      all
        .filter((l) => l.kind === "set" && l.publisher_tier === "official")
        .sort((a, b) => b.install_count - a.install_count)
        .slice(0, 4),
    [all],
  );
  // Fetch each official package's members so the landing cards show the same
  // policy-count + #category tags as the list view (prototype pkgCard()).
  const officialDetailQs = useQueries({
    queries: officialPkgs.map((s) => ({
      queryKey: ["market-listing", s.slug],
      queryFn: () => getListing(s.slug),
      staleTime: 60_000,
    })),
  });
  const officialMetaFor = (i: number) => {
    const members = officialDetailQs[i]?.data?.latest_version?.members ?? [];
    const catCount = new Map<CategoryKey, number>();
    members.forEach((m) => {
      const c = categoryOf(m.slug);
      catCount.set(c, (catCount.get(c) ?? 0) + 1);
    });
    return { count: members.length, catCount, ready: members.length > 0 };
  };
  const topPolicies = useMemo(
    () =>
      all
        .filter((l) => l.kind === "policy")
        .sort((a, b) => b.install_count - a.install_count)
        .slice(0, 5),
    [all],
  );

  // Recommendation hero — REAL data, two honest modes (no mock):
  //  • activity mode: GET /market/activity-summary gives per-listing install
  //    events in the last 7 days; we bucket by categoryOf(slug) → "최근 인기"
  //    categories by recent install demand. This is real marketplace demand,
  //    NOT "your activity" (the server has no per-wallet action history), so
  //    the copy says 인기, not 활동.
  //  • coverage fallback: when nothing was installed in the window (empty
  //    entries), fall back to "still-uninstalled categories" — also real data.
  const activityQ = useQuery({
    queryKey: ["market-activity-summary", 7],
    queryFn: () => getActivitySummary({ days: 7, limit: 100 }),
    staleTime: 60_000,
  });
  const recentByCat = useMemo(() => {
    const m = new Map<CategoryKey, number>();
    (activityQ.data?.entries ?? []).forEach((e) => {
      const c = categoryOf(e.slug);
      m.set(c, (m.get(c) ?? 0) + e.recent_installs);
    });
    return m;
  }, [activityQ.data]);
  const activityDays = activityQ.data?.days ?? 7;
  const hasActivity = recentByCat.size > 0;

  const recoCats = useMemo(() => {
    if (hasActivity) {
      // 최근 7일 설치가 있는 카테고리, 설치 많은 순 (단 이미 다 깐 카테고리는 제외).
      return [...recentByCat.entries()]
        .filter(([c]) => {
          const n = counts.get(c) ?? 0;
          const on = installed.get(c) ?? 0;
          return n > 0 && on < n;
        })
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => c)
        .slice(0, 3);
    }
    // coverage fallback — 미설치 정책이 남은 카테고리, 정책 수 많은 순.
    return CATEGORY_ORDER.filter((c) => {
      const n = counts.get(c) ?? 0;
      const on = installed.get(c) ?? 0;
      return n > 0 && on < n;
    })
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .slice(0, 3);
  }, [hasActivity, recentByCat, counts, installed]);
  const leadCat = recoCats[0] ?? null;
  const railCats = recoCats.slice(1);

  // Per-category reason line: activity mode shows "최근 7일 설치 N건", coverage
  // mode shows "미설치 N개". Both are real; the eyebrow label matches the mode.
  const reasonFor = (c: CategoryKey): string => {
    if (hasActivity) {
      const n = recentByCat.get(c) ?? 0;
      return ko ? `최근 ${activityDays}일 설치 ${n}건` : `${n} installs · ${activityDays}d`;
    }
    const left = (counts.get(c) ?? 0) - (installed.get(c) ?? 0);
    return ko ? `미설치 ${left}개` : `${left} uninstalled`;
  };

  return (
    <div className="rm-page rm-landing">
      <div className="rm-shead">
        <div>
          <div className="rm-shead-ttl">{ko ? "정책허브" : "Policy Hub"}</div>
          <div className="rm-shead-sub">
            {ko ? "지갑을 지키는 정책과 패키지를 둘러보세요" : "Browse policies and packages that protect your wallet"}
          </div>
        </div>
      </div>

      {leadCat && (
        <div className="rm-hero">
          <Link to={`/market?view=list&category=${leadCat}`} className="rm-hero-lead">
            <div className="rm-hero-eg"><span className="dot" />{hasActivity ? (ko ? "최근 인기 카테고리" : "Trending now") : ko ? "내 지갑에 빈 카테고리" : "Gaps in your coverage"}</div>
            <div className="rm-hero-cat">
              <span className="ic" style={{ background: CATEGORY_COLOR[leadCat].hex }}>
                <CategoryGlyph category={leadCat} size={26} color="#fff" />
              </span>
              <span className="nm">{categoryNameOf(leadCat, locale)}</span>
              <span className="cnt">{ko ? `정책 ${counts.get(leadCat) ?? 0}` : `${counts.get(leadCat) ?? 0} policies`}</span>
            </div>
            <div className="rm-hero-reason">
              <span className="act">
                <PulseGlyph />
                {reasonFor(leadCat)}
              </span>
              {" — "}
              {hasActivity
                ? ko
                  ? `${categoryNameOf(leadCat, locale)} 정책을 많이들 받고 있어요`
                  : `${categoryNameOf(leadCat, locale)} is popular this week`
                : ko
                  ? `${categoryNameOf(leadCat, locale)} 정책이 아직 비어 있어요`
                  : `${categoryNameOf(leadCat, locale)} coverage is still open`}
            </div>
            <span className="rm-hero-cta">
              {ko ? `${categoryNameOf(leadCat, locale)} 정책 둘러보기` : `Browse ${categoryNameOf(leadCat, locale)}`}
              <Chevron />
            </span>
          </Link>
          {railCats.length > 0 && (
            <div className="rm-hero-rail">
              <div className="rm-hero-rail-eg">{ko ? "이 카테고리도 살펴보세요" : "Also worth a look"}</div>
              {railCats.map((c) => (
                <Link key={c} to={`/market?view=list&category=${c}`} className="rm-hero-rrow">
                  <span className="ic" style={{ background: CATEGORY_COLOR[c].soft }}>
                    <CategoryGlyph category={c} size={16} color={CATEGORY_COLOR[c].hex} />
                  </span>
                  <div className="meta">
                    <div className="nm">
                      {categoryNameOf(c, locale)}{" "}
                      <span className="cnt">{ko ? `정책 ${counts.get(c) ?? 0}` : `${counts.get(c) ?? 0}`}</span>
                    </div>
                    <div className="why">
                      <span className="act">{reasonFor(c)}</span>
                    </div>
                  </div>
                  <span className="go"><Chevron /></span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <CategoryCoverage policyCounts={policyCounts} pkgCounts={pkgCounts} locale={locale} />

      <div className="rm-cols">
        <div className="rm-sec">
          <div className="rm-sec-head between">
            <div>
              <h2>{ko ? "공식 패키지" : "Official packages"}</h2>
              <div className="sub">{ko ? "Dambi가 검증한 정책 패키지 — 공식 인증" : "Verified by Dambi"}</div>
            </div>
          </div>
          <div className="rm-rgrid two" style={{ marginTop: 12 }}>
            {officialPkgs.map((pk, i) => (
              <PackageListCard
                key={pk.id}
                listing={pk}
                meta={officialMetaFor(i)}
                locale={locale}
                onInstall={setInstallTarget}
              />
            ))}
            {officialPkgs.length === 0 && (
              <div className="ml-status">{ko ? "공식 패키지가 없습니다." : "No official packages yet."}</div>
            )}
          </div>
        </div>

        <aside className="rm-sec">
          <div className="rm-sec-head">
            <div>
              <h2>{ko ? "다운로드 많은 정책" : "Popular policies"}</h2>
              <div className="sub">{ko ? "최근 7일 설치 기준 인기 정책" : "Top by recent installs"}</div>
            </div>
          </div>
          <div className="rm-trend" style={{ marginTop: 12 }}>
            {topPolicies.map((p, i) => {
              const c = listingCategoryKey(p);
              const color = c ? CATEGORY_COLOR[c] : null;
              return (
                <Link key={p.id} to={`/market/${encodeURIComponent(p.slug)}`} className="rm-rrow">
                  <span className={`rk${i < 3 ? " top" : ""}`}>{i + 1}</span>
                  <span className="ic" style={color ? { background: color.soft } : undefined}>
                    {c && <CategoryGlyph category={c} size={14} color={color!.hex} />}
                  </span>
                  <span className="meta">
                    <span className="nm">{pickI18n(p.display_name) || p.slug}</span>
                    <span className="pub">
                      <InstallCount n={p.install_count} /> {ko ? "다운로드" : "installs"}
                    </span>
                  </span>
                  {c && color && (
                    <span className="ct">
                      <span className="rm-catmini" style={{ background: color.soft, color: color.ink }}>
                        {categoryNameOf(c, locale)}
                      </span>
                    </span>
                  )}
                </Link>
              );
            })}
            <Link to="/market?view=list&kind=policy&sort=popular" className="rm-more">
              {ko ? "전체 정책 보기 →" : "View all policies →"}
            </Link>
          </div>
        </aside>
      </div>

      {installTarget && (
        <MarketInstallModal
          listing={installTarget}
          locale={locale}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}

/** Category grid — each tile shows how many policies / packages are published
 *  in that category (catalog volume, not per-wallet install state). */
function CategoryCoverage({
  policyCounts,
  pkgCounts,
  locale,
}: {
  policyCounts: Map<CategoryKey, number>;
  pkgCounts: Map<CategoryKey, number>;
  locale: MarketLocale;
}) {
  const ko = locale === "ko";
  return (
    <div className="rm-sec">
      <div className="rm-sec-head between">
        <div>
          <h2>{ko ? "카테고리" : "Category"}</h2>
          <div className="sub">
            {ko
              ? "자산·프로토콜 유형별로 등록된 정책과 패키지를 둘러보세요."
              : "Browse published policies and packages by asset/protocol type."}
          </div>
        </div>
      </div>
      <div className="rm-defense" style={{ marginTop: 14 }}>
        {CATEGORY_ORDER.map((c) => {
          const color = CATEGORY_COLOR[c];
          const np = policyCounts.get(c) ?? 0;
          const ng = pkgCounts.get(c) ?? 0;
          const total = np + ng;
          return (
            <Link key={c} to={`/market?view=list&category=${c}`} className={`rm-deftile${total ? " has" : ""}`}>
              <div className="rm-deftile-top">
                <span className="ic" style={{ background: color.soft }}>
                  <CategoryGlyph category={c} size={19} color={color.hex} />
                </span>
              </div>
              <div className="rm-deftile-nm" style={{ color: color.ink }}>{categoryNameOf(c, locale)}</div>
              <div className="rm-defcount">
                {total === 0
                  ? (ko ? "등록 없음" : "none yet")
                  : ko
                    ? `정책 ${np}개 · 패키지 ${ng}개`
                    : `${np} ${np === 1 ? "policy" : "policies"} · ${ng} ${ng === 1 ? "package" : "packages"}`}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PackageGlyphSm() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--blue-700)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Pulse/activity glyph used in the recommendation hero reason. */
function PulseGlyph({ size = 14, color = "var(--navy-400)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// List view (`?view=list`)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 목록 뷰 검색 팔레트 — 프로토타입 searchPanelHtml() + setupLandingSearch()
 * 1:1 포팅. 패널은 세 상태로 갈린다(원본 동일):
 *   - hover 만(빈 입력)          → 카테고리 그리드만
 *   - focus + 빈 입력            → 최근 검색 + 많이 찾는 검색 (카테고리 없음)
 *   - focus + 입력값             → 패키지(≤3)·정책(≤5) 라이브 hit, 없으면
 *                                  rm-srch-empty, 있으면 rm-srch-enter
 * 카테고리 클릭은 즉시 필터(toggleCat), hit 클릭은 상세로, Enter 는 전체 결과.
 */
function ListSearchPalette({
  q,
  setQ,
  onSubmit,
  onClear,
  cats,
  toggleCat,
  catCounts,
  policies,
  packages,
  onOpenDetail,
  locale,
}: {
  q: string;
  setQ: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  cats: Set<CategoryKey>;
  toggleCat: (c: CategoryKey) => void;
  catCounts: Map<CategoryKey, number>;
  /** Live-hit source: all policies / packages currently loaded in the list. */
  policies: ListingSummary[];
  packages: ListingSummary[];
  onOpenDetail: (slug: string) => void;
  locale: MarketLocale;
}) {
  const ko = locale === "ko";
  // Two independent triggers (prototype `focused`/`hovering`); the panel is
  // open when either is set, and the section layout depends on `focused`.
  const [focused, setFocused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const blurTimer = useRef<number | null>(null);
  const open = focused || hovering;
  const v = q.trim();

  const submit = (raw: string) => {
    const t = raw.trim();
    if (t) {
      const next = [t, ...recent.filter((r) => r !== t)].slice(0, 6);
      setRecent(next);
      writeRecent(next);
    }
    setQ(raw);
    onSubmit();
    setFocused(false);
  };
  const onBlur = () => {
    if (blurTimer.current) window.clearTimeout(blurTimer.current);
    blurTimer.current = window.setTimeout(() => setFocused(false), 140);
  };
  const cancelBlur = () => {
    if (blurTimer.current) window.clearTimeout(blurTimer.current);
  };

  // Live hits — same filter the prototype's searchPanelHtml() applied: name or
  // one-line includes the query text, then category/severity narrowing. We
  // reuse the loaded list data so no extra fetch is needed.
  const text = v.toLowerCase();
  const matchT = (l: ListingSummary) => {
    if (!text) return true;
    const name = (pickI18n(l.display_name) || l.slug).toLowerCase();
    const line = (policyCopy(l.slug)?.title || pickI18n(l.description) || "").toLowerCase();
    return name.includes(text) || line.includes(text) || l.slug.toLowerCase().includes(text);
  };
  const hitPkgs = packages.filter(matchT).slice(0, 3);
  const hitPols = policies.filter(matchT).slice(0, 5);

  const cardCat = (l: ListingSummary) => listingCategoryKey(l);

  return (
    <div
      className={`rm-srch-wrap${open ? " open" : ""}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="rm-srch-bar">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--slate-400)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(q);
            else if (e.key === "Escape") setFocused(false);
          }}
          placeholder={ko ? "정책·패키지 검색 — 커서를 올리면 카테고리, 누르면 최근 검색" : "Search — hover for categories, focus for recent"}
        />
        {q ? (
          <button type="button" className="rm-srch-kbd" style={{ cursor: "pointer" }} onClick={onClear}>×</button>
        ) : (
          <kbd className="rm-srch-kbd">↵</kbd>
        )}
      </div>

      <div className="rm-srch-panel" onMouseDown={cancelBlur}>
        {focused && v ? (
          // ── focus + 입력: 라이브 hit (패키지·정책) / 없으면 empty ──
          <>
            {hitPkgs.length > 0 && (
              <div className="rm-srch-sec">
                <div className="rm-srch-shead">{ko ? "패키지" : "Packages"} · {hitPkgs.length}</div>
                {hitPkgs.map((pk) => (
                  <button key={pk.id} type="button" className="rm-srch-hit" onClick={() => { submit(q); onOpenDetail(pk.slug); }}>
                    <span className="hic pkg"><PackageGlyphSm /></span>
                    <span className="nm">{pickI18n(pk.display_name) || pk.slug}</span>
                    <span className="k">{pk.publisher_tier === "official" ? (ko ? "공식" : "Official") : ko ? "커뮤니티" : "Community"}</span>
                    <span className="hn">{pk.install_count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
            {hitPols.length > 0 && (
              <div className="rm-srch-sec">
                <div className="rm-srch-shead">{ko ? "정책" : "Policies"} · {hitPols.length}</div>
                {hitPols.map((p2) => {
                  const c = cardCat(p2);
                  return (
                    <button key={p2.id} type="button" className="rm-srch-hit" onClick={() => { submit(q); onOpenDetail(p2.slug); }}>
                      <span className={`hic ${p2.severity ?? "warn"}`}>{p2.severity && <SeveritySymbol sev={p2.severity} size={12} />}</span>
                      <span className="nm">{pickI18n(p2.display_name) || p2.slug}</span>
                      <span className="k">{c ? categoryNameOf(c, locale) : ""}</span>
                      <span className="hn">{p2.install_count.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {hitPkgs.length === 0 && hitPols.length === 0 ? (
              <div className="rm-srch-empty">{ko ? `"${v}"에 대한 결과가 없어요` : `No results for "${v}"`}</div>
            ) : (
              <div className="rm-srch-enter">
                <kbd>Enter</kbd> {ko ? "전체 결과 보기" : "see all results"}
              </div>
            )}
          </>
        ) : focused ? (
          // ── focus + 빈 입력: 최근 검색 + 많이 찾는 검색 ──
          <>
            {recent.length > 0 && (
              <div className="rm-srch-sec">
                <div className="rm-srch-shead">{ko ? "최근 검색" : "Recent"}</div>
                {recent.map((r) => (
                  <div key={r} className="rm-srch-recent" onClick={() => submit(r)}>
                    <span className="ic">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--slate-400)" strokeWidth={1.8} aria-hidden="true">
                        <path d="M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18" />
                      </svg>
                    </span>
                    <span className="t">{r}</span>
                    <button type="button" className="del" onClick={(e) => { e.stopPropagation(); const next = recent.filter((x) => x !== r); setRecent(next); writeRecent(next); }} aria-label="remove">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="rm-srch-sec">
              <div className="rm-srch-shead">{ko ? "많이 찾는 검색" : "Popular"}</div>
              <div className="rm-srch-pop">
                {POPULAR_QUERIES.map((t) => (
                  <button key={t} type="button" className="rm-srch-pchip" onClick={() => submit(t)}>{t}</button>
                ))}
              </div>
            </div>
          </>
        ) : (
          // ── hover 만: 카테고리 그리드 ──
          <div className="rm-srch-sec">
            <div className="rm-srch-shead rm-srch-shead-row">
              <span>{ko ? "카테고리" : "Category"} <span className="muted">· {ko ? "여러 개 선택 가능" : "multi-select"}</span></span>
              <span className="rm-srch-allacts">
                <button type="button" onClick={() => [...cats].forEach(toggleCat)}>{ko ? "모두 해제" : "Clear"}</button>
              </span>
            </div>
            <div className="rm-srch-cats">
              {CATEGORY_ORDER.map((c) => {
                const on = cats.has(c);
                const col = CATEGORY_COLOR[c];
                const n = catCounts.get(c) ?? 0;
                return (
                  <button
                    key={c}
                    type="button"
                    className={`rm-srch-cat${on ? " on" : ""}`}
                    onClick={() => toggleCat(c)}
                  >
                    <span className="ic" style={{ background: on ? col.hex : col.soft }}>
                      <CategoryGlyph category={c} size={14} color={on ? "#fff" : col.hex} />
                    </span>
                    {categoryNameOf(c, locale)}
                    <span className="n">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Numbered pagination: 이전 · 1 2 3 … N · 다음. Always rendered (even for a
 *  single page). Shows the first/last page always and a small window around the
 *  current page, with ellipses for the gaps. */
function Pagination({
  page,
  pageCount,
  onChange,
  ko,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
  ko: boolean;
}) {
  const nums: (number | "gap")[] = [];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  nums.push(1);
  if (lo > 2) nums.push("gap");
  for (let p = lo; p <= hi; p++) nums.push(p);
  if (hi < pageCount - 1) nums.push("gap");
  if (pageCount > 1) nums.push(pageCount); // skip when there's only page 1

  return (
    <nav className="rm-pager" aria-label={ko ? "페이지" : "pagination"}>
      <button
        type="button"
        className="rm-pager-nav"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {ko ? "이전" : "Prev"}
      </button>
      {nums.map((n, i) =>
        n === "gap" ? (
          <span key={`gap-${i}`} className="rm-pager-gap">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={`rm-pager-num${n === page ? " on" : ""}`}
            aria-current={n === page ? "page" : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ),
      )}
      <button
        type="button"
        className="rm-pager-nav"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        {ko ? "다음" : "Next"}
      </button>
    </nav>
  );
}

function ListView({
  locale,
  initialParams,
}: {
  locale: MarketLocale;
  initialParams: URLSearchParams;
}) {
  const ko = locale === "ko";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = initialParams.get("category") ?? "";
  const initialSort = parseSortParam(initialParams.get("sort"));
  const initialQ = initialParams.get("q") ?? "";

  const [cats, setCats] = useState<Set<CategoryKey>>(
    () => new Set(initialCategory.split(",").filter(isCategoryKey)),
  );
  // URL ↔ 선택 카테고리 동기화 — 칩 제거/모두 해제가 주소창에도 반영되도록
  // (새로고침·공유·뒤로가기 시 필터 상태가 일치). 다른 파라미터(view/sort/q)는 보존.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const joined = [...cats].join(",");
    if (joined) next.set("category", joined);
    else next.delete("category");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [cats, searchParams, setSearchParams]);
  const [sort, setSort] = useState<ListingSort>(initialSort);
  const [q, setQ] = useState(initialQ);
  const [search, setSearch] = useState(initialQ);
  const [pkgPage, setPkgPage] = useState(1);
  const [polPage, setPolPage] = useState(1);
  const [installTarget, setInstallTarget] = useState<ListingSummary | null>(null);
  const pkgSecRef = useRef<HTMLDivElement>(null);
  const polSecRef = useRef<HTMLDivElement>(null);

  const selected = [...cats];
  const toggleCat = (c: CategoryKey) =>
    setCats((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  // All policies — multi-category filtering is client-side (union of selected).
  const policiesQ = useQuery({
    queryKey: ["market-listings", { kind: "policy", sort, q: search }],
    queryFn: () =>
      listListings({ kind: "policy", sort, q: search.trim() || undefined, limit: 500 }),
  });
  const allPolicies = policiesQ.data ?? [];
  const polCatCounts = useMemo(() => {
    const m = new Map<CategoryKey, number>();
    allPolicies.forEach((p) => {
      const c = listingCategoryKey(p);
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    });
    return m;
  }, [allPolicies]);

  const setsQ = useQuery({
    queryKey: ["market-sets-list", { sort, q: search }],
    queryFn: () =>
      listListings({ kind: "set", sort, q: search.trim() || undefined, limit: 200 }),
  });
  const sets = setsQ.data ?? [];
  const setDetailQs = useQueries({
    queries: sets.map((s) => ({
      queryKey: ["market-listing", s.slug],
      queryFn: () => getListing(s.slug),
      staleTime: 60_000,
    })),
  });
  const metaFor = (i: number) => {
    const members = setDetailQs[i]?.data?.latest_version?.members ?? [];
    const catCount = new Map<CategoryKey, number>();
    // 서버가 저장한 멤버 카테고리(intents) 우선 — pasu 카탈로그 슬러그까지 정확.
    // 없으면(구 패키지) 멤버 슬러그 기반 추정으로 폴백.
    const intents = (sets[i]?.intents ?? []).filter(isCategoryKey);
    if (intents.length) {
      intents.forEach((c) => catCount.set(c, catCount.get(c) ?? 1));
    } else {
      members.forEach((m) => {
        const c = categoryOf(m.slug);
        catCount.set(c, (catCount.get(c) ?? 0) + 1);
      });
    }
    return { count: members.length, catCount, ready: members.length > 0 || intents.length > 0 };
  };

  const polList =
    selected.length === 0
      ? allPolicies
      : allPolicies.filter((p) => {
          const c = listingCategoryKey(p);
          return c != null && cats.has(c);
        });
  // A package surfaces if any member is in any selected category.
  const pkgList =
    selected.length === 0
      ? sets
      : sets.filter((_, i) => {
          const cc = metaFor(i).catCount;
          return selected.some((c) => cc.has(c));
        });
  // Numbered pagination (client-side). Filters/sort change the result set, so
  // reset to page 1 whenever they do; clamp the active page if the list shrinks.
  useEffect(() => {
    setPkgPage(1);
    setPolPage(1);
  }, [search, sort, cats]);

  const pkgPageCount = Math.max(1, Math.ceil(pkgList.length / PAGE_SIZE));
  const polPageCount = Math.max(1, Math.ceil(polList.length / PAGE_SIZE));
  const pkgPageSafe = Math.min(pkgPage, pkgPageCount);
  const polPageSafe = Math.min(polPage, polPageCount);
  const pkgShown = pkgList.slice((pkgPageSafe - 1) * PAGE_SIZE, pkgPageSafe * PAGE_SIZE);
  const polShown = polList.slice((polPageSafe - 1) * PAGE_SIZE, polPageSafe * PAGE_SIZE);
  const goPkgPage = (p: number) => {
    setPkgPage(p);
    pkgSecRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const goPolPage = (p: number) => {
    setPolPage(p);
    polSecRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const loading = policiesQ.isLoading || setsQ.isLoading;

  return (
    <div className="rm-page">
      <div className="rm-controls">
        <ListSearchPalette
          q={q}
          setQ={setQ}
          onSubmit={() => setSearch(q)}
          onClear={() => { setQ(""); setSearch(""); }}
          cats={cats}
          toggleCat={toggleCat}
          catCounts={polCatCounts}
          policies={allPolicies}
          packages={sets}
          onOpenDetail={(slug) => navigate(`/market/${encodeURIComponent(slug)}`)}
          locale={locale}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ListingSort)}
          aria-label="sort"
        >
          <option value="popular">{ko ? "인기순" : "Most popular"}</option>
          <option value="new">{ko ? "신규순" : "Newest"}</option>
          <option value="rating">{ko ? "별점순" : "Top rated"}</option>
        </select>
      </div>

      {/* Selected category chips — below the search bar */}
      {selected.length > 0 && (
        <div className="rm-selected">
          {selected.map((c) => (
            <span
              key={c}
              className="rm-selchip"
              style={{ background: CATEGORY_COLOR[c].soft, color: CATEGORY_COLOR[c].ink }}
            >
              <span className="ic"><CategoryGlyph category={c} size={13} color={CATEGORY_COLOR[c].ink} /></span>
              {categoryNameOf(c, locale)}
              <button type="button" onClick={() => toggleCat(c)} aria-label="remove">
                ×
              </button>
            </span>
          ))}
          <button type="button" className="rm-selclear" onClick={() => setCats(new Set())}>
            {ko ? "모두 해제" : "Clear all"}
          </button>
        </div>
      )}

      {loading && <div className="market-status">{ko ? "불러오는 중…" : "Loading…"}</div>}
      {policiesQ.isError && (
        <div className="market-status market-error">
          {ko ? "정책허브 로드 실패" : "Policy Hub load failed"}
        </div>
      )}

      {/* 프로토타입: .rm-controls/.rm-selected 는 .rm-page 직계, 두 섹션은
          별도 .rm-results 래퍼 안(스태거 인덱스 분리). 첫 섹션은 margin-top:8px. */}
      {!loading && (
        <div className="rm-results">
          <section className="rm-sec" style={{ marginTop: 8 }} ref={pkgSecRef}>
            <div className="rm-lv-head">
              <h2>{ko ? "패키지" : "Packages"}</h2>
              <span className="count">{pkgList.length}</span>
              <span className="sub">
                {ko ? "여러 정책을 한 번에 켜는 묶음" : "Bundles that switch on many policies at once"}
              </span>
            </div>
            {pkgList.length === 0 ? (
              <p className="lv-empty">{ko ? "해당하는 패키지가 없습니다." : "No packages."}</p>
            ) : (
              <>
                <div className="rm-grid">
                  {pkgShown.map((l) => (
                    <PackageListCard
                      key={l.id}
                      listing={l}
                      meta={metaFor(sets.indexOf(l))}
                      locale={locale}
                      onInstall={setInstallTarget}
                    />
                  ))}
                </div>
                <Pagination
                  page={pkgPageSafe}
                  pageCount={pkgPageCount}
                  onChange={goPkgPage}
                  ko={ko}
                />
              </>
            )}
          </section>

          <section className="rm-sec" ref={polSecRef}>
            <div className="rm-lv-head">
              <h2>{ko ? "정책" : "Policies"}</h2>
              <span className="count">{polList.length}</span>
              <span className="sub">
                {ko ? "개별 정책 — 직접 골라 설치" : "Individual policies"}
              </span>
            </div>
            {polList.length === 0 ? (
              <p className="lv-empty">{ko ? "해당하는 정책이 없습니다." : "No policies."}</p>
            ) : (
              <>
                <div className="rm-grid">
                  {polShown.map((l) => (
                    <PolicyListCard key={l.id} listing={l} locale={locale} onInstall={setInstallTarget} />
                  ))}
                </div>
                <Pagination
                  page={polPageSafe}
                  pageCount={polPageCount}
                  onChange={goPolPage}
                  ko={ko}
                />
              </>
            )}
          </section>
        </div>
      )}

      {installTarget && (
        <MarketInstallModal
          listing={installTarget}
          locale={locale}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}

/** Severity as a colored symbol (top-right of policy cards): deny = red
 * no-entry, warn = amber triangle. Replaces the "차단"/"경고" text label. */
function SeveritySymbol({ sev, size = 18 }: { sev: "deny" | "warn"; size?: number }) {
  return sev === "deny" ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="6.6" y1="6.6" x2="17.4" y2="17.4" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2 21 19H3z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="16.6" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Compact rating: ★ avg (count). Shows "★ 신규" when there are no reviews. */
/** Install count as a download glyph + number (replaces "설치 N" text). */
function InstallCount({ n }: { n: number }) {
  return (
    <span className="rm-installs" title="installs">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
      {n.toLocaleString()}
    </span>
  );
}

function InstallBadge({
  installed,
  locale,
  onClick,
}: {
  installed: boolean;
  locale: MarketLocale;
  onClick: () => void;
}) {
  const ko = locale === "ko";
  return (
    <button
      type="button"
      className={`rm-badge${installed ? " installed" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {installed ? (ko ? "설치됨" : "Installed") : ko ? "받기" : "Install"}
    </button>
  );
}

// 핸드오프(dt-flow.jsx) 카드 푸터 아이콘 — layers/download/star.
function LayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8l8.5-4.5z" /><path d="M3.5 13l8.5 4.5 8.5-4.5" />
    </svg>
  );
}
/** 다운로드 수 — download 글리프(neutral-500) + 수. */
function StatDownload({ n }: { n: number }) {
  return (
    <span className="rm-pcard-stat" title="installs">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--neutral-500)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v11" /><path d="M7 11l5 4 5-4" /><path d="M5 20h14" />
      </svg>
      {n.toLocaleString()}
    </span>
  );
}
/** 별점 — star 글리프(lemon-500) + 평점(없으면 신규). */
function StatStar({ avg, ko }: { avg: number | null; ko: boolean }) {
  return (
    <span className="rm-pcard-stat" title="rating">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--lemon-500)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.3l2.6 5.7 6.1.7-4.5 4.2 1.2 6L12 17l-5.4 2.9 1.2-6L3.3 9.7l6.1-.7z" />
      </svg>
      {avg != null ? avg.toFixed(1) : ko ? "신규" : "New"}
    </span>
  );
}

function PolicyListCard({
  listing,
  locale,
  onInstall,
}: {
  listing: ListingSummary;
  locale: MarketLocale;
  onInstall: (l: ListingSummary) => void;
}) {
  const ko = locale === "ko";
  const name = pickI18n(listing.display_name) || listing.slug;
  const cat = listingCategoryKey(listing);
  const color = listingColor(listing);
  const oneLine = policyCopy(listing.slug)?.title || pickI18n(listing.description) || "";
  const ver = listing.current_version;
  const author = publisherDisplay(listing.publisher_tier, listing.publisher_email, locale);
  return (
    <Link to={`/market/${encodeURIComponent(listing.slug)}`} className="rm-pcard">
      <div className="rm-pcard-head">
        {cat && color ? (
          <span
            className="rm-pcard-pill"
            style={{ color: color.ink, background: color.soft, border: `1px solid color-mix(in srgb, ${color.hex} 30%, transparent)` }}
          >
            <CategoryGlyph category={cat} size={13} color={color.ink} />
            {categoryNameOf(cat, locale)}
          </span>
        ) : (
          <span />
        )}
        <span className="rm-pcard-ver">
          {ver ? `v${ver}` : ""}
          {author && <b> · {author}</b>}
        </span>
      </div>
      <div className="rm-pcard-body">
        <div className="rm-pcard-title">{name}</div>
        {oneLine && <div className="rm-pcard-desc">{oneLine}</div>}
      </div>
      <div className="rm-pcard-foot">
        <StatDownload n={listing.install_count} />
        <StatStar avg={listing.rating_avg} ko={ko} />
        <InstallBadge installed={listing.is_installed} locale={locale} onClick={() => onInstall(listing)} />
      </div>
    </Link>
  );
}

/** Package card — leads with policy count + (in a category view) how many of
 * its policies belong to the active category (why it surfaced). */
function PackageListCard({
  listing,
  meta,
  locale,
  onInstall,
}: {
  listing: ListingSummary;
  meta: { count: number; catCount: Map<CategoryKey, number>; ready: boolean };
  locale: MarketLocale;
  onInstall: (l: ListingSummary) => void;
}) {
  const ko = locale === "ko";
  const name = pickI18n(listing.display_name) || listing.slug;
  const official = listing.publisher_tier === "official";
  const author = publisherDisplay(listing.publisher_tier, listing.publisher_email, locale);
  // 패키지는 단일 카테고리 — 그 카테고리로 #태그. (멤버 slug 기반 catCount 는
  // 패키지 내부 slug 라 Others 로 떨어져 홈 카드가 #Others 로 보였다.)
  const pkgCat = listingCategoryKey(listing);
  const topCats = pkgCat ? [pkgCat] : [];
  const ver = listing.current_version;
  return (
    <Link to={`/market/${encodeURIComponent(listing.slug)}`} className="rm-pkgcard">
      <div className="rm-pkgcard-bar">
        <span className="rm-pkgcard-bar-l">
          <LayersIcon />
          {meta.ready
            ? ko ? `패키지 · 정책 ${meta.count}개` : `Package · ${meta.count} policies`
            : ko ? "패키지" : "Package"}
        </span>
        {ver && <span className="rm-pkgcard-bar-v">v{ver}</span>}
      </div>
      <div className="rm-pkgcard-body">
        <div>
          <div className="rm-pkgcard-title">{name}</div>
          <div className="rm-pkgcard-author">
            {author}
            {official && <span className="rm-vf"> ✓</span>}
          </div>
        </div>
        <div className="rm-pkgcard-tags">
          {topCats.map((c) => (
            <span key={c} className="rm-pkgcard-tag" style={{ color: CATEGORY_COLOR[c].ink }}>
              #{categoryNameOf(c, locale)}
            </span>
          ))}
        </div>
        <div className="rm-pkgcard-foot">
          <StatDownload n={listing.install_count} />
          <StatStar avg={listing.rating_avg} ko={ko} />
          <InstallBadge installed={listing.is_installed} locale={locale} onClick={() => onInstall(listing)} />
        </div>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Listing visuals — category-driven (sets get a package glyph)
// ─────────────────────────────────────────────────────────────────────────

/** A listing's category: server `category` if present (policies AND packages —
 * packages carry a single category, e.g. Perp), else slug-derived for policies.
 * A package without a valid server category has none (category-spanning). */
function listingCategoryKey(l: ListingSummary): CategoryKey | null {
  if (isCategoryKey(l.category)) return l.category;
  return l.kind === "policy" ? categoryOf(l.slug) : null;
}

function listingColor(l: ListingSummary) {
  const cat = listingCategoryKey(l);
  return cat ? CATEGORY_COLOR[cat] : null;
}

function parseSortParam(raw: string | null): ListingSort {
  if (raw === "new" || raw === "rating" || raw === "popular") return raw;
  return "popular";
}
