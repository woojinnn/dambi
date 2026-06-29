// @vitest-environment node

import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initAssetsApp } from "./assets-app";
import { initDonuts } from "./donuts";
import { initLayoutModes } from "./layout-modes";

const BAD = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
let dom: JSDOM | null = null;

function installDom(): void {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://dashboard.example.test/",
  });
  const win = dom.window;
  const requestAnimationFrame = (callback: FrameRequestCallback): number =>
    Number(setTimeout(() => callback(Date.now()), 0));
  const cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle);
  };
  win.requestAnimationFrame = requestAnimationFrame;
  win.cancelAnimationFrame = cancelAnimationFrame;
  win.Element.prototype.animate = () =>
    ({
      cancel() {},
      finish() {},
      play() {},
      pause() {},
    }) as Animation;
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    MouseEvent: win.MouseEvent,
    requestAnimationFrame,
    cancelAnimationFrame,
  });
}

function host(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="app-content"></div>
    <div id="wallet-switch"></div>
    <div id="lens-toggle"></div>
    <div id="lens-meta"></div>
    <div id="l1-extra"></div>
    <div id="l2-extra"></div>
    <div id="banner-host"></div>
    <div id="holdings-host"></div>
    <div id="holdings-meta"></div>
    <div id="approvals-host"></div>
    <div id="approvals-meta"></div>
    <section id="hl-section"><div class="sec-head"></div><div class="hl-card"></div></section>
    <div id="pending-host"></div>
  `;
  document.body.appendChild(root);
  return root;
}

describe("Assets2 prototype renderer escaping", () => {
  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    if (globalThis.window) {
      document.body.innerHTML = "";
      window.DAMBI_DATA = undefined;
      window.DAMBI_TWEAKS = undefined;
      window.DAMBI_T = undefined;
      window.DAMBI_RENDER = undefined;
      window.DAMBI_RENDER_STATIC = undefined;
      window.DAMBI_getSummary = undefined;
    }
    dom?.window.close();
    dom = null;
  });

  it("does not parse live wallet/token/HL fields as HTML", () => {
    const wallet = `0x${"1".repeat(40)}">${BAD}`;
    window.DAMBI_T = (key, vars) => (vars && "label" in vars ? `${key}:${String(vars.label)}` : key);
    window.DAMBI_DATA = {
      sel: "all",
      WLABEL: { [wallet]: BAD },
      WMETA: {
        [wallet]: {
          label: BAD,
          full: wallet,
          totalUsd: "$1",
          fail: 0,
          warn: 1,
          pending: 1,
          varUsd: "$1",
          unlimited: 1,
        },
      },
      AGG: [{
        sym: BAD,
        kind: `erc20" onmouseover="window.__xss=1`,
        chain: BAD,
        cc: "#000",
        wallets: [wallet],
        bal: BAD,
        unit: BAD,
        usd: BAD,
        usdNum: 1,
        risk: ["UNLIMITED"],
        varTxt: BAD,
        varCls: "warn",
        varNum: 1,
        logoUrl: "https://tracker.example/logo.png",
        logoURI: "https://tracker.example/logo-uri.png",
        logo: "https://tracker.example/logo-alt.png",
      }],
      PW: {},
      APPR: [{
        w: wallet,
        type: BAD,
        token: BAD,
        spender: BAD,
        chain: BAD,
        amount: BAD,
        risk: ["UNLIMITED"],
        revoke: false,
      }],
      PEND: [{
        w: wallet,
        kind: `intent" onclick="window.__xss=1`,
        type: BAD,
        venue: BAD,
        sell: BAD,
        buy: BAD,
        at: BAD,
      }],
      HL: {
        [wallet]: {
          wallet,
          walletLabel: BAD,
          perpUsd: 1,
          spotUsd: 0,
          positions: [{
            sym: BAD,
            side: "long",
            size: 1,
            entry: 1,
            value: 1,
            leverage: BAD,
          }],
          orders: [{
            sym: BAD,
            side: "buy",
            kind: "tp",
            trigger: BAD,
            limit: BAD,
            cond: BAD,
          }],
        },
      },
    };

    const root = host();
    const teardown = initAssetsApp(root);

    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("[onmouseover]")).toBeNull();
    expect(root.querySelector("[onclick]")).toBeNull();
    expect(root.querySelector('img[src="x"]')).toBeNull();
    expect(root.querySelector('img[src^="http:"], img[src^="https:"], img[src^="//"]')).toBeNull();
    expect(root.innerHTML).not.toContain("tracker.example");
    expect(root.textContent).toContain('<script>window.__xss=1</script>');

    teardown();
  });

  it("does not parse live donut item labels or colors as HTML", () => {
    window.DAMBI_DATA = {
      donut: {
        wallets: {
          centerLabel: BAD,
          total: 1,
          items: [{ key: "wallet", name: BAD, color: `#000" onmouseover="window.__xss=1`, usd: 1, pct: 100 }],
        },
        assets: {
          centerLabel: BAD,
          total: 1,
          items: [{ key: "asset", name: BAD, color: `red" onclick="window.__xss=1`, usd: 1, pct: 100, chainName: BAD }],
        },
        walletAssets: {},
        adjacency: { walletToAsset: {}, assetToWallet: {} },
      },
    };

    const root = document.createElement("div");
    root.innerHTML = `
      <section id="donut-wallets"><div class="donut-figure"><svg class="donut"></svg><div class="donut-center"></div></div><div class="donut-legend"></div></section>
      <section id="donut-assets"><div class="donut-figure"><svg class="donut"></svg><div class="donut-center"></div></div><div class="donut-legend"></div></section>
    `;
    document.body.appendChild(root);

    const teardown = initDonuts(root);

    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("[onmouseover]")).toBeNull();
    expect(root.querySelector("[onclick]")).toBeNull();
    expect(root.querySelector('img[src^="http:"], img[src^="https:"], img[src^="//"]')).toBeNull();
    expect(root.textContent).toContain('<script>window.__xss=1</script>');

    teardown();
  });

  it("does not reparse layout summary values as HTML", () => {
    window.DAMBI_TWEAKS = { layoutMode: "overview", overviewStyle: "cards" };
    window.DAMBI_T = (key, vars) => (vars && "amount" in vars ? `${key}:${String(vars.amount)}` : key);
    window.DAMBI_getSummary = () => ({
      holdingsCount: 1,
      apprCount: 1,
      pending: 1,
      blocked: 0,
      unlimited: 1,
      old: 0,
      exposureUsd: 1,
      exposureTxt: BAD,
      holdingsUsdTxt: BAD,
      hlAvailable: false,
      flags: { holdings: "warn", approvals: "warn", pending: null, hl: null },
    });
    const root = document.createElement("div");
    root.innerHTML = `
      <div id="mode-chrome"></div>
      <section class="mod-sec" data-sec="holdings"><div class="sec-head"></div></section>
      <section class="mod-sec" data-sec="approvals"><div class="sec-head"></div></section>
      <section class="mod-sec" data-sec="pending"><div class="sec-head"></div></section>
    `;
    document.body.appendChild(root);

    const teardown = initLayoutModes(root);

    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("[onmouseover]")).toBeNull();
    expect(root.querySelector("[onclick]")).toBeNull();
    expect(root.textContent).toContain('<script>window.__xss=1</script>');

    teardown();
  });
});
