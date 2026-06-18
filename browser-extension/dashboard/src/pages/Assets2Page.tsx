/**
 * Assets2 — the ASS_v2 prototype assets dashboard, rendered 100% as-is with the
 * mockup data swapped for live server data.
 *
 * The prototype's markup (assets-body.html), styles, and JS render logic are the
 * original ASS_v2 — unchanged. This wrapper only:
 *   · pulls live portfolio data via the shared useAssetsData() hook,
 *   · adapts it to the prototype's PASU_DATA shape (pasu-data.ts),
 *   · injects PASU_DATA + boots the four prototype scripts against the host DOM,
 *   · re-injects + re-renders whenever the live data changes,
 *   · bridges wallet-chip clicks to URL-driven wallet selection.
 */

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";

import { useAssetsData } from "./monitoring/useAssetsData";
import { toPasuData } from "./assets-v2-src/pasu-data";
import { initAssetsApp } from "./assets-v2-src/assets-app";
import { initDonuts, initWsScroll } from "./assets-v2-src/donuts";
import { initLayoutModes } from "./assets-v2-src/layout-modes";

import assetsBody from "./assets-v2-src/assets-body.html?raw";

import "./assets-v2-src/styles/tokens.css";
import "./assets-v2-src/styles/monitoring.css";
import "./assets-v2-src/styles/modes.css";
import "./assets-v2-src/assets-page.css";

/** i18next bridge for the prototype's render functions. Reads the live language
 * on every call. Keys are relative to the `monitoring` namespace. */
function pasuT(key: string, vars?: Record<string, unknown>): string {
  return i18n.t(`monitoring:${key}`, vars ?? {});
}

/** Translate the static markup that the prototype JS never re-renders. Elements
 * are tagged with data-i18n (textContent) / -title / -aria / -ph in
 * assets-body.html; each value is a `monitoring` key. Safe to re-run on language
 * change. */
function applyStaticI18n(root: HTMLElement): void {
  const varsOf = (elm: HTMLElement): Record<string, unknown> | undefined =>
    elm.dataset.i18nCount != null ? { count: Number(elm.dataset.i18nCount) } : undefined;
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((elm) => {
    elm.textContent = pasuT(elm.dataset.i18n!, varsOf(elm));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((elm) => {
    elm.setAttribute("title", pasuT(elm.dataset.i18nTitle!, varsOf(elm)));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((elm) => {
    elm.setAttribute("aria-label", pasuT(elm.dataset.i18nAria!, varsOf(elm)));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-ph]").forEach((elm) => {
    elm.setAttribute("placeholder", pasuT(elm.dataset.i18nPh!, varsOf(elm)));
  });
}

export function Assets2Page() {
  const d = useAssetsData();
  const { i18n: i18nInst } = useTranslation("monitoring");
  const lang = i18nInst.language;

  // Live → PASU_DATA. Recompute whenever selection or any per-wallet query
  // result changes (the queries are arrays of react-query results) — or the
  // language (donut labels are i18n-resolved at build time in data.ts).
  const model = useMemo(
    () => toPasuData(d),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      d.sel,
      d.summaryQ.data,
      d.indexes,
      d.donutData,
      lang,
      ...d.holdingsQs.map((q) => q.data),
      ...d.approvalsQs.map((q) => q.data),
      ...d.pendingQs.map((q) => q.data),
      ...d.positionsQs.map((q) => q.data),
    ],
  );

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

  // Keep PASU_SET_SEL pointing at the latest selection setter so wallet-chip
  // clicks (handled inside the prototype JS) drive the URL-synced selection.
  const setSelRef = useRef(d.setSelectionAndUrl);
  setSelRef.current = d.setSelectionAndUrl;

  // Mount-once: inject globals, boot the prototype scripts, teardown on unmount.
  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;

    // Must be set BEFORE booting the scripts — their init calls render() (which
    // calls PASU_T) synchronously.
    window.PASU_T = pasuT;
    applyStaticI18n(root);

    window.PASU_DATA = model;
    window.PASU_TWEAKS = {
      layoutMode: "stickyacc",
      alertStrip: true,
      segmentDefault: "holdings",
      compact: true,
      stableHeight: true,
      overviewStyle: "ribbon",
    };
    window.PASU_EDIT_HOST = false;
    window.PASU_SET_SEL = (k: string) => setSelRef.current(k as "all" | string);

    // Order matters: donuts first (so PASU_REBUILD_DONUTS exists before
    // assets-app's PASU_RENDER_STATIC calls it), then ws-scroll, then the main
    // app (renders + dispatches pasu:render), then layout-modes (consumes it).
    const teardowns = [initDonuts(root), initWsScroll(root), initAssetsApp(root), initLayoutModes(root)];
    mounted.current = true;

    return () => {
      mounted.current = false;
      teardowns.reverse().forEach((t) => {
        try {
          t();
        } catch {
          /* best-effort teardown */
        }
      });
      window.PASU_DATA = undefined;
      window.PASU_TWEAKS = undefined;
      window.PASU_EDIT_HOST = undefined;
      window.PASU_SET_SEL = undefined;
      window.PASU_T = undefined;
    };
    // Mount once — re-render on data change is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-inject + re-render whenever the live model changes.
  useEffect(() => {
    if (!mounted.current) return;
    window.PASU_DATA = model;
    window.PASU_RENDER_STATIC?.();
    window.PASU_RENDER?.();
  }, [model]);

  // Re-translate the static markup + re-render the dynamic tables/donuts when the
  // language changes (the prototype JS reads PASU_T at render time).
  useEffect(() => {
    if (!mounted.current) return;
    const root = hostRef.current;
    if (root) applyStaticI18n(root);
    window.PASU_RENDER?.();
    window.PASU_REBUILD_DONUTS?.();
  }, [lang]);

  return <div ref={hostRef} className="assets2-host" dangerouslySetInnerHTML={{ __html: assetsBody }} />;
}
