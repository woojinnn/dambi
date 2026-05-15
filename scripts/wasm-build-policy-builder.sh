#!/usr/bin/env bash
# Build the policy-builder WASM artifact and copy it into the web app.
#
# Output ends up at web/policy-builder/public/wasm/ (the static asset path
# Vite serves at runtime) and web/policy-builder/src/wasm/ (the typed JS
# glue + .d.ts the TS side imports).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d crates/policy-builder-wasm ]; then
  echo "skip: crates/policy-builder-wasm/ missing"
  exit 0
fi

echo "==> wasm-pack build policy-builder-wasm (target=web, release)"
wasm-pack build crates/policy-builder-wasm \
  --target web \
  --release \
  --out-dir pkg \
  --out-name policy_builder_wasm

dest_src="web/policy-builder/src/wasm"
dest_pub="web/policy-builder/public/wasm"
mkdir -p "$dest_src" "$dest_pub"

cp crates/policy-builder-wasm/pkg/policy_builder_wasm.js              "$dest_src/"
cp crates/policy-builder-wasm/pkg/policy_builder_wasm.d.ts            "$dest_src/" 2>/dev/null || true
cp crates/policy-builder-wasm/pkg/policy_builder_wasm_bg.wasm         "$dest_src/"
cp crates/policy-builder-wasm/pkg/policy_builder_wasm_bg.wasm         "$dest_pub/"
cp crates/policy-builder-wasm/pkg/policy_builder_wasm_bg.wasm.d.ts    "$dest_src/" 2>/dev/null || true

echo "==> wasm artifacts copied to web/policy-builder/{src,public}/wasm/"
