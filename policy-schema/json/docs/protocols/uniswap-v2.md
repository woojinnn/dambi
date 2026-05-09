# uniswap-v2

## 개요
- **그룹**: `constant-product` (V2-shape)
- **chain**: Ethereum mainnet (1)
- **라우터**: `0x7a250d5630b4cf539739df2c5dacb4c659f2488d` — Uniswap V2 Router02
- **출처**: `Uniswap/v2-periphery` `contracts/UniswapV2Router02.sol` (Solidity pragma `=0.6.6`)
- **fee policy**: `constant_30_bps` (프로토콜 고정, calldata 미인코딩)

## selector 표

| Selector | Solidity 함수 | 어댑터 모듈 |
|---|---|---|
| `0x38ed1739` | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | `swap_exact_tokens_for_tokens` |
| `0x8803dbee` | `swapTokensForExactTokens(uint256,uint256,address[],address,uint256)` | `swap_tokens_for_exact_tokens` |
| `0x7ff36ab5` | `swapExactETHForTokens(uint256,address[],address,uint256)` payable | `swap_exact_eth_for_tokens` |
| `0xfb3bdb41` | `swapETHForExactTokens(uint256,address[],address,uint256)` payable | `swap_eth_for_exact_tokens` |
| `0x18cbafe5` | `swapExactTokensForETH(uint256,uint256,address[],address,uint256)` | `swap_exact_tokens_for_eth` |
| `0x4a25d94a` | `swapTokensForExactETH(uint256,uint256,address[],address,uint256)` | `swap_tokens_for_exact_eth` |

## DexFacts 매핑

| calldata 필드 | DexFacts 행선지 | 비고 |
|---|---|---|
| `path[0]` | `input_tokens[0]` | TokenLookup 미등록은 UNKNOWN 18-dec fallback |
| `path[N-1]` | `output_tokens[0]` | |
| `amountIn` (또는 `amountInMax`) | `oracle_requirements[input].raw_amount` | exact-out 변형은 amountInMax |
| `amountOutMin` (또는 `amountOut`) | `oracle_requirements[minOutput].raw_amount`, `has_zero_min_output` | `==0` flips bool |
| `to` | `has_external_recipient` | `to != tx.from` flips bool |
| `deadline` | TRACE_ONLY | 정책 미가시 |
| (상수) | `max_fee_bps = Some(30)` | |
| (상수) | `protocol_ids = ["uniswap-v2"]` | |

ETH 변형(`*ETHForTokens` / `TokensFor*ETH`) 은 path 의 한쪽 끝을 `native_eth(chain_id)` (symbol="ETH", is_native=true) 로 치환.

## 특이사항
- 6 핵심 swap 함수 모두 동일한 selector / path 구조. PancakeSwap V2 는 byte-identical fork (selector 동일).
- Fee-on-transfer 변형 (`swapExact*ForTokensSupportingFeeOnTransferTokens`) 은 v0.1 범위 외.

## 어댑터 코드 위치
- `crates/adapters/uniswap-v2/src/lib.rs`
- `crates/adapters/uniswap-v2/src/common.rs` — `UNISWAP_V2_ROUTER_MAINNET`, `native_eth`, `path_endpoints`, `dex_swap_action`, `TokenLookup`
- 함수당 1 모듈 (6개)

## 정합성 검증
- 어댑터의 `selector_pin` 단위 테스트가 모든 hex 핀고정 (예: `crates/adapters/uniswap-v2/src/swap_exact_tokens_for_tokens.rs:174`).
- `cargo test -p policy-engine-adapter-uniswap-v2` 24 tests pass.
