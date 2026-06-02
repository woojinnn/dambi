# Policy Server Kubernetes Migration Plan

작성일: 2026-06-02

## 목표

`crates/policy-server`를 Kubernetes에서 운영할 수 있도록 런타임 책임과 운영 선언을 분리한다.

현재 서버는 Docker image로 실행할 수 있고 PostgreSQL/Redis 연동 코드도 일부 존재하지만, 여러 API pod와 여러 worker pod를 띄웠을 때 안전하게 동작하려면 다음 경계가 필요하다.

- worker replica 간 같은 user sync 중복 실행 방지
- API on-demand sync와 worker periodic sync 간 lock 공유
- API replica 간 SSE event fanout
- liveness와 readiness 분리
- migration을 app startup이 아니라 배포 단계의 Job으로 분리
- Deployment, Service, Ingress, Secret reference, ConfigMap, probes, HPA, PDB, NetworkPolicy, migration Job 선언

## 현재 아키텍처 요약

policy-server는 같은 Rust package 안에서 세 실행 단위를 제공한다.

- `policy-server`: HTTP API server
- `sync_worker`: 주기적으로 user wallet state를 sync하는 background worker
- `migrate`: PostgreSQL migration만 실행하고 종료하는 migration binary

API server는 다음 흐름을 갖는다.

1. `ServerConfig::from_env()`가 환경 변수를 읽는다.
2. `StorageBackend`가 PostgreSQL connection pool과 DB store들을 만든다.
3. `AppState`가 handler에 필요한 DB, sync config, event publisher, coordinator를 보관한다.
4. Axum router가 auth, wallet, evaluate, SSE, health endpoint를 노출한다.
5. handler는 `policy-sync` orchestrator를 호출해 wallet live field와 primitive state를 갱신한다.

Worker는 다음 흐름을 갖는다.

1. 동일한 `ServerConfig`와 `StorageBackend`를 사용한다.
2. DB에서 user list를 읽는다.
3. 각 user에 대해 lock을 잡고 wallet list를 순회한다.
4. `SyncScheduler`를 통해 wallet state를 refresh한다.
5. tick interval마다 이 작업을 반복한다.

## 핵심 설계 결정

### Docker image 공유

API, worker, migration Job은 같은 image를 사용한다. 운영에서 image tag를 하나만 추적하면 되고, schema migration과 app rollout이 같은 commit artifact에서 나온다는 점이 중요하다.

Container command만 다르다.

- API: `/usr/local/bin/policy-server`
- Worker: `/usr/local/bin/scopeball-sync-worker`
- Migration Job: `/usr/local/bin/policy-server-migrate`

### Managed PostgreSQL과 managed Redis 사용

Kubernetes chart는 PostgreSQL/Redis 자체를 설치하지 않는다. production에서는 cloud managed service를 사용한다고 가정한다.

이 결정 때문에 chart는 다음 값만 Secret으로 받는다.

- `DATABASE_URL`
- `REDIS_URL`

DB와 Redis의 lifecycle, backup, failover, encryption, monitoring은 cluster 내부 chart가 아니라 cloud provider 또는 별도 운영 체계에서 담당한다.

### ConfigMap과 Secret 분리

`scopeball-sync.toml`은 기본적으로 non-secret config로 보고 ConfigMap에 저장한다. 단, provider URL 자체에 API key가 들어가는 구조라면 그 값은 Secret에서 온 환경 변수로 치환해야 한다.

민감한 값은 chart default에 넣지 않는다.

- DB URL
- Redis URL
- JWT secret
- Google OAuth secret
- Etherscan API key
- CoinGecko API key
- paid RPC provider key

## Worker Coordination

### 문제

기존 worker는 `Coordinator` trait를 사용하지만 실제 runtime에서는 `NoopCoordinator`가 고정되어 있었다. `NoopCoordinator`는 항상 lock 획득 성공을 반환한다.

