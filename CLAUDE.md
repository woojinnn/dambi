# ScopeBall — scopeball repo project memory

> 본 파일은 Claude Code 가 cwd / git root 의 CLAUDE.md 로 자동 로드.
> 새 session 시작 시 본 내용 그대로 컨텍스트 inject.
> 사용자별 ScopeBall/CLAUDE.md (parent, security researcher profile) + 본 file 합쳐서 컨텍스트 구성.

## Overview

- **ScopeBall** = pre-sign permission scope analyzer (browser extension, pocket-universe-style)
- **본 repo** (`scopeball/`): Rust workspace + TS browser-extension monorepo
- **Spec docs** (`ScopeBall/` parent, git 외 위치):
  - `ADAPTER_MARKETPLACE_ARCHITECTURE.md` (1158 줄, demo PoC spec — clean-slate review 2 round 패치 완료)
  - `BROWSER_EXTENSION.md`, `RUST_CORE.md`, `SERVER_COMPONENTS.md`, `ScopeBall.md`, `swap-intent-flow.md`

## 현재 작업 — ADAPTER_MARKETPLACE Uniswap PoC

### Branch + 9 commits
- Branch: `feat/registry-server` (origin/main 기준 9 commits 차이)

| Commit | Phase | Scope |
|---|---|---|
| `8d6ddb7` | 0 | Schema (types.rs + bundle-schema.ts + fixture) |
| `723fecc` | 1A | Rust DeclarativeMapper + single_emit + WASM `declarative_install/lookup_json` |
| `2d55adc` | 1B | TS wasm-bridge + declarative-adapter-loader + seed bundle |
| `6fe960a` | 2A | Registry static manifests + build-index.ts (RFC 8785 JCS sha256) |
| `8f7a426` | 2B | TS registry-client + JIT + negative-cache + installBundle |
| `0f2c6c4` | 3 | V3 + SR02 via `unfold_v3_path` (Cat A packed path) |
| `a37fbd2` | 4 | `multicall_recurse` + MapContext refactor + V3 NFPM |
| `76351f2` | 5 | UR `opcode_stream_dispatch` + 8 opcodes |
| `313e78b` | 6 | E2E wiring (bridge + `declarative_route_request_json` + orchestrator) |
| `f2e7b61` | extra | Multi-chain UR support (Base/Optimism/Arbitrum/Polygon) |

### Spec × 구현 매핑 (`ADAPTER_MARKETPLACE_ARCHITECTURE.md`)

| § | 상태 | 비고 |
|---|---|---|
| §0 데모 범위 | ✅ | V2/V3/SR02/UR/NFPM. Cat E/F 의도 제외 |
| §1 제약 | ✅ | WASM 5.88 MB 임베드 |
| §2 정적/동적 분리 + Tier A/B | ✅ | — |
| §3 6 카테고리 | ✅ A/B/D | C placeholder, E/F skip |
| §4 Bundle 4 strategy | ✅ schema | EnumTaggedDispatch placeholder |
| §5 DSL Interpreter | ✅ 3/4 strategy 실행 | EnumTaggedDispatch unimplemented |
| §5.4 MapContext refactor | ✅ Phase 4 | parent_calldata + depth + resolver |
| §5.5 Bridge layer | ✅ Phase 6 | DECLARATIVE_STATE 내 (chain, to, sel) → decoder_id |
| §5.7 cedarschema validation | ❌ | PoC simplification |
| §6 Registry | ✅ | GCS 정적 호스팅, Cloud CDN/LB 미설정 |
| §7 3-Layer | ✅ Layer 1 + Layer 3 + Negative cache | Layer 2 LRU 미구현 |
| §7.3 sha256 검증 | ✅ RFC 8785 JCS | — |
| §7.5 HMAC IndexedDB key | ❌ raw key (PoC) | — |
| §8 host:token_metadata | ⚠️ | placeholder — EmptyTokenRegistry |
| §9 코드 인벤토리 | ✅ | 모든 신설 모듈 commit |
| §10 향후 작업 9 sub | ❌ | 의도적 미구현 |

### 검증 결과

- `cargo test --workspace` 회귀 0
- `cargo build --target wasm32-unknown-unknown` OK
- `npx vitest run` (browser-extension) 174/174 pass
- 수동 e2e (V2 swap mainnet, `/tmp/scopeball-poc-test/index.html`):
  - `outcome: "hit"`, `decoderId: "declarative.uniswap/v2/swapExactTokensForTokens"`, `source: "layer1"`, `verdict: "pass"`
  - declarative path 가 V2 swap 정확히 매핑 + envelope 1 생성. audit log 까지 통합.

