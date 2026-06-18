# Production Reset Runbook

Use this only before external launch, or when losing all policy-server data is
acceptable. This keeps the GKE cluster, namespace, Cloud SQL instance, SQL user,
Redis instance, DNS, Ingress, certificate, and Kubernetes secrets. It resets the
Cloud SQL database contents and lets the Helm migration hook rebuild the schema
from an empty database.

## Current Production Targets

- GCP project: `policy-engine-498313`
- GKE cluster: `dambi-autopilot`
- GKE region: `asia-northeast3`
- Kubernetes namespace: `dambi`
- Helm release: `dambi`
- Cloud SQL instance: `dambi-pg`
- Cloud SQL database: `dambi`
- Kubernetes secret: `policy-server-secrets`
- Helm values: `crates/policy-server/server/deploy/helm/policy-server/values-m3.yaml`

## Reset Procedure

1. Point kubectl at production GKE.

   ```sh
   gcloud container clusters get-credentials dambi-autopilot \
     --region asia-northeast3 \
     --project policy-engine-498313
   kubectl config current-context
   ```

2. Snapshot non-secret state.

   ```sh
   mkdir -p /private/tmp/dambi-reset
   helm get values dambi -n dambi > /private/tmp/dambi-reset/helm-values.yaml
   helm get manifest dambi -n dambi > /private/tmp/dambi-reset/helm-manifest.yaml
   kubectl -n dambi get deploy,pod,svc,ingress,managedcertificate,backendconfig,networkpolicy -o wide \
     > /private/tmp/dambi-reset/k8s-resources.txt
   ```

3. Stop API and worker pods so PostgreSQL connections close before dropping the
   database.

   ```sh
   kubectl -n dambi scale \
     deploy/dambi-policy-server-api \
     deploy/dambi-policy-server-worker \
     --replicas=0
   kubectl -n dambi wait --for=delete pod \
     -l app.kubernetes.io/instance=dambi \
     --timeout=120s
   ```

4. Drop and recreate the application database. This deletes all application
   data, but keeps the Cloud SQL instance and SQL user.

   ```sh
   gcloud sql databases delete dambi \
     --instance dambi-pg \
     --project policy-engine-498313 \
     --quiet
   gcloud sql databases create dambi \
     --instance dambi-pg \
     --project policy-engine-498313
   ```

5. Reinstall the app with the target image tag. The chart's `policy-server-migrate`
   pre-install/pre-upgrade hook runs `policy-server-migrate`, applies all
   PostgreSQL migrations, then the API and worker roll out.

   ```sh
   IMAGE_TAG="$(git rev-parse --short HEAD)"
   helm upgrade --install dambi \
     crates/policy-server/server/deploy/helm/policy-server \
     -n dambi \
     -f crates/policy-server/server/deploy/helm/policy-server/values-m3.yaml \
     --set image.tag="${IMAGE_TAG}"
   ```

