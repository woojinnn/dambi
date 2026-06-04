/* Scopeball Market — 앱 셸 + 상태 + 라우팅 + Tweaks
 *
 * SPA 통합 버전: 원본 standalone 번들의 NavRail은 dashboard SPA가 이미
 * 그리므로 제거. body 글로벌 class 조작도 .market-root 컨테이너로 옮겨서
 * 다른 페이지를 오염시키지 않게 함. 그 외 라우팅·검색·세트·토스트 동작은
 * 그대로 유지.
 */
import React, { useEffect, useRef, useState, Fragment } from "react";
import { Market } from "./data";
import { Ico, ICONS } from "./cards";
import { PolicyDetail, PackageDetail, SetPanel } from "./detail";
import { PopularScreen, BrowseScreen } from "./screens";
import { CommunityScreen } from "./community-screen";
import { UpdatesScreen } from "./updates-screen";
import {
  TweaksPanel, TweakSection, TweakRadio, TweakSlider, TweakToggle, useTweaks,
} from "./tweaks-panel";

const MK_TABS = [
  { key: "popular", label: { ko: "인기", en: "Popular" } },
  { key: "market", label: { ko: "마켓", en: "Market" } },
  { key: "community", label: { ko: "커뮤니티", en: "Community" } },
  { key: "updates", label: { ko: "업데이트", en: "Updates" } },
];

