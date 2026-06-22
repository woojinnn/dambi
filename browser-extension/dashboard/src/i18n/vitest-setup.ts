/**
 * Vitest global setup: initialize i18next (defaults to ko) so modules that
 * resolve labels through t() at call time return real Korean strings in tests
 * instead of raw keys.
 *
 * i18next.init() is asynchronous (initImmediate defaults to true), so we await
 * the "initialized" event before any test runs. Otherwise t() can run before
 * init completes and return undefined — a race that passes locally but fails in
 * CI depending on worker scheduling.
 */

import { initI18n } from "./index";

const i18n = initI18n();
if (!i18n.isInitialized) {
  await new Promise<void>((resolve) => i18n.on("initialized", () => resolve()));
}

const originalFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : typeof Request !== "undefined" && input instanceof Request
          ? input.url
          : "";

  if (url.startsWith("https://static.blockly.com/media/")) {
    return new Response(new ArrayBuffer(0), { status: 200 });
  }

  if (!originalFetch) {
    throw new TypeError("fetch is not available in this test environment");
  }

  return originalFetch(input, init);
};
