import Browser from 'webextension-polyfill';
import { parsePolicyMeta, type Severity } from '@lib/policy-meta';
import { listInstalled } from './marketplace/storage';

const ENABLED_KEY = 'policy-selection:enabled-ids';
const APPLIED_KEY = 'policy-selection:applied-ids';

export interface CatalogPolicy {
  id: string;
  rules: { severity: Severity; reason: string }[];
  dominantSeverity: Severity;
  sourceLabel: string;
}

export interface Catalog {
  policies: CatalogPolicy[];
  enabled: string[];
  applied: string[];
}

export type ApplyResult =
  | { ok: true }
  | { ok: false; error: { kind: string; message: string } };

export type ReinstallFn = () => Promise<void>;

async function readStringArray(key: string): Promise<string[]> {
  const raw = (await Browser.storage.local.get(key)) as Record<string, unknown>;
  const v = raw[key];
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

async function writeStringArray(key: string, ids: string[]): Promise<void> {
  await Browser.storage.local.set({ [key]: ids });
}

export async function getEnabledIds(): Promise<string[]> {
  return readStringArray(ENABLED_KEY);
}

export async function getAppliedIds(): Promise<string[]> {
  return readStringArray(APPLIED_KEY);
}

let inflight: Promise<ApplyResult> | null = null;
let queuedDesired: string[] | null = null;
const queuedResolvers: ((r: ApplyResult) => void)[] = [];

function classifyError(err: unknown): { kind: string; message: string } {
  if (err instanceof Error) {
    const m = err.message.match(/^([a-z_]+):\s*(.*)$/);
    if (m) return { kind: m[1], message: m[2] };
    return { kind: 'reinstall_failed', message: err.message };
  }
  return { kind: 'reinstall_failed', message: String(err) };
}

async function runApply(ids: string[], reinstall: ReinstallFn): Promise<ApplyResult> {
  await writeStringArray(ENABLED_KEY, [...ids].sort());
  try {
    await reinstall();
    await writeStringArray(APPLIED_KEY, [...ids].sort());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }
}

export async function applyEnabledIds(
  ids: string[],
  reinstall: ReinstallFn,
): Promise<ApplyResult> {
  await writeStringArray(ENABLED_KEY, [...ids].sort());

  if (inflight) {
    return new Promise<ApplyResult>((resolve) => {
      queuedDesired = ids;
      queuedResolvers.push(resolve);
    });
  }

  inflight = (async () => {
    let lastResult = await runApply(ids, reinstall);
    while (queuedDesired !== null) {
      const next = queuedDesired;
      queuedDesired = null;
      const resolvers = queuedResolvers.splice(0);
      lastResult = await runApply(next, reinstall);
      for (const r of resolvers) r(lastResult);
    }
    return lastResult;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

interface DefaultPolicyEntry {
  id: string;
  text: string;
}

async function loadDefaults(): Promise<DefaultPolicyEntry[]> {
  const url = Browser.runtime.getURL('default-policies/policy-set.json');
  const res = await fetch(url);
  return (await res.json()) as DefaultPolicyEntry[];
}

function namespaceOf(id: string): string {
  // "default::dex/foo" → "default::dex"
  const slash = id.lastIndexOf('/');
  return slash >= 0 ? id.slice(0, slash) : id;
}

export async function getCatalog(): Promise<Catalog> {
  const [defaults, bundles, enabledRaw, appliedRaw] = await Promise.all([
    loadDefaults(),
    listInstalled(),
    getEnabledIds(),
    getAppliedIds(),
  ]);

  const policies: CatalogPolicy[] = [];
  for (const entry of defaults) {
    const meta = parsePolicyMeta(entry.text);
    policies.push({
      id: entry.id,
      rules: meta.rules,
      dominantSeverity: meta.dominantSeverity,
      sourceLabel: namespaceOf(entry.id),
    });
  }
  for (const bundle of bundles) {
    const sourceLabel = `${bundle.bundle_id}@${bundle.version}`;
    for (const entry of bundle.renderedPolicySet) {
      const meta = parsePolicyMeta(entry.text);
      policies.push({
        id: entry.id,
        rules: meta.rules,
        dominantSeverity: meta.dominantSeverity,
        sourceLabel,
      });
    }
  }

  const knownIds = new Set(policies.map((p) => p.id));
  const enabled = enabledRaw.filter((id) => knownIds.has(id));
  const applied = appliedRaw.filter((id) => knownIds.has(id));

  return { policies, enabled, applied };
}
