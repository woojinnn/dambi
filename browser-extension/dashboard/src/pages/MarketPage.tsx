import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  listListings,
  pickI18n,
  type ListingKind,
  type ListingSort,
  type ListingSummary,
} from "../server-api";
import { formatYmd, publisherDisplay } from "../server-api/market";
import { Topbar } from "../shell/Topbar";

import {
  CATEGORY_COLOR,
  CATEGORY_NAME,
  CATEGORY_ORDER,
  CategoryGlyph,
  categoryNameOf,
  categoryOf,
  domainNameOf,
  isCategoryKey,
  type CategoryKey,
} from "./market-domain";
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

  return (
    <>
      <Topbar
        here="Market"
        subtitle={view === "list" ? (locale === "ko" ? "전체 목록" : "All listings") : undefined}
        showNotifications={false}
        showSearch={false}
        right={
          view === "list" ? (
            <Link to="/market" className="back-link">
              ← {locale === "ko" ? "마켓 홈" : "Market home"}
            </Link>
          ) : undefined
        }
      />

      {view === "list" ? (
        <ListView locale={locale} initialParams={params} />
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
function MarketSearch({ locale }: { locale: MarketLocale }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  return (
    <form
      className="market-hero-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        navigate(term ? `/market?view=list&q=${encodeURIComponent(term)}` : "/market?view=list");
      }}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={
          locale === "ko"
            ? "정책 · 패키지 검색"
            : "Search policies & packages"
        }
        aria-label={locale === "ko" ? "마켓 검색" : "Search the market"}
      />
      {q && (
        <button
          type="button"
          className="market-hero-search-clear"
          onClick={() => setQ("")}
          aria-label="clear"
        >
          ×
        </button>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Landing view
// ─────────────────────────────────────────────────────────────────────────

function LandingView({ locale }: { locale: MarketLocale }) {
  const heroQ = useQuery({
    queryKey: ["market-latest-packages"],
    queryFn: () =>
      listListings({
        kind: "set",
        sort: "new",
        limit: 6,
      }),
  });

  // Category counts are computed client-side from a single 100-item fetch;
  // 35 seed policies + 3 seed packages fits comfortably under that ceiling.
  const allForCountsQ = useQuery({
    queryKey: ["market-all-for-categories"],
    queryFn: () => listListings({ limit: 100 }),
  });

  // Category counts derive from each policy's slug (see `categoryOf`). Sets are
  // packages, not single-action policies, so they don't count toward a tile.
  const categoryCounts = useMemo(() => {
    const map = new Map<CategoryKey, number>();
    (allForCountsQ.data ?? []).forEach((l) => {
      const c = listingCategoryKey(l);
      if (c) map.set(c, (map.get(c) ?? 0) + 1);
    });
    return map;
  }, [allForCountsQ.data]);

  return (
    <div className="market-landing-v2">
      <MarketSearch locale={locale} />
      <div className="market-cols">
        <div className="market-col-main">
          <HeroPackages items={heroQ.data ?? []} loading={heroQ.isLoading} locale={locale} />
          <CategoryGrid counts={categoryCounts} locale={locale} />
        </div>
        <aside className="market-col-side">
          <RankingSidebar locale={locale} />
        </aside>
      </div>
    </div>
  );
}

function HeroPackages({
  items,
  loading,
  locale,
}: {
  items: ListingSummary[];
  loading: boolean;
  locale: MarketLocale;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };
  const goTo = (i: number) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  return (
    <section className="ml-section">
      <header className="ml-section-head">
        <span className="ml-eyebrow">LATEST PACKAGES</span>
      </header>
      {loading && <div className="ml-status">{locale === "ko" ? "불러오는 중…" : "Loading…"}</div>}
      {!loading && items.length === 0 && (
        <div className="ml-status">
          {locale === "ko" ? "공개된 패키지가 없습니다." : "No packages yet."}
        </div>
      )}
      {items.length > 0 && (
        <div className="pkg-carousel-wrap">
          <div className="pkg-carousel-viewport">
            {items.length > 1 && (
              <button
                type="button"
                className="carousel-arrow left"
                onClick={() => page(-1)}
                aria-label={locale === "ko" ? "이전" : "previous"}
              >
                ‹
              </button>
            )}
            <div className="pkg-carousel" ref={scrollerRef} onScroll={onScroll}>
              {items.map((l) => (
                <PackageCard key={l.id} listing={l} locale={locale} />
              ))}
            </div>
            {items.length > 1 && (
              <button
                type="button"
                className="carousel-arrow right"
                onClick={() => page(1)}
                aria-label={locale === "ko" ? "다음" : "next"}
              >
                ›
              </button>
            )}
          </div>
          {items.length > 1 && (
            <div className="carousel-dots" role="tablist">
              {items.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  className={`carousel-dot${i === active ? " is-active" : ""}`}
                  aria-label={`${i + 1}`}
                  aria-selected={i === active}
                  onClick={() => goTo(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Full-width lead package card — one fills the carousel viewport; the
 * carousel pages through them one at a time (Four-Pillars hero feel). */
function PackageCard({ listing, locale }: { listing: ListingSummary; locale: MarketLocale }) {
  const name = pickI18n(listing.display_name, locale) || listing.slug;
  const desc = pickI18n(listing.description, locale);
  return (
    <Link to={`/market/${encodeURIComponent(listing.slug)}`} className="featured-card">
      <div className="featured-card-glyph" aria-hidden="true">
        <PackageGlyph size={168} color="rgba(99, 126, 89, 0.18)" />
      </div>
      <div className="featured-card-body">
        <span className="featured-card-tag">
          {locale === "ko" ? "패키지" : "Package"}
          {listing.publisher_tier === "official" && (
            <span className="featured-card-official"> · {locale === "ko" ? "공식" : "Official"}</span>
          )}
        </span>
        <h3 className="featured-card-name">{name}</h3>
        {desc && <p className="featured-card-desc">{desc}</p>}
        <div className="featured-card-foot">
          <span className="featured-card-stat">
            <strong>{listing.install_count}</strong> {locale === "ko" ? "설치" : "installs"}
          </span>
          <span className={`mc-install-badge featured-card-cta${listing.is_installed ? " is-installed" : ""}`}>
            {listing.is_installed
              ? locale === "ko" ? "설치됨" : "Installed"
              : locale === "ko" ? "받기" : "Install"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function CategoryGrid({
  counts,
  locale,
}: {
  counts: Map<CategoryKey, number>;
  locale: MarketLocale;
}) {
  return (
    <section className="ml-section">
      <header className="ml-section-head">
        <h2>{locale === "ko" ? "카테고리" : "Categories"}</h2>
        <p className="ml-section-sub">
          {locale === "ko"
            ? "행위(action)별로 정리된 정책·패키지를 탐색하세요."
            : "Browse policies and packages by the action they guard."}
        </p>
      </header>
      <div className="cat-grid">
        {CATEGORY_ORDER.map((c) => {
          const color = CATEGORY_COLOR[c];
          const count = counts.get(c) ?? 0;
          return (
            <Link
              key={c}
              to={`/market?view=list&category=${c}`}
              className={`cat-tile family-${color.family}`}
              style={{ background: color.soft }}
            >
              <div className="cat-tile-icon">
                <CategoryGlyph category={c} size={22} color={color.hex} />
              </div>
              <div className="cat-tile-name" style={{ color: color.ink }}>
                {CATEGORY_NAME[c][locale]}
              </div>
              <div className="cat-tile-count">{count}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function RankingSidebar({ locale }: { locale: MarketLocale }) {
  const [tab, setTab] = useState<ListingKind>("set");
  const topQ = useQuery({
    queryKey: ["market-top", tab],
    queryFn: () =>
      listListings({
        kind: tab,
        sort: "popular",
        limit: 10,
      }),
  });

  return (
    <section className="ml-section">
      <header className="ml-section-head">
        <span className="ml-eyebrow">TRENDING</span>
      </header>
      <div className="ranking-sidebar">
        <div className="rs-toggle-wrap">
          <div className="rs-toggle" role="group" aria-label="kind">
            <button
              type="button"
              className={`rs-tab${tab === "set" ? " is-active" : ""}`}
              onClick={() => setTab("set")}
            >
              {locale === "ko" ? "패키지" : "Package"}
            </button>
            <button
              type="button"
              className={`rs-tab${tab === "policy" ? " is-active" : ""}`}
              onClick={() => setTab("policy")}
            >
              {locale === "ko" ? "정책" : "Policy"}
            </button>
          </div>
        </div>

        {topQ.isLoading && <div className="ml-status">{locale === "ko" ? "불러오는 중…" : "Loading…"}</div>}

      <ol className="rs-list">
        {(topQ.data ?? []).map((l, i) => {
          const color = listingColor(l);
          return (
            <li key={l.id} className="rs-row">
              <span className={`rs-rank rs-rank-${i < 3 ? i + 1 : "n"}`}>{i + 1}</span>
              <Link to={`/market/${encodeURIComponent(l.slug)}`} className="rs-link">
                <div className="rs-icon" style={color ? { background: color.soft } : undefined}>
                  <ListingIcon listing={l} size={14} />
                </div>
                <div className="rs-meta">
                  <div className="rs-name">{pickI18n(l.display_name, locale) || l.slug}</div>
                  <div className="rs-sub">
                    {publisherDisplay(l.publisher_tier, l.publisher_email, locale)}
                  </div>
                </div>
                <div className="rs-count">
                  <span className="rs-count-num">{l.install_count}</span>
                  <span className="rs-count-label">
                    {locale === "ko" ? "설치" : "inst."}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

        <Link to={`/market?view=list&kind=${tab}&sort=popular`} className="rs-more">
          {locale === "ko" ? "전체 순위 보기 →" : "View full ranking →"}
        </Link>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// List view (`?view=list`)
// ─────────────────────────────────────────────────────────────────────────

function ListView({
  locale,
  initialParams,
}: {
  locale: MarketLocale;
  initialParams: URLSearchParams;
}) {
  const initialKind = parseKindParam(initialParams.get("kind"));
  const initialDomain = initialParams.get("domain") ?? "";
  const initialCategory = initialParams.get("category") ?? "";
  const initialSort = parseSortParam(initialParams.get("sort"));
  const initialQ = initialParams.get("q") ?? "";

  const [kind, setKind] = useState<ListingKind | "all">(initialKind);
  const [domain, setDomain] = useState<string>(initialDomain);
  const [category, setCategory] = useState<string>(initialCategory);
  const [sort, setSort] = useState<ListingSort>(initialSort);
  const [q, setQ] = useState(initialQ);
  const [search, setSearch] = useState(initialQ);

  const listingsQ = useQuery({
    queryKey: ["market-listings", { kind, domain, category, sort, q: search }],
    queryFn: () =>
      listListings({
        kind: kind === "all" ? undefined : kind,
        domain: domain || undefined,
        category: isCategoryKey(category) ? category : undefined,
        sort,
        q: search.trim() || undefined,
        limit: 60,
      }),
  });

  // `category` is now a real server column (migration 0003) — filtered DB-side.
  const visible = listingsQ.data ?? [];

  return (
    <div className="market-wrap">
      <header className="market-controls">
        <div className="market-tabs">
          <KindTab active={kind === "all"} onClick={() => setKind("all")}>
            {locale === "ko" ? "전체" : "All"}
          </KindTab>
          <KindTab active={kind === "policy"} onClick={() => setKind("policy")}>
            {locale === "ko" ? "정책" : "Policy"}
          </KindTab>
          <KindTab active={kind === "set"} onClick={() => setKind("set")}>
            {locale === "ko" ? "패키지" : "Package"}
          </KindTab>
        </div>
        {isCategoryKey(category) && (
          <div className="market-active-filter">
            <span className="map-label">
              {locale === "ko" ? "카테고리" : "Category"}:
            </span>
            <span className="map-value">{categoryNameOf(category, locale)}</span>
            <button
              type="button"
              className="map-clear"
              onClick={() => setCategory("")}
              aria-label="clear category"
            >
              ×
            </button>
          </div>
        )}
        {domain && (
          <div className="market-active-filter">
            <span className="map-label">
              {locale === "ko" ? "도메인" : "Domain"}:
            </span>
            <span className="map-value">{domainNameOf(domain, locale)}</span>
            <button
              type="button"
              className="map-clear"
              onClick={() => setDomain("")}
              aria-label="clear domain"
            >
              ×
            </button>
          </div>
        )}
        <form
          className="market-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q);
          }}
        >
          <input
            type="text"
            placeholder={locale === "ko" ? "정책 이름으로 검색" : "Search by name"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="market-search-clear"
              onClick={() => {
                setQ("");
                setSearch("");
              }}
            >
              ×
            </button>
          )}
        </form>
        <select
          className="market-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as ListingSort)}
          aria-label="sort"
        >
          <option value="popular">{locale === "ko" ? "인기순" : "Most popular"}</option>
          <option value="new">{locale === "ko" ? "신규순" : "Newest"}</option>
          <option value="rating">{locale === "ko" ? "별점순" : "Top rated"}</option>
        </select>
      </header>

      {listingsQ.isLoading && (
        <div className="market-status">{locale === "ko" ? "불러오는 중…" : "Loading…"}</div>
      )}

      {listingsQ.isError && (
        <div className="market-status market-error">
          {locale === "ko" ? "마켓 로드 실패" : "Market load failed"}:{" "}
          {(listingsQ.error as Error).message}
        </div>
      )}

      {!listingsQ.isLoading && !listingsQ.isError && visible.length === 0 && (
        <div className="market-empty">
          <h2>{locale === "ko" ? "결과가 없습니다" : "No matches"}</h2>
          <p>
            {locale === "ko"
              ? "필터 조건을 바꾸거나 검색어를 비워보세요."
              : "Try a different filter or clear the search."}
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="market-grid">
          {visible.map((l) => (
            <ListingCard key={l.id} listing={l} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}

function KindTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`market-tab${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListingCard({
  listing,
  locale,
}: {
  listing: ListingSummary;
  locale: MarketLocale;
}) {
  const name = pickI18n(listing.display_name, locale);
  const desc = pickI18n(listing.description, locale);
  const cat = listingCategoryKey(listing);
  const color = listingColor(listing);
  const categoryLabel = cat ? categoryNameOf(cat, locale) : null;

  const accentStyle: React.CSSProperties = color
    ? { borderLeft: `3px solid ${color.hex}` }
    : {};

  return (
    <Link
      to={`/market/${encodeURIComponent(listing.slug)}`}
      className={`market-card kind-${listing.kind}${color ? ` family-${color.family}` : ""}`}
      style={accentStyle}
    >
      <div className="mc-head">
        <div className="mc-icon-wrap" style={color ? { background: color.soft } : undefined}>
          <ListingIcon listing={listing} size={18} />
        </div>
        <span className={`mc-kind kind-${listing.kind}`}>
          {listing.kind === "set"
            ? locale === "ko" ? "패키지" : "Package"
            : locale === "ko" ? "정책" : "Policy"}
        </span>
        {listing.severity && (
          <span className={`mc-sev sev-${listing.severity}`}>
            {listing.severity === "deny"
              ? locale === "ko" ? "차단" : "Block"
              : locale === "ko" ? "경고" : "Warn"}
          </span>
        )}
        {listing.publisher_tier !== "community" && (
          <span className={`mc-tier tier-${listing.publisher_tier}`}>
            {listing.publisher_tier === "official"
              ? locale === "ko" ? "공식" : "Official"
              : locale === "ko" ? "검증" : "Verified"}
          </span>
        )}
      </div>
      <h3 className="mc-name">{name || listing.slug}</h3>
      {desc && <p className="mc-desc">{desc}</p>}
      <div className="mc-publisher">
        <span className="mc-publisher-name">
          {publisherDisplay(listing.publisher_tier, listing.publisher_email, locale)}
        </span>
        <span className="mc-publisher-dot">·</span>
        <span className="mc-publisher-date">{formatYmd(listing.created_at)}</span>
      </div>
      {categoryLabel && <div className="mc-domain">{categoryLabel}</div>}
      <div className="mc-foot">
        <span className="mc-stat">
          <span className="mc-stat-num">{listing.install_count}</span>{" "}
          {locale === "ko" ? "설치" : "installs"}
        </span>
        {listing.rating_count > 0 && listing.rating_avg != null && (
          <span className="mc-stat">
            ★ {listing.rating_avg.toFixed(1)}
            <span className="mc-stat-mute"> ({listing.rating_count})</span>
          </span>
        )}
        <span
          className={`mc-install-badge${listing.is_installed ? " is-installed" : ""}`}
        >
          {listing.is_installed
            ? locale === "ko" ? "설치됨" : "Installed"
            : locale === "ko" ? "설치" : "Install"}
        </span>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Listing visuals — category-driven (sets get a package glyph)
// ─────────────────────────────────────────────────────────────────────────

/** A listing's category: server `category` if present, else slug-derived.
 * Sets (packages) span categories, so they have none. */
function listingCategoryKey(l: ListingSummary): CategoryKey | null {
  if (l.kind !== "policy") return null;
  return isCategoryKey(l.category) ? l.category : categoryOf(l.slug);
}

function listingColor(l: ListingSummary) {
  const cat = listingCategoryKey(l);
  return cat ? CATEGORY_COLOR[cat] : null;
}

/** Box/package line glyph for set listings. */
function PackageGlyph({ size = 18, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "var(--slate-400)"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8" />
    </svg>
  );
}

/** Unified listing icon: category glyph for policies, package glyph for sets.
 * Never renders an empty box (the old `domain` glyph was null for sets). */
function ListingIcon({ listing, size = 18 }: { listing: ListingSummary; size?: number }) {
  const cat = listingCategoryKey(listing);
  if (cat) return <CategoryGlyph category={cat} size={size} color={CATEGORY_COLOR[cat].hex} />;
  return <PackageGlyph size={size} />;
}

function parseKindParam(raw: string | null): ListingKind | "all" {
  if (raw === "policy" || raw === "set") return raw;
  return "all";
}

function parseSortParam(raw: string | null): ListingSort {
  if (raw === "new" || raw === "rating" || raw === "popular") return raw;
  return "popular";
}
