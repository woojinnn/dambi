/// <reference types="vite/client" />

// Raw-string imports of ASS_v2 markup (Vite `?raw`).
declare module "*.html?raw" {
  const content: string;
  export default content;
}

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    window: Window & typeof globalThis;
  }
}

// Globals the ASS_v2 prototype scripts read/write. React injects DAMBI_DATA from
// live server data; the prototype's render/donut/summary functions consume it.
interface Window {
  DAMBI_DATA?: unknown;
  DAMBI_TWEAKS?: unknown;
  DAMBI_EDIT_HOST?: boolean;
  DAMBI_SET_SEL?: (key: string) => void;
  DAMBI_RENDER?: () => void;
  DAMBI_RENDER_STATIC?: () => void;
  DAMBI_REBUILD_DONUTS?: () => void;
  DAMBI_getSummary?: () => unknown;
  DAMBI_CHAIN_LOGOS?: { byName?: Record<string, string> };
  /** 토큰 심볼 → 로컬 번들 로고 파일명(소문자, public/picture/tokens/<name>.svg). */
  DAMBI_TOKEN_LOGO_FILES?: Record<string, string>;
  DAMBI_imgFail?: (img: HTMLImageElement) => void;
  DAMBI_badgeFail?: (img: HTMLImageElement) => void;
  // i18n bridge: React sets this to a bound i18next `t` (monitoring namespace) so
  // the prototype's render functions can translate at render time. Reads the live
  // language on every call; absent only in the standalone prototype.
  DAMBI_T?: (key: string, vars?: Record<string, unknown>) => string;
}
