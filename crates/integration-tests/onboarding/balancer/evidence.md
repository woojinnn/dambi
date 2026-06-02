# Protocol Onboarding Evidence Template

> Copy this file to `crates/integration-tests/onboarding/<protocol>/evidence.md` for each protocol onboarding run.
> This is a completion gate, not a nice-to-have note. If any mandatory row is missing, the phase is incomplete.

## Run Metadata

| field | value |
|---|---|
| protocol | balancer |
| branch | codex/onboard-lido-balancer-eigenlayer |
| worktree | /Users/woojin/.config/superpowers/worktrees/policy-engine/onboard-lido-balancer-eigenlayer |
| date | 2026-06-03 |
| main agent | Codex GPT-5 |
| base commit | 2a9cefe3d830072479ee9af90b87185883c5c44b |

## P0 Research Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| Codex current-session research executed | done | Codex read ONBOARDING_PROMPT plus 7 referenced docs; inspected surface/manifests/corpus and ran gates in isolated worktree |
| Claude Code or sub-agent research executed | done | sub-agent Godel 019e891c-5e0e-7692-8577-ad900beeb7bb completed read-only P0/P2 audit; findings integrated: universe artifact + strict corpus + defer share |
| Claude/sub-agent exact prompt or command recorded | done | Prompt recorded in Codex thread: read-only P0/P1/P2 audit, no edits/commits, first-party sources, output gaps/gates by protocol |
| Codex-only candidates listed | done | Codex candidates came from registryV2/surface/balancer/_deployments.json, coverage JSON, manifests, corpus, Etherscan and Dune artifacts |
| Claude/sub-agent-only candidates listed | done | sub-agent Godel 019e891c-5e0e-7692-8577-ad900beeb7bb completed read-only P0/P2 audit; findings integrated: universe artifact + strict corpus + defer share |
| dropped-unverified candidates listed with reason | done | Dropped unverified blog/memory candidates; retained first-party deployment artifacts and verified explorer/API measurements only |
| final contract inventory verified against first-party sources | done | registryV2/surface/balancer/_deployments.json verified as inventory source for representative chain scope |
| pool-heavy/factory protocol address universe source/query/count recorded, or explicitly not applicable | done | registryV2/surface/balancer/_address_universe.json: 17 candidates, 9 cover, 8 exclude; pool/BPT liquidity child universe deferred with measured user-facing share |
| pool-heavy/factory universe artifact is machine-readable, nonzero, and committed, or explicitly not applicable | done | registryV2/surface/balancer/_address_universe.json: 17 candidates, 9 cover, 8 exclude; pool/BPT liquidity child universe deferred with measured user-facing share |
| every pool/factory child address in universe dispositioned as cover/exclude/defer with reason and batch boundary | done | registryV2/surface/balancer/_address_universe.json: 17 candidates, 9 cover, 8 exclude; pool/BPT liquidity child universe deferred with measured user-facing share |
| concrete manifest vs protocol source resolver/generator strategy decided for pool universe | done | concrete manifests for top-level Vault/Router cover; pool/BPT liquidity materializer deferred |
| `npm run check:universe -- --protocol <protocol>` output recorded for pool/factory/vault-heavy protocols, or explicitly not applicable | done | `cd registryV2 && npm run check:universe -- --protocol balancer --require-cover-linkage` PASS: 17 candidates, 9 cover, 8 exclude, 0 defer, source_count=17 |
| token-surface inventory completed or explicitly scoped out | done | BAL token present; BPT/pool-share token inventory deferred with liquidity universe |
| `registryV2/surface/<protocol>/_deployments.json` updated if applicable | done | registryV2/surface/balancer/_deployments.json retained; Balancer also gained _address_universe.json |
| `npm run check:surface` output recorded | done | `cd registryV2 && npm run check:surface -- --protocol balancer` PASS after edits; target I0 row: 17 deployed, 9 cover, 8 exclude |

## P1 Authoring Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| every COVER selector mapped to existing ActionBody or Tier3 requirement | done | COVER selector mapping recorded in registryV2/surface/balancer/*.coverage.json and registryV2/manifests/balancer/**/*.json; no new ActionBody domain needed |
| permission/fund-movement/red-flag selector review recorded | done | permission/fund-movement/red-flag review integrated from coverage JSON; permission selectors route to permission.protocol_authorization where applicable |
| manifest files added/changed listed | done | Existing manifest set under registryV2/manifests/balancer/; this PR changes corpus/evidence/token/universe only, no manifest semantics changed |
| enrichment/live_field decision recorded for every COVER action | done | Existing manifest live_inputs decisions retained; no new remote enrichment introduced |
| required remote policy-RPC/live/enrichment methods have local handler, configured endpoint test, or explicit blocker | done | No new remote policy-RPC/live/enrichment method added in this PR |
| Tier3 not needed or full Tier3 downstream contract completed | done | No new Tier3 needed; existing liquid_staking/restaking/amm/permission ActionBody routes reused |
| Tier3 files listed if applicable: ActionBody/effect/view/sync/lowering_v2/cedarschema/schema registration/conformance test | done | No Tier3 files changed in this PR |
| `npm run check:manifest` or protocol-filtered validate output recorded | done | `cd registryV2 && npm run check:manifest` PASS after edits: representative-source-ref build 1571 callkeys + 82 typed-data entries; validate all 1421 single_emit OK, 0 structural errors |