### GCS Registry

- gcloud configuration profile: `scopeball` (account: `sujini000522@gmail.com`)
- Project: `scopeball-registry-poc-g`
- Bucket: `gs://scopeball-registry-poc-g`
- Public URL: `https://storage.googleapis.com/scopeball-registry-poc-g/`
- CORS: `*` origin, GET. Public read (`allUsers:objectViewer`)
- `.env` (gitignored, `browser-extension/.env`): `REGISTRY_BASE_URL=https://storage.googleapis.com/scopeball-registry-poc-g`

대표 bundle_sha256:
- V2 swap: `0x9d54198599e1ced436bfbb458bf36aae4b3a01ba5a8bd885ab20f07c5a3f02f0`
- V3 exactInput: `0x5179a392335f745a2a915736205a3c8f1a05e76affbd618ee044b11cd33a0bd3`
- SR02 exactInput: `0x9d751636e3f605abe0e888733993327c245f02924388733673d0642bacb589be`
- V3 NFPM multicall: `0x53186d495e7f0afaacaae12a580430757d7141f4118f1337e2c391ee1b89b89e`
- UR.execute (multi-chain): `0xe00473a30f3e94c3a63e55ef5a330f775696b05f874b8db7f39b7050e8fb7b76`

### 한계 (Phase 7 향후)

1. **Declarative path observability-only** — Cedar verdict 는 여전히 static path 산출. envelopes equivalence (Phase 1A V2 swap test) 로 자연 일치. verdict-drive 위해 `plan_policy_rpc_with_envelopes_json` 같은 새 WASM entry 필요
2. **multicall_recurse WASM resolver wire-up 없음** — V3 NFPM tx 시 `ctx.resolver=None` → "map_failed" fault → static path fall-through
3. **EnumTaggedDispatch placeholder** — Balancer V2 등 향후
4. **Layer 2 LRU prefetch 미구현**
5. **HMAC IndexedDB key (§7.5) raw**
6. **host:token_metadata enrichment 없음** — AssetRef.symbol/decimals None

### PoC 결정 사항 (사용자 합의)

| 결정 | 내용 |
|---|---|
| 첫 Phase scope | V2 swapExactTokensForTokens 1 함수만 |
| 기존 V2/V3 mapper 처리 | namespace 분리 (`declarative.X` prefix) — coexist |
| MapContext refactor 시점 | Phase 4 (multicall_recurse 필요 시) |
| Registry 호스팅 | Phase 2 는 local dev server, Phase 6 후 GCS 정적 |

## 핵심 파일 paths

### Rust (`crates/`)

- `adapters/mappers/src/mapper.rs` — Mapper trait + MapContext (Phase 4 refactor)
- `adapters/mappers/src/declarative/` — DSL interpreter (Phase 0-5)
  - `types.rs` — AdapterFunctionBundle / EmitRule / ValueExpr / BuiltinFn (serde)
  - `mapper.rs` — DeclarativeMapper struct + impl Mapper
  - `single_emit.rs` — 5 category builder (swap / wrap / unwrap / transfer / permit)
  - `eval.rs` — ValueExpr evaluator + JsonPath walker
  - `builtin_fn.rs` — select_address, unfold_v3_path
  - `multicall.rs` — multicall_recurse (Phase 4)
  - `opcode_stream.rs` — opcode_stream_dispatch (Phase 5)
- `adapters/abi-resolver/src/subdecode/protocols/universal_router.rs` — UR `UNISWAP_UR_TABLE` + `UNISWAP_UR_ADDRESSES` (multi-chain)
- `policy-engine-wasm/src/declarative_exports.rs` — WASM `declarative_install_json` / `declarative_lookup_json` / `declarative_route_request_json` (Phase 6)
- `policy-engine-wasm/src/dto.rs` — DTOs

### TS (`browser-extension/`)

- `backend/service-worker/marketplace/`
  - `declarative-adapter-loader.ts` (Phase 1B) — mountDeclarativeBundle + ensureSeedBundlesInstalled + lookupMountedBundle
  - `installBundle.ts` (Phase 2B) — schema + sha256 verify
  - `jit-fetcher.ts` (Phase 2B) — resolveAdapter (Layer 1/2 + negative cache + JIT + inflight dedupe)
  - `negative-cache.ts` (Phase 2B) — TTL 분기
  - `declarative-decode.ts` (Phase 6) — viem decodeFunctionData
  - `declarative-route.ts` (Phase 6) — tryDeclarativeRoute
  - `bundle-schema.ts` (Phase 0) — parseBundle
