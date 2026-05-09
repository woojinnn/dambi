import Browser from 'webextension-polyfill';
import { aggregatedPolicySet } from './marketplace/storage';
import { getEnabledIds } from './policy-selection';
import { installPolicies } from './wasm-bridge';

let installed = false;
let inflight: Promise<void> | null = null;

interface PolicyEntry {
  id: string;
  text: string;
}

async function loadDefaultPolicySet(): Promise<{ schemaText: string; policies: PolicyEntry[] }> {
  const schemaUrl = Browser.runtime.getURL('default-policies/schema.cedarschema');
  const setUrl = Browser.runtime.getURL('default-policies/policy-set.json');
  const [schemaText, policySetRaw] = await Promise.all([
    (await fetch(schemaUrl)).text(),
    (await fetch(setUrl)).text(),
  ]);
  return { schemaText, policies: JSON.parse(policySetRaw) as PolicyEntry[] };
}

/**
 * Build the union of (defaults ∪ marketplace) and call installPolicies()
 * with the subset whose ids appear in `enabledIds`. Empty `enabledIds`
 * ⇒ install with no policies (the engine's `engine/baseline-allow` rule
 * is auto-injected).
 */
async function installFiltered(enabledIds: readonly string[]): Promise<void> {
  const [{ schemaText, policies: defaults }, marketplacePolicies] = await Promise.all([
    loadDefaultPolicySet(),
    aggregatedPolicySet(),
  ]);
  const enabledSet = new Set(enabledIds);
  const union = [...defaults, ...marketplacePolicies];
  const filtered = union.filter((p) => enabledSet.has(p.id));
  await installPolicies({ schema_text: schemaText, policy_set: filtered });
}

/**
 * One-shot install at SW boot. Reads enabled-ids from storage (the boot
 * path is single-threaded; no race with toggles). On reject, clears
 * `installed`/`inflight` so the next call retries instead of re-throwing
 * the cached rejection.
 */
export async function ensureDefaultPoliciesInstalled(): Promise<void> {
  if (installed) return;
  if (inflight) return inflight;
  inflight = (async () => {
    const enabledIds = await getEnabledIds();
    await installFiltered(enabledIds);
    installed = true;
  })();
  try {
    await inflight;
  } catch (err) {
    installed = false;
    inflight = null;
    throw err;
  } finally {
    if (installed) inflight = null;
  }
}

/**
 * Reinstall the engine with exactly the passed `ids` enabled. Used by
 * the popup's apply queue (`policy-selection.ts`) — the queue passes
 * the desired ids verbatim to avoid storage races. On reject, clears
 * `installed`/`inflight`.
 */
export async function reinstallAllPolicies(ids: readonly string[]): Promise<void> {
  installed = false;
  inflight = null;
  inflight = (async () => {
    await installFiltered(ids);
    installed = true;
  })();
  try {
    await inflight;
  } catch (err) {
    installed = false;
    inflight = null;
    throw err;
  } finally {
    if (installed) inflight = null;
  }
}
