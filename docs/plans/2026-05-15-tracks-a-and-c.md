# Plan: Tracks A (policy-rpc hardening) + C (policy-engine lowering completion)

**Created**: 2026-05-15
**Scope**: Phase 1 only — first 2 weeks. Topics B and D deferred.
**Branches**: TBD per track; both target `main`.

## Context

Audit on 2026-05-15 surfaced two structural gaps in the platform:

1. `policy-rpc` ships 8/9 methods as mocks (see `policy-rpc/src/methods/mock-host-capabilities.ts:19-64`). `oracle.usd_value` is the only live method and reads single-source CoinGecko with no staleness gate. Reasonable for the prior DEX-only demo but unfit as an enterprise-wallet backend.

2. `policy-engine` defines 35 `Action` variants but only the 7 DEX variants reach Cedar evaluation (`crates/policy-engine/src/lowering/dispatch.rs:64-73`). Lending (9), staking (3), restaking (3), and several misc variants resolve to envelopes via mappers but the dispatch returns `None`, causing **silent policy bypass**. Schema files and action structs already exist — the missing piece is lowering + dispatch wiring.

The two are independent codebases (TypeScript service vs Rust crates) and can proceed in parallel. Topic B (extension cleanup) and Topic D (adapter registry / WASM pull) are deferred.

> Note: decoder, mapper, and call-adapter work for non-DEX protocols is owned by another contributor. Track C below only adds **lowering + dispatch**; the end-to-end integration test is stubbed until adapter PRs land.

---

## Track A — policy-rpc hardening

### A0. Foundation (prereq, ~1d)
Wire dependency surface that A1–A3 depend on.

- [ ] Add `viem` dependency (`policy-rpc/package.json`) for ERC20 ABI + multicall + `eth_call` helpers
- [ ] Add `RPC_URL_BY_CHAIN` config in `src/chain-config.ts` (env-overridable, fall back to public RPC)
- [ ] New `src/eth-provider.ts`: thin wrapper around viem `createPublicClient` keyed by `chain_id`, with built-in retry + timeout
- [ ] Add `tinybench` for micro-benchmarks; baseline `oracle.usd_value` p99 latency

**Acceptance**: `yarn test` green; `yarn bench:oracle-baseline` writes baseline numbers to `bench/baseline.json`.

### A1. Multi-source oracle aggregator (~3-4d)
Replace single-source CoinGecko with deviation-checked median across three sources.

- [ ] `src/oracle/source.ts` — `OracleSource` interface: `fetch(chainId, token): Promise<{ usd: bigint, decimals: number, observedAt: ms, sourceId: string }>`
- [ ] `src/oracle/sources/chainlink.ts` — reads Chainlink price feeds via `eth_call` to aggregator address. Per-token feed registry (start with USDC/USDT/WETH/WBTC/DAI on mainnet)
- [ ] `src/oracle/sources/coingecko.ts` — refactor existing client behind the interface
- [ ] `src/oracle/sources/uniswap-v3-twap.ts` — `observe()` call to V3 pool, computing 30-min TWAP. Token→pool registry
- [ ] `src/oracle/aggregator.ts` — `OracleAggregator` class:
  - Fires all sources in parallel
  - Drops responses past per-source staleness budget (Chainlink 1h, TWAP 30min, CoinGecko 5min)
  - Returns `Err("all_sources_stale")` if 0 surviving
  - Returns single value if 1 surviving (record as "low confidence")
  - Computes median of ≥2 sources
  - If any source deviates >3% from median, drop it and recompute (flash-loan defense)
  - If post-deviation set is empty, return `Err("oracle_disagreement")`
- [ ] Refactor `src/methods/oracle-usd-value.ts` to call aggregator and populate `UsdValuation.sources[]` with which sources contributed
- [ ] Tests with mocked sources covering: happy median, staleness drop, deviation drop, all-stale fail, all-fail fail

**Acceptance**:
- Unit tests cover all 5 paths above
- `curl /v1/rpc` for USDT returns 3 sources in `UsdValuation.sources[]`
- Deviation > 3% test fails with `oracle_disagreement` error code
- p99 latency ≤ 2× baseline (parallel fan-out)

### A2. Live chain-state methods (~2-3d)
Replace `approval.allowance` and `portfolio.balance` mocks with real `eth_call`.

- [ ] `src/methods/approval-allowance.ts` — `ERC20.allowance(owner, spender)` via `eth_call`
- [ ] `src/methods/portfolio-balance.ts` — `ERC20.balanceOf(owner)` for tokens + `eth_getBalance` for native
- [ ] Both use multicall when batched in a single RPC payload
- [ ] `src/methods/registry.ts` — swap mock entries to live impls behind a feature flag (`LIVE_METHODS=approval.allowance,portfolio.balance` env)
- [ ] Tests with anvil/forking or mocked RPC responses