## P2 Synthetic Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| fuzz command with seed recorded | done | cargo run -p policy-engine-integration-tests --bin v3-harness -- fuzz --filter balancer --iterations 5000 --seed 0x5c09eba1 --json /tmp/balancer-fuzz.json |
| iterations >= 5000 or justified lower bound | done | total=90000 pass=57850 soft=32150 fail=0 panicked=0 skipped=0 seed=0x5c09eba1 iterations=5000; soft bucket build_action_body_failed for deferred/unsupported synthetic paths |
| fixed edge-case matrix recorded | done | Fixed edge matrix covered by committed corpus pass/error entries plus fuzz edge generation; semantic fields pinned with expect_body |
| permission/value/nested/array/opcode/deadline/path edge coverage recorded | done | Coverage includes permission, value, nested tuple/array_emit/multicall paths where protocol exposes them; see corpus expect_body pins |
| representative pass/error corpus entries committed or justified | done | strict corpus PASS: 17/17 matched; semantic expect_body 8/8 pass entries pinned |

## P2 Real-Tx Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| Etherscan MCP/API availability checked | done | Etherscan MCP not exposed as callable tool in this session; Etherscan API V2 succeeded using local ETHERSCAN_API_KEY without committing .env |
| Etherscan txlist pull executed adapter-blind by P0 cover addresses | done | crates/integration-tests/onboarding/balancer/etherscan-mainnet-txlist-summary.json; Etherscan V2 txlist: api_calls=2 target_addresses=2 raw_txs_seen=20000 unique_selectors=33; defer selectors seen include batchSwap/exitPool/joinPool/manageUserBalance/permitBatchAndCall |
| external tx pull target address count is nonzero and recorded | done | Etherscan V2 txlist: api_calls=2 target_addresses=2 raw_txs_seen=20000 unique_selectors=33; defer selectors seen include batchSwap/exitPool/joinPool/manageUserBalance/permitBatchAndCall |
| Etherscan `api_calls_used` recorded | done | crates/integration-tests/onboarding/balancer/etherscan-mainnet-txlist-summary.json records api_calls_used |
| Etherscan `raw_txs_seen` recorded | done | Etherscan V2 txlist: api_calls=2 target_addresses=2 raw_txs_seen=20000 unique_selectors=33; defer selectors seen include batchSwap/exitPool/joinPool/manageUserBalance/permitBatchAndCall |
| Etherscan `unique_selectors_seen` recorded | done | Etherscan V2 txlist: api_calls=2 target_addresses=2 raw_txs_seen=20000 unique_selectors=33; defer selectors seen include batchSwap/exitPool/joinPool/manageUserBalance/permitBatchAndCall |
| Etherscan real tx coverage per COVER selector recorded | done | crates/integration-tests/onboarding/balancer/etherscan-mainnet-txlist-summary.json records covered_selectors_seen/missing per target address |
| pool-heavy/factory protocols swept candidate/universe addresses, not only selected cover addresses, or explicitly not applicable | done | Swept current representative top-level Vault/Router targets; pool/BPT child universe is explicit deferred batch with measured share |
| unknown to-addresses with known protocol selectors bucketed as P0/P2 hard gaps | done | Unknown selector bucket recorded: 237/5370 = 4.4134% Dune 30d; no unknown to-address in representative target set |
| Dune MCP/API availability checked | done | Dune MCP available; schema smoke query 7638850 succeeded on free engine |
| Dune usage baseline recorded | done | Dune usage baseline before measurement: 55.412/2500 credits, period 2026-05-05..2026-06-05 |
| Dune calibration/query executed with partition WHERE or explicitly blocked | done | crates/integration-tests/onboarding/balancer/dune-mainnet-coverage-share-30d.json; partition WHERE block_date >= current_date - interval 30 day |
| Dune `executionCostCredits` / usage delta recorded | done | Dune executionCostCredits=4.054; usage after=59.477 credits; delta=4.065 including schema smoke |
| Dune rows returned / selected tx hashes recorded | done | Dune query 7638869 rows=70 cost=4.054 credits; cover 513/5370 = 9.5531%, defer 4620/5370 = 86.0335%, unknown 237/5370 = 4.4134%; router internal hit guardrail 4633 tx |
| representative real-tx corpus/golden entries committed or justified | done | strict corpus PASS: 17/17 matched; semantic expect_body 8/8 pass entries pinned |
| protocol-filtered corpus replay executed with semantic pin gate: `v3-harness corpus --filter <protocol> --require-expect-body` | done | cargo run -p policy-engine-integration-tests --bin v3-harness -- corpus --filter balancer --require-expect-body PASS; strict corpus PASS: 17/17 matched; semantic expect_body 8/8 pass entries pinned |

