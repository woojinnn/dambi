# Function Inventory — selector × protocol × function 통합 표

scopeball 의 모든 어댑터가 매칭하는 selector / EIP-712 primary type 의 단일 통합 인덱스. `dispatch.json` 의 산문 reference. 모든 selector 는 `cast sig` 또는 어댑터의 `selector_pin` unit test 가 인정한 값과 일치한다.

---

## 1. Constant-product (V2-shape)

### Uniswap V2 Router02 (chain 1, `0x7a25...488d`)

| Selector | Solidity 함수 | 어댑터 |
|---|---|---|
| `0x38ed1739` | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | `uniswap-v2/swapExactTokensForTokens@0.1.0` |
| `0x8803dbee` | `swapTokensForExactTokens(uint256,uint256,address[],address,uint256)` | `uniswap-v2/swapTokensForExactTokens@0.1.0` |
| `0x7ff36ab5` | `swapExactETHForTokens(uint256,address[],address,uint256)` payable | `uniswap-v2/swapExactETHForTokens@0.1.0` |
| `0xfb3bdb41` | `swapETHForExactTokens(uint256,address[],address,uint256)` payable | `uniswap-v2/swapETHForExactTokens@0.1.0` |
| `0x18cbafe5` | `swapExactTokensForETH(uint256,uint256,address[],address,uint256)` | `uniswap-v2/swapExactTokensForETH@0.1.0` |
| `0x4a25d94a` | `swapTokensForExactETH(uint256,uint256,address[],address,uint256)` | `uniswap-v2/swapTokensForExactETH@0.1.0` |

### PancakeSwap V2 Router (chain 56, `0x10ED...4E`)

selector 6개는 Uniswap V2 와 byte-identical (ABI fork). chain_id + target 으로 구분.

### Aerodrome V1 Router (chain 8453, `0xcF77...E43`)

| Selector | Solidity 함수 |
|---|---|
| `0xcac88ea9` | `swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)` |
| `0x903638a4` | `swapExactETHForTokens(uint256,(address,address,bool,address)[],address,uint256)` payable |
| `0xc6b7f1b6` | `swapExactTokensForETH(uint256,uint256,(address,address,bool,address)[],address,uint256)` |

V2 와 다른 selector — `Route[]` 배열 인자 때문에 sigantirue keccak 이 다름.

---

## 2. Concentrated-liquidity (V3-shape)

### Uniswap V3 SwapRouter (chain 1, `0xE592...564`)

| Selector | Solidity 함수 |
|---|---|
| `0x414bf389` | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` |
| `0xc04b8d59` | `exactInput((bytes,address,uint256,uint256,uint256))` |
| `0xdb3e2198` | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` |
| `0xf28c0498` | `exactOutput((bytes,address,uint256,uint256,uint256))` |
| `0xac9650d8` | `multicall(bytes[])` |
| `0x5ae401dc` | `multicall(uint256,bytes[])` deadline 변형 |

### PancakeSwap V3 SwapRouter (chain 56, `0x1b81...B14`)

selector 6개는 Uniswap V3 와 byte-identical. chain_id + target 으로 구분.

### Aerodrome Slipstream SwapRouter (chain 8453, `0xBE6D...8a5`)

| Selector | Solidity 함수 | 비고 |
|---|---|---|
| `0xa026383e` | `exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | `int24 tickSpacing` 으로 V3 selector 와 다름 |
| `0xc04b8d59` | `exactInput((bytes,address,uint256,uint256,uint256))` | V3 와 동일 (path 가 bytes 라 struct shape 동일) |
| `0xc714e838` | `exactOutputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | tickSpacing 으로 다름 |
| `0xf28c0498` | `exactOutput((bytes,address,uint256,uint256,uint256))` | V3 와 동일 |

---

## 3. StableSwap

### PancakeSwap StableSwap pools (chain 56)

| Selector | Solidity 함수 | 풀 주소 |
|---|---|---|
| `0x5b41b908` | `exchange(uint256,uint256,uint256,uint256)` payable | `0x4f31...9818` (USDT/USDC two-pool) |
| `0x5b41b908` | 동일 | `0x3684...aa98` (USDT/BUSD/USDC three-pool) |

