# Per-Policy Selection Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give testers a popup UI to enable/disable individual policies; only the enabled subset is installed into the WASM engine.

**Architecture:** Popup writes a desired `enabled-ids` list to `chrome.storage.local`. A background apply queue serializes reinstalls — it intersects (defaults ∪ marketplace) with enabled-ids and calls `installPolicies()`. After a successful install, `applied-ids` is updated. The popup's footer derives its state from `enabled` vs `applied`.

**Tech Stack:** TypeScript, vanilla DOM (no React), webpack 5, vitest + happy-dom, `webextension-polyfill`, existing WASM bridge.

**Spec:** `docs/specs/2026-05-09-policy-selection-popup-design.md`

---

## File Structure

```
extension/public/popup.html                                  modify  (HTML shell)
extension/src/popup/index.ts                                 create  (popup UI)
extension/src/popup/styles.css                               create  (popup CSS)
extension/src/lib/policy-meta.ts                             create  (annotation parser, shared)
extension/src/lib/__tests__/policy-meta.test.ts              create
extension/src/background/policy-selection.ts                 create  (store + queue + catalog)
extension/src/background/__tests__/policy-selection.test.ts  create
extension/src/background/policies-loader.ts                  modify  (filter + clear-on-reject)
extension/src/background/__tests__/policies-loader.test.ts   create
extension/src/background/index.ts                            modify  (onMessage handlers)
extension/webpack/webpack.common.js                          modify  (add popup/index entry)
```

Run all extension-side commands from the worktree root unless noted. Tests run with `yarn --cwd extension test --run <path>`. Vitest config (`extension/vitest.config.ts`) already aliases `@lib`/`@background` and uses `happy-dom`.

---

### Task 1: Cedar annotation parser (`lib/policy-meta.ts`)

**Files:**
- Create: `extension/src/lib/policy-meta.ts`
- Test: `extension/src/lib/__tests__/policy-meta.test.ts`

This is a pure TS module with zero dependencies. It walks a Cedar policy text and returns annotation metadata. Severity values must match what the engine emits (`crates/policy-engine/src/policy.rs:104–112` — `deny | warn`); a missing `@severity` falls through to `unknown`.

A single JSON entry can contain multiple `forbid`/`permit` clauses. Each clause has its own annotations, so the parser walks clauses, not the whole text.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/lib/__tests__/policy-meta.test.ts
import { describe, expect, it } from 'vitest';
import { parsePolicyMeta } from '@lib/policy-meta';

describe('parsePolicyMeta', () => {
  it('parses a single-rule entry with @id, @severity, @reason', () => {
    const text = `@id("user/no-zero-min-output")
@severity("deny")
@reason("Min output of 0 disables slippage protection")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has minOutputUsd && context.minOutputUsd == 0
};
`;
    const meta = parsePolicyMeta(text);
    expect(meta.shortId).toBe('user/no-zero-min-output');
    expect(meta.rules).toEqual([
      { severity: 'deny', reason: 'Min output of 0 disables slippage protection' },
    ]);
    expect(meta.dominantSeverity).toBe('deny');
  });

  it('parses an entry with multiple forbid clauses, each with its own annotations', () => {
    const text = `@id("a/x")
@severity("warn")
@reason("warn case")
forbid (principal, action, resource) when { 1 == 1 };
@id("a/x")
@severity("deny")
@reason("deny case")
forbid (principal, action, resource) when { 1 == 2 };
`;
    const meta = parsePolicyMeta(text);
    expect(meta.rules).toEqual([
      { severity: 'warn', reason: 'warn case' },
      { severity: 'deny', reason: 'deny case' },
    ]);
    expect(meta.dominantSeverity).toBe('deny');
  });

  it('falls back to unknown severity and a default reason when annotations are missing', () => {
    const text = `forbid (principal, action, resource);`;
    const meta = parsePolicyMeta(text);
    expect(meta.shortId).toBe('');
    expect(meta.rules).toEqual([
      { severity: 'unknown', reason: '(no reason annotation)' },
    ]);
    expect(meta.dominantSeverity).toBe('unknown');
  });

  it('promotes deny over warn over unknown for dominantSeverity', () => {
    const text = `@severity("warn") @reason("w") forbid (principal, action, resource);
@severity("unknown") @reason("u") forbid (principal, action, resource);`;
    expect(parsePolicyMeta(text).dominantSeverity).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd extension test --run src/lib/__tests__/policy-meta.test.ts`
Expected: FAIL with `Cannot find module '@lib/policy-meta'` or similar.

- [ ] **Step 3: Implement `parsePolicyMeta`**

```typescript
// extension/src/lib/policy-meta.ts
export type Severity = 'deny' | 'warn' | 'unknown';

export interface Rule {
  severity: Severity;
  reason: string;
}

export interface PolicyMeta {
  shortId: string;
  rules: Rule[];
  dominantSeverity: Severity;
}

const ID_RE = /@id\(\s*"([^"]+)"\s*\)/;
const SEVERITY_RE = /@severity\(\s*"([^"]+)"\s*\)/;
const REASON_RE = /@reason\(\s*"((?:[^"\\]|\\.)*)"\s*\)/;

