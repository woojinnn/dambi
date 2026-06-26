# registry-api

A small, dependency-light **caching, authenticated reverse-proxy** that sits in front of
the **private** ScopeBall adapter-registry GCS bucket and serves it to the browser
extension over anonymous HTTPS.

The extension cannot read the bucket directly: the bucket has **Public Access Prevention
enforced** and no `allUsers` binding, so anonymous browser reads must go through the
proxy's runtime service-account OAuth token. Other administrative identities can still
exist on the bucket (for example the CI signer/publisher and project owners); the public
serving boundary is that only `registry-api` exposes a **fixed allowlist** of object paths
to the internet with CORS, cache headers, and three independent denial-of-wallet / DoS
mitigations in front of every read.

It is a single Node 20 process deployed to **Cloud Run**. Runtime code uses raw
`node:http`, `google-auth-library` for ADC access tokens, `fetch` against the GCS JSON
media endpoint, and `canonicalize` for 3-ref materialization integrity checks.

```
                    ┌──────────────────────────────────────────────────────────┐
  browser           │  Cloud Run service:  registry-api-v3   (THIS repo)       │
  extension         │  Google Front End (GFE) + autoscaler                     │
  (anonymous   ───► │    min 1 / max 3 instances · concurrency 80 · 15s timeout│ ──► GCS bucket
   HTTPS GET)       │  per request:                                            │     dambi-registry-v3-seoul
                    │    rate-limit → path allowlist → LRU+TTL cache →         │     (PRIVATE, PAP enforced)
                    │    single-flight → GCS read (runtime SA via ADC)          │ ◄── object bytes
                    └──────────────────────────────────────────────────────────┘
                                  ▲                                                      ▲
                                  │ serves                                               │ built & signed by
                          REGISTRY_BASE_URL                                        ../registryV2 (source of truth)
```

The objects in the bucket are produced by the sibling package [`../registryV2`](../registryV2),
which is the registry **source of truth** (it builds the index, signs every bundle, and
publishes to the bucket). This proxy never writes — it is strictly read-only.

> **Self-hosting:** the canonical deployment runs in GCP project `dambi-registry`
> (`asia-northeast3`), but every resource name (bucket, service, SA, region) is
> env-overridable through `../registryV2/scripts/deploy/_common.sh`. Nothing here is
> hard-coded to one tenant.

---

## What it does, module by module

`src/` is intentionally tiny and each file does one thing. The per-request flow is wired
in `server.ts`; everything else is an injectable collaborator (so the whole server can be
unit-tested with fakes).

| Module | Responsibility |
|---|---|
| `index.ts` | Process entrypoint. Loads config, constructs the `GcsObjectReader`, builds the server, sets slowloris edge timeouts, binds the socket. |
| `server.ts` | The raw `node:http` request router + the proxy request lifecycle, CORS, status mapping, and 3-ref bundle materialization. |
| `config.ts` | Reads/validates every environment variable into a typed `Config` with safe fallbacks. |
| `validation.ts` | The **path allowlist**: maps an incoming URL path to a concrete GCS object key, or rejects it. |
| `gcs-client.ts` | The only thing that talks to GCS. Authenticates via ADC, reads objects through the GCS JSON media endpoint, classifies errors. |
| `cache.ts` | In-process LRU + TTL object cache for positive objects and cacheable negative/404 misses. |
| `single-flight.ts` | Coalesces concurrent identical reads into one upstream fetch. |
| `rate-limiter.ts` | Per-IP token-bucket rate limiter with an LRU-bounded IP table. |
| `log-store.ts` | Fixed-capacity ring buffer of recent requests for `/debug/recent`. |
| `types.ts` | Shared interfaces (`ObjectReader`, `CacheValue`, …). |

### Process entrypoint (`index.ts`)

`startRegistryApiServer()` calls `loadConfig()`, constructs `new GcsObjectReader({ bucketName })`,
and `createRegistryApiServer({ config, reader })`. Before listening it sets three timeouts
directly on the Node `Server` as slowloris / dribble defenses — `headersTimeout = 5s`,
`requestTimeout = 10s`, `keepAliveTimeout = 5s` — then `listen(PORT, HOST)` and emits a
JSON `registry_api_listening` log line. A run-vs-import guard
(`import.meta.url === pathToFileURL(process.argv[1])`) makes the module importable by tests
yet runnable as the container `CMD`.

