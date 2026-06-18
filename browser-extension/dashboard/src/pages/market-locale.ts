/**
 * Market-scoped locale state. Historically this was a SEPARATE preference
 * (its own localStorage key), which meant the Policy Hub never followed the
 * app-wide language toggle — switching the app to English left the market in
 * Korean. It now simply tracks the app i18n language so every `ko ? … : …`
 * branch in the market pages switches with the rest of the app.
 */

import { useTranslation } from "react-i18next";

export type MarketLocale = "ko" | "en";

/**
 * Read the active market locale (derived from the app i18n language) and a
 * setter that changes the app language. Using `useTranslation()` subscribes
 * the caller to `languageChanged`, so the market re-renders on every toggle.
 */
export function useMarketLocale(): [MarketLocale, (next: MarketLocale) => void] {
  const { i18n } = useTranslation();
  const locale: MarketLocale = (i18n.language ?? "ko").startsWith("en") ? "en" : "ko";
  const setLocale = (next: MarketLocale) => {
    void i18n.changeLanguage(next);
  };
  return [locale, setLocale];
}
