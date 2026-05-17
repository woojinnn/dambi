#!/usr/bin/env bash
# E2E for Plan 2 — browser-extension JS adapter loader.
# Boots Plan 1's mock registry, publishes the erc20-transfer sample,
# then runs the vitest loader/pipeline suite against the live registry.
#
# Requires Plan 1 to be available locally (cargo build + wasm32 target).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${PORT:-18900}"
REGISTRY="http://127.0.0.1:${PORT}"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]]; then
        kill "${SERVER_PID}" 2>/dev/null || true
        wait "${SERVER_PID}" 2>/dev/null || true
    fi
    rm -rf "${TMP:-}"
}
trap cleanup EXIT

# Skip if Plan 1's binaries aren't available (PR review env)
if ! cargo build -p registry-mock -p adapter-cli -p adapter-sample-erc20-transfer --release 2>/dev/null; then
    echo "SKIP: Plan 1 crates not present (this branch builds independently from main)"
    exit 0
fi

echo "=> Ensuring wasm32 target"
rustup target add wasm32-unknown-unknown >/dev/null

TMP=$(mktemp -d)
echo "=> Building sample WASM"
cargo build -p adapter-sample-erc20-transfer --target wasm32-unknown-unknown --release

WASM="$REPO_ROOT/target/wasm32-unknown-unknown/release/adapter_sample_erc20_transfer.wasm"
test -f "$WASM"

echo "=> Starting registry-mock on :${PORT}"
REGISTRY_STATE="${TMP}/state" REGISTRY_BIND="127.0.0.1:${PORT}" \
    "$REPO_ROOT/target/release/registry-mock" &
SERVER_PID=$!
ready=0
for i in $(seq 1 20); do
    if curl -sf "${REGISTRY}/healthz" >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
    echo "FAIL: registry never became healthy"; exit 1
fi

echo "=> Publishing sample"
"$REPO_ROOT/target/release/adapter-cli" publish "$WASM" --registry "$REGISTRY"

echo "=> Running vitest loader suite (MOCK_REGISTRY_URL=$REGISTRY)"
cd browser-extension
MOCK_REGISTRY_URL="$REGISTRY" yarn vitest run src/adapters/__tests__/

echo "=> SUCCESS"
