# Per-Policy Selection Popup — Design

**Status:** approved (2026-05-09)
**Author:** Woojin Lee
**Audience:** engine + extension contributors

## 1. Problem

The Scopeball Chrome extension currently installs all 20 default policies
(plus every marketplace bundle's rendered set) on service-worker boot. For
testers verifying behavior policy-by-policy, this is unworkable: a single
transaction can match multiple policies, so it is impossible to attribute
a verdict to one rule in isolation.

**User quote:**
> Extension에서 유저가 직접 사용할 policy를 설정할 수 있는 창을 하나 만들 수 있어?
> 한번 테스트를 해보고 싶은데, 테스트용 policy들이 너무 많아서 policy별로 검증을 할
> 수가 없네. 유저(테스터)가 사용할 policy를 설정하면, 그 설정해둔 policy들만 가지고
> transaction을 필터링하면 좋겠어.

## 2. Goals / Non-goals

**Goals (v1)**

- Provide a popup UI listing every known policy (default + every installed
  marketplace bundle), each with an on/off toggle.
- Persist the user's selection across browser restarts.
- Apply selection by reinstalling only the enabled policies into the WASM
  engine — disabled policies must not contribute to verdicts.
- Default state on first install: **all policies disabled** (explicit opt-in
  per tester request).

**Non-goals**

- Per-actor or per-chain selection.
- Severity-level filtering ("show only fail-severity").
- Import/export of selection JSON or selection-sync via `chrome.storage.sync`.
- A separate options page; the toolbar popup is sufficient.

## 3. Architecture

```
popup.html / popup/index.ts          (vanilla TS, mirrors confirm/)
        │  message: 'policy-catalog' | 'set-enabled-ids'
        ▼
background/policy-selection.ts       (new — selection store + filter)
        │  read/write 'policy-selection:enabled-ids'
        ▼
chrome.storage.local
        │  consumed by
        ▼
background/policies-loader.ts        (modified — filters before install)
        │
        ▼
WASM engine: install_policies_json   (only enabled policies installed)
```

Single source of truth: `chrome.storage.local['policy-selection:enabled-ids']`,
type `string[]`. Sentinel missing-key → `[]` (all disabled).

Filtering happens at install time, not per decision. The engine API stays
unchanged. This also benefits marketplace bundles for free, since their
policies flow through the same `installPolicies()` call.

## 4. Components

### 4.1 popup/index.ts (new)

Vanilla TS module rendering the popup body. Pattern matches
`extension/src/confirm/index.ts` (no React dependency). Webpack entry
`popup/index` joins the existing five entries.

Renders:

- Header `<N of M enabled>` plus buttons `[Enable all] [Disable all] [Reset]`.
- Search input filtering by id substring or reason text.
- Sections grouped by namespace prefix (`default::dex`, `default::signature/_shared`, …).
  Marketplace bundles get their own section keyed by `bundle_id`.
- One row per policy:
  toggle · short id (last segment) · severity badge · reason text (one line, ellipsis on overflow).
- Footer status line: `Reinstalling…` / `Up to date` / `Error: <kind> <msg>`.

Apply behavior: each toggle change schedules a 300 ms debounced
`set-enabled-ids` round-trip; the footer reflects the latest result.

### 4.2 popup/policy-meta.ts (new)

Pure-TS parser pulling `@id`, `@severity`, `@reason` annotations out of a
Cedar policy text via a small regex. Output:
`{ shortId: string, severity: 'info'|'warn'|'fail', reason: string }`.

Tested in isolation; no DOM, no chrome.* dependency.

### 4.3 background/policy-selection.ts (new)

Selection store wrapping `chrome.storage.local`. Public surface:

```ts
export async function getEnabledIds(): Promise<string[]>;
export async function setEnabledIds(ids: string[]): Promise<void>;
export async function getCatalog(): Promise<{
  policies: { id: string; severity: string; reason: string; sourceLabel: string }[];
  enabled: string[];
}>;
```

`getCatalog()` recomputes on each call: it loads the bundled defaults and
calls `aggregatedPolicySet()` from `marketplace/storage.ts`, then runs
`policy-meta.ts` over each text. No catalog persistence — avoids drift
when defaults or marketplace bundles change.

### 4.4 background/policies-loader.ts (modified)

`ensureDefaultPoliciesInstalled()` and `reinstallAllPolicies()` both
intersect the union of (defaults ∪ marketplace) with the enabled-id set
before calling `installPolicies()`. If the enabled set is empty, the call
becomes `installPolicies({ schema_text, policy_set: [] })` — a valid
no-policy install.

### 4.5 background/index.ts (modified)

Adds two `runtime.onMessage` handlers:

- `{type:'policy-catalog'}` → returns `getCatalog()`.
- `{type:'set-enabled-ids', ids:string[]}` → writes via
  `setEnabledIds()`, then awaits `reinstallAllPolicies()`, then replies
  `{ok:true}` (or `{ok:false, error}`).

## 5. Data flow

1. User clicks toolbar icon → `popup.html` opens → `popup/index.ts` runs.
2. Popup posts `policy-catalog` → background returns `{policies, enabled}`.
3. Popup renders rows, sets each toggle from `enabled`.
4. User toggles a row → debounce 300 ms → popup posts
   `set-enabled-ids` with the new id list.
5. Background writes storage, calls `reinstallAllPolicies()`. The WASM
   engine receives a fresh `install_policies_json` containing only the
   enabled subset.
6. Background replies `{ok:true}` → popup footer flips to `Up to date`.

## 6. Error handling

- **Reinstall failure** (e.g. malformed marketplace policy text):
  background reports `{ok:false, error:{kind, message}}`; popup footer
  shows `Error: <kind> <message>`. The previous engine state is preserved
  by the engine's replace-or-fail semantics.
- **Storage write failure**: popup reverts the toggle and surfaces the
  thrown message.
- **Empty enabled set**: valid. The engine evaluates with no policies and
  every request returns the default verdict (`pass`). Console log once
  per SW boot to make this discoverable: `[Scopeball] no policies
  enabled — verdicts will all pass`.
- **Catalog parse failure** (annotation missing in a marketplace policy):
  fall back to `severity:'info'`, `reason:'(no reason annotation)'`. Never
  hide the policy from the list.

## 7. Testing

- **Unit (popup/policy-meta.ts):** parses sample Cedar texts including
  the cases without `@severity` / `@reason`.
- **Unit (background/policy-selection.ts):** roundtrip set/get against an
  in-memory `chrome.storage.local` mock.
- **Unit (policies-loader.ts):** with stub `installPolicies`, assert that
  enabling 2 of 20 IDs leads to a `policy_set.length === 2` install.
- **Integration:** install via real WASM, enable only
  `default::dex/max-input-usd-100`, fire a request that would otherwise
  trip `default::dex/uniswap-only-allowlist`, assert verdict is not
  `fail` for the disabled rule.
- **Manual e2e:** load unpacked, open popup, enable one policy, trigger a
  dApp tx, confirm the verdict modal cites only that policy.

## 8. Out of scope / future

- Selection presets ("All DEX policies", "All Signature policies").
- Severity-only filters.
- Per-bundle "block all from this author".
- Selection sync across devices.
- Bulk diff against a recommended baseline.

## 9. File touch list

```
extension/public/popup.html                  modify  (replace stub with shell)
extension/src/popup/index.ts                 create
extension/src/popup/styles.css               create  (imported from index.ts via style-loader)
extension/src/popup/policy-meta.ts           create
extension/src/popup/policy-meta.test.ts      create
extension/src/background/policy-selection.ts create
extension/src/background/policies-loader.ts  modify  (filter union by enabled-ids)
extension/src/background/index.ts            modify  (add 2 message handlers)
extension/webpack/webpack.common.js          modify  (add popup/index entry)
extension/src/manifest.json                  no-op   (popup already registered)
```
