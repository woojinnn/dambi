# ScopeBall — scopeball repo project memory

> 본 파일은 Claude Code 가 cwd / git root 의 CLAUDE.md 로 자동 로드.
> 새 session 시작 시 본 내용 그대로 컨텍스트 inject.
> 상위 `ScopeBall/CLAUDE.md` (parent — security researcher profile + 프레임워크/정책 아키텍처 다이어그램) + 본 file 합쳐서 컨텍스트 구성.

## Overview

- **ScopeBall** = pre-sign permission scope analyzer (browser extension, pocket-universe-style). 시뮬레이션 없이 calldata / signature 정적분석으로 EVM 권한 위임을 서명 직전 평가.
- **본 repo** (`scopeball/`): Rust workspace (10 crate) + TS browser-extension + registry + registry-api + policy-rpc + schema 의 monorepo.
- **Spec docs** (`ScopeBall/` parent, git 외 위치): `ADAPTER_MARKETPLACE_ARCHITECTURE.md` (1162 줄 PoC spec), `BROWSER_EXTENSION.md`, `RUST_CORE.md`, `SERVER_COMPONENTS.md`, `ScopeBall.md`, `swap-intent-flow.md`

## 시스템 아키텍처 — monorepo component map

### 정적/동적 분리 — Tier A / Tier B (spec §2)

디코딩 표면은 2 tier 로 나뉜다.

| Tier | 구성 | 확장 방식 |
|---|---|---|
| **Tier A — Declarative** | JSON DSL 번들 (match + abi + emit rule), registry 에서 fetch — 동적 | 마켓플레이스 publish (코드 수정 X) |
| **Tier B — Imperative** | Rust 코드 (UR opcode dispatcher, V3 packed parser, enum-tagged dispatcher 등), WASM 정적 임베드 | 익스텐션 release PR |

- **Tier A** = `mappers/src/declarative/` DSL interpreter + `registry/` bundle JSON. 표준 ABI + emit rule 을 데이터로 표현.
- **Tier B** = `abi-resolver/src/subdecode/`. 비표준 디코딩 (packed / opcode stream / enum userData / 재귀) 의 imperative 로직. publisher 임의 주입 차단 위해 inner ABI 의 **단일 진실**을 Tier B 가 보유. 내부도 "기계(`opcode_stream`·`enum_tagged`·`recurse`.rs generic engine) + 데이터(`protocols/*.rs` table)" 로 분리.
- Tier A 의 4 strategy 중 `opcode_stream_dispatch`·`enum_tagged_dispatch`·`multicall_recurse` 는 `dispatcher_id`/`recurse_rule_id` 로 Tier B engine 을 호출. `single_emit` 만 거의 독립.
- DSL `WhitelistedFn` = `BuiltinFn` (interpreter 내장 — select_address/div/concat_bytes 등) ∪ `TierBBackedFn` (Tier B 정적 함수 wrapper — `unfold_v3_path` 등, 새 추가 = release PR).

> **새 protocol 추가 절차** → `docs/TIER_AB_PLAYBOOK.md` — Tier A/B 통합 방법론 (6-phase + sub-agent 워크플로 + 템플릿).

### `crates/` — Rust workspace (10 멤버, `Cargo.toml`)

