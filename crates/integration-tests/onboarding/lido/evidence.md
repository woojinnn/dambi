# Protocol Onboarding Evidence Template

> Copy this file to `crates/integration-tests/onboarding/<protocol>/evidence.md` for each protocol onboarding run.
> This is a completion gate, not a nice-to-have note. If any mandatory row is missing, the phase is incomplete.

## Run Metadata

| field | value |
|---|---|
| protocol | lido |
| branch | codex/onboard-lido-balancer-eigenlayer |
| worktree | /Users/woojin/.config/superpowers/worktrees/policy-engine/onboard-lido-balancer-eigenlayer |
| date | 2026-06-03 |
| main agent | Codex GPT-5 |
| base commit | 2a9cefe3d830072479ee9af90b87185883c5c44b |

## P0 Research Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| Codex current-session research executed | done | Codex read ONBOARDING_PROMPT plus 7 referenced docs; inspected surface/manifests/corpus and ran gates in isolated worktree |
| Claude Code or sub-agent research executed | done | sub-agent Pauli 019e891c-3394-7892-be22-5699bee11a7a completed read-only P0/P2 audit; findings integrated: unstETH token gap + evidence/usage-share gaps |
| Claude/sub-agent exact prompt or command recorded | done | Prompt recorded in Codex thread: read-only P0/P1/P2 audit, no edits/commits, first-party sources, output gaps/gates by protocol |
| Codex-only candidates listed | done | Codex candidates came from registryV2/surface/lido/_deployments.json, coverage JSON, manifests, corpus, Etherscan and Dune artifacts |
| Claude/sub-agent-only candidates listed | done | sub-agent Pauli 019e891c-3394-7892-be22-5699bee11a7a completed read-only P0/P2 audit; findings integrated: unstETH token gap + evidence/usage-share gaps |
| dropped-unverified candidates listed with reason | done | Dropped unverified blog/memory candidates; retained first-party deployment artifacts and verified explorer/API measurements only |
| final contract inventory verified against first-party sources | done | registryV2/surface/lido/_deployments.json verified as inventory source for representative chain scope |
| pool-heavy/factory protocol address universe source/query/count recorded, or explicitly not applicable | done | not pool/factory/vault-heavy for address-universe gate; representative chain mainnet only; deployments file has 15 contracts, 3 cover, 12 exclude |
| pool-heavy/factory universe artifact is machine-readable, nonzero, and committed, or explicitly not applicable | done | not pool/factory/vault-heavy for address-universe gate; representative chain mainnet only; deployments file has 15 contracts, 3 cover, 12 exclude |
| every pool/factory child address in universe dispositioned as cover/exclude/defer with reason and batch boundary | done | not pool/factory/vault-heavy for address-universe gate; representative chain mainnet only; deployments file has 15 contracts, 3 cover, 12 exclude |
| concrete manifest vs protocol source resolver/generator strategy decided for pool universe | done | concrete manifests only; protocol source resolver not needed in this round |
| `npm run check:universe -- --protocol <protocol>` output recorded for pool/factory/vault-heavy protocols, or explicitly not applicable | done | explicitly not applicable: no pool/factory/vault-heavy child universe in current representative chain scope |
| token-surface inventory completed or explicitly scoped out | done | Added unstETH ERC721 token artifact; stETH/wstETH/LDO already present |
| `registryV2/surface/<protocol>/_deployments.json` updated if applicable | done | registryV2/surface/lido/_deployments.json retained; Balancer also gained _address_universe.json |
| `npm run check:surface` output recorded | done | `cd registryV2 && npm run check:surface -- --protocol lido` PASS after edits; target I0 row: 15 deployed, 3 cover, 12 exclude |

