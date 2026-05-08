# Learnings from revoke.cash Browser Extension

| | |
|---|---|
| Status | Reference notes for our Chrome extension implementation |
| Date | 2026-05-08 |
| Source | `/Users/woojin/Desktop/upside_academy/project/revoke-cash-browser-extension` (legacy Revoke.cash extension, sunsetted) |
| Companion doc | `2026-05-08-chrome-extension-design.md` |

> Revoke.cash is a battle-tested Chrome/Firefox extension that has been intercepting EIP-1193 calls since 2022 to warn on token approvals and signature-based scams. Their implementation predates our Cedar policy engine but solves many of the same browser-side plumbing problems. This document records what we should copy verbatim, what we should improve on, and what they punted on.

---

## 1. Architecture comparison

| Concern | revoke.cash | Our design | Verdict |
|--------|-------------|------------|---------|
| Decision logic | Hand-written TS `Decoder` classes per scheme | Cedar policy engine compiled to WASM | Ours wins on extensibility (user-installable policy bundles vs hardcoded categories) |
| Provider interception | Proxy `request`/`send`/`sendAsync` via `Object.defineProperty` + `setInterval` polling for late-injected providers + explicit listener on MetaMask's internal post-message stream | Inpage script wrapping `window.ethereum`, EIP-6963 re-announce | Theirs wins on robustness — we should adopt their patterns |
| MV3 SW persistence | In-memory `messagePorts` cleared after 5min idle (acknowledged in code comment as fragile) | `chrome.storage.session` + IndexedDB durable queue | Ours wins on robustness |
| Verdict modal | `Browser.windows.create({type: 'popup'})` separate window with calculated dimensions/position | Same approach (`chrome.windows.create({type: 'popup'})`) | Aligned ✓ |
| Cross-browser | Single codebase for Chrome MV3 + Firefox MV2 via `wext-manifest-loader` preprocessor | MV3 only in v1; Firefox in v1.1+ | Their pattern is worth adopting now to keep options open |
| Per-host allowlist | `HostnameAllowList[type]` hardcoded (OpenSea, Uniswap, etc.) | User-tunable via marketplace bundles + per-bundle params | Different scopes — both useful |

---

## 2. Things we should copy directly

### 2.1 Provider proxy pattern (`src/injected/proxy-injected-providers.tsx`)

Their inpage script wraps three call surfaces, not just `request`:

```ts
Object.defineProperty(provider, 'request',   { value: new Proxy(provider.request,   requestHandler),   writable: true });
Object.defineProperty(provider, 'send',      { value: new Proxy(provider.send,      sendHandler),      writable: true });
Object.defineProperty(provider, 'sendAsync', { value: new Proxy(provider.sendAsync, sendAsyncHandler), writable: true });
provider.isRevokeCash = true;  // idempotency marker
```

The `send` overloads are tricky (a method-string call, a payload-only call, and a payload+callback call all share the name). They handle all three paths and forward to `request` or `sendAsync` as appropriate. Our v1 inpage script should do the same — many older dApps still call `send` and `sendAsync` rather than `request`.

**Idempotency marker** (`provider.isRevokeCash = true`) prevents double-wrapping when the polling interval re-discovers the same provider. We should follow suit (`provider.isScopeball = true` or similar).

### 2.2 Polling-based provider discovery

```ts
let proxyInterval: NodeJS.Timer;
const proxyAllEthereumProviders = () => {
  if (!window.ethereum) return;
  clearInterval(proxyInterval);
  proxyEthereumProvider(window.ethereum, 'window.ethereum');
  window.ethereum?.providers?.forEach((p, i) => proxyEthereumProvider(p, `window.ethereum.providers[${i}]`));
  proxyEthereumProvider(window.coinbaseWalletExtension, 'window.coinbaseWalletExtension');
  ['eth','rsk','bsc','polygon','arbitrum','fuse','avalanche','optimism']
    .forEach(name => proxyEthereumProvider(window[name], `window.${name}`));
};
proxyInterval = setInterval(proxyAllEthereumProviders, 100);
proxyAllEthereumProviders();
```

This is the pragmatic answer to the EIP-6963 race we flagged in our design's known-limitation section. Our design's "EIP-6963 wrap" is necessary for modern dApps, but **a 100ms polling interval scanning known window-side keys is a critical fallback** for legacy multi-provider setups (`window.ethereum.providers[]`), Coinbase Wallet (`window.coinbaseWalletExtension`), and the per-chain Liquality providers (`window.eth`, `window.rsk`, etc.).

We should **adopt both**: EIP-6963 announce wrapping + window-key polling.

### 2.3 MetaMask internal-stream backstop (`src/content-scripts/bypass-check.tsx`)

This is the most surprising and most valuable file in the whole repo. They listen to MetaMask's *own* post-message protocol on the page:

