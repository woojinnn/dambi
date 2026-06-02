# Morpho — Onboarding Evidence Ledger

> Greenfield **re-run** of the ScopeBall protocol-onboarding framework on Morpho
> (`ONBOARDING_PROMPT.md`). Prior partial coverage (Morpho Blue Full-8, §9 worked
> example) is treated as **unverified** and re-derived from 1st-party sources, then
> diffed. New + re-verification converge on the same gates.
>
> This run also doubles as a **framework dogfood/test** — framework-level findings
> (not Morpho-specific) are logged in the "Framework Dogfood Findings" appendix and
> hardened per the "harden methodology on dogfood gap" rule, not patched per-instance.

## Run Metadata

| field | value |
|---|---|
| protocol | morpho |
| branch | feat/morpho-onboarding |
| worktree | /Users/jhy/Desktop/ScopeBall/scopeball-morpho |
| date | 2026-06-02 |
| main agent | Claude Opus 4.8 (1M context), this session |
| base commit | a8909023 (feat/registry-v2 — onboarding-framework-refactor) |

## Scope Classification

| field | value |
|---|---|
| primary chain(s) | Ethereum mainnet (`1`) primary; Base (`8453`) expansion |
| completion target | `wallet-facing` — Morpho Blue + MetaMorpho (ERC-4626 vaults) + Bundler, the surfaces a Morpho user actually signs |
| multichain expansion | included (mainnet + Base) for Morpho Blue; MetaMorpho/Bundler chain scope set by P0 research |
| direct factory-child calls | MetaMorpho vaults are factory children users call directly (ERC-4626); disposition (source-materialize vs concrete vs defer) decided in P0 |
| final claim label | TBD at P4 |

