# pancakeswap-v3

## 개요
- **그룹**: `concentrated-liquidity` (V3-shape, BSC fork)
- **chain**: BNB Smart Chain (56)
- **라우터**: `0x1b81d678ffb9c0263b24a97847620c99d213eb14` — PancakeSwap V3 SwapRouter
- **출처**: `pancakeswap/pancake-v3-contracts` `projects/v3-periphery/contracts/SwapRouter.sol` + `contracts/interfaces/ISwapRouter.sol`
- **fee policy**: `calldata_fee_div_100` / `calldata_packed_path_max_fee` / `merged_max_across_children`

## selector 표

ABI-level Uniswap V3 fork — 6 selector byte-identical.

| Selector | Solidity 함수 |
|---|---|
| `0x414bf389` | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` |
| `0xc04b8d59` | `exactInput((bytes,address,uint256,uint256,uint256))` |
| `0xdb3e2198` | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` |
| `0xf28c0498` | `exactOutput((bytes,address,uint256,uint256,uint256))` |
| `0xac9650d8` | `multicall(bytes[])` |
| `0x5ae401dc` | `multicall(uint256,bytes[])` |

## fee tier

PancakeSwap V3 는 4 fee tier 를 지원 (Uniswap V3 의 3 tier 와 다름):

| raw uint24 | bps |
|---|---|
| 100 | 1 bps |
| 500 | 5 bps |
| 2500 | **25 bps** (PancakeSwap 고유) |
| 10000 | 100 bps |

매핑은 V3 와 동일: `max_fee_bps = Some(fee / 100)`.

## DexFacts 매핑

uniswap-v3 와 동일. 차이점:
- `protocol_ids = ["pancakeswap-v3"]`
- BSC 토큰 lookup (`TokenLookup::with_bsc_defaults()` — pancakeswap-amm 과 동일 4 토큰)
- packed path layout 은 V3 와 동일 (20+3+20+3+...+20), `decode_v3_path()` 그대로 재사용

## multicall

`uniswap-v3/src/multicall.rs` 와 동일한 패턴:
- 자식 calldata 재귀 디코드 (MAX_DEPTH=4, MAX_CHILDREN=32)
- 자식 selector 가 4종 함수 중 하나 또는 nested multicall 만 인식
- `merge_dex_actions` 로 단일 DexAction 합집합

## 특이사항
- v0.1 은 V3 SwapRouter 만 다룬다. PancakeSwap **SmartRouterV3** (`0x13f4EA83...`) 는 다중 프로토콜 어그리게이터로 별도 어댑터가 필요 — 범위 외.
- Uniswap V3 SwapRouter02 (deadline-in-multicall) 도 PancakeSwap 에 별도 deploy 가 있다면 별도 어댑터.

## 어댑터 코드 위치
- `crates/adapters/pancakeswap-v3/src/lib.rs`
- `crates/adapters/pancakeswap-v3/src/common.rs` — `PANCAKESWAP_V3_SWAP_ROUTER_BSC`, BSC TokenLookup, `decode_v3_path`, `dex_swap_action`, `merge_dex_actions`
- 함수당 1 모듈 (5개) + `multicall.rs`

## 정합성 검증
- `cargo test -p policy-engine-adapter-pancakeswap-v3`
