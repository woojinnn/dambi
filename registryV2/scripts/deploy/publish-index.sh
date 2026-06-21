#!/usr/bin/env bash
# Publish registry DATA: rebuild the index, then upload to the GCS bucket.
# FREQUENT + SAFE — updates objects only; never touches Cloud Run. The proxy
# reads the bucket live, so by-callkey / by-typed-data / tokens go live after
# the proxy's 5-min cache TTL with no redeploy.
#
#   bash registryV2/scripts/deploy/publish-index.sh            # additive (default)
#   PRUNE=1 bash registryV2/scripts/deploy/publish-index.sh    # + delete orphans
#
# NOTE: a brand-new path PREFIX (e.g. index/by-selector/) is gated by the proxy's
# allowlist (proxy SOURCE) — its objects upload here but only SERVE after
# deploy/deploy-proxy.sh ships the proxy code that allows the prefix.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
rv3_activate_and_guard

pinned_bundle_public_key() {
  if [[ -n "${PINNED_BUNDLE_PUBLIC_KEY:-}" ]]; then
    printf '%s\n' "${PINNED_BUNDLE_PUBLIC_KEY}"
    return
  fi
  local env_example="${REPO_ROOT}/browser-extension/.env.example"
  if [[ -f "${env_example}" ]]; then
    sed -nE 's/^PINNED_BUNDLE_PUBLIC_KEY=(.+)$/\1/p' "${env_example}" | head -1
  fi
}

cd "${RV2_DIR}"
echo "=== build-index (registryV2 → index/) ==="
npm ci --ignore-scripts --no-audit --no-fund --silent
# --strict-callkeys: abort the publish on a (chain,to,selector) collision rather
# than shipping a last-wins-resolved index that could route a callkey to the
# wrong adapter (a benign decoder shadowing a stricter one). Green today, so this
# is zero-cost now and a guard against a future colliding manifest going live.
npx tsx scripts/build-index.ts --strict-callkeys

# Sign every unique bundle (detached signatures/<sha>.sig). Publish defaults to
# KMS mode even for local operator runs; dev-key signing must be explicit because
# this script uploads to the live bucket by default.
# The extension fetches signatures/<bundle_sha256>.sig and verifies it against the
# pinned key before installing the decoder.
echo "=== sign bundles (signatures/<sha>.sig) ==="
BUNDLE_SIGNING_MODE="${BUNDLE_SIGNING_MODE:-kms}"
if [[ "${BUNDLE_SIGNING_MODE}" == "kms" ]]; then
  PINNED="$(pinned_bundle_public_key)"
  if [[ -z "${PINNED}" ]]; then
    echo "ABORT: PINNED_BUNDLE_PUBLIC_KEY is empty; refusing to publish unverifiable signatures." >&2
    echo "  Set PINNED_BUNDLE_PUBLIC_KEY or update browser-extension/.env.example first." >&2
    exit 1
  fi
  PINNED_BUNDLE_PUBLIC_KEY="${PINNED}" BUNDLE_SIGNING_MODE=kms KMS_KEY_NAME="${KMS_KEY_NAME}" npx tsx scripts/sign-bundles.ts
else
  if [[ "${ALLOW_LOCAL_BUNDLE_SIGNING:-0}" != "1" ]]; then
    echo "ABORT: local bundle signing is disabled for publish-index.sh." >&2
    echo "  Use BUNDLE_SIGNING_MODE=kms, or set ALLOW_LOCAL_BUNDLE_SIGNING=1 for an explicit non-prod/dev publish." >&2
    exit 1
  fi
  BUNDLE_SIGNING_MODE=local npx tsx scripts/sign-bundles.ts
fi

# Served prefixes only (build/dev artefacts surface/·cache/ excluded — cost + exposure).
# Must match the proxy path allowlist (registry-api/src/validation.ts): index / tokens
# / bundles / signatures / contexts; manifests uploaded for provenance per v2 convention.
# Strip OS cruft before upload so it never pollutes the private bucket.
find bundles contexts tokens signatures manifests index -name '.DS_Store' -delete 2>/dev/null || true

# Phase 1 — additive upload, LEAVES before POINTERS (no inconsistency window).
# index entries are 3-ref docs the proxy resolves by re-reading bundles/<sha> +
# contexts/...; if index/ landed before its targets, new entries would 502
# until the targets upload. So upload referenced objects first and index/ LAST.
# signatures/ goes BEFORE index/ too: the extension derives the sig URL from a
# new bundle_sha256 the moment the index lands, so the sig must already be present
# or a REQUIRE-on install would 404 its signature during the publish window.
for prefix in bundles contexts tokens signatures manifests index; do
  if [[ -d "${prefix}" ]]; then
    echo "  rsync (additive) ${prefix}/ → gs://${BUCKET}/${prefix}"
    gcloud storage rsync --recursive "${prefix}" "gs://${BUCKET}/${prefix}"
  fi
done

# Phase 2 — optional prune, POINTERS before LEAVES (reverse of upload) so no live
# index ref ever names a just-deleted leaf (threat model F1; 로컬 index 완전성 전제).
# signatures/ is a leaf (referenced only by the extension via bundle_sha256), so
# it prunes in the leaves group alongside bundles, AFTER index.
if [[ "${PRUNE:-0}" == "1" ]]; then
  echo "  PRUNE=1 — orphan 객체 삭제 (pointers→leaves 순)"
  for prefix in index manifests tokens contexts signatures bundles; do
    if [[ -d "${prefix}" ]]; then
      gcloud storage rsync --recursive --delete-unmatched-destination-objects "${prefix}" "gs://${BUCKET}/${prefix}"
    fi
  done
fi

echo "publish-index 완료. (프록시 5분 캐시 후 반영)"
