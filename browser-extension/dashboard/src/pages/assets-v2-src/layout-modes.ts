/* layout-modes.ts — ASS_v2 section layout modes (Holdings / Approvals /
   Hyperliquid / 대기 주문) + the always-on risk alert strip. Ported from
   layout-modes.js. The mode logic and the chrome HTML are UNCHANGED; only:
     · wrapped in initLayoutModes(root) with DOM access scoped to `root`
       (document.body classes stay on body — the modes CSS keys on `body.*`),
     · the Tweaks panel (buildPanel/renderPanel/persist/postMessage) is gated
       behind window.PASU_EDIT_HOST so no panel DOM leaks into the dashboard,
     · listeners are tracked and removed in teardown.
   Reads live wallet-risk summary from assets-app (window.PASU_getSummary + the
   `pasu:render` event). */

import {
  escapeAttr,
  escapeHtml,
  safeClassToken,
} from "./html-safe";

interface ModeTweaks {
  layoutMode?: string;
  alertStrip?: boolean;
  segmentDefault?: string;
  compact?: boolean;
  stableHeight?: boolean;
  overviewStyle?: string;
}
interface ModeSummary {
  hlAvailable?: boolean;
  flags?: Record<string, string | null>;
  holdingsCount?: number;
  apprCount?: number;
  pending?: number;
  blocked?: number;
  unlimited?: number;
  old?: number;
  exposureUsd?: number;
  exposureTxt?: string;
  holdingsUsdTxt?: string;
}

