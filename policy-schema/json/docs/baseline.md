# Baseline — 핵심 모델

본 문서는 scopeball 정책 엔진의 데이터 모델을 정리한다. JSON 스키마는 Rust `crates/policy-engine/src/core.rs` 의 타입에 1:1 대응한다.

---

## 1. Action 5종

scopeball 의 어댑터/파이프라인은 모든 트랜잭션과 서명 요청에 대해 단 하나의 `Action` 을 emit 한다.

```
Action
├─ Dex(DexAction)             ← DEX swap. 라우터/풀/UR 머지 모두 단일 DexAction 으로 집계.
├─ Other(OtherAction)         ← 어떤 어댑터에도 매칭되지 않은 calldata fallback.
├─ Permit2(Permit2Action)     ← Permit2 EIP-712 서명.
├─ Eip2612(Eip2612Action)     ← EIP-2612 Permit 서명.
└─ Eip712Other(Eip712OtherAction)  ← 미매칭 EIP-712 서명 catch-all.
```

JSON 직렬화는 externally-tagged 형식: `{"dex": {...}}`, `{"permit2": {...}}` 등. Rust `serde(rename = ...)` 어트리뷰트로 키 이름이 결정된다.

| Rust variant | JSON 키 | Cedar action id |
|---|---|---|
| `Action::Dex` | `dex` | `Action::"dex"` |
| `Action::Other` | `other` | `Action::"other"` |
| `Action::Permit2` | `permit2` | `Action::"signature.permit2"` |
| `Action::Eip2612` | `eip2612` | `Action::"signature.eip2612"` |
| `Action::Eip712Other` | `eip712Other` | `Action::"signature.eip712_other"` |

---

## 2. DexAction (Action::Dex 본체)

```
DexAction {
  actor: Address              ← 트랜잭션 from
  target: Address             ← 트랜잭션 to (라우터 주소; StableSwap 의 경우 풀 주소)
  value_wei: String           ← msg.value (decimal 문자열)
  facts: DexFacts             ← ★ 정책이 보는 11개 집계 필드
  oracle_requirements: [OracleRequirement]   ← host 가 채울 oracle lookup
  trace: DexTrace             ← audit 채널 (Cedar 미노출)
}
```

`DexAction` 은 한 트랜잭션당 한 개. 어댑터가 멀티콜이나 Universal Router 의 다중 sub-protocol 호출을 받아도 `merge_dex_actions()` 가 합집합을 만들어 단일 `DexAction` 으로 emit 한다.

---

## 3. DexFacts 11필드 (★ 정책 검사 surface)

```
DexFacts {
  protocol_ids:                            Vec<String>
  input_tokens:                            Vec<Token>
  output_tokens:                           Vec<Token>
  total_input_usd:                         Option<UsdValuation>      ★ host enrichment
  total_min_output_usd:                    Option<UsdValuation>      ★ host enrichment
  max_fee_bps:                             Option<u32>
  has_zero_min_output:                     bool
  has_external_recipient:                  bool
  total_input_fraction_of_portfolio_bps:   Option<u64>               ★ host enrichment
  allowances_cover_inputs:                 Option<bool>              ★ host enrichment
  window_stats:                            Option<WindowStatsContext> ★ host enrichment
}
```

★ 표시는 host 가 채우는 필드 (어댑터는 보통 `null`). 자세한 의미는 [`field-reference.md`](field-reference.md).

---

## 4. 부속 타입

### Token
```
{ chain_id: u64, address: Address, symbol: String, decimals: u32, is_native: bool }
```
주소는 lowercase 0x prefix + 40 hex char 정규화. 네이티브 자산(ETH, BNB)은 sentinel `0xeeee...eeee` 주소 + `is_native: true`.

### UsdValuation
```
{ value: DecimalString4, as_of_ts: u64, sources: [String], stale_sec: u64 }
```
`value` 는 Cedar Decimal 4-소수점 정밀도 문자열. host 의 `Oracle` capability 가 산출.

### OracleRequirement
```
{ kind: "input" | "minOutput", token: Token, raw_amount: String }
```
어댑터가 host enrichment 에 요청하는 USD 평가 lookup. host 는 이 목록을 순회하며 Oracle 을 조회하고 `total_input_usd` / `total_min_output_usd` 를 채운다.

### WindowStatsContext
```
{ swap_volume_usd_24h: Option<DecimalString4>, swap_count_24h: Option<u64> }
```
host `StatWindows` 가 산출하는 24시간 롤링 누적 통계. 정책의 윈도우 cap 검사에 사용.

### DexTrace
```
{ steps: [String] }
```
어댑터가 DexAction 을 빌드한 과정의 사람-읽기용 trace. Cedar 정책에 노출되지 않는 audit 채널.

---

## 5. 서명 액션 3종

### Permit2Action (Permit2Action.permit_kind 6종 모두 동일 평면 구조)
- 6 permit_kind: `PermitSingle` / `PermitBatch` / `PermitTransferFrom` / `PermitBatchTransferFrom` / `PermitWitnessTransferFrom` / `PermitBatchWitnessTransferFrom`
- 17 필드 평면화: signer / chain_id / domain_chain_id / verifying_contract / primary_type / permit_kind / spender / token / amount / expiration / sig_deadline / nonce / approvals[] / is_unlimited / nonce_valid / witness_present / total_approved_usd

### Eip2612Action
- ERC-20 토큰 컨트랙트 자체가 verifying_contract. 단일 spender × 단일 토큰 × 단일 금액.
- 14 필드: signer / owner / chain_id / domain_chain_id / verifying_contract / primary_type / spender / token / is_unlimited / nonce_valid / value / deadline / nonce / total_approved_usd

### Eip712OtherAction (catch-all fallback)
- Permit2 / EIP-2612 어댑터 모두에 매칭되지 않은 EIP-712 서명. 파이프라인이 직접 합성.
- 10 필드: signer / chain_id / domain_chain_id / verifying_contract / primary_type / domain_name / domain_version / domain_salt / types_json (compact JSON 문자열) / message_json

---

## 6. JSON 직렬화 컨벤션

- 필드명은 **snake_case** (Rust 의 `serde` 기본). 서명 관련 일부 (`SignatureRequest`, `Eip712TypedData`, `Eip712Domain`) 는 `rename_all = "camelCase"` 이지만 본 스키마 범위에는 들어오지 않음 (Eip712Domain 의 필드는 `Eip712OtherAction` 에서 평면화되어 snake_case 로 노출).
- Address 는 lowercase 0x-prefix.
- u256/wei 등 큰 정수는 decimal **문자열**로 (JSON Number 는 IEEE 754 double 이라 U256 손실).
- `DecimalString4` 는 4-소수점 decimal 문자열.
- `Option<T>` 는 `None` 일 때 `null` (skip 안 함).

---

## 7. 정책 엔진과의 관계

본 JSON 스키마는 **데이터 사양**이고, Cedar 정책 엔진은 **그 위에서 평가**한다.

```
TransactionRequest / SignatureRequest
        ↓
    어댑터 (calldata/typed-data 디코드)
        ↓
    Action (본 JSON 스키마가 정의하는 형태)
        ↓
    host enrichment (oracle/portfolio/approvals/stats 채움)
        ↓
    Cedar PolicyRequest (lowering)
        ↓
    Verdict (Pass / Warn / Fail)
```

Cedar 스키마(`policy-schema/*.cedarschema`)는 본 JSON 스키마와 별개로 운영되며, lowering 단계가 두 모델 사이의 다리 역할을 한다.