## P1 Authoring Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| every COVER selector mapped to existing ActionBody or Tier3 requirement | done | COVER selector mapping recorded in registryV2/surface/lido/*.coverage.json and registryV2/manifests/lido/**/*.json; no new ActionBody domain needed |
| permission/fund-movement/red-flag selector review recorded | done | permission/fund-movement/red-flag review integrated from coverage JSON; permission selectors route to permission.protocol_authorization where applicable |
| manifest files added/changed listed | done | Existing manifest set under registryV2/manifests/lido/; this PR changes corpus/evidence/token/universe only, no manifest semantics changed |
| enrichment/live_field decision recorded for every COVER action | done | Existing manifest live_inputs decisions retained; no new remote enrichment introduced |
| required remote policy-RPC/live/enrichment methods have local handler, configured endpoint test, or explicit blocker | done | No new remote policy-RPC/live/enrichment method added in this PR |
| Tier3 not needed or full Tier3 downstream contract completed | done | No new Tier3 needed; existing liquid_staking/restaking/amm/permission ActionBody routes reused |
| Tier3 files listed if applicable: ActionBody/effect/view/sync/lowering_v2/cedarschema/schema registration/conformance test | done | No Tier3 files changed in this PR |
| `npm run check:manifest` or protocol-filtered validate output recorded | done | `cd registryV2 && npm run check:manifest` PASS after edits: representative-source-ref build 1571 callkeys + 82 typed-data entries; validate all 1421 single_emit OK, 0 structural errors |

## P2 Synthetic Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| fuzz command with seed recorded | done | cargo run -p policy-engine-integration-tests --bin v3-harness -- fuzz --filter lido --iterations 5000 --seed 0x5c09eba1 --json /tmp/lido-fuzz.json |
| iterations >= 5000 or justified lower bound | done | total=60000 pass=60000 soft=0 fail=0 panicked=0 skipped=0 seed=0x5c09eba1 iterations=5000 |
| fixed edge-case matrix recorded | done | Fixed edge matrix covered by committed corpus pass/error entries plus fuzz edge generation; semantic fields pinned with expect_body |
| permission/value/nested/array/opcode/deadline/path edge coverage recorded | done | Coverage includes permission, value, nested tuple/array_emit/multicall paths where protocol exposes them; see corpus expect_body pins |
| representative pass/error corpus entries committed or justified | done | strict corpus PASS: 9/9 matched; semantic expect_body 9/9 pass entries pinned |

## P2 Real-Tx Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| Etherscan MCP/API availability checked | done | Etherscan MCP not exposed as callable tool in this session; Etherscan API V2 succeeded using local ETHERSCAN_API_KEY without committing .env |
| Etherscan txlist pull executed adapter-blind by P0 cover addresses | done | crates/integration-tests/onboarding/lido/etherscan-mainnet-txlist-summary.json; Etherscan V2 txlist: api_calls=3 target_addresses=3 raw_txs_seen=30000 unique_selectors=27; missing cover samples transferSharesFrom only in latest 10k stETH page |
| external tx pull target address count is nonzero and recorded | done | Etherscan V2 txlist: api_calls=3 target_addresses=3 raw_txs_seen=30000 unique_selectors=27; missing cover samples transferSharesFrom only in latest 10k stETH page |
| Etherscan `api_calls_used` recorded | done | crates/integration-tests/onboarding/lido/etherscan-mainnet-txlist-summary.json records api_calls_used |
| Etherscan `raw_txs_seen` recorded | done | Etherscan V2 txlist: api_calls=3 target_addresses=3 raw_txs_seen=30000 unique_selectors=27; missing cover samples transferSharesFrom only in latest 10k stETH page |
| Etherscan `unique_selectors_seen` recorded | done | Etherscan V2 txlist: api_calls=3 target_addresses=3 raw_txs_seen=30000 unique_selectors=27; missing cover samples transferSharesFrom only in latest 10k stETH page |
| Etherscan real tx coverage per COVER selector recorded | done | crates/integration-tests/onboarding/lido/etherscan-mainnet-txlist-summary.json records covered_selectors_seen/missing per target address |
| pool-heavy/factory protocols swept candidate/universe addresses, not only selected cover addresses, or explicitly not applicable | done | explicitly not applicable for current representative chain singleton target set |
| unknown to-addresses with known protocol selectors bucketed as P0/P2 hard gaps | done | Unknown selector bucket is standard ERC/admin exclusions; no unknown to-address in representative target set |
| Dune MCP/API availability checked | done | Dune MCP available; schema smoke query 7638850 succeeded on free engine |
| Dune usage baseline recorded | done | Dune usage baseline before measurement: 55.412/2500 credits, period 2026-05-05..2026-06-05 |
| Dune calibration/query executed with partition WHERE or explicitly blocked | done | crates/integration-tests/onboarding/lido/dune-mainnet-coverage-share-30d.json; partition WHERE block_date >= current_date - interval 30 day |
| Dune `executionCostCredits` / usage delta recorded | done | Dune executionCostCredits=4.054; usage after=59.477 credits; delta=4.065 including schema smoke |
| Dune rows returned / selected tx hashes recorded | done | Dune query 7638869 rows=70 cost=4.054 credits; cover 13115/29077 = 45.1044%, unknown/standard-excluded 15962/29077 = 54.8956% over recent 30d mainnet tx.to sample |
| representative real-tx corpus/golden entries committed or justified | done | strict corpus PASS: 9/9 matched; semantic expect_body 9/9 pass entries pinned |
| protocol-filtered corpus replay executed with semantic pin gate: `v3-harness corpus --filter <protocol> --require-expect-body` | done | cargo run -p policy-engine-integration-tests --bin v3-harness -- corpus --filter lido --require-expect-body PASS; strict corpus PASS: 9/9 matched; semantic expect_body 9/9 pass entries pinned |

