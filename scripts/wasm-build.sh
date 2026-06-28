#!/usr/bin/env bash
# Build the policy-engine WASM artifact + copy into browser-extension/ for static webpack import.
set -euo pipefail

cd "$(dirname "$0")/.."

WASM_CRATE_DIR="crates/policy-engine-wasm"
TEMP_WASM_LICENSE=""

cleanup_temp_wasm_license() {
  if [ -n "$TEMP_WASM_LICENSE" ]; then
    rm -f "$TEMP_WASM_LICENSE"
  fi
}
trap cleanup_temp_wasm_license EXIT

if [ ! -d "$WASM_CRATE_DIR" ]; then
  echo "skip: crates/policy-engine-wasm/ not yet present (Plan 2 not landed)"
  exit 0
fi

if [ ! -f "$WASM_CRATE_DIR/LICENSE" ]; then
  cp LICENSE "$WASM_CRATE_DIR/LICENSE"
  TEMP_WASM_LICENSE="$WASM_CRATE_DIR/LICENSE"
fi

# CI dedupe hook: when SKIP_WASM_BUILD=1 and a prebuilt pkg/ already exists
# (e.g. downloaded as a workflow artifact), skip the expensive wasm-pack build
# and reuse it. The copy step below still runs so consumers get their artifacts.
# A developer running this directly (flag unset) always gets a fresh build.
if [ "${SKIP_WASM_BUILD:-}" = "1" ] && [ -f "$WASM_CRATE_DIR/pkg/policy_engine_wasm_bg.wasm" ]; then
  echo "==> SKIP_WASM_BUILD=1 and prebuilt pkg/ found — reusing wasm-pack output"
else
  echo "==> wasm-pack build (target=web, release, opt-level=z)"
  # opt-level=z (size-optimal codegen) ONLY for this wasm build — scoped via env
  # var so native [profile.release] (server) keeps opt-level 3. Measured on the
  # 2026-06-11 tree: 13.06 MiB -> 7.57 MiB (-42%). wasm-opt -Oz alone cannot
  # recover this; the win is at rustc codegen. panic=abort measured ~0 on
  # wasm32-unknown-unknown (already abort-style) — deliberately not set.
  CARGO_PROFILE_RELEASE_OPT_LEVEL=z \
  wasm-pack build "$WASM_CRATE_DIR" \
    --target web \
    --release \
    --out-dir pkg \
    --out-name policy_engine_wasm
fi

cp LICENSE "$WASM_CRATE_DIR/pkg/LICENSE"
cp NOTICE "$WASM_CRATE_DIR/pkg/NOTICE"

if [ -d browser-extension ]; then
  mkdir -p browser-extension/backend/wasm
  cp "$WASM_CRATE_DIR/pkg/policy_engine_wasm.js" browser-extension/backend/wasm/
  cp "$WASM_CRATE_DIR/pkg/policy_engine_wasm.d.ts" browser-extension/backend/wasm/ 2>/dev/null || true
  cp "$WASM_CRATE_DIR/pkg/policy_engine_wasm_bg.wasm" browser-extension/backend/wasm/
  cp "$WASM_CRATE_DIR/pkg/policy_engine_wasm_bg.wasm.d.ts" browser-extension/backend/wasm/ 2>/dev/null || true
  rm -f browser-extension/public/wasm/policy_engine_wasm_bg.wasm
  echo "==> wasm artifact copied to browser-extension/backend/wasm/"
fi
