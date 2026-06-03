# Policy catalog v2 — precedence-bucket tree

55 research-grounded wallet pre-sign 보안 정책. v2 ActionBody 모델 대상 (Phase C). **검증된 corpus**이며
shipped default 가 **아니다** — `crates/policy-engine/tests/fixtures/default_policies_v2/` (9 bundle) 는 별개로
유지되고, 이 55개는 auto-install / enforce 되지 않는다.

## 구조 — precedence 4-bucket tree

정책은 **단일 트리**에 산다. 4 bucket 은 `compliance > protocol > wallet > action` **우선순위**로 정렬되고
**first-match-wins** 로 배치가 결정론적·배타적이다. (4 bucket 은 사실 두 축 — *specificity*(generic↔protocol-bound)
와 *source*(security↔regulatory↔user-config) — 이 섞여 있어, 우선순위 규칙으로 모호성을 제거한다.)

```
policy_catalog_v2/
├─ README.md                 # ← 이 파일 (인덱스)
├─ _methods/                 # 공유 aggregator-method 구현스펙 (method 1개 = 파일 1개; manifest method 이름이 링크 키)
├─ compliance/  [precedence 1]  규제·제재·관할 mandate 만 (현재 0 set — 예약, compliance/README.md)
├─ protocol/    [precedence 2]  protocol-specific SEMANTICS 의존 (단순 venue-fire 아님)
├─ wallet/      [precedence 3]  per-wallet 유저/operator config (allow/deny list, usd cap, fraction)
└─ action/      [precedence 4]  protocol-agnostic 보안 best-practice (fallback)
```

### 배치 규칙 (보강 2)

`protocol/` 은 **protocol-specific action tag** (예: `hl_order`, `set_e_mode`, `delegate_to`, `vote_for_gauge`,
`pt_swap`, `permit2_*`, `sign_intent_order`) 에만 쓴다. **generic tag** (`swap`, `erc20_approve`, `erc20_transfer`,
`open_position`, `borrow`) 는 venue 에서 fire 해도 `action/` (또는 config 면 `wallet/`) 으로 간다. precedence 에서
탈락한 cross-cutting 속성은 cedar 의 `// tags:` 줄로 **보존**한다 (아래 Tags).

## policy set = 폴더(파일 2개) + 공유 `_methods/`

| 위치 | 파일 | 역할 | tracked |
|---|---|---|---|
| `<bucket>/<sub>/<id>/` | `policy.cedar` | Cedar 규칙 + **rationale 주석** (blocks / why / tags / methods 링크) | ✅ |
| 〃 | `manifest.json` | trigger / `policy_rpc` method / `id` (== leaf dir 이름) | ✅ |
| `_methods/` | `<method>.md` | aggregator method **구현스펙** (RPC 서버가 어떻게 구현) — method 당 1벌 공유 | ✅ (gitignore whitelist) |

`oracle.usd_value` 하나를 5개 정책이 공유 → 구현스펙을 폴더마다 복사하면 drift. 그래서 `_methods/<method>.md` 1벌을
두고, manifest 의 `"method"` 문자열이 곧 링크 키(RPC dispatcher 의 라우팅 키와 동일 cardinality). 각 정책은 자기
`policy.cedar` 의 `// methods:` 줄에서 필요한 메서드만 `../../../_methods/<m>.md` 로 가리킨다.

## 검증

- `cargo test -p policy-engine --test policy_catalog_v2` — 트리 전체를 재귀 walk(`_` prefix 스킵)하여 각 set 이
  parse + `ManifestV2::validate` + **Cedar-compile**(`compose_per_policy` → `build_from_per_policy`) 됨을 확인. floor ≥ 45.
- `cargo test -p policy-engine-integration-tests --test real_tx_catalog_mapping` — 실제 tx 를 production 디코더로
  ActionBody 매핑 → 이 카탈로그 정책으로 평가 (corpus + USDC unlimited-approve deny + env-gated live Etherscan).

## 인덱스 (55) — `(severity)` `[enrichment method]`

분포: **action 28 / wallet 11 / protocol 16 / compliance 0**. 7 deny / 48 warn. 18 enrichment / 37 static.

