# registryV2

The **source of truth** for the ScopeBall adapter registry.

ScopeBall is a pre-sign permission-scope analyzer (a browser extension). To decode a
pending wallet action it needs a *decoder bundle* for the `(chain, contract, selector)` or
`(chain, verifyingContract, EIP-712 primaryType)` it is about to evaluate. Those bundles
are authored here as **manifests**, compiled into a content-addressed, signed, statically
served **index**, published to a private GCS bucket, and fetched just-in-time by the
extension through the [`../registry-api`](../registry-api) Cloud Run proxy.

`scripts/build-index.ts` is the source of truth and **generates** the served index — treat
everything under `index/`, `bundles/`, `contexts/`, and `signatures/` as **generated
output**, never hand-edited.

```
   manifests/**            scripts/resolvers/<protocol>.ts        Cloud KMS (HSM)
   (authored)              (RPC: pools/vaults/markets)            EC_SIGN_P256_SHA256
       │                            │                                    │
       ▼                            ▼                                    │ sign(bundle_sha256)
   ┌──────────────────────────────────────────────┐                     │
   │ scripts/build-index.ts                       │                     ▼
   │  walk → validate → resolve → canonicalize    │     scripts/sign-bundles.ts
   │  → sha256 → write 3 index trees + dedup store│ ──► signatures/<sha>.sig
   └──────────────────────────────────────────────┘     (detached P1363 r||s, base64)
       │  index/by-callkey  index/by-typed-data  index/by-selector
       │  bundles/<sha>.json   contexts/…   tokens/…
       ▼
   publish-index.sh / registry-publish.yml
       │  gcloud storage rsync (leaves before pointers)
       ▼
   gs://dambi-registry-v3-seoul   (PRIVATE, versioned)
       │
       ▼  ../registry-api Cloud Run proxy (read-only)
   browser extension
       │  fetch by-callkey  →  recompute sha256(canonicalize(bundle))
       │  fetch signatures/<sha>.sig  →  WebCrypto verify vs PINNED_BUNDLE_PUBLIC_KEY
       ▼  install bundle into the WASM decoder  (fail-closed when enforced)
```