export function initLayoutModes(root: HTMLElement): () => void {
  "use strict";

  const TW: ModeTweaks = (window.PASU_TWEAKS as ModeTweaks) || { layoutMode: "segment", alertStrip: true, segmentDefault: "holdings" };

  // i18n bridge (read at render time; falls back to key in standalone prototype).
  const Tr = (k: string, vars?: Record<string, unknown>): string =>
    window.PASU_T ? window.PASU_T(k, vars) : k;

  const SECTIONS: Array<{ key: string; labelKey?: string; label?: string }> = [
    { key: "holdings", labelKey: "assets.sections.holdings" },
    { key: "approvals", labelKey: "assets.sections.approvals" },
    { key: "hl", label: "Hyperliquid" }, // proper noun — never translated
    { key: "pending", labelKey: "assets.sections.pending" },
  ];
  const secLabel = (s: { labelKey?: string; label?: string }): string => (s.labelKey ? Tr(s.labelKey) : s.label || "");
  const MODES = [
    { key: "stack", title: "전체 스택", desc: "지금처럼 네 섹션을 모두 펼쳐 둠" },
    { key: "segment", title: "세그먼트", desc: "한 번에 한 섹션 · 위험은 상시 노출" },
    { key: "overview", title: "요약 카드", desc: "라이브 스탯 카드 4개 + 누르면 표 펼침" },
    { key: "sticky", title: "스티키 네비", desc: "전체 펼침 + 상단 점프 내비 고정" },
    { key: "accordion", title: "아코디언", desc: "섹션별로 접고 펼침" },
    { key: "stickyacc", title: "스티키 아코디언", desc: "상단 점프 내비 고정 + 섹션별 접기·펼치기" },
  ];

  let activeSeg = TW.segmentDefault || "holdings";
  let currentMode = TW.layoutMode || "stack";
  let lastSummary: ModeSummary | null = typeof window.PASU_getSummary === "function" ? (window.PASU_getSummary() as ModeSummary) : null;
  let scrollSpy: (() => void) | null = null;

  // ── helpers ───────────────────────────────────────────────────────────────
  function secEl(key: string): HTMLElement | null {
    return root.querySelector<HTMLElement>('.mod-sec[data-sec="' + key + '"]');
  }
  function chrome(): HTMLElement | null {
    return root.querySelector<HTMLElement>("#mode-chrome");
  }
  function isAvailable(key: string): boolean {
    if (key === "hl") return !lastSummary || !!lastSummary.hlAvailable;
    return true;
  }
  function flagOf(key: string): string | null {
    return (lastSummary && lastSummary.flags && lastSummary.flags[key]) || null;
  }
  function segCount(key: string): number | null {
    if (!lastSummary) return null;
    if (key === "holdings") return lastSummary.holdingsCount ?? null;
    if (key === "approvals") return lastSummary.apprCount ?? null;
    if (key === "pending") return lastSummary.pending ?? null;
    return null;
  }

  // ── alert strip ─────────────────────────────────────────────────────────
  function alertStripHtml(): string {
    const s = lastSummary;
    if (!s) return "";
    const warnIco =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    const okIco =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';
    const arrow =
      '<span class="as-go"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg></span>';
    function item(sev: string, jump: string, label: string, val: string | number): string {
      return (
        '<button class="as-item" data-jump="' + escapeAttr(jump) + '">' +
        '<span class="as-dot ' + safeClassToken(sev) + '"></span>' +
        '<span class="as-it-txt">' + escapeHtml(label) + " <b>" + escapeHtml(val) + "</b></span>" +
        arrow +
        "</button>"
      );
    }
    const risk = (s.blocked || 0) > 0 || (s.unlimited || 0) > 0;
    if (risk) {
      let items = "";
      let cnt = 0;
      if ((s.blocked || 0) > 0) {
        items += item("fail", "approvals", Tr("assets.alert.blocked"), s.blocked!);
        cnt++;
      }
      if ((s.unlimited || 0) > 0) {
        items += item("warn", "approvals", Tr("assets.alert.unlimited"), s.unlimited!);
        cnt++;
      }
      if ((s.exposureUsd || 0) > 0) {
        items += item("warn", "holdings", Tr("assets.alert.exposure"), s.exposureTxt || "$0");
        cnt++;
      }
      if ((s.pending || 0) > 0) {
        items += item("slate", "pending", Tr("assets.alert.pending"), s.pending!);
        cnt++;
      }
      return (
        '<div class="alert-strip has-risk">' +
        '<span class="as-ic">' + warnIco + "</span>" +
        '<span class="as-lead">' + escapeHtml(Tr("assets.alert.actionNeeded")) + ' <span class="as-n">' + escapeHtml(cnt) + "</span></span>" +
        '<div class="as-items">' + items + "</div>" +
        "</div>"
      );
    }
    const extra = (s.pending || 0) > 0 ? Tr("assets.alert.calmExtra", { count: s.pending }) : "";
    return (
      '<div class="alert-strip is-calm">' +
      '<span class="as-ic">' + okIco + "</span>" +
      '<div class="as-items"><span class="as-calm-txt">' + escapeHtml(Tr("assets.alert.calm") + extra) + "</span></div>" +
      "</div>"
    );
  }

  // ── segment bar ───────────────────────────────────────────────────────────
  function segBarHtml(): string {
    const tabs = SECTIONS.filter(function (s) {
      return isAvailable(s.key);
    })
      .map(function (s) {
        const flag = flagOf(s.key);
        const dot = flag ? '<span class="seg-flag ' + safeClassToken(flag) + '"></span>' : "";
        const cnt = segCount(s.key);
        const cntHtml = cnt != null ? '<span class="seg-count">' + escapeHtml(cnt) + "</span>" : "";
        return (
          '<button class="seg-tab' + (s.key === activeSeg ? " on" : "") + '" data-seg="' + escapeAttr(s.key) + '">' +
          dot +
          escapeHtml(secLabel(s)) +
          cntHtml +
          "</button>"
        );
      })
      .join("");
    return '<div class="seg-bar"><div class="seg-tabs">' + tabs + "</div></div>";
  }

  // ── overview (live stat cards → drill into one section) ───────────────────
  function hlSummary(): { value: string; positions: number } {
    const sec = secEl("hl");
    if (!sec) return { value: "—", positions: 0 };
    const pos =
      sec.querySelectorAll(".hl-tbl tbody tr.long, .hl-tbl tbody tr.short").length || sec.querySelectorAll(".hl-pos").length;
    const chips = sec.querySelectorAll(".hl-card-head .hl-bal, .hl-card-head .hl-chip");
    let perp = "—";
    Array.prototype.forEach.call(chips, function (c: Element) {
      const t = c.textContent || "";
      const m = t.match(/\$([\d,]+(?:\.\d+)?)/);
      if (m && /perp/i.test(t)) perp = "$" + m[1];
    });
    return { value: perp, positions: pos };
  }
  function ovCard(key: string, kLabel: string, value: string, sub: string, risk: boolean): string {
    return (
      '<button class="ov-card' + (key === activeSeg ? " on" : "") + (risk ? " risk" : "") + '" data-seg="' + escapeAttr(key) + '">' +
      (risk ? '<span class="ov-flag"></span>' : "") +
      '<span class="ov-k">' + escapeHtml(kLabel) + "</span>" +
      '<span class="ov-v">' + escapeHtml(value) + "</span>" +
      '<span class="ov-sub">' + escapeHtml(sub) + "</span></button>"
    );
  }
  interface OvItem {
    key: string;
    k: string;
    v: string;
    sub: string;
    risk: boolean;
  }
  function ovItems(): OvItem[] {
    const s = lastSummary || ({} as ModeSummary);
    const apprRisk = (s.blocked || 0) > 0 || (s.unlimited || 0) > 0;
    const items: OvItem[] = [
      { key: "holdings", k: Tr("assets.overview.holdings"), v: s.holdingsUsdTxt || "—", sub: Tr("assets.overview.tokens", { count: s.holdingsCount || 0 }), risk: false },
      {
        key: "approvals",
        k: Tr("assets.overview.apprRisk"),
        v: apprRisk ? s.exposureTxt || "$0" : Tr("assets.overview.cases", { count: s.apprCount || 0 }),
        sub: apprRisk
          ? Tr("assets.overview.unlimitedN", { count: s.unlimited || 0 }) + (s.blocked ? Tr("assets.overview.blockedN", { count: s.blocked }) : "")
          : Tr("assets.overview.noExposure"),
        risk: apprRisk,
      },
    ];
    if (isAvailable("hl")) {
      const h = hlSummary();
      items.push({ key: "hl", k: "Hyperliquid", v: h.value, sub: Tr("assets.overview.positions", { count: h.positions }), risk: false });
    }
    items.push({
      key: "pending",
      k: Tr("assets.overview.pending"),
      v: Tr("assets.overview.cases", { count: s.pending || 0 }),
      sub: (s.pending || 0) > 0 ? Tr("assets.overview.signWaiting") : Tr("assets.overview.none"),
      risk: false,
    });
    return items;
  }

  function ovCardsHtml(): string {
    const style = TW.overviewStyle || "editorial";
    const items = ovItems();
    if (style === "ribbon") return ovRibbonHtml(items);
    if (style === "editorial") return ovEditorialHtml(items);
    return (
      '<div class="ov-cards">' +
      items
        .map(function (it) {
          return ovCard(it.key, it.k, it.v, it.sub, it.risk);
        })
        .join("") +
      "</div>"
    );
  }

  function ovRibbonHtml(items: OvItem[]): string {
    const cells = items
      .map(function (it) {
        return (
          '<button class="orb' + (it.key === activeSeg ? " on" : "") + (it.risk ? " risk" : "") + '" data-seg="' + escapeAttr(it.key) + '">' +
          '<span class="orb-k">' + escapeHtml(it.k) + (it.risk ? '<span class="orb-flag"></span>' : "") + "</span>" +
          '<span class="orb-v">' + escapeHtml(it.v) + "</span>" +
          '<span class="orb-sub">' + escapeHtml(it.sub) + "</span></button>"
        );
      })
      .join("");
    return '<div class="ov-ribbon">' + cells + "</div>";
  }

  function ovEditorialHtml(items: OvItem[]): string {
    const hero = items[0];
    const rail = items.slice(1);
    const heroHtml =
      '<button class="oed-hero' + (hero.key === activeSeg ? " on" : "") + '" data-seg="' + escapeAttr(hero.key) + '">' +
      '<span class="oed-k">' + escapeHtml(hero.k) + "</span>" +
      '<span class="oed-v">' + escapeHtml(hero.v) + "</span>" +
      '<span class="oed-sub">' + escapeHtml(hero.sub) + "</span></button>";
    const railHtml = rail
      .map(function (it) {
        return (
          '<button class="oed-row' + (it.key === activeSeg ? " on" : "") + (it.risk ? " risk" : "") + '" data-seg="' + escapeAttr(it.key) + '">' +
          '<span class="oed-row-k">' + escapeHtml(it.k) + (it.risk ? '<span class="oed-flag"></span>' : "") + "</span>" +
          '<span class="oed-row-v">' + escapeHtml(it.v) + "</span>" +
          '<span class="oed-row-sub">' + escapeHtml(it.sub) + "</span></button>"
        );
      })
      .join("");
    return '<div class="ov-ed">' + heroHtml + '<div class="ov-ed-rail">' + railHtml + "</div></div>";
  }

  // ── jump nav ──────────────────────────────────────────────────────────────
  function sectionCount(key: string): number | null {
    if (!lastSummary) return null;
    if (key === "holdings") return lastSummary.holdingsCount ?? null;
    if (key === "approvals") return lastSummary.apprCount ?? null;
    if (key === "pending") return lastSummary.pending || null;
    if (key === "hl") {
      const h = hlSummary();
      return h.positions || null;
    }
    return null;
  }

  function jumpNavHtml(withAcc: boolean): string {
    const links = SECTIONS.filter(function (s) {
      return isAvailable(s.key);
    })
      .map(function (s) {
        const flag = flagOf(s.key);
        const dot = flag ? '<span class="jl-flag ' + safeClassToken(flag) + '"></span>' : "";
        const cnt = sectionCount(s.key);
        const cntHtml = cnt != null ? '<span class="jl-count">' + escapeHtml(cnt) + "</span>" : "";
        return (
          '<button class="jump-link" data-jump="' + escapeAttr(s.key) + '">' + dot + '<span class="jl-name">' + escapeHtml(secLabel(s)) + "</span>" + cntHtml + "</button>"
        );
      })
      .join("");
    const tail = withAcc ? '<button class="jump-allbtn" data-allacc="toggle">' + escapeHtml(Tr("assets.acc.expandAll")) + "</button>" : "";
    return '<div class="jump-nav' + (withAcc ? " jump-nav-acc" : "") + '">' + links + tail + "</div>";
  }

  function accSummaryHtml(key: string): string {
    const s = lastSummary || ({} as ModeSummary);
    const stat = function (t: string) {
      return '<span class="acc-sum-stat">' + escapeHtml(t) + "</span>";
    };
    const val = function (t: string) {
      return '<span class="acc-sum-val">' + escapeHtml(t) + "</span>";
    };
    const flag = function (c: string, t: string) {
      return '<span class="acc-sum-flag ' + safeClassToken(c) + '">' + escapeHtml(t) + "</span>";
    };
    let inner = "";
    if (key === "holdings") {
      inner = stat(Tr("assets.acc.tokens", { count: s.holdingsCount || 0 })) + val(s.holdingsUsdTxt || "—");
      if ((s.exposureUsd || 0) > 0) inner += flag("warn", Tr("assets.acc.exposureN", { amount: s.exposureTxt }));
    } else if (key === "approvals") {
      inner = stat(Tr("assets.acc.cases", { count: s.apprCount || 0 }));
      if ((s.blocked || 0) > 0) inner += flag("fail", Tr("assets.acc.blockedN", { count: s.blocked }));
      if ((s.unlimited || 0) > 0) inner += flag("warn", Tr("assets.acc.unlimitedN", { count: s.unlimited }));
      if (!s.blocked && !s.unlimited && (s.old || 0) > 0) inner += flag("slate", Tr("assets.acc.cleanupN", { count: s.old }));
      if (!s.blocked && !s.unlimited && !s.old) inner += flag("calm", Tr("assets.acc.noRisk"));
    } else if (key === "hl") {
      const h = hlSummary();
      inner = stat(Tr("assets.acc.positions", { count: h.positions })) + val(h.value);
    } else if (key === "pending") {
      const p = s.pending || 0;
      inner = p > 0 ? stat(Tr("assets.acc.cases", { count: p })) + flag("slate", Tr("assets.acc.signWaiting")) : stat(Tr("assets.acc.none"));
    }
    return '<span class="acc-sum">' + inner + "</span>";
  }

  function syncJumpExpanded(): void {
    Array.prototype.forEach.call(root.querySelectorAll(".jump-nav-acc .jump-link"), function (l: Element) {
      const e = secEl(l.getAttribute("data-jump") || "");
      l.classList.toggle("collapsed", !!(e && e.classList.contains("collapsed")));
    });
    const allBtn = root.querySelector("[data-allacc]");
    if (allBtn) {
      const anyCollapsed = SECTIONS.some(function (s) {
        const e = secEl(s.key);
        return isAvailable(s.key) && e && e.classList.contains("collapsed");
      });
      allBtn.textContent = anyCollapsed ? Tr("assets.acc.expandAll") : Tr("assets.acc.collapseAll");
    }
  }

  // ── per-mode setup ──────────────────────────────────────────────────────
  function showOnlySeg(): void {
    SECTIONS.forEach(function (s) {
      const e = secEl(s.key);
      if (e) e.classList.toggle("mod-hidden", s.key !== activeSeg);
    });
  }
  function ensureSegAvailable(): void {
    if (!isAvailable(activeSeg)) activeSeg = "holdings";
  }
  function setActiveSeg(key: string): void {
    if (!isAvailable(key)) return;
    activeSeg = key;
    Array.prototype.forEach.call(root.querySelectorAll("[data-seg]"), function (t: Element) {
      t.classList.toggle("on", t.getAttribute("data-seg") === key);
    });
    showOnlySeg();
  }

  function setupScrollSpy(): void {
    const links = root.querySelectorAll(".jump-link");
    scrollSpy = function () {
      let current: string | null = null;
      SECTIONS.forEach(function (s) {
        const e = secEl(s.key);
        if (!e || e.classList.contains("mod-hidden")) return;
        if (e.getBoundingClientRect().top <= 130) current = s.key;
      });
      if (!current && SECTIONS.length) current = SECTIONS[0].key;
      Array.prototype.forEach.call(links, function (l: Element) {
        l.classList.toggle("active", l.getAttribute("data-jump") === current);
      });
    };
    window.addEventListener("scroll", scrollSpy, { passive: true });
    scrollSpy();
  }

  function setupAccordion(): void {
    const sum = lastSummary;
    const openKey = sum && ((sum.blocked || 0) > 0 || (sum.unlimited || 0) > 0) ? "approvals" : "holdings";
    SECTIONS.forEach(function (s) {
      const e = secEl(s.key);
      if (!e) return;
      e.classList.add("acc");
      const head = e.querySelector(".sec-head");
      if (head) {
        const oldSum = head.querySelector(".acc-sum");
        if (oldSum) oldSum.remove();
        const holder = document.createElement("div");
        holder.innerHTML = accSummaryHtml(s.key);
        if (holder.firstChild) head.appendChild(holder.firstChild);

        let caret = head.querySelector(".acc-caret");
        if (!caret) {
          caret = document.createElement("span");
          caret.className = "acc-caret";
          caret.innerHTML =
            '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
        }
        head.appendChild(caret);
      }
      e.classList.toggle("collapsed", s.key !== openKey);
    });
  }

  function openSectionExclusive(key: string): void {
    SECTIONS.forEach(function (s) {
      const e = secEl(s.key);
      if (e) e.classList.toggle("collapsed", s.key !== key);
    });
    syncJumpExpanded();
    if (scrollSpy) scrollSpy();
  }

  // ── apply current mode ────────────────────────────────────────────────────
  function applyMode(): void {
    currentMode = TW.layoutMode || "stack";
    document.body.classList.toggle("compact", !!TW.compact);
    document.body.classList.toggle("stable-h", !!TW.stableHeight);
    document.body.classList.remove("mode-stack", "mode-segment", "mode-overview", "mode-sticky", "mode-accordion", "mode-stickyacc");
    document.body.classList.add("mode-" + currentMode);

    if (scrollSpy) {
      window.removeEventListener("scroll", scrollSpy);
      scrollSpy = null;
    }
    SECTIONS.forEach(function (s) {
      const e = secEl(s.key);
      if (!e) return;
      e.classList.remove("mod-hidden", "acc", "collapsed");
      const caret = e.querySelector(".acc-caret");
      if (caret) caret.remove();
      const sum = e.querySelector(".acc-sum");
      if (sum) sum.remove();
    });

    let html = "";
    if (currentMode === "overview") {
      ensureSegAvailable();
      html += ovCardsHtml();
    } else {
      if (TW.alertStrip) html += alertStripHtml();
      if (currentMode === "segment") html += segBarHtml();
      if (currentMode === "sticky") html += jumpNavHtml(false);
      if (currentMode === "stickyacc") html += jumpNavHtml(true);
    }
    const ch = chrome();
    if (ch) ch.innerHTML = html;

    if (currentMode === "segment" || currentMode === "overview") {
      ensureSegAvailable();
      showOnlySeg();
    } else if (currentMode === "sticky") {
      setupScrollSpy();
    } else if (currentMode === "accordion") {
      setupAccordion();
    } else if (currentMode === "stickyacc") {
      setupAccordion();
      setupScrollSpy();
      syncJumpExpanded();
    }
  }

  // ── jump / scroll ─────────────────────────────────────────────────────────
  function doJump(key: string, allowToggle: boolean): void {
    if (currentMode === "segment") {
      setActiveSeg(key);
      return;
    }
    const e = secEl(key);
    if (!e) return;
    if (currentMode === "accordion" || currentMode === "stickyacc") {
      if (allowToggle && !e.classList.contains("collapsed")) {
        e.classList.add("collapsed");
        syncJumpExpanded();
        if (scrollSpy) scrollSpy();
        return;
      }
      openSectionExclusive(key);
    }
    const top = e.getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
  }

  // ── global click delegation ───────────────────────────────────────────────
  const clickHandler = function (e: Event) {
    const target = e.target as HTMLElement;
    if (target.closest(".tw-panel")) return;

    const seg = target.closest("[data-seg]");
    if (seg) {
      setActiveSeg(seg.getAttribute("data-seg") || "");
      return;
    }

    const jump = target.closest("[data-jump]");
    if (jump) {
      doJump(jump.getAttribute("data-jump") || "", jump.classList.contains("jump-link"));
      return;
    }

    const allBtn = target.closest("[data-allacc]");
    if (allBtn) {
      const anyCollapsed = SECTIONS.some(function (s) {
        const el2 = secEl(s.key);
        return isAvailable(s.key) && el2 && el2.classList.contains("collapsed");
      });
      SECTIONS.forEach(function (s) {
        const el2 = secEl(s.key);
        if (el2) el2.classList.toggle("collapsed", !anyCollapsed);
      });
      syncJumpExpanded();
      if (scrollSpy) scrollSpy();
      return;
    }

    if (currentMode === "accordion" || currentMode === "stickyacc") {
      const head = target.closest(".sec-head");
      if (head && head.parentElement && head.parentElement.classList.contains("acc")) {
        if (target.closest("input, .hold-search, button.btn, a, .wallet-jump")) return;
        const sec = head.parentElement;
        const willOpen = sec.classList.contains("collapsed");
        SECTIONS.forEach(function (s) {
          const el2 = secEl(s.key);
          if (el2) el2.classList.add("collapsed");
        });
        if (willOpen) sec.classList.remove("collapsed");
        syncJumpExpanded();
        if (scrollSpy) scrollSpy();
      }
    }
  };
  root.addEventListener("click", clickHandler);

  // ── live refresh on wallet change ─────────────────────────────────────────
  const renderHandler = function (e: Event) {
    lastSummary = ((e as CustomEvent).detail as ModeSummary) || lastSummary;
    applyMode();
    syncPanel();
  };
  document.addEventListener("pasu:render", renderHandler);

  // ════════════════════════════════════════════════════════════════════════
  //  Tweaks panel — gated behind PASU_EDIT_HOST (dashboard never enables it)
  // ════════════════════════════════════════════════════════════════════════
  let panel: HTMLElement | null = null;

  function editHostTargetOrigin(): string {
    return window.location.origin;
  }

  function postEditHostMessage(message: Record<string, unknown>): void {
    if (!window.PASU_EDIT_HOST) return;
    window.parent.postMessage(message, editHostTargetOrigin());
  }

  function isTrustedEditHostMessage(e: MessageEvent): boolean {
    return e.origin === editHostTargetOrigin() && e.source === window.parent;
  }

  function persist(edits: Record<string, unknown>): void {
    if (!window.PASU_EDIT_HOST) return;
    try {
      postEditHostMessage({ type: "__edit_mode_set_keys", edits: edits });
    } catch (err) {
      void err;
    }
  }

  function buildPanel(): void {
    if (!window.PASU_EDIT_HOST) return;
    panel = document.createElement("div");
    panel.className = "tw-panel";
    panel.id = "tw-panel";
    panel.hidden = true;
    document.body.appendChild(panel);
    renderPanel();

    panel.addEventListener("click", function (e) {
      const target = e.target as HTMLElement;
      const x = target.closest(".tw-x");
      if (x) {
        hidePanel(true);
        return;
      }

      const mode = target.closest(".tw-mode");
      if (mode) {
        const mk = mode.getAttribute("data-mode");
        if (mk && mk !== TW.layoutMode) {
          TW.layoutMode = mk;
          persist({ layoutMode: mk });
          applyMode();
          renderPanel();
        }
        return;
      }

      const ovs = target.closest("[data-ovstyle]");
      if (ovs) {
        const sv = ovs.getAttribute("data-ovstyle") || undefined;
        if (sv !== TW.overviewStyle) {
          TW.overviewStyle = sv;
          persist({ overviewStyle: sv });
          applyMode();
          renderPanel();
        }
        return;
      }

      const tog = target.closest(".tw-toggle");
      if (tog) {
        const tk = tog.getAttribute("data-tw");
        if (tk === "compact") {
          TW.compact = !TW.compact;
          persist({ compact: TW.compact });
        } else if (tk === "stableHeight") {
          TW.stableHeight = !TW.stableHeight;
          persist({ stableHeight: TW.stableHeight });
        } else {
          TW.alertStrip = !TW.alertStrip;
          persist({ alertStrip: TW.alertStrip });
        }
        applyMode();
        renderPanel();
        return;
      }
    });

    panel.addEventListener("change", function (e) {
      const sel = (e.target as HTMLElement).closest("#tw-segdef") as HTMLSelectElement | null;
      if (sel) {
        TW.segmentDefault = sel.value;
        activeSeg = sel.value;
        persist({ segmentDefault: sel.value });
        if (TW.layoutMode === "segment") applyMode();
      }
    });
  }

  function renderPanel(): void {
    if (!panel) return;
    const modeHtml = MODES.map(function (m) {
      return (
        '<button class="tw-mode' + (m.key === TW.layoutMode ? " on" : "") + '" data-mode="' + m.key + '">' +
        '<span class="tw-radio"></span>' +
        '<span class="tw-mode-txt"><span class="tw-mode-t">' + m.title + "</span>" +
        '<span class="tw-mode-d">' + m.desc + "</span></span></button>"
      );
    }).join("");

    const segOpts = SECTIONS.map(function (s) {
      return '<option value="' + s.key + '"' + (s.key === TW.segmentDefault ? " selected" : "") + ">" + secLabel(s) + "</option>";
    }).join("");

    const segDefSec =
      TW.layoutMode === "segment" || TW.layoutMode === "overview"
        ? '<div class="tw-sec"><div class="tw-label">기본 열릴 섹션</div>' +
          '<select class="tw-select" id="tw-segdef">' +
          segOpts +
          "</select></div>"
        : "";

    const OVSTYLES = [
      { k: "cards", t: "카드" },
      { k: "ribbon", t: "리본" },
      { k: "editorial", t: "에디토리얼" },
    ];
    const curOv = TW.overviewStyle || "editorial";
    const ovStyleSec =
      TW.layoutMode === "overview"
        ? '<div class="tw-sec"><div class="tw-label">요약 스타일</div>' +
          '<div class="tw-seg">' +
          OVSTYLES.map(function (o) {
            return '<button class="tw-seg-btn' + (o.k === curOv ? " on" : "") + '" data-ovstyle="' + o.k + '">' + o.t + "</button>";
          }).join("") +
          "</div></div>"
        : "";

    const alertToggleSec =
      TW.layoutMode === "overview"
        ? ""
        : '<div class="tw-sec"><div class="tw-row">' +
          '<div class="tw-row-txt"><div class="tw-label">위험 알럿 스트립</div>' +
          '<div class="tw-hint">위험 요약을 항상 상단에 고정</div></div>' +
          '<button class="tw-toggle' + (TW.alertStrip ? " on" : "") + '" data-tw="alertStrip" role="switch" aria-checked="' + TW.alertStrip + '"></button>' +
          "</div></div>";

    panel.innerHTML =
      '<div class="tw-head"><span class="tw-title">Tweaks</span>' +
      '<button class="tw-x" aria-label="닫기">✕</button></div>' +
      '<div class="tw-body">' +
      '<div class="tw-sec"><div class="tw-label">레이아웃 모드</div>' +
      '<div class="tw-modes">' +
      modeHtml +
      "</div></div>" +
      alertToggleSec +
      '<div class="tw-sec"><div class="tw-row">' +
      '<div class="tw-row-txt"><div class="tw-label">컴팩트 밀도</div>' +
      '<div class="tw-hint">행·여백을 압축 — 어떤 모드에서도 적용</div></div>' +
      '<button class="tw-toggle' + (TW.compact ? " on" : "") + '" data-tw="compact" role="switch" aria-checked="' + TW.compact + '"></button>' +
      "</div></div>" +
      '<div class="tw-sec"><div class="tw-row">' +
      '<div class="tw-row-txt"><div class="tw-label">높이 안정화</div>' +
      '<div class="tw-hint">보유·승인·HL·대기 네 항목의 높이를 동일하게 고정 (요약·세그먼트)</div></div>' +
      '<button class="tw-toggle' + (TW.stableHeight ? " on" : "") + '" data-tw="stableHeight" role="switch" aria-checked="' + TW.stableHeight + '"></button>' +
      "</div></div>" +
      segDefSec +
      ovStyleSec +
      '<div class="tw-foot">모드를 바꾸면 Holdings · Approvals · Hyperliquid · 대기 주문 네 섹션의 배치만 달라져요. 지갑·도넛은 그대로 유지됩니다.</div>' +
      "</div>";
  }

  function syncPanel(): void {
    if (panel && !panel.hidden) renderPanel();
  }

  function showPanel(): void {
    if (panel) panel.hidden = false;
  }
  function hidePanel(dismiss: boolean): void {
    if (panel) panel.hidden = true;
    if (dismiss && window.PASU_EDIT_HOST) {
      try {
        postEditHostMessage({ type: "__edit_mode_dismissed" });
      } catch (err) {
        void err;
      }
    }
  }

  // ── Tweaks host protocol — only when PASU_EDIT_HOST ────────────────────────
  const messageHandler = function (e: MessageEvent) {
    if (!isTrustedEditHostMessage(e)) return;
    const d = e.data || {};
    if (d.type === "__activate_edit_mode") showPanel();
    else if (d.type === "__deactivate_edit_mode") hidePanel(false);
  };
  if (window.PASU_EDIT_HOST) window.addEventListener("message", messageHandler);

  // ── boot ──────────────────────────────────────────────────────────────────
  buildPanel();
  applyMode();
  if (window.PASU_EDIT_HOST) {
    try {
      postEditHostMessage({ type: "__edit_mode_available" });
    } catch (err) {
      void err;
    }
  }

  return function teardown() {
    root.removeEventListener("click", clickHandler);
    document.removeEventListener("pasu:render", renderHandler);
    if (window.PASU_EDIT_HOST) window.removeEventListener("message", messageHandler);
    if (scrollSpy) {
      window.removeEventListener("scroll", scrollSpy);
      scrollSpy = null;
    }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    // Clean up body classes so the dashboard isn't left polluted.
    document.body.classList.remove(
      "compact",
      "stable-h",
      "mode-stack",
      "mode-segment",
      "mode-overview",
      "mode-sticky",
      "mode-accordion",
      "mode-stickyacc",
    );
  };
}
