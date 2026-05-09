# DexFacts Mapping Matrix (Phase 2)

For each new DEX adapter, this document enumerates every Solidity calldata
field and its destination in the engine's data model. The destination is
either a frozen `DexFacts` field (visible to Cedar policies) or `TRACE_ONLY`
(emitted into `DexTrace.steps` for audit, not visible to policies).

## Frozen `DexFacts`

Reference: `crates/policy-engine/src/core.rs:142-166`. The Cedar `DexContext`
is a closed schema; this work does **not** add any new fields.

```rust
pub struct DexFacts {
    pub protocol_ids: Vec<String>,
    pub input_tokens: Vec<Token>,
    pub output_tokens: Vec<Token>,
    pub total_input_usd: Option<UsdValuation>,                    // host-filled
    pub total_min_output_usd: Option<UsdValuation>,               // host-filled
    pub max_fee_bps: Option<u32>,
    pub has_zero_min_output: bool,
    pub has_external_recipient: bool,
    pub total_input_fraction_of_portfolio_bps: Option<u64>,        // host-filled
    pub allowances_cover_inputs: Option<bool>,                     // host-filled
    pub window_stats: Option<WindowStatsContext>,                  // host-filled
}
```

Adapters fill (at most) `protocol_ids`, `input_tokens`, `output_tokens`,
`max_fee_bps`, `has_zero_min_output`, `has_external_recipient`, plus
`oracle_requirements` and `trace`. All other `DexFacts` fields are populated
later by host enrichment.

## Cross-cutting note on `max_fee_bps`

`max_fee_bps` semantics across the new adapters are **coarse upper bounds**,
not precise execution prices:

| Adapter | Source of `max_fee_bps` |
|---|---|
| `pancakeswap-amm` | constant 25 (protocol-fixed) |
| `pancakeswap-v3` | calldata `fee / 100` (per-leg max in multicall/multi-hop) |
| `aerodrome-v1` | per-leg estimate `stable ? 5 : 30`, leg-wise max |
| `aerodrome-slipstream` | `None` (tickSpacing is not a fee) |
| `pancakeswap-stableswap` | constant `Some(4)` (conservative estimate) |

Policies that compare against `context.maxFeeBps` enforce a *ceiling on the
estimate*, never a real fee. Hosts that need precise fee enforcement must
introduce a fee oracle outside this work's scope.

---

## A. `pancakeswap-amm`

V2 fork. All six functions follow the same calldata shape; the table below
covers `swapExactTokensForTokens` and lists deltas for the other variants.

### `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)`

| Calldata field | Solidity type | Decoded Rust type | DexFacts target | Mapping rule | Notes / risks |
|---|---|---|---|---|---|
| `amountIn` | `uint256` | `U256` | `oracle_requirements[Input].raw_amount` | stringified | input side amount |
| `amountOutMin` | `uint256` | `U256` | `oracle_requirements[MinOutput].raw_amount` + `has_zero_min_output` | `==0` flips bool | guards against zero-minimum-output policy |
| `path` | `address[]` | `Vec<AlloyAddress>` | `input_tokens[0]`, `output_tokens[0]` | first/last via `path_endpoints` | intermediate hops dropped (mirrors Uniswap V2) |
| `to` | `address` | `AlloyAddress` | `has_external_recipient` | `to != tx.from` | flips bool when recipient differs from actor |
| `deadline` | `uint256` | `U256` | TRACE_ONLY | dropped | not policy-visible at v0.1 |
| (constant) | — | — | `max_fee_bps` | `Some(25)` | fixed PancakeSwap V2 fee |
| (constant) | — | — | `protocol_ids` | `vec!["pancakeswap-amm"]` | |

Variants:
- `swapTokensForExactTokens(amountOut, amountInMax, path, to, deadline)` — emits
  `amountInMax` as `Input.raw_amount` and `amountOut` as `MinOutput.raw_amount`.
- `swapExactETHForTokens(amountOutMin, path, to, deadline)` — `amountIn = tx.value_wei`,
  `path[0]` is WBNB sentinel.
- `swapETHForExactTokens` — `Input.raw_amount = tx.value_wei`,
  `MinOutput.raw_amount = amountOut`.
- `swapExactTokensForETH` / `swapTokensForExactETH` — output is BNB sentinel.

---

## B. `pancakeswap-v3`

V3 fork; selectors and struct layouts identical to Uniswap V3 SwapRouter.

### `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))`

| Calldata field | Solidity type | Decoded Rust type | DexFacts target | Mapping rule | Notes / risks |
|---|---|---|---|---|---|
| `params.tokenIn` | `address` | `AlloyAddress` | `input_tokens[0]` | TokenLookup with BSC defaults | UNKNOWN fallback |
| `params.tokenOut` | `address` | `AlloyAddress` | `output_tokens[0]` | TokenLookup | |
| `params.fee` | `uint24` | `u32` | `max_fee_bps` | `fee / 100` | 100/500/2500/10000 → 1/5/25/100 bps |
| `params.recipient` | `address` | `AlloyAddress` | `has_external_recipient` | `recipient != tx.from` | |
| `params.deadline` | `uint256` | `U256` | TRACE_ONLY | dropped | |
| `params.amountIn` | `uint256` | `U256` | `oracle_requirements[Input]` | stringified | |
| `params.amountOutMinimum` | `uint256` | `U256` | `oracle_requirements[MinOutput]` + `has_zero_min_output` | `==0` flips bool | |
| `params.sqrtPriceLimitX96` | `uint160` | `U256` | TRACE_ONLY | recorded as `"sqrtLimit=N"` | per-leg price clamp; not policy-visible |
| (constant) | — | — | `protocol_ids` | `vec!["pancakeswap-v3"]` | |