function Placeholder({ tab, locale }) {
  const txt = {
    community: { ko: "커뮤니티 — 검증된 평가 & 자유 토론", en: "Community — verified reviews & discussion" },
    updates: { ko: "업데이트 — 신규 공개 & 버전 갱신 피드", en: "Updates — new releases & version feed" },
  }[tab];
  return (
    <div className="mk-placeholder">
      <div className="pico"><Ico d={tab === "community" ? "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" : "M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"} w={30} /></div>
      <h2>{txt[locale === "en" ? "en" : "ko"]}</h2>
      <p><span data-lang="ko">이번 범위에는 포함되지 않았습니다 (준비 중).</span><span data-lang="en">Not part of this scope yet (coming soon).</span></p>
    </div>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "regular",
  "domainColor": "tonal",
  "dimSoon": 0.5,
  "packageStack": true
}/*EDITMODE-END*/;

export function MarketApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [locale, setLocale] = useState("ko");
  const [route, setRoute] = useState({ screen: "popular" });
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState("ready_first");
  const [setOpen, setSetOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);
  const toastTimer = useRef(null);
  const rootRef = useRef(null);

  // 원본은 document.body에 locale/density/dcolor/dimSoon 클래스를 박았다.
  // dashboard SPA에서 그대로 두면 다른 페이지까지 오염되므로 .market-root
  // 컨테이너 한정으로 옮긴다.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.setAttribute("data-locale", locale);
  }, [locale]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.className = [
      "market-root",
      "density-" + t.density,
      t.domainColor === "mono" ? "dcolor-mono" : "",
      t.packageStack ? "" : "nostack",
    ].filter(Boolean).join(" ");
    el.style.setProperty("--dim", String(t.dimSoon));
  }, [t.density, t.domainColor, t.packageStack, t.dimSoon]);

  // "/" focus search
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault(); searchRef.current && searchRef.current.focus();
      }
      if (e.key === "Escape") setSetOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function fireToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  function isInSet(type, id) { return items.some((i) => i.type === type && i.id === id); }
  function toggleItem(type, id, action) {
    if (action === "notify") {
      fireToast(locale === "en" ? "We'll notify you on release" : "출시되면 알림을 보내드릴게요");
      return;
    }
    setItems((prev) => {
      const exists = prev.some((i) => i.type === type && i.id === id);
      if (action === "remove" || (action !== "add" && exists)) {
        return prev.filter((i) => !(i.type === type && i.id === id));
      }
      if (exists) return prev;
      return prev.concat({ type, id });
    });
    if (action === "add") {
      fireToast(locale === "en" ? "Added to your set" : "세트에 담았어요");
    }
  }

  const bodyRef = useRef(null);
  function scrollTop() { setTimeout(() => { bodyRef.current && bodyRef.current.scrollTo({ top: 0 }); }, 0); }

  const ctx = {
    isInSet, toggleItem,
    openPolicy: (slug) => { setRoute({ screen: "policy", slug }); scrollTop(); },
    openPackage: (id) => { setRoute({ screen: "package", pkgId: id }); scrollTop(); },
    goBrowse: (opts) => {
      opts = opts || {};
      setFilters(opts.domain ? { domain: [opts.domain] } : {});
      setRoute({ screen: "browse" }); scrollTop();
    },
    goPopular: () => { setRoute({ screen: "popular" }); scrollTop(); },
    goCommunity: (slug) => { setRoute({ screen: "community", slug: slug || null }); scrollTop(); },
    commitDraft: () => { fireToast(locale === "en" ? "Added to your wallet draft" : "지갑 Draft에 일괄 추가했어요"); setSetOpen(false); },
    saveSet: () => fireToast(locale === "en" ? "Saved as your set" : "내 세트로 저장했어요"),
    shareSet: () => fireToast(locale === "en" ? "Share link copied" : "공유 링크를 복사했어요"),
  };

  // tab → screen sync
  const activeTab = (route.screen === "popular") ? "popular"
    : (route.screen === "community" || route.screen === "updates") ? route.screen : "market";

  function onTab(key) {
    if (key === "popular") ctx.goPopular();
    else if (key === "market") { setRoute({ screen: "browse" }); scrollTop(); }
    else { setRoute({ screen: key }); scrollTop(); }
  }

  let screen;
  if (route.screen === "popular") screen = <PopularScreen locale={locale} ctx={ctx} />;
  else if (route.screen === "browse") screen = <BrowseScreen locale={locale} query={query} setQuery={setQuery} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} ctx={ctx} />;
  else if (route.screen === "policy") screen = <PolicyDetail slug={route.slug} locale={locale} ctx={ctx} />;
  else if (route.screen === "package") screen = <PackageDetail pkgId={route.pkgId} locale={locale} ctx={ctx} />;
  else if (route.screen === "community") screen = <CommunityScreen locale={locale} ctx={ctx} fireToast={fireToast} initialSlug={route.slug} />;
  else if (route.screen === "updates") screen = <UpdatesScreen locale={locale} ctx={ctx} fireToast={fireToast} />;
  else screen = <Placeholder tab={route.screen} locale={locale} />;

  const setCount = items.length;

  return (
    <div ref={rootRef} className="market-root">
      {/* SPA 통합 본판은 NavRail 없이 시작 — main column만 */}
      <div className="market-main">
        <header className="mk-header">
          <span className="mk-title">Market</span>
          <div className="mk-tabs">
            {MK_TABS.map((tab) => (
              <button key={tab.key} className={"mk-tab" + (activeTab === tab.key ? " active" : "")} onClick={() => onTab(tab.key)}>
                {tab.label[locale === "en" ? "en" : "ko"]}
                {tab.soon && <span className="tab-soon">soon</span>}
              </button>
            ))}
          </div>
          <div className="mk-actions">
            <div className="mk-search">
              <svg className="s-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input ref={searchRef} value={query}
                placeholder={Market.tChrome("search.placeholder", locale)}
                onChange={(e) => { setQuery(e.target.value); if (route.screen !== "browse") { setRoute({ screen: "browse" }); } }}
                onFocus={() => { if (route.screen !== "browse") setRoute({ screen: "browse" }); }} />
              <span className="s-kbd">/</span>
            </div>
            <button className="mk-iconbtn" onClick={() => setSetOpen(true)} title="Set">
              <Ico d={"M3 7v13h18V7M3 7l3-4h12l3 4M3 7h18M9 11a3 3 0 0 0 6 0"} w={19} />
              {setCount > 0 && <span className="count">{setCount}</span>}
            </button>
            <div className="mk-locale">
              <button className={locale === "ko" ? "on" : ""} onClick={() => setLocale("ko")}>KO</button>
              <button className={locale === "en" ? "on" : ""} onClick={() => setLocale("en")}>EN</button>
            </div>
          </div>
        </header>
        <div className="mk-body" ref={bodyRef}>
          {screen}
        </div>
      </div>

      <SetPanel open={setOpen} onClose={() => setSetOpen(false)} locale={locale} items={items} ctx={ctx} />

      <div className={"mk-toast" + (toast ? " show" : "")}>
        {toast && <Fragment><Ico d={ICONS.check} w={16} />{toast}</Fragment>}
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label={locale === "en" ? "Cards" : "카드"} />
        <TweakRadio label={locale === "en" ? "Density" : "밀도"} value={t.density}
          options={["compact", "regular", "comfy"]} onChange={(v) => setTweak("density", v)} />
        <TweakToggle label={locale === "en" ? "Package stack" : "패키지 스택 비주얼"} value={t.packageStack}
          onChange={(v) => setTweak("packageStack", v)} />
        <TweakSection label={locale === "en" ? "Domain color" : "도메인 색"} />
        <TweakRadio label={locale === "en" ? "Mapping" : "매핑 방식"} value={t.domainColor}
          options={["tonal", "mono"]} onChange={(v) => setTweak("domainColor", v)} />
        <TweakSection label={locale === "en" ? "Readiness" : "작동 상태"} />
        <TweakSlider label={locale === "en" ? "Coming-soon dim" : "준비중 흐림"} value={t.dimSoon}
          min={0.25} max={0.75} step={0.05} onChange={(v) => setTweak("dimSoon", v)} />
      </TweaksPanel>
    </div>
  );
}
