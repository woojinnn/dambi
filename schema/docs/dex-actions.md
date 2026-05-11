# swap / add_liquidity / remove_liquidity Action 가이드

본 문서는 DEX 맥락에서 가장 자주 등장하는 3 가지 action — `swap`, `add_liquidity`, `remove_liquidity` — 의 schema 를 사용자/정책 작성자 관점에서 풀어 설명합니다. 처음 보는 분도 술술 읽힐 수 있게 작성했습니다.

---

## 0. 시작하기 전에 — action 과 category 는 직교 차원

**중요한 design 변경**: v1.0.1 에서는 action 이 category 에 종속되지 않습니다. swap/add_liquidity/remove_liquidity 가 무조건 `category=dex` 인 것은 *아님* — DEX 외 다른 category 에서도 같은 의미 단위가 등장합니다:

| action | 가장 흔한 category | 다른 category 에 등장하는 케이스 |
|---|---|---|
| `swap` | `dex` (Uniswap/Curve/Balancer/...) | `liquid_staking` (Lido stETH ↔ wstETH conversion), `rwa` (LBTC ↔ WBTC 1:1 minting), `lending` (일부 lending protocol 의 collateral swap routing) |
| `add_liquidity` | `dex` (모든 DEX 의 LP 발행) | `yield` (Pendle SY 발행, vault deposit), `rwa` (일부 issuer 의 pooled redemption) |
| `remove_liquidity` | `dex` (모든 DEX 의 LP 소각) | `yield` (vault withdraw, Pendle redeem) |

즉 본 문서는 *세 action 의 schema 정의* 를 다루고, 실제 발생 맥락 (어느 category 인가) 은 root level 에서 결정됩니다. 정책은 `action=swap and category=dex` 같은 결합 분기로 DEX swap 만 별도로 다룰 수 있습니다.

---

## 1. 세 action 의 공통 성격 (어떤 DEX 든 적용)

사용자가 DEX 에서 보통 하는 3 가지 의미적 동작:

1. **swap** — 토큰 A 를 토큰 B 로 교환
2. **add_liquidity** — pool 에 자산을 예치 (LP 토큰 / Position NFT 수령)
3. **remove_liquidity** — pool 에서 자산을 인출

이 3 가지 의미는 **모든 DEX 에서 공통** 입니다. Uniswap V2/V3/V4, PancakeSwap V2/V3/Infinity, Balancer, Curve, Aerodrome, SushiSwap, Maverick, Trader Joe — 컨트랙트 구조는 천차만별이지만 *사용자가 하려는 것* 은 위 3 가지 중 하나로 매핑됩니다.

본 schema 는 그 의미 단위를 통합 표면으로 노출합니다. 어느 DEX 인지는 `root.protocol` 에서 식별되고, action 자체는 **protocol-agnostic + category-agnostic** 입니다.

---

## 1. AmountConstraint 다시 한 번

DEX action 의 거의 모든 amount 가 이 wrapper 를 씁니다:

```jsonc
{ "kind": "exact"|"min"|"max"|"unlimited"|"estimated"|"unknown", "value": "1000000" }
```

| kind | DEX 에서의 흔한 등장 |
|---|---|
| `exact` | exact_in swap 의 amountIn, exact_out 의 amountOut, Curve add_liquidity 의 amounts[N], V2 removeLiquidity 의 liquidity |
| `min` | swap 의 amountOutMin (슬리피지 하한), add_liquidity 의 amountMin pair, remove 의 minAmountsOut |
| `max` | exact_out swap 의 amountInMax, Balancer joinPool 의 maxAmountsIn, remove_liquidity_imbalance 의 max_burn_amount |
| `estimated` | V2 addLiquidity 의 amountDesired (라우터가 quote 한 추정치) |
| `unknown` | V4 PoolManager.swap 처럼 minOutput 보장이 calldata 에 없는 경우 |
| `unlimited` | DEX 에서 거의 안 쓰임 (approve 에서 주로) |

---

## 2. `swap` — 토큰 교환

### 2.1 어떤 함수들이 이걸 트리거하나

매우 다양 — 본 schema 가 이걸 1 개로 통합한 가치가 가장 큽니다.

