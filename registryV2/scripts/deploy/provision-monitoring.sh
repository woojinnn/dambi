#!/usr/bin/env bash
# Provision Cloud Monitoring for the registry-api proxy: an uptime check on
# /health + three alert policies (5xx burst, p95 latency, uptime failure) + a
# log-based error metric. Idempotent — existing configs are re-detected by
# display name and left as-is (re-run safe; tune thresholds in the console or
# delete-then-re-run). See deploy/_common.sh for project/region/service.
#
#   bash registryV2/scripts/deploy/provision-monitoring.sh
#   NOTIFICATION_CHANNEL=projects/dambi-registry/notificationChannels/123… \
#     bash registryV2/scripts/deploy/provision-monitoring.sh        # + paging
#   ERR_5XX_PER_5M=20 LATENCY_P95_MS=1500 bash …/provision-monitoring.sh
#
# Cost: uptime checks run within the GCP free tier; alert policies + log metrics
# are free. The check itself probes the PUBLIC /health (no auth) from GCP's
# global pollers, so it works against the --no-allow-unauthenticated service
# (run.invoker=allUsers is already bound).
#
# Notification channel (the paging target) is OWNER-PROVIDED. GA gcloud has no
# `channels` group — it needs the beta component — so create one out-of-band:
#   gcloud components install beta
#   gcloud beta monitoring channels create --type=email \
#     --display-name="registry oncall" \
#     --channel-labels=email_address=you@example.com --project=dambi-registry
#   gcloud beta monitoring channels list --project=dambi-registry \
#     --format='value(name)'
# then pass that resource name via NOTIFICATION_CHANNEL. Without it the policies
# are still created (they surface in the console); attach a channel later.
#
# **creates prod observability config.** User runs directly — not in unattended
# automation. Reversible: `gcloud monitoring policies delete` / `uptime delete`.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
rv3_activate_and_guard

# --- Tunable thresholds (env-overridable; conservative defaults) --------------
ERR_5XX_PER_5M="${ERR_5XX_PER_5M:-10}"   # alert when >N 5xx in a 5-min window
LATENCY_P95_MS="${LATENCY_P95_MS:-1000}" # alert when p95 latency > Nms for 5m
NOTIFICATION_CHANNEL="${NOTIFICATION_CHANNEL:-}"

# `--notification-channels` is only appended when a channel is supplied. The
# `${arr[@]+"${arr[@]}"}` expansion is empty-array-safe under `set -u` on the
# bash 3.2 that ships with macOS (a bare "${arr[@]}" would be "unbound").
chan_flag=()
if [[ -n "${NOTIFICATION_CHANNEL}" ]]; then
  chan_flag=(--notification-channels="${NOTIFICATION_CHANNEL}")
  echo "paging → ${NOTIFICATION_CHANNEL}"
else
  echo "NOTIFICATION_CHANNEL unset — policies created console-only (no paging)."
fi

# Derive the live proxy host at runtime (no hardcoded run.app hash).
SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)')"
HOST="${SERVICE_URL#https://}"
echo "proxy host = ${HOST}"

# --- Uptime check on /health (idempotent by display name) ---------------------
UPTIME_NAME="registry-api /health"
existing_uptime="$(gcloud monitoring uptime list-configs \
  --filter="displayName='${UPTIME_NAME}'" --format='value(name)' \
  --project="${PROJECT_ID}" 2>/dev/null | head -1 || true)"
if [[ -z "${existing_uptime}" ]]; then
  echo "=== create uptime check (${UPTIME_NAME}) ==="
  # period=1 (fastest detection; free tier covers all-region 1-min probes).
  # --regions omitted → default = all available regions, which already satisfies
  # the API's ≥3-region minimum (the flag is optional, not mandatory).
  gcloud monitoring uptime create "${UPTIME_NAME}" \
    --project="${PROJECT_ID}" \
    --resource-type=uptime-url \
    --resource-labels=host="${HOST}",project_id="${PROJECT_ID}" \
    --protocol=https --port=443 --path=/health --period=1
  existing_uptime="$(gcloud monitoring uptime list-configs \
    --filter="displayName='${UPTIME_NAME}'" --format='value(name)' \
    --project="${PROJECT_ID}" | head -1)"
