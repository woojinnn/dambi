# Chrome Extension Implementation Plans

Six sequential plans take the policy engine from "Rust crates" to "installable Chrome extension with a marketplace of user-customizable Cedar policy bundles". Each plan produces independently testable software; later plans depend on earlier ones.

| # | Plan | Scope | Depends on |
|---|------|-------|------------|
| 1 | [Engine API for WASM](./2026-05-08-engine-api-for-wasm.md) | `Pipeline::build_action_for`, `required_host_facts`, `required_window_keys`, `SnapshotOracle` | — |
| 2 | [WASM bridge crate](./2026-05-08-wasm-bridge.md) | `crates/policy_engine_wasm/` with five JSON exports + wasm-pack CI | Plan 1 |
| 3 | [Extension scaffold](./2026-05-08-extension-scaffold.md) | yarn project, webpack, manifest, inpage proxy, content scripts, SW skeleton | — (parallel to 1+2) |
| 4 | [Fact fetchers](./2026-05-08-fact-fetchers.md) | viem RPC client (multicall), CoinGecko PriceClient (60s cache), Tier-1 fetcher | Plan 3 |
| 5 | [Orchestrator + UI](./2026-05-08-orchestrator-ui.md) | Full lifecycle wiring, WASM loader, verdict modal, pending-deltas, receipt poller | Plans 1–4 |
| 6 | [Marketplace](./2026-05-08-marketplace.md) | Bundle format, catalog client, AST equivalence, Marketplace + Settings UI | Plans 1–5 |

## Rough timeline (1 person, full-time)

| Plans | Optimistic | Realistic |
|-------|------------|-----------|
| 1 + 2 | 4 days | 1 week |
| 3 + 4 | 1 week | 1.5 weeks |
| 5 | 1 week | 2 weeks |
| 6 | 1 week | 2 weeks |
| **Total v1** | **~3.5 weeks** | **~6.5 weeks** |

## MVP slice (skip plan 6)

Plans 1–5 alone produce a working extension that:
- Intercepts EIP-1193 transaction + signature requests
- Runs them through the Cedar engine with a hardcoded default policy set
- Blocks Fail verdicts and prompts on Warn
- Does not yet support user-installable bundles or per-policy parameter editing

This is the "demoable extension" milestone (~3 weeks optimistic).

## Out of scope across all six plans (v1.1+)

- MetaMask Snap parallel path (closes EIP-6963 race determinism)
- `wallet_sendCalls` (EIP-5792) full integration — currently best-effort proxied
- WalletConnect bridge interception
- Multi-tx reservation coordination via `evaluate_with_reservation`
- Manifest version 2 bundles (`schema_extensions`)
- Manifest version 3 bundles (declarative `adapter_capabilities`)
- Catalog publisher key rotation
- Firefox + Safari ports
- Chainlink hybrid oracle for major tokens