| Protocol | 대표 함수 |
|---|---|
| Uniswap V2 (+ Pancake V2) | `swapExactTokensForTokens` / `swapTokensForExactTokens` / `swapExactETHForTokens` 등 9 변형 |
| Uniswap V3 SwapRouter / SwapRouter02 | `exactInputSingle` / `exactInput` / `exactOutputSingle` / `exactOutput` (deadline 변형 포함 8개) |
| Uniswap V4 | `PoolManager.swap` + V4Router opcode 0x06~0x09 |
| Uniswap UR | execute 의 opcode `0x00` (V3_SWAP_EXACT_IN), `0x08` (V2_SWAP_EXACT_IN), `0x10` (V4_SWAP) 등 |
| Balancer V2 | `Vault.swap` (single), `Vault.batchSwap` |
| Curve | `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)`, `exchange_underlying`, `exchange_received`, CurveRouter.exchange |
| Aerodrome / Sushi / Maverick / Trader Joe LB | 각자의 swap 함수들 |
| Pancake SmartRouter | `exactInputSingle`, `exactInputStableSwap`, `swapExactTokensForTokens` 등 V3+V2+Stable 통합 |
| Pancake Infinity | `cl.swap`, `bin.swap` (V4 fork) |

→ **약 50+ 컨트랙트 함수가 모두 본 schema 하나로** 정규화됩니다.

### 2.2 필드

```jsonc
{
  "_kind":      "swap",
  "mode":       "exact_in",                                          // 또는 "exact_out" / "unknown"
  "tokenIn":    { "kind": "erc20", "address": "0xA0b8…", "symbol": "USDC", "decimals": 6 },
  "tokenOut":   { "kind": "erc20", "address": "0xC02a…", "symbol": "WETH", "decimals": 18 },
  "amountIn":   { "kind": "exact", "value": "1000000000" },          // 1,000 USDC
  "amountOut":  { "kind": "min",   "value": "300000000000000000" },  // 최소 0.3 WETH
  "recipient":  "0xUser…",
  "slippageBps": 50,                                                  // 0.5%
  "validity": {                                                       // ← 통합 만료 필드
    "expiresAt": "1715961834",
    "expiresInSeconds": 600,                                          // 10 분
    "source": "tx-deadline"
  },
  "feeBps":     5                                                     // V3 0.05% pool
}
```

| 필드 | 정책 관점 |
|---|---|
| **`mode`** | exact_in vs exact_out. 정책 "exact_out 차단" 같은 분기 — exact_out 은 amountIn 이 max 라 예측 어려움 |
| **`tokenIn` / `tokenOut`** | 가장 흔한 정책 분기 자리. "USDC 와 WETH 만 허용" / "no MEV bait tokens" / "stablecoin → stablecoin 만" |
| `amountIn` / `amountOut` | mode 와 함께 보면 의미 명확 |
| **`recipient`** | swap 결과 수령자. **`root.from` 과 다르면 phishing 1차 신호.** 정책 강력 권장: `recipient == root.from` |
| **`slippageBps`** | 슬리피지 허용. 정책 "max 3% (300 bps)" — sandwich attack 방지 |
| `validity` | `source="tx-deadline"` — tx 가 이 시점 전에 mining 되어야 함. 정책 "60s ≤ expiresInSeconds ≤ 1 hour" — 너무 짧으면 racing, 너무 길면 stale. V4 PoolManager.swap 등 deadline 없는 함수는 omit |
| `feeBps` | pool 의 swap fee. "0.30% (30 bps) 이상 pool 차단" 같은 분기 (low-fee blue chip 만 허용) |

> **USD 환산값은 schema 표면에 없습니다.** Oracle 데이터는 schema 인스턴스가 만들어진 *이후* 별도 enrichment 단계에서 attach 됩니다. "단일 swap < $10,000", "value loss > 5% 차단" 같은 USD 기반 정책은 그 단계 이후의 policy DSL 에서 다뤄집니다.

### 2.3 정책 예시 (schema 표면 한정 — USD-free)

```text
// 1. 가장 흔한 안전판
recipient == from
slippageBps <= 300
validity == null || (
  validity.source == "tx-deadline" &&
  validity.expiresInSeconds between 60 and 1800
)

// 2. 토큰 허용 목록
tokenIn.symbol in ["USDC","USDT","WETH","DAI"]
tokenOut.symbol in ["USDC","USDT","WETH","DAI"]

// 3. exact_out 차단
mode != "exact_out"

// 4. raw amount 상한 (USD 환산 enrichment 전, decimals-aware 비교)
amountIn.value <= "1000000000"   // 예: USDC 1,000 단위 (6 decimals)
```