6. Verify rollout and readiness.

   ```sh
   kubectl -n dambi rollout status deploy/dambi-policy-server-api --timeout=180s
   kubectl -n dambi rollout status deploy/dambi-policy-server-worker --timeout=180s
   kubectl -n dambi get ingress dambi-policy-server \
     -o jsonpath='{.metadata.annotations.kubernetes\.io/ingress\.allow-http}{"\n"}'
   kubectl -n dambi get backendconfig dambi-policy-server-backendconfig \
     -o jsonpath='{.spec.securityPolicy.name}{"\n"}'
   kubectl -n dambi get serviceaccount dambi-policy-server \
     -o jsonpath='{.automountServiceAccountToken}{"\n"}'
   kubectl -n dambi get deploy dambi-policy-server-api \
     -o jsonpath='{.spec.template.spec.automountServiceAccountToken}{" "}{.spec.template.spec.securityContext.runAsNonRoot}{" "}{.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation}{" "}{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}{" "}{.spec.template.spec.containers[0].securityContext.capabilities.drop[0]}{"\n"}'
   kubectl -n dambi get deploy dambi-policy-server-worker \
     -o jsonpath='{.spec.template.spec.automountServiceAccountToken}{" "}{.spec.template.spec.securityContext.runAsNonRoot}{" "}{.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation}{" "}{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}{" "}{.spec.template.spec.containers[0].securityContext.capabilities.drop[0]}{"\n"}'
   kubectl -n dambi get networkpolicy \
     dambi-policy-server-api dambi-policy-server-worker dambi-policy-server-migrate \
     -o name
   kubectl -n dambi get networkpolicy dambi-policy-server-api \
     -o jsonpath='{.spec.podSelector.matchLabels.app\.kubernetes\.io/component}{" "}{.spec.ingress[0].ports[0].port}{"\n"}'
   kubectl -n dambi get networkpolicy dambi-policy-server-worker \
     -o jsonpath='{.spec.podSelector.matchLabels.app\.kubernetes\.io/component}{" "}{.spec.ingress}{"\n"}'
   gcloud container clusters describe dambi-autopilot \
     --region asia-northeast3 \
     --project policy-engine-498313 \
     --format='value(deletionProtection)'
   gcloud sql instances describe dambi-pg \
     --format='value(settings.availabilityType,settings.backupConfiguration.enabled,settings.backupConfiguration.pointInTimeRecoveryEnabled,settings.deletionProtectionEnabled)'
   gcloud redis instances describe dambi-redis \
     --region asia-northeast3 \
     --format='value(tier,authEnabled)'
   curl -sS -i https://dambi-policy.duckdns.org/health
   curl -sS -i https://dambi-policy.duckdns.org/readyz
   ```

   The ingress annotation must print `false`; production HTTP is intentionally
   disabled after the ManagedCertificate path is in use.
   The BackendConfig security policy must print `dambi-policy-server-edge`.
   The ServiceAccount automount check must print `false`.
   The API and worker security-context checks must print
   `false true false true ALL`.
   The NetworkPolicy list must include API, worker, and migrate policies; the API
   selector/ingress check must print `api 8788`, and the worker check must print
   `worker []`.
   The GKE deletion-protection check must print `true`.
   The Cloud SQL check must show `REGIONAL`, backups enabled, PITR enabled, and
   deletion protection enabled.
   The Redis check must show `STANDARD_HA` with AUTH enabled.

   `/readyz` should report:

   ```json
   {"status":"ready","checks":{"jwt_secret":"ok","oauth_config":"ok","postgres":"ok","postgres_schema":"ok","redis":"ok","required_env":"ok","sync_config":"ok"}}
   ```

## Notes

- Do not delete `policy-server-secrets` during this reset; it contains the
  database URL, OAuth settings, JWT secret, and Redis URL. Production sets
  `REQUIRE_OAUTH_CONFIG=true` and `REQUIRE_REDIS=true`, so missing OAuth or
  Redis config keeps pods from becoming ready instead of surfacing later as a
  login outage or silently disabled cross-replica fanout.
- Do not delete the Cloud SQL instance unless the GKE/Cloud SQL networking or
  Terraform state is also being intentionally rebuilt. Production Terraform
  enables Cloud SQL deletion protection, regional availability, automated
  backups, and point-in-time recovery by default; do not lower those settings
  for a live environment just to make reset/destroy easier.
- Production Terraform also enables GKE cluster deletion protection by default.
  Set `gke_deletion_protection=false` only in disposable environments, not for
  live reset procedures.
- Production Redis is `REQUIRE_REDIS=true`, so the Terraform `redis_url` output
  is sensitive when AUTH is enabled. Use that output for the Kubernetes
  `REDIS_URL` secret; do not hand-write a passwordless Redis URL for production.
- `RUN_MIGRATIONS_ON_STARTUP=false` in the Helm chart. Production migrations are
  expected to run through the Helm hook job, not on every API/worker startup.
- If the Helm upgrade fails during the migration hook, keep the deployments at
  zero replicas, inspect the hook pod logs, fix the migration issue, and rerun
  the Helm upgrade.
