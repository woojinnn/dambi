# Contributing to Dambi

Dambi is a wallet-side transaction and signature policy engine. The highest
impact contributions improve decoder coverage, policy correctness, fail-closed
behavior, and release automation.

## Good First Areas

- Add or correct protocol manifests under `registryV2/manifests/`.
- Add EVM calldata or EIP-712 regression fixtures for known wallet actions.
- Improve `ActionBody` lowering and Cedar schema coverage.
- Add policy regression tests for risky token approvals, asset redirects,
  unsupported protocols, and venue orders.
- Improve dashboard copy, diagnostics, and issue triage for decoder misses.

## Development Setup

Install the JavaScript and Rust toolchains used by the repo, then run the
targeted checks for the surface you change.

```bash
cd registryV2
npm ci
npm run build
```

```bash
cd browser-extension
node .yarn/releases/yarn-4.14.1.cjs install
node .yarn/releases/yarn-4.14.1.cjs test --run
node .yarn/releases/yarn-4.14.1.cjs typecheck
```

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
```

For a full local sweep:

```bash
./scripts/test-all.sh
```

## Decoder And Registry Changes

Registry changes should start from source files, not generated output.

- Edit manifests, token files, surface inventories, or resolver scripts.
- Rebuild and validate with `registryV2` checks.
- Do not hand-edit generated `registryV2/index/`, `bundles/`, `contexts/`, or
  `signatures/` output.
- Add focused tests for the route you changed: manifest harness, WASM route
  tests, service-worker tests, or integration fixtures.

Useful checks:

```bash
cd registryV2
npm run typecheck
npm run check:manifest
npm run check:surface
```

## Policy Engine Changes

When changing `ActionBody`, lowering, or schemas, keep these files aligned:

- `crates/policy-server/asset-model/action/`
- `crates/policy-engine/src/lowering_v2/`
- `schema/policy-schema/actions/`
- `crates/policy-engine/tests/`
- `crates/policy-engine-wasm/tests/`

Add tests at the boundary that changed. For example, a new manifest route should
have registry/WASM coverage; a new lowered policy field should have
policy-engine schema and evaluation coverage.

## Pull Requests

Before opening a PR:

- Keep the diff scoped to one behavior or documentation goal.
- Include the risk surface you touched in the PR description.
- List targeted checks you ran.
- Avoid unrelated formatting or generated-output churn.
- Preserve fail-closed behavior for unknown, malformed, or unsupported wallet
  actions.

PRs that change wallet interception, typed-data normalization, policy
evaluation, auth, registry serving, or release automation should include tests
or a clear explanation of the remaining verification gap.
