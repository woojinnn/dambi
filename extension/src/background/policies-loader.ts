import Browser from 'webextension-polyfill';
import { aggregatedPolicySet } from './marketplace/storage';
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
 * Install the union of (a) the bundled engine default policies and (b)
 * every Plan-6-installed marketplace bundle's rendered policy set.
 * Both sets are namespaced (`default::*` / `<bundle_id>::*`), so policy
 * IDs cannot collide. One-shot per SW lifetime; call
 * `reinstallAllPolicies()` after marketplace install/uninstall/edit.
 */
export async function ensureDefaultPoliciesInstalled(): Promise<void> {
  if (installed) return;
  if (inflight) return inflight;
  inflight = (async () => {
    const [{ schemaText, policies: defaults }, marketplacePolicies] = await Promise.all([
      loadDefaultPolicySet(),
      aggregatedPolicySet(),
    ]);
    const policySet = [...defaults, ...marketplacePolicies];
    await installPolicies({ schema_text: schemaText, policy_set: policySet });
    installed = true;
  })();
  return inflight;
}

/** Forces a re-install — call after any marketplace mutation. */
export async function reinstallAllPolicies(): Promise<void> {
  installed = false;
  inflight = null;
  await ensureDefaultPoliciesInstalled();
}