| Crate | 책임 |
|---|---|
| `policy-engine` | Cedar 평가 코어. `action/` (40+ Action variant, 5 category) → `lowering/` (ActionEnvelope→PolicyRequest) → `policy/` (Cedar wrapper, Verdict). `schema/` cedarschema 합성, `policy_rpc/` manifest plan/materialize |
| `policy-engine-wasm` | JS↔Rust WASM 경계. `exports.rs` 9 export + `declarative_exports.rs` 3 export + `dto.rs`. 입력 4 MiB cap |
| `adapters/abi-resolver` | calldata decode. Sourcify→SQLite→openchain 3-tier 시그니처 lookup. `subdecode/protocols/` (universal_router, v4_router, uniswap_v3, curve, balancer_v2, safe_multisend, pancake_ur/infinity) |
| `adapters/sign-resolver` | EIP-712 / 서명 RPC 파싱 (6 method). `adapters/` permit2 · eip2612 · lending_auth |
| `adapters/request-router` | RPC method 라우팅 — sign / write 분기 |
| `adapters/mappers` | decoded calldata → `ActionEnvelope`. `Mapper` trait + `MapContext`. 정적 mapper (`protocols/` erc20·uniswap_v2·uniswap_v3·swap_router_02·weth·universal_router) + declarative DSL interpreter (`declarative/`) |
| `policy-builder` + `policy-builder-wasm` | `PolicyRule` → Cedar 텍스트 컴파일러 + WASM 브리지 |
| `integration-tests` | E2E 파이프라인 + golden regression (`data/golden/`) |
| `adapter-debug-dashboard` | abi-resolver/mappers/request-router 출력 시각화 dev/debug 도구 (Rust HTTP API + React) |

### declarative DSL interpreter — `crates/adapters/mappers/src/declarative/`

vendor-published adapter bundle 를 해석하는 Tier A interpreter. 4 dispatch strategy:
- `single_emit.rs` — calldata 1개 → ActionEnvelope 1개 (swap/wrap/transfer/liquidity/lending/staking/voting builder)
- `opcode_stream.rs` — opcode stream dispatch (Uniswap Universal Router command stream)
- `multicall.rs` — multicall `bytes[]` 재귀 분해 (`multicall_recurse`)
- `enum_tagged.rs` — enum-tagged `bytes` dispatch (Curve / Balancer)

보조: `types.rs` (AdapterFunctionBundle / EmitRule / ValueExpr / BuiltinFn), `eval.rs` (ValueExpr evaluator + JSON path), `builtin_fn.rs` (unfold_v3_path / curve_route_last_token / unfold_slipstream_path 등), `mapper.rs` (DeclarativeMapper).

### 인프라 / 비-Rust component

- **`browser-extension/`** — Chrome MV3 익스텐션 (TS). `backend/{injected,content-scripts,service-worker}`, `frontend/{confirm,popup}`, `dashboard/` SPA, `sdk/`. service-worker `marketplace/` 가 declarative adapter 로딩 담당.
- **`registry/`** — declarative adapter bundle 레지스트리. `manifests/<publisher>/<protocol>/<func>@<v>.json` + `index/by-callkey/<chain>__<to>__<sel>.json` + `tokens/<chainId>/`. `scripts/build-index.ts` 가 RFC 8785 JCS + SHA-256.
- **`registry-api/`** — private GCS 버킷 caching reverse-proxy (Node 20 + TS, Cloud Run). path 검증 + LRU+TTL 캐시 + per-IP rate-limiter + 404 passthrough.
- **`policy-rpc/`** — remote policy fact 서버 (TS reference). `/v1/rpc`, method: `oracle.usd_value` (CoinGecko) / `mock-host-capabilities` / `registry`.
- **`schema/`** — `action-schema/` (32 action JSON Schema, 자체 CLAUDE.md 보유) + `policy-schema/` (Cedar schema 조각).

> vestigial (component 아님): `crates/web-server/` (빈 husk 잔재 — `adapter-debug-dashboard` 로 rename), `web/policy-builder/` (drop된 dev infra).

## E2E 평가 플로우 — 서명 직전 분석 파이프라인