### action/ (28) — protocol-agnostic best-practice
- **approval/** (7): `unlimited-erc20-approve` (deny) · `nft-set-approval-for-all-confirm` · `nft-approve-confirm` · `approve-existing-allowance` [approval.allowance] · `permit-unknown-spender` (deny) [address.reputation] · `permit-far-deadline` [clock.now] · `permit-unlimited-amount` (deny)
- **swap/** (5): `swap-high-slippage` · `swap-price-impact-cap` · `swap-min-out-zero` · `swap-recipient-not-self` · `lp-low-liquidity` [pool.liquidity]
- **transfer/** (2): `transfer-recipient-reputation` (deny) [address.reputation] · `transfer-new-recipient` [address.activity]
- **lending/** (3): `borrow-confirm` · `borrow-low-health-factor` [lending.health_factor] · `withdraw-collateral-health-factor` [lending.health_factor]
- **perp/** (1): `perp-open-high-slippage`
- **permission/** (2): `protocol-authorization-confirm` · `governance-delegate-confirm`
- **token/** (3): `fee-on-transfer-token` [token.metadata] · `rebasing-token-approve` [token.metadata] · `supply-empty-vault-inflation` [vault.share_state]
- **batch/** (5, outer scope): `large-batch-warn` · `huge-batch-deny` (deny) · `batch-bundled-approval` · `batch-mixed-approve-swap` · `batch-bundled-setapprovalforall`

### wallet/ (11) — per-wallet user/operator config
- **usd-cap/** (5): `large-erc20-approve` · `swap-usd-cap` · `transfer-usd-cap` · `borrow-usd-cap` · `perp-position-usd-cap` — 전부 [oracle.usd_value]
- **recipient-allowlist/** (3): `transfer-recipient-allowlist` · `swap-recipient-allowlist` · `permit2-transferfrom-recipient-allowlist` (venue:permit2)
- **recipient-denylist/** (1): `transfer-recipient-denylist` (deny)
- **venue-allowlist/** (1): `swap-venue-allowlist`
- **fraction-of-holdings/** (1): `transfer-fraction-of-holdings` [portfolio.input_fraction_bps]

### protocol/ (16) — protocol-specific semantics
- **permit2/** (3): `permit2-approve-confirm` · `permit2-sign-allowance-confirm` · `permit2-sign-transfer-confirm`
- **aave/** (2): `set-emode-confirm` (e-mode) · `delegate-borrow-confirm` (credit delegation)
- **hyperliquid/** (5): `hl-no-short-perp` (deny) · `hl-high-leverage` · `hl-withdraw-confirm` · `hl-send-to-evm-with-data-confirm` · `hl-approve-agent-confirm`
- **eigenlayer/** (1): `restaking-delegate-confirm` (delegateTo)
- **curve/** (1): `gauge-vote-confirm` (veCRV gauge weight)
- **lido/** (1): `liquid-stake-confirm` (submit)
- **pendle/** (1): `pt-swap-min-out-zero`
- **intent-venue/** (2): `intent-order-sign-confirm` · `intent-order-far-validuntil` [clock.now]

### compliance/ (0) — 예약 슬롯
규제/제재/관할 mandate 정책 전용. 현 카탈로그엔 없음 (denylist=operator config, reputation=scam-oracle, usd-cap=hard-coded
literal — 어느 것도 규제 mandate 아님). `tag:could-be-compliance-*` 표시된 정책은 feed/근거가 규제로 바뀌면 승격 후보.
세부는 `compliance/README.md`.

## Tags — cross-cutting 질의

precedence 가 action-family 를 쪼개는 경우(예: `swap-min-out-zero`@action ↔ `pt-swap-min-out-zero`@protocol)를
`// tags:` 가 봉합한다. 각 cedar 헤더에 `bucket:` `cat:` `static|enrichment` `method:<m>` + 보존 tag
(`action-family:*`, `venue:*`, `could-be-compliance:*`) 이 1줄로 들어간다. 예:

```bash
grep -rl 'action-family:min-out-zero' --include='*.cedar'   # 분할된 동일 best-practice 재봉합
grep -rl 'could-be-compliance'        --include='*.cedar'   # 규제 승격 후보
grep -rl 'method:oracle.usd_value'    --include='*.cedar'   # 한 메서드에 의존하는 정책 전부
```

## 신규 정책 추가 (authoring checklist)

1. `manifest.json` 초안 — domain/tag/scope/`policy_rpc`(method).
2. **bucket 결정 = precedence 기계 적용**: 규제 mandate? → `compliance/`. 아니면 protocol-specific tag? → `protocol/<name>/`.
   아니면 per-wallet config? → `wallet/<sub>/`. 아니면 → `action/<cat>/`. 첫 매치 = 경로.
3. `<bucket>/<sub>/<id>/` 생성, **`id` == leaf dir 이름** (loader 가 강제).
4. `policy.cedar` 작성 + 헤더 주석(`// blocks: / why: / bucket: / tags: / methods:`). precedence 탈락 속성은 tag 로.
5. 각 method 가 `_methods/` 에 spec 있는지 확인; 없으면 신규 = `_methods/<m>.md` 추가 (+ 구현 시 `schema/method-catalog.json` 등록).
6. `cargo test -p policy-engine --test policy_catalog_v2` (compile+schema) green.

## Out of scope (작성 안 함 — 정적 디코드로 표현 불가)

ScopeBall 은 **static** pre-sign analyzer. 아래는 execution trace / rendering-layer 데이터가 필요:

- **Flash-loan / atomic-exploit intent** — borrow→manipulate→repay 시퀀스는 execution trace 필요.
- **Reentrancy / unsafe state transition** — simulated execution 의 state-diff 필요.
- **EIP-712 rendering normalization bypass** — wallet-UI 렌더링 관심사 (주소 표기 방식), 디코드된 typed data 의 속성 아님.
- **Raw-bytecode honeypot** — 대상 컨트랙트 bytecode 스캔은 디코드된 ActionBody 밖. `token.metadata.isVerified` 가 거친 static 근사.
