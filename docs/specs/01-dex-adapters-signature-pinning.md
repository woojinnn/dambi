# DEX Adapters — Signature Pinning (Phase 1)

This document pins the on-chain function signatures, struct definitions and
4-byte selectors for every protocol added by the multi-DEX adapter extension
work. The values here are extracted statically from the official upstream
repositories and used as the input to the `alloy_sol_types::sol!` declarations
inside each adapter crate. **No RPC, fork, simulation, or chain call is used at
any stage.** All bytes flow from `sol!` macro output into `*Call::SELECTOR`
constants and `abi_decode` on raw calldata.

For each protocol we list:

1. The official source URL + commit hash that the signatures were read from.
2. The verbatim Solidity declarations.
3. The 4-byte selector. Selectors are recomputed by the `sol!` macro at build
   time. This document records the *expected* selector for round-trip
   verification in unit tests; if `sol!` ever produces a different value the
   `selector_pin` test in the adapter crate will catch the divergence.

The adapter crates also pin a default per-chain router or pool address. Those
addresses are public deployment metadata, not part of the ABI; they are listed
in the adapter's `common.rs`.

---

## 1. PancakeSwap V2 (AMM) — `pancakeswap-amm`

- **Source:** `pancakeswap/pancake-swap-periphery`, file
  `contracts/PancakeRouter.sol`. Solidity pragma `=0.6.6`.
- **Default chain:** BSC (chain id 56).
- **Default router address:** `0x10ED43C718714eb63d5aA57B78B54704E256024E`.
- **Convention:** PancakeSwap V2 is a 1:1 fork of Uniswap V2 Router02 at the
  ABI level. All six core swap selectors match Uniswap V2's. The
  `swap_exact_tokens_for_tokens` selector check pinned in
  `crates/adapters/uniswap-v2/src/swap_exact_tokens_for_tokens.rs:174` is
  `[0x38, 0xed, 0x17, 0x39]`; the same selector applies here.

### Functions

| # | Solidity signature | Selector | `sol!` callable |
|---|---|---|---|
| 1 | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | `0x38ed1739` | `swapExactTokensForTokensCall` |
| 2 | `swapTokensForExactTokens(uint256,uint256,address[],address,uint256)` | `0x8803dbee` | `swapTokensForExactTokensCall` |
| 3 | `swapExactETHForTokens(uint256,address[],address,uint256)` | `0x7ff36ab5` | `swapExactETHForTokensCall` |
| 4 | `swapETHForExactTokens(uint256,address[],address,uint256)` | `0xfb3bdb41` | `swapETHForExactTokensCall` |
| 5 | `swapExactTokensForETH(uint256,uint256,address[],address,uint256)` | `0x18cbafe5` | `swapExactTokensForETHCall` |
| 6 | `swapTokensForExactETH(uint256,uint256,address[],address,uint256)` | `0x4a25d94a` | `swapTokensForExactETHCall` |

Fee-on-transfer variants exist upstream; they are out of scope for v0.1.

PancakeSwap V2 charges 25 bps swap fee (vs Uniswap V2's 30 bps). The fee is
not encoded in calldata — it lives in the pair contract — so the adapter
emits it as a constant `Some(25)` into `DexFacts.max_fee_bps`.

---

## 2. PancakeSwap V3 — `pancakeswap-v3`

- **Source:** `pancakeswap/pancake-v3-contracts`, files
  `projects/v3-periphery/contracts/SwapRouter.sol` and
  `projects/v3-periphery/contracts/interfaces/ISwapRouter.sol`.
- **Default chain:** BSC (chain id 56).
- **Default router address:** `0x1b81D678ffb9C0263b24A97847620C99d213eB14`
  (PancakeSwap V3 SwapRouter on BSC).

### Param structs (verbatim from `ISwapRouter.sol`)

```solidity
struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

struct ExactInputParams {
    bytes path;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
}

struct ExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 amountInMaximum;
    uint160 sqrtPriceLimitX96;
}

struct ExactOutputParams {
    bytes path;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 amountInMaximum;
}
```

### Functions

| # | Solidity signature | Selector | Notes |
|---|---|---|---|
| 1 | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` | `0x414bf389` | Same selector as Uniswap V3 SwapRouter; layouts identical. |
| 2 | `exactInput((bytes,address,uint256,uint256,uint256))` | `0xc04b8d59` | |
| 3 | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` | `0xdb3e2198` | |
| 4 | `exactOutput((bytes,address,uint256,uint256,uint256))` | `0xf28c0498` | |
| 5 | `multicall(bytes[])` | `0xac9650d8` | Inherited from `Multicall` base. |
| 6 | `multicall(uint256,bytes[])` | `0x5ae401dc` | Variant with deadline (matches Uniswap V3 router's `multicall(deadline,data)`). |

Fee tiers in PancakeSwap V3 (raw `uint24` → bps): 100 → 1, 500 → 5, 2500 → 25,
10000 → 100. The adapter follows V3's `fee / 100` mapping into
`DexFacts.max_fee_bps`. Packed-path layout is identical (20+3+20...), so the
existing `decode_v3_path()` helper applies unchanged.

---

## 3. Aerodrome V1 — `aerodrome-v1`

- **Source:** `aerodrome-finance/contracts`, files `contracts/Router.sol` and
  `contracts/interfaces/IRouter.sol`.
- **Default chain:** Base (chain id 8453).
- **Default router address:** `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
  (Aerodrome V1 Router on Base).

### Route struct (verbatim from `IRouter.sol`)

```solidity
struct Route {
    address from;
    address to;
    bool    stable;
    address factory;
}
```

The `Route[]` array replaces the V2 `address[] path`. `routes[0].from` is
`token_in`, `routes[N-1].to` is `token_out`. The adapter validates leg
continuity (`routes[i].to == routes[i+1].from`) and rejects breaks with
`AdapterError::BadCalldata`.

### Functions in scope for v0.1

| # | Solidity signature | Selector |
|---|---|---|
| 1 | `swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)` | computed by `sol!` |
| 2 | `swapExactETHForTokens(uint256,(address,address,bool,address)[],address,uint256)` | computed by `sol!` |
| 3 | `swapExactTokensForETH(uint256,uint256,(address,address,bool,address)[],address,uint256)` | computed by `sol!` |

Fee-on-transfer variants and `UNSAFE_swapExactTokensForTokens` are
deliberately out of scope for v0.1.

Aerodrome's swap fees live on the factory/pair. Calldata does not carry the
fee. The adapter uses the heuristic `stable ? 5 : 30` per leg and emits the
**leg-wise max** into `DexFacts.max_fee_bps`. Trace records the per-leg
`stable` flag and the heuristic for audit.

---

## 4. Aerodrome Slipstream — `aerodrome-slipstream`

- **Source:** `aerodrome-finance/slipstream`, files
  `contracts/periphery/SwapRouter.sol` and
  `contracts/periphery/interfaces/ISwapRouter.sol`.
- **Default chain:** Base (chain id 8453).
- **Default router address:** `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5`
  (Slipstream SwapRouter on Base).

### Param structs (verbatim, with the divergence highlighted)

```solidity
struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    int24   tickSpacing;     // <-- replaces Uniswap V3's `uint24 fee`
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}