따라서 Kubernetes에서 worker replica를 2개 이상 띄우면 같은 user에 대한 sync가 동시에 실행될 수 있다.

위험은 다음과 같다.

- 같은 external RPC, oracle, venue API를 중복 호출한다.
- rate limit과 비용이 증가한다.
- 같은 `wallet_states.state_json` snapshot을 서로 다른 pod가 갱신하고 마지막 write가 앞선 write를 덮을 수 있다.
- worker sync와 API `POST /wallets/:address/sync`가 동시에 같은 user state를 수정할 수 있다.

### 변경 방향

`ServerConfig`에 Redis URL이 있으면 `RedisCoordinator`를 사용하고, 없으면 local/dev fallback으로 `NoopCoordinator`를 사용한다.

lock namespace는 user 단위로 통일한다.

```text
sync:user:{user_id}
```

worker periodic sync와 API on-demand sync가 같은 lock key를 사용하므로, worker가 특정 user를 sync하는 동안 API sync 요청이 들어오면 API는 `409 Conflict`를 반환한다.

### TTL

lock TTL은 `SYNC_LOCK_TTL_SECS`로 설정한다.

기본값은 다음 계산을 따른다.

```text
max(SYNC_WORKER_TICK_SECS * 4, 120)
```

이 값은 worker tick보다 충분히 길어야 하지만, pod crash 후 lock이 영구적으로 남지 않도록 bounded TTL이어야 한다.

## SSE Fanout

### 문제

기존 SSE event bus는 process-local broadcast channel이다.

API pod A에 dashboard SSE client가 연결되어 있고 API pod B에서 wallet sync가 처리되면, B의 local bus에만 event가 publish된다. A에 붙은 client는 event를 받지 못한다.

### 변경 방향

Redis pub/sub channel을 API replica 사이의 fanout layer로 사용한다.

기본 channel은 다음과 같다.

```text
policy-server:events
```

Redis mode의 event 흐름은 다음과 같다.

1. handler가 `EventPublisher.publish(user_id, event)`를 호출한다.
2. `RedisEventPublisher`가 `{ user_id, event }` envelope를 JSON으로 Redis channel에 publish한다.
3. 모든 API pod가 startup 때 Redis channel subscriber task를 띄운다.
4. subscriber task가 Redis message를 local `EventBus`로 fanout한다.
5. SSE handler는 기존처럼 local `EventBus`만 구독한다.

origin pod도 Redis를 통해 자기 local bus로 event를 받는다. publisher가 local bus에 직접 publish하지 않기 때문에 중복 SSE event를 피할 수 있다.

Redis URL이 없으면 local/dev mode로 `LocalEventPublisher`를 사용한다.

## Readiness

### `/health`

`/health`는 liveness endpoint로 유지한다.

역할은 process가 살아 있고 HTTP server가 응답 가능한지만 보는 것이다. DB나 Redis 장애 때문에 liveness가 실패하면 Kubernetes가 pod를 불필요하게 재시작할 수 있다.

### `/readyz`

`/readyz`는 Service traffic을 받아도 되는지 판단한다.

확인 항목은 다음과 같다.

- required env: `DATABASE_URL`, `JWT_SECRET`
- PostgreSQL: `SELECT 1`
- Redis: `REDIS_URL`이 있으면 `PING`
- sync config: `SCOPEBALL_SYNC_CONFIG` 또는 기본 `./scopeball-sync.toml` load

`REQUIRE_SYNC_CONFIG=true`이면 sync config load 실패는 readiness 실패다. local/dev 기본값은 false이고 Kubernetes 기본값은 true다.

응답은 JSON report 형태다.

```json
{
  "status": "ready",
  "checks": {
    "postgres": "ok",
    "redis": "ok",
    "required_env": "ok",
    "sync_config": "ok"
  }
}
```

실패 시 status는 `not_ready`이고 HTTP status는 `503 Service Unavailable`이다.

## Migration Ownership

### 문제

