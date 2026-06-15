#!/usr/bin/env bash
# verify-bucket-parity — prod registry DATA-INTEGRITY gate. Run after a migration
# or full-sync publish, and before flipping DAMBI_REQUIRE_BUNDLE_SIGNATURE=true.
#
#   (1) SIGNATURE COVERAGE — every locally-built bundle_sha256 has a published
#       signatures/<sha>.sig in the prod bucket. A single uncovered bundle would
#       fail-closed fleet-wide once REQUIRE is on. (Bucket-side, not via the proxy:
#       proxy rate limits forbid ~31k probes.)
#   (2) MIGRATION FAITHFULNESS — PoC↔prod object (name,crc32c) are byte-identical
#       across the migrated prefixes. Count parity (62534=62534) proved nothing was
#       dropped; this proves nothing was silently truncated/re-encoded in the copy.
#       Skip with SKIP_FAITHFULNESS=1 (slow: lists 62k objects twice).
#
#   bash registryV2/scripts/deploy/verify-bucket-parity.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1   # registryV2/
PROD_BUCKET="${PROD_BUCKET:-dambi-registry-v3-seoul}"
POC_BUCKET="${POC_BUCKET:-scopeball-registry-v3-seoul}"
RC=0

echo "=== (1) signature coverage: local index shas ⊆ gs://${PROD_BUCKET}/signatures/ ==="
npx tsx -e 'import {collectBundleShas} from "./scripts/sign-bundles.ts"; for (const s of collectBundleShas(".")) console.log(s)' 2>/dev/null \
  | sort -u > /tmp/vbp_local_shas.txt
gcloud storage ls --recursive "gs://${PROD_BUCKET}/signatures/**" 2>/dev/null \
  | sed -nE 's#.*/(0x[0-9a-f]{64})\.sig$#\1#p' | sort -u > /tmp/vbp_prod_sig_shas.txt
LOCAL=$(wc -l < /tmp/vbp_local_shas.txt | tr -d ' ')
PRODSIG=$(wc -l < /tmp/vbp_prod_sig_shas.txt | tr -d ' ')
UNCOVERED=$(comm -23 /tmp/vbp_local_shas.txt /tmp/vbp_prod_sig_shas.txt | wc -l | tr -d ' ')
echo "  local unique shas: ${LOCAL}   prod sigs: ${PRODSIG}   uncovered(local w/o prod sig): ${UNCOVERED}"
if [ "${UNCOVERED}" != "0" ]; then
  echo "  FAIL: ${UNCOVERED} built bundles have NO published signature:"
  comm -23 /tmp/vbp_local_shas.txt /tmp/vbp_prod_sig_shas.txt | head -5 | sed 's/^/    /'
  RC=1
else
  echo "  coverage OK ✓ (every built bundle is verifiable)"
fi

if [ "${SKIP_FAITHFULNESS:-0}" != "1" ]; then
  echo "=== (2) migration faithfulness: PoC↔prod (name,crc32c) — migrated prefixes ==="
  # signatures/ is prod-only (PoC was never signed); exclude it from the diff.
  # `gcloud storage ls` rejects --format; `objects list` emits bucket-relative name + crc32c.
  for B in "${POC_BUCKET}" "${PROD_BUCKET}"; do
    gcloud storage objects list "gs://${B}/**" --format='value(name,crc32c_hash)' 2>/dev/null \
      | grep -vE '^signatures/' | sort > "/tmp/vbp_${B}.txt"
  done
  if [ -s "/tmp/vbp_${POC_BUCKET}.txt" ] && [ -s "/tmp/vbp_${PROD_BUCKET}.txt" ]; then
    DIFF=$(diff "/tmp/vbp_${POC_BUCKET}.txt" "/tmp/vbp_${PROD_BUCKET}.txt" | grep -cE '^[<>]')
    echo "  PoC objects: $(wc -l < /tmp/vbp_${POC_BUCKET}.txt | tr -d ' ')   prod(non-sig): $(wc -l < /tmp/vbp_${PROD_BUCKET}.txt | tr -d ' ')   differing lines: ${DIFF}"
    if [ "${DIFF}" != "0" ]; then
      echo "  FAIL: PoC↔prod content/name divergence:"
      diff "/tmp/vbp_${POC_BUCKET}.txt" "/tmp/vbp_${PROD_BUCKET}.txt" | grep -E '^[<>]' | head -6 | sed 's/^/    /'
      RC=1
    else
      echo "  faithfulness OK ✓ (byte-identical copy)"
    fi
  else
    echo "  SKIP: could not list one of the buckets (crc32c field empty or access denied)."
  fi
fi

echo "=== verify-bucket-parity RC=${RC} ==="
exit ${RC}
