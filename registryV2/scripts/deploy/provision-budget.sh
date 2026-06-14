#!/usr/bin/env bash
# Create a Cloud Billing budget scoped to the prod registry project, so a cost
# spike (denial-of-wallet against the proxy, runaway egress) pages instead of
# silently billing. The budget itself does NOT cap spend — it only notifies at
# the threshold percentages — so it is a safety net, not a hard limit.
# Idempotent: skips if a budget with the same display name already exists.
#
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#     bash registryV2/scripts/deploy/provision-budget.sh
#   BUDGET_AMOUNT=100USD BILLING_ACCOUNT=… bash …/provision-budget.sh
#
# Find the billing account id:  gcloud billing accounts list
# Needs roles/billing.budgets.editor on the billing account.
#
# **billing config (owner-gated).** User runs directly with the billing-account
# id (sensitive). Threshold notifications go to the billing-account admins by
# default; wire a Monitoring channel with NOTIF_CHANNEL for richer paging.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
rv3_activate_and_guard

: "${BILLING_ACCOUNT:?set BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX  (gcloud billing accounts list)}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-50USD}"
BUDGET_NAME="${BUDGET_NAME:-registry-prod monthly}"
# Optional: a Monitoring notification channel resource name for budget alerts.
NOTIF_CHANNEL="${NOTIF_CHANNEL:-}"

existing="$(gcloud billing budgets list --billing-account="${BILLING_ACCOUNT}" \
  --filter="displayName='${BUDGET_NAME}'" --format='value(name)' 2>/dev/null | head -1 || true)"
if [[ -n "${existing}" ]]; then
  echo "budget 이미 존재: ${BUDGET_NAME} (${existing}) — skip"
  exit 0
fi

# Empty-array-safe (macOS bash 3.2 + set -u) optional channel flag.
notif_flag=()
if [[ -n "${NOTIF_CHANNEL}" ]]; then
  notif_flag=(--notifications-rule-monitoring-notification-channels="${NOTIF_CHANNEL}")
fi

echo "=== create billing budget '${BUDGET_NAME}' (${BUDGET_AMOUNT}) scoped to ${PROJECT_ID} ==="
# Thresholds fire at 50% / 90% / 100% of actual spend, plus a 100% forecast
# alert (warns before month-end if the run-rate is trending over budget).
gcloud billing budgets create \
  --billing-account="${BILLING_ACCOUNT}" \
  --display-name="${BUDGET_NAME}" \
  --budget-amount="${BUDGET_AMOUNT}" \
  --filter-projects="projects/${PROJECT_ID}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend \
  ${notif_flag[@]+"${notif_flag[@]}"}

echo "provision-budget 완료. (Billing → Budgets & alerts 에서 확인)"