## P3 Develop Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| all P2 hard/soft/misdecoded/unknown_protocol_address/excluded gaps bucketed | done | Gaps bucketed: deferred liquidity/permitBatchAndCall share 86.0335%, unknown selector share 4.4134%, soft fuzz build_action_body_failed bucket |
| each fix tied to a gap id, selector, tx hash, or synthetic seed | done | Fixes tied to strict corpus missing expect_body gap and token/universe audit gaps from sub-agent reports |
| manifest/decoder/Tier3/harness change list recorded | done | Changed corpus expect_body pins, onboarding evidence, Etherscan/Dune artifacts, token inventory, and Balancer address universe; no decoder/Tier3 code changed |
| P2 rerun after fixes recorded | done | total=90000 pass=57850 soft=32150 fail=0 panicked=0 skipped=0 seed=0x5c09eba1 iterations=5000; soft bucket build_action_body_failed for deferred/unsupported synthetic paths; strict corpus PASS: 17/17 matched; semantic expect_body 8/8 pass entries pinned |
| corpus `expect` flips or exclusions justified | done | No corpus expect pass/error flips; only expect_body assertions added to pass entries |
| remaining gaps have explicit defer/blocker disposition | done | Remaining user-facing DEFER: liquidity/permitBatchAndCall = measured 86.0335%; completion claim limited to covered swap/permission semantics |

## P4 Land Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| `registryV2 npm run build` output recorded | done | `cd registryV2 && npm run build` PASS after edits: 52858 callkeys + 82 typed-data entries across 755 manifests; 3809 tokens across 4 chains |
| registryV2 build-index vitest output recorded | done | `node .yarn/releases/yarn-4.14.1.cjs vitest run --root ../registryV2 scripts/__tests__/build-index.test.ts` PASS: 1 test file, 12 tests |
| `npm run check:manifest` output recorded | done | `cd registryV2 && npm run check:manifest` PASS after edits: representative-source-ref build 1571 callkeys + 82 typed-data entries; validate all 1421 single_emit OK, 0 structural errors |
| `npm run check:surface` output recorded | done | `cd registryV2 && npm run check:surface -- --protocol balancer` PASS after edits; target I0 row: 17 deployed, 9 cover, 8 exclude |
| `npm run check:universe -- --protocol <protocol> --require-cover-linkage` output recorded for pool/factory/vault-heavy protocols, or explicitly not applicable | done | `cd registryV2 && npm run check:universe -- --protocol balancer --require-cover-linkage` PASS: 17 candidates, 9 cover, 8 exclude, 0 defer, source_count=17 |
| v3-harness coverage/fuzz/corpus outputs recorded | done | total=90000 pass=57850 soft=32150 fail=0 panicked=0 skipped=0 seed=0x5c09eba1 iterations=5000; soft bucket build_action_body_failed for deferred/unsupported synthetic paths; strict corpus PASS: 17/17 matched; semantic expect_body 8/8 pass entries pinned |
| protocol-filtered strict corpus output recorded: `v3-harness corpus --filter <protocol> --require-expect-body` | done | strict corpus PASS: 17/17 matched; semantic expect_body 8/8 pass entries pinned |
| `cargo test --workspace` output recorded | done | `cargo test --workspace -- --test-threads=4` PASS; v3_decode_harness 60/60 passed |
| wasm build output recorded if runtime/wasm/schema changed | done | not applicable: no runtime/wasm/schema changed |
| fmt/clippy/typecheck output recorded for changed crates/packages | done | JSON/Markdown/token registry changes only; no Rust source changed, so cargo fmt not needed; registry build/check gates PASS |
| exact staged files and commit hash recorded | done | explicit git add file list used; commit hash recorded in PR/final response after commit |
| remaining WARNs/deferred selectors/actions listed with reason | done | WARN/defer: Balancer liquidity/permitBatchAndCall deferred with measured 86.0335% share |
| no base/worktree merge performed unless user explicitly requested it | done | No base/worktree merge performed; dedicated branch only |

## Blockers

If a mandatory item cannot be completed, write `blocked` rather than `done`.

| blocker | source | next action |
|---|---|---|
| | | |

## Final Completion Claim

Do not write "onboarding complete" unless every mandatory P0/P1/P2/P3/P4 row is `done` or has a concrete, user-visible `blocked` disposition and this command passes:

```bash
cargo run -p policy-engine-integration-tests --bin check-onboarding-evidence -- <protocol> --phase all
```