### 2.4 schema 에 일부러 *안* 둔 것

- **`route.hops[]`** — V3 packed path 의 경유 pool 리스트, Balancer batchSwap 의 step[] 등. 통과 경로는 정책 가치 없음. ("USDC 받음" 정책은 tokenOut 만 보면 충분).
- **`protocolId`** — `root.protocol.name` 이 이미 들고 있음. action 차원에서 중복 안 함.
- **`hookFlags`** — V4 hook 정보. 너무 V4-specific. 향후 Extension Schema 가 다룸.
- **`sender`** — 거의 항상 `root.from`. Balancer relayer 같은 edge case 만 다름 — 그 케이스는 `recipient` + `from` 비교로 충분히 분석.

---

## 3. `add_liquidity` — pool 에 예치

### 3.1 어떤 함수들이

| Protocol | 대표 함수 |
|---|---|
| Uniswap V2 (+ Pancake V2) | `addLiquidity(tokenA, tokenB, …)`, `addLiquidityETH(token, …)` |
| Uniswap V3 NPM (+ Pancake V3) | `mint(MintParams)` (신규), `increaseLiquidity(IncreaseParams)` (기존) |
| Uniswap V4 PositionManager | opcode `0x02 MINT_POSITION`, `0x00 INCREASE_LIQUIDITY` |
| Balancer V2 | `Vault.joinPool(poolId, sender, recipient, request)` |
| Curve | `add_liquidity(uint256[N] amounts, uint256 min_mint_amount)` (N=2/3/4) |
| Aerodrome / Sushi / Maverick / Trader Joe | mint 변형들 |
| Pancake SmartRouter | `approveAndCall.mint`, `approveAndCall.increaseLiquidity` |
| Pancake Infinity | `bin.mint`, `cl.modifyLiquidity` (delta>0) |

V2 family 의 `add_liquidity` 와 V3/V4 의 `mint_position` / `increase_liquidity`, Balancer 의 `join_pool` 이 의미적으로 모두 "예치" 라는 한 가지 → 본 schema 1 개로 통합.

### 3.2 필드

```jsonc
{
  "_kind":         "add_liquidity",
  "positionScope": "new",                                  // 또는 "existing"
  "positionId":    null,                                   // existing 일 때만
  "pool": {
    "address": "0x88e6…",
    "id":      "0x88e6…000000000000000000000001",          // Balancer/V4 의 bytes32 id
    "label":   "ETH/USDC 0.05%"                            // host 보강
  },
  "tokens": [
    { "kind": "erc20", "address": "0xA0b8…", "symbol": "USDC", "decimals": 6 },
    { "kind": "erc20", "address": "0xC02a…", "symbol": "WETH", "decimals": 18 }
  ],
  "amounts": [
    { "kind": "estimated", "value": "1000000000" },         // ~1,000 USDC desired
    { "kind": "estimated", "value": "300000000000000000" }  // ~0.3 WETH desired
  ],
  "minLpReceived": "950000000000000000",                    // 최소 받을 LP unit
  "recipient":     "0xUser…",
  "validity":      { "expiresAt": "1715961834", "expiresInSeconds": 600, "source": "tx-deadline" },
  "feeTierBps":    5,                                       // V3/V4 only
  "tickRange":     { "lower": -200000, "upper": 200000 }    // V3/V4 only
}
```

| 필드 | 정책 관점 |
|---|---|
| **`positionScope`** | `new` = 신규 position 생성, `existing` = 기존에 추가. 정책 "신규 unknown pool 차단" / "내 position 만 증가 허용" |
| `positionId` | V3/V4 NPM 의 NFT id. 정책 "host:onchain 으로 NFT.ownerOf(id) == from 검증" |
| **`pool.label`** | host 가 채우는 사람-친화적 라벨. **"Unknown pool" 이면 정책상 차단 권장** |
| **`tokens` / `amounts`** | 어느 토큰을 얼마나 넣는가. 정책 "stablecoin pool 만" |
| `minLpReceived` | 슬리피지 보호. **null/0 이면 sandwich attack 취약** — 정책 "minLpReceived > 0 필수" |
| `recipient` | LP/NFT 수령자. `from` 과 다르면 비정상 |
| `feeTierBps` | V3/V4 한정. "0.05% / 0.30% / 1% 만 허용" |
| `tickRange` | V3/V4 한정. 너무 좁은 범위는 즉시 out-of-range 위험. 정책 "tickUpper - tickLower >= 1000" |