else
  echo "uptime check 이미 존재: ${existing_uptime}"
fi
CHECK_ID="${existing_uptime##*/}"   # …/uptimeCheckConfigs/<CHECK_ID>
echo "check_id = ${CHECK_ID}"

# --- Alert policies (idempotent by display name) ------------------------------
create_policy_if_absent() {
  local name="$1"; shift
  local existing
  existing="$(gcloud monitoring policies list \
    --filter="displayName='${name}'" --format='value(name)' \
    --project="${PROJECT_ID}" 2>/dev/null | head -1 || true)"
  if [[ -n "${existing}" ]]; then
    echo "alert policy 이미 존재: ${name}"
    return 0
  fi
  echo "=== create alert policy: ${name} ==="
  gcloud monitoring policies create --project="${PROJECT_ID}" \
    --display-name="${name}" "$@" ${chan_flag[@]+"${chan_flag[@]}"}
}

# 1) 5xx burst — request_count is DELTA, so ALIGN_DELTA over a 300s window =
#    count of 5xx in each 5-min bucket; REDUCE_SUM totals across revisions.
create_policy_if_absent "registry-api 5xx burst" \
  --condition-display-name="5xx > ${ERR_5XX_PER_5M} in 5m" \
  --condition-filter="metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${SERVICE_NAME}\" AND metric.label.\"response_code_class\"=\"5xx\"" \
  --aggregation='{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_DELTA","crossSeriesReducer":"REDUCE_SUM"}' \
  --duration=0s \
  --if="> ${ERR_5XX_PER_5M}" \
  --combiner=OR \
  --documentation="registry-api proxy returned >${ERR_5XX_PER_5M} 5xx in a 5-min window. Check Cloud Run logs + GCS bucket reachability."

# 2) p95 latency — request_latencies is a DISTRIBUTION; ALIGN_PERCENTILE_95
#    yields per-revision p95, REDUCE_MEAN averages it. Held 5m to ignore blips.
create_policy_if_absent "registry-api p95 latency" \
  --condition-display-name="p95 latency > ${LATENCY_P95_MS}ms" \
  --condition-filter="metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${SERVICE_NAME}\"" \
  --aggregation='{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_PERCENTILE_95","crossSeriesReducer":"REDUCE_MEAN"}' \
  --duration=300s \
  --if="> ${LATENCY_P95_MS}" \
  --combiner=OR \
  --documentation="registry-api p95 latency > ${LATENCY_P95_MS}ms for 5m — the extension JIT fetch shares the 8s pre-sign budget; a slow proxy surfaces __engine::timeout."

# 3) Uptime failure — check_passed fraction; <0.5 mean across regions for 10m
#    means a majority of pollers see /health down (not a single-region blip).
create_policy_if_absent "registry-api uptime failed" \
  --condition-display-name="/health failing across regions" \
  --condition-filter="metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.\"check_id\"=\"${CHECK_ID}\"" \
  --aggregation='{"alignmentPeriod":"300s","perSeriesAligner":"ALIGN_FRACTION_TRUE","crossSeriesReducer":"REDUCE_MEAN"}' \
  --duration=600s \
  --if="< 0.5" \
  --combiner=OR \
  --documentation="registry-api /health uptime check failing across regions for 10m. Service likely down — extension installs fail-closed/warn-closed."

# --- Log-based error metric (counter on ERROR+ proxy logs) --------------------
# Logging filters use `resource.labels.<x>` (dotted), distinct from Monitoring's
# `resource.label."<x>"`. This metric lets you graph/alert on raw proxy errors.
LOG_METRIC="registry_api_errors"
echo "=== log-based metric: ${LOG_METRIC} ==="
if gcloud logging metrics describe "${LOG_METRIC}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "log metric ${LOG_METRIC} 이미 존재 — skip"
else
  gcloud logging metrics create "${LOG_METRIC}" --project="${PROJECT_ID}" \
    --description="registry-api proxy log entries at ERROR severity or higher" \
    --log-filter="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND severity>=ERROR"
fi

echo "provision-monitoring 완료. (콘솔 Monitoring → Alerting 에서 채널/임계값 미세조정)"
