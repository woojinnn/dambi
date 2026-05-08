# Orchestrator + Verdict Modal — Plan 5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the WASM bridge into the background SW so intercepted requests run the full lifecycle — build action → fetch facts → evaluate → enforce verdict — and surface Warn verdicts in a separate Chrome window the user can confirm or reject. Output: an installable extension that blocks Fail verdicts and prompts on Warn.

**Architecture:** Background SW loads the WASM module on startup (cached in IndexedDB), maintains a pending-request queue in `chrome.storage.session`, runs the lifecycle on each intercepted message, opens a `chrome.windows.create` popup for Warn verdicts, persists pending-deltas for windowing, and polls receipts via `chrome.alarms`. Verdict modal is a small React UI page (`confirm.html`) loaded in that popup window.

**Tech Stack:** wasm-bindgen-generated JS glue (consumed via dynamic import), React 18 + Vite-style build via webpack, `chrome.storage.session` + IndexedDB for state, `chrome.alarms` for receipt polling.

**Series:** Plan 5 of the Chrome-extension series. Depends on Plan 1 (engine API), Plan 2 (WASM bridge), Plan 3 (extension scaffold), Plan 4 (fact fetchers). Final plan before marketplace work (Plan 6).

**Scope:** Background orchestrator, WASM loader/cache, pending queues, verdict modal UI, receipt-polling alarm. Hardcoded default policy set (the `policies/dex/*` and `policies/signature/_shared/*` from the engine repo) shipped as a static asset; Plan 6 replaces this with marketplace bundles.

**Out of scope:** Marketplace catalog/install flow (Plan 6), bundle templates (Plan 6), AST equivalence (Plan 6), settings UI for per-policy toggles.

---

## File map

| Path | Action | Responsibility |
|------|--------|----------------|
| `extension/package.json` | Modify | Add React, ReactDOM, dependent deps |
| `extension/webpack/webpack.common.js` | Modify | New entry: `confirm.tsx` |
| `extension/src/manifest.json` | Modify | `web_accessible_resources` adds `confirm.html`; add `wasm-unsafe-eval` to CSP |
| `extension/src/background/index.ts` | Modify | Replace logging stub with real lifecycle |
| `extension/src/background/wasm-bridge.ts` | Create | Loads + caches the WASM module, calls 5 exports |
| `extension/src/background/orchestrator.ts` | Create | Full per-request lifecycle |
| `extension/src/background/storage.ts` | Create | Pending request queue + audit log |
| `extension/src/background/pending-deltas.ts` | Create | In-flight tx delta tracker for windowing |
| `extension/src/background/receipt-poller.ts` | Create | `chrome.alarms`-driven tx receipt polling |
| `extension/src/background/policies-loader.ts` | Create | Loads bundled default Cedar policies + schema, calls `install_policies_json` |
| `extension/public/confirm.html` | Create | Verdict modal HTML shell |
| `extension/src/confirm/index.tsx` | Create | React entry |
| `extension/src/confirm/VerdictModal.tsx` | Create | Modal component |
| `extension/src/confirm/styles.css` | Create | Minimal modal styles |
| `extension/scripts/copy-default-policies.js` | Create | Build-time copy of `policies/` + `policy-schema/` into the extension bundle |
| `extension/src/background/__tests__/orchestrator.test.ts` | Create | Lifecycle integration test with mocked WASM bridge |

---

## Task 1: React + confirm-page deps

**Files:** Modify `extension/package.json`, `webpack.common.js`.

- [ ] **Step 1: Add deps**

In `extension/package.json` `dependencies`:

```json
"react": "^18.3.1",
"react-dom": "^18.3.1"
```

In `devDependencies`:

```json
"@types/react": "^18.3.3",
"@types/react-dom": "^18.3.0",
"css-loader": "^7.1.2",
"style-loader": "^4.0.0"
```

Run: `cd extension && yarn install`.

- [ ] **Step 2: Add confirm entry + CSS rule**

Edit `extension/webpack/webpack.common.js`:

```javascript
// In `entry`, add:
'confirm/index': path.join(sourceDir, 'confirm', 'index.tsx'),
```

Add to `module.rules`:

```javascript
{ test: /\.css$/, use: ['style-loader', 'css-loader'] },
```

- [ ] **Step 3: Update tsconfig for JSX**

In `extension/tsconfig.json` `compilerOptions`, ensure:

```json
"jsx": "react-jsx",
```

- [ ] **Step 4: Commit**

```bash
git add extension/package.json extension/yarn.lock extension/webpack/ extension/tsconfig.json
git commit -m "chore(extension): React 18 + confirm page entry"
```

---

## Task 2: Default policies build-time copy

**Files:** Create `extension/scripts/copy-default-policies.js`, modify `webpack.common.js`.

The engine ships Cedar policies under `policies/` and a schema under `policy-schema/`. Plan 5 ships these as the extension's default policy set. Plan 6 replaces them with marketplace bundles.

