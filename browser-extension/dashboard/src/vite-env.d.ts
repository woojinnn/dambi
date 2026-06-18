/// <reference types="vite/client" />

// Raw-string imports of ASS_v2 markup (Vite `?raw`).
declare module "*.html?raw" {
  const content: string;
  export default content;
}

// Globals the ASS_v2 prototype scripts read/write. React injects PASU_DATA from
// live server data; the prototype's render/donut/summary functions consume it.
interface Window {
  PASU_DATA?: unknown;
  PASU_TWEAKS?: unknown;
  PASU_EDIT_HOST?: boolean;
  PASU_SET_SEL?: (key: string) => void;
  PASU_RENDER?: () => void;
  PASU_RENDER_STATIC?: () => void;
  PASU_REBUILD_DONUTS?: () => void;
  PASU_getSummary?: () => unknown;
  PASU_CHAIN_LOGOS?: { byName?: Record<string, string> };
  PASU_TOKEN_LOGOS?: Record<string, string>;
  PASU_imgFail?: (img: HTMLImageElement) => void;
  PASU_badgeFail?: (img: HTMLImageElement) => void;
  // i18n bridge: React sets this to a bound i18next `t` (monitoring namespace) so
  // the prototype's render functions can translate at render time. Reads the live
  // language on every call; absent only in the standalone prototype.
  PASU_T?: (key: string, vars?: Record<string, unknown>) => string;
}
