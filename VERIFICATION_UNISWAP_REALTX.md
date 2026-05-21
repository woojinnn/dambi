# VERIFICATION — 실제 Uniswap Tx 기반 declarative 경로 검증

> Phase 7B "Uniswap 완벽 지원" 후속 검증. 측정일 2026-05-21.
> 실제 on-chain Uniswap 트랜잭션을 ScopeBall 의 production verdict 경로 (declarative / Tier A) 에 통과시켜 L0~L4 5단계로 검증.
> 하네스 `crates/integration-tests/tests/uniswap_real_tx.rs` · corpus `crates/integration-tests/data/golden/uniswap-real-tx/corpus.json`.

## 결론 — 42 tx 중 P1 1건 발견·수정, 39 pass / 3 정상 MISS

합성(synthetic) 단위 테스트는 abi_fragment 와 자기일관적이라 실제 calldata 의 edge 를 놓친다. 실제 tx 검증이 **registry 에 등재돼 있으나 declarative 경로에서 작동 불가한 죽은 manifest 1건 (V3 NFPM `collect`)** 을 발견했다 — Phase 7B 이전부터 잠재. 수정 완료.

| severity | finding | 상태 |
|---|---|---|
| **P1** | F1 — V3 NFPM `collect` 번들 2겹 manifest 버그 | **수정 완료** |
| P3 | F2 — native currency sentinel (`0x0`) → `erc20` 오표기 | 문서화 |
| P3 | F3 — UR `WRAP_ETH` recipient `ADDRESS_THIS`(`0x..02`) 미해석 | 문서화 |
| P2 | F4 — V2 ETH-input 함수 native input `amount.value` 누락 | 문서화 |
| P3 | F5 — V4 `modifyLiquidities` `outputTokens` 빈 배열 | 기문서화 (AUDIT_UNISWAP_PHASE7B §P3) |

## 검증 매트릭스 — L0~L4

production 라우팅 재현: 실제 tx `(chain_id, to, calldata)` → callkey → `registry/index/by-callkey/<callkey>.json`.

| 단계 | 검증 | 실패 의미 |
|---|---|---|
| L0 라우팅 | byCallKey 인덱스에 callkey 존재 | declarative MISS — static fallback |
| L1 디코딩 | `decode_with_json_abi(bundle.abi, calldata)` 성공 | abi_fragment 불일치 |
| L2 매핑 | `DeclarativeMapper::map` envelope ≥ 1 | silent drop / fault |
| L3 정합성 | action 종류 + 핵심 필드 + sentinel 오표기 없음 | 권한 표면 누락/오표기 |
| L4 lowering | `policy_request_from_envelope` → `Some` | fail-open |

## per-family 판정 (collect 수정 후)

| family | tx | 결과 |
|---|---|---|
| v2 | 7 | 7 pass |
| v3-swap-router (SR01) | 3 | 3 pass |
| swap-router-02 | 7 | 7 pass |
| v3-nfpm | 6 | 6 pass (collect 2건 수정 후 통과) |
| universal-router | 5 | 5 pass |
| permit2 | 8 | 8 pass (Phase 7B 신규 — approve / permit·transferFrom batch / permitWitnessTransferFrom 전부 통과) |
| v4 | 3 | 3 pass (initialize / modifyLiquidities / multicall) |
| excluded | 3 | 3 MISS — `unlock`·`lockdown`·`invalidateNonces` 전부 의도대로 미커버 |
| **계** | **42** | **39 full pass (L0~L4) / 3 정상 MISS** |

## Findings

### [P1 — 수정 완료] F1 — V3 NFPM `collect` 번들 2겹 manifest 버그

- **위치**: `registry/manifests/uniswap/v3/collect@1.0.0.json` + per-chain split 9개 = 10 manifest. 발견 tx: `0x4A3895FC...` (단독 collect), `0x9FD307BD...` (`multicall(decreaseLiquidity + collect)`).
- **버그 1 — emit 경로 불일치**: emit 이 `$.args.params.tokenId`·`$.args.params.recipient` (nested) 를 읽음. 그러나 `abi-resolver/src/bridge.rs:251` `decode_with_json_abi` → `convert_legacy_call` (`bridge.rs:68`) 이 단일 tuple 인자 `params` 를 **flatten** — 실제 경로는 `$.args.tokenId`·`$.args.recipient` (top-level). → `MapperError::MissingArgument`.
- **버그 2 — emit category 오류**: emit `category:"dex"`. 그러나 `claim_rewards` action 은 `misc` category — `Action::ClaimRewards` = `action/misc/claim_rewards.rs`, `single_emit.rs:137` = `("misc","claim_rewards")`. `("dex","claim_rewards")` arm 부재 → `MapperError::Unsupported`. (버그 1 을 고치자 이 단계가 드러남 — 2겹.)
- **영향**: production 에서 V3 NFPM `collect` tx 가 declarative L2 에서 fault → static fallback → collect static mapper 없음 → 무verdict → Pass. collect 의 fund recipient (수수료 수취 주소) 권한 표면이 정적분석되지 않음. registry 의 collect manifest 10개가 작동 불가 ("죽은 manifest"). fail-open 은 아님 (`MapperError` 를 orchestrator 가 fault/unsupported 로 인지) — 단 사용자 가시성 0.
- **수정**: 10 manifest emit 의 (1) `$.args.params.` → `$.args.`, (2) `category:"dex"` → `"misc"`. `npm run build` 로 collect 13 callkey 인덱스 갱신 (전체 1922 callkey 중 collect 만 변경 — 멱등 확인). 재검증 — collect 2 tx 모두 L0~L4 통과, envelope `misc/claim_rewards { source, nft(erc721), tokenId, from, recipient }` 정상 산출.