> **USD 환산값은 schema 표면에 없습니다.** "max add liquidity $10k per day" 같은 USD 기반 정책은 별도 enrichment 단계 후 policy DSL 에서 다뤄집니다.

### 3.3 정책 예시 (schema 표면 한정 — USD-free)

```text
// 1. 안전판
recipient == from
minLpReceived != null && minLpReceived > 0
validity == null || validity.expiresInSeconds >= 60

// 2. pool 화이트리스트
pool.label != null         // 알려진 pool 만
pool.label matches "(WETH|USDC|USDT|DAI)/.*"

// 3. position 관리
positionScope == "new" implies pool.label != "Unknown pool"

// 4. tight range 차단 (V3/V4)
tickRange == null || (tickRange.upper - tickRange.lower) >= 1000

// 5. 토큰 화이트리스트
forall t in tokens: t.symbol in ["USDC","USDT","WETH","DAI"]
```

---

## 4. `remove_liquidity` — pool 에서 인출

### 4.1 어떤 함수들이

| Protocol | 대표 함수 |
|---|---|
| Uniswap V2 (+ Pancake V2) | `removeLiquidity` / `removeLiquidityETH` / `…WithPermit` / `…SupportingFeeOnTransferTokens` 등 6 변형 |
| Uniswap V3 NPM (+ Pancake V3) | `decreaseLiquidity(DecreaseParams)`, `burn(uint256)` |
| Uniswap V4 PositionManager | opcode `0x01 DECREASE_LIQUIDITY`, `0x03 BURN_POSITION` |
| Balancer V2 | `Vault.exitPool(poolId, sender, recipient, request)` |
| Curve | `remove_liquidity(uint256, uint256[N])`, `remove_liquidity_imbalance`, `remove_liquidity_one_coin` |
| Aerodrome / Sushi / Maverick / Trader Joe | burn 변형들 |
| Pancake Infinity | `bin.burn`, `cl.modifyLiquidity` (delta<0) |

### 4.2 필드

```jsonc
{
  "_kind":         "remove_liquidity",
  "exitMode":      "proportional",                          // 또는 single_asset / exact_out / burn_all
  "positionScope": "existing",                              // 항상 existing
  "positionId":    "12345",                                 // V3/V4 NPM
  "pool":          { "address": "0x88e6…", "label": "ETH/USDC 0.05%" },
  "lpBurnAmount":  { "kind": "exact", "value": "500000000000000000" },
  "tokens":        [{ "symbol": "USDC", … }, { "symbol": "WETH", … }],
  "minAmountsOut": [
    { "kind": "min", "value": "498000000" },                // 최소 498 USDC
    { "kind": "min", "value": "149000000000000000" }        // 최소 0.149 WETH
  ],
  "recipient":     "0xUser…",
  "validity":      { "expiresAt": "1715961834", "expiresInSeconds": 600, "source": "tx-deadline" },
  "feeTierBps":    5
}
```

| 필드 | 정책 관점 |
|---|---|
| **`exitMode`** | 4 종 — `proportional` (모든 토큰 비율대로) / `single_asset` (한 토큰만, Curve one_coin 등) / `exact_out` (Curve imbalance / Balancer BPT_IN_FOR_EXACT) / `burn_all` (V3/V4 burn 전체). 각각 정책 분기 다름 |
| `positionScope` | const `"existing"` — remove 은 항상 기존 |
| `positionId` | V3/V4 NPM 의 NFT id. "내 position 만 인출 허용" |
| `pool` | add 와 동일 |
| **`lpBurnAmount`** | 소각 양. V3/V4 burn 시 = 전체 liquidity (kind=exact + value 전체). 정책 "max 50% per day" |
| `tokens` / **`minAmountsOut`** | 받을 토큰과 최소 보장. **모든 entry 의 kind=min, value=0 이면 sandwich attack 100% 노출** — 정책 강력 차단 |
| **`recipient`** | **★ 가장 위험한 필드.** remove 결과는 underlying 토큰 (보통 가치 큰 자산). `from` 과 다르면 **account drain 패턴**. 정책 무조건 `recipient == from` |
| `feeTierBps` | V3/V4 한정 |

