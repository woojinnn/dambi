# aerodrome-v1

## 개요
- **그룹**: `constant-product` (Solidly fork — V2-shape with `Route[]`)
- **chain**: Base (8453)
- **라우터**: `0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43` — Aerodrome V1 Router
- **출처**: `aerodrome-finance/contracts` `contracts/Router.sol` + `contracts/interfaces/IRouter.sol`
- **fee policy**: `estimate_stable_5_volatile_30` (calldata 미인코딩, leg-wise 추정)

## selector 표

V2 와 다른 selector — `Route[]` 인자 때문에 signature keccak 이 다름.

| Selector | Solidity 함수 |
|---|---|
| `0xcac88ea9` | `swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)` |
| `0x903638a4` | `swapExactETHForTokens(uint256,(address,address,bool,address)[],address,uint256)` payable |
| `0xc6b7f1b6` | `swapExactTokensForETH(uint256,uint256,(address,address,bool,address)[],address,uint256)` |

`Route` 구조체:
```solidity
struct Route { address from; address to; bool stable; address factory; }
```

## DexFacts 매핑

| calldata 필드 | DexFacts 행선지 |
|---|---|
| `routes[0].from` | `input_tokens[0]` |
| `routes[N-1].to` | `output_tokens[0]` |
| `routes[i].stable` | TRACE_ONLY (`"routes=[A->B stable=false, ...]"`) |
| `routes[i].factory` | TRACE_ONLY |
| `amountIn` (또는 `tx.value_wei`) | `oracle_requirements[input].raw_amount` |
| `amountOutMin` | `oracle_requirements[minOutput].raw_amount`, `has_zero_min_output` |
| `to` | `has_external_recipient` |
| (per-leg 추정) | `max_fee_bps = max(routes[i].stable ? 5 : 30)` |
| (상수) | `protocol_ids = ["aerodrome-v1"]` |

## Route 검증

`route_endpoints(routes)` 가 다음을 강제:
1. `routes.is_empty()` → `EmptyRoutes(0)` 에러
2. 인접 leg 의 `routes[i].to == routes[i+1].from` 연속성 — 위반 시 `BadCalldata`

## 토큰 lookup

`TokenLookup::with_base_defaults()`:

| Symbol | Address | Decimals |
|---|---|---|
| USDC | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | 6 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| AERO | `0x940181a94a35a4569e4529a3cdfb74e38fd98631` | 18 |

## 특이사항
- 실제 fee 는 Aerodrome 의 factory/pool 컨트랙트에 보관되어 calldata 에 없음. `stable=true → 5 bps`, `false → 30 bps` 는 mainstream 추정치이며 정책은 보수적 상한으로 해석해야 한다.
- `UNSAFE_swapExactTokensForTokens` 와 fee-on-transfer 변형은 v0.1 범위 외.
- Aerodrome `Gauge` / `Voter` (ve(3,3) emissions) 는 swap 어댑터 범위 외 — 별도 어댑터로 후속.

## 어댑터 코드 위치
- `crates/adapters/aerodrome-v1/src/lib.rs`
- `crates/adapters/aerodrome-v1/src/common.rs` — `AERODROME_V1_ROUTER_BASE`, `Route` struct, `route_endpoints`, `max_fee_bps_across`, `trace_routes`, `dex_swap_action`, `TokenLookup::with_base_defaults`
- 3개 함수 모듈