- `backend/service-worker/registry/client.ts` (Phase 2B) — byCallKey
- `backend/service-worker/wasm-bridge.ts` — WASM helper
- `backend/service-worker/orchestrator.ts` — Phase 6 wiring (runLifecycle 안 tryDeclarativeRoute 호출)
- `public/seed-bundles/uniswap-v2-swapExactTokensForTokens@1.0.0.json` — Layer 1

### Registry (`registry/`)

- `manifests/<publisher>/<protocol>/<func>@<v>.json` (6 bundles)
- `index/by-callkey/<chain>__<to>__<sel>.json` (build output, 74 files)
- `scripts/build-index.ts` — RFC 8785 JCS canonicalize + SHA-256

### 수동 e2e test page

- `/tmp/scopeball-poc-test/index.html` (gitignored, 임시) — 3 button (V2 / V3 / UR Base)

## 개발 명령

```bash
# Rust 테스트
cargo test -p mappers declarative
cargo test --workspace                    # 회귀 확인

# WASM 빌드 (extension 빌드 prerequisite)
cargo build --target wasm32-unknown-unknown -p policy-engine-wasm
# 또는 wasm-pack 통합:
cd browser-extension && ../scripts/wasm-build.sh

# TS 테스트
cd browser-extension && npx vitest run
cd browser-extension && npx tsc --noEmit

# Extension 빌드 (Chrome)
cd browser-extension
node scripts/copy-default-policies.js     # default policies + seed bundles copy
../scripts/wasm-build.sh                  # WASM rebuild
TARGET_BROWSER=chrome npx webpack --config webpack/webpack.prod.js
# 빌드 산출물: browser-extension/dist/chrome/

# Registry build (index 재생성 + sha256)
cd registry
npm run build

# Registry GCS 업로드
gsutil -m rsync -r -d \
  -x 'node_modules|package-lock.json|package.json|scripts|.gitignore|README.md' \
  . gs://scopeball-registry-poc-g/

# Registry local server (테스트)
cd registry && python3 -m http.server 8000
```

## 수동 e2e 절차

1. **Registry 서버** (local 또는 GCS — `.env` 의 `REGISTRY_BASE_URL` 따라)
   - GCS: 이미 활성 (https://storage.googleapis.com/scopeball-registry-poc-g/)
   - local: `cd registry && python3 -m http.server 8000`
2. **Extension build + load**
   - `cd browser-extension && node scripts/... && webpack`
   - Chrome `chrome://extensions/` → Developer mode ON → "Load unpacked" → `dist/chrome`
3. **Test page**: `cd /tmp/scopeball-poc-test && python3 -m http.server 8080` → `http://localhost:8080/`
4. **Trigger**: Wallet connect → 3 button 중 클릭 → MetaMask popup → reject (gas 무료)
5. **확인**: Extension page → ScopeBall → "service worker" → DevTools Console
   - `[Scopeball] declarative-route` log 의 outcome (hit/miss/fault)
   - decoderId, source (layer1/jit)
   - envelopeCount

## gcloud 활용

- 활성 profile: `gcloud config configurations activate scopeball`
- 다른 audit 작업: `gcloud config configurations activate default` (UPSide audit account)
- bucket: `gsutil ls gs://scopeball-registry-poc-g/`
- billing: `gcloud billing projects describe scopeball-registry-poc-g`

## 출처

- Spec: `ScopeBall/ADAPTER_MARKETPLACE_ARCHITECTURE.md`
- Uniswap deploy-addresses: https://github.com/Uniswap/universal-router/tree/main/deploy-addresses
- RFC 8785 JSON Canonicalization Scheme: https://datatracker.ietf.org/doc/html/rfc8785
- ethers v6: https://docs.ethers.org/v6/
- viem: https://viem.sh/

## ScopeBall 작업 시 기억할 컨벤션

- **한국어** 출력 (기술 용어는 영어)
- **1차 공식 출처 기반** (EIP/ERC docs, GitHub spec). `## 출처` 목록 첨부
- **정직한 한계 인정** — 과장 금지
- **단계별 점진적** — 굵직한 라벨 유지, 다음 단계만 구체화
- **NEVER 단순 추측 — 사실 진술은 1차 출처 verify**
- `## 출처` 없으면 "출처 미확인" 명시