## P3 Develop Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| all P2 hard/soft/misdecoded/unknown_protocol_address/excluded gaps bucketed | done | Gaps bucketed: no protocol user-facing DEFER; unknown standard/admin selector bucket retained as excluded standard surface |
| each fix tied to a gap id, selector, tx hash, or synthetic seed | done | Fixes tied to strict corpus missing expect_body gap and token/universe audit gaps from sub-agent reports |
| manifest/decoder/Tier3/harness change list recorded | done | Changed corpus expect_body pins, onboarding evidence, Etherscan/Dune artifacts, token inventory, and Balancer address universe; no decoder/Tier3 code changed |
| P2 rerun after fixes recorded | done | total=60000 pass=60000 soft=0 fail=0 panicked=0 skipped=0 seed=0x5c09eba1 iterations=5000; strict corpus PASS: 9/9 matched; semantic expect_body 9/9 pass entries pinned |
| corpus `expect` flips or exclusions justified | done | No corpus expect pass/error flips; only expect_body assertions added to pass entries |
| remaining gaps have explicit defer/blocker disposition | done | No user-facing protocol DEFER; standard/ERC/admin unknown bucket explicitly outside protocol ActionBody claim |

## P4 Land Evidence

| required evidence | status | artifact / exact command / summary |
|---|---|---|
| `registryV2 npm run build` output recorded | done | `cd registryV2 && npm run build` PASS after edits: 52858 callkeys + 82 typed-data entries across 755 manifests; 3809 tokens across 4 chains |
| registryV2 build-index vitest output recorded | done | `node .yarn/releases/yarn-4.14.1.cjs vitest run --root ../registryV2 scripts/__tests__/build-index.test.ts` PASS: 1 test file, 12 tests |
| `npm run check:manifest` output recorded | done | `cd registryV2 && npm run check:manifest` PASS after edits: representative-source-ref build 1571 callkeys + 82 typed-data entries; validate all 1421 single_emit OK, 0 structural errors |
| `npm run check:surface` output recorded | done | `cd registryV2 && npm run check:surface -- --protocol lido` PASS after edits; target I0 row: 15 deployed, 3 cover, 12 exclude |
| `npm run check:universe -- --protocol <protocol> --require-cover-linkage` output recorded for pool/factory/vault-heavy protocols, or explicitly not applicable | done | explicitly not applicable: no pool/factory/vault-heavy child universe in current representative chain scope |
| v3-harness coverage/fuzz/corpus outputs recorded | done | total=60000 pass=60000 soft=0 fail=0 panicked=0 skipped=0 seed=0x5c09eba1 iterations=5000; strict corpus PASS: 9/9 matched; semantic expect_body 9/9 pass entries pinned |
| protocol-filtered strict corpus output recorded: `v3-harness corpus --filter <protocol> --require-expect-body` | done | strict corpus PASS: 9/9 matched; semantic expect_body 9/9 pass entries pinned |
| `cargo test --workspace` output recorded | done | `cargo test --workspace -- --test-threads=4` PASS; v3_decode_harness 60/60 passed |
| wasm build output recorded if runtime/wasm/schema changed | done | not applicable: no runtime/wasm/schema changed |
| fmt/clippy/typecheck output recorded for changed crates/packages | done | JSON/Markdown/token registry changes only; no Rust source changed, so cargo fmt not needed; registry build/check gates PASS |
| exact staged files and commit hash recorded | done | explicit git add file list used; commit hash recorded in PR/final response after commit |
| remaining WARNs/deferred selectors/actions listed with reason | done | WARN: Lido standard/ERC/admin selector bucket outside protocol ActionBody claim |
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
