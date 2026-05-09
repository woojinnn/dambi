# Field Reference — DexFacts / Action variant 필드 매트릭스

본 문서는 정책에서 검사 가능한 모든 필드를 채우는 측 / 정책 활용 / 누락 시 동작 으로 정리한다.

---

## 1. DexFacts 11필드

| # | 필드 | 타입 | 채우는 측 | 정책 활용 | 누락 시 |
|---|---|---|---|---|---|
| 1 | `protocol_ids` | `[String]` | 어댑터 | 프로토콜 allowlist 정책 (예: `policies/dex/uniswap-only-allowlist.cedar`) | 항상 1개 이상 (어댑터가 항상 자기 식별자 emit) |
| 2 | `input_tokens` | `[Token]` | 어댑터 | 토큰 화이트리스트, 입력 토큰 종류 검사 | 항상 1개 이상 (단 UNKNOWN fallback 가능) |
| 3 | `output_tokens` | `[Token]` | 어댑터 | 출력 토큰 화이트리스트 | 동일 |
| 4 | `total_input_usd` | `UsdValuation?` | host (Oracle) | USD 한도 정책 (예: `max-input-usd-100.cedar`). `staleSec` 으로 신선도 검사도 가능 | `null` → 정책의 `context has totalInputUsd` 가드가 false → 발동 안 함 (fail-open) |
| 5 | `total_min_output_usd` | `UsdValuation?` | host (Oracle) | 최소 출력 USD 한도 (예: `min-output-usd-floor.cedar`) | 동일 |
| 6 | `max_fee_bps` | `u32?` | 어댑터 (출처 다양) | fee cap 정책 (예: `max-fee-bps-100.cedar`) | `null` → 정책의 `context has maxFeeBps` 가드가 false → fee 검사 우회. 자세한 출처는 §3 |
| 7 | `has_zero_min_output` | `bool` | 어댑터 | 슬리피지 가드 (예: `no-zero-min-output.cedar`). minOutput == 0 인 leg 검출 | 항상 채워짐 (boolean) |
| 8 | `has_external_recipient` | `bool` | 어댑터 | 자금 빼돌리기 방지 — actor 와 다른 수령인이면 true | 항상 채워짐. StableSwap 은 `exchange` 함수에 recipient 가 없어 항상 false |
| 9 | `total_input_fraction_of_portfolio_bps` | `u64?` | host (Portfolio) | 포트폴리오 비율 cap (예: `max-input-fraction-of-portfolio-2000-bps.cedar`) | `null` → 가드 미발동 |
| 10 | `allowances_cover_inputs` | `bool?` | host (Approvals) | allowance 부족 시 차단 (예: `allowance-must-cover-input.cedar`) | `null` → 가드 미발동 |
| 11 | `window_stats` | `WindowStatsContext?` | host (StatWindows) | 24h 롤링 거래량 cap (예: `window-swap-volume-usd-24h-cap-5000.cedar`) | `null` → 미발동 |

---

## 2. 어댑터 책임 vs host enrichment 책임

```
[어댑터]                                  [host enrichment]
calldata 디코드                            HostCapabilities 묶음 사용
  ├─ protocol_ids 채움                       ├─ Oracle::price(token)        → total_input_usd, total_min_output_usd
  ├─ input_tokens 채움                       ├─ Portfolio::balance(owner)   → total_input_fraction_of_portfolio_bps
  ├─ output_tokens 채움                      ├─ Approvals::allowance(...)   → allowances_cover_inputs
  ├─ max_fee_bps 채움 (또는 None)            └─ StatWindows::project(...)   → window_stats
  ├─ has_zero_min_output 채움
  ├─ has_external_recipient 채움
  ├─ oracle_requirements 채움 (host 가 소비)
  └─ trace 채움
```

어댑터는 외부 의존 0. host capability 들이 모두 mock/optional. host capability 부재 시 해당 필드는 `null` 로 남고 정책은 `context has` 가드로 fail-open 처리하는 게 일반적.

---

## 3. `max_fee_bps` 출처별 분류 (★ 중요)

`max_fee_bps` 의 의미는 어댑터마다 다르며, 정책 측은 모두 "보수적 상한" 으로 해석해야 한다 (실행가가 아님).