const SEVERITY_RANK: Record<Severity, number> = { unknown: 0, warn: 1, deny: 2 };

/**
 * Split a Cedar source into per-clause segments. Each segment ends at
 * the `;` terminating a `forbid` or `permit` statement. Annotations
 * preceding that statement belong to its segment.
 */
function splitClauses(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ';' && depth === 0) {
      segments.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  return segments
    .map((s) => s.trim())
    .filter((s) => /\b(forbid|permit)\s*\(/.test(s));
}

function pickSeverity(value: string | undefined): Severity {
  if (value === 'deny' || value === 'warn') return value;
  return 'unknown';
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

export function parsePolicyMeta(text: string): PolicyMeta {
  const clauses = splitClauses(text);
  const idMatch = text.match(ID_RE);
  const shortId = idMatch ? idMatch[1] : '';

  const rules: Rule[] = clauses.length === 0
    ? [{ severity: 'unknown', reason: '(no reason annotation)' }]
    : clauses.map((clause) => {
        const sev = clause.match(SEVERITY_RE);
        const reason = clause.match(REASON_RE);
        return {
          severity: pickSeverity(sev?.[1]),
          reason: reason ? unescape(reason[1]) : '(no reason annotation)',
        };
      });

  let dominant: Severity = 'unknown';
  for (const r of rules) {
    if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[dominant]) dominant = r.severity;
  }

  return { shortId, rules, dominantSeverity: dominant };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd extension test --run src/lib/__tests__/policy-meta.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/policy-meta.ts extension/src/lib/__tests__/policy-meta.test.ts
git commit -m "feat: parsePolicyMeta — extract annotations from Cedar text"
```

---

### Task 2: Selection store + apply queue (`background/policy-selection.ts`)

**Files:**
- Create: `extension/src/background/policy-selection.ts`
- Test: `extension/src/background/__tests__/policy-selection.test.ts`

This module owns the desired-vs-applied state and the apply queue. The queue allows at most one in-flight apply; a second call replaces a queued tail. Storage keys: `policy-selection:enabled-ids` (desired) and `policy-selection:applied-ids` (active).

`getCatalog()` is implemented in this task too: it reads bundled defaults from `Browser.runtime.getURL('default-policies/policy-set.json')` and walks `listInstalled()` (NOT `aggregatedPolicySet()`, which discards `bundle_id`). It uses `parsePolicyMeta` from Task 1 to populate per-row severity / reason.

The actual reinstall is delegated to a callback so the queue and the loader can be tested independently. `background/index.ts` will wire the real `reinstallAllPolicies()` callback in Task 4.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/background/__tests__/policy-selection.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  const get = async (keys?: string | string[] | Record<string, unknown>) => {
    if (keys === undefined || keys === null)
      return Object.fromEntries(localStore.entries());
    const out: Record<string, unknown> = {};
    if (typeof keys === 'string') {
      out[keys] = localStore.get(keys);
      return out;
    }
    if (Array.isArray(keys))
      for (const k of keys) out[k] = localStore.get(k);
    else
      for (const [k, fb] of Object.entries(keys))
        out[k] = localStore.has(k) ? localStore.get(k) : fb;
    return out;
  };
  return {
    localStore,
    listInstalled: vi.fn(async () => [] as unknown[]),
    fetched: { defaults: '[]' as string, schema: '' as string },
    browser: {
      runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
      storage: {
        local: {
          get: vi.fn(get),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
        },
      },
    },
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('@background/marketplace/storage', () => ({
  listInstalled: mocks.listInstalled,
}));

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('policy-set.json')) return new Response(mocks.fetched.defaults);
  return new Response(mocks.fetched.schema);
});
vi.stubGlobal('fetch', fetchMock);

import {
  applyEnabledIds,
  getAppliedIds,
  getCatalog,
  getEnabledIds,
} from '../policy-selection';

const POLICY_A = `@id("default::dex/a")
@severity("deny") @reason("a")
forbid (principal, action, resource);`;
const POLICY_B = `@id("default::dex/b")
@severity("warn") @reason("b")
forbid (principal, action, resource);`;

describe('policy-selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localStore.clear();
    mocks.fetched.defaults = JSON.stringify([
      { id: 'default::dex/a', text: POLICY_A },
      { id: 'default::dex/b', text: POLICY_B },
    ]);
    mocks.listInstalled.mockResolvedValue([]);
  });

  it('returns empty enabled and applied ids on a fresh install', async () => {
    expect(await getEnabledIds()).toEqual([]);
    expect(await getAppliedIds()).toEqual([]);
  });

  it('persists desired ids and runs the reinstall callback', async () => {
    const reinstall = vi.fn(async () => {});
    const result = await applyEnabledIds(['default::dex/a'], reinstall);
    expect(result).toEqual({ ok: true });
    expect(reinstall).toHaveBeenCalledOnce();
    expect(await getEnabledIds()).toEqual(['default::dex/a']);
    expect(await getAppliedIds()).toEqual(['default::dex/a']);
  });

  it('collapses three rapid applyEnabledIds calls into one in-flight + one tail', async () => {
    const reinstall = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
    );
    const p1 = applyEnabledIds(['default::dex/a'], reinstall);
    const p2 = applyEnabledIds(['default::dex/b'], reinstall);
    const p3 = applyEnabledIds(['default::dex/a', 'default::dex/b'], reinstall);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(r3).toEqual({ ok: true });
    expect(reinstall).toHaveBeenCalledTimes(2);
    expect(await getAppliedIds()).toEqual(['default::dex/a', 'default::dex/b']);
  });

  it('leaves applied-ids unchanged when reinstall rejects, and recovers next call', async () => {
    const failing = vi.fn(async () => {
      throw new Error('install_failed: boom');
    });
    const r1 = await applyEnabledIds(['default::dex/a'], failing);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.kind).toBe('install_failed');
      expect(r1.error.message).toContain('boom');
    }
    expect(await getAppliedIds()).toEqual([]);

    const ok = vi.fn(async () => {});
    const r2 = await applyEnabledIds(['default::dex/b'], ok);
    expect(r2).toEqual({ ok: true });
    expect(await getAppliedIds()).toEqual(['default::dex/b']);
  });

  it('builds a catalog with per-bundle sections and stale ids filtered from the count', async () => {
    mocks.listInstalled.mockResolvedValue([
      {
        bundle_id: 'acme/v1',
        version: '0.1.0',
        author_pubkey: 'k',
        paramValues: {},
        renderedPolicySet: [
          { id: 'acme/v1::guard', text: '@id("acme/v1/guard") @severity("warn") @reason("g") forbid (principal, action, resource);' },
        ],
        installedAtMs: 0,
      },
    ]);
    await applyEnabledIds(
      ['default::dex/a', 'stale::id/gone'],
      vi.fn(async () => {}),
    );
    const cat = await getCatalog();
    expect(cat.policies.map((p) => p.id)).toEqual([
      'default::dex/a',
      'default::dex/b',
      'acme/v1::guard',
    ]);
    expect(cat.policies[0].sourceLabel).toBe('default::dex');
    expect(cat.policies[2].sourceLabel).toBe('acme/v1@0.1.0');
    expect(cat.enabled).toEqual(['default::dex/a']);
    expect(cat.applied).toEqual(['default::dex/a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd extension test --run src/background/__tests__/policy-selection.test.ts`
Expected: FAIL with `Cannot find module '../policy-selection'`.

- [ ] **Step 3: Implement `policy-selection.ts`**

```typescript
// extension/src/background/policy-selection.ts
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
  // Always update the desired-ids store immediately, even if a reinstall
  // is already running — if a third call arrives, the tail's stored value
  // should reflect the latest desired state.
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
  const [defaults, bundles, enabledRaw, applied] = await Promise.all([
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

  return { policies, enabled, applied };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd extension test --run src/background/__tests__/policy-selection.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/policy-selection.ts extension/src/background/__tests__/policy-selection.test.ts
git commit -m "feat: policy-selection store + apply queue + catalog"
```

---

### Task 3: Filter loader by enabled-ids + clear on reject

**Files:**
- Modify: `extension/src/background/policies-loader.ts`
- Test: `extension/src/background/__tests__/policies-loader.test.ts`

Two changes:

1. Filter the union of (defaults ∪ marketplace) by `enabled-ids` before calling `installPolicies()`. Empty enabled set ⇒ install with `policy_set: []` (the engine's `engine/baseline-allow` is auto-injected).
2. On `installPolicies()` rejection, clear `installed`/`inflight` so the next call retries instead of re-throwing the cached error.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/background/__tests__/policies-loader.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const localStore = new Map<string, unknown>();
  return {
    localStore,
    installPolicies: vi.fn(
      async (_input: { schema_text: string; policy_set: { id: string; text: string }[] }) => {},
    ),
    aggregatedPolicySet: vi.fn(async () => [] as { id: string; text: string }[]),
    fetchedDefaults: '[]',
    fetchedSchema: '',
    browser: {
      runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStore.get(key) })),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(entries)) localStore.set(k, v);
          }),
        },
      },
    },
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('../wasm-bridge', () => ({ installPolicies: mocks.installPolicies }));
vi.mock('../marketplace/storage', () => ({
  aggregatedPolicySet: mocks.aggregatedPolicySet,
  listInstalled: vi.fn(async () => []),
}));

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('policy-set.json')) return new Response(mocks.fetchedDefaults);
  return new Response(mocks.fetchedSchema);
});
vi.stubGlobal('fetch', fetchMock);