```ts
window.addEventListener('message', (message) => {
  const { target } = message?.data ?? {};
  const { name, data } = message?.data?.data ?? {};
  if (name !== Identifier.METAMASK_PROVIDER || !data) return;

  if (target === Identifier.METAMASK_CONTENT_SCRIPT) {
    checkMetaMaskBypass(data);    // forwards to background as `bypassed: true`
  }
});
```

When a dApp routes a request through MetaMask via some path that our proxy missed (raw provider reference captured before our proxy attached, or a MetaMask-specific transport), MetaMask's own content-script-bound message stream still flows through `window.postMessage`. We can **passively observe it** and surface a *retroactive* warning even if we couldn't block.

They flag these as `bypassed: true` and the popup gets a special "this got through" badge.

**This is the right answer to our design's "Known limitation — EIP-6963 race"**: instead of pretending we can win the race, we accept that some requests will bypass our proxy and provide a passive backstop that observes MetaMask's internal stream as a side channel. We should copy this verbatim and extend to Coinbase Wallet (they already do — see lines 75–119).

### 2.4 Battle-tested NPM dependencies

```json
"@metamask/post-message-stream": "^8.1.0",   // structured stream over window.postMessage
"eth-rpc-errors":                "^4.0.3",    // canonical 4001 error shape
"object-hash":                    "^3.0.0",    // deterministic request IDs
"viem":                          "^2.13.7",   // ABI decoding, RPC client, types
"webextension-polyfill":         "^0.12.0",   // Browser.* unified API for MV2/MV3
"@revoke.cash/chains":           "^69.0.0"    // chain registry (we'll use our own)
```

We should adopt the first five. Concretely:

- `@metamask/post-message-stream` for inpage↔content-script communication. They use `WindowPostMessageStream` (`name`/`target` channels) which abstracts the standard `window.postMessage` boilerplate and gives a clean `.write()` / `.on('data')` API.
- `eth-rpc-errors` for `ethErrors.provider.userRejectedRequest('reason')` — emits the canonical 4001 shape we need to inject into rejected callbacks. Our design specifies 4001 already; this lib makes it one line.
- `object-hash` to derive a deterministic request ID from the transaction or typed-data payload (`generateMessageId` in `lib/utils/messages.ts`). This is **how they make duplicate concurrent calls idempotent** without a serial counter.
- `viem` over ethers.js — they use `decodeFunctionData({abi: parseAbi([...]), data})` and `createWalletClient({transport: custom(provider)})`. Smaller bundle, modern TS types, no ESM/CJS pain. Our extension's RPC client and any defense-in-depth ABI decoding (e.g. for `eth_sendRawTransaction` decode in v1.1) should use viem.
- `webextension-polyfill` even if we ship Chrome-only first — keeps the door open for Firefox and gives Promise-returning `Browser.*` instead of callback-style `chrome.*`.

### 2.5 Manifest preprocessing for cross-browser

`src/manifest.json` uses prefix keys `__chrome__action`, `__firefox__manifest_version`, etc., processed by `wext-manifest-loader` at webpack build time:

```json
{
  "manifest_version": 3,
  "__firefox__manifest_version": 2,
  "__chrome__action": { "default_popup": "popup.html" },
  "__firefox__browser_action": { "default_popup": "popup.html" }
}
```

If we want to keep the Firefox option open without forking the manifest, this is the cheapest mechanism. Worth setting up in v1's webpack config even if Firefox build is deferred to v1.1.

### 2.6 Verdict popup window sizing (`src/background.ts:119–199`)

`calculatePopupHeight(warningData)` derives an exact popup window height from the data shape (number of assets, listings, etc.) so the user gets a tight window with no scroll/wasted space. They go through the trouble because Chrome's `windows.create({type: 'popup'})` doesn't auto-size to content.

We should keep something simpler in v1 — fixed width (520px), height grown from the verdict's matched-policy count. Firefox's window-position bug workaround (`Browser.windows.update(id, positions)` after creation) is also captured in their code and we should plan to inherit it if/when we add Firefox support.

### 2.7 In-flight idempotency

```ts
const approvedMessages: Array<Hash> = [];
const seenMessages: Array<Hash> = [];

if (approvedMessages.includes(message.requestId)) return false;
```

Once a user clicks "approve" on a verdict modal for a given request hash, the same request hash incoming again (e.g. dApp retry) bypasses the modal. Combined with `object-hash`-derived `requestId` from the transaction itself, this is **how they prevent dialog spam on dApp retries**. We should adopt this — but back it with `chrome.storage.session` rather than the in-memory array since SW restart will lose it.

---

## 3. Things they punt on (we already plan to fix)