> **USD 환산값은 schema 표면에 없습니다.** "큰 인출 분리 검토" 같은 USD 기반 정책은 별도 enrichment 단계 후 policy DSL 에서 다뤄집니다.

### 4.3 정책 예시 (schema 표면 한정 — USD-free)

```text
// 1. 강력한 안전판
recipient == from                  // 절대 sine qua non
validity == null || validity.expiresInSeconds >= 60

// 2. slippage protection
forall i in minAmountsOut: i.value > "0"   // 모든 토큰에 하한 있어야

// 3. burn_all 경고 (외부 portfolio 데이터 결합 시)
exitMode == "burn_all" implies positionId in my_active_positions

// 4. exit mode 제한
exitMode in ["proportional", "burn_all"]   // imbalance / single_asset 차단
```

### 4.4 add_liquidity 와의 비대칭

- add: 자금이 사용자 → pool 로. 위험 = pool 자체가 불량 (rug, oracle 조작)
- remove: 자금이 pool → recipient 로. **위험 = recipient 가 외부 EOA (account drain)**

→ remove 의 recipient 정책이 add 보다 *엄격* 해야 합니다.

---

## 5. 본 schema 가 통합하지 *못 하는* 것

다음은 의도적으로 schema 표면에 안 두었거나, 별도 처리가 필요:

| 케이스 | 처리 |
|---|---|
| V4 hook 의 swap-의미 변경 (beforeSwap 이 amount 를 임의로 변형) | hook 의 의미 디코드는 v1.0.1 범위 외. `root.protocol.component = "v4WithHook"` 같은 라벨로 신호. 정책은 "no V4 hook" 으로 보수적 분기 |
| Curve `exchange_received` (pre-funded swap, 사용자가 직접 transferFrom 안 함) | `swap` action 이지만 settlement 의미가 다름. 별도 flag 필요 → 향후 Extension Schema |
| Balancer batchSwap 의 multi-asset chaining | 정책 관점에서 *결과 net delta* 만 중요. schema 는 첫 토큰 in / 마지막 토큰 out 만 보존 |
| Pancake StableSwap 의 `flag[i]` (pool token count 매핑) | wire 정보. 정책 무관 |

---

## 6. 자주 묻는 질문

**Q. `mint_position`, `increase_liquidity` 가 V3/V4 NPM 에 있던데 별도 action 없나?**
A. v1.0.1 에서는 모두 `add_liquidity` 로 통합. `positionScope` (new/existing) + `positionId` 로 의미 구분. 정책 관점에서 "신규 LP vs 기존 LP 증가" 차이가 중요하면 분기 가능.

**Q. `decrease_liquidity`, `burn_position` 도 마찬가지?**
A. 네. `remove_liquidity` 로 통합. `exitMode = burn_all` 이 V3/V4 burn 에 해당.

**Q. Curve `remove_liquidity_one_coin` 의 `tokens` 길이는?**
A. pool 의 전체 N 개를 모두 채움. `minAmountsOut[i]` 의 value 가 nonzero 인 entry 가 실제 받을 토큰. 다른 entry 는 value=0. 이게 V3 NPM partial fill convention 과 일관된 선택.

**Q. Balancer `batchSwap` 은 `swap` action 1개? 여러 개?**
A. **1 개 swap action**. multi-hop chaining 이라도 사용자 의미는 "tokenIn → tokenOut 1 회". route.hops 같은 거 안 두는 이유.

**Q. `protocol.name == 'curve'` 이고 `action == 'swap'` 인데 `exact_out` 이 가능한가?**
A. Curve 의 standard exchange 는 mostly `exact_in`. exact_out 케이스가 거의 없음. `mode = unknown` 또는 `exact_in` 가 일반적.

---

## 7. 관련 파일

- `schema/actions/swap.json` / `add_liquidity.json` / `remove_liquidity.json`
- `schema/common/_common.json`
- `docs/root-schema.md` — 이들이 어떻게 root.actions[] 에 묶이는가
- `docs/misc-actions.md` — DEX action 의 prerequisite (approve / wrap)
- `contracts/` — 본 schema 가 정규화 대상으로 삼는 reference 컨트랙트들 (curve / aerodrome / sushiswap / traderjoe / dodo + 다른 카테고리 5개)