기존에는 `StorageBackend::open()` 과정에서 migration이 실행됐다. API pod와 worker pod가 동시에 시작되면 여러 process가 migration을 동시에 시도할 수 있고, migration 실패와 app startup 실패가 섞인다.

Kubernetes rolling deploy에서는 schema 변경 순서를 명확히 통제해야 한다.

### 변경 방향

`RUN_MIGRATIONS_ON_STARTUP`을 추가한다.

- local/dev 기본값: `true`
- Kubernetes chart 기본값: `false`

새 migration binary는 DB migration만 실행하고 종료한다. Kubernetes deploy 순서는 다음을 따른다.

1. ConfigMap과 Secret reference 적용
2. migration Job 실행
3. Job success 대기
4. API Deployment rollout
5. `/readyz` readiness 확인
6. Worker Deployment rollout

## Kubernetes 선언

Helm chart 위치:

```text
crates/policy-server/server/deploy/helm/policy-server
```

### API Deployment

역할:

- OAuth/JWT 인증
- wallet API
- evaluate API
- SSE stream
- health/readiness endpoint

주요 설정:

- command: `policy-server`
- container port: `8788`
- liveness: `GET /health`
- readiness: `GET /readyz`
- startup: `GET /readyz`
- rolling update: `maxSurge: 1`, `maxUnavailable: 0`
- ConfigMap mount: `/app/scopeball-sync.toml`
- Secret env reference: `existingSecret`

초기 replica는 `1`이다. Redis SSE fanout이 검증된 뒤 `2+`로 올릴 수 있다.

### API Service

역할:

- API pod들에 대한 stable in-cluster address 제공
- Ingress가 이 Service로 route

기본:

- type: `ClusterIP`
- service port: `80`
- target port: `8788`

### Ingress

역할:

- 외부 HTTPS traffic을 API Service로 전달

기본 host:

```text
api.scopeball.dev
```

SSE는 long-lived HTTP connection이므로 ingress controller timeout annotation이 필요할 수 있다. nginx 기준으로 read/send timeout을 길게 둔다.

### Worker Deployment

역할:

- 주기적으로 user wallet state sync
- 외부 HTTP traffic 없음

주요 설정:

- command: `scopeball-sync-worker`
- API와 같은 image 사용
- ConfigMap mount와 Secret env 사용
- API보다 높은 CPU/memory resource 기본값 사용

초기 replica는 `1`이다. Redis lock integration test와 provider rate limit 검토 후 `2+`로 올린다.

### ConfigMap

`scopeball-sync.toml`을 저장하고 `/app/scopeball-sync.toml`로 mount한다.

Kubernetes runtime env:

```text
SCOPEBALL_SYNC_CONFIG=/app/scopeball-sync.toml
```

### Secret

chart는 `existingSecret: policy-server-secrets`를 기본값으로 사용한다. raw secret manifest는 git에 commit하지 않는다.

