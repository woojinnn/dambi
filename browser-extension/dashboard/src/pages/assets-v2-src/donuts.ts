/* Donuts — ASS_v2 prototype donut pair (지갑별 자산 비율 ↔ 자산 분포), live-data wired.
 *
 * Ported verbatim from `_donut-inline.js`: the SVG segment build, the count-up
 * center, hover preview, and the two-way cross-link controller are unchanged.
 * Only the data source changed — instead of the hardcoded WALLETS/PLACES/
 * HOLDINGS demo, the two donut configs (+ adjacency) come from
 * `window.PASU_DATA.donut` (the live DonutData from useAssetsData). A small
 * fallback keeps the prototype rendering standalone when PASU_DATA is absent.
 *
 * KEEP: window.PASU_CHAIN_LOGOS / window.PASU_TOKEN_LOGOS (consumed by
 * assets-app's chain chips + token avatars) are still seeded here.
 *
 * CSP: the legend chain-logo <img> drops its inline onerror; failures are
 * handled by a capture-phase delegated "error" listener on root (data-onerr).
 */

interface DonutCfgItem {
  key: string;
  name: string;
  color: string;
  usd: number;
  pct: number;
  logo?: string;
}
interface DonutCfg {
  centerK: string;
  total: number;
  items: DonutCfgItem[];
}
interface PasuDonutGroup {
  centerLabel: string;
  total: number;
  items: Array<{ key: string; name: string; color: string; usd: number; pct: number; chainName?: string }>;
}
interface PasuDonut {
  wallets: PasuDonutGroup;
  assets: PasuDonutGroup;
  /** Per-wallet asset distribution (자산 분포 scoped to one wallet). */
  walletAssets?: Record<string, PasuDonutGroup>;
  adjacency: { walletToAsset: Record<string, string[]>; assetToWallet: Record<string, string[]> };
}