selector 단일 — chain_id + target (풀 주소) 로 풀별 구분.

---

## 4. Meta router

### Uniswap Universal Router (chain 1, `0x66a9...8af`)

| Selector | Solidity 함수 |
|---|---|
| `0x24856bc3` | `execute(bytes commands, bytes[] inputs)` |
| `0x3593564c` | `execute(bytes,bytes[],uint256)` deadline 변형 |

`execute` 안의 `commands` 바이트열은 opcode 시퀀스. `commands.rs` 의 ~20개 opcode 상수 (`V2_SWAP_EXACT_IN=0x08`, `V3_SWAP_EXACT_IN=0x00`, `V4_SWAP=0x10`, `EXECUTE_SUB_PLAN=0x21` 등) 로 sub-protocol 디스패치.

---

## 5. Signature (selector-less)

서명 어댑터는 selector 가 아닌 `(verifying_contract, primary_type)` 페어로 매칭한다.

### Permit2 (`0x000000000022d473030f116ddee9f6b43ac78ba3`)

| primary_type | permit_kind enum |
|---|---|
| `PermitSingle` | `PermitSingle` |
| `PermitBatch` | `PermitBatch` |
| `PermitTransferFrom` | `PermitTransferFrom` |
| `PermitBatchTransferFrom` | `PermitBatchTransferFrom` |
| `PermitWitnessTransferFrom` | `PermitWitnessTransferFrom` |
| `PermitBatchWitnessTransferFrom` | `PermitBatchWitnessTransferFrom` |

### EIP-2612 (token contract 자체)

| primary_type | 매칭 |
|---|---|
| `Permit` | case-insensitive |

verifying_contract 가 어댑터의 `TokenLookup` 에 등록된 토큰이면 매칭. 미등록 토큰은 매칭 실패 → `Eip712Other` catch-all 로 fallback.

---

## 6. 통합 카운트

| 그룹 | 어댑터 수 | dispatch entry 수 |
|---:|---:|---:|
| Constant-product | 3 (uniswap-v2, pancakeswap-amm, aerodrome-v1) | 6 + 6 + 3 = 15 |
| Concentrated-liquidity | 3 (uniswap-v3, pancakeswap-v3, aerodrome-slipstream) | 6 + 6 + 4 = 16 |
| StableSwap | 1 (pancakeswap-stableswap × 2 풀) | 2 |
| Meta router | 1 (universal-router) | 2 |
| Signature | 2 (permit2 6종, eip2612 1) | 6 + 1 = 7 |
| **합계** | **10 어댑터** | **transaction 35 + signature 7 = 42** |

---

## 7. 출처

각 selector 의 1차 출처:
- Uniswap V2: `Uniswap/v2-periphery` `contracts/UniswapV2Router02.sol`
- Uniswap V3: `Uniswap/v3-periphery` `contracts/SwapRouter.sol` + `contracts/interfaces/ISwapRouter.sol`
- Universal Router: `Uniswap/universal-router` `contracts/UniversalRouter.sol`
- PancakeSwap V2: `pancakeswap/pancake-swap-periphery` `contracts/PancakeRouter.sol`
- PancakeSwap V3: `pancakeswap/pancake-v3-contracts` `projects/v3-periphery/...`
- PancakeSwap StableSwap: `pancakeswap/pancake-smart-contracts` `projects/stable-swap/contracts/PancakeStableSwapTwoPool.sol`
- Aerodrome V1: `aerodrome-finance/contracts` `contracts/Router.sol` + `contracts/interfaces/IRouter.sol`
- Aerodrome Slipstream: `aerodrome-finance/slipstream` `contracts/periphery/SwapRouter.sol` + interfaces
- Permit2: `Uniswap/permit2`
- EIP-2612: `EIP-2612` 표준 (ERC-20 토큰 컨트랙트 마다 자체 구현)

자세한 commit hash 핀고정은 어댑터별 [`protocols/<name>.md`](protocols/) 노트 참조.
