# Adapter Registry Design

**Created**: 2026-05-15
**Status**: Draft / Phase 1 design freeze
**Owner**: TBD
**Related**: `docs/plans/2026-05-15-tracks-a-and-c.md` (Topic D was deferred from that sprint)

## Background

The Scopeball extension currently bakes every protocol adapter (decoder + mapper + call-adapter) statically into the `policy_engine_wasm` blob — 5.21 MiB shipped with every install (`extension/src/wasm/policy_engine_wasm_bg.wasm`). Adding new protocols means re-publishing the extension. Long-tail protocol coverage is impossible under this model.

This document specifies a per-protocol adapter registry: a separate distribution channel for WASM modules that the extension pulls on demand. Inspired by container registries (GHCR, ECR) and package registries (npm, crates.io), it maps web2 supply-chain practices onto our deterministic-WASM use case.

## Goals (Phase 1)

- Run a local registry in Docker that behaves like S3 from the extension's point of view (`GET /manifest.json`, `GET /adapters/<protocol>/<version>/adapter.wasm`).
- Define a stable manifest schema with day-1 fields for sha256 integrity, version pinning, and signature placeholders.
- Establish content-addressed URLs (`/<protocol>/<version>/adapter.wasm`) so individual artifact bytes are immutable.
- Set up the codebase so production deploy = swap `ADAPTER_REGISTRY_URL` env var, no code change.

## Non-Goals (Phase 1)

- Production deployment (S3 + CloudFront) — Phase 3
- Cryptographic artifact signing — Phase 4 (schema slot exists from day 1; verification is stubbed)
- Permissionless / multi-publisher governance
- Decentralized storage (IPFS)
- Automated rollback on canary failure metrics
- Cross-org public marketplace

## Architecture

```
┌────────────────────────────────┐         ┌─────────────────────────────┐
│  Extension Service Worker      │         │  adapter-registry container │
│                                │         │                             │
│  on unknown (chain, to, sel):  │  HTTP   │  nginx:alpine               │
│    1. fetch manifest.json      │ ──────► │   GET /manifest.json        │
│       (ETag, Cache-Control)    │         │   GET /adapters/.../.wasm   │
│    2. look up protocol         │         │                             │
│    3. fetch adapter.wasm       │ ──────► │   port 8788 (dev)           │
│    4. verify sha256            │         │   :80 in container          │
│    5. cache in IndexedDB       │         │                             │
│    6. instantiate via          │         │                             │
│       WebAssembly.compile      │         │                             │
└────────────────────────────────┘         └─────────────────────────────┘
```

**Extension caching**: IndexedDB keyed by `(protocol, version, sha256)`. Same SW boot can reuse warm cache. Cross-SW-boot the cache survives until manifest mutation invalidates entries.

**Registry caching**: nginx `Cache-Control: public, max-age=60` on `manifest.json`, `max-age=31536000, immutable` on adapter.wasm files (content-addressed so they never change).

## Manifest Schema (v1)