### `exactInput((bytes,address,uint256,uint256,uint256))`

| Calldata field | Solidity type | DexFacts target | Mapping rule |
|---|---|---|---|
| `params.path` (packed) | `bytes` | `input_tokens[0]`, `output_tokens[0]`, `max_fee_bps` | `decode_v3_path` → `(tokens, fees)`; first/last token; `Some(fees.iter().max() / 100)` |
| `params.recipient` | `address` | `has_external_recipient` | as above |
| `params.deadline` | `uint256` | TRACE_ONLY | |
| `params.amountIn` | `uint256` | `oracle_requirements[Input]` | |
| `params.amountOutMinimum` | `uint256` | `oracle_requirements[MinOutput]` + `has_zero_min_output` | |

`exactOutput*` mirror but populate `amountInMaximum` / `amountOut`.

`multicall(...)` — recursively calls each child via the same crate's
`Adapter` and merges results through `merge_dex_actions()` from
`crates/adapters/uniswap-v3/src/common.rs:168`. The merge takes the **max** of
per-child `max_fee_bps`, the **OR** of bool flags, and the **union** of
tokens / oracle requirements / trace steps.

---

## C. `aerodrome-v1`

V2-shape but with `Route[]` instead of `address[] path`.

### `swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)`

| Calldata field | Solidity type | Decoded Rust type | DexFacts target | Mapping rule | Notes / risks |
|---|---|---|---|---|---|
| `amountIn` | `uint256` | `U256` | `oracle_requirements[Input]` | stringified | |
| `amountOutMin` | `uint256` | `U256` | `oracle_requirements[MinOutput]` + `has_zero_min_output` | | |
| `routes` | `Route[]` | `Vec<Route>` | `input_tokens[0] = routes[0].from`; `output_tokens[0] = routes.last().to`; `max_fee_bps = max(stable?5:30 across legs)` | `route_endpoints()` + leg continuity check | rejects breaks with `BadCalldata` |
| `routes[i].stable` | `bool` | `bool` | TRACE_ONLY | `"routes=[A->B stable=false, ...]"` | per-leg pool kind |
| `routes[i].factory` | `address` | `AlloyAddress` | TRACE_ONLY | trace only | |
| `to` | `address` | `AlloyAddress` | `has_external_recipient` | `to != tx.from` | |
| `deadline` | `uint256` | `U256` | TRACE_ONLY | | |
| (constant) | — | — | `protocol_ids` | `vec!["aerodrome-v1"]` | |

`swapExactETHForTokens` and `swapExactTokensForETH` substitute `tx.value_wei`
for the input amount or use the ETH sentinel for output.

---

## D. `aerodrome-slipstream`

V3-shape with `int24 tickSpacing` instead of `uint24 fee`.

### `exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))`

| Calldata field | Solidity type | Decoded Rust type | DexFacts target | Mapping rule | Notes / risks |
|---|---|---|---|---|---|
| `params.tokenIn` | `address` | `AlloyAddress` | `input_tokens[0]` | TokenLookup with Base defaults | |
| `params.tokenOut` | `address` | `AlloyAddress` | `output_tokens[0]` | | |
| `params.tickSpacing` | `int24` | `i32` | TRACE_ONLY | `"tickSpacing=N"` | NOT a fee; cannot be mapped to bps |
| `params.recipient` | `address` | `AlloyAddress` | `has_external_recipient` | | |
| `params.deadline` | `uint256` | `U256` | TRACE_ONLY | | |
| `params.amountIn` | `uint256` | `U256` | `oracle_requirements[Input]` | | |
| `params.amountOutMinimum` | `uint256` | `U256` | `oracle_requirements[MinOutput]` + `has_zero_min_output` | | |
| `params.sqrtPriceLimitX96` | `uint160` | `U256` | TRACE_ONLY | | |
| (constant) | — | — | `max_fee_bps` | **`None`** | calldata does not carry fee |
| (constant) | — | — | `protocol_ids` | `vec!["aerodrome-slipstream"]` | |

`exactInput((bytes,...))` packs tickSpacing into the 3-byte path field; the
adapter's `decode_slipstream_path()` sign-extends the 3-byte value into `i32`.

`exactOutput*` mirror.

---

## E. `pancakeswap-stableswap`

Curve-style pool contracts; per-pool addresses, single function.

### `exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy)`

| Calldata field | Solidity type | Decoded Rust type | DexFacts target | Mapping rule | Notes / risks |
|---|---|---|---|---|---|
| `i` | `uint256` | `U256` (stored as `usize` once narrowed) | `input_tokens[0]` (via `(pool_address → coins[i])` lookup) | hardcoded table in `common.rs` | UNKNOWN fallback when pool not in table |
| `j` | `uint256` | `U256` (narrowed) | `output_tokens[0]` | as above | |
| `dx` | `uint256` | `U256` | `oracle_requirements[Input]` | stringified | |
| `min_dy` | `uint256` | `U256` | `oracle_requirements[MinOutput]` + `has_zero_min_output` | | |
| (call target) | — | `Address` | TRACE_ONLY | `"pool=0x..."` | which pool was hit |
| (constant) | — | — | `max_fee_bps` | `Some(4)` (conservative) | StableSwap fees ~1–4 bps |
| (constant) | — | — | `protocol_ids` | `vec!["pancakeswap-stableswap"]` | |
| (none) | — | — | `has_external_recipient` | `false` | exchange has no recipient param; output goes to `msg.sender` |

`tx.value_wei` is non-zero only for native-coin swaps in pools that include a
native side; the adapter does not differentiate at v0.1 (the exchange function
is `payable nonReentrant` for that purpose).

---

## F. `pancakeswap-infinity`

Deferred. Will be added in a follow-up commit once Phase 1.5 confirms the ABI.