### [P3 — 문서화] F2 — native currency sentinel (`0x0`) → `erc20` 오표기

UR `TRANSFER` (`0xC1E0...` — token `0x0`), V4 `initialize`/`mint` (`0xE051...`/`0xF587...` — `PoolKey.currency0` `0x0`) 의 토큰이 native ETH 인데 envelope 가 `{kind:"erc20", address:"0x000…000"}`. UR/V4 컨벤션상 token/currency `0x0` = native (v4-core `Currency.sol`). envelope 는 정상 생성 (L2 pass), recipient/amount 정확 — token `kind` 만 오표기. manifest 가 `token.kind` 를 `{literal:"erc20"}` 로 하드코딩 — `0x0 ? native : erc20` conditional 표현 불가, DSL/Tier B 변경 필요. Phase 7B audit P2 (V4 swap recipient sentinel) 와 동류이나 audit 미포착. 별도 트랙.

### [P3 — 문서화] F3 — UR `WRAP_ETH` recipient `ADDRESS_THIS`(`0x..02`) 미해석

UR `execute` (`0x6D0A...`) 의 `wrap` envelope recipient 가 `0x000…002` (v4-periphery `ActionConstants.ADDRESS_THIS`) — raw sentinel literal 로 표기. resolve 시 "UR 컨트랙트 자신". wrap → 자기 자신이라 권한 표면은 약함. Phase 7B audit P2 가 V4 swap recipient sentinel 은 `common::map_recipient` 로 수정했으나 UR opcode-stream `wrap` step 은 미적용. 별도 트랙.

### [P2 — 문서화] F4 — V2 ETH-input 함수 native input `amount.value` 누락

`swapExactETHForTokens` (`0x9658...`), `addLiquidityETH` (`0xC990...`) 의 native input envelope 가 `amount:{kind:"exact"}` — `value` 누락. native input 수량 = `msg.value`. bundle emit 에 `inputToken.amount.value` 필드 자체가 없음 (함수 인자에 input amount 가 없고 `msg.value` 가 input). envelope 는 정상 생성·asset kind=native·recipient·output 정확 — input **수량**만 누락. `eval.rs:379` 가 `$.tx.value_wei` 를 지원하므로 bundle 에 `"inputToken.amount.value": {"from":"$.tx.value_wei"}` 한 줄 추가로 해결 가능. 단 `swapExactETHForTokens`/`swapETHForExactTokens`/`*SupportingFeeOnTransferTokens`/`addLiquidityETH` 등 ETH-input 함수군 전반 + per-chain split — 별도 트랙.

### [P3 — 기문서화] F5 — V4 `modifyLiquidities` `outputTokens` 빈 배열

V4 PositionManager `modifyLiquidities` (`0x2B0A...`) 의 `decrease_liquidity` envelope `outputTokens:[]`. V4 action stream 의 `TAKE`/`TAKE_PAIR` opcode 미emit — `AUDIT_UNISWAP_PHASE7B.md` §P3 (V4 PM settle/take/sweep under-report) 와 동일, 의도된 scope.

## 검증 수치

- corpus: **42 tx** — mainnet 36 + L2 Base 3 + Arbitrum 3, 8 family. 전부 실제 on-chain tx (tx_hash + explorer_url).
- 결과: **39 full pass (L0~L4) / 0 partial / 3 정상 MISS** (collect 수정 후).
- `cargo test -p policy-engine-integration-tests --test uniswap_real_tx`: **2 passed** (`harness_self_check` + `corpus_verification` — Phase 5 strict 회귀 가드).
- `cargo test --workspace`: **881 passed / 0 failed / 6 ignored** — baseline 879 + 신규 하네스 2 (regression 0). Rust mapper/abi-resolver 코드 무변경 → WASM 무영향 (rebuild 불요).
- registry: collect 13 callkey 인덱스 갱신, 전체 **1922 callkey** 유지 (collision 0).

## 영구 회귀 가드

`corpus_verification` 테스트를 strict assert 로 전환 — `expect=="pass"` 39 tx 가 L0~L4 전부 통과 + `expect=="excluded"` 3 tx 가 MISS 를 강제. 이후 mapper/manifest 변경이 declarative 경로를 회귀시키면 CI 에서 즉시 검출. corpus fixture 는 `data/golden/uniswap-real-tx/corpus.json` 에 영구 체크인.

## 출처

- corpus tx: Dune query 7551293 (mainnet `ethereum.transactions`) · 7551379 (`base`/`arbitrum.transactions`), `block_date >= 2026-04-01` (mainnet) / `2026-05-01` (L2). 각 tx 의 txhash + explorer_url 은 corpus.json 에 명시.
- 코드 1차 확인: `abi-resolver/src/bridge.rs:251` (`decode_with_json_abi`)·`:68` (tuple flatten) · `mappers/src/declarative/single_emit.rs:137` (`("misc","claim_rewards")`) · `policy-engine/src/action/misc/claim_rewards.rs` (`ClaimRewardsAction`) · `lowering/misc/claim_rewards.rs`·`lowering/dispatch.rs:140` · `mappers/src/declarative/eval.rs:379` (`$.tx.value_wei`).
- UR/V4 컨벤션: Uniswap v4-periphery `ActionConstants.sol` (`ADDRESS_THIS`) · v4-core `Currency.sol` (native `0x0`).
- 계획서: `~/.claude-web3/plans/scopeball-uniswap-zany-neumann.md`.
