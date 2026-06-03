/**
 * Market page — embeds the standalone Scopeball Market bundle
 * (`src/market/Market.html`, a React 18.3 + Babel-in-browser app) as an
 * iframe inside the dashboard's SPA frame.
 *
 * Why an iframe instead of a SPA route?
 *   The market bundle ships its own React/ReactDOM via CDN <script> tags
 *   and compiles its `.jsx` files with Babel-in-browser. Mounting it into
 *   the dashboard's existing React tree would conflict on React identity
 *   (two copies on one page) and would require rewriting every .jsx into
 *   ES-module form. Per the port directive ("그대로 들고오고"), we keep
 *   the bundle verbatim and isolate it in an iframe — Vite serves
 *   `/src/market/Market.html` directly under its filesystem allow rule.
 *
 * The Topbar still belongs to the dashboard, so the user sees consistent
 * crumb navigation. The iframe fills the remaining content area.
 */

import { Topbar } from "../shell/Topbar";
import "./market.css";

const MARKET_URL = "/src/market/Market.html";

export function MarketPage() {
  return (
    <>
      <Topbar here="Market" subtitle="policy marketplace" />
      <div className="market-frame">
        <iframe
          src={MARKET_URL}
          title="Scopeball Market"
          className="market-iframe"
        />
      </div>
    </>
  );
}