### HTTP server & routing (`server.ts`)

There is **no web framework**. `createServer` is configured with an explicit
`maxHeaderSize: 16 KiB` (so a stray `NODE_OPTIONS` cannot raise it), and a single
`routeRequest()` dispatches on `url.pathname` with `startsWith` prefix checks. A top-level
`try/catch` turns any unhandled throw into a `500 internal_error`. All collaborators
(cache, rate limiter, log store, single-flight, clock) are injectable for testing.

### The per-request lifecycle (`handleProxy`)

For every proxied path the steps run in this exact order — the ordering is deliberate:

1. **Rate limit first** — derive the client IP and consume a token *before* path
   validation, so even garbage-path floods are throttled. Over limit → `429` + `retry-after: 1`.
2. **Path validation** — `parseProxyTarget(path)` either returns the concrete GCS object
   key or rejects. Reject → real `404` with a *negative* `Cache-Control`.
3. **Cache lookup** — a hit (positive 200 **or** negative 404) is served from RAM and the
   GCS read is skipped.
4. **Single-flight GCS read** — on a miss, the object is read through the single-flight map
   so N concurrent identical misses collapse to **one** GCS download.
5. **Respond** — `found` → cache + 200 with the right `Cache-Control`; `not_found` →
   404 with path-dependent negative-cache behavior; `upstream_error` → 502 (**not** cached).

Every response (except the 204 preflight) carries the CORS headers
(`access-control-allow-origin: *`, methods `GET, OPTIONS`). Every request appends a record
to the in-memory ring buffer **and** emits a structured `registry_api_request` JSON line to
stdout, which Cloud Logging ingests.

### Path allowlist & object-key mapping (`validation.ts`)

This is the security boundary. `parseProxyTarget` immediately rejects any path containing
`..` or `%` (defense-in-depth against traversal / encoding tricks), then matches the path
against a fixed set of patterns. All hex (addresses, selectors, sha256) must be
**lowercase**, because GCS object names are case-sensitive and the index builder writes
lowercase.

| Request path | Constraint | → GCS object |
|---|---|---|
| `/index/by-callkey/<chain>__<to>__<selector>.json` | `chain__0x{40}__0x{8}` | `index/by-callkey/…` |
| `/index/by-typed-data/<chain>__<verifyingContract>__<primaryType>[__<witnessType>].json` | trailing type allows mixed-case + `_` (EIP-712 `:` is escaped to `__`) | `index/by-typed-data/…` |
| `/index/by-selector/<chain>__<selector>.json` | address-agnostic adapters (e.g. NFT `setApprovalForAll`) | `index/by-selector/…` |
| `/tokens/<chain>/<address>.json` | `chain` numeric, `address` `0x{40}` | `tokens/<chain>/<address>.json` |
| `/bundles/<sha>.json` | `0x{64}.json` (content-addressed) | `bundles/…` |
| `/signatures/<sha>.sig` | `0x{64}.sig` (detached signature sidecar) | `signatures/…` |
| `/contexts/<scope…>/<chain>/<address>.json` | ≥4 segments; per-target source contexts | `contexts/…` |

Anything else → `404`. (The old README listed only `by-callkey` + `tokens`; the live
allowlist is the seven prefixes above.)

### Caching (`cache.ts`)

An in-process insertion-ordered `Map` acting as an **LRU with lazy per-entry TTL**. A
cache value is either a `200` object (body + content-type) or a cacheable `404` miss.
`get()` evicts expired entries on read and re-inserts live ones at the MRU end; `set()`
evicts from the front (oldest) when over `CACHE_MAX_ENTRIES`. TTLs differ by polarity:

- positive entries (index / tokens / contexts and other mutable served paths) →
  `CACHE_TTL_MS` (default **5 min**)
- cacheable negative `404` entries → `CACHE_NEGATIVE_TTL_MS` (default **60 s**) — the
  extension's negative-cache logic depends on a *real* 404 status here.
- content-addressed leaf misses (`/bundles/<sha>`, `/signatures/<sha>`) are **not**
  stored in the in-process negative cache and respond with `Cache-Control: no-store`.
  A missing leaf can be a publish window race; caching it would make a newly-published
  signature or bundle remain invisible until the negative TTL expires.