| Issue in revoke.cash | Their handling | Our design |
|----------------------|----------------|------------|
| Response timeout | `// TODO: Timeout` in `lib/utils/messages.ts:16,33` | §3.2 explicit latency budget with hard 3s timeout fail-closed |
| SW shutdown loses state | `// Note that these messages will be periodically cleared due to the background service shutting down` (background.ts:27) | §4.3.1 storage.session + IndexedDB queue, modal in separate window keeps SW alive |
| No defense-in-depth | Decoders are TS classes — every change is a code release | §5 user-installable Cedar policy bundles + §6 typed parameter rendering |
| Hardcoded allowlists | `HostnameAllowList[WarningType.LISTING] = ['opensea.io', ...]` in code | Marketplace bundles can ship and version their own allowlists |
| No quantitative caps | They block on "is this an approval at all" — no notion of "approval up to $X" | DEX policies cover USD caps, fee bps caps, 24h volume windows; signature policies cover per-sig USD cap and unlimited-approval block |
| Chain ID staleness | `metamaskChainId` updated only by listening to `chainChanged` events; default 1 (mainnet) | Always read chain at request time via the proxied provider |

---

## 4. Things we should integrate into our design

These are net-new ideas from revoke.cash worth adding to `2026-05-08-chrome-extension-design.md`:

1. **§4.1 Inpage proxy** — add `send`/`sendAsync` proxy paths alongside `request`. Add window-key polling (100ms) as a fallback for legacy multi-provider/Coinbase. Add idempotency marker (`provider.isScopeball = true`).
2. **§4.1 — new "Backstop observer" subsection** — content script listens to MetaMask's `metamask-contentscript`/`metamask-inpage` post-messages and Coinbase Wallet's `extensionUIRequest` messages, surfacing them as `bypassed: true` requests for retroactive warning. This **replaces** the current "best-effort coverage" caveat with a concrete fallback mechanism. EIP-6963 race no longer fully unfixable.
3. **§4.3.3 Pending-deltas queue** — extend with `approvedMessages` set keyed by `objectHash(transaction)` to dedupe dApp retries.
4. **§4.4 Verdict modal** — note that window dimensions need to be calculated, not fixed. Calculate based on matched-policy count + content type.
5. **§7 Storage layout** — explicitly add an `approved-by-hash` set with TTL to `chrome.storage.session`.
6. **§11 Repository layout** — extension stack: webpack 5 + ts-loader + tailwind, manifest preprocessor (`wext-manifest-loader`), viem + post-message-stream + eth-rpc-errors + object-hash + webextension-polyfill.

---

## 5. Things they do that we should explicitly NOT copy

- **In-memory message ports** without persistence — known fragility, our durable queue is correct.
- **Hardcoded scam selectors** (`potentialScamSignatures`) maintained in code — should be a policy bundle, not a constant array.
- **Hardcoded marketplace addresses** (`NFT_MARKETPLACES`) — same story.
- **Decoder-per-scheme classes that emit `WarningData` directly** — that pattern is what we replace with the engine.
- **`messagePorts: Record<string, Port>`** in-memory mapping requestId→port — replace with persistent message correlation across SW restart.
- **`AggregateDecoder` short-circuit on first match** — we should let Cedar evaluate ALL applicable policies and aggregate verdicts (already in our `Verdict::aggregate` design).

---

## 6. Concrete dependency checklist for our extension package.json

```jsonc
// runtime
"@metamask/post-message-stream": "^8",
"eth-rpc-errors":                "^4",
"object-hash":                    "^3",
"viem":                          "^2",
"webextension-polyfill":         "^0.12",
"react":                         "^18",
"react-dom":                     "^18",

// build
"webpack":                       "^5",
"ts-loader":                     "^9",
"copy-webpack-plugin":           "^12",
"wext-manifest-loader":          "^2",
"wext-manifest-webpack-plugin":  "^1",
"web-ext":                       "^8",  // for `web-ext build` zip
```

Plus our own WASM artifact built from `crates/policy-engine` via `wasm-pack` (not in revoke.cash's stack).

---

## 7. Open questions raised by reading their code

- **EIP-6963 + window-key polling double coverage** — does adding both create double-wrapping in modern dApps that announce via 6963 *and* expose `window.ethereum`? Their idempotency marker handles this case for the legacy path; we need the same marker visible to the 6963 path.
- **Backstop observer leaks dApp activity to extension** even when `eth_sendTransaction` is not gated — is that acceptable? Per our §7 audit-log redaction default, the observer should not log raw bodies.
- **`eth_signTypedData` (no version suffix)** — they handle `_v3` and `_v4` only. Some older dApps call the unversioned `eth_signTypedData`. Our design lists it as gated but we need to confirm what shape MetaMask delivers there (it's typically v1, ambiguous typed data). Decision: gate it, decode as v4-shape if possible, else block as `Action::Other`.
- **Coinbase Wallet uses a totally different IPC** (`extensionUIRequest` window messages with a different payload shape) — if we want to support Coinbase Wallet in v1, we need a second backstop branch. Otherwise document as v1.1.
- **Liquality per-chain providers** (`window.eth`, `window.rsk`, ...) — basically dead in 2026, but the polling code that handles them is essentially free. Worth keeping the same window-key list to support obscure setups without thinking about it.