- [ ] **Step 1: Write the copy script**

```javascript
// extension/scripts/copy-default-policies.js
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEST = path.resolve(__dirname, '..', 'public', 'default-policies');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function listCedarFiles(dir) {
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.cedar')) files.push(full);
    }
  }
  walk(dir);
  return files;
}

function main() {
  if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

  const schemaParts = [
    'policy-schema/core.cedarschema',
    'policy-schema/actions/dex.cedarschema',
    'policy-schema/actions/other.cedarschema',
    'policy-schema/actions/permit2.cedarschema',
    'policy-schema/actions/eip2612.cedarschema',
    'policy-schema/actions/eip712_other.cedarschema',
    'policy-schema/actions/signature_base.cedarschema',
  ];
  const schema = schemaParts.map(read).join('\n\n');
  fs.writeFileSync(path.join(DEST, 'schema.cedarschema'), schema);

  const policiesDir = path.join(REPO_ROOT, 'policies');
  const files = listCedarFiles(policiesDir);
  const policySet = files.map((f) => ({
    id: `default::${path.relative(policiesDir, f).replace(/\\/g, '/').replace(/\.cedar$/, '')}`,
    text: fs.readFileSync(f, 'utf8'),
  }));
  fs.writeFileSync(path.join(DEST, 'policy-set.json'), JSON.stringify(policySet, null, 2));

  console.log(`Copied schema (${schemaParts.length} parts) + ${policySet.length} policies → ${DEST}`);
}

main();
```

- [ ] **Step 2: Wire into webpack as a pre-build step**

Edit `extension/package.json` `scripts`:

```json
"prebuild:chrome": "node scripts/copy-default-policies.js",
"prebuild:firefox": "node scripts/copy-default-policies.js",
"predev:chrome": "node scripts/copy-default-policies.js",
"predev:firefox": "node scripts/copy-default-policies.js"
```

- [ ] **Step 3: Run + verify**

```bash
cd extension && yarn build:chrome 2>&1 | tail -5
ls dist/chrome/default-policies/
```

Expected: `schema.cedarschema` + `policy-set.json` present, with the latter containing entries for every `policies/**/*.cedar` file.

- [ ] **Step 4: Commit**

```bash
git add extension/scripts/copy-default-policies.js extension/package.json
git commit -m "build(extension): copy default policies + schema into bundle"
```

---

## Task 3: WASM module loader + cache

**Files:** Create `extension/src/background/wasm-bridge.ts`. Pre-task: confirm Plan 2 produced `crates/policy_engine_wasm/pkg/`.

- [ ] **Step 1: Make WASM artifact accessible to the extension build**

Add to `extension/scripts/copy-default-policies.js` (or create a sibling script):

```javascript
const wasmSrc = path.join(REPO_ROOT, 'crates', 'policy_engine_wasm', 'pkg');
const wasmDest = path.join(__dirname, '..', 'public', 'wasm');
if (!fs.existsSync(wasmDest)) fs.mkdirSync(wasmDest, { recursive: true });
for (const f of fs.readdirSync(wasmSrc)) {
  fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDest, f));
}
console.log(`Copied wasm bundle → ${wasmDest}`);
```

> Adjust to fit the script structure already in place from Task 2; one script per concern is fine.

- [ ] **Step 2: Write the loader**

```typescript
// extension/src/background/wasm-bridge.ts
import Browser from 'webextension-polyfill';

interface WasmExports {
  install_policies_json(input: string): string;
  build_action_json(input: string): string;
  tier1_fact_plan_json(input: string): string;
  tier2_window_keys_json(action: string, oracle: string): string;
  evaluate_json(req: string, snap: string): string;
}

let cachedExports: WasmExports | null = null;
let inflightLoad: Promise<WasmExports> | null = null;

const WASM_URL = Browser.runtime.getURL('wasm/policy_engine_wasm_bg.wasm');
const JS_URL = Browser.runtime.getURL('wasm/policy_engine_wasm.js');

async function load(): Promise<WasmExports> {
  if (cachedExports) return cachedExports;
  if (inflightLoad) return inflightLoad;
  inflightLoad = (async () => {
    const mod = await import(/* webpackIgnore: true */ JS_URL);
    await mod.default(WASM_URL);
    cachedExports = mod as unknown as WasmExports;
    return cachedExports;
  })();
  return inflightLoad;
}

export async function buildAction(requestJson: string): Promise<string> {
  return (await load()).build_action_json(requestJson);
}
export async function tier1FactPlan(actionJson: string): Promise<string> {
  return (await load()).tier1_fact_plan_json(actionJson);
}
export async function tier2WindowKeys(actionJson: string, oracleJson: string): Promise<string> {
  return (await load()).tier2_window_keys_json(actionJson, oracleJson);
}
export async function evaluate(requestJson: string, snapshotJson: string): Promise<string> {
  return (await load()).evaluate_json(requestJson, snapshotJson);
}
export async function installPolicies(input: string): Promise<string> {
  return (await load()).install_policies_json(input);
}
```