필수/권장 key:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ETHERSCAN_API_KEY`
- `COINGECKO_API_KEY`

### Resource Requests and Limits

초기 기본값:

API:

- request: `100m CPU`, `256Mi memory`
- limit: `500m CPU`, `512Mi memory`

Worker:

- request: `250m CPU`, `512Mi memory`
- limit: `1000m CPU`, `1Gi memory`

production metrics를 본 뒤 조정해야 하는 항목:

- DB pool pressure
- wallet state JSON size
- sync duration
- external RPC latency
- large wallet sync 중 memory usage

### HPA

초기에는 disabled다.

API HPA는 Redis event fanout이 검증된 뒤 enable한다.

기본 정책:

- min replicas: 2
- max replicas: 5
- CPU target: 70%

Worker HPA는 바로 켜지 않는다. provider rate limit, Redis lock, work partitioning을 먼저 검증해야 한다.

### PDB

API PDB:

- `minAvailable: 1`

Worker PDB:

- `maxUnavailable: 1`

API replica가 1인 초기 phase에서는 PDB가 node drain을 막을 수 있다. replica를 2로 올린 뒤 다시 조정한다.

### ServiceAccount

API와 worker에 dedicated ServiceAccount를 부여한다.

초기에는 Kubernetes API permission을 주지 않는다. cloud secret manager 연동이 필요하면 필요한 secret read 권한만 최소 범위로 추가한다.

### NetworkPolicy

기본은 disabled다. cluster CNI와 managed DB/Redis 접근 방식이 확인된 뒤 enable한다.

허용해야 할 traffic:

- ingress controller namespace에서 API pod `8788`로 ingress
- DNS egress
- managed PostgreSQL egress
- managed Redis egress
- Google OAuth endpoint egress
- Etherscan/CoinGecko egress
- configured RPC/oracle/venue HTTPS endpoint egress

### Migration Job

역할:

- app rollout 전에 DB migration을 한 번 실행

주요 설정:

- command: `policy-server-migrate`
- restartPolicy: `Never`
- backoffLimit: `1`
- API/worker와 같은 Secret env 사용
- Service/Ingress 없음

## Rollout Phases

### Phase 1: single-replica Kubernetes

목표는 분산 동작을 크게 바꾸지 않고 Kubernetes에서 안전하게 기동하는 것이다.

포함:

- Helm chart
- API Deployment replicas 1
- Worker Deployment replicas 1
- ConfigMap/Secret reference
- Service/Ingress
- `/readyz`
- migration Job

### Phase 2: distributed worker safety

목표는 worker replica를 늘려도 같은 user sync가 중복 실행되지 않게 하는 것이다.

포함:

- RedisCoordinator wiring
- API on-demand sync lock
- Redis lock integration test
- Worker replicas 2+

### Phase 3: distributed API safety

목표는 API replica를 늘려도 SSE event가 누락되지 않게 하는 것이다.

포함:

- Redis event fanout
- cross-replica SSE integration test
- API replicas 2+
- API HPA enable

### Phase 4: production hardening

목표는 실제 traffic과 장애 상황에서 운영 가능한 상태를 만드는 것이다.

포함:

- resource tuning
- PDB tuning
- NetworkPolicy enablement
- readiness failure alert
- sync error/rate-limit alert
- DB backup/restore runbook
- Redis outage runbook
- migration rollback/compatibility runbook

## Verification Plan

### Local verification

실행할 명령:

```bash
cargo fmt
cargo clippy -p policy-server -p policy-db -p policy-sync --all-targets -- -D warnings
cargo test -p policy-server -p policy-db -p policy-sync
cargo build --release -p policy-server
```

### Helm verification

실행할 명령:

```bash
helm template policy-server crates/policy-server/server/deploy/helm/policy-server
```

이 명령은 local environment에 Helm이 설치되어 있어야 한다.

### Kubernetes smoke tests

배포 후 확인:

- `GET https://api.scopeball.dev/health` returns 200
- `GET https://api.scopeball.dev/readyz` returns 200
- OAuth login redirects to Google
- OAuth callback redirects to dashboard
- authenticated `GET /auth/me` works
- authenticated `GET /wallets` works
- authenticated `POST /wallets` creates wallet
- authenticated `POST /wallets/:address/sync` completes or returns clear lock conflict
- `GET /events/stream` opens and receives events after sync

## Remaining Operational Decisions

이 PR은 Kubernetes migration의 app/runtime/chart 기반을 만든다. production rollout 전에 다음은 운영자가 확정해야 한다.

- 실제 image repository와 tag policy
- External Secrets 또는 cloud secret manager 방식
- managed PostgreSQL network endpoint
- managed Redis network endpoint
- ingress controller 종류와 SSE timeout annotation
- cert-manager issuer 또는 TLS secret 관리 방식
- production `scopeball-sync.toml`
- provider API key가 URL에 들어가는 경우의 env expansion 방식
- Redis outage 시 API replica/HPA policy
- worker replica 확대 시 provider rate limit budget