## P0 Research Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| completion scope declared: primary chain(s), wallet-facing vs full-surface/full-universe target, and multichain status | done | Scope Classification table above |
| Codex current-session research executed | done | this session WebFetched 1st-party: IMorpho.sol (raw.githubusercontent morpho-org/morpho-blue/main) → Morpho Blue 17 external fns re-verified; IMetaMorpho.sol (morpho-org/metamorpho) → ERC-4626+ERC-2612+curator surface; docs.morpho.org/get-started/resources/addresses/ → mainnet contract addresses. Repo-state inventory via Explore agent. |
| Claude Code or sub-agent research executed | done | sub-agents: Explore inventory `ab73ac99…` (current Morpho repo coverage); general-purpose deployments sweep `a01b32a2…` (all Morpho contracts 1+8453, running); general-purpose MetaMorpho vault cover-batch (running). (First two general-purpose research agents `ab883151…`/`ae9b7dcf…` died on a process-exit; relaunched.) |
| Claude/sub-agent exact prompt or command recorded | done | prompts embedded in Agent calls this session (deployments sweep + vault cover-batch + repo inventory); all read-only, no repo writes |
| Codex-only candidates listed | done | this session's own fetches surfaced VaultV2Factory / V2 adapter factories / MorphoRegistry from blue-sdk that the docs page alone underemphasized; recorded in _deployments.json |
| Claude/sub-agent-only candidates listed | done | deployments agent surfaced per-chain Base addresses (blue-sdk chain-keyed) + URD instance example + the MORPHO two-token ambiguity; vault agent surfaced the 106-vault universe + 16-vault TVL cover-batch (blue-api GraphQL) |
| dropped-unverified candidates listed with reason | done | MetaMorpho V1.0 [OLD] factory on Base = NOT FOUND first-party (dropped); URD instances beyond 1 example = not enumerable from static sources (deferred); MORPHO "which is transferable" left as both-tracked (Etherscan ContractName verified: 0x58d9..=ERC1967Proxy, 0x9994..=MorphoToken) |
| final contract inventory verified against first-party sources | done | Morpho Blue `0xbbbb…effcb` (1+8453) re-verified vs IMorpho.sol → Full-8 CORRECT. All other contracts in `_deployments.json` from docs.morpho.org/addresses + blue-sdk addresses.ts; MetaMorpho v1.0/v1.1 + MORPHO ABIs fetched from Etherscan/Basescan v2 (verified). `check:surface` I0 = `✓ morpho: 33 deployed · 2 cover · 31 exclude`. |
| pool-heavy/factory protocol address universe source/query/count recorded, or explicitly not applicable | done | MetaMorpho vault universe via `blue-api.morpho.org/graphql vaults(where:{chainId_in:[N],listed:true})`: mainnet=73, base=33 (countTotal). `surface/morpho/_address_universe.json` source_count=106. |
| pool-heavy/factory universe artifact is machine-readable, nonzero, and committed, or explicitly not applicable | done | `surface/morpho/_address_universe.json` — 106 candidates, machine-readable, committed in P0 |
| every pool/factory child address in universe dispositioned as cover/exclude/defer with reason and batch boundary | done | 16 cover (`metamorpho-top-tvl-cover` batch, top-8/chain by TVL) + 90 defer (`metamorpho-longtail-defer`, below cutoff, same surface). batch_boundary = blue-api listed:true snapshot 2026-06-02. |
| concrete manifest vs protocol source resolver/generator strategy decided for pool universe | done | **concrete `$to`-keyed manifests grouped by (chain, underlying)** for the 16 cover vaults (gate-native: `gatedSourceAddresses` only hardcodes token/uniswap sources, so a custom resolver would false-fail I2). Full 106-vault source-resolver materialization = documented follow-up. |
| direct factory-child calls are covered, source-materialized, or explicitly deferred separately from router/live-input discovery | done | vaults are factory children users call directly (ERC-4626) → covered via concrete cover-batch manifests; long-tail deferred (universe). Router (Bundler3) calls deferred separately (_deployments DEFER). |
| `npm run check:universe -- --protocol <protocol>` output recorded for pool/factory/vault-heavy protocols, or explicitly not applicable | done | `PASS — 106 candidates · 16 cover · 0 exclude · 90 defer · source_count=106` |
| token-surface inventory completed or explicitly scoped out | done | 20 token files: 16 MetaMorpho vault shares (`yield_receipt`, decimals=18 by DECIMALS_OFFSET design, underlying ref) + msETH(Base) underlying + 3 MORPHO governance (0x58d9.. on 1+8453, 0x9994.. legacy). `check:tokens` PASS (0 errors). Underlyings USDC/WETH/USDT/WBTC/PYUSD/RLUSD/USDtb already registered. |
| `registryV2/surface/<protocol>/_deployments.json` updated if applicable | done | authored `surface/morpho/_deployments.json` — 33 contracts (1+8453); Morpho Blue cover; factories/IRM/oracle/V2/registry exclude; Bundler3+GeneralAdapter1+ParaswapAdapter+URD marked explicit DEFER (user-facing, follow-up) |
| `npm run check:surface` output recorded | done | At P0: I0 `✓ morpho: 33 deployed · 2 cover · 31 exclude`; the 64 `I2 cover→manifest` for the 16 vaults × 4 selectors were expected-pending (manifests authored in P1). After P1: full PASS (see P4 check:surface row — MetaMorpho 4 cover/32 manifests per chain). |