```
dApp 페이지
  → injected proxy (backend/injected/proxy-injected-providers.ts)
       eth_sendTransaction / eth_signTypedData_v4 / personal_sign 가로챔
  → content-script (backend/content-scripts/window-ethereum-messages.ts)
       chrome.runtime port (Identifier.CONTENT_SCRIPT) 로 SW 연결
  → service-worker index.ts
       boot: detectPendingMigrations → ensureDefaultPoliciesInstalled
             → ensureSeedBundlesInstalled → hydrateManifests
       handleMessage → decideMessage → withActorLock → decideInner
             → runLifecycle (HARD_TIMEOUT 8s)
       │
       ├ untyped sig  → warn early return (__engine::unsupported_untyped_signature)
       ├ transaction  → tryDeclarativeRoute (marketplace/declarative-route.ts)
       │   1. extractSelector → CallMatchKey{chain_id,to,selector}
       │   2. resolveAdapter (jit-fetcher.ts):
       │        Layer 1 mounted (declarative-adapter-loader)
       │        → negative cache → Layer 2 adapterCache (chrome.storage, SW restart 생존)
       │        → Layer 3 JIT: registry byCallKey + installBundle (RFC8785 JCS+sha256) + inflight dedupe
       │   3. WASM declarative_route_request_json — calldata 를 WASM 내부에서
       │        bundle abi_fragment 로 decode → DeclarativeMapper DSL → ActionEnvelope[]
       │   4. enrichEnvelopeAssets — TokenRegistryClient 로 AssetRef symbol/decimals 보강
       │
       ├ declarative hit + envelopes>0
       │   → evaluateWithEnvelopes (WASM evaluate_with_envelopes_json)
       │   → lowering → Cedar PolicyEngine → Verdict   [verdictSource="declarative"]
       └ miss / fault / typed-sig
           → evaluateWithPolicyRpc (static fallback)   [verdictSource="static"]
  → verdict 처리: fail = informational popup / warn = confirm modal await / pass = auto
  → audit log append
```

- **WASM exports** — `exports.rs`: `install_policies_json` · `route_request_json` · `evaluate_with_envelopes_json` · `evaluate_policy_rpc_json` · `plan_policy_rpc_json` · `preview_schema_json` · `preview_installed_schema_json` · `preview_custom_schema_json` · `get_alias_table_json`. `declarative_exports.rs`: `declarative_install_json` · `declarative_lookup_json` · `declarative_route_request_json`.
- declarative path 는 **verdict driver** (Phase 7F) — 옛 observability-only 아님. static path 는 declarative miss/fault fallback.
- registry calldata decode 는 **WASM 내부**에서 수행 (TS-side viem decode 제거됨). `declarative-decode.ts` 는 selector 추출 + route input 빌더만.

## 현재 상태

- **Branch**: `feat/registry-server` / **HEAD `d6bfbb3`** / origin/main 대비 **42 commit**
- declarative adapter marketplace PoC — `ADAPTER_MARKETPLACE_ARCHITECTURE.md` (1162 줄 spec) 의 구현.

### Protocol coverage

| Protocol | 범위 |
|---|---|
| Uniswap (base) | V2 + V3 + SwapRouter02 + Universal Router + V3 NFPM multicall |
| Curve (Phase 12) | Stableswap V1/V2/NG + Router NG + crvUSD Controller + veCRV + Gauge. `enum_tagged_dispatch` 활성, `curve_route_last_token` BuiltinFn |
| Aerodrome (Phase 8, Base 8453) | V2 Router + Slipstream SwapRouter/NPM + Voter + VotingEscrow + Gauge. `unfold_slipstream_path` BuiltinFn, 6 신규 Misc Action (GaugeVote/LpStake/LpUnstake/LockCreate/LockIncrease/LockManage) |

### 주요 이정표 (origin/main merge 이후)

- **origin/main merge** — dashboard SPA + manifest-driven custom context + D9 SystemFail model 통합. 자세한 내용 `MERGE_CONFLICT_LOG.md`
- **registry-api private 이전** — public GCS 정적 호스팅 → private Seoul 버킷 + Cloud Run reverse-proxy
- **Layer 2 persistent adapter cache** — `marketplace/adapter-cache.ts` (chrome.storage, SW restart 생존)
- **WASM 내부 calldata decode** — TS decode 제거, `declarative_route_request_json` 가 bundle ABI 로 내부 decode

### Security audit

2 차례 audit 수행 — Phase 8 Aerodrome (`AUDIT_PHASE8.md`) + Phase 12 Curve (`AUDIT-PHASE12-CURVE.md`). P0/P1 fix 적용 완료. 상세는 두 문서 참조.

### PoC 결정 사항 (사용자 합의)

