/**
 * Typed wrappers for `/policies/...` server endpoints.
 *
 * Phase 7 ships stubs — the server-side endpoints (`GET /policies`,
 * `POST /policies`, etc.) land in a follow-up because the manifest
 * storage layer (Phase 5 `user_policies` table) doesn't have HTTP
 * surface yet. The shapes below are the contract the dashboard expects
 * once the server catches up.
 */

import { request } from "./client";

export interface InstalledPolicy {
  policy_id: string;
  manifest_id: string;
  name: string;
  enabled: boolean;
  installed_at: number;
}

/** `GET /policies` — list installed policies. Will return [] until the
 * server side lands. */
export async function listPolicies(): Promise<InstalledPolicy[]> {
  try {
    return await request<InstalledPolicy[]>("/policies");
  } catch (e) {
    // 404 = endpoint not yet implemented — degrade to empty list so the
    // page renders.
    return [];
  }
}
