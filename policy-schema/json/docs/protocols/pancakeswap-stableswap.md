# pancakeswap-stableswap

## 개요
- **그룹**: `stableswap` (Curve-style 풀 단위 exchange)
- **chain**: BNB Smart Chain (56)
- **라우터**: 없음. 풀 컨트랙트 마다 독립 (chain_targets 가 풀 주소 N개 리스트).
- **출처**: `pancakeswap/pancake-smart-contracts` `projects/stable-swap/contracts/PancakeStableSwapTwoPool.sol` + `PancakeStableSwapThreePool.sol`
- **fee policy**: `constant_4_bps_estimate` (보수적 상한, 실 1~4 bps)

## selector 표

| Selector | Solidity 함수 |
|---|---|
| `0x5b41b908` | `exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy)` payable |

PancakeSwap StableSwap 의 `i`/`j` 는 `uint256` (Curve 의 `int128` 과 다름) — selector `0x5b41b908` 은 PancakeSwap 변형 고유 (Curve `exchange(int128,int128,uint256,uint256)` 는 `0x3df02124`).

## v0.1 풀 카탈로그

`crates/adapters/pancakeswap-stableswap/src/common.rs::seeded_bsc_pools`:

| 풀 주소 | 코인 | N |
|---|---|---|
| `0x4f3126d5de26413abdcf6948943fb9d0847d9818` | USDT, USDC | 2 |
| `0x36842f8fb99d55477c0da638af5ceb6bbf86aa98` | USDT, BUSD, USDC | 3 |

**v0.1 한계**: 두 풀은 illustrative placeholder. production 시 매니페스트 기반 capability 로 교체 필요.

## DexFacts 매핑

| calldata 필드 | DexFacts 행선지 |
|---|---|
| `i` (uint256) | `input_tokens[0] = pool.coins[i]` (PoolRegistry::resolve_tokens) |
| `j` (uint256) | `output_tokens[0] = pool.coins[j]` |
| `dx` (uint256) | `oracle_requirements[input].raw_amount` |
| `min_dy` (uint256) | `oracle_requirements[minOutput].raw_amount`, `has_zero_min_output` |
| (call.target) | TRACE_ONLY (`"pool=0x..."`) |
| (상수) | `max_fee_bps = Some(4)` |
| (상수) | `protocol_ids = ["pancakeswap-stableswap"]` |
| (상수) | `has_external_recipient = false` (recipient param 없음) |

## 특이사항

- 풀 미등록 시 `resolve_tokens` 가 synthetic `Token { symbol: "UNKNOWN[i]" }` 반환. 어댑터는 여전히 구조적으로 valid 한 DexAction emit.
- `i == j` 은 어댑터의 `decode` 가 거부 (`DecodeError::SameIndex`) → `BadCalldata` 로 파이프라인이 OtherAction 합성.
- u256 → u64 narrow 시 `i` 또는 `j` 가 N_COINS 보다 큰 비정상 값이면 `BadCalldata`.
- `value_wei` 가 0 이 아닌 경우는 native-side coin 을 갖는 풀에서만 발생 (pool 의 native side 처리는 어댑터 v0.1 미명세).

## 어댑터 코드 위치
- `crates/adapters/pancakeswap-stableswap/src/lib.rs`
- `crates/adapters/pancakeswap-stableswap/src/common.rs` — `PoolEntry`, `PoolRegistry`, `seeded_bsc_pools`, `resolve_tokens`, `STABLESWAP_FEE_ESTIMATE_BPS`
- `crates/adapters/pancakeswap-stableswap/src/exchange.rs` — `exchange` 어댑터

## 정합성 검증
- `cargo test -p policy-engine-adapter-pancakeswap-stableswap`
- `selector_pin` 테스트: `assert_eq!(SELECTOR, [0x5b, 0x41, 0xb9, 0x08])`
