/**
 * `/transactions` — retained for legacy server compatibility.
 *
 * The active dashboard reads verdict/history and state-delta details from the
 * extension bridge, not from a policy-server state_deltas table. The server
 * endpoint currently returns an empty array until a dedicated lifecycle read
 * model is reintroduced.
 */

import { request } from "./client";
import type { TxRow } from "./types";

export type { TxRow };

/** `GET /transactions?wallet=<addr>&limit=<n>` — legacy empty compatibility list. */
export async function listTransactions(
  opts: { wallet?: string; limit?: number } = {},
): Promise<TxRow[]> {
  const params = new URLSearchParams();
  if (opts.wallet) params.set("wallet", opts.wallet);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<TxRow[]>(`/transactions${qs ? `?${qs}` : ""}`);
}
