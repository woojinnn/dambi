/**
 * Resolve the HL master account whose per-wallet policy bindings guard a venue
 * order and whose synced state / per-asset leverage the enrichment reads.
 *
 * SECURITY — principal-confusion guard. Resolve ONLY from the TRUSTED connected
 * account; a page-supplied `vaultAddress` must NEVER decide the principal:
 *   1. `payload.wallet_id.address` — stamped by the fetch-hook from OUR
 *      `eth_accounts` read; any page-supplied value is overwritten, so this is
 *      trusted (see `fetch-hook.ts` `evaluatePayloads`).
 *   2. {@link getConnectedAccount} — the per-origin connected account fallback.
 *   3. Signed `/exchange` envelope: recover the L1 signer, then match direct
 *      master signing or exactly one synced master's `extraAgents` approval.
 *   4. Exactly one synced/provisioned wallet for the current Dambi user. If
 *      there are zero or multiple synced wallets, we do not guess.
 *   5. `null` — unknown. The caller degrades to the submitter sentinel
 *      (`defaults.enabled`) for the policy set and omits enrichment (a
 *      `context has <field>` policy stays dormant), never blocking.
 *
 * `payload.vaultAddress` is copied VERBATIM from the page `/exchange` body and is
 * NEVER overwritten (unlike `wallet_id`). It is deliberately NOT consulted here:
 * if it could outrank the trusted account, a hostile frontend would set it to an
 * unregistered address to (a) drop the connected wallet's per-wallet deny
 * bindings → `defaults.enabled`, and (b) point `/info` enrichment at an
 * attacker-chosen HEALTHY account, defeating margin-health / drawdown /
 * liquidation-proximity deny policies. Honoring a vault the connected account is
 * actually authorized to trade for needs an HL subaccount / vault-membership
 * lookup — a follow-up; until then we fail toward the trusted account, never
 * toward a page-chosen one.
 */
import type { VenueOrderPayload } from "@lib/types";
import { getCurrentUserId } from "../dashboard/current-user";
import { readStore } from "../policy-store/store";
import { resolveHlMasterFromSignedAgent } from "./hl-agent-master";
import { getConnectedAccount } from "./hl-master-store";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;

function validAddr(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_RE.test(value)
    ? value.toLowerCase()
    : null;
}

async function syncedWallets(): Promise<string[]> {
  try {
    const uid = await getCurrentUserId();
    if (!uid) return [];
    const snapshot = await readStore(uid);
    return Object.keys(snapshot.wallets.byAddress)
      .map(validAddr)
      .filter((addr): addr is string => addr !== null);
  } catch {
    // Storage/read failure keeps the enrichment dormant rather than guessing.
    return [];
  }
}

export async function resolveHlMaster(
  payload: VenueOrderPayload,
): Promise<string | null> {
  const stamped = validAddr(payload.wallet_id?.address);
  if (stamped) return stamped;

  const connected = await getConnectedAccount(payload.hostname);
  if (connected) return connected;

  const synced = await syncedWallets();
  const signed = await resolveHlMasterFromSignedAgent(payload, synced);
  if (signed) return signed;

  return synced.length === 1 ? synced[0] : null;
}