## P1 Authoring Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| every COVER selector mapped to existing ActionBody or Tier3 requirement | done | Morpho Blue 8 = existing (re-verified). MetaMorpho: deposit/mint → `LendingAction::Supply`, withdraw/redeem → `LendingAction::Withdraw`, all carrying new `LendingVenue::MetaMorpho{chain,vault}` (Tier-3 venue). |
| permission/fund-movement/red-flag selector review recorded | done | MetaMorpho permission review: approve/permit/transfer/transferFrom on the vault SHARE token = standard ERC-20/2612 (tokens:erc20 adapter, token-surface) — NOT excluded silently. No protocol-specific permission primitive on the vault (no setAuthorization-equivalent; curator/allocator/guardian = timelocked governance, EXCLUDE). Morpho Blue setAuthorization (the core grant) already covered. |
| manifest files added/changed listed | done | 40 new: `registryV2/manifests/morpho/metamorpho/<chain>-<underlying>-<deposit\|withdraw\|mint\|redeem>@1.0.0.json` (grouped by chain×underlying; `venue.vault=$to`, baked underlying asset). Morpho Blue manifests unchanged. |
| enrichment/live_field decision recorded for every COVER action | done | deposit/withdraw = asset-denominated (user-legible → no enrichment needed). mint/redeem = SHARE-denominated (abstract) → §4d `convertToAssets` enrichment **DEFERRED** (documented; deposit/withdraw asset-legibility mitigates; Lido §9.9 follow-up pattern). All `live_inputs` = skeleton `derived_from` placeholders (vault-state/share-price prod-fill deferred). |
| required remote policy-RPC/live/enrichment methods have local handler, configured endpoint test, or explicit blocker | done | live_inputs are skeleton (decode does not fetch; policy-RPC dormant). No live handler required for the decode/verdict path. Enrichment calc_ids (`metamorpho_*_skeleton`) named for future wiring. |
| Tier3 not needed or full Tier3 downstream contract completed | done | Tier-3 = new **venue** `LendingVenue::MetaMorpho{chain,vault}` (NOT a new action/domain — reuses Supply/Withdraw). Mirrors the Fluid/MorphoOptimizer ERC-4626 vault venue. |
| Tier3 files listed if applicable: ActionBody/effect/view/sync/lowering_v2/cedarschema/schema registration/conformance test | done | `action/src/lending/mod.rs` (enum variant + `name()`="metamorpho" + `#[serde(rename="metamorpho")]`); `lowering_v2/lending/mod.rs` (shares `{chain,vault}` arm + unit test); `transition/effect/lending/mod.rs` (position_id + venue_tag + venue_chain) + `supply.rs` (receipt-amount, reuses fluid ERC-4626 share math); `action/src/view.rs` (conformance `assert_venue!`); `schema/policy-schema/core.cedarschema` (doc; `vault?` field REUSED — no new field). **No Cedar action-registration** (venue reuses already-registered Supply/Withdraw actions — unlike §9.7 SetAuthorization which was a new action). All venue tests green (policy-engine 19, policy-action 331, policy-transition 5). |
| `npm run check:manifest` or protocol-filtered validate output recorded | done | `check:manifest`: 1521 single_emit OK, 0 structural errors. `v3-harness validate --filter metamorpho`: 64 manifest(s) OK (16 vaults × 4 selectors), 0 errors. build-index: 53041 callkeys / 826 manifests. |

## P2 Synthetic Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| fuzz command with seed recorded | done | `v3-harness fuzz --filter metamorpho --iters 5000 --seed 0x6d6574616d6f7270` → total=4096 pass=4096 soft=0 fail=0 panic=0; 100% lending domain |
| iterations >= 5000 or justified lower bound | done | requested 5000; harness caps at 64 iters/callkey × 64 callkeys = 4096 synthetic inputs (all 16 vaults × 4 selectors × both chains), 0 failures |
| fixed edge-case matrix recorded | done | fuzz includes EDGE_ITERS (boundary values: 0, U256::MAX, etc.) per callkey; real-tx corpus adds natural edges (tiny/large deposits, full redeem) |
| permission/value/nested/array/opcode/deadline/path edge coverage recorded | done | ERC-4626 deposit/withdraw/mint/redeem are flat (uint256,address[,address]) — no nested/array/opcode/deadline. Permission edge = the vault-share approve/transfer boundary (corpus: pass/token, not metamorpho) — verifies the token-vs-protocol manifest split. |
| representative pass/error corpus entries committed or justified | done | `data/golden/v3-decode/metamorpho/corpus.json` — 24 entries: 22 pass (deposit/withdraw/redeem/mint→lending + approve/transfer→token) + 2 error (reallocate/updateWithdrawQueue → no_declarative_v3_mapper) |