The response `Cache-Control` is chosen by content type, not by the cache TTL:

- content-addressed leaves (`/bundles/<sha>`, `/signatures/<sha>`) → `CACHE_CONTROL_IMMUTABLE`
  (default `public, max-age=31536000, immutable`) — safe because they can never change.
- everything else (mutable served paths) → `CACHE_CONTROL` (default `public, max-age=300`).
- cacheable 404s → a derived `public, max-age=<negative-ttl-seconds>`.
- content-addressed 404s → `no-store`.

> The cache does **hard** TTL expiry with no background revalidation. It is a cost/latency
> optimization, **not** a correctness device — each Cloud Run instance has its own cache,
> and `--max-instances` bounds total GCS fan-out.

### Single-flight (`single-flight.ts`)

A `Map<key, Promise>` of in-flight reads. If a read for a key is already running, the new
request awaits the **same** promise instead of issuing a second GCS download; the entry is
deleted on settle (success *or* failure), so a transient error never wedges a key. The
cache dedupes *completed* results; single-flight dedupes *in-progress* ones. Together they
defeat thundering-herd on a cold/popular callkey.

### Rate limiting & client-IP derivation (`rate-limiter.ts`, `server.ts`)

A per-IP **token bucket** (`RATE_LIMIT_BURST` capacity, refilling `RATE_LIMIT_REFILL_PER_SEC`).
The per-IP table is itself LRU-bounded to `RATE_LIMIT_MAX_IPS`, so a spoofed-source flood
cannot grow memory without bound.

The client IP is derived by `extractClientIp(xff, socketAddr, trustedProxyHops)`, which
counts **from the right** of `X-Forwarded-For`. Because XFF is appended hop-by-hop, the
left entries are client-spoofable and the rightmost is whatever the trusted edge inserted.
`TRUSTED_PROXY_HOPS` (default **0** = rightmost) selects the trusted entry:

- On a direct `*.run.app` topology the rightmost is Google's front end — unspoofable — so
  `0` is correct. It also **fails safe**: a wrong guess over-throttles (degrades toward a
  global cap), it never under-counts a spoofed client.
- Behind a Google HTTP(S) load balancer you must raise `TRUSTED_PROXY_HOPS` by the LB hop
  count, or rate limiting becomes effectively global.

> **Honest limit:** this limiter is instance-local in-process memory — effective capacity
> is `burst × instanceCount` and it resets on instance recycle. It is a cost speed-bump,
> not real anti-DDoS. Per-IP edge enforcement at scale is a Cloud Armor + external-LB job.

### GCS client & authentication (`gcs-client.ts`)

`new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_only"] })`
with **no key file** relies on **Application Default Credentials**, which on Cloud Run
resolve to the service's **runtime service account** via the metadata server. That SA
(`registry-api-v3-sa@…`) has `roles/storage.objectViewer` on the bucket — read-only,
least privilege for the serving path. `read()` obtains an OAuth access token and fetches
`https://storage.googleapis.com/storage/v1/b/<bucket>/o/<object>?alt=media`, then
**hard-codes** `content-type: application/json` (stored object metadata is not trusted —
registry objects are always JSON).

Error classification is deliberate: a GCS `404` → `not_found` → HTTP **404**; everything
else (403 IAM, 5xx, network) → `upstream_error` → HTTP **502** and is **not cached**.
Note the consequence: a broken IAM binding surfaces as a *transient 502*, not a 404 — when
debugging a registry outage, a 502 can mean "permission problem," not just "GCS down."

### 3-ref index materialization (`server.ts`)

For `index/by-callkey/…` objects the proxy is not purely a pass-through. If the fetched
object is a `schema_version: "3-ref"` entry (a pointer carrying `bundle_ref` and optionally
`context_ref` instead of an inline `bundle`), the proxy **assembles** the full bundle on
the fly: it sub-reads `bundles/<sha>.json` (cached — content-addressed and immutable) and,
when present, `contexts/…` (never cached — address-keyed and can change), then substitutes
`$source.*` placeholders from the context document and rebuilds the `match` block. A
failure in any sub-read or an unknown placeholder → `502 ref_materialization_failed` (not
cached, retried next time). Non-ref bundles pass through verbatim.

### Observability (`log-store.ts`, `/debug/recent`)