| 결정 | 내용 |
|---|---|
| 첫 Phase scope | V2 swapExactTokensForTokens 1 함수만 시작 |
| 기존 V2/V3 정적 mapper 처리 | namespace 분리 (`declarative.X` prefix) — coexist |
| Registry 호스팅 | Phase 6 후 GCS 정적 → 이후 private Seoul 버킷 + Cloud Run proxy |

## Registry 인프라 + GCP

### Registry 콘텐츠 (`registry/`)

- `manifests/` — 208 manifest (aerodrome 54 / curve 105 / uniswap 49)
- `index/by-callkey/` — 693 callkey (`npm run build` 산출물, git-tracked)
- `tokens/<chainId>/` — 13 chain ERC-20 metadata (1, 10, 56, 130, 137, 480, 8453, 42161, 42220, 43114, 57073, 7777777, 81457)

### GCP private cloud (account `sujini000522@gmail.com`)

- **Project**: `scopeball-registry-poc-g` (#891268973493, "ScopeBall Registry PoC")
- **Cloud Run `registry-api`** @ `asia-northeast3` (Seoul):
  - URL `https://registry-api-ynpd3bfgpa-du.a.run.app` (`.env` 의 `REGISTRY_BASE_URL`) — canonical alias `registry-api-891268973493.asia-northeast3.run.app`
  - image `asia-northeast3-docker.pkg.dev/scopeball-registry-poc-g/scopeball/registry-api:v1`
  - maxScale 3 · containerConcurrency 80 · CPU 1 / 256Mi · SA `registry-api-sa@scopeball-registry-poc-g.iam.gserviceaccount.com`
  - env: `REGISTRY_BUCKET=scopeball-registry-seoul`, `CACHE_TTL_MS=300000`, `CACHE_NEGATIVE_TTL_MS=60000`, `RATE_LIMIT_BURST=60`, `RATE_LIMIT_REFILL_PER_SEC=10`
  - routes: `GET /health` · `/debug/recent` · `/index/by-callkey/<key>.json` · `/tokens/<chain>/<addr>.json` · `/v1/registry/by-callkey?chain_id&to&selector`
- **Storage buckets**:
  - `scopeball-registry-seoul` — 활성 private (asia-northeast3, public-access-prevention enforced + UBLA + versioning, `registry-api-sa` 만 objectViewer)
  - `scopeball-registry-poc-g` — 구 public 버킷 (us-central1, `allUsers` objectViewer 아직 존재 — **legacy**, lock-down 미완)
- **Artifact Registry** `scopeball` (DOCKER, asia-northeast3) — image `registry-api:v1` 1개
- **보안 구조**: public client(extension) → public Cloud Run(`allUsers` invoker) → private 버킷(SA-only). 익스텐션은 private 버킷을 직접 못 읽음 — proxy 가 SA 자격으로 중계. maxScale 3 + per-IP token-bucket = denial-of-wallet chokepoint.

### gcloud 활용

- 활성 profile: `gcloud config configurations activate scopeball` (account `sujini000522@gmail.com`)
- 다른 audit 작업: `gcloud config configurations activate default` (UPSide audit account)
- billing: `gcloud billing projects describe scopeball-registry-poc-g`

### 대표 bundle_sha256 (RFC 8785 JCS + SHA-256)

- V2 swapExactTokensForTokens@1.0.0: `0x9d54198599e1ced436bfbb458bf36aae4b3a01ba5a8bd885ab20f07c5a3f02f0`
- V3 exactInput@1.0.0: `0x5179a392335f745a2a915736205a3c8f1a05e76affbd618ee044b11cd33a0bd3`
- SR02 exactInput@1.0.0: `0x9d751636e3f605abe0e888733993327c245f02924388733673d0642bacb589be`
- V3 NFPM multicall@1.0.0: `0x53186d495e7f0afaacaae12a580430757d7141f4118f1337e2c391ee1b89b89e`
- UR.execute (multi-chain)@1.0.0: `0xe00473a30f3e94c3a63e55ef5a330f775696b05f874b8db7f39b7050e8fb7b76`

## 핵심 파일 paths

### Rust (`crates/`)

- `policy-engine/src/{action,lowering,policy,schema,policy_rpc}/` — Cedar 평가 코어
- `policy-engine-wasm/src/{exports.rs,declarative_exports.rs,dto.rs}` — WASM 경계
- `adapters/mappers/src/mapper.rs` — Mapper trait + MapContext
- `adapters/mappers/src/declarative/` — DSL interpreter (types/mapper/single_emit/eval/builtin_fn/multicall/opcode_stream/enum_tagged)
- `adapters/abi-resolver/src/subdecode/protocols/universal_router.rs` — UR command/address table (multi-chain)
- `policy-builder/src/` — PolicyRule → Cedar 컴파일러

### TS (`browser-extension/`)

- `backend/injected/proxy-injected-providers.ts` — provider proxy
- `backend/content-scripts/window-ethereum-messages.ts` — SW 연결
- `backend/service-worker/index.ts` — boot sequence + listener
- `backend/service-worker/orchestrator.ts` — `runLifecycle` (declarative + static path)
- `backend/service-worker/marketplace/`
  - `declarative-route.ts` — `tryDeclarativeRoute` + `enrichEnvelopeAssets`
  - `jit-fetcher.ts` — `resolveAdapter` (Layer 1/2/3 + negative cache + inflight dedupe)
  - `adapter-cache.ts` — Layer 2 persistent cache (chrome.storage)
  - `declarative-adapter-loader.ts` — bundle mount + seed bundles
  - `installBundle.ts` — schema + sha256 verify
  - `declarative-decode.ts` — selector 추출 + route input 빌더
  - `negative-cache.ts` — TTL 분기
- `backend/service-worker/registry/{client.ts,token-client.ts}` — registry / token fetch
- `backend/service-worker/wasm-bridge.ts` — WASM helper

### Registry / Infra

- `registry/manifests/{uniswap,curve,aerodrome}/` + `registry/index/by-callkey/` + `registry/tokens/<chainId>/`
- `registry/scripts/build-index.ts` — JCS canonicalize + SHA-256
- `registry-api/src/{server.ts,gcs-client.ts,cache.ts,rate-limiter.ts,validation.ts,config.ts}`
- `policy-rpc/src/{server.ts,methods/}` — methods: oracle-usd-value / mock-host-capabilities / registry
- `public/seed-bundles/uniswap-v2-swapExactTokensForTokens@1.0.0.json` — Layer 1 seed (현재 1개)

## 개발 명령

```bash
# Rust 테스트
cargo test -p mappers declarative
cargo test --workspace                    # 회귀 확인 (현재 836/0/6)

# WASM 빌드 (extension 빌드 prerequisite)
cargo build --target wasm32-unknown-unknown -p policy-engine-wasm
./scripts/wasm-build.sh                    # wasm-pack 통합 빌드

# Extension 빌드 (Chrome) — yarn 4.14.1 vendored, packageManager
cd browser-extension
REGISTRY_BASE_URL=https://registry-api-ynpd3bfgpa-du.a.run.app \
  node .yarn/releases/yarn-4.14.1.cjs build:chrome
# build:chrome = prepare:defaults (copy-default-policies/manifests) + prepare:wasm + webpack prod
# 산출물: browser-extension/dist/chrome/
# ⚠️ REGISTRY_BASE_URL 는 env var 로 export 해야 함 — webpack.prod.js 가드가 process.env 를 읽음

# TS 테스트
cd browser-extension && node .yarn/releases/yarn-4.14.1.cjs test    # vitest
cd browser-extension && node .yarn/releases/yarn-4.14.1.cjs typecheck

# Registry build (index 재생성 + sha256)
cd registry && npm run build               # tsx scripts/build-index.ts

# Registry 재배포 — private Seoul 버킷 (gsutil 은 macOS hang → gcloud storage 사용)
gcloud config configurations activate scopeball
gcloud storage cp registry/index/by-callkey/<changed>.json gs://scopeball-registry-seoul/index/by-callkey/

# Registry local server (테스트용)
cd registry && python3 -m http.server 8000
```

> 빌드 스크립트: `scripts/{wasm-build.sh,wasm-build-dashboard.sh,test-all.sh,lint.sh,serve.sh}`. CI: `.github/workflows/ci.yml`.
> registry-api / policy-rpc 는 자체 `npm install` 필요 (이 repo 의 yarn workspace 와 분리). policy-rpc 의 `test`/`build` 스크립트는 `../extension/` 경로를 참조 — 실제 디렉토리는 `browser-extension/` 이므로 경로 stale (실행 전 확인 필요).

## 수동 e2e 절차

1. **Registry** — Cloud Run `registry-api` 이미 활성 (`.env` 의 `REGISTRY_BASE_URL`). 로컬 테스트는 `cd registry && python3 -m http.server 8000`.
2. **Extension build + load** — `cd browser-extension && ... build:chrome` → Chrome `chrome://extensions/` → Developer mode ON → "Load unpacked" → `dist/chrome`
3. **Test page** — `cd /tmp/scopeball-poc-test && python3 -m http.server 8080` (gitignored 임시 페이지)
4. **Trigger** — Wallet connect → 버튼 클릭 → MetaMask popup → reject (gas 무료)
5. **확인** — Extension page → "service worker" → DevTools Console: `[Scopeball] declarative-route` log 의 outcome (hit/miss/fault), decoderId, source (layer1/layer2/jit), envelopeCount

## 한계 / 향후 작업

**해소됨**: Layer 2 persistent cache · WASM 내부 calldata decode · declarative path = verdict driver · `enum_tagged_dispatch` (Curve) · host:token_metadata enrichment (adapter layer 책임).

**잔존**:
1. `multicall_recurse` WASM resolver wire-up 미완 — V3 NFPM 류 재귀 tx 는 static path fall-through
2. HMAC IndexedDB key (spec §7.5) — 현재 raw key
3. D3 Chrome 수동 e2e — `dist/chrome` load → tx trigger → SW console verdict 확인
4. registry 콘텐츠 reconcile (로컬 rework)
5. registry-api thundering-herd — 캐시에 single-flight 없음, rate-limit 가 전체 bound
6. 구 public 버킷 `scopeball-registry-poc-g` lock-down 미완 (legacy)

## 검증 결과 (HEAD `d6bfbb3`, 2026-05-21 측정)

- `cargo test --workspace`: **836 passed / 0 failed / 6 ignored**
- `vitest` (browser-extension core — service-worker/marketplace/registry): **302 passed**
- WASM: **5,806,871 bytes (5.54 MiB)** — `policy_engine_wasm_bg.wasm`, plan §9 6 MiB 예산 내
- 미측정 (이 환경 deps 미설치): dashboard SPA vitest 8 file (`@testing-library/react` 미설치), `registry-api` test (node_modules 미설치 — 과거 35/35), `policy-rpc` test (deps + 경로 stale). `npm install` / `yarn install` 후 측정 필요.

## 출처

- Spec: `ScopeBall/ADAPTER_MARKETPLACE_ARCHITECTURE.md`
- Uniswap deploy-addresses: https://github.com/Uniswap/universal-router/tree/main/deploy-addresses
- RFC 8785 JSON Canonicalization Scheme: https://datatracker.ietf.org/doc/html/rfc8785
- viem: https://viem.sh/ · ethers v6: https://docs.ethers.org/v6/

## ScopeBall 작업 시 기억할 컨벤션

- **한국어** 출력 (기술 용어는 영어). 짧고 명확한 단문 — "의 의 의" filler chain 금지.
- **1차 공식 출처 기반** (EIP/ERC docs, GitHub spec). `## 출처` 목록 첨부.
- **정직한 한계 인정** — 과장 금지. 사용자 제안/우려에도 동조 대신 냉정한 정량 평가.
- **단계별 점진적** — 굵직한 라벨 유지, 다음 단계만 구체화.
- **NEVER 단순 추측** — 사실 진술은 1차 출처 verify. `## 출처` 없으면 "출처 미확인" 명시.
- 모든 작업 (리서치 / 정책 설계 / 의사결정) 에 **sequential-thinking** MCP 사용.