## P2 Real-Tx Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| Etherscan MCP/API availability checked | done | Etherscan v2 (ETHERSCAN_API_KEY local) — chain 1 txlist WORKS; chain 8453 (Base) txlist BLOCKED on free tier ("Free API access is not supported for this chain") → Base via Dune. (Base `getabi` contract-module DID work — used for the Base snapshot.) |
| Etherscan txlist pull executed adapter-blind by P0 cover addresses | done | 8 mainnet cover vaults, `account&action=txlist&offset=250&sort=desc` each (adapter-blind) |
| external tx pull target address count is nonzero and recorded | done | mainnet: 8 vault targets (Etherscan); Base: 8 vault targets (Dune) = 16/16 cover vaults swept |
| Etherscan `api_calls_used` recorded | done | 8 txlist calls (mainnet) + 12 getabi (snapshots/MORPHO) ≈ 20 calls |
| Etherscan `raw_txs_seen` recorded | done | ~1,400 mainnet direct-call txs across 8 vaults (≤250 each) |
| Etherscan `unique_selectors_seen` recorded | done | deposit 0x6e553f65, redeem 0xba087652, withdraw 0xb460af94, mint 0x94bf804d (COVER) + reallocate 0x7299aa31, approve, updateWithdrawQueue, acceptCap, transfer (EXCLUDE/token) |
| Etherscan real tx coverage per COVER selector recorded | done | mainnet direct calls: deposit **160**, redeem **109**, withdraw **41**, mint **1** (mint sparse — most users deposit). All 4 COVER selectors observed on real direct calls. |
| wallet-facing target sweep executed or explicitly not applicable, with target count, per-target floor, raw/matched tx counts, and target file | done | the cover-batch VAULTS are the wallet-facing targets (ERC-4626 factory children). 16 targets (8/chain), per-target floor ~250 (mainnet)/Dune-sampled (base). corpus = 24 matched. target file = `surface/morpho/_address_universe.json` (cover batch). |
| unmatched Etherscan txs classified as actionable/non-actionable with disposition counts | done | non-actionable: reallocate (243, allocator gov), approve (196, token), updateWithdrawQueue (5, gov), acceptCap (3, gov), transfer (18, token). All map to EXCLUDE triage or tokens:erc20 — no actionable unmatched. Bundler3-routed deposits (to=Bundler3, not vault) are the DEFERRED router surface (not in vault txlist). |
| pool-heavy/factory protocols swept candidate/universe addresses, not only selected cover addresses, or explicitly not applicable | done | swept all 16 COVER vaults. The 90 DEFER long-tail vaults (universe) not swept this round — explicit defer (batch `metamorpho-longtail-defer`); full-universe sweep is the documented follow-up. |
| unknown to-addresses with known protocol selectors bucketed as P0/P2 hard gaps | done | none — every swept tx had to=cover-vault (txlist is address-keyed). No unknown-address metamorpho-selector gap. |
| typed-data signing corpus/golden executed for every in-scope EIP-712 primaryType/witnessType, or explicitly not applicable | done | NOT APPLICABLE — MetaMorpho adds NO bespoke EIP-712 — its only signed struct is standard ERC-2612 `Permit` on the vault share (handled by the tokens:erc20/2612 standard path, EXCLUDE from metamorpho surface). Morpho Blue `Authorization` typed-data is already covered (morpho/corpus.json). |
| Dune MCP/API availability checked | done | Dune MCP available; plan `community_fluid_engine_v2` |
| Dune usage baseline recorded | done | baseline 400.362 / 2500 credits used (billing 2026-05-05 → 2026-06-05) |
| Dune calibration/query executed with partition WHERE or explicitly blocked | done | query 7637092 on `base.transactions`, partition WHERE `block_date >= CURRENT_DATE - INTERVAL '45' DAY`, free engine. Filter: to IN (8 base cover vaults) AND selector IN (deposit/withdraw/redeem/mint). |
| Dune `executionCostCredits` / usage delta recorded | done | executionCostCredits = **2.692** (free engine) |
| Dune rows returned / selected tx hashes recorded | done | 40 rows (deposit+redeem); 9 selected into corpus (e.g. 0xd327b9ad.., 0xfa449c39.., 0x301692bf.., 0x29be6dca.., 0x6645d4fa..) across vaults 0xee8f4e/0xbeefe9/0xbeef010f/0x1401d1/0xa0e430 (USDC + WETH) |
| representative real-tx corpus/golden entries committed or justified | done | `metamorpho/corpus.json` 24 entries (15 mainnet Etherscan + 9 Base Dune), 22 with field-level expect_body pins |
| protocol-filtered corpus replay executed with semantic pin gate: `v3-harness corpus --filter <protocol> --require-expect-body` | done | `v3-harness corpus --filter metamorpho --require-expect-body` → **24/24 matched, 22/22 pass entries pinned** (venue.vault + asset.address + amount + party verified vs real decoded body, both chains) |