const A = '@id("default::dex/a") @severity("deny") @reason("a") forbid (principal, action, resource);';
const B = '@id("default::dex/b") @severity("warn") @reason("b") forbid (principal, action, resource);';
const C = '@id("default::dex/c") @severity("warn") @reason("c") forbid (principal, action, resource);';

describe('policies-loader (filtered install)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.localStore.clear();
    mocks.fetchedDefaults = JSON.stringify([
      { id: 'default::dex/a', text: A },
      { id: 'default::dex/b', text: B },
      { id: 'default::dex/c', text: C },
    ]);
    mocks.fetchedSchema = '';
    mocks.aggregatedPolicySet.mockResolvedValue([]);
    vi.resetModules();
  });

  it('installs only the enabled subset of defaults', async () => {
    mocks.localStore.set('policy-selection:enabled-ids', ['default::dex/a', 'default::dex/c']);
    const { ensureDefaultPoliciesInstalled } = await import('../policies-loader');
    await ensureDefaultPoliciesInstalled();
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    const call = mocks.installPolicies.mock.calls[0][0];
    expect(call.policy_set.map((p: { id: string }) => p.id).sort()).toEqual([
      'default::dex/a',
      'default::dex/c',
    ]);
  });

  it('installs an empty policy_set when no ids are enabled', async () => {
    const { ensureDefaultPoliciesInstalled } = await import('../policies-loader');
    await ensureDefaultPoliciesInstalled();
    expect(mocks.installPolicies).toHaveBeenCalledTimes(1);
    expect(mocks.installPolicies.mock.calls[0][0].policy_set).toEqual([]);
  });

  it('clears installed/inflight on rejection so the next call retries', async () => {
    mocks.localStore.set('policy-selection:enabled-ids', ['default::dex/a']);
    mocks.installPolicies
      .mockRejectedValueOnce(new Error('install_failed: boom'))
      .mockResolvedValueOnce(undefined);
    const { reinstallAllPolicies } = await import('../policies-loader');
    await expect(reinstallAllPolicies()).rejects.toThrow(/boom/);
    await reinstallAllPolicies();
    expect(mocks.installPolicies).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn --cwd extension test --run src/background/__tests__/policies-loader.test.ts`
Expected: FAIL — current loader doesn't filter and poisons inflight.

- [ ] **Step 3: Replace `policies-loader.ts` contents**

```typescript
// extension/src/background/policies-loader.ts
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
 * Install the intersection of (defaults ∪ marketplace) and the user's
 * enabled-ids selection. Empty enabled-ids ⇒ install with no policies
 * (the engine's `engine/baseline-allow` is auto-injected by the
 * builder).
 *
 * On reject, both `installed` and `inflight` are cleared so the next
 * call retries fresh instead of re-throwing the cached rejection.
 */
export async function ensureDefaultPoliciesInstalled(): Promise<void> {
  if (installed) return;
  if (inflight) return inflight;
  inflight = (async () => {
    const [{ schemaText, policies: defaults }, marketplacePolicies, enabled] = await Promise.all([
      loadDefaultPolicySet(),
      aggregatedPolicySet(),
      getEnabledIds(),
    ]);
    const enabledSet = new Set(enabled);
    const union = [...defaults, ...marketplacePolicies];
    const filtered = union.filter((p) => enabledSet.has(p.id));
    await installPolicies({ schema_text: schemaText, policy_set: filtered });
    installed = true;
  })();
  try {
    await inflight;
  } catch (err) {
    installed = false;
    inflight = null;
    throw err;
  } finally {
    inflight = null;
  }
}

/** Forces a re-install — call after any selection change or marketplace mutation. */
export async function reinstallAllPolicies(): Promise<void> {
  installed = false;
  inflight = null;
  await ensureDefaultPoliciesInstalled();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn --cwd extension test --run src/background/__tests__/policies-loader.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Sanity-check the rest of the test suite still passes**

Run: `yarn --cwd extension test --run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/policies-loader.ts extension/src/background/__tests__/policies-loader.test.ts
git commit -m "refactor: policies-loader filters by enabled-ids; clears state on reject"
```

---

### Task 4: Background message handlers

**Files:**
- Modify: `extension/src/background/index.ts`

Add two `Browser.runtime.onMessage` handlers, orthogonal to the existing content-script port. The handlers feed the popup's two operations.

`set-enabled-ids` invokes `applyEnabledIds(ids, reinstallAllPolicies)`. Because `reinstallAllPolicies()` reads `enabled-ids` from storage and Task 2's `applyEnabledIds()` writes it before calling the reinstall callback, the loader sees the new desired set.

- [ ] **Step 1: Read the current file before editing**

Open `extension/src/background/index.ts` so the imports section and the `onConnect` block are visible.

- [ ] **Step 2: Add new imports next to the existing ones**

Insert these two lines into the existing import group at the top of the file:

```typescript
import { applyEnabledIds, getCatalog } from './policy-selection';
import { reinstallAllPolicies } from './policies-loader';
```

(Keep the existing `ensureDefaultPoliciesInstalled` import as-is.)

- [ ] **Step 3: Append message handlers at the end of the file**

After the existing `Browser.runtime.onConnect.addListener(...)` block, append:

```typescript
interface PolicyCatalogRequest {
  type: 'policy-catalog';
}
interface SetEnabledIdsRequest {
  type: 'set-enabled-ids';
  ids: string[];
}
type PopupRequest = PolicyCatalogRequest | SetEnabledIdsRequest;

Browser.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (r: unknown) => void) => {
    const req = message as Partial<PopupRequest> | null;
    if (!req || typeof req !== 'object') return false;

    if (req.type === 'policy-catalog') {
      void getCatalog()
        .then((cat) => sendResponse({ ok: true, data: cat }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: 'catalog_failed', message: String(err) },
          }),
        );
      return true; // keep the channel open for the async response
    }

    if (req.type === 'set-enabled-ids' && Array.isArray(req.ids)) {
      const ids = req.ids.filter((id): id is string => typeof id === 'string');
      void applyEnabledIds(ids, reinstallAllPolicies)
        .then((result) => sendResponse(result))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: 'apply_failed', message: String(err) },
          }),
        );
      return true;
    }

    return false;
  },
);
```

- [ ] **Step 4: Type-check**

Run: `yarn --cwd extension typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `yarn --cwd extension test --run`
Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat: background message handlers for policy-selection popup"
```

---

### Task 5: Popup HTML shell + webpack entry

**Files:**
- Modify: `extension/public/popup.html`
- Modify: `extension/webpack/webpack.common.js`
- Create (placeholder): `extension/src/popup/index.ts`
- Create (placeholder): `extension/src/popup/styles.css`

Mirror the `confirm.html` pattern: a `<main id="root">` plus a script tag pointing at the bundled entry. Add a webpack entry `popup/index` so the bundle gets emitted at `dist/<browser>/js/popup/index.js`. The TS module is a one-line placeholder so webpack has something to compile; Task 6 overwrites it.

- [ ] **Step 1: Replace `popup.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Scopeball — Policy selection</title>
  </head>
  <body>
    <main id="root"></main>
    <script src="js/popup/index.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Add the webpack entry**

In `extension/webpack/webpack.common.js`, inside the `entry: { … }` object, add a new line **before** the `manifest:` line:

```javascript
    'popup/index': path.join(sourceDir, 'popup', 'index.ts'),
```

The full block after the edit:

```javascript
  entry: {
    background: path.join(sourceDir, 'background', 'index.ts'),
    'content-scripts/inject-scripts': path.join(sourceDir, 'content-scripts', 'inject-scripts.ts'),
    'content-scripts/window-ethereum-messages': path.join(
      sourceDir,
      'content-scripts',
      'window-ethereum-messages.ts',
    ),
    'content-scripts/bypass-check': path.join(sourceDir, 'content-scripts', 'bypass-check.ts'),
    'injected/proxy-injected-providers': path.join(
      sourceDir,
      'injected',
      'proxy-injected-providers.ts',
    ),
    'confirm/index': path.join(sourceDir, 'confirm', 'index.ts'),
    'popup/index': path.join(sourceDir, 'popup', 'index.ts'),
    manifest: path.join(sourceDir, 'manifest.json'),
  },
```

- [ ] **Step 3: Create placeholder TS + CSS so webpack has something to compile**

Create `extension/src/popup/styles.css` with:

```css
/* placeholder; real styles in Task 6 */
```

Create `extension/src/popup/index.ts` with:

```typescript
import './styles.css';
console.log('Scopeball popup placeholder');
```

- [ ] **Step 4: Verify webpack builds**

Run: `yarn --cwd extension build:chrome`
Expected: build succeeds; `extension/dist/chrome/js/popup/index.js` exists.

- [ ] **Step 5: Commit**

```bash
git add extension/public/popup.html extension/webpack/webpack.common.js extension/src/popup/index.ts extension/src/popup/styles.css
git commit -m "chore: webpack entry + HTML shell for popup"
```

---

### Task 6: Popup UI (rendering, toggles, "Only this", apply)

**Files:**
- Overwrite: `extension/src/popup/index.ts`
- Overwrite: `extension/src/popup/styles.css`

The popup renders a fixed-width body with sticky header/footer and a scrollable middle. Rows are grouped by `sourceLabel`. Each row shows an `<input type="checkbox">`, the policy id, a severity badge, the reason text (with `+N more` chip if multiple distinct reasons), and an "Only this" button. Toggles post `set-enabled-ids` immediately.

State machine for the footer status: `idle | applying | error`. On `set-enabled-ids` start → `applying`; on response `{ok:true}` → `idle`; on response `{ok:false}` → `error` with the kind+message. After every reply, the popup re-fetches the catalog so the row checkboxes track `applied`.

- [ ] **Step 1: Overwrite `extension/src/popup/styles.css`**

```css
:root {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color-scheme: light dark;
  --bg: #0c0c10;
  --fg: #e9e9ee;
  --card: #16161d;
  --muted: #8b8b95;
  --warn: #f1c40f;
  --deny: #e74c3c;
  --unknown: #5c6370;
  --accent: #4f8cff;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
}

#root {
  width: 360px;
  max-height: 600px;
  display: flex;
  flex-direction: column;
}

header,
footer {
  position: sticky;
  background: var(--card);
  padding: 10px 12px;
  z-index: 1;
}
header {
  top: 0;
  border-bottom: 1px solid #2a2a35;
}
footer {
  bottom: 0;
  border-top: 1px solid #2a2a35;
  font-size: 11px;
  color: var(--muted);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.title-row h1 {
  font-size: 13px;
  margin: 0;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 6px;
}
button {
  background: #1f1f2a;
  color: var(--fg);
  border: 1px solid #2a2a35;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}
button:hover {
  background: #2a2a35;
}
.search {
  width: 100%;
  box-sizing: border-box;
  background: #1f1f2a;
  color: var(--fg);
  border: 1px solid #2a2a35;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
}
.banner {
  background: #2a1f10;
  color: var(--warn);
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 11px;
  margin: 8px 0 0;
  border: 1px solid #3a2a18;
}

main {
  overflow-y: auto;
  padding: 8px 12px;
  flex: 1;
}
.section h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin: 12px 0 6px;
}

.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: start;
  padding: 6px 0;
  border-bottom: 1px solid #1c1c24;
}
.row .meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.row .id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row .reason {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-right: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.badge.deny {
  background: var(--deny);
  color: #fff;
}
.badge.warn {
  background: var(--warn);
  color: #1a1a22;
}
.badge.unknown {
  background: var(--unknown);
  color: #fff;
}
.chip-more {
  font-size: 10px;
  color: var(--muted);
  margin-left: 4px;
}

.only {
  align-self: center;
  background: transparent;
  color: var(--accent);
  border-color: transparent;
  padding: 2px 6px;
}
.only:hover {
  background: #1f1f2a;
}

.status.error {
  color: var(--deny);
}
```

- [ ] **Step 2: Overwrite `extension/src/popup/index.ts`**

```typescript
import Browser from 'webextension-polyfill';
import './styles.css';

interface CatalogPolicy {
  id: string;
  rules: { severity: 'deny' | 'warn' | 'unknown'; reason: string }[];
  dominantSeverity: 'deny' | 'warn' | 'unknown';
  sourceLabel: string;
}
interface Catalog {
  policies: CatalogPolicy[];
  enabled: string[];
  applied: string[];
}
type ApplyResponse =
  | { ok: true }
  | { ok: false; error: { kind: string; message: string } };
type CatalogResponse =
  | { ok: true; data: Catalog }
  | { ok: false; error: { kind: string; message: string } };

const state: {
  catalog: Catalog | null;
  searchTerm: string;
  status: 'idle' | 'applying' | 'error';
  errorText: string;
} = { catalog: null, searchTerm: '', status: 'idle', errorText: '' };

async function fetchCatalog(): Promise<Catalog> {
  const res = (await Browser.runtime.sendMessage({ type: 'policy-catalog' })) as CatalogResponse;
  if (!res.ok) throw new Error(`${res.error.kind}: ${res.error.message}`);
  return res.data;
}

async function postSetEnabledIds(ids: string[]): Promise<ApplyResponse> {
  return (await Browser.runtime.sendMessage({
    type: 'set-enabled-ids',
    ids,
  })) as ApplyResponse;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<{ class: string; text: string; type: string; placeholder: string }> = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.type && 'type' in node) (node as unknown as HTMLInputElement).type = attrs.type;
  if (attrs.placeholder && 'placeholder' in node)
    (node as unknown as HTMLInputElement).placeholder = attrs.placeholder;
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function badge(severity: 'deny' | 'warn' | 'unknown'): HTMLSpanElement {
  return el('span', { class: `badge ${severity}`, text: severity });
}

function distinctReasons(p: CatalogPolicy): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of p.rules) {
    if (!seen.has(r.reason)) {
      seen.add(r.reason);
      out.push(r.reason);
    }
  }
  return out;
}

function matchesSearch(p: CatalogPolicy, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  if (p.id.toLowerCase().includes(t)) return true;
  return p.rules.some((r) => r.reason.toLowerCase().includes(t));
}

async function applyIds(ids: string[]): Promise<void> {
  state.status = 'applying';
  render();
  const result = await postSetEnabledIds(ids);
  if (result.ok) {
    state.status = 'idle';
    state.errorText = '';
  } else {
    state.status = 'error';
    state.errorText = `${result.error.kind}: ${result.error.message}`;
  }
  state.catalog = await fetchCatalog();
  render();
}

function renderRow(p: CatalogPolicy, enabledSet: Set<string>): HTMLDivElement {
  const reasons = distinctReasons(p);
  const reasonText = reasons[0] ?? '(no reason annotation)';
  const moreCount = reasons.length - 1;

  const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
  checkbox.checked = enabledSet.has(p.id);
  checkbox.addEventListener('change', () => {
    const next = new Set(enabledSet);
    if (checkbox.checked) next.add(p.id);
    else next.delete(p.id);
    void applyIds([...next]);
  });

  const meta = el('div', { class: 'meta' }, [
    el('div', { class: 'id', text: p.id }),
    el('div', { class: 'reason' }, [
      badge(p.dominantSeverity),
      reasonText,
      ...(moreCount > 0
        ? [el('span', { class: 'chip-more', text: `+${moreCount} more` })]
        : []),
    ]),
  ]);

  const onlyBtn = el('button', { class: 'only', text: 'Only this' });
  onlyBtn.addEventListener('click', () => void applyIds([p.id]));

  return el('div', { class: 'row' }, [checkbox, meta, onlyBtn]);
}

function render(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();

  if (!state.catalog) {
    root.appendChild(el('main', {}, [el('p', { text: 'Loading…' })]));
    return;
  }

  const c = state.catalog;
  const enabledSet = new Set(c.enabled);
  const total = c.policies.length;
  const enabledCount = c.enabled.length;

  // Header
  const titleRow = el('div', { class: 'title-row' }, [
    el('h1', { text: `${enabledCount} of ${total} enabled` }),
    el('div', { class: 'actions' }, [
      (() => {
        const b = el('button', { text: 'Enable all' });
        b.addEventListener('click', () => void applyIds(c.policies.map((p) => p.id)));
        return b;
      })(),
      (() => {
        const b = el('button', { text: 'Disable all' });
        b.addEventListener('click', () => void applyIds([]));
        return b;
      })(),
    ]),
  ]);

  const search = el('input', {
    class: 'search',
    type: 'text',
    placeholder: 'Search by id or reason',
  }) as HTMLInputElement;
  search.value = state.searchTerm;
  search.addEventListener('input', () => {
    state.searchTerm = search.value;
    render();
    const newSearch = document.querySelector<HTMLInputElement>('.search');
    if (newSearch) {
      newSearch.focus();
      const len = newSearch.value.length;
      newSearch.setSelectionRange(len, len);
    }
  });

  const headerChildren: (HTMLElement | string)[] = [titleRow, search];
  if (total > 0 && enabledCount === 0) {
    headerChildren.push(
      el('div', {
        class: 'banner',
        text:
          'All policies disabled — every Cedar verdict will pass; the orchestrator may still warn on unsupported request paths.',
      }),
    );
  }
  root.appendChild(el('header', {}, headerChildren));

  // Body
  const main = el('main');
  const groups = new Map<string, CatalogPolicy[]>();
  for (const p of c.policies) {
    if (!matchesSearch(p, state.searchTerm)) continue;
    if (!groups.has(p.sourceLabel)) groups.set(p.sourceLabel, []);
    groups.get(p.sourceLabel)!.push(p);
  }
  for (const [label, items] of groups) {
    const section = el('section', { class: 'section' }, [
      el('h2', { text: label }),
      ...items.map((p) => renderRow(p, enabledSet)),
    ]);
    main.appendChild(section);
  }
  if (groups.size === 0) {
    main.appendChild(el('p', { text: 'No matches.' }));
  }
  root.appendChild(main);

  // Footer
  let statusText = 'Up to date';
  let statusClass = 'status';
  if (state.status === 'applying') statusText = 'Reinstalling…';
  if (state.status === 'error') {
    statusText = `Error: ${state.errorText}`;
    statusClass = 'status error';
  } else if (
    [...enabledSet].sort().join(',') !== [...c.applied].sort().join(',')
  ) {
    statusText = 'Reinstalling…';
  }
  root.appendChild(el('footer', {}, [el('span', { class: statusClass, text: statusText })]));
}

void (async () => {
  try {
    state.catalog = await fetchCatalog();
  } catch (err) {
    state.status = 'error';
    state.errorText = String(err);
  }
  render();
})();
```

- [ ] **Step 3: Type-check**

Run: `yarn --cwd extension typecheck`
Expected: no errors.

- [ ] **Step 4: Build the extension**

Run: `yarn --cwd extension build:chrome`
Expected: build succeeds; `dist/chrome/popup.html` and `dist/chrome/js/popup/index.js` are emitted.

- [ ] **Step 5: Run the full test suite**

Run: `yarn --cwd extension test --run`
Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src/popup/index.ts extension/src/popup/styles.css
git commit -m "feat: per-policy selection popup UI"
```

---

### Task 7: Manual end-to-end validation

**Files:** none (verification only)

This task does not change source. It runs the extension in a real Chrome and walks the test scenarios from the spec.

- [ ] **Step 1: Build and install**

Run: `yarn --cwd extension build:chrome`

In Chrome: navigate to `chrome://extensions`, enable Developer mode, click "Load unpacked", and pick `extension/dist/chrome`.

- [ ] **Step 2: Verify default state on first install**

- Click the Scopeball toolbar icon. The popup opens.
- Header reads `0 of 20 enabled` (or higher if marketplace bundles are installed).
- Banner is visible: *"All policies disabled — every Cedar verdict will pass…"*
- Footer reads `Up to date`.

- [ ] **Step 3: Verify "Only this"**

- Click "Only this" on `default::dex/max-input-usd-100`.
- Footer briefly shows `Reinstalling…`, then returns to `Up to date`.
- Header reads `1 of N enabled`. The banner is gone.
- Reopen the popup (close + click icon again). The single enabled row is still checked. Persistence confirmed.

- [ ] **Step 4: Verify a failing dApp transaction matches only the enabled policy**

- On a test dApp (Uniswap UI in incognito with a fresh test wallet, or a synthetic eth_sendTransaction via a console snippet), trigger a swap that would normally trigger multiple policies (e.g. an over-threshold swap on a non-allowlisted protocol).
- The verdict modal should cite *only* `default::dex/max-input-usd-100`. Any other rule (uniswap-only-allowlist, no-zero-min-output) must be absent.

- [ ] **Step 5: Verify install failure recovery**

- Open DevTools on the popup ("Inspect popup" from the toolbar context menu).
- Disable all policies, then re-enable one.
- Expected: footer shows `Up to date` after each apply.
- If you have access to a malformed marketplace bundle, install it and toggle one of its policies on. Footer should show `Error: install_failed: …`. After uninstalling the bad bundle, toggling another (default) policy should succeed and the popup should return to `Up to date`. (If no malformed bundle is available, skip this sub-step.)

- [ ] **Step 6: If nothing had to be patched, no commit is needed**

If a fix was applied along the way, commit it under a `fix:` message describing the manual finding.

---

## Self-Review (post-write)

- **Spec coverage**
  - Goals (every known policy + persistence + filtered install + first-run all-disabled): Tasks 2, 3, 5, 6.
  - Architecture: enabled-vs-applied state — Task 2; serialization queue — Task 2; filter on install — Task 3; loader-poison fix — Task 3.
  - Component 4.1 popup/index.ts — Task 6. 4.2 lib/policy-meta.ts — Task 1. 4.3 background/policy-selection.ts — Task 2. 4.4 policies-loader.ts — Task 3. 4.5 background/index.ts — Task 4. Webpack/popup.html — Task 5.
  - Data flow steps 1–6: covered by the wiring across Tasks 2, 3, 4, 6.
  - Error handling: reinstall failure (Task 2 + Task 6 footer state); loader poison (Task 3); empty-set semantics (Task 3 + Task 6 banner); catalog parse fallback (Task 1's `unknown` severity); stale-id filtering (Task 2's `getCatalog`).
  - Testing matrix: Task 1 covers `parsePolicyMeta`; Task 2 covers queue collapse, rollback, stale-id; Task 3 covers loader filter and clear-on-reject; Task 7 covers manual e2e.
- **Placeholder scan**
  - Every step has either a code block or an exact command.
  - Task 5 explicitly notes the `popup/index.ts` is a placeholder that Task 6 overwrites — this is intentional ordering, not a missing implementation.
- **Type consistency**
  - `Severity` is `'deny' | 'warn' | 'unknown'` everywhere (Task 1 export, Task 2 catalog, Task 6 row rendering).
  - `applyEnabledIds(ids, reinstall)` signature is consistent across Task 2 (definition), Task 4 (call site), and the test in Task 2.
  - `Catalog` shape (`{policies, enabled, applied}`) matches between Task 2's `getCatalog`, Task 4's `sendResponse`, and Task 6's `fetchCatalog` consumer.

---

## Execution Handoff

Plan saved to `docs/plans/2026-05-09-policy-selection-popup.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