Canonical TypeScript types live at `extension/src/lib/adapter-manifest.ts`. JSON shape:

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-05-15T07:00:00Z",

  "adapters": [
    {
      "protocol": "uniswap-v4",
      "display_name": "Uniswap V4",

      // Mutable pointer — extension reads this each manifest fetch.
      "stable_version": "0.1.0",
      // Optional canary channel (Phase 3).
      "canary_version": null,

      "versions": [
        {
          "version": "0.1.0",
          "url": "/adapters/uniswap-v4/0.1.0/adapter.wasm",
          "sha256": "0xabcd1234...",            // required from day 1
          "size_bytes": 528344,

          // Which on-chain targets this adapter claims.
          "supported_chains": [1, 10, 8453],
          "supported_addresses": [
            { "chain_id": 1, "address": "0x000000000004444c5dc75cb358380d2e3de08a90" }
          ],

          // Set of capability names the host (extension) must support
          // for the adapter to work (e.g. "oracle.usd_value").
          "host_capabilities": ["oracle.usd_value"],

          // Signature placeholder — null in Phase 1.
          "signature": null,
          "signer_id": null,

          "published_at": "2026-05-15T06:30:00Z",
          "revoked": false                       // emergency kill switch
        }
      ]
    }
  ]
}
```

### Field rationale

- **`schema_version: 1`** — explicit so future schema changes can coexist behind a parser version gate.
- **`stable_version`** mutable, `versions[].url` immutable → rollback is a single manifest edit.
- **`sha256`** required from day 1 — cheap, no key management, ensures bytes integrity even before signing exists.
- **`signature` / `signer_id`** nullable today; extension verifier stub accepts null but emits a TODO log. Phase 4 flips to required.
- **`supported_addresses`** lets the extension look up adapter by `(chain_id, to)` without first compiling the WASM.
- **`revoked: true`** lets us hot-disable a buggy version without removing it from `versions[]` (history preserved).

## Trust Model

| Phase | What's verified | Enforcement |
|---|---|---|
| **1 (now)** | `sha256` only | Required; fail download if mismatch |
| **2** | sha256 + manifest `generated_at` freshness | sha256 required; manifest stale > 1d warns |
| **3** | sha256 + manifest ETag-confirmed | manifest fetched per SW boot + every 1h |
| **4** | sha256 + ed25519 signature against allowlist | signature required; allowlist in extension build |
| **5** | sha256 + Sigstore/cosign + transparency log | Sigstore bundle in manifest; verify against Rekor |

Day-1 substrate that supports all future phases:
- Manifest fields (`signature`, `signer_id`) exist as nullable from Phase 1
- Verifier module exists with explicit `TODO: signature enforcement` log
- Extension config has `TRUSTED_SIGNER_IDS: string[]` (empty in Phase 1)

## Versioning & Rollback

**Versioning rule**: semver. Major bump means incompatible Decoder/Mapper trait shape (rare); minor bump means new selector support; patch is bugfix.

**Rollback flow** (all done via manifest edit, no client code change):

1. v0.1.1 found buggy.
2. CI publishes new manifest.json with `"stable_version": "0.1.0"` (or sets `"revoked": true` on the 0.1.1 entry).
3. nginx serves new manifest within `Cache-Control: max-age=60` — clients see update ≤ 1 minute later (real S3 + CloudFront: configure same).
4. Extension fetches manifest on next adapter request OR every SW boot. New `stable_version` triggers fetch of 0.1.0 (if not in IndexedDB cache, downloaded once; future calls warm).
5. v0.1.1 IndexedDB entry can be cleaned up by a LRU pass, or kept indefinitely (cheap).

**No hot-swap of in-flight adapter instance**: WASM instances inside SW memory aren't replaced mid-call. Next call gets the new version.

**Emergency revocation**: `revoked: true` on a version. Extension treats as "do not use, do not cache". If extension already cached, hit-check fails verification (TBD whether revocation = drop cache).

## Web2 DevSecOps Mapping

| Web2 pattern | Mapped to | Phase |
|---|---|---|
| Container registry (GHCR, ECR) | adapter-registry HTTP server | 1 (Docker) → 3 (S3) |
| Semantic versioning | `version` field | 1 |
| Content-addressed storage | URL embeds version + sha256 | 1 |
| Integrity hashing | `sha256` field (required) | 1 |
| Artifact signing | `signature` + `signer_id` | 4 |
| Sigstore/cosign + transparency log | Sigstore bundle in manifest | 5 |
| SBOM | `metadata.json` co-located with `.wasm` (deps, Rust toolchain version) | 2 |
| GitOps | `adapter-registry/public/` tracked in repo; CI syncs to S3 on tag | 3 |
| Canary deploys | `canary_version` field | 3 |
| Feature flags | `revoked: true` flag (kill-switch) | 1 |
| CDN caching | nginx `Cache-Control` → CloudFront | 1 (local) → 3 (prod) |
| Client cache invalidation | ETag + content-addressed URLs | 1 |
| Vulnerability scanning | WASM static analysis (`wasm-tools validate`, custom property checks) | 2 |
| Provenance (SLSA) | GH Actions OIDC + signed metadata | 4-5 |
| Rate limiting / DDoS | CloudFront WAF | 3 |
| Observability | nginx access log → ELK/Datadog | 2 |

## Phased Roadmap

### Phase 1 (this sprint, after Tracks A+C land)
- `adapter-registry/` directory + Dockerfile (nginx:alpine) + nginx config
- docker-compose.yml gets `adapter-registry` profile + service
- manifest.json schema in TypeScript (this doc + `extension/src/lib/adapter-manifest.ts`)
- `scripts/build-manifest.js` — scans `public/adapters/` and produces `manifest.json` with sha256
- Empty initial manifest with `adapters: []`
- README explaining how to add an adapter manually
- nginx Cache-Control headers configured (60s manifest, immutable on adapter blobs)

### Phase 2 (after Phase 1 lands)
- Extension SW gets `AdapterRegistryClient` (fetch manifest, fetch adapter, verify sha256, cache in IndexedDB)
- Integration with request-router: on unknown selector, query registry before falling back
- First per-protocol adapter (`uniswap-v4`) built as a separate wasm-pack crate
- End-to-end test: extension hits registry, fetches v4 adapter, decodes a v4 tx

### Phase 3
- Deploy registry to S3 + CloudFront
- GitOps wiring: tag in repo → CI builds adapter wasms → uploads to S3 → publishes manifest
- Canary channel implementation

### Phase 4
- ed25519 signing introduced; verifier enforced
- `TRUSTED_SIGNER_IDS` allowlist baked into extension build
- Key rotation procedure documented

### Phase 5
- Sigstore + cosign + Rekor integration
- Automated rollback on canary error rate threshold
- Full SLSA Level 3 provenance

## Open Questions

1. **Manifest fetch interval** — every SW boot (cold-start cost) vs background refresh (1h timer)? Phase 2 decision.
2. **IndexedDB cleanup policy** — LRU? TTL? Storage quotas in MV3 SW? Phase 2.
3. **Adapter ABI versioning** — when adapter v0.2.0 changes its WASM export signatures, how do older policies that reference v0.1.0 keep working? Probably: extension always uses latest stable; policies don't pin version directly. Document explicitly in Phase 2.
4. **Registry URL bootstrap** — env var at build time, or fetched from a fixed bootstrap URL, or hardcoded in extension's default-policies bundle? Lean toward env-var with default to localhost dev → S3 in prod build.
5. **Compile-time budget** — already covered in Topic D audit (100-200ms per per-protocol module, MV3 3s boot limit). Need a "pre-warm top-N adapters during idle" strategy in Phase 2.
6. **Adapter side TypeScript ABI** — currently `policy_engine_wasm` exports JSON-in/JSON-out (`route_request_json` etc.). Per-protocol adapters should follow the same pattern: `decode_<protocol>(input_json) -> output_json`, `map_<protocol>(input_json) -> output_json`. Formalize in Phase 2.

## Out of Scope (Forever or Until Re-Scoped)

- Public adapter marketplace (anyone can publish)
- WASM-runtime sandboxing beyond browser's default (e.g. fuel metering)
- Trustless on-chain manifest (would need oracle / IPFS / ENS — over-engineering for our threat model)
- Cross-chain registry sync (one global registry serves all chains)
