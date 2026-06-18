/**
 * Per-user app settings.
 *
 * v2 keeps the user's OpenAI API key **only in the browser** (localStorage) —
 * it is never sent to or stored on the policy-server. The editor's LLM tab reads
 * it locally and calls OpenAI directly (see {@link ./llm-draft}). This trades the
 * server's at-rest storage for client-only custody: the key stays on the user's
 * machine and only ever leaves it in a direct request to api.openai.com.
 *
 * The same `getSettings` / `putOpenaiKey` surface is kept so the Profile page
 * doesn't care where the key lives.
 */

import { i18n } from "../i18n";

/** localStorage slot for the user's OpenAI key (browser-only, never server-sent). */
const OPENAI_KEY = "dambi_openai_key";

export interface AppSettings {
  /** True when an OpenAI key is stored locally in this browser. */
  openai_api_key_set: boolean;
}

/** The stored OpenAI key, or `null` when unset. Read by the LLM draft pipeline. */
export function getStoredOpenaiKey(): string | null {
  if (typeof window === "undefined") return null;
  const k = window.localStorage.getItem(OPENAI_KEY);
  return k && k.trim() ? k.trim() : null;
}

/** Whether an OpenAI key is configured locally. */
export async function getSettings(): Promise<AppSettings> {
  return { openai_api_key_set: getStoredOpenaiKey() !== null };
}

/** Store (non-empty) or clear (empty string) the user's OpenAI API key locally. */
export async function putOpenaiKey(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  const k = key.trim();
  if (k === "") {
    window.localStorage.removeItem(OPENAI_KEY);
    return;
  }
  if (!k.startsWith("sk-")) {
    throw new Error(i18n.t("common:settings.openaiBadPrefix"));
  }
  window.localStorage.setItem(OPENAI_KEY, k);
}
