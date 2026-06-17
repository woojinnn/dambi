/**
 * Per-user app settings (policy-server).
 *
 * v1 holds the user's OpenAI API key, used server-side for LLM policy drafting.
 * The key is write-only over the API: {@link getSettings} reports only whether
 * one is set; the value is never returned to the browser.
 */

import { request } from "./client";

export interface AppSettings {
  /** True when the user has an OpenAI key stored on the server. */
  openai_api_key_set: boolean;
}

/** Whether the current user has an OpenAI key configured. */
export async function getSettings(): Promise<AppSettings> {
  return request<AppSettings>("/v2/settings");
}

/** Store (non-empty) or clear (empty string) the user's OpenAI API key. */
export async function putOpenaiKey(key: string): Promise<void> {
  await request<void>("/v2/settings", { method: "PUT", body: { openai_api_key: key } });
}