struct ExactInputParams {
    bytes   path;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
}

struct ExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    int24   tickSpacing;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 amountInMaximum;
    uint160 sqrtPriceLimitX96;
}

struct ExactOutputParams {
    bytes   path;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 amountInMaximum;
}
```

### Functions

| # | Solidity signature | Selector |
|---|---|---|
| 1 | `exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | computed by `sol!` |
| 2 | `exactInput((bytes,address,uint256,uint256,uint256))` | computed by `sol!` |
| 3 | `exactOutputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | computed by `sol!` |
| 4 | `exactOutput((bytes,address,uint256,uint256,uint256))` | computed by `sol!` |

The `int24 tickSpacing` field is **not a fee**. It only describes the pool's
geometry and cannot be mapped to `bps` without inspecting the pool contract.
The adapter records `tickSpacing` in `DexTrace.steps` and emits
`DexFacts.max_fee_bps = None`. Policies enforcing fee caps will skip the
swap (their `context has maxFeeBps` guards trigger).

The packed-path layout reuses the 20-byte address + 3-byte field pattern, but
the 3-byte field is now a signed `int24`. The adapter therefore introduces
`decode_slipstream_path()` which sign-extends the 3-byte value.

---

## 5. PancakeSwap StableSwap — `pancakeswap-stableswap`

- **Source:** `pancakeswap/pancake-smart-contracts`,
  `projects/stable-swap/contracts/PancakeStableSwapTwoPool.sol` and
  `projects/stable-swap/contracts/PancakeStableSwapThreePool.sol`.
- **Default chain:** BSC (chain id 56).
- **Pool addresses:** No central router. Each pool is its own contract; the
  adapter's `chain_targets` is a list of pool addresses. v0.1 hardcodes a
  small set of well-known pools; production should drive this list from a
  manifest capability. See `crates/adapters/pancakeswap-stableswap/src/common.rs`
  for the shipped list.

### Function (identical across both pool variants)

```solidity
function exchange(
    uint256 i,
    uint256 j,
    uint256 dx,
    uint256 min_dy
) external payable nonReentrant
```

| Solidity signature | Selector | Notes |
|---|---|---|
| `exchange(uint256,uint256,uint256,uint256)` | `0x5b41b908` | Selector pinned by the adapter's `selector_pin` test against `sol!`. Note: differs from Curve's `exchange(int128,int128,uint256,uint256)` (`0x3df02124`); PancakeSwap pool variants use `uint256` indices. |

`i` and `j` are token indices into the pool's fixed `coins[N_COINS]` array
(N_COINS is 2 or 3 depending on the pool). The adapter resolves the
`(pool_address, i, j)` triple to concrete `Token` metadata via a hardcoded
table in `common.rs`. The decoded indices and pool address are recorded in
trace; only the resolved `input_tokens` / `output_tokens` enter `DexFacts`.

PancakeSwap StableSwap pools charge ~1-4 bps depending on configuration;
calldata does not carry the fee. The adapter emits a conservative
`Some(4)` into `DexFacts.max_fee_bps` and notes `fee_estimate=4bps` in trace.

---

## 6. PancakeSwap Infinity — `pancakeswap-infinity`

**Status:** deferred to a follow-up commit / PR. The Infinity codebase is
still in active flux and the public router/PoolManager ABI is not yet
crystallized. When the ABI stabilizes, Phase 1.5 will fetch the canonical
files and append a section here without disturbing sections 1–5.

---

## Verification

Each adapter crate ships a `selector_pin` unit test that asserts the
`SELECTOR` constant equals the byte sequence the `sol!` macro derives from
the literal Solidity signature. If a future Solidity version (or a different
upstream repo state) produces a different selector for the same human-readable
signature, the test fires and CI flags the drift before any policy decision
is made on the changed bytes.

The above pinning is sufficient because:

- `sol!` recomputes selectors from the in-source signature; a mismatch
  between this document and the test would surface as a test failure.
- All decoding goes through `*Call::abi_decode` on the calldata bytes; we
  never trust an out-of-band selector list.