> The `webpackIgnore: true` directive is critical: webpack must not try to bundle the wasm-pack-generated JS (it does its own dynamic `WebAssembly.instantiate` call internally that webpack's wasm-loader fights with).

- [ ] **Step 3: Add CSP to the manifest**

In `extension/src/manifest.json`, add a `__chrome__content_security_policy` block (and `__firefox__` equivalent):

```json
"__chrome__content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
},
"__firefox__content_security_policy": "script-src 'self'; object-src 'self'"
```

> Firefox MV2 doesn't accept `wasm-unsafe-eval` and the syntax differs; `'self'` alone allows wasm there.

- [ ] **Step 4: Update web_accessible_resources**

In manifest.json, append to the `resources` array under `web_accessible_resources[0]`:

```json
"wasm/policy_engine_wasm.js",
"wasm/policy_engine_wasm_bg.wasm",
"confirm.html",
"confirm/index.js",
"default-policies/schema.cedarschema",
"default-policies/policy-set.json"
```

- [ ] **Step 5: Build + commit**

```bash
cd extension && yarn build:chrome 2>&1 | tail -10
git add extension/src/background/wasm-bridge.ts extension/src/manifest.json extension/scripts/copy-default-policies.js
git commit -m "feat(extension): WASM bridge loader + CSP wasm-unsafe-eval"
```

---

## Task 4: Default policies installer

**Files:** Create `extension/src/background/policies-loader.ts`.

- [ ] **Step 1: Write the installer**

```typescript
import Browser from 'webextension-polyfill';
import { installPolicies } from './wasm-bridge';

interface PolicyEntry { id: string; text: string; }

let installed = false;
let inflight: Promise<void> | null = null;

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
    const policySet: PolicyEntry[] = JSON.parse(policySetRaw);
    const result = await installPolicies(
      JSON.stringify({ schema_text: schemaText, policy_set: policySet }),
    );
    const parsed = JSON.parse(result);
    if (parsed.ok !== 'true') {
      throw new Error(`installPolicies failed: ${parsed.error ?? 'unknown'}`);
    }
    installed = true;
  })();
  return inflight;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/background/policies-loader.ts
git commit -m "feat(extension): default-policy installer (one-shot per SW lifetime)"
```

---

## Task 5: Pending-request storage

**Files:** Create `extension/src/background/storage.ts`.

- [ ] **Step 1: Write the storage helpers**

```typescript
import Browser from 'webextension-polyfill';

const PENDING_KEY = 'requests:pending';
const AUDIT_KEY = 'requests:audit';
const AUDIT_MAX = 100;

export interface PendingRequest {
  requestId: string;
  hostname: string;
  type: 'transaction' | 'typed-signature' | 'untyped-signature';
  bypassed: boolean;
  envelope: unknown; // raw payload for retry / display; redacted by audit log
  enqueuedAtMs: number;
}

export interface AuditEntry {
  requestId: string;
  hostname: string;
  type: PendingRequest['type'];
  verdict: 'pass' | 'warn' | 'fail';
  matchedPolicies: { id: string; severity: string }[];
  decidedAtMs: number;
}

export async function pendingPut(req: PendingRequest): Promise<void> {
  const all = ((await Browser.storage.session.get(PENDING_KEY))[PENDING_KEY] as
    | Record<string, PendingRequest>
    | undefined) ?? {};
  all[req.requestId] = req;
  await Browser.storage.session.set({ [PENDING_KEY]: all });
}

export async function pendingGet(requestId: string): Promise<PendingRequest | undefined> {
  const all = ((await Browser.storage.session.get(PENDING_KEY))[PENDING_KEY] as
    | Record<string, PendingRequest>
    | undefined) ?? {};
  return all[requestId];
}

export async function pendingDelete(requestId: string): Promise<void> {
  const all = ((await Browser.storage.session.get(PENDING_KEY))[PENDING_KEY] as
    | Record<string, PendingRequest>
    | undefined) ?? {};
  delete all[requestId];
  await Browser.storage.session.set({ [PENDING_KEY]: all });
}

export async function auditAppend(entry: AuditEntry): Promise<void> {
  const log = ((await Browser.storage.local.get(AUDIT_KEY))[AUDIT_KEY] as AuditEntry[] | undefined) ?? [];
  log.push(entry);
  if (log.length > AUDIT_MAX) log.splice(0, log.length - AUDIT_MAX);
  await Browser.storage.local.set({ [AUDIT_KEY]: log });
}

export async function auditRead(): Promise<AuditEntry[]> {
  const log = ((await Browser.storage.local.get(AUDIT_KEY))[AUDIT_KEY] as AuditEntry[] | undefined) ?? [];
  return log;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/background/storage.ts
git commit -m "feat(extension): pending request queue + audit log helpers"
```

---

## Task 6: Pending-deltas + receipt poller

**Files:** Create `extension/src/background/pending-deltas.ts`, `receipt-poller.ts`.

- [ ] **Step 1: pending-deltas.ts**

```typescript
import Browser from 'webextension-polyfill';

const KEY = 'windows:pending-deltas';
const TTL_MS = 5 * 60_000;

export interface PendingDelta {
  requestId: string;
  actor: string;
  windowEntries: { name: string; value: string }[];
  enqueuedAtMs: number;
  txHash?: string;
}

async function load(): Promise<PendingDelta[]> {
  const v = (await Browser.storage.local.get(KEY))[KEY] as PendingDelta[] | undefined;
  return v ?? [];
}
async function save(list: PendingDelta[]): Promise<void> {
  await Browser.storage.local.set({ [KEY]: list });
}

export async function reservePending(req: PendingDelta): Promise<void> {
  const list = await load();
  list.push(req);
  await save(list);
}

export async function setTxHash(requestId: string, txHash: string): Promise<void> {
  const list = await load();
  for (const d of list) if (d.requestId === requestId) d.txHash = txHash;
  await save(list);
}

export async function commitByTxHash(txHash: string): Promise<void> {
  const list = await load();
  await save(list.filter((d) => d.txHash !== txHash));
  // Real commit into long-lived window storage happens elsewhere; this just removes
  // the pending entry once a receipt confirms it.
}

export async function discardExpired(nowMs: number = Date.now()): Promise<void> {
  const list = await load();
  await save(list.filter((d) => nowMs - d.enqueuedAtMs < TTL_MS));
}

/// Read all pending deltas for an actor and aggregate by window name.
/// The returned list is shaped to feed into HostSnapshot.windows together
/// with already-committed window state.
export async function pendingForActor(
  actor: string,
): Promise<{ name: string; value: string }[]> {
  const list = await load();
  const sums = new Map<string, bigint>();
  for (const d of list) {
    if (d.actor.toLowerCase() !== actor.toLowerCase()) continue;
    for (const e of d.windowEntries) {
      sums.set(e.name, (sums.get(e.name) ?? 0n) + BigInt(e.value));
    }
  }
  return [...sums.entries()].map(([name, value]) => ({ name, value: value.toString() }));
}
```

- [ ] **Step 2: receipt-poller.ts**

```typescript
import Browser from 'webextension-polyfill';
import { rpcClient } from './chains/rpc-client';
import { commitByTxHash, discardExpired, pendingForActor } from './pending-deltas';

const ALARM = 'scopeball:receipt-poll';

export function installReceiptPoller(): void {
  Browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
  Browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void poll();
  });
}

async function poll(): Promise<void> {
  await discardExpired();

  const stored = (await Browser.storage.local.get('windows:pending-deltas'))[
    'windows:pending-deltas'
  ] as Array<{ requestId: string; actor: string; txHash?: string; windowEntries: { name: string; value: string }[] }> | undefined;
  if (!stored?.length) return;

  for (const entry of stored) {
    if (!entry.txHash) continue;
    // Naive: poll mainnet (chainId 1). For real multichain we'd track which
    // chain each pending tx is on. The orchestrator stores chainId alongside
    // pending entries; extend `PendingDelta` to carry it for v1.1.
    try {
      const receipt = await rpcClient(1).getTransactionReceipt({
        hash: entry.txHash as `0x${string}`,
      });
      if (receipt && receipt.status === 'success') {
        await commitByTxHash(entry.txHash);
        // TODO Plan 6: actually advance long-lived window counters here.
      }
    } catch {
      // RPC failure: leave the entry in place; next poll retries.
    }
  }

  // Touch pendingForActor so callers don't see it as unused; real consumer
  // is the orchestrator's snapshot builder.
  void pendingForActor('0x0000000000000000000000000000000000000000');
}
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/background/pending-deltas.ts extension/src/background/receipt-poller.ts
git commit -m "feat(extension): pending-deltas queue + chrome.alarms receipt poller"
```

---

## Task 7: Orchestrator — full per-request lifecycle

**Files:** Create `extension/src/background/orchestrator.ts`.

This is the integration heart of the extension. Every intercepted request flows through this file.

- [ ] **Step 1: Write the orchestrator**

```typescript
// extension/src/background/orchestrator.ts
import Browser from 'webextension-polyfill';
import { ensureDefaultPoliciesInstalled } from './policies-loader';
import { fetchTier1, intoHostSnapshot, type Tier1Plan } from './facts/tier1-fetcher';
import { pendingForActor, reservePending } from './pending-deltas';
import { auditAppend, pendingDelete, pendingPut, type PendingRequest } from './storage';
import { buildAction, evaluate, tier1FactPlan, tier2WindowKeys } from './wasm-bridge';
import type { HostSnapshot } from './types/host-snapshot';
import { isTransaction, isTypedSignature, type Message } from '@lib/types';

interface VerdictDto {
  kind: 'pass' | 'warn' | 'fail';
  matched?: { policy_id: string; reason?: string; severity: string; origin: string }[];
}

const HARD_TIMEOUT_MS = 3_000;

export async function decideMessage(message: Message): Promise<{
  ok: boolean;
  verdict: VerdictDto;
}> {
  await ensureDefaultPoliciesInstalled();

  const pending: PendingRequest = {
    requestId: message.requestId,
    hostname: message.data.hostname,
    type: message.data.type,
    bypassed: !!message.data.bypassed,
    envelope: redactEnvelopeForStorage(message),
    enqueuedAtMs: Date.now(),
  };
  await pendingPut(pending);

  try {
    const verdict = await withTimeout(runLifecycle(message), HARD_TIMEOUT_MS, {
      kind: 'fail',
      matched: [
        {
          policy_id: '__engine::timeout',
          reason: `Engine took longer than ${HARD_TIMEOUT_MS}ms`,
          severity: 'deny',
          origin: 'engine_error',
        },
      ],
    });

    await auditAppend({
      requestId: message.requestId,
      hostname: message.data.hostname,
      type: message.data.type,
      verdict: verdict.kind,
      matchedPolicies:
        verdict.matched?.map((m) => ({ id: m.policy_id, severity: m.severity })) ?? [],
      decidedAtMs: Date.now(),
    });

    if (verdict.kind === 'pass') {
      return { ok: true, verdict };
    }
    if (verdict.kind === 'fail') {
      return { ok: false, verdict };
    }
    // Warn: open a confirmation window and await the user's choice.
    const userOk = await openVerdictWindowAndAwait(message.requestId, verdict);
    return { ok: userOk, verdict };
  } finally {
    await pendingDelete(message.requestId);
  }
}

async function runLifecycle(message: Message): Promise<VerdictDto> {
  const requestJson = encodeRequestForEngine(message);
  const actionRaw = await buildAction(requestJson);
  const actionParsed = JSON.parse(actionRaw);
  if (actionParsed.kind === 'engine_error' || actionParsed.error) {
    return failFromError('build_action', actionParsed);
  }

  const planRaw = await tier1FactPlan(JSON.stringify(actionParsed));
  const plan: Tier1Plan = JSON.parse(planRaw);

  const tier1 = await fetchTier1(plan);

  const oracleEntriesJson = JSON.stringify(tier1.oracle);
  const tier2Raw = await tier2WindowKeys(JSON.stringify(actionParsed), oracleEntriesJson);
  const tier2 = JSON.parse(tier2Raw) as { keys: { actor: string; name: string }[] };

  // Read pending deltas for the actor; merge into the snapshot's windows array.
  const actor = inferActor(message);
  const pending = actor ? await pendingForActor(actor) : [];
  const windows: HostSnapshot['windows'] = pending.map((e) => ({
    actor: actor!.toLowerCase(),
    name: e.name,
    value: e.value,
  }));
  for (const k of tier2.keys) {
    if (!windows.some((w) => w.name === k.name && w.actor === k.actor.toLowerCase())) {
      windows.push({ actor: k.actor.toLowerCase(), name: k.name, value: '0' });
    }
  }

  const snapshot = intoHostSnapshot(tier1, windows);
  const verdictRaw = await evaluate(requestJson, JSON.stringify(snapshot));
  const verdict = JSON.parse(verdictRaw) as VerdictDto;

  if (verdict.kind !== 'fail' && actor) {
    // Provisional pending-delta reservation for DEX swaps. The actual
    // delta values come from compute_dex_window_deltas in the engine;
    // for v1 we conservatively reserve `total_input_usd` as a placeholder
    // that the orchestrator computes from the action JSON.
    const dexUsd = extractDexInputUsd(actionParsed);
    if (dexUsd) {
      await reservePending({
        requestId: message.requestId,
        actor,
        windowEntries: [
          { name: 'swap_volume_usd_24h', value: dexUsd },
          { name: 'swap_count_24h', value: '1' },
        ],
        enqueuedAtMs: Date.now(),
      });
    }
  }
  return verdict;
}

function inferActor(message: Message): string | undefined {
  if (isTransaction(message)) return message.data.transaction.from;
  if (isTypedSignature(message)) return message.data.address;
  return undefined;
}

function extractDexInputUsd(actionParsed: any): string | undefined {
  const dex = actionParsed?.dex;
  return dex?.facts?.totalInputUsd?.value;
}

function encodeRequestForEngine(message: Message): string {
  if (isTransaction(message)) {
    return JSON.stringify({
      Tx: {
        chainId: message.data.chainId,
        from: message.data.transaction.from,
        to: message.data.transaction.to,
        data: message.data.transaction.data,
        valueWei: message.data.transaction.value ?? '0',
      },
    });
  }
  if (isTypedSignature(message)) {
    return JSON.stringify({
      Sig: {
        chainId: message.data.chainId,
        signer: message.data.address,
        typedData: message.data.typedData,
      },
    });
  }
  // Untyped signature → treat as Action::Other from the engine's perspective.
  return JSON.stringify({ Tx: { chainId: 1, from: '', to: '', data: '0x', valueWei: '0' } });
}

function redactEnvelopeForStorage(message: Message): unknown {
  if (isTransaction(message)) {
    return {
      to: message.data.transaction.to,
      chainId: message.data.chainId,
      value: message.data.transaction.value,
    };
  }
  if (isTypedSignature(message)) {
    return {
      primaryType: (message.data.typedData as any)?.primaryType,
      verifyingContract: (message.data.typedData as any)?.domain?.verifyingContract,
    };
  }
  return {};
}

function failFromError(kind: string, parsed: any): VerdictDto {
  const message = parsed?.message ?? parsed?.error?.message ?? 'unknown error';
  return {
    kind: 'fail',
    matched: [
      {
        policy_id: `__engine::${parsed?.kind ?? kind}`,
        reason: message,
        severity: 'deny',
        origin: 'engine_error',
      },
    ],
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function openVerdictWindowAndAwait(
  requestId: string,
  verdict: VerdictDto,
): Promise<boolean> {
  const params = new URLSearchParams({ requestId, verdict: JSON.stringify(verdict) });
  const url = Browser.runtime.getURL(`confirm.html?${params.toString()}`);
  const win = await Browser.windows.create({
    url,
    type: 'popup',
    width: 520,
    height: 480,
    focused: true,
  });

  return new Promise<boolean>((resolve) => {
    const listener = (
      _msg: any,
      sender: Browser.Runtime.MessageSender,
      sendResponse: (r: { ok: boolean }) => void,
    ) => {
      if (_msg?.type !== 'scopeball:verdict-decision') return;
      if (_msg.requestId !== requestId) return;
      Browser.runtime.onMessage.removeListener(listener);
      Browser.windows.remove(win.id!).catch(() => {});
      sendResponse({ ok: true });
      resolve(_msg.ok);
    };
    Browser.runtime.onMessage.addListener(listener);

    // If the user closes the window without deciding, treat as cancel.
    Browser.windows.onRemoved.addListener(function onClose(closedId) {
      if (closedId === win.id) {
        Browser.windows.onRemoved.removeListener(onClose);
        Browser.runtime.onMessage.removeListener(listener);
        resolve(false);
      }
    });
  });
}
```

- [ ] **Step 2: Replace SW entry to use the orchestrator**

Replace `extension/src/background/index.ts`:

```typescript
import Browser from 'webextension-polyfill';
import { Identifier } from '@lib/identifier';
import { decideMessage } from './orchestrator';
import { installReceiptPoller } from './receipt-poller';
import type { Message, MessageResponse } from '@lib/types';

console.log('Scopeball SW alive at', new Date().toISOString());
installReceiptPoller();

Browser.runtime.onConnect.addListener((port) => {
  if (port.name !== Identifier.CONTENT_SCRIPT) return;
  port.onMessage.addListener(async (message: Message) => {
    const { ok } = await decideMessage(message);
    if (!message.data.bypassed) {
      const response: MessageResponse = { requestId: message.requestId, data: ok };
      try {
        port.postMessage(response);
      } catch {
        // dApp tab gone; nothing to send back.
      }
    }
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add extension/src/background/orchestrator.ts extension/src/background/index.ts
git commit -m "$(cat <<'EOF'
feat(extension): orchestrator drives full evaluation lifecycle

ensureDefaultPoliciesInstalled() one-shot, then per-request:
1. wasm-bridge.buildAction
2. wasm-bridge.tier1FactPlan
3. fact-fetcher.fetchTier1
4. wasm-bridge.tier2WindowKeys
5. merge pending-deltas + tier2 keys → HostSnapshot
6. wasm-bridge.evaluate
7. enforce: pass→true, warn→open confirm window, fail→false
Hard 3s timeout fail-closed. Audit log per decision.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Verdict modal — confirm.html + React UI

**Files:** Create `extension/public/confirm.html`, `extension/src/confirm/index.tsx`, `VerdictModal.tsx`, `styles.css`.

- [ ] **Step 1: confirm.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Scopeball — Review request</title>
    <link rel="stylesheet" href="confirm/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="js/confirm/index.js"></script>
  </body>
</html>
```

- [ ] **Step 2: VerdictModal.tsx**

```tsx
import React from 'react';
import './styles.css';

interface MatchedPolicy {
  policy_id: string;
  reason?: string;
  severity: string;
  origin: string;
}
interface VerdictDto {
  kind: 'pass' | 'warn' | 'fail';
  matched?: MatchedPolicy[];
}

interface Props {
  verdict: VerdictDto;
  onApprove: () => void;
  onCancel: () => void;
}

export function VerdictModal({ verdict, onApprove, onCancel }: Props): JSX.Element {
  const accent =
    verdict.kind === 'fail' ? 'modal-fail' : verdict.kind === 'warn' ? 'modal-warn' : 'modal-pass';
  return (
    <main className={`modal ${accent}`}>
      <header>
        <h1>{labelForKind(verdict.kind)}</h1>
      </header>
      <section className="matched">
        {(verdict.matched ?? []).map((m) => (
          <article key={m.policy_id} className={`matched-item severity-${m.severity}`}>
            <div className="policy-id">{m.policy_id}</div>
            {m.reason ? <div className="reason">{m.reason}</div> : null}
            <div className="meta">
              {m.severity} • {m.origin}
            </div>
          </article>
        ))}
      </section>
      <footer>
        <button className="btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        {verdict.kind !== 'fail' ? (
          <button className="btn-approve" onClick={onApprove}>
            Trust and proceed
          </button>
        ) : null}
      </footer>
    </main>
  );
}

function labelForKind(kind: VerdictDto['kind']): string {
  switch (kind) {
    case 'pass':
      return 'No policy concerns';
    case 'warn':
      return 'Policy warning — review before signing';
    case 'fail':
      return 'Blocked by policy';
  }
}
```

- [ ] **Step 3: index.tsx**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import Browser from 'webextension-polyfill';
import { VerdictModal } from './VerdictModal';

const params = new URLSearchParams(window.location.search);
const requestId = params.get('requestId') ?? '';
const verdict = JSON.parse(params.get('verdict') ?? '{"kind":"fail"}');

function reply(ok: boolean): void {
  Browser.runtime
    .sendMessage({ type: 'scopeball:verdict-decision', requestId, ok })
    .catch(() => {})
    .finally(() => window.close());
}

const root = createRoot(document.getElementById('root')!);
root.render(<VerdictModal verdict={verdict} onApprove={() => reply(true)} onCancel={() => reply(false)} />);
```

- [ ] **Step 4: styles.css**

```css
:root {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  color-scheme: light dark;
}
body {
  margin: 0;
  background: #0c0c10;
  color: #e9e9ee;
}
.modal {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 24px;
  box-sizing: border-box;
  border-top: 4px solid #555;
}
.modal-pass { border-top-color: #2ecc71; }
.modal-warn { border-top-color: #f1c40f; }
.modal-fail { border-top-color: #e74c3c; }
header h1 {
  margin: 0 0 16px 0;
  font-size: 18px;
}
.matched {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.matched-item {
  padding: 12px;
  background: #16161d;
  border-radius: 6px;
  border-left: 3px solid #555;
}
.matched-item.severity-deny { border-left-color: #e74c3c; }
.matched-item.severity-warn { border-left-color: #f1c40f; }
.policy-id { font-family: ui-monospace, monospace; font-size: 12px; color: #888; }
.reason { margin-top: 6px; font-size: 14px; }
.meta { margin-top: 6px; font-size: 11px; color: #666; }
footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 16px;
}
button {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-cancel { background: #2c2c34; color: #e9e9ee; }
.btn-approve { background: #f1c40f; color: #0c0c10; font-weight: 600; }
```

- [ ] **Step 5: Build + commit**

```bash
cd extension && yarn build:chrome 2>&1 | tail -10
git add extension/public/confirm.html extension/src/confirm/
git commit -m "feat(extension): verdict modal (React, separate Chrome window)"
```

---

## Task 9: Orchestrator integration test

**Files:** Create `extension/src/background/__tests__/orchestrator.test.ts`.

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const memoryStore: Record<string, unknown> = {};
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { getURL: (s: string) => `extension://${s}` },
    storage: {
      session: {
        get: vi.fn(async (k: string) => ({ [k]: memoryStore[`session:${k}`] })),
        set: vi.fn(async (e: any) => {
          for (const [k, v] of Object.entries(e)) memoryStore[`session:${k}`] = v;
        }),
      },
      local: {
        get: vi.fn(async (k: string) => ({ [k]: memoryStore[`local:${k}`] })),
        set: vi.fn(async (e: any) => {
          for (const [k, v] of Object.entries(e)) memoryStore[`local:${k}`] = v;
        }),
        remove: vi.fn(),
      },
    },
    windows: { create: vi.fn(async () => ({ id: 1 })), remove: vi.fn(), onRemoved: { addListener: vi.fn() } },
    runtime_onMessage: { addListener: vi.fn() },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  },
}));

vi.mock('../wasm-bridge', () => ({
  installPolicies: vi.fn(async () => JSON.stringify({ ok: 'true' })),
  buildAction: vi.fn(async () => JSON.stringify({ other: { actor: '0x0', target: '0x0', selector: '0xdeadbeef', value_wei: '0', raw_calldata: '0xdeadbeef' } })),
  tier1FactPlan: vi.fn(async () =>
    JSON.stringify({
      tokens_for_oracle: [],
      balances: [],
      allowances: [],
      clock_required: false,
      sig_oracle_requirements: [],
    }),
  ),
  tier2WindowKeys: vi.fn(async () => JSON.stringify({ keys: [] })),
  evaluate: vi.fn(async () => JSON.stringify({ kind: 'pass' })),
}));

vi.mock('../policies-loader', () => ({ ensureDefaultPoliciesInstalled: vi.fn(async () => {}) }));

import { decideMessage } from '../orchestrator';

beforeEach(() => {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
});

describe('orchestrator', () => {
  it('returns ok=true for Pass verdicts', async () => {
    const r = await decideMessage({
      requestId: 'r1',
      data: {
        type: 'transaction' as any,
        chainId: 1,
        hostname: 'example.com',
        transaction: {
          from: '0x1111111111111111111111111111111111111111',
          to: '0x2222222222222222222222222222222222222222',
          data: '0xdeadbeef',
          value: '0',
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.verdict.kind).toBe('pass');
  });

  it('returns ok=false for Fail verdicts without opening a window', async () => {
    const { evaluate } = await import('../wasm-bridge');
    (evaluate as any).mockResolvedValueOnce(
      JSON.stringify({
        kind: 'fail',
        matched: [{ policy_id: 'p::block', reason: 'demo', severity: 'deny', origin: 'action' }],
      }),
    );
    const r = await decideMessage({
      requestId: 'r2',
      data: {
        type: 'transaction' as any,
        chainId: 1,
        hostname: 'example.com',
        transaction: {
          from: '0x1111111111111111111111111111111111111111',
          to: '0x2222222222222222222222222222222222222222',
          data: '0xdeadbeef',
          value: '0',
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.verdict.kind).toBe('fail');
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd extension && yarn test orchestrator 2>&1 | tail -15
git add extension/src/background/__tests__/orchestrator.test.ts
git commit -m "test(extension): orchestrator pass/fail verdict paths"
```

---

## Task 10: End-to-end smoke test

**Files:** None — execution-only.

- [ ] **Step 1: Build + load**

```bash
cd extension && yarn build:chrome
```

Load `extension/dist/chrome/` as unpacked in Chrome.

- [ ] **Step 2: Verify SW boots**

Open the SW console:
- `Scopeball SW alive at <ts>`
- No `ensureDefaultPoliciesInstalled` errors when the first request comes in.

- [ ] **Step 3: Try a Uniswap swap with a $0.01 input**

Build the smallest possible swap. Default policies should `Pass` since no USD-cap policy is installed by default. Confirm the dApp completes signing normally.

- [ ] **Step 4: Manually rig a Fail by editing default policy text**

Temporarily edit `policies/dex/uniswap-only-allowlist.cedar` (or any `forbid` policy) so it fires for the swap above. Rebuild (`yarn build:chrome`). Reload the extension. Trigger the swap. Confirm: dApp shows a 4001 user-rejected error, no MetaMask popup appears, SW audit log records the verdict.

Revert the policy edit, rebuild, confirm normal operation resumes.

- [ ] **Step 5: Document the test recipe in `extension/README.md`**

Append a "Plan 5 milestone" section describing the end-to-end test exactly as above.

- [ ] **Step 6: Commit**

```bash
git add extension/README.md
git commit -m "docs(extension): plan 5 end-to-end smoke recipe"
```

---

## Self-review summary

**Spec coverage** (vs design §3.1, §4.3, §4.4, §7):
- ✅ Two-phase eval lifecycle — Task 7
- ✅ Hard 3s timeout fail-closed — Task 7
- ✅ chrome.storage.session pending queue — Task 5
- ✅ Audit log redacted by default — Task 5, 7
- ✅ chrome.windows.create separate verdict window — Task 7, 8
- ✅ React verdict modal — Task 8
- ✅ Pending-deltas queue + chrome.alarms receipt poller — Task 6
- ✅ Default policies bundled (replaced by marketplace in Plan 6) — Task 2, 4
- ⏭ AST equivalence parameter rendering, marketplace catalog → Plan 6
- ⏭ Bundle install/update UI → Plan 6

**Risks flagged for the executor:**
- WASM module dynamic-import path (`webpackIgnore`) is Chrome-specific; Firefox MV2 needs a different code path
- The `Browser.windows.create` popup in Firefox does not honor exact dimensions — Firefox-only follow-up needed
- Receipt poller currently hardcodes `chainId 1`; Plan 6 (or v1.1) extends `PendingDelta` with chainId
- The `decideMessage` mock test does not exercise the open-window path; that requires Playwright + a running Chrome (Plan 7 / future testing pass)