## P3 Develop Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| all P2 hard/soft/misdecoded/unknown_protocol_address/excluded gaps bucketed | done | NO decode gaps (corpus 24/24, fuzz 4096/4096, 22/22 pins). Buckets are all DEFERRALS: (1) Bundler3 router surface (most app deposits route there, to=Bundler3 not vault); (2) 90-vault long-tail universe; (3) mint/redeem §4d convertToAssets enrichment; (4) Base withdraw/mint real-tx (Dune sample returned deposit/redeem only — covered by mainnet withdraw + synthetic). |
| each fix tied to a gap id, selector, tx hash, or synthetic seed | done | 2 code fixes from gates (not decode gaps): policy-sync `actions/args.rs` non-exhaustive `LendingVenue::MetaMorpho` (caught by `cargo test --workspace`); clippy identical-match-arms in `effect/lending/supply.rs` (Fluid+MetaMorpho combined). |
| manifest/decoder/Tier3/harness change list recorded | done | Tier-3 venue = 6 crate sites (action/lending/mod.rs, lowering_v2/lending/mod.rs, transition/effect/lending/{mod,supply}.rs, sync/actions/args.rs, action/view.rs) + cedarschema doc. 40 manifests. 20 token files. NO declarative_exports/decoder change (venue driven by emit.body `venue.name`+`$to`; no keccak/derive needed unlike Morpho Blue market_id). |
| P2 rerun after fixes recorded | done | after policy-sync + clippy fixes: `v3-harness corpus --filter metamorpho --require-expect-body` re-run → 24/24, 22/22 (fixes touched effect/sync paths, not decode — corpus unaffected, confirmed). |
| corpus `expect` flips or exclusions justified | done | no flips — every corpus `expect` (pass/error/domain) was correct on first decode. |
| remaining gaps have explicit defer/blocker disposition | done | Bundler3 (DEFER, _deployments + evidence), 90-vault long-tail (DEFER, _address_universe batch), mint/redeem enrichment (DEFER §4d), Base withdraw/mint real-tx (DEFER — mainnet+synthetic cover the decode). |

