#!/usr/bin/env bash
# Roll a single registry object back to a prior version using GCS object
# versioning (the bucket has --versioning on; the lifecycle keeps the 3 newest
# noncurrent versions — see provision-infra.sh). DRY-RUN by default: lists every
# retained generation so you can pick one; --apply --generation <GEN> restores it.
#
# For a BULK rollback (a whole bad publish), prefer re-publishing a prior
# `registry-v*` git tag — see REGISTRY_RUNBOOK.md "Rollback". This script is the
# surgical, single-object emergency path (e.g. one poisoned by-callkey entry).
#
#   bash .../rollback-index.sh index/by-callkey/<chain>/<to>/<selector>.json
#   bash .../rollback-index.sh <object> --apply --generation 1700000000123456
#
# **mutates a live registry object on --apply.** Without --apply it is read-only.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
rv3_activate_and_guard

OBJ="${1:-}"
if [[ -z "${OBJ}" || "${OBJ}" == --* ]]; then
  echo "usage: rollback-index.sh <object-path> [--apply --generation <GEN>]" >&2
  exit 2
fi
OBJ="${OBJ#/}"   # tolerate a leading slash
shift
APPLY=0
GEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --generation) GEN="${2:-}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

URL="gs://${BUCKET}/${OBJ}"
echo "=== retained generations of ${URL} (newest→oldest) ==="
# -a lists every version as gs://…#<generation>; -l adds size / time / generation.
gcloud storage ls -a -l "${URL}" || { echo "object not found / no versions" >&2; exit 1; }

if [[ "${APPLY}" != "1" ]]; then
  echo ""
  echo "DRY-RUN (read-only). To restore one generation to live:"
  echo "  bash $0 ${OBJ} --apply --generation <GEN-from-above>"
  exit 0
fi

[[ -n "${GEN}" ]] || { echo "--apply requires --generation <GEN>" >&2; exit 2; }
# Current live generation — used as an optimistic-concurrency guard so a publish
# racing this restore can't be silently clobbered. Empty (no live version, e.g.
# the object was deleted) → guard with 0, which matches "no live version exists";
# either way a racing publish fails the precondition (HTTP 412) instead of a
# silent clobber.
LIVE_GEN="$(gcloud storage objects describe "${URL}" --format='value(generation)' 2>/dev/null || true)"
echo ""
echo "=== restore ${OBJ}#${GEN} → live (current live generation=${LIVE_GEN:-none}) ==="
gcloud storage cp "${URL}#${GEN}" "${URL}" --if-generation-match="${LIVE_GEN:-0}"
echo "restored. (proxy 5-min cache TTL before live; re-verify the served object + its signature)"