**Out of scope this sprint**: `stat_window.*` (depends on subgraph integration), `clock.now` (already trivial).

**Acceptance**:
- Hitting `approval.allowance` for a known onchain pair (e.g. Vitalik → USDC approval) returns correct value within 1 wei of Etherscan
- Batched `portfolio.balance` for 10 tokens completes in 1 multicall round-trip
- Feature flag rollback works (set env to empty → mocks resume)

### A3. Concurrency layer (~2-3d)
Coalesce duplicate concurrent requests, cache short-TTL, fail fast under upstream pressure.

- [ ] `src/cache/coalescer.ts` — generic `coalesce<K, V>(key, fn)` using `Map<K, Promise<V>>`. Identical in-flight keys share one upstream call
- [ ] `src/cache/ttl.ts` — keyed TTL store with jitter (10s ± 2s). On read: hit returns cached; miss enters coalescer
- [ ] `src/cache/circuit-breaker.ts` — per-source CB: closed → 3 fails → open (60s) → half-open (1 probe) → closed/open
- [ ] Wire oracle aggregator's sources through CB; wire `eth_call` through coalescer + TTL
- [ ] Tests: 100 concurrent identical requests = 1 upstream call; CB toggle behavior; jitter prevents thundering-herd

**Acceptance**:
- Load test (`yarn bench:concurrency`) shows: 1000 req/s with 10 unique tokens → ≤10 upstream RPC calls per second to each source
- CB simulated failure: 3 in a row trigger open state; probe after 60s
- Coverage on cache/coalescer/CB ≥ 90%

