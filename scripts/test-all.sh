#!/usr/bin/env bash
# Run the full test suite — Rust workspace + browser-extension when present.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> cargo test --workspace"
cargo test --workspace --all-targets

echo "==> cargo clippy --workspace --all-targets -- -D warnings"
cargo clippy --workspace --all-targets -- -D warnings

echo "==> cargo fmt --all -- --check"
cargo fmt --all -- --check

if [ -d browser-extension ] && [ -f browser-extension/package.json ]; then
  echo "==> yarn typecheck (browser-extension)"
  (cd browser-extension && yarn typecheck)

  if grep -q '"test"' browser-extension/package.json; then
    echo "==> yarn test (browser-extension)"
    (cd browser-extension && yarn test --run 2>/dev/null || yarn test)
  fi

  echo "==> yarn build:chrome (browser-extension)"
  (cd browser-extension && yarn build:chrome >/dev/null)
fi

echo "==> all checks passed"
