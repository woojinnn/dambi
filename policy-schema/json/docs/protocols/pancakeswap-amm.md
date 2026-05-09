# pancakeswap-amm

## 개요
- **그룹**: `constant-product` (V2-shape, BSC fork)
- **chain**: BNB Smart Chain (56)
- **라우터**: `0x10ed43c718714eb63d5aa57b78b54704e256024e` — PancakeSwap V2 Router
- **출처**: `pancakeswap/pancake-swap-periphery` `contracts/PancakeRouter.sol` (Solidity pragma `=0.6.6`)
- **fee policy**: `constant_25_bps` (PancakeSwap V2 의 0.25% 고정 fee)

## selector 표

ABI-level Uniswap V2 fork 이므로 6 selector 모두 byte-identical.

| Selector | Solidity 함수 |
|---|---|
| `0x38ed1739` | `swapExactTokensForTokens` |
| `0x8803dbee` | `swapTokensForExactTokens` |
| `0x7ff36ab5` | `swapExactETHForTokens` payable |
| `0xfb3bdb41` | `swapETHForExactTokens` payable |
| `0x18cbafe5` | `swapExactTokensForETH` |
| `0x4a25d94a` | `swapTokensForExactETH` |

## DexFacts 매핑

uniswap-v2 와 동일하되 다음 차이:
- `protocol_ids = ["pancakeswap-amm"]` (V2 와 다른 식별자)
- `max_fee_bps = Some(25)` (V2 의 30 대신 25)
- ETH 변형 함수의 native asset 은 BNB:
  - `native_bnb(chain_id)` 가 `Token { symbol: "BNB", chain_id: 56, is_native: true }` 반환
  - sentinel address 는 `0xeeee...eeee` 동일

## 토큰 lookup

`TokenLookup::with_bsc_defaults()` 가 4 기본 토큰 등록:

| Symbol | Address | Decimals |
|---|---|---|
| WBNB | `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` | 18 |
| USDT | `0x55d398326f99059ff775485246999027b3197955` | **18** (mainnet 의 6과 다름) |
| BUSD | `0xe9e7cea3dedca5984780bafc599bd69add087d56` | 18 |
| CAKE | `0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82` | 18 |

## 특이사항
- Solidity 함수명은 `swapExactETHForTokens` 처럼 ETH 표기를 유지하지만 BSC 에서 native asset 은 BNB. emit 되는 Token 의 symbol 은 "BNB".
- selector 중복 (예: `0x38ed1739`) 은 chain_id (1 vs 56) + target 으로 구분. dispatch.json 의 transactionEntries 가 chainId 키로 dedup.
- Fee-on-transfer 변형은 v0.1 범위 외.

## 어댑터 코드 위치
- `crates/adapters/pancakeswap-amm/src/lib.rs`
- `crates/adapters/pancakeswap-amm/src/common.rs` — `PANCAKESWAP_V2_ROUTER_BSC`, `native_bnb`, `TokenLookup::with_bsc_defaults`
- 함수당 1 모듈 (6개)

## 정합성 검증
- `cargo test -p policy-engine-adapter-pancakeswap-amm` — 25 tests pass
- `selector_pin_matches_uniswap_v2` 테스트가 selector identity 검증
