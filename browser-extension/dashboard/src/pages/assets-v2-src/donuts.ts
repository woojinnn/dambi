/* Donuts — ASS_v2 prototype donut pair (지갑별 자산 비율 ↔ 자산 분포), live-data wired.
 *
 * Ported verbatim from `_donut-inline.js`: the SVG segment build, the count-up
 * center, hover preview, and the two-way cross-link controller are unchanged.
 * Only the data source changed — instead of the hardcoded WALLETS/PLACES/
 * HOLDINGS demo, the two donut configs (+ adjacency) come from
 * `window.PASU_DATA.donut` (the live DonutData from useAssetsData). A small
 * fallback keeps the prototype rendering standalone when PASU_DATA is absent.
 *
 * KEEP: window.PASU_CHAIN_LOGOS (inline SVG) / window.PASU_TOKEN_LOGO_FILES
 * (symbol→local bundled filename) are seeded here, consumed by assets-app's
 * chain chips + token avatars.
 *
 * Privacy/CSP: extension pages never fetch logos from third-party CDNs (that
 * would leak viewed holdings). Chain legends use local inline SVG; token
 * avatars use locally-bundled SVG files (public/picture/tokens/), same-origin.
 */

import {
  escapeAttr,
  escapeHtml,
  safeCssColor,
} from "./html-safe";

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
  // i18n bridge (read at render time; falls back to key in standalone prototype).
  const T = (k: string, vars?: Record<string, unknown>): string =>
    window.PASU_T ? window.PASU_T(k, vars) : k;

  // 실제 체인 로고 (브랜드 마크) — 자산 분포 도넛 범례 + Holdings 체인 칩 공용
  const LOGOS: Record<string, string> = {
    // Ethereum: ETH 토큰 로고(레포 eth.svg)와 동일한 그레이 다이아 — 작은 배지/범례가 토큰과 일치하도록.
    eth: '<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"><polygon fill="#2F3030" points="249.982,6.554 397.98,251.112 250.53,188.092 "/><polygon fill="#828384" points="102.39,251.112 249.982,6.554 250.53,188.092 "/><polygon fill="#343535" points="249.982,341.285 102.39,251.112 250.53,188.092 "/><polygon fill="#131313" points="397.98,251.112 250.53,188.092 249.982,341.285 "/><polygon fill="#2F3030" points="249.982,372.329 397.98,284.597 249.982,493.13 "/><polygon fill="#828384" points="249.982,372.329 102.39,284.597 249.982,493.13 "/></svg>',
    base: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#0052FF"/><path d="M14.2 6.4A6.9 6.9 0 1 0 14.2 17.6Z" fill="#fff"/></svg>',
    arb: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2D374B"/><path d="M12 5.6 6.7 17.4 9.6 17.4z" fill="#28A0F0"/><path d="M12 5.6 17.3 17.4 14.4 17.4z" fill="#fff"/><path d="M12 5.6 13.2 8.2 10.8 8.2z" fill="#fff"/></svg>',
    hl: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#173E37"/><g stroke="#98FCE4" stroke-width="2.3" stroke-linecap="round" fill="none"><path d="M7.7 7v10"/><path d="M16.3 7v10"/><path d="M7.7 12.2c1.6-2.3 7-2.3 8.6 0"/></g></svg>',
  };
  // assets-app.js(체인 칩)에서 재사용
  window.PASU_CHAIN_LOGOS = {
    byName: { Ethereum: LOGOS.eth, Base: LOGOS.base, Arbitrum: LOGOS.arb, Hyperliquid: LOGOS.hl },
  };

  // 토큰 아바타 — 실제 브랜드 로고를 로컬 번들에서 <img>로 로드(Holdings 표 자산 아이콘).
  // 출처: Pymmdrza/Cryptocurrency_Logos → public/picture/tokens/<name>.svg 로 사전 번들.
  // 외부 CDN 미사용(보유자산 유출 없음). 심볼→파일명(소문자) 맵; 변형 심볼은 대표 로고
  // 재사용(WETH/cbETH→eth, USDC.e·USDbC→usdc, POL/WMATIC→matic, wstETH→steth). 미수록
  // 심볼은 글자 아바타로 폴백.
  window.PASU_TOKEN_LOGO_FILES = {
    ETH: "eth", WETH: "eth", cbETH: "eth",
    USDC: "usdc", "USDC.e": "usdc", USDbC: "usdc",
    USDT: "usdt", DAI: "dai", FRAX: "frax", TUSD: "tusd", BUSD: "busd", GUSD: "gusd",
    WBTC: "wbtc", cbBTC: "wbtc", BTC: "btc",
    LINK: "link", UNI: "uni", AAVE: "aave", LDO: "ldo", MKR: "mkr",
    MATIC: "matic", POL: "matic", WMATIC: "matic",
    stETH: "steth", wstETH: "steth",
    SNX: "snx", COMP: "comp", SUSHI: "sushi", GRT: "grt", SHIB: "shib", SOL: "sol", BNB: "bnb",
  };

  function chainImgByName(name: string | undefined): string {
    if (!name) return "";
    const L = (window.PASU_CHAIN_LOGOS && window.PASU_CHAIN_LOGOS.byName) || {};
    return Object.prototype.hasOwnProperty.call(L, name) ? L[name] : "";
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
  const FALLBACK: DonutCfg = { centerK: T("assets.donut.assetCenter"), total: 0, items: [] };

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
    // 세그먼트 길이는 서버 pct(반올림 → 합이 100을 살짝 넘거나 모자랄 수 있음)가
    // 아니라 실제 usd 비율로 잰다. pct 합이 100을 넘으면 누적합 acc 가 원주 C 를
    // 초과해, 12시에서 마지막 세그먼트가 첫 세그먼트 위를 덮어 어두운 노치가 생겼다.
    // usd 비율은 항상 정확히 C 로 떨어져 12시 이음새에 깔끔한 GAP 만 남는다.
    const sumUsd = cfg.items.reduce((s, it) => s + it.usd, 0) || 1;
    let acc = 0;
    cfg.items.forEach(function (it, i) {
      const len = (it.usd / sumUsd) * C;
      const seg = document.createElementNS(NS, "circle");
      seg.setAttribute("class", "donut-seg");
      seg.setAttribute("cx", "60");
      seg.setAttribute("cy", "60");
      seg.setAttribute("r", "45");
      seg.setAttribute("stroke", safeCssColor(it.color));
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
          : '<span class="dli-dot" style="background:' + escapeAttr(safeCssColor(it.color)) + '"></span>') +
        '<span class="dli-name">' + escapeHtml(it.name) + "</span>" +
        '<span class="dli-val">' + escapeHtml(money(it.usd)) + "</span>";
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
        '<span class="dc-k">' + escapeHtml(k) + "</span>" +
        '<span class="dc-v">' + escapeHtml(v) + "</span>" +
        (sub ? '<span class="dc-sub">' + escapeHtml(sub) + "</span>" : "");
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
      const heading = id === "donut-assets" ? T("assets.donut.includedAssets") : T("assets.donut.holdingWallets");
      center!.innerHTML =
        '<span class="dc-k">' + escapeHtml(heading) + "</span>" + '<span class="dc-sub">' + escapeHtml(T("assets.donut.ctxBasis", { label: ctxLabel })) + "</span>";
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

  // Compatibility no-op for old markup that may still carry data-onerr.
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
