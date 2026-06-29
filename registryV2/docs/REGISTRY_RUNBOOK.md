# Dambi Registry — Operator Runbook

The **how-to-operate** companion to `REGISTRY_ARCHITECTURE.md` (the what/why). Every
identifier (project, bucket, KMS key, SA, proxy URL, pins) lives in
`REGISTRY_ARCHITECTURE.md` §10 — this doc does not duplicate them, it tells you which
command to run. **Run every command below from the `registryV2/` directory** (where this
doc lives); the `scripts/deploy/…` paths are relative to it. All deploy scripts source
`scripts/deploy/_common.sh`, which pins the prod target (`PROJECT_ID=dambi-registry`,
config `dambi`) and guards the active gcloud account. Override with env
(`PROJECT_ID=… GCLOUD_CONFIG=…`) to target the legacy PoC.

> **Prod-change discipline.** Anything below that mutates GCP (publish, deploy, provision,
> rotate, destroy) is operator-run. The KMS *destroy* and the PoC *decommission* are the
> only hard-to-reverse steps — both are explicitly gated.

---

## 1. Routine operations

| Task | Command | Touches | Frequency |
|---|---|---|---|
| Publish index DATA | `bash scripts/deploy/publish-index.sh` (`PRUNE=1` to delete orphans) | bucket objects | frequent |
| Deploy proxy CODE | `bash scripts/deploy/deploy-proxy.sh` (or tag `registry-proxy-v*` → CI) | Cloud Run revision | rare |
| Provision infra | `bash scripts/deploy/provision-infra.sh` | bucket + SA + KMS + lifecycle | one-time / idempotent |
| Monitoring | `bash scripts/deploy/provision-monitoring.sh` | uptime check + alerts + log-metric | one-time / idempotent |
| Budget | `BILLING_ACCOUNT=… bash scripts/deploy/provision-budget.sh` | billing budget | one-time |

The proxy reads the bucket live, so a publish goes live after the proxy's **5-minute cache
TTL** with no redeploy. A new path *prefix* (e.g. `index/by-selector/`) is gated by the
proxy allowlist in source → needs `deploy-proxy.sh` first. (See ARCHITECTURE §7.)

### Notification channel (one-time, for paging)
GA gcloud has no `channels` group; install the beta component once:
```
gcloud components install beta
gcloud beta monitoring channels create --type=email \
  --display-name="registry oncall" \
  --channel-labels=email_address=YOU@example.com --project=dambi-registry
gcloud beta monitoring channels list --project=dambi-registry --format='value(name)'
```
Re-run monitoring with that resource name to wire paging:
`NOTIFICATION_CHANNEL=projects/dambi-registry/notificationChannels/ID bash scripts/deploy/provision-monitoring.sh`

---

## 2. Incident response (keyed to the alert policies)

| Alert | First checks | Likely fix |
|---|---|---|
| **uptime /health failing** | `gcloud run services describe registry-api-v3 --region asia-northeast3 --format='value(status.url,status.conditions)'`; hit `${URL}/health` | bad revision → roll back revision (below); GCS unreachable → check bucket IAM |
| **5xx burst** | Cloud Run logs `severity>=ERROR` (log-metric `registry_api_errors`); is GCS reachable / object present? | a bad publish (missing object) → republish / `rollback-index.sh`; transient → watch |
| **p95 latency** | min-instances warm? cold-start? GCS latency? | ensure `MIN_INSTANCES≥1`; the JIT fetch shares the 8s pre-sign budget |
| **signature coverage gap** (REQUIRE on) | `SKIP_FAITHFULNESS=1 bash scripts/deploy/verify-bucket-parity.sh` | a sha without a `.sig` → re-run `sign-bundles.ts` + publish `signatures/` |

### Roll back a bad proxy revision
```
gcloud run revisions list --service registry-api-v3 --region asia-northeast3
gcloud run services update-traffic registry-api-v3 --region asia-northeast3 --to-revisions <PRIOR>=100
```
Cloud Run keeps prior revisions; an unhealthy new revision fails the deploy and traffic stays
on the old one, so most "deploys" never need this.

---

## 3. Rollback (data)

**Primary — re-publish a prior tag (bulk).** The index is regenerated from `manifests/`, so
the cleanest rollback is to rebuild a known-good tag and republish:
```
git checkout registry-v<PRIOR>
bash scripts/deploy/publish-index.sh          # rebuild + re-sign + rsync (PRUNE=1 to prune)
git checkout -                                # back to your branch
```
Live after the 5-min proxy cache TTL. (ARCHITECTURE §7 "Rollback".)