## P4 Land Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| `registryV2 npm run build` output recorded | done | `done — 53041 callkey(s) + 84 typed-data entr(ies) across 826 manifest(s)` (deterministic; index is gitignored/generated — not committed) |
| registryV2 build-index vitest output recorded | blocked | browser-extension Yarn 4 / WASM not provisioned in this onboarding worktree ("Couldn't find the node_modules state file"). build correctness is covered by `npm run build` (validates every manifest+token) + `check:manifest` (1521 OK) + `check:surface` + `check:universe`. Rerun target: `cd browser-extension && yarn && yarn vitest run --root ../registryV2 scripts/__tests__/build-index.test.ts`. |
| `npm run check:manifest` output recorded | done | `1521 single_emit OK, 0 structural errors` (representative index + source-ref) |
| `npm run check:surface` output recorded | done | `PASS — every gated contract's external surface is fully triaged and consistent` (I0 morpho 33/2/31; MetaMorpho 4 cover/30 exclude/32 manifests per chain; Morpho Blue 7 cover/10 exclude/7 manifests) |
| `npm run check:universe -- --protocol <protocol> --require-cover-linkage` output recorded for pool/factory/vault-heavy protocols, or explicitly not applicable | done | `PASS — 106 candidates · 16 cover · 90 defer · source_count=106` (cover-linkage verified: all 16 cover vaults have generated by-callkey entries) |
| v3-harness coverage/fuzz/corpus outputs recorded | done | fuzz 4096/4096 pass (seed 0x6d6574616d6f7270); corpus 24/24 matched; validate --filter metamorpho 64 OK |
| protocol-filtered strict corpus output recorded: `v3-harness corpus --filter <protocol> --require-expect-body` | done | `24/24 matched, 22/22 pass entries pinned` |
| `cargo test --workspace` output recorded | done | `--exclude policy-engine-integration-tests` → 0 fail (all crates: policy-action 331, policy-transition 418, policy-engine 122, policy-sync 149, …). integration-tests: lib 18 + doc_grounding 1 + `v3_decode_harness -- --test-threads=4` **60 passed / 0 failed** (bounded to avoid FW-1 OOM). Net workspace = 0 fail. |
| wasm build output recorded if runtime/wasm/schema changed | done | `./scripts/wasm-build.sh` → exit 0, `✨ Done in 2m 18s`, pkg ready + copied to `browser-extension/backend/wasm/` + `public/wasm/`. The `LendingVenue::MetaMorpho` venue + cedarschema change compile cleanly to WASM (the extension can decode MetaMorpho manifests). |
| fmt/clippy/typecheck output recorded for changed crates/packages | done | `cargo fmt -p policy-action -p policy-transition -p policy-engine -- --check` clean (exit 0); `cargo clippy` clean after combining the Fluid+MetaMorpho identical arm. |
| exact staged files and commit hash recorded | done | P0 `b67f7eb6` (27 files: surface + tokens + evidence). P1 `a8bba544` (47: 6 code/schema + 40 manifests + evidence). P2 `b24dc26c` (2: corpus + evidence). P3/P4 land = the commit carrying this evidence (3 files: `sync/actions/args.rs` + `effect/lending/supply.rs` fixes + this evidence.md). Generated `registryV2/index/` and `pkg/` WASM are gitignored — not staged. |
| remaining WARNs/deferred selectors/actions listed with reason | done | Deferred: Bundler3+adapters (router, follow-up), 90-vault long-tail (universe batch), VaultV2/URD (V2/rewards follow-up), mint/redeem §4d enrichment, Base withdraw/mint real-tx. WARNs: I0' (16 cover vaults not in _deployments — expected, factory children, same as uniswap pools); 21 UNGATED protocol contracts (other protocols). |
| final completion label recorded without overclaiming wallet-facing/full-universe/multichain scope | done | **wallet-facing, mainnet (1) + Base (8453): Morpho Blue (re-verified Full-8) + MetaMorpho ERC-4626 16-vault TVL cover-batch (deposit/withdraw/mint/redeem).** NOT covered (explicit defer): Bundler3-routed flows, the 90-vault long-tail universe, MetaMorpho V2/VaultV2, URD claim. |
| no base/worktree merge performed unless user explicitly requested it | done | no merge performed; all work on `feat/morpho-onboarding`. |

## Blockers

| blocker | source | next action |
|---|---|---|
| registryV2 build-index **vitest** not run | browser-extension Yarn 4 / WASM toolchain not provisioned in this onboarding worktree ("Couldn't find the node_modules state file") | non-fatal — build correctness is covered by `npm run build` + `check:manifest` (1521 OK) + `check:surface` + `check:universe`. Rerun: `cd browser-extension && yarn && yarn vitest run --root ../registryV2 scripts/__tests__/build-index.test.ts`. |

## Framework Dogfood Findings (this run = framework test)

| id | finding | severity | disposition |
|---|---|---|---|
| FW-1 | Full `npm run build` index = ~53k callkeys / 210M; `adapters::load_and_install()` has no caching → each harness test pays ~35–41s full-surface load; the 60-test `v3_decode_harness` golden suite OOMs (SIGKILL) under DEFAULT parallel threads. Pre-existing (identical in base worktree), not Morpho-specific. | medium | **RESOLVED for this run** via `cargo test … --test v3_decode_harness -- --test-threads=4` → **60 passed / 0 failed in 27.91s** (bounded threads cap peak memory). Framework-hardening follow-up (a shared `OnceCell` surface cache, or a representative-index harness mode) would remove the need to bound threads — logged as a framework finding, not a Morpho blocker. |

## Final Completion Claim

Do not write "onboarding complete" unless every mandatory P0/P1/P2/P3/P4 row is `done` or has a concrete `blocked` disposition and this passes:

```bash
cargo run -p policy-engine-integration-tests --bin check-onboarding-evidence -- morpho --phase all
```
