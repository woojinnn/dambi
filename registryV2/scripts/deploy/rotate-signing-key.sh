#!/usr/bin/env bash
# KMS signing-key rotation for the registry bundle signatures. The private key
# never leaves the HSM; rotation creates a NEW key VERSION under the same key,
# re-signs every bundle with it, and (after the new public key ships in an
# extension release) destroys the retired version.
#
# Ordered procedure (full detail in REGISTRY_RUNBOOK.md "KMS key rotation"):
#   1) new-version          → create vNEW, list versions, print how to get its pin
#   2) (operator) ship an extension release pinning vNEW. ⚠ If
#      DAMBI_REQUIRE_BUNDLE_SIGNATURE is ON, the fleet pins a SINGLE key, so the
#      new-pin build MUST roll out BEFORE step 3 or installs fail-closed against
#      the freshly re-signed bundles. (REQUIRE is staged OFF today → low risk.)
#   3) resign --version NEW → re-sign every bundle with vNEW + publish signatures/
#   4) (operator) wait out the old-pin extension drain window
#   5) destroy-old --version OLD → schedule the retired version for destruction
#
#   bash .../rotate-signing-key.sh new-version
#   bash .../rotate-signing-key.sh resign --version 2
#   bash .../rotate-signing-key.sh destroy-old --version 1
#
# **mutates KMS + live signatures.** Operator runs each step in order per the
# runbook; the steps are deliberately separate so the risky ones are explicit.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
rv3_activate_and_guard

SUB="${1:-}"
shift || true
VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

kms_flags=(--keyring="${KMS_KEYRING}" --location="${KMS_LOCATION}" --project="${PROJECT_ID}")

case "${SUB}" in
  new-version)
    echo "=== create new version of ${KMS_KEY} (HSM, EC_SIGN_P256_SHA256) ==="
    NEW="$(gcloud kms keys versions create --key="${KMS_KEY}" "${kms_flags[@]}" --format='value(name)')"
    NEW="${NEW##*/}"   # …/cryptoKeyVersions/<NEW>
    # A new asymmetric version starts PENDING_GENERATION; get-public-key and
    # asymmetricSign both FAIL until KMS auto-transitions it to ENABLED. Poll.
    echo "new version = ${NEW} — waiting for state=ENABLED…"
    state=""
    for _ in $(seq 1 30); do
      state="$(gcloud kms keys versions describe "${NEW}" --key="${KMS_KEY}" "${kms_flags[@]}" --format='value(state)' 2>/dev/null || true)"
      [[ "${state}" == "ENABLED" ]] && break
      sleep 2
    done
    echo "=== versions now (new=${NEW}, state=${state:-unknown}) ==="
    gcloud kms keys versions list --key="${KMS_KEY}" "${kms_flags[@]}" \
      --format='table(name.basename(), state, createTime)'
    if [[ "${state}" != "ENABLED" ]]; then
      echo "⚠ v${NEW} not ENABLED yet — re-check before get-public-key / resign." >&2
    fi
    echo ""
    echo "Pin v${NEW} in the extension build:"
    echo "  gcloud kms keys versions get-public-key ${NEW} --key=${KMS_KEY} \\"
    echo "    --keyring=${KMS_KEYRING} --location=${KMS_LOCATION} --project=${PROJECT_ID} \\"
    echo "    --output-file=/tmp/new.pem"
    echo "  # strip PEM header/footer + newlines → base64 SPKI → .env PINNED_BUNDLE_PUBLIC_KEY"
    echo "Then: rotate-signing-key.sh resign --version ${NEW}"
    ;;

  resign)
    [[ -n "${VERSION}" ]] || { echo "resign requires --version NEW" >&2; exit 2; }
    KEYVER="projects/${PROJECT_ID}/locations/${KMS_LOCATION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}/cryptoKeyVersions/${VERSION}"
    echo "=== re-sign every bundle with version ${VERSION} (overwrites signatures/) ==="
    ( cd "${RV2_DIR}" && BUNDLE_SIGNING_MODE=kms KMS_KEY_NAME="${KEYVER}" npx tsx scripts/sign-bundles.ts --force )
    echo "=== publish signatures/ (leaf only; index pointers unchanged) ==="
    # rsync re-uploads every .sig only because --force above just rewrote them
    # (newer mtime). The filename + 64-byte P1363 length are unchanged, so rsync's
    # local→cloud diff falls back to mtime, not size — keep --force (never make it
    # no-op-on-unchanged) or stale OLD-key sigs would survive = REQUIRE-on break.
    ( cd "${RV2_DIR}" && gcloud storage rsync --recursive signatures "gs://${BUCKET}/signatures" )
    echo "resign 완료. REQUIRE-on 호환은 extension이 v${VERSION} pin을 가진 뒤에만."
    ;;

  destroy-old)
    [[ -n "${VERSION}" ]] || { echo "destroy-old requires --version OLD" >&2; exit 2; }
    echo "=== schedule version ${VERSION} of ${KMS_KEY} for DESTRUCTION ==="
    echo "Run ONLY after the old-pin extension fleet has fully drained."
    # The version stays SCHEDULED_FOR_DESTRUCTION for this key's
    # destroyScheduledDuration (default 30d for keys created after 2024-02-01;
    # 24h minimum) and is restorable any time inside that window.
    echo "  window (destroyScheduledDuration): $(gcloud kms keys describe "${KMS_KEY}" "${kms_flags[@]}" --format='value(destroyScheduledDuration)' 2>/dev/null || echo '?')"
    echo "  recover inside window: gcloud kms keys versions restore ${VERSION} --key=${KMS_KEY} --keyring=${KMS_KEYRING} --location=${KMS_LOCATION}"
    gcloud kms keys versions destroy "${VERSION}" --key="${KMS_KEY}" "${kms_flags[@]}"
    ;;

  *)
    echo "usage: rotate-signing-key.sh {new-version | resign --version N | destroy-old --version N}" >&2
    exit 2 ;;
esac
