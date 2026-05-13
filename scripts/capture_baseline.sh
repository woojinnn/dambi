#!/usr/bin/env bash
set -euo pipefail

INPUT_DIR="crates/integration-tests/data/golden/inputs"
OUTPUT_DIR="crates/integration-tests/data/golden/baseline_pre_refactor"

mkdir -p "$OUTPUT_DIR"
for f in "$INPUT_DIR"/*.json; do
  base="$(basename "$f")"
  echo "Capturing $base ..."
  cargo run -p policy-engine-integration-tests --bin capture_baseline -- --input "$f" --output "$OUTPUT_DIR/$base"
done
echo "Done. Files in $OUTPUT_DIR:"
ls "$OUTPUT_DIR"
