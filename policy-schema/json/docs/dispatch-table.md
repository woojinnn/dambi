# Dispatch Table — `dispatch.json` 산문 리퍼런스

본 문서는 `dispatch.json` 의 분류기 lookup 테이블 데이터를 산문으로 설명한다. 분류기 입출력 계약 / 그룹 분류 / 결정 로그 / fallback 동작.

---

## 1. 분류기 입출력 계약

### 입력
- `TransactionRequest`: `(chainId, to, selector)` triple
- 또는 `SignatureRequest`: `(verifyingContract, primaryType)` pair

### 출력 (DispatchEntry)
```ts
{
  protocolId: string,         // "uniswap-v2", "pancakeswap-amm" 등
  adapterId: string,          // "uniswap-v2/swapExactTokensForTokens@0.1.0"
  functionName: string,       // "swapExactTokensForTokens"
  actionKind: "dex" | "permit2" | "eip2612",
  group: "constant-product" | "concentrated-liquidity" | "stableswap" | "meta-router" | "signature",
  feePolicy: string,          // 아래 §3
  notes?: string
}
```

매칭 실패 시 fallback (§4) 적용.

---

## 2. 그룹 분류

`dispatch.json.groups` 5종은 어댑터의 ABI 형태에 기반한다 (정책 의미가 아닌 구현 형태 분류).

| 그룹 키 | 의미 | 어댑터 |
|---|---|---|
| `constant-product` | V2-shape: `path: address[]` (또는 `Route[]`) + 6 swap 함수 패턴 | uniswap-v2, pancakeswap-amm, aerodrome-v1 |
| `concentrated-liquidity` | V3-shape: `params struct` + `packed bytes path` + multicall | uniswap-v3, pancakeswap-v3, aerodrome-slipstream |
| `stableswap` | Curve-style: 풀 컨트랙트 단위 `exchange(i,j,dx,min_dy)` | pancakeswap-stableswap |
| `meta-router` | N 프로토콜 commands 디스패처 | universal-router |
| `signature` | EIP-712 서명 — selector 가 아닌 primary type 으로 매칭 | permit2, eip2612 |

---

## 3. fee policy 코드

`feePolicy` 필드는 `max_fee_bps` 의 출처/신뢰도 분류:

| 코드 | 의미 | 어댑터 |
|---|---|---|
| `constant_30_bps` | 프로토콜 고정 30 bps | uniswap-v2 |
| `constant_25_bps` | 프로토콜 고정 25 bps | pancakeswap-amm |
| `estimate_stable_5_volatile_30` | leg-wise `stable ? 5 : 30` 추정 | aerodrome-v1 |
| `calldata_fee_div_100` | params struct 의 `uint24 fee / 100` | V3 *Single* 함수들 |
| `calldata_packed_path_max_fee` | packed path 의 leg-wise max(fee/100) | V3 `exactInput` / `exactOutput` |
| `none_tickspacing_only` | 항상 `null` (tickSpacing 은 fee 가 아님) | aerodrome-slipstream |
| `constant_4_bps_estimate` | 보수적 상한 4 bps | pancakeswap-stableswap |
| `merged_max_across_children` | multicall 자식들의 max | V3 multicall 어댑터 |
| `merged_max_across_subprotocols` | UR sub-protocol 들의 max | universal-router |

---

## 4. 매칭 결정 트리

```
TransactionRequest 도착
    ↓
(chainId, to, selector) 으로 transactionEntries 검색
    ├─ 정확히 일치 1건 → 어댑터 지정 → DexAction (또는 OtherAction 강제)
    │       ↓
    │    DexAction 의 group / feePolicy 등을 메타로 enrichment 단계에 전달
    │
    └─ 매칭 실패 → fallback.transactionUnmatched
            ↓
         OtherAction 합성 (어댑터 없이 파이프라인이 직접):
           selector = tx.selector, raw_calldata = tx.data, value_wei = tx.value


SignatureRequest 도착
    ↓
(verifyingContract, primaryType) 으로 signatureEntries 검색
    ├─ 매칭 → 해당 어댑터로 Permit2Action 또는 Eip2612Action emit
    └─ 매칭 실패 → fallback.signatureUnmatched
            ↓
         Eip712OtherAction::from_request() 합성 (catch-all)
```

---

## 5. 부정 규칙 (NEGATIVE)

scopeball 의 dispatch.json 에는 schema_v260508 의 `NEGATIVE_DISPATCH` (sweep / pay_portion / balance_check 등 정산 보조 opcode 제외) 같은 별도 카드가 없다. universal-router 어댑터가 sub-command 처리 시 비-swap opcode (PERMIT2_PERMIT, WRAP_ETH, SWEEP 등) 를 인식하여 DexAction 의 합집합에는 영향을 주지 않도록 처리. 자세한 부정 규칙은 [`protocols/universal-router.md`](protocols/universal-router.md) 참조.

---

## 6. selector 충돌 케이스

같은 selector 가 여러 어댑터에서 등장하는 경우 — chain_id + target 으로 구분:

| Selector | 등장 어댑터 |
|---|---|
| `0x38ed1739` | uniswap-v2 (chain 1) / pancakeswap-amm (chain 56) |
| `0xc04b8d59` | uniswap-v3 (chain 1) / pancakeswap-v3 (chain 56) / aerodrome-slipstream (chain 8453) |
| `0xf28c0498` | uniswap-v3 (chain 1) / pancakeswap-v3 (chain 56) / aerodrome-slipstream (chain 8453) |
| `0x414bf389` | uniswap-v3 (chain 1) / pancakeswap-v3 (chain 56) — Slipstream 은 다른 selector (`0xa026383e`) |
| `0xdb3e2198` | uniswap-v3 / pancakeswap-v3 — Slipstream 은 `0xc714e838` |
| `0xac9650d8` / `0x5ae401dc` | uniswap-v3 / pancakeswap-v3 multicall |
| `0x5b41b908` | pancakeswap-stableswap (풀 2개 모두) |

EVM 의 selector 는 4-byte 라 충돌이 흔하므로 항상 `(chainId, target)` 과 함께 봐야 한다.

---

## 7. 신규 entry 추가 절차

1. 어댑터 코드 (`crates/adapters/<name>/src/...`) 의 `pub const SELECTOR` 또는 `selector_pin` 테스트로부터 hex 추출.
2. `crates/adapters/<name>/src/common.rs` 의 라우터/풀 주소 상수 확인 (lowercase 정규화 필수).
3. `dispatch.json.transactionEntries` 또는 `signatureEntries` 에 한 행 추가.
4. `feePolicy` 코드는 §3 의 9개 중 하나 (없으면 새 코드 정의 후 본 문서 업데이트).
5. 해당 어댑터의 `protocols/<name>.md` 노트 갱신.
6. 검증: `npm run validate:examples` 가 그대로 통과해야 함 (스키마 영향 없음).

자세한 신규 어댑터 추가 절차는 [`adding-a-new-protocol.md`](adding-a-new-protocol.md).
