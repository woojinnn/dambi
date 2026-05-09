# permit2

## 개요
- **그룹**: `signature` (EIP-712 서명 어댑터, selector 가 아닌 primary type 매칭)
- **chain**: 모든 EVM chain (Permit2 표준 주소가 deterministic 동일)
- **verifying_contract**: `0x000000000022d473030f116ddee9f6b43ac78ba3` (canonical Permit2)
- **출처**: `Uniswap/permit2`
- **emit**: `Action::Permit2(Permit2Action)` → Cedar `Action::"signature.permit2"`

## primary type 6종

`Permit2PermitKind` enum 의 6 변형은 모두 동일한 `Permit2Action` 평면 구조로 노출되며 `permit_kind` 필드로 구분.

| primary_type | permit_kind | witness | 멀티-토큰 |
|---|---|---|---|
| `PermitSingle` | `PermitSingle` | × | × (1 토큰) |
| `PermitBatch` | `PermitBatch` | × | ✓ |
| `PermitTransferFrom` | `PermitTransferFrom` | × | × |
| `PermitBatchTransferFrom` | `PermitBatchTransferFrom` | × | ✓ |
| `PermitWitnessTransferFrom` | `PermitWitnessTransferFrom` | ✓ | × |
| `PermitBatchWitnessTransferFrom` | `PermitBatchWitnessTransferFrom` | ✓ | ✓ |

## Permit2Action 17필드

자세한 의미는 [`../field-reference.md`](../field-reference.md) §4 참조. 주요 정책-가시 필드:

| 필드 | 정책 활용 |
|---|---|
| `spender` | spender allowlist (`spender-allowlist.cedar`) |
| `is_unlimited` | uint160 max 검사 (`no-unlimited-amount.cedar`) |
| `sig_deadline` | deadline cap (`sig-deadline-le-1h.cedar`) |
| `nonce_valid` | nonce sanity (`nonce-sanity.cedar`) |
| `witness_present` | Witness 변형 차단 (`witness-blocklist.cedar`) |
| `chain_id` vs `domain_chain_id` | chain 일치 (`chain-must-match.cedar`) |
| `total_approved_usd` | USD cap (`max-usd-100.cedar`) |
| `approvals[]` | 멀티-토큰 검사 (`max-human-amount-50.cedar`) |

## Token lookup

본 어댑터의 `TokenLookup` 이 화이트리스트 역할. 미등록 토큰은 `Token { symbol: "UNKNOWN", decimals: 18 }` synthetic 반환 — 정책은 unknown 토큰을 일반적으로 거부.

## 특이사항
- on-chain `permit()` calldata (예: 멀티콜에 포함된) 는 본 어댑터가 디코드하지 않음. 각 multicall leg 가 자체 어댑터로 라우팅되어야 함.
- 어댑터는 ECDSA 서명 검증을 하지 않음. host 가 `SignatureRequest.signer` 로 actor 를 제공한다고 신뢰.

## 어댑터 코드 위치
- `crates/adapters/permit2/src/lib.rs` — `Permit2Adapter`
- 6 primary type 의 `decode_*` 메서드 분기
