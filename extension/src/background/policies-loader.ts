import Browser from 'webextension-polyfill';
import { installPolicies } from './wasm-bridge';

let installed = false;
let inflight: Promise<void> | null = null;

interface PolicyEntry {
  id: string;
  text: string;
}

/**
 * Install the bundled default policy set into the WASM engine. One-shot
 * per SW lifetime. Plan 6 will replace this with marketplace-installed
 * bundles, but keeps the same `installPolicies()` interface.
 */
export async function ensureDefaultPoliciesInstalled(): Promise<void> {
  if (installed) return;
  if (inflight) return inflight;
  inflight = (async () => {
    const schemaUrl = Browser.runtime.getURL('default-policies/schema.cedarschema');
    const setUrl = Browser.runtime.getURL('default-policies/policy-set.json');
    const [schemaText, policySetRaw] = await Promise.all([
      (await fetch(schemaUrl)).text(),
      (await fetch(setUrl)).text(),
    ]);
    const policySet = JSON.parse(policySetRaw) as PolicyEntry[];
    await installPolicies({ schema_text: schemaText, policy_set: policySet });
    installed = true;
  })();
  return inflight;
}

/** Forces a re-install (useful after Plan 6 marketplace mutations). */
export async function reinstallAllPolicies(): Promise<void> {
  installed = false;
  inflight = null;
  await ensureDefaultPoliciesInstalled();
}
