/**
 * Market page — SPA-integrated.
 *
 * The market bundle ships its own header (title + tabs + search + locale
 * switch + set button) that already covers what the dashboard Topbar would
 * have shown, so we skip the dashboard Topbar here to avoid a redundant
 * stripe above the market chrome. NavRail still belongs to the SPA shell.
 */

import { MarketApp } from "./market/MarketApp";
import "./market/market.css";

export function MarketPage() {
  return <MarketApp />;
}
