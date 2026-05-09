# uniswap-v3

## 개요
- **그룹**: `concentrated-liquidity` (V3-shape)
- **chain**: Ethereum mainnet (1)
- **라우터**: `0xe592427a0aece92de3edee1f18e0157c05861564` — Uniswap V3 SwapRouter (오리지널, deadline-in-params 변형)
- **출처**: `Uniswap/v3-periphery` `contracts/SwapRouter.sol` + `contracts/interfaces/ISwapRouter.sol`
- **fee policy**: `calldata_fee_div_100` (single 함수) / `calldata_packed_path_max_fee` (path 함수) / `merged_max_across_children` (multicall)

## selector 표

| Selector | Solidity 함수 |
|---|---|
| `0x414bf389` | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` |
| `0xc04b8d59` | `exactInput((bytes,address,uint256,uint256,uint256))` |
| `0xdb3e2198` | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` |
| `0xf28c0498` | `exactOutput((bytes,address,uint256,uint256,uint256))` |
| `0xac9650d8` | `multicall(bytes[])` |
| `0x5ae401dc` | `multicall(uint256,bytes[])` deadline 변형 |

## DexFacts 매핑

### `exactInputSingle` (대표)

| params 필드 | DexFacts 행선지 |
|---|---|
| `tokenIn` / `tokenOut` | `input_tokens[0]` / `output_tokens[0]` |
| `fee` (uint24) | `max_fee_bps = Some(fee / 100)` (예: 3000 → 30 bps) |
| `recipient` | `has_external_recipient` |
| `deadline` | TRACE_ONLY |
| `amountIn` | `oracle_requirements[input].raw_amount` |
| `amountOutMinimum` | `oracle_requirements[minOutput].raw_amount`, `has_zero_min_output` |
| `sqrtPriceLimitX96` | TRACE_ONLY (`"sqrtLimit=N"` 형식) |

### `exactInput` (multi-hop)
- packed `bytes path = [token20|fee3|token20|fee3|...|token20]` 을 `decode_v3_path()` 헬퍼가 `(tokens[], fees[])` 로 분해.
- `input_tokens[0] = tokens[0]`, `output_tokens[0] = tokens[N]`
- `max_fee_bps = Some(max(fees) / 100)` — leg-wise max

### `multicall`
- 자식 calldata 재귀 디코드 (MAX_DEPTH=4, MAX_CHILDREN=32) → `merge_dex_actions` 로 단일 DexAction 합집합.
- `protocol_ids` / `input_tokens` / `output_tokens` 는 set 합집합 (중복 제거), `max_fee_bps` 는 max, bool flag 는 OR, `oracle_requirements` 와 `trace.steps` 는 concat.

## 특이사항
- Uniswap V3 `SwapRouter02` (deadline-in-multicall) 는 v0.1 범위 외. 본 어댑터는 오리지널 `SwapRouter` 만 다룸.
- PancakeSwap V3 는 byte-identical fork — 동일 selector, 다른 chain/주소.

## 어댑터 코드 위치
- `crates/adapters/uniswap-v3/src/lib.rs`
- `crates/adapters/uniswap-v3/src/common.rs` — `SWAP_ROUTER_MAINNET`, `decode_v3_path`, `dex_swap_action`, `merge_dex_actions`
- 함수당 1 모듈 (5개) + `multicall.rs`
- `tests/abi_cross_check.rs` — sol! 매크로와 hand-rolled encode/decode 의 byte 일치 검증
