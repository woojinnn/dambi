# aerodrome-slipstream

## 개요
- **그룹**: `concentrated-liquidity` (V3-shape with `int24 tickSpacing`)
- **chain**: Base (8453)
- **라우터**: `0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5` — Aerodrome Slipstream SwapRouter
- **출처**: `aerodrome-finance/slipstream` `contracts/periphery/SwapRouter.sol` + `contracts/periphery/interfaces/ISwapRouter.sol`
- **fee policy**: `none_tickspacing_only` (항상 `null` — tickSpacing 은 fee 가 아님)

## selector 표

V3 와 한 가지 구조적 차이: params struct 의 `uint24 fee` → `int24 tickSpacing`. 이 변형 때문에 *Single 함수 selector 는 V3 와 다름. 그러나 `exactInput`/`exactOutput` 의 path 는 `bytes` 로 동일하므로 selector 는 V3 와 동일.

| Selector | Solidity 함수 | V3 와 다름? |
|---|---|---|
| `0xa026383e` | `exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | 다름 (`int24` 차이) |
| `0xc04b8d59` | `exactInput((bytes,address,uint256,uint256,uint256))` | **동일** (V3 와 같음 — chain_id+target 으로 구분) |
| `0xc714e838` | `exactOutputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | 다름 |
| `0xf28c0498` | `exactOutput((bytes,address,uint256,uint256,uint256))` | **동일** |

multicall 은 v0.1 미구현 (Slipstream 의 SwapRouter 도 Multicall 베이스 상속하지만 본 어댑터는 4 함수만 다룸 — 추후 추가 가능).

## DexFacts 매핑

uniswap-v3 매핑과 거의 동일하되 다음 차이:

| 필드 | 차이 |
|---|---|
| `params.tickSpacing` (int24) | TRACE_ONLY (`"tickSpacing=N"` 형식) — V3 는 `params.fee` 로 max_fee_bps 산출했지만 Slipstream 은 산출 불가 |
| `max_fee_bps` | **항상 `null`** — calldata 에 fee 없음 |
| `protocol_ids` | `["aerodrome-slipstream"]` |
| `decode_slipstream_path` | V3 의 packed path (`[token20|fee3|token20]`) 와 동일 layout 이지만 3-byte 필드를 **signed int24 sign-extend** 하여 `i32` 로 변환 |

### packed path 의 sign-extension

V3 의 `decode_v3_path` 는 3-byte 를 unsigned u24 로 읽음. Slipstream 은:
```rust
let high = if b0 & 0x80 != 0 { 0xFF } else { 0x00 };
let tick = i32::from_be_bytes([high, b0, b1, b2]);
```
음수 tickSpacing (예: i24::MIN = `0x800000` = -8388608) 도 정확히 표현.

## 정책 영향

`max_fee_bps = null` 이라:
- `policies/dex/max-fee-bps-100.cedar` 의 `context has maxFeeBps && context.maxFeeBps > 100` 가드가 false → 정책 미발동 → Slipstream swap 은 fee cap 검사를 우회 (의도된 동작).
- 호스트가 fee 정책을 강제하려면 별도 fee oracle 도입 필요 (v0.1 범위 외).

## 토큰 lookup

`TokenLookup::with_base_defaults()` — aerodrome-v1 과 공유 (USDC, WETH, AERO).

## 어댑터 코드 위치
- `crates/adapters/aerodrome-slipstream/src/lib.rs`
- `crates/adapters/aerodrome-slipstream/src/common.rs` — `AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE`, `decode_slipstream_path`, `dex_swap_action`, `merge_dex_actions`
- 4개 함수 모듈

## 정합성 검증
- `decode_slipstream_path` 단위 테스트가 양수 (200), -1, i24::MIN 모두 검증
- `cargo test -p policy-engine-adapter-aerodrome-slipstream`