**Emergency — single object (surgical).** When a single object is poisoned and a full rebuild
isn't viable, restore it from a retained noncurrent version (bucket versioning + the keep-3
lifecycle make this possible):
```
bash scripts/deploy/rollback-index.sh index/by-callkey/<chain>/<to>/<sel>.json      # dry-run: list generations
bash scripts/deploy/rollback-index.sh <object> --apply --generation <GEN>           # restore one
```
Dry-run is read-only. After a restore, re-verify the served object **and its signature**.

---

## 4. KMS key rotation

The HSM private key never leaves Cloud KMS; rotation adds a new *version* and retires the old.
Use `scripts/deploy/rotate-signing-key.sh` (steps are separate so the risky ones are explicit):

```
# 1) create the new version + see how to extract its pin
bash scripts/deploy/rotate-signing-key.sh new-version

# 2) extract the NEW pin, ship an extension release pinning it FIRST
#    (⚠ with DAMBI_REQUIRE_BUNDLE_SIGNATURE=true the fleet pins ONE key — the new-pin
#    build must roll out before step 3 or installs fail-closed.)

# 3) re-sign every bundle with the new version + publish signatures/
bash scripts/deploy/rotate-signing-key.sh resign --version <NEW>

# 4) wait out the old-pin extension drain window

# 5) destroy the retired version (24h recovery window; irreversible after)
bash scripts/deploy/rotate-signing-key.sh destroy-old --version <OLD>
```

**Dual-pin note (REQUIRE on):** the extension pins a single `PINNED_BUNDLE_PUBLIC_KEY`, so a
zero-downtime rotation needs an extension build that accepts BOTH keys during the window
(an array pin) — that is an extension change, not a registry change. Until then, rotate only
while REQUIRE is OFF, or accept a brief fail-closed window.

---

## 5. Extension release

Tag `ext-v*` → `extension-release.yml` builds Chrome + Firefox (real wasm), zips both, and
attaches them to a GitHub Release. **Store upload stays manual** (a human gates what reaches
users): download the zips, upload `chrome.zip` → Chrome Web Store, `firefox.zip` → AMO.

One-time repo **Variables** (Settings → Variables — non-secret, baked into the public bundle):
```
REGISTRY_BASE_URL              = https://registry-api-v3-65uggwflcq-du.a.run.app
PINNED_BUNDLE_PUBLIC_KEY       = <prod SPKI base64>   (ARCHITECTURE §10)
DAMBI_REQUIRE_BUNDLE_SIGNATURE = true
```

**Release prerequisite (do NOT skip — ARCHITECTURE §7):** sign + publish `signatures/` → deploy
proxy `/signatures/` allowlist → confirm live coverage (`verify-bucket-parity.sh`) → keep
`DAMBI_REQUIRE_BUNDLE_SIGNATURE=true` and ship the release. The release workflow fails before
build artifacts are produced if this variable is not exactly `true`.

---

## 6. PoC decommission criteria

The legacy PoC `scopeball-registry-poc-g` runs dual-run so already-installed extensions pinned
to the PoC URL keep working. Decommission **only when ALL hold**:
1. The shipped extension `.env`/build targets the **prod** URL + prod pin (done — ARCHITECTURE §10 ⑧).
2. A deprecation window has elapsed since that release reached the stable channel.
3. Telemetry / Cloud Run request metrics show **no meaningful traffic** on the PoC proxy
   (`registry-api-v3-891268973493…run.app`).

Then, in order (reversible→irreversible):
```
# a) stop serving (keeps data): route PoC Cloud Run to no traffic / delete the service
gcloud run services delete registry-api-v3 --region asia-northeast3 --project scopeball-registry-poc-g
# b) observe for a further window (bucket still intact for forensics/rollback)
# c) only after confidence: remove bucket + project
gcloud storage rm --recursive gs://scopeball-registry-v3-seoul
gcloud projects delete scopeball-registry-poc-g
```
Project deletion has a 30-day recovery window but is the point of no return — never step (c)
until (a)+(b) have been quiet.

---

## 7. One-time owner setup (gates CI)

| What | Where | Value |
|---|---|---|
| WIF provider secret | repo Secrets `GCP_WIF_PROVIDER` | `projects/1912792298/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| Deploy/sign SA secret | repo Secrets `GCP_DEPLOY_SA` | `registry-signer@dambi-registry.iam.gserviceaccount.com` |
| `production` Environment | repo Settings → Environments | + required reviewer (gates publish + proxy-deploy) |
| Extension build vars | repo Variables | `REGISTRY_BASE_URL` / `PINNED_BUNDLE_PUBLIC_KEY` / `DAMBI_REQUIRE_BUNDLE_SIGNATURE` |

The deploy SA needs, per workflow: publish → `cloudkms.signerVerifier` + `storage.objectAdmin`;
proxy-deploy → `run.admin` + `cloudbuild.builds.editor` + `artifactregistry.writer` +
`iam.serviceAccountUser` on the runtime SA. (ARCHITECTURE §10, `registry-proxy-deploy.yml` header.)