> **Trust anchor:** the registry signs; the **extension** verifies. The private key never
> leaves Cloud KMS; the matching public key is pinned in the extension build. A compromised
> bucket or proxy can withhold or corrupt a bundle (availability), but cannot forge one the
> extension will accept (integrity) — see [Signing & verification](#signing--verification).

> **Self-hosting:** the canonical deployment is GCP project `dambi-registry`
> (`asia-northeast3`), but all resource names are env-overridable via
> `scripts/deploy/_common.sh`.

---

## Repository layout

| Path | Tracked? | What it is |
|---|---|---|
| `manifests/**/*.json` | source | Authored adapter manifests (`type: "adapter_action"`, `schema_version: "3"`). The only thing you hand-edit to change decode behavior. |
| `surface/<protocol>/` | source | Onboarding research artifacts: committed Etherscan/Sourcify ABI snapshots (`*.abi.json` = independent ground truth), per-function `*.coverage.json` triage, `_deployments.json`, address-`_*_universe.json`. Consumed by the completeness gates. |
| `tokens/<chain>/<addr>.json` | source | Static per-chain token table (`erc_kind`, decimals, …). Lets a single manifest auto-enumerate one callkey per token. |
| `scripts/resolvers/<protocol>.ts` | source | RPC resolvers that expand a "sourced" manifest into concrete addresses (pools, vaults, aTokens, gauges …). |
| `scripts/build-index.ts` | source | **The index generator** (source of truth). |
| `scripts/sign-bundles.ts` | source | Bundle signer (local dev key **or** Cloud KMS). |
| `scripts/deploy/` | source | Provision / publish / deploy / rollback / rotate / verify bash scripts + `_common.sh`. |
| `index/by-callkey`, `index/by-typed-data`, `index/by-selector` | generated | The three served lookup trees. |
| `bundles/<sha>.json` | generated | Content-addressed dedup store (multiple callkeys share one bundle via `bundle_ref`). |
| `contexts/…` | generated | Per-target source-context documents for materialized (3-ref) entries. |
| `signatures/<sha>.sig` | gitignored | Detached signatures (~31 k). The **bucket** is the source of truth for these; CI hydrates from it. |
| `docs/` | source | `REGISTRY_ARCHITECTURE.md`, `REGISTRY_RUNBOOK.md`. |

The live bucket may also contain `docs/` and `surface/` provenance snapshots. They are
useful for operators and audits, but they are **not** part of the public proxy surface:
`registry-api` only allowlists the runtime prefixes it serves to the extension
(`index/`, `tokens/`, `bundles/`, `signatures/`, `contexts/`).

---

## The bundle model & `bundle_sha256`

Each served index entry pins a decoder **bundle** by a content hash. There are two entry
shapes:

- **Concrete-inline** (`IndexEntry`): `{ matched: true, bundle_id, manifest_path,
  bundle_sha256, bundle }` — the whole resolved bundle is inlined.
- **3-ref** (`RefIndexEntry`, for sourced/auto-enumerated manifests):
  `{ matched: true, schema_version: "3-ref", bundle_id, manifest_path, bundle_sha256,
  bundle_ref: "bundles/<sha>.json", context_ref?, materialization? }` — no inline bundle;
  the proxy/extension assembles it from `bundle_ref` (+ `context_ref`). This dedupes the
  thousands of token/pool callkeys that share one template.

The **bundle** itself is the manifest with `match` rewritten to a concrete
`{ selector, chain_to_addresses }` and `source_materialize` stripped; it carries
`abi_fragment`, `emit` (strategy + `body` + `live_inputs`), `requires`, etc.

`bundle_sha256` is computed by `computeBundleSha256`:

```
bundle_sha256 = "0x" + sha256( canonicalize(bundle) )
```

where `canonicalize` is the **RFC 8785 JSON Canonicalization Scheme** (the `canonicalize`
npm package): a deterministic, key-sorted, whitespace-normalized UTF-8 serialization. The
hashed bytes are the canonical JSON of the **whole resolved bundle object** — not a subset
of fields, and **not** the raw manifest file bytes. This is what makes the hash stable
across machines and what the extension re-derives at verify time.

### Lookup-key formats

| Tree | Filename | Notes |
|---|---|---|
| `by-callkey` | `<chainId>__<to>__<selector>.json` | one file per `(chain, to)` × selector; `to`/`selector` lowercased |
| `by-selector` | `<chainId>__<selector>.json` | **only** `0xa22cb465` (`setApprovalForAll`) is allowed; `0x095ea7b3` is excluded because it collides with ERC-20 `approve` |
| `by-typed-data` | `<chainId>__<verifyingContract>__<primaryType>[__<witnessType>].json` | EIP-712 `:` in the primary type is escaped to `__`; `PermitWitnessTransferFrom` **requires** a witness type |

Duplicate `by-typed-data` / `by-selector` keys **throw** (no last-wins). Concrete
`by-callkey` collisions are last-wins-with-warning unless `--strict-callkeys` (see gates).

---

## Build pipeline (`scripts/build-index.ts`)

`npm run build` runs the generator. End to end, `main()`:

1. **Walk** `manifests/**/*.json` (sorted; `_template` skipped). Zero manifests is
   non-fatal — it wipes and recreates empty index dirs.
2. **Load** the token index (`tokens/<chain>/*.json`, validated: `erc_kind` ∈
   `{erc20,erc721,erc1155,native}`, address regex, `native` == zero sentinel, `chainId`
   field matches the directory).
3. **Wipe** the generated trees (`index/*`, `bundles/`, `contexts/`) so no orphans survive
   a rebuild.
4. For each manifest: **validate** (`type === "adapter_action"`, non-empty `id`,
   `schema_version === "3"`, match-shape, emit-shape) then **resolve** the bundle. Four
   resolution paths:
   - `address_agnostic: true` → pass-through (selector-only).
   - `chain_to_addresses` → already concrete.
   - `chain_to_addresses_source: "tokens:erc20"` (etc.) → expand the token set into
     concrete addresses.
   - a protocol source kind → call `scripts/resolvers/<protocol>.ts` over RPC (pools,
     vaults, markets …; 30-day disk cache, `--force-refresh` to bypass). Resolvers that
     return per-address context produce **3-ref** entries (`source_materialize`).
5. **Hash** each bundle → `bundle_sha256`; write the index entry, the dedup
   `bundles/<sha>.json`, and any `contexts/…`.

**Failure model is fail-soft-then-fail:** a single broken manifest is caught and counted
(`totalErrors`), the loop continues, and the process exits `1` at the end if any failed —
so CI catches it, but a partial index can exist on disk mid-failure.

### Two integrity gates inside the build

- **`$fn` whitelist:** `validateEmitShape` reads
  `crates/adapters/mappers/src/declarative/fn_whitelist.json` (the single source of truth a
  Rust test asserts parity against) and walks the `emit` subtree — any `$fn` not on the
  whitelist **throws at author time**, so a typo'd function name fails here, not in a
  user's wallet.
- **Strict callkeys:** `--strict-callkeys` (or `STRICT_CALLKEYS=1`) rejects concrete
  `(chain, to, selector)` collisions instead of silently shadowing last-wins. It is **on**
  in `check:manifest`, **off** in a plain `npm run build`.

### Resolvers (`scripts/resolvers/index.ts`)

`PROTOCOL_SOURCE_RESOLVERS` is a registry of protocol resolvers (Aave v3 aTokens /
debt tokens, Curve factories + gauges, Uniswap v2/v3 pools, Balancer v3 pool tokens, …).
Each exposes a `.source` key and a `.resolve(chainId, { rpc, forceRefresh })`. The build
accepts a source kind **iff** a resolver is registered for it, so adding a protocol needs
no `build-index.ts` edit.

---

## Gates (`package.json` scripts)

| Script | What it enforces |
|---|---|
| `build` | `tsx scripts/build-index.ts` — generate the index (verbose, non-strict callkeys). |
| `check:manifest` | `build-index --summary-only --representative-source-refs --strict-callkeys` **then** `node scripts/run-local-v3-harness.mjs validate --representative-source-refs` — strict callkey collisions + the local Rust harness deep-validating `ActionBody` / `DataSource` (the JS build does *not* deep-validate `emit.body`; the harness does). |
| `check:surface` | Diffs authored coverage against the committed Etherscan/Sourcify ABI snapshot: every external-mutating selector must have a coverage entry and a manifest, and vice-versa (no stale, no gaps). |
| `check:universe` | Every `_*_universe.json` is non-empty and every candidate address is dispositioned `cover` / `exclude` / `defer`. |
| `check:tokens` | Token-registry hygiene (filename↔address, `chainId` field == dir, valid `erc_kind`/`token_kind`; `--strict` promotes warnings to errors). |
| `typecheck` | `tsc --noEmit`. |
| `sign` / `gen-signing-key` | see below. |

---

## Signing & verification

This is the supply-chain spine. The integrity guarantee is: **the extension only installs
a bundle whose detached signature verifies against its build-time pinned public key**, and
the signing key lives only in a Cloud KMS HSM.

### What is signed, and how (`scripts/sign-bundles.ts`)

- **What:** the 32-byte **SHA-256 digest** that *is* `bundle_sha256` (hex-decoded). Because
  `sha256(canonicalize(bundle)) == bundle_sha256`, signing that digest signs the canonical
  bundle, and the extension re-hashes `canonicalize(bundle)` to the same digest at verify
  time. (It signs the digest, not the bundle bytes — KMS takes a pre-computed digest.)
- **Algorithm:** ECDSA **P-256 / SHA-256** (KMS algorithm `EC_SIGN_P256_SHA256`).
- **Sidecar:** `signatures/<bundle_sha256>.sig` is JSON
  `{ alg: "ECDSA_P256_SHA256", key_id, sig_b64 }`, where `sig_b64` is the base64 of the
  **raw P1363 `r‖s`** 64-byte signature (not DER, not hex). The extension treats `alg` /
  `key_id` as **telemetry only** — it hard-codes the algorithm and the pinned key, so a
  malicious registry cannot downgrade or swap keys.

Two modes, selected by `BUNDLE_SIGNING_MODE`:

- **`local`** (default) — a 32-byte P-256 secret read from `scripts/deploy/keys/dev-signing-key.hex`
  (gitignored; `BUNDLE_SIGNING_KEY_PATH` overrides). `@noble/curves` `p256.sign(digest, …)`
  returns P1363 `r‖s` directly. For development only.
- **`kms`** — requires `KMS_KEY_NAME` (the full `cryptoKeyVersions/N` resource name). Builds
  **one** `KeyManagementServiceClient` for the whole run and calls `asymmetricSign({ name,
  digest: { sha256 } })`. KMS returns an **ASN.1 DER** signature, which `derToP1363`
  converts to the raw 64-byte `r‖s` form WebCrypto needs (the one KMS-unique transform,
  independently unit-tested).

Performance & safety details that matter operationally:

- **Single client reuse** is the documented fix for a 245-minute hang: a fresh KMS client
  per signature meant tens of thousands of Workload-Identity auth handshakes; one client
  reuses one cached token + gRPC channel.
- **Bounded concurrency** (`BUNDLE_SIGN_CONCURRENCY`, default 12 in KMS mode) via an
  abort-fast promise pool.
- **Hydrate-and-skip:** signing only covers `bundle_sha256` values that don't already have
  a `signatures/<sha>.sig`. CI first `rsync`s `signatures/` down from the bucket, so an
  incremental publish signs ≈ 0 new bundles instead of re-signing the whole corpus.
- **Coverage gate:** `findMissingSignatures` exits `1` if any built bundle lacks a sidecar
  — one uncovered bundle would fail-closed fleet-wide once enforcement is on.

### The dev key (`scripts/gen-signing-key.ts`)

Generates a random P-256 secret, writes it to `scripts/deploy/keys/dev-signing-key.hex`,
and prints the matching **pinned public key** (SPKI, base64) to stdout — the operator
pastes that into the extension's `.env` as `PINNED_BUNDLE_PUBLIC_KEY`. `publicKeySpkiBase64`
builds the SPKI by prefixing the standard P-256 SPKI header to the 65-byte uncompressed
point. **Production keys are never generated here** — they live in KMS, and the prod pinned
key is obtained from `gcloud kms keys versions get-public-key`.

### Where verification happens

**(1) In the browser extension — the real enforcement point.**
`backend/service-worker/adapter-loader/bundle-verify.ts` `verifyBundleSignature`:
`canonicalize(bundle)` (RFC 8785) → `crypto.subtle.digest("SHA-256")` to recompute the
local sha → fetch `signatures/<localSha>.sig` → `crypto.subtle.verify` with ECDSA / SHA-256
against the SPKI key imported from `PINNED_BUNDLE_PUBLIC_KEY`. On any failure it is
**fail-closed** when enforcement is on.

Enforcement is gated by `DAMBI_REQUIRE_BUNDLE_SIGNATURE`:

- The committed production example (`browser-extension/.env.example`) sets this to
  `true` with the prod KMS public key.
- `webpack/webpack.prod.js` calls `assertProdSignatureEnforced(process.env)`, which
  **fails the production build** unless `DAMBI_REQUIRE_BUNDLE_SIGNATURE === "true"` — unless
  an explicit `DAMBI_ALLOW_UNSIGNED_REGISTRY=1` / `DAMBI_ALLOW_INSECURE_REGISTRY=1` marks
  the build as a non-prod smoke build. A second guard fails the build if enforcement is on
  but `PINNED_BUNDLE_PUBLIC_KEY` is empty.

So the honest current state is: **a real production-distributed build cannot ship without
signature verification**, while development builds can still opt out explicitly for local
smoke testing.
The pinned key in `.env.example` is byte-identical to the live KMS public key.

**(2) Pre-flight, before flipping enforcement on.**
- `scripts/verify-prod-registry.ts` samples route-index entries, or checks every
  currently-built `by-callkey`, `by-typed-data`, and `by-selector` route with
  `--all-routes`, from a live `REGISTRY_BASE_URL`. It runs three checks per entry:
  **reconcile** (local index `bundle_sha256` == served), **parity** (recompute
  `sha256(canonicalize(served bundle))` == served `bundle_sha256`), and — if
  `PINNED_BUNDLE_PUBLIC_KEY` is set — **signature** (`subtle.verify` against the pinned
  key, exactly as the extension does). It fails *open* on the signature check if the pin
  is unset (reconcile-only), so always run it with the pin to get a real cryptographic
  check. The extension release workflow builds the representative source-ref index and
  runs a bounded deterministic `--sample=200 --concurrency=1 --timeout-ms=8000`
  live-proxy preflight before producing store-upload zips.
- `scripts/deploy/verify-bucket-parity.sh` does **full** signature-coverage (`comm` of
  local bundle shas vs every `signatures/*.sig` in the bucket) plus migration faithfulness
  (crc32c diff) — full coverage lives bucket-side because proxy rate limits forbid ~31 k
  probes. This is the gate before `DAMBI_REQUIRE_BUNDLE_SIGNATURE=true`.

### Key rotation (`scripts/deploy/rotate-signing-key.sh`)

Three deliberately-separate subcommands, because the private key never leaves the HSM and
rotation creates a **new version** under the same key:

1. `new-version` — `gcloud kms keys versions create`, then poll until `ENABLED` (a new
   asymmetric version starts `PENDING_GENERATION`; `get-public-key`/`sign` fail until
   enabled). Prints the `get-public-key` command for the new pin.
2. ship an extension release pinning the **new** public key.
3. `resign --version N` — `BUNDLE_SIGNING_MODE=kms KMS_KEY_NAME=<…/cryptoKeyVersions/N>
   sign-bundles --force` re-signs **all** bundles, then `rsync`es `signatures/`. `--force`
   is mandatory: the `.sig` filename and 64-byte length are unchanged, so rsync would
   otherwise diff on mtime and leave stale old-key signatures.
4. drain the old-pin fleet, then `destroy-old --version N` (schedules destruction;
   restorable within the destroy-scheduled window).

---

## GCP infrastructure

The canonical deployment, verified against the live project:

| Resource | Value |
|---|---|
| Project | `dambi-registry` (`asia-northeast3`) |
| Bucket | `gs://dambi-registry-v3-seoul` — `STANDARD`, **UBLA**, **Public Access Prevention enforced**, **versioning on**, soft-delete 7 days, lifecycle: keep the 3 newest noncurrent versions, delete others ≥ 30 days noncurrent |
| KMS | keyring `registry-signing` / key `bundle-sign-p256` / `ASYMMETRIC_SIGN` `EC_SIGN_P256_SHA256` / **HSM** protection (FIPS 140-2 L3, non-extractable) / version `1` enabled |
| Proxy service | Cloud Run `registry-api-v3` (see [`../registry-api`](../registry-api)) |
| Artifact Registry | `asia-northeast3-docker.pkg.dev/dambi-registry/dambi` (Docker) |

**Two service accounts, split by least privilege:**

| Service account | Role(s) | Used by |
|---|---|---|
| `registry-signer@dambi-registry.iam.gserviceaccount.com` | `roles/cloudkms.signerVerifier` on the key (sign + `getPublicKey`, **not** export) + `roles/storage.objectAdmin` on the bucket + Cloud Run deployer | CI publish & proxy-deploy (the WIF identity) |
| `registry-api-v3-sa@dambi-registry.iam.gserviceaccount.com` | `roles/storage.objectViewer` on the bucket | the proxy **runtime** (read-only) |

The bucket is not anonymously readable (`Public Access Prevention` is enforced and there
is no `allUsers` bucket binding). Admin/project legacy IAM bindings still exist, so the
precise serving claim is narrower: anonymous extension reads are exposed only through the
Cloud Run proxy, while CI/operator identities retain the permissions needed to publish and
operate the registry.

**Keyless CI auth (Workload Identity Federation):** pool `github-pool`, provider
`github-provider` (OIDC issuer `https://token.actions.githubusercontent.com`). The provider
condition `assertion.repository == 'woojinnn/dambi'` and a `principalSet` binding for
`attribute.repository/woojinnn/dambi` mean **only** GitHub Actions runs from that repo can
impersonate `registry-signer@` — there are **no exported key files** anywhere.

**No external load balancer:** the Compute Engine API is not enabled in the project; the
proxy is served directly on `*.run.app` via the Google Front End.

---

## Publish & deploy

> **The cardinal rule: publish (data) ≠ deploy (code).** Publishing a new index updates
> bucket objects only — it never touches the running proxy. The two CI workflows are
> independent.

### Provision (rare, idempotent) — `scripts/deploy/provision-infra.sh`

Creates the bucket (`--uniform-bucket-level-access --public-access-prevention`), turns on
versioning, applies `bucket-lifecycle.json`, creates the KMS keyring + key
(`--purpose=asymmetric-signing --default-algorithm=ec-sign-p256-sha256 --protection-level=hsm`),
grants the proxy SA `objectViewer`, and (if `SIGNER_SA_EMAIL` is set) grants the signer SA
`cloudkms.signerVerifier`. It prints the command to extract the pinned public key. (The
publish/deploy SA's `objectAdmin` + `run.admin` + `artifactregistry.writer` grants are
documented prerequisites, granted out-of-band.)

### Publish data — `scripts/deploy/publish-index.sh` / `registry-publish.yml`

Triggered by a `registry-v*` tag (incremental) or a `full-sync` dispatch. Steps: build with
`--strict-callkeys` → (CI: parity test + hydrate existing signatures) → **sign** (KMS in
CI) → upload. The upload ordering is load-bearing:

- **Phase 1 (additive):** `gcloud storage rsync` the prefixes **leaves before pointers** —
  `bundles contexts tokens signatures manifests index` — so `signatures/` lands before
  `index/` (the extension derives a sig URL from a new `bundle_sha256` the instant the
  index lands; enforcement-on would 404 otherwise) and `index/` (the pointers the proxy
  resolves) lands last.
- **Phase 2 (prune, only on full-sync / `PRUNE=1`):** the reverse order **pointers before
  leaves** with `--delete-unmatched-destination-objects`, so no live index ref ever names a
  just-deleted leaf.

A default run is purely additive (no deletes). New objects go live after the proxy's 5-min
cache TTL.

### Roll back — `scripts/deploy/rollback-index.sh`

Surgical single-object restore using GCS object versioning. Dry-run by default; `--apply
--generation <GEN>` restores via `gcloud storage cp gs://…#<GEN> …
--if-generation-match=<live>` (optimistic-concurrency: a racing publish fails with 412
rather than being clobbered). Bulk rollback = re-publish a prior `registry-v*` git tag.

### Monitoring & budget

- `provision-monitoring.sh` — a `/health` uptime check + three alert policies (5xx burst,
  p95 latency, uptime fraction) + a `registry_api_errors` log metric, all off the proxy's
  structured logs.
- `provision-budget.sh` — a Cloud Billing budget on the project that **notifies** at
  50/90/100% (+ forecast). It does **not** cap spend — a denial-of-wallet safety net, not a
  hard limit.

### Deploy proxy code

See [`../registry-api`](../registry-api). `registry-proxy-deploy.yml` (tag
`registry-proxy-v*`) does `docker build` + push to Artifact Registry then `gcloud run
deploy` — deliberately **not** Cloud Build, because keyless WIF credentials 403 on Cloud
Build's GCS staging bucket.

Both workflows authenticate via WIF (`REGISTRY_WIF_PROVIDER` + `REGISTRY_DEPLOY_SA`
secrets), gate on the `production` GitHub Environment, and pin
`CLOUDSDK_BILLING_QUOTA_PROJECT=dambi-registry` so external-account credentials attach
`x-goog-user-project`.

---

## Quick start

```bash
npm install
npm run gen-signing-key        # dev key → scripts/deploy/keys/dev-signing-key.hex
                               # paste the printed SPKI(base64) into ../browser-extension/.env
npm run build                  # generate the index
npm run sign                   # sign with the dev key (local mode)
npm run check:manifest         # build (strict) + Rust v3-harness validate
npm run check:surface          # surface-completeness gate
npm run typecheck

# serve locally for the extension (point REGISTRY_BASE_URL at it):
npm run serve                  # python3 -m http.server 8000
```

First-time GCP bring-up: `scripts/deploy/deploy-all.sh` (provision → publish → deploy
proxy). Routine data updates: `scripts/deploy/publish-index.sh`.

## Security model (summary)

- **Integrity** comes from the detached ECDSA-P256 signature the extension verifies against
  its pinned key — *not* from transport. A compromised bucket/proxy cannot forge an
  acceptable bundle; it can only withhold or corrupt (caught fail-closed when enforced).
- The signing private key is **non-extractable** in a Cloud KMS HSM; CI signs via keyless
  WIF restricted to one GitHub repo. No private key material is ever written to disk in prod.
- Bucket is private to anonymous users + versioned; the proxy runtime SA is read-only for
  the public serving path, while CI/operator identities keep separate publish/ops grants.
- Build-time gates (`$fn` whitelist, strict callkeys, surface/universe/token completeness,
  Rust harness) keep a malformed or surface-incomplete manifest out of the published index.
- Enforcement (`DAMBI_REQUIRE_BUNDLE_SIGNATURE`) is forced **on** for production extension
  builds by the webpack guard; local smoke builds must opt out explicitly.