`LogStore` is a fixed-capacity ring buffer (default 50) of `{ ts, path, status, cache,
duration_ms }`, returning copies so callers can't mutate history. It is exposed only via
`GET /debug/recent`, which is gated by the `DEBUG_TOKEN` shared secret (`x-debug-token`
header). Without a valid token the route returns `404` — i.e. it is *invisible*. This
matters because callkeys (`chain__contract__selector`) leak the user's pre-sign intent, so
the request log is sensitive. Structured stdout lines feed Cloud Logging; the
`provision-monitoring.sh` script in `../registryV2` wires uptime, latency, and 5xx alerts
off them.

---

## Endpoints

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/health` | `200 {"ok":true}` |
| `GET` | `/index/by-callkey/<chain>__<to>__<selector>.json` | on-chain tx adapter bundle (with 3-ref materialization) |
| `GET` | `/index/by-typed-data/<chain>__<verifyingContract>__<primaryType>[__<witnessType>].json` | off-chain EIP-712 signature adapter |
| `GET` | `/index/by-selector/<chain>__<selector>.json` | address-agnostic adapter (e.g. `setApprovalForAll`) |
| `GET` | `/tokens/<chain>/<address>.json` | per-chain token metadata |
| `GET` | `/bundles/<sha>.json` | content-addressed bundle template (referenced by 3-ref entries) |
| `GET` | `/signatures/<sha>.sig` | detached ECDSA-P256 bundle signature sidecar |
| `GET` | `/contexts/<scope…>/<chain>/<address>.json` | per-target source context for materialization |
| `GET` | `/v1/registry/by-callkey?chain_id&to&selector` | query-string alias → rewritten to the `by-callkey` path |
| `GET` | `/debug/recent` | recent-request log + cache stats (**requires** `x-debug-token`) |
| `OPTIONS` | `*` | `204` CORS preflight |

### Status contract (relied on by the extension)

| Situation | Response |
|---|---|
| object found | `200` + body + `Cache-Control` + CORS |
| object missing, mutable pointer path | **`404`** + derived negative `Cache-Control` (real status; drives the extension's negative cache) |
| object missing, content-addressed leaf path | **`404`** + `Cache-Control: no-store` |
| GCS upstream / IAM / 5xx error | `502 upstream_error` (not cached) |
| 3-ref sub-read or placeholder failure | `502 ref_materialization_failed` (not cached) |
| per-IP rate exceeded | `429` + `retry-after: 1` |
| bad/disallowed path | `404 not_found` |
| non-GET method | `405 method_not_allowed` |
| uncaught internal error | `500 internal_error` |

---

## Configuration

All env vars are read in `config.ts` with the defaults below.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `0.0.0.0` | bind host |
| `PORT` | `8080` | bind port |
| `REGISTRY_BUCKET` | `dambi-registry-v3-seoul` | private GCS bucket to proxy |
| `CACHE_MAX_ENTRIES` | `1024` | LRU cache capacity |
| `CACHE_TTL_MS` | `300000` | positive entry TTL (5 min) |
| `CACHE_NEGATIVE_TTL_MS` | `60000` | 404 entry TTL (60 s) |
| `CACHE_CONTROL` | `public, max-age=300` | `Cache-Control` for mutable pointers (index / tokens) |
| `CACHE_CONTROL_IMMUTABLE` | `public, max-age=31536000, immutable` | `Cache-Control` for content-addressed leaves (bundles / signatures) |
| `DEBUG_TOKEN` | `""` (disabled) | shared secret gating `/debug/recent` |
| `RATE_LIMIT_BURST` | `60` | token-bucket capacity per IP |
| `RATE_LIMIT_REFILL_PER_SEC` | `10` | refill rate per IP |
| `RATE_LIMIT_MAX_IPS` | `10000` | LRU cap on the per-IP table |
| `TRUSTED_PROXY_HOPS` | `0` | XFF hops to skip from the **right** when deriving the rate-limit IP |

The deploy scripts set the env payload via `--set-env-vars`, which **replaces** the whole
set on each deploy — every variable the service needs is listed in
`../registryV2/scripts/deploy/_common.sh` (`rv3_env_vars`).

---

## Runtime: Cloud Run

The live deployment shape (from `_common.sh`, verified against the running service):

| Setting | Value | Why |
|---|---|---|
| service | `registry-api-v3` (`asia-northeast3`) | |
| runtime SA | `registry-api-v3-sa@dambi-registry.iam.gserviceaccount.com` | read-only `storage.objectViewer` on the bucket |
| CPU / memory | `1` / `256Mi` (+ startup CPU boost) | tiny JSON proxy |
| min / max instances | `1` / `3` | **min 1** keeps a warm instance — the extension's JIT registry fetch has no per-fetch timeout, so a scale-to-zero cold start would blow the 8 s pre-sign budget and surface `__engine::timeout`. **max 3** is the denial-of-wallet cost ceiling. |
| concurrency | `80` | requests per instance |
| request timeout | `15 s` | proxy answers small JSON in <1 s; a long ceiling only helps slowloris |
| ingress | `all` | |
| auth | `--no-allow-unauthenticated` **then** `allUsers → roles/run.invoker` | the *service* is public-invokable (anonymous extension fetch) but the **bucket stays private** |

The currently deployed image tag can lag the checked-out source until a
`registry-proxy-v*` release or manual default-branch proxy deploy runs. Treat the table
above as the live **runtime shape**; verify the exact image with `gcloud run services
describe registry-api-v3 --region asia-northeast3 --project dambi-registry`.

There is **no external load balancer** — the Compute Engine API isn't even enabled in the
project. "Load balancing" is Cloud Run's built-in: the Google Front End terminates TLS and
spreads requests across the 1–3 autoscaled instances at concurrency 80. (This is why
`TRUSTED_PROXY_HOPS=0` is correct: the rightmost XFF entry is the GFE.)

### Container image (`Dockerfile`)

A 2-stage Alpine build whose base image is **pinned by digest**
(`node:20-alpine@sha256:…`) so the build is reproducible. Stage 1 runs
`npm ci --ignore-scripts` (blocks malicious dependency lifecycle scripts) then `tsc`.
Stage 2 installs prod deps only (`npm ci --omit=dev --ignore-scripts`), copies `dist/`,
runs as the non-root **`node`** user, `EXPOSE 8080`, a `/health` `HEALTHCHECK`, and
`CMD ["node","--enable-source-maps","dist/index.js"]`.

---

## Local development

```bash
npm install
npm run typecheck
npm test                              # vitest
npm run build && npm start            # hits the real bucket → needs ADC:
                                      # gcloud auth application-default login