| 어댑터 | 출처 | 주의 |
|---|---|---|
| `uniswap-v2` | 상수 `Some(30)` | 프로토콜 고정. calldata 미인코딩 |
| `pancakeswap-amm` | 상수 `Some(25)` | PancakeSwap 의 25 bps 고정 fee |
| `aerodrome-v1` | leg-wise max(`stable ? 5 : 30`) | 추정치. 실제 fee 는 풀/팩토리에 보관 |
| `uniswap-v3` | calldata `fee / 100` | 정확. fee tier 가 calldata 에 인코딩 |
| `pancakeswap-v3` | calldata `fee / 100` | 정확. tier 100/500/2500/10000 |
| `aerodrome-slipstream` | `None` | tickSpacing 은 fee 가 아니라서 산출 불가. fee 정책은 자동 fail-open |
| `pancakeswap-stableswap` | 상수 `Some(4)` | 추정 보수적 상한. 실 1~4 bps |
| `universal-router` | child 들의 max 합산 | sub-protocol max 의 max |

**정책 작성 권장**: `context has maxFeeBps && context.maxFeeBps <= N` 패턴을 사용하여, fee 정보가 없는 swap (Slipstream 등)은 cap 검사를 우회시키고 별도 토큰/USD cap 으로 보호.

---

## 4. Permit2Action 17필드

| 필드 | 타입 | 채우는 측 | 정책 활용 |
|---|---|---|---|
| `signer` | Address | host (SignatureRequest) | actor 식별 |
| `chain_id` / `domain_chain_id` | ChainId | host / typed_data | chain 일치 검사 (`chain-must-match.cedar`) |
| `verifying_contract` | Address | typed_data | 표준 Permit2 주소 검증 |
| `primary_type` | String | typed_data | "PermitSingle" 등 |
| `permit_kind` | enum 6종 | 어댑터 derived | witness blocklist (`witness-blocklist.cedar`) |
| `spender` | Address | typed_data | spender allowlist (`spender-allowlist.cedar`) |
| `token` | Token | 어댑터 (TokenLookup) | 단일 토큰 정책 (대표 토큰) |
| `amount` | String | typed_data | unlimited 검사 |
| `expiration` / `sig_deadline` | u64 | typed_data | deadline cap (`sig-deadline-le-1h.cedar`) |
| `nonce` | String | typed_data | sanity 검사 |
| `approvals[]` | array | typed_data | 멀티-토큰 검사 |
| `is_unlimited` | bool | 어댑터 | unlimited 차단 (`no-unlimited-amount.cedar`) |
| `nonce_valid` | bool | 어댑터 | nonce sanity (`nonce-sanity.cedar`) |
| `witness_present` | bool | 어댑터 | Witness 변형 차단 |
| `total_approved_usd` | UsdValuation? | host (Oracle) | USD cap (`max-usd-100.cedar`) |

## 5. Eip2612Action 14필드

본질적으로 단일 토큰 단일 spender 단일 금액 approval 의 평면 구조. 정책은 Permit2 와 거의 동일한 가드 (`spender allowlist`, `no unlimited`, `deadline cap`, `human value cap` 등) 를 사용.

`signer == owner` 검증은 어댑터 빌드 시점에 강제 (불일치 시 `BadCalldata`). 정책은 그 이후 단계라 owner ≠ signer 케이스를 직접 보지 않는다.

## 6. Eip712OtherAction 10필드

미매칭 EIP-712 서명에 대한 catch-all. `types_json` / `message_json` 은 raw payload 를 compact JSON 문자열로 보존하여 정책이 직접 검사 가능. 단 의미적 해석은 정책 작성자 책임.

`verifying_contract` 화이트리스트 (`verifying-contract-allowlist.cedar`) 가 보통 첫 번째 가드.

---

## 7. OtherAction 5필드

```
{
  actor: Address                ← TransactionRequest.from
  target: Address               ← TransactionRequest.to
  selector: Selector            ← calldata 첫 4바이트 hex
  value_wei: String             ← msg.value
  raw_calldata: Hex             ← 전체 calldata
}
```

어떤 transactionEntry 에도 매칭되지 않은 트랜잭션의 fallback. 정책은 `Action::"other"` 액션 id 로 평가하며 보통 `verifying contract allowlist` 또는 `selector denylist` 패턴.
