# Examples — 그룹별 JSON 인스턴스 카탈로그

`action.schema.json` 검증을 통과하는 12개의 표본 인스턴스. 각 파일은 scopeball 어댑터가 실제로 emit 하는 `Action` 의 단일 변형을 손으로 직렬화한 것이며, npm 의 `validate:examples` 스크립트가 ajv 로 본 디렉터리 전체를 검증한다.

---

## Group A — Constant-product (V2-shape)

| 파일 | 어댑터 | 시나리오 |
|---|---|---|
| `group-a-constant-product/uniswap-v2-swap-exact-tokens-for-tokens.json` | uniswap-v2 | mainnet USDT(6dec) → WETH single-hop, 200 USDT, minOut=0 (zero-min-output 검출) |
| `group-a-constant-product/pancakeswap-amm-swap-exact-eth-for-tokens.json` | pancakeswap-amm | BSC native BNB → USDT(BSC, 18dec), 1 BNB, payable 케이스 |
| `group-a-constant-product/aerodrome-v1-route-multi-leg.json` | aerodrome-v1 | Base USDC → AERO(stable) → WETH(volatile), 2-leg `Route[]` (stable + volatile 혼합) |

## Group B — Concentrated-liquidity (V3-shape)

| 파일 | 어댑터 | 시나리오 |
|---|---|---|
| `group-b-concentrated-liquidity/uniswap-v3-exact-input-single.json` | uniswap-v3 | mainnet USDT → WETH single-hop, fee tier 3000 (30 bps), 1000 USDT |
| `group-b-concentrated-liquidity/uniswap-v3-with-host-enrichment.json` | uniswap-v3 | 위와 동일 swap 이지만 host enrichment 후 (`total_input_usd` / `window_stats` 등 채워진 상태). DecimalString4 패턴 검증 목적 |
| `group-b-concentrated-liquidity/pancakeswap-v3-multicall-merge.json` | pancakeswap-v3 | BSC USDT/WBNB multicall — 25 bps + 100 bps 두 leaf 머지 (merge_dex_actions 결과) |
| `group-b-concentrated-liquidity/aerodrome-slipstream-tickspacing.json` | aerodrome-slipstream | Base USDC → WETH single-hop, tickSpacing=200 (`max_fee_bps: null` 케이스) |

## Group C — StableSwap

| 파일 | 어댑터 | 시나리오 |
|---|---|---|
| `group-c-stableswap/pancakeswap-stableswap-exchange.json` | pancakeswap-stableswap | BSC USDT(i=0) ↔ USDC(j=1), 100 USDT, recipient 미존재 (`has_external_recipient: false`) |

## Group D — Meta router

| 파일 | 어댑터 | 시나리오 |
|---|---|---|
| `group-d-meta-router/universal-router-v3-swap.json` | universal-router | mainnet UR `execute` → V3_SWAP_EXACT_IN sub-command 1건 머지된 결과 |

## Group E — Signature

| 파일 | 어댑터 | 시나리오 |
|---|---|---|
| `group-e-signature/permit2-permit-single.json` | permit2 | USDC 단일 토큰 PermitSingle |
| `group-e-signature/permit2-permit-batch.json` | permit2 | USDC + USDT 두 토큰 PermitBatch (approvals 배열 길이 2) |
| `group-e-signature/eip2612-permit.json` | eip2612 | USDC 직접 EIP-2612 Permit |

---

## 작성 규약

- 모든 인스턴스 파일은 단일 `Action` 변형 ({"dex": {...}} / {"permit2": {...}} 등) 으로 시작.
- Address 는 lowercase 0x prefix 강제 (`core.schema.json::Address` 패턴).
- DexFacts 11 필드 모두 명시 (host enrichment 미반영 케이스는 해당 필드를 `null` 로 explicit 채움).
- DecimalString4 (`UsdValuation.value`, `WindowStatsContext.swap_volume_usd_24h`) 는 4-소수점 (`"1000.0000"`).
- Permit2Action 17 필드 모두 명시.

## 검증

```bash
cd policy-schema/json
npm run validate:examples
# 또는 직접:
npx --yes -p ajv-cli@5.0.0 ajv validate \
  --spec=draft2020 \
  -s action.schema.json \
  -r 'core.schema.json' -r 'dex-facts.schema.json' \
  -r 'actions/dex.schema.json' -r 'actions/other.schema.json' \
  -r 'actions/permit2.schema.json' -r 'actions/eip2612.schema.json' \
  -r 'actions/eip712-other.schema.json' \
  -d 'examples/**/*.json'
```

모든 파일이 `valid` 출력해야 함.

## 새 예제 추가

1. 적절한 `group-{x}-*/` 디렉터리 선택 (필요 시 신규 그룹 디렉터리 생성).
2. 파일명: `<protocol>-<scenario-키워드>.json`.
3. 내용: 단일 Action 변형. DexFacts/Permit2Action/Eip2612Action 의 모든 required 필드 채움 (null 도 명시).
4. 본 README 의 그룹별 표에 한 줄 추가.
5. `npm run validate:examples` 통과 확인.
