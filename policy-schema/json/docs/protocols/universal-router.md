# universal-router

## 개요
- **그룹**: `meta-router` (다중 프로토콜 commands 디스패처)
- **chain**: Ethereum mainnet (1)
- **라우터**: `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` — Uniswap Universal Router
- **출처**: `Uniswap/universal-router` `contracts/UniversalRouter.sol`
- **fee policy**: `merged_max_across_subprotocols`

## selector 표

| Selector | Solidity 함수 |
|---|---|
| `0x24856bc3` | `execute(bytes commands, bytes[] inputs)` |
| `0x3593564c` | `execute(bytes,bytes[],uint256)` deadline 오버로드 |

## opcode 디스패치

`commands` 바이트열의 각 바이트가 opcode. 약 20개 opcode 가 정의되며 swap 관련 / 정산 보조 / 권한 위임 으로 분류.

### Swap 계열 (DexAction 에 합산)
| opcode | 의미 | 디코더 위치 |
|---|---|---|
| `0x00` | V3_SWAP_EXACT_IN | `command_decode/v3_swap_exact_in.rs` |
| `0x01` | V3_SWAP_EXACT_OUT | `command_decode/v3_swap_exact_out.rs` |
| `0x08` | V2_SWAP_EXACT_IN | `command_decode/v2_swap_exact_in.rs` |
| `0x09` | V2_SWAP_EXACT_OUT | `command_decode/v2_swap_exact_out.rs` |
| `0x10` | V4_SWAP | `command_decode/v4_swap.rs` (V4 actions 디스패치) |

### 정산 / 보조 (DexAction 미반영, trace 만)
- `0x02` PERMIT2_TRANSFER_FROM
- `0x03` PERMIT2_PERMIT_BATCH
- `0x04` SWEEP
- `0x05` TRANSFER
- `0x06` PAY_PORTION
- `0x07` PAY_PORTION_FULL_PRECISION
- `0x0a` PERMIT2_PERMIT
- `0x0b` WRAP_ETH
- `0x0c` UNWRAP_WETH
- `0x0d` PERMIT2_TRANSFER_FROM_BATCH
- `0x0e` BALANCE_CHECK_ERC20
- `0x11` V3_POSITION_MANAGER_PERMIT
- `0x12` V3_POSITION_MANAGER_CALL
- `0x13` V4_INITIALIZE_POOL
- `0x14` V4_POSITION_MANAGER_CALL

### 재귀
- `0x21` EXECUTE_SUB_PLAN — sub-commands + sub-inputs 로 재귀 디스패치 (MAX_DEPTH=4)

### V4 액션 (V4_SWAP=0x10 안에서)
| 액션 | 디코더 |
|---|---|
| V4_SWAP_EXACT_IN_SINGLE | `v4_actions/exact_input_single.rs` |
| V4_SWAP_EXACT_IN | `v4_actions/exact_input.rs` |
| V4_SWAP_EXACT_OUT_SINGLE | `v4_actions/exact_output_single.rs` |
| V4_SWAP_EXACT_OUT | `v4_actions/exact_output.rs` |
| V4_SETTLE / V4_TAKE / V4_CLOSE_CURRENCY | 정산 보조, 미반영 |

## DexFacts 머지

`merge_dex_actions(tx, RoutedAction[])` 가 leaf swap 들을 단일 DexAction 으로 머지:

- `protocol_ids`: leaf 들의 protocol_id 합집합 (예: `["uniswap-v2", "uniswap-v3"]`)
- `input_tokens` / `output_tokens`: 합집합 (Token::key() 로 중복 제거)
- `max_fee_bps`: leaf 들의 max
- `has_zero_min_output` / `has_external_recipient`: OR 합산
- `oracle_requirements`: concat
- `trace.steps`: 라우터 라벨 + leaf trace concat

## 특이사항
- V4 라우팅이 본 어댑터 안에서 완전 구현 (V4 PoolManager 직접 호출 standalone 어댑터는 v0.1 미지원).
- PancakeSwap UR / Worldchain UR / 다른 chain 의 UR 변형은 v0.1 범위 외.
- sub-protocol 디코더는 sibling adapter crate 에 위임하지 않고 **본 crate 안에서 인라인 디코딩**.

## 어댑터 코드 위치
- `crates/adapters/universal-router/src/execute.rs` — `0x24856bc3`
- `crates/adapters/universal-router/src/execute_deadline.rs` — `0x3593564c`
- `crates/adapters/universal-router/src/commands.rs` — opcode 상수 + `expand_commands` 디스패처 + `merge_dex_actions`
- `crates/adapters/universal-router/src/command_decode/` — sub-protocol 디코더 5개
- `crates/adapters/universal-router/src/v4_actions/` — V4 액션 디코더 4개