export function initDonuts(root: HTMLElement): () => void {
  const C = 2 * Math.PI * 45; // circumference, r=45
  const GAP = 3; // dash gap between segments

  // 실제 체인 로고 (브랜드 마크) — 자산 분포 도넛 범례 + Holdings 체인 칩 공용
  const LOGOS: Record<string, string> = {
    eth: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#627EEA"/><g fill="#fff"><path d="M12 3.2 7 12l5 2.95z" fill-opacity=".62"/><path d="M12 3.2 17 12l-5 2.95z"/><path d="M12 16.05 7 13.1l5 7.7z" fill-opacity=".62"/><path d="M12 16.05 17 13.1l-5 7.7z"/></g></svg>',
    base: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#0052FF"/><path d="M14.2 6.4A6.9 6.9 0 1 0 14.2 17.6Z" fill="#fff"/></svg>',
    arb: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2D374B"/><path d="M12 5.6 6.7 17.4 9.6 17.4z" fill="#28A0F0"/><path d="M12 5.6 17.3 17.4 14.4 17.4z" fill="#fff"/><path d="M12 5.6 13.2 8.2 10.8 8.2z" fill="#fff"/></svg>',
    hl: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#173E37"/><g stroke="#98FCE4" stroke-width="2.3" stroke-linecap="round" fill="none"><path d="M7.7 7v10"/><path d="M16.3 7v10"/><path d="M7.7 12.2c1.6-2.3 7-2.3 8.6 0"/></g></svg>',
  };
  // assets-app.js(체인 칩)에서 재사용
  window.PASU_CHAIN_LOGOS = {
    byName: { Ethereum: LOGOS.eth, Base: LOGOS.base, Arbitrum: LOGOS.arb, Hyperliquid: LOGOS.hl },
  };

  // 토큰 아바타 (실제 로고 마크) — Holdings 표 자산 아이콘에서 재사용
  const DIAMOND =
    '<g fill="#fff"><path d="M12 3.2 7 12l5 2.95z" fill-opacity=".62"/><path d="M12 3.2 17 12l-5 2.95z"/><path d="M12 16.05 7 13.1l5 7.7z" fill-opacity=".62"/><path d="M12 16.05 17 13.1l-5 7.7z"/></g>';
  window.PASU_TOKEN_LOGOS = {
    ETH: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#627EEA"/>' + DIAMOND + "</svg>",
    WETH: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#5A6B8C"/>' + DIAMOND + "</svg>",
    cbETH: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#0052FF"/>' + DIAMOND + "</svg>",
    USDC: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2775CA"/><path d="M12 5.5v13M9.6 9.3c0-1.3 1-2.1 2.4-2.1s2.4.7 2.4 2c0 2.6-4.9 1.4-4.9 4 0 1.3 1 2.1 2.5 2.1s2.5-.8 2.5-2.1" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>',
    ARB: LOGOS.arb,
  };

  // 실제 체인 브랜드 로고 (이미지) — 자산 분포 도넛 범례용. 체인 이름 → CDN 이미지.
  // (eth/arb/base = TrustWallet, hl = simplr) — 깨지면 capture error 위임으로 숨김.
  const CHAIN_IMG_BY_NAME: Record<string, string> = {
    Ethereum: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    Arbitrum: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
    Base: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
    Optimism: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
    Polygon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
    Hyperliquid: "https://cdn.jsdelivr.net/gh/simplr-sh/coin-logos/images/hyperliquid/large.png",
  };
  function chainImgByName(name: string | undefined): string {
    if (!name) return "";
    const url = CHAIN_IMG_BY_NAME[name];
    if (url) {
      return '<img class="dli-img" src="' + url + '" alt="' + name + '" data-onerr="hide">';
    }
    const L = (window.PASU_CHAIN_LOGOS && window.PASU_CHAIN_LOGOS.byName) || {};
    return L[name] || "";
  }

  // ── live → build() cfg shape ─────────────────────────────────────────────
  // build() reads cfg.{centerK,total,items[].{key,name,color,usd,pct,logo}}.
  // DonutData groups carry {centerLabel,total,items[].{...,chainName}} — map
  // centerLabel→centerK and chainName→logo (chain brand image / inline svg).
  function toCfg(g: PasuDonutGroup | null | undefined, fallback: DonutCfg): DonutCfg {
    if (!g) return fallback;
    return {
      centerK: g.centerLabel,
      total: g.total,
      items: g.items.map((it) => ({
        key: it.key,
        name: it.name,
        color: it.color,
        usd: it.usd,
        pct: it.pct,
        logo: it.chainName ? chainImgByName(it.chainName) : undefined,
      })),
    };
  }

  // Standalone fallback (PASU_DATA absent) — empty donuts, no demo data.
  const FALLBACK: DonutCfg = { centerK: "총 자산", total: 0, items: [] };

  function readDonut(): PasuDonut | null {
    return (window.PASU_DATA as { donut?: PasuDonut } | undefined)?.donut ?? null;
  }
  let dd: PasuDonut | null = readDonut();

  const DONUTS: Record<string, DonutCfg> = {
    "donut-wallets": dd ? toCfg(dd.wallets, FALLBACK) : FALLBACK,
    "donut-assets": dd ? toCfg(dd.assets, FALLBACK) : FALLBACK,
  };
  const ADJ: Record<string, Record<string, string[]>> = {};
  function refreshAdj(): void {
    if (dd) {
      ADJ["donut-wallets→donut-assets"] = dd.adjacency.walletToAsset; // walletKey → [assetKey]
      ADJ["donut-assets→donut-wallets"] = dd.adjacency.assetToWallet; // assetKey  → [walletKey]
    } else {
      ADJ["donut-wallets→donut-assets"] = {};
      ADJ["donut-assets→donut-wallets"] = {};
    }
  }
  refreshAdj();

  interface SegRegistry {
    getSel: () => number | null;
    nameAt: (i: number) => string;
    keyAt: (i: number) => string;
    indexOfKey: (key: string) => number;
    selectLocal: (i: number) => void;
    clearLocal: () => void;
    setLinked: (indices: number[], ctxLabel: string, ctxNames: string) => void;
    clearLinked: () => void;
  }
  const registry: Record<string, SegRegistry> = {};

  function money(n: number): string {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function build(id: string, cfg: DonutCfg): void {
    const card = root.querySelector<HTMLElement>("#" + id);
    if (!card) return;
    const svg = card.querySelector(".donut") as SVGElement | null;
    const center = card.querySelector(".donut-center") as HTMLElement | null;
    const legend = card.querySelector(".donut-legend") as HTMLElement | null;
    const fig = card.querySelector(".donut-figure") as HTMLElement | null;
    if (!svg || !center || !legend || !fig) return;
    const NS = "http://www.w3.org/2000/svg";

    // track ring
    const track = document.createElementNS(NS, "circle");
    track.setAttribute("cx", "60");
    track.setAttribute("cy", "60");
    track.setAttribute("r", "45");
    track.setAttribute("fill", "none");
    track.setAttribute("stroke", "#EEF0ED");
    track.setAttribute("stroke-width", "13");
    svg.appendChild(track);

    const segEls: SVGElement[] = [];
    const legEls: HTMLElement[] = [];
    let acc = 0;
    cfg.items.forEach(function (it, i) {
      const len = (it.pct / 100) * C;
      const seg = document.createElementNS(NS, "circle");
      seg.setAttribute("class", "donut-seg");
      seg.setAttribute("cx", "60");
      seg.setAttribute("cy", "60");
      seg.setAttribute("r", "45");
      seg.setAttribute("stroke", it.color);
      seg.setAttribute("stroke-dasharray", Math.max(len - GAP, 0.5) + " " + (C - Math.max(len - GAP, 0.5)));
      seg.setAttribute("stroke-dashoffset", String(-acc));
      svg.appendChild(seg);
      segEls.push(seg);
      acc += len;

      const li = document.createElement("button");
      li.type = "button";
      li.className = "donut-leg-item";
      li.innerHTML =
        (it.logo
          ? '<span class="dli-logo">' + it.logo + "</span>"
          : '<span class="dli-dot" style="background:' + it.color + '"></span>') +
        '<span class="dli-name">' + it.name + "</span>" +
        '<span class="dli-val">' + money(it.usd) + "</span>";
      legend.appendChild(li);
      legEls.push(li);

      function onClick() {
        controller.toggle(id, i);
      }
      seg.addEventListener("click", onClick);
      li.addEventListener("click", onClick);
      function canHover() {
        return sel === null && !fig!.classList.contains("has-link");
      }
      seg.addEventListener("mouseenter", function () {
        if (canHover()) preview(i);
      });
      li.addEventListener("mouseenter", function () {
        if (canHover()) preview(i);
      });
      seg.addEventListener("mouseleave", function () {
        if (canHover()) showTotal(false);
      });
      li.addEventListener("mouseleave", function () {
        if (canHover()) showTotal(false);
      });
    });

    let sel: number | null = null;

    function setCenter(k: string, v: string, sub: string, animate: boolean) {
      center!.innerHTML =
        '<span class="dc-k">' + k + "</span>" +
        '<span class="dc-v">' + v + "</span>" +
        (sub ? '<span class="dc-sub">' + sub + "</span>" : "");
      if (animate) {
        center!.animate(
          [
            { transform: "scale(0.92)", opacity: 0.4 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 260, easing: "cubic-bezier(0.34,1.56,0.64,1)" },
        );
      }
    }
    function preview(i: number) {
      const it = cfg.items[i];
      // 비율 도넛 — % 를 크게(dc-v), 금액을 작게(dc-sub) 표시.
      setCenter(it.name, it.pct.toFixed(2) + "%", money(it.usd), true);
    }
    function showTotal(animate: boolean) {
      setCenter(cfg.centerK, money(cfg.total), "", animate);
    }

    function selectLocal(i: number) {
      sel = i;
      fig!.classList.remove("has-link");
      segEls.forEach(function (s) {
        s.classList.remove("linked");
      });
      legEls.forEach(function (l) {
        l.classList.remove("linked");
      });
      fig!.classList.add("has-sel");
      segEls.forEach(function (s, j) {
        s.classList.toggle("sel", j === i);
      });
      legEls.forEach(function (l, j) {
        l.classList.toggle("sel", j === i);
      });
      preview(i);
    }
    function clearLocal() {
      sel = null;
      fig!.classList.remove("has-sel");
      segEls.forEach(function (s) {
        s.classList.remove("sel");
      });
      legEls.forEach(function (l) {
        l.classList.remove("sel");
      });
      if (!fig!.classList.contains("has-link")) showTotal(true);
    }
    // 파트너 도넛에서 넘어온 연관 강조 (여러 세그먼트)
    function setLinked(indices: number[], ctxLabel: string, _ctxNames: string) {
      if (!indices || !indices.length) {
        clearLinked();
        return;
      }
      fig!.classList.remove("has-sel");
      segEls.forEach(function (s) {
        s.classList.remove("sel");
      });
      legEls.forEach(function (l) {
        l.classList.remove("sel");
      });
      fig!.classList.add("has-link");
      segEls.forEach(function (s, j) {
        s.classList.toggle("linked", indices.indexOf(j) >= 0);
      });
      legEls.forEach(function (l, j) {
        l.classList.toggle("linked", indices.indexOf(j) >= 0);
      });
      const heading = id === "donut-assets" ? "포함 자산군" : "보유 지갑";
      center!.innerHTML =
        '<span class="dc-k">' + heading + "</span>" + '<span class="dc-sub">' + ctxLabel + " 기준</span>";
      center!.animate(
        [
          { transform: "scale(0.94)", opacity: 0.45 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 260, easing: "cubic-bezier(0.34,1.56,0.64,1)" },
      );
    }
    function clearLinked() {
      fig!.classList.remove("has-link");
      segEls.forEach(function (s) {
        s.classList.remove("linked");
      });
      legEls.forEach(function (l) {
        l.classList.remove("linked");
      });
      if (sel === null) showTotal(true);
    }

    // count-up center on load (sync fallback first so text always shows)
    showTotal(false);
    let start: number | null = null;
    const dur = 950;
    function tick(t: number) {
      if (start === null) start = t;
      const p = Math.min((t - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      if (sel === null && !fig!.classList.contains("has-link")) setCenter(cfg.centerK, money(cfg.total * e), "", false);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // 총액 중앙 등장 (간결한 페이드 + 카운트업)
    fig.animate(
      [
        { opacity: 0, transform: "scale(0.985)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 620, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
    );

    registry[id] = {
      getSel: function () {
        return sel;
      },
      nameAt: function (i) {
        return cfg.items[i].name;
      },
      keyAt: function (i) {
        return cfg.items[i].key;
      },
      indexOfKey: function (key) {
        for (let k = 0; k < cfg.items.length; k++) {
          if (cfg.items[k].key === key) return k;
        }
        return -1;
      },
      selectLocal: selectLocal,
      clearLocal: clearLocal,
      setLinked: setLinked,
      clearLinked: clearLinked,
    };
  }

  // 지갑 선택 → 자산 분포를 그 지갑 자산만으로 필터(비율 재계산)해 재렌더.
  // 자산 선택 → 보유 지갑 강조(기존 cross-link 유지). walletFilter 가 켜진
  // 동안 자산 도넛은 이미 한 지갑으로 좁혀진 뷰라 cross-link 토글을 막는다.
  let walletFilter: string | null = null;

  // 한쪽 도넛만 비우고 다시 그린다(자산 분포 필터 전환/복원용). clearDonuts 는
  // 둘 다 날리므로 부적합 — 지갑 선택은 자산 도넛만 갈아끼워야 한다.
  function rebuildOne(id: string, cfg: DonutCfg): void {
    const card = root.querySelector<HTMLElement>("#" + id);
    if (!card) return;
    const svg = card.querySelector(".donut");
    const legend = card.querySelector(".donut-legend");
    const center = card.querySelector(".donut-center");
    if (svg) svg.innerHTML = "";
    if (legend) legend.innerHTML = "";
    if (center) center.innerHTML = "";
    delete registry[id];
    build(id, cfg);
  }
  function assetsCfgForWallet(walletKey: string): DonutCfg | null {
    const wa = dd?.walletAssets;
    const g = wa ? wa[walletKey] : undefined;
    return g ? toCfg(g, FALLBACK) : null;
  }

  const controller = {
    toggle: function (id: string, i: number) {
      // 필터된 자산 도넛은 cross-link 비활성 (이미 한 지갑 뷰)
      if (id === "donut-assets" && walletFilter) return;
      if (registry[id].getSel() === i) {
        this.clearAll();
        return;
      }
      this.select(id, i);
    },
    select: function (id: string, i: number) {
      if (id === "donut-wallets") {
        const me = registry["donut-wallets"],
          assets = registry["donut-assets"];
        assets.clearLinked();
        assets.clearLocal();
        me.clearLinked();
        me.selectLocal(i);
        const walletKey = me.keyAt(i);
        const filtered = assetsCfgForWallet(walletKey);
        if (filtered) {
          // 자산 분포 = 이 지갑의 자산만, 비율 재계산, 중앙 총액 = 지갑 총액
          walletFilter = walletKey;
          rebuildOne("donut-assets", filtered);
        } else {
          // 지갑별 자산 데이터가 없으면 기존 강조로 폴백
          walletFilter = null;
          const keys = (ADJ["donut-wallets→donut-assets"] || {})[walletKey] || [];
          const idxs: number[] = [],
            names: string[] = [];
          keys.forEach(function (k) {
            const idx = assets.indexOfKey(k);
            if (idx >= 0) {
              idxs.push(idx);
              names.push(assets.nameAt(idx));
            }
          });
          assets.setLinked(idxs, me.nameAt(i), names.join(" · "));
        }
        return;
      }
      // id === "donut-assets": 자산 → 보유 지갑 강조 (기존 동작 유지)
      const me = registry["donut-assets"],
        wallets = registry["donut-wallets"];
      wallets.clearLinked();
      wallets.clearLocal();
      me.clearLinked();
      me.selectLocal(i);
      const srcKey = me.keyAt(i),
        srcName = me.nameAt(i);
      const keys = (ADJ["donut-assets→donut-wallets"] || {})[srcKey] || [];
      const idxs: number[] = [],
        names: string[] = [];
      keys.forEach(function (k) {
        const idx = wallets.indexOfKey(k);
        if (idx >= 0) {
          idxs.push(idx);
          names.push(wallets.nameAt(idx));
        }
      });
      wallets.setLinked(idxs, srcName, names.join(" · "));
    },
    clearAll: function () {
      // 지갑 필터 해제 시 자산 분포를 전체 포트폴리오 뷰로 복원
      if (walletFilter) {
        walletFilter = null;
        rebuildOne("donut-assets", DONUTS["donut-assets"]);
      }
      Object.keys(registry).forEach(function (k) {
        registry[k].clearLocal();
        registry[k].clearLinked();
      });
    },
  };

  // ── clear + rebuild (live re-render on wallet change / data refresh) ──────
  function clearDonuts() {
    Object.keys(registry).forEach((k) => delete registry[k]);
    Object.keys(DONUTS).forEach(function (id) {
      const card = root.querySelector<HTMLElement>("#" + id);
      if (!card) return;
      const svg = card.querySelector(".donut");
      const legend = card.querySelector(".donut-legend");
      const center = card.querySelector(".donut-center");
      if (svg) svg.innerHTML = "";
      if (legend) legend.innerHTML = "";
      if (center) center.innerHTML = "";
    });
  }

  window.PASU_REBUILD_DONUTS = function () {
    dd = readDonut();
    DONUTS["donut-wallets"] = dd ? toCfg(dd.wallets, FALLBACK) : FALLBACK;
    DONUTS["donut-assets"] = dd ? toCfg(dd.assets, FALLBACK) : FALLBACK;
    refreshAdj();
    walletFilter = null; // 데이터 리프레시 → 자산 분포 필터 해제
    clearDonuts();
    build("donut-wallets", DONUTS["donut-wallets"]);
    build("donut-assets", DONUTS["donut-assets"]);
  };

  // CSP: delegated capture-phase error handler for legend chain-logo <img>.
  function onError(e: Event) {
    const t = e.target as HTMLElement;
    if (t && t.tagName === "IMG" && t.getAttribute("data-onerr") === "hide") {
      t.style.display = "none";
    }
  }
  root.addEventListener("error", onError, true);

  Object.keys(DONUTS).forEach(function (id) {
    build(id, DONUTS[id]);
  });

  return function teardown() {
    root.removeEventListener("error", onError, true);
    window.PASU_REBUILD_DONUTS = undefined;
  };
}

// 지갑 스위처 좌우 스크롤 — 넘칠 때만 화살표/페이드 노출
export function initWsScroll(root: HTMLElement): () => void {
  const wrap = root.querySelector<HTMLElement>(".ws-wrap");
  const track = root.querySelector<HTMLElement>("#wallet-switch");
  if (!wrap || !track) return function () {};
  function update() {
    const max = track!.scrollWidth - track!.clientWidth;
    const x = track!.scrollLeft;
    wrap!.classList.toggle("can-prev", x > 1);
    wrap!.classList.toggle("can-next", x < max - 1);
  }
  function by(dir: number) {
    track!.scrollBy({ left: dir * Math.max(track!.clientWidth * 0.7, 180), behavior: "smooth" });
  }
  function onPrev() {
    by(-1);
  }
  function onNext() {
    by(1);
  }
  const prevBtn = wrap.querySelector<HTMLElement>(".ws-nav.prev");
  const nextBtn = wrap.querySelector<HTMLElement>(".ws-nav.next");
  if (prevBtn) prevBtn.addEventListener("click", onPrev);
  if (nextBtn) nextBtn.addEventListener("click", onNext);
  track.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
  const t = setTimeout(update, 300);

  return function teardown() {
    clearTimeout(t);
    if (prevBtn) prevBtn.removeEventListener("click", onPrev);
    if (nextBtn) nextBtn.removeEventListener("click", onNext);
    track.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
  };
}