### A4. Verification (~1d)
- [ ] Run baseline → optimized bench comparison; document delta
- [ ] Stale-source flash-loan attack simulation (one source spikes 50% in single block) — confirm aggregator rejects
- [ ] Capture metrics shape for future Prometheus export (don't add Prometheus yet; just structure logs)

### Out of scope for Track A this sprint
- Rust port (decide after this sprint based on load-test outcomes; criteria in main plan)
- `stat_window.*` live impl (subgraph integration is a separate spike)
- Audit log persistence (in-memory ring is fine for now)
- Multi-region deploy / HA

---

## Track C — policy-engine lowering completion

### C0. Dispatch hardening (~0.5d, no-protocol prerequisite)
Replace silent `None` with explicit semantics so future missing variants don't bypass policy.

- [ ] Add `UnsupportedAction { kind: String }` variant to a new `LoweringError` enum, or change return type of `policy_request_from_envelope` to `Result<PolicyRequest, LoweringError>`
- [ ] Update all callers (extension WASM bridge, integration tests). Callers convert error → engine_error verdict
- [ ] Update `dispatch.rs:64-73` match to cover all 35 variants. For variants without lowering yet, return `Err(UnsupportedAction { kind: ... })` explicitly
- [ ] Test: synthetic envelope with unknown action returns `Err` (not silent pass)

**Acceptance**: `cargo test -p policy-engine` green; new unit test confirms each currently-unsupported variant returns a distinct error.

### C1. Lending lowering (9 variants, ~3-4d)
Files mirror `lowering/dex/` shape. Each implements `Lower for <Action>Action`.

Files to add under `crates/policy-engine/src/lowering/lending/`:
- [ ] `supply.rs` — Action::Supply context: `asset`, `amount`, `market?`, `onBehalf`, `amountMode?`
- [ ] `withdraw.rs` — Action::Withdraw context: `asset`, `amount`, `market?`, `recipient`, `amountMode?`
- [ ] `borrow.rs` — Action::Borrow context: `asset`, `amount`, `market?`, `recipient`, `onBehalf`, `amountMode?`, `validity?`
- [ ] `repay.rs` — Action::Repay context: `asset`, `amount`, `market?`, `onBehalf`, `repayKind?`
- [ ] `liquidate.rs` — Action::Liquidate context: `debtAsset`, `collateralAsset`, `debtAmount`, `collateralAmount?`, `borrower`, `kind`, `mode`
- [ ] `flash_loan.rs` — Action::FlashLoan context: `assets[]`, `amounts[]`, `kind`, `validity?`
- [ ] `set_authorization.rs` — Action::SetAuthorization context: `delegate`, `scope`, `enabled`, `contractRef?`
- [ ] `sign_authorization.rs` — Action::SignAuthorization context: `delegate`, `scope`, `nonce`, `validity?`
- [ ] `revoke.rs` — Action::Revoke context: `target`, `kind`
- [ ] `mod.rs` — re-exports
- [ ] Update `lowering/mod.rs` to include `lending` module
- [ ] Update `dispatch.rs` match arms to call `.build(&ctx)` for each lending variant
- [ ] Add `lending` constants to `context_keys.rs` where new keys appear

**Acceptance**: For each variant, a unit test (mirroring `lowering/dex/swap.rs` test pattern) builds a synthetic `<Action>Action`, runs `Lower::build`, and asserts the resulting Cedar context JSON matches an expected fixture.

### C2. Staking lowering (3 variants, ~1-2d)
- [ ] `lowering/staking/stake.rs` — context: `asset`, `amount`, `protocol?`, `validity?`
- [ ] `lowering/staking/request_unstake.rs` — context: `asset`, `amount`, `protocol?`
- [ ] `lowering/staking/claim_unstake.rs` — context: `asset`, `recipient`, `protocol?`
- [ ] `lowering/staking/mod.rs` + dispatch wiring
- [ ] Unit tests per variant

### C3. Restaking lowering (3 variants, ~1-2d)
- [ ] `lowering/restaking/restake.rs`
- [ ] `lowering/restaking/request_restake_withdrawal.rs`
- [ ] `lowering/restaking/claim_restake_withdrawal.rs`
- [ ] `lowering/restaking/mod.rs` + dispatch wiring
- [ ] Unit tests per variant

### C4. Stub policies + sample policy library (~1d)
- [ ] Add `policies/lending/max-borrow-usd-1000.cedar` + matching `.policy-rpc.json` manifest requiring `oracle.usd_value` on the borrowed asset
- [ ] Add `policies/staking/min-validity-days-1.cedar` (simple no-manifest example using `context.validity`)
- [ ] Update `extension/scripts/copy-default-policies.js` already auto-bundles; verify after build

**Acceptance**: `yarn build:chrome` includes new policies in `default-policies/policy-set.json`. Manual sanity: extension popup lists them in the catalog.

### C5. Integration test stubs (~0.5d)
- [ ] Add `tests/lending_integration.rs` skeleton with `#[ignore]` test that documents the future E2E flow (real Aave V3 calldata → decoder → mapper → envelope → lowering → Cedar → verdict)
- [ ] When adapter PRs land, remove `#[ignore]`

### Out of scope for Track C this sprint
- Decoders/mappers/call-adapters for lending/staking/restaking (owned by another contributor)
- Misc actions (`ClaimRewards`, `Delegate`, `Vote`, `SignMessage`) — leave `Err(UnsupportedAction)` from C0
- E2E integration test with real protocol calldata (depends on adapter PRs)
- Cedar schema changes (schema files already exist under `policy-schema/actions/`)

---

## Inter-track contract

The only point where the two tracks could meet is host method demand from new manifests:
- **C4's `max-borrow-usd-1000` policy** declares a `requires` entry for `oracle.usd_value`. This is already covered by Track A's existing live method (A1 just makes it better).
- No new host methods are introduced this sprint. Future lending policies that need health-factor, LTV, etc., are explicitly deferred and would add new methods to policy-rpc — a separate sprint.

**Decision**: Tracks are fully independent for Phase 1. No coordination overhead.

---

## Risks

| Risk | Mitigation |
|---|---|
| Chainlink feeds don't exist for some tokens on some chains | Aggregator gracefully degrades to remaining sources; A1 acceptance includes per-token feed config audit |
| TWAP source on illiquid pools returns wildly inaccurate values | Deviation filter catches; aggregator returns `oracle_disagreement` instead of bad price |
| Adapter PRs land mid-sprint with conflicting lowering expectations | C0 dispatch hardening returns explicit `UnsupportedAction` errors — adapter PR can land without lowering and engine still fails-closed correctly |
| Cedar schema files for lending/staking missing fields C1–C3 want to expose | Verify schema before lowering each variant; treat missing schema as schema PR before lowering PR |
| Multicall RPC limits exceeded under load | Coalescer + per-token cache (A3) reduces unique upstream calls; A4 load test catches it |

---

## Execution

This plan is the source of truth for the next 2 weeks. Sub-tasks are dispatchable to parallel subagents:

- **A0**: lightweight foundation, one engineer ~1d
- **A1, A2, A3** can run with some parallelism after A0 lands; A3 can integrate concurrently
- **C0**: blocker for everything in Track C, do first (~0.5d)
- **C1, C2, C3**: independent after C0 — can run in parallel by category
- **C4, C5**: end-of-sprint glue

Recommended first wave (run in parallel):
1. Subagent X: **Track A — A0 + A1 (oracle aggregator)** — TypeScript work in `policy-rpc/`
2. Subagent Y: **Track C — C0 + C1 (dispatch hardening + lending lowering)** — Rust work in `crates/policy-engine/`

After both return:
- Subagent X: A2 → A3 → A4
- Subagent Y: C2 → C3 → C4 → C5

Each subagent commits to its own branch and opens a PR to main. Cross-track merges in arrival order; no rebase coordination needed.