```

## Deploying

`registry-api` is **code**; the bucket contents are **data**. They deploy independently —
publishing a new index never touches the running proxy. Both live in `../registryV2`:

- **Code (this service):** `registry-proxy-deploy.yml` on a `registry-proxy-v*` tag, or
  `../registryV2/scripts/deploy/deploy-proxy.sh` locally. CI does
  `docker build` + `docker push` to Artifact Registry then `gcloud run deploy` — it does
  **not** use Cloud Build, because keyless Workload-Identity credentials get a `serviceusage`
  403 on Cloud Build's GCS staging bucket. Cloud Run keeps the prior revision, so an
  unhealthy new revision fails the deploy without dropping traffic.
- **Data (bucket objects):** `registry-publish.yml` on a `registry-v*` tag, or
  `../registryV2/scripts/deploy/publish-index.sh` locally.

A **new path prefix** (e.g. adding `/index/by-selector/`) only starts serving after the
proxy **code** ships, because the allowlist lives in `validation.ts` — uploading the
objects is not enough.

## Security model (summary)

- Bucket is private to anonymous users (PAP enforced, no `allUsers` bucket binding). The
  proxy's runtime SA is read-only and is the only identity used for public serving; CI and
  project-admin identities may still have bucket permissions for publish/ops.
- Fixed path allowlist with `..`/`%` rejection and per-prefix regexes — no arbitrary object
  access, no traversal.
- `--ignore-scripts` on install, digest-pinned base image, non-root runtime.
- DoS / denial-of-wallet defenses: instance-local cache + single-flight + token-bucket rate
  limit, bounded ultimately by `--max-instances`; a billing budget alarm in `../registryV2`.
- `/debug/recent` is token-gated because callkeys reveal pre-sign intent.
- The proxy provides **transport + availability**; the *integrity* of a bundle is enforced
  by the **detached signature** the extension verifies against its pinned key — see
  [`../registryV2`](../registryV2) for the signing/verification spine.
