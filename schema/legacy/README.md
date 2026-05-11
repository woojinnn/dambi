# schema/ — EVM 트랜잭션 정규화 JSON Schema

본 디렉터리는 **EVM 지갑 트랜잭션을 사용자 의미 단위로 정규화한 결과** 의 형식을 정의하는 JSON Schema 묶음입니다. 함수 셀렉터로 식별된 호출 (`function_name`, named args) 을 입력으로 받아, 정책 평가가 가능한 정형 데이터 (swap, liquidity, approval, permit 등) 로 풀어낸 결과의 wire 형식을 명세합니다.

이 형식이 **이 프로젝트의 진리의 원천** 입니다. TypeScript / Rust 타입은 본 JSON Schema 들로부터 자동 생성되며, 손으로 작성하지 않습니다.

---

## 무엇을 표현하는가

지갑이 받은 `eth_sendTransaction` 한 건은 의미적으로 여러 작업이 묶인 묶음일 수 있습니다 (예: Universal Router 의 `execute(...)` 한 호출 = wrap + swap + unwrap 세 의미). 본 스키마는 그런 한 건을 다음 컨테이너로 표현합니다.

```
NormalizedRequest
 ├─ request         ← 지갑이 받은 원본 (chainId / from / to / value / data)
 ├─ targets[]       ← 등장하는 모든 컨트랙트 (라우터 / 풀 / 토큰 / 매니저 …)
 ├─ decodedCalls[]  ← ABI 디코드 결과 (function_name + signature + args)
 ├─ actions[]       ★ 사용자 의미 단위 — N 개의 leaf (swap, wrap, approval, …)
 ├─ extensions[]    ← 프로토콜 특화 raw 정보 (V3 packed path, V4 hookData 등)
 ├─ confidence      ← 단계별 신뢰도
 └─ raw             ← 원본 보존 (재현 가능성)
```

핵심은 `actions[]` 가 **N:M (1 트랜잭션 → 여러 의미)** 라는 점입니다. 정책은 보통 이 `actions[]` 위에서 평가됩니다.

---

## 파일 구성

```
schema/
├── normalized-request.json   ← 최상위 컨테이너 (위 그림)
├── envelope.json             ← RequestEnvelope, ContractTarget, DecodedCall, RawRequestData
├── action.json               ← NormalizedAction (category / type / fields)
├── action-fields/            ← type 별 fields shape (discriminated by `_kind`)
│   ├── swap.json               swap, batch_swap, hooked_operation
│   ├── liquidity.json          add/remove, mint/burn position, increase/decrease, join/exit pool
│   ├── wrap.json               wrap, unwrap (native ↔ wrapped)
│   ├── approval.json           ERC20/721/1155, permit2 approval
│   ├── permit.json             EIP-2612, Permit2, ERC721Permit
│   ├── transfer.json           ERC20/721/1155 송금
│   └── router-plan.json        router_plan, unknown (컨테이너 자리)
├── extension.json            ← Extension (프로토콜 특화 raw)
├── extensions/               ← extension namespace 별 data shape
│   ├── uniswap-v2.json
│   ├── uniswap-v3.json         packed path, sqrtPriceLimitX96 등
│   ├── uniswap-v4.json         poolKey, hookData, hookFlags
│   ├── universal-router.json   command sequence
│   ├── balancer-vault.json     poolId, swapKind, userData
│   ├── pancake-smart-router.json
│   ├── pancake-infinity.json
│   ├── pancake-stable-swap.json
│   └── pancake-universal-router.json
├── _common.json              ← Address / Hex / DecimalString / AssetRef /
│                                AmountConstraint / UsdValuation / ConfidenceLevel
├── dispatch.schema.json      ← dispatch-table.json 의 *형식* 정의
└── dispatch-table.json       ← (실제 데이터) selector / UR opcode → action 매핑
```

`$id` 는 모두 file-path 스타일 (`schema_v260510a/_common.json` 등) 이며, `$ref` 는 상대 경로로 서로를 참조합니다.

---

## 핵심 타입을 짧게 소개

### `NormalizedAction` — 사용자 의미 단위 한 개

```jsonc
{
  "id": "a#0",                                  // 컨테이너 안에서 유일
  "category": "swap",                           // 11 종 (swap, liquidity, lending, …)
  "type":     "swap",                           // 40+ 종 (세부 의미)
  "parentActionId":  "a#root",                  // UR / multicall 등 계층 구조
  "childActionIds":  ["a#1", "a#2"],
  "primaryTargetId":  "t#0",                    // targets[] 의 어느 컨트랙트가 주체인지
  "derivedFromCallIds": ["c#0"],                // decodedCalls[] 의 어느 호출에서 도출
  "fields":   { "_kind": "swap", "mode": "exact_in", … },  // action-fields/swap.json
  "confidence": "high"
}
```

`fields` 는 `_kind` 로 구분되는 discriminated union 입니다. `_kind` 값은 항상 `type` 과 동일하게 유지됩니다.

### `AmountConstraint` — 숫자가 아니라 의미를 보존

같은 `1000000` 이라도 "정확히 이 양" 인지 "최소 이만큼" 인지가 정책에 중요합니다. 그래서 모든 금액은 다음 형태로:

```jsonc
{ "kind": "exact" | "min" | "max" | "unlimited" | "estimated" | "unknown",
  "value": "1000000" }
```

예: `exactInputSingle` 의 `amountIn` → `kind: "exact"`, `amountOutMinimum` → `kind: "min"`.

### `AssetRef` — Asset 1차 식별자

```jsonc
{ "kind": "native" | "erc20" | "erc721" | "erc1155" | "unknown",
  "chainId": 1,
  "address": "0x...",
  "symbol":   "USDC",         // optional. calldata 단독으로는 모를 수 있음
  "decimals": 6,              // optional. 동상
  "isNative": false }
```

`symbol` / `decimals` 가 비어 있을 수 있습니다 — calldata 만 보고는 ERC-20 메타를 알 수 없기 때문입니다. 호스트 (지갑 / 서버) 가 토큰 레지스트리로 보강해야 합니다.

### `dispatch-table.json` — 분류 데이터

`(chainId, address, selector)` 또는 `(UR command opcode, protocol)` 로 어떤 함수인지 식별하는 lookup 표입니다. **코드가 아니라 데이터** 이므로 새 함수를 지원하려면 이 JSON 에 entry 한 행을 추가합니다.

```jsonc
{
  "key":   { "kind": "selector", "protocol": "uniswap.v3", "selector": "0x414bf389" },
  "entry": {
    "category": "swap",
    "type":     "swap",
    "confidence": "high",
    "promote":  true,                                       // false 면 컨테이너로만 사용
    "decodeFields": "uniswap.v3.exactInputSingle",          // 디코더 식별 키
    "notes": "V3 SwapRouter (deadline 포함)"
  }
}
```

---

## 공통 컨벤션

본 스키마의 모든 JSON 파일이 공유하는 규칙입니다. 새 파일을 추가하거나 인스턴스를 만들 때 다음을 따라야 합니다.

### 1. `_common.json` 의 원자 타입

모든 다른 파일은 다음 7 종을 **`_common.json#/$defs/...` 로 `$ref` 만** 합니다. 같은 타입을 다른 파일에 다시 정의하지 않습니다.

| 타입 | 형식 | 용도 |
| --- | --- | --- |
| `Address` | `string`, `^0x[0-9a-fA-F]{40}$` | EVM 주소 (lowercase 권장) |
| `Hex` | `string`, `^0x[0-9a-fA-F]*$` | 가변 길이 raw bytes (calldata, packed path 등) |
| `DecimalString` | `string`, `^[0-9]+$` | uint256 양수 (10진 표기). JSON number 범위 초과 회피 |
| `IntDecimalString` | `string`, `^-?[0-9]+$` | int256. V4 `liquidityDelta`, `amountSpecified` 등 음수 가능 |
| `ConfidenceLevel` | enum (`high`, `medium`, `low`, `unknown`, `unavailable`) | 단계별 신뢰도 |
| `AssetRef` | object | 자산 식별 (kind / chainId / address / symbol / decimals / isNative) |
| `AmountConstraint` | object | 의미를 가진 금액 (kind: exact/min/max/unlimited/estimated/unknown + value) |
| `UsdValuation` | object | USD 환산값 (value / asOfTs / sources / staleSec) |

**큰 정수는 항상 decimal string** 입니다. wire 위에서는 `bigint` 또는 hex 가 아닌 10 진 문자열로 직렬화됩니다 (부동소수점 손실 / bigint JSON 직렬화 문제 회피).

### 2. `$id` / `$ref` 패턴

- `$id` 는 파일 경로 스타일: `schema_v260510a/_common.json`, `schema_v260510a/action-fields/swap.json`. (디렉터리명의 버전 prefix 는 의도된 namespace.)
- `$ref` 는 상대 경로 + JSON Pointer:
  - 같은 파일 내부: `"#/$defs/Address"`
  - 같은 디렉터리 다른 파일: `"_common.json#/$defs/Address"`
  - 상위 디렉터리: `"../_common.json#/$defs/AssetRef"`
- entry 는 `normalized-request.json` — 검증 도구가 여기서부터 `$ref` 를 따라 dereference 합니다.

### 3. ID 명명 패턴

NormalizedRequest 안의 식별자는 다음 prefix 컨벤션을 따릅니다.

| Prefix | 대상 | 예 |
| --- | --- | --- |
| `t#N` | `targets[]` 의 컨트랙트 | `t#0`, `t#1` |
| `c#N` | `decodedCalls[]` 의 호출 | `c#0`, `c#1` |
| `a#N` | `actions[]` 의 leaf | `a#0`, `a#1` |
| `h#N` | swap route 의 hop (`SwapHop.id`) | `h#0`, `h#1` |

한 컨테이너 안에서 유일하면 충분합니다 (GUID 불필요). 참조는 string ID 로 합니다 (예: `primaryTargetId: "t#0"`, `parentActionId: "a#root"`).

### 4. `confidence` 부착 위치

`ConfidenceLevel` 5 종은 다음 자리에 **필수** 로 붙습니다 (인스턴스 검증 시 missing 이면 fail).

- `ContractTarget.confidence` — 이 컨트랙트의 라벨/ABI 신뢰도
- `DecodedCall.confidence` — ABI 디코드 자체의 신뢰도
- `NormalizedAction.confidence` — 의미 매핑의 신뢰도
- `SwapHop.confidence` — route hop 단위
- `Extension.confidence` — 프로토콜 raw 의 해석 신뢰도

추가로 `NormalizedRequest.confidence` 컨테이너는 **단계별 신뢰도** 를 따로 들고 있습니다 (`request`, `targetIdentification`, `abiDecode`, `protocolDecode`, `semanticAction`, `routeDecode`, `amountInterpretation`, `overall`).

값 의미:

| 값 | 뜻 |
| --- | --- |
| `high` | 검증된 ABI + 정상 디코드 + 매핑 룰 적용 |
| `medium` | 일부 추론 (heuristic, 추정 보강) |
| `low` | 약한 매치, partial fill |
| `unknown` | 의미를 판단 못 함 |
| `unavailable` | 해당 단계가 실행되지 않음 |

### 5. `_kind` discriminator

`action.json` 의 `ActionFields` 는 7 종 shape 의 `oneOf` 입니다. 검증기가 어느 shape 인지 분기하기 위해 모든 shape 가 `_kind` 라는 **const 필드** 를 가지며, AJV 의 `discriminator: true` 가 이걸 봅니다.

| `NormalizedAction.type` | `fields._kind` (반드시 동일) | 정의 파일 |
| --- | --- | --- |
| `swap`, `batch_swap`, `hooked_operation` | 동일 enum 값 | `action-fields/swap.json` |
| `add_liquidity`, `remove_liquidity`, `mint_position`, `increase_liquidity`, `decrease_liquidity`, `burn_position`, `join_pool`, `exit_pool` | 동일 enum 값 | `action-fields/liquidity.json` |
| `wrap`, `unwrap` | 동일 enum 값 | `action-fields/wrap.json` |
| `approval` | `"approval"` (const) | `action-fields/approval.json` |
| `permit` | `"permit"` (const) | `action-fields/permit.json` |
| `transfer` | `"transfer"` (const) | `action-fields/transfer.json` |
| `router_plan`, `unknown` | `"router_plan"` (const) | `action-fields/router-plan.json` |

→ **invariant**: 인스턴스 생성 시 `action.type` 과 `action.fields._kind` 는 항상 같은 값이어야 합니다.

### 6. 메타 annotation — `x-source` / `x-version` / `x-adapter-mapping`

JSON Schema 표준이 아닌 본 프로젝트의 메타 키워드입니다. 검증에는 영향을 주지 않지만 도구/생성기/문서가 의미적으로 사용합니다 (AJV 는 strict 모드 보존을 위해 `addKeyword()` 로 등록).

#### 6.1 `x-source` — 누가 채우는 값인가 (모든 속성에 필수)

본 스키마는 정보의 출처를 세 갈래로 라벨링합니다. 어떤 필드가 calldata 만 으로 채워지는지, 호스트 enrichment 가 필요한지가 한눈에 보이도록 하기 위함입니다.

| 값 | 뜻 | 예시 필드 |
| --- | --- | --- |
| `action-derived` | calldata 에서 직접 도출. 디코더가 채움. | `tokenIn`, `amountIn`, `recipient`, `mode`, `protocolId` |
| `adapter:metadata` | 라우터/매니저의 구조 정보 (경로, 슬리피지, settlement kind 등) | `route`, `slippage`, `settlement`, `hookFlags` |
| `host:oracle` | 호스트의 가격 oracle 이 채우는 슬롯 | `inputUsd`, `outputUsd`, `expectedOutputUsd` |

(추가로 `host:onchain`, `host:portfolio`, `host:approvals`, `host:metadata` 등 다른 host:* 라벨이 향후 등장 가능 — 모두 "호스트 책임" 을 의미.)

현재 분포: `action-derived` 57개, `adapter:metadata` 62개, `host:oracle` 5개.

#### 6.2 `x-version` — 어떤 프로토콜 버전에서 의미 있는가

특정 버전에만 의미 있는 필드에 부착합니다.

```jsonc
"feeTier":   { "type": "integer", "x-version": ["V3", "V4"] }
"hookFlags": { "type": "array", "x-version": ["V4"] }
"userData":  { "$ref": "...Hex", "x-version": ["balancer.v2"] }
```

값은 문자열 배열. V2 router 에서는 `feeTier` 가 의미 없으므로 인스턴스에서 omit. UI / 정책이 어느 버전의 인스턴스인지 분기할 때 힌트로 사용.

#### 6.3 `x-adapter-mapping` — 디코더가 어느 raw 인자에서 채우는가

같은 의미 필드 (예: `tokenIn`) 가 프로토콜 버전마다 다른 calldata 위치에서 옵니다. 그 매핑을 메모로 남겨 둡니다.

```jsonc
"tokenIn": {
  "$ref": "../_common.json#/$defs/AssetRef",
  "x-source": "action-derived",
  "x-adapter-mapping": {
    "v2": "path[0]",
    "v3": "params.tokenIn or path[0]",
    "v4": "PoolKey.currency_in (zeroForOne 분기)"
  }
}
```

현재 `swap.json` 의 `tokenIn` / `tokenOut` / `amountIn` / `amountOut` 4 곳에만 부착. 다른 필드는 보통 한 군데에서만 오므로 불필요. 새 디코더 작성자가 의도를 추적할 때 참조.

### 7. `additionalProperties` 정책

| 위치 | 값 | 의도 |
| --- | --- | --- |
| `dispatch.schema.json` 의 entry 들 | `false` | 엄격 — 미지 키 거부 |
| `action-fields/router-plan.json` 등 컨테이너 free-form 슬롯 | `true` 또는 명시 안 함 | UR `commands`, 미지 페이로드 보존 |
| 그 외 모든 곳 | 명시 안 함 (= JSON Schema 기본값 `true`) | 향후 확장 여지 |

엄격 검증이 필요한 곳에만 명시적으로 `false` 를 박습니다.

### 8. enum 사용 컨벤션

다음 위치들은 닫힌 enum 으로 강제합니다 (새 값이 필요하면 schema 수정 + 마이그레이션).

| Enum | 위치 | 비고 |
| --- | --- | --- |
| `ConfidenceLevel` | 모든 confidence 자리 | 5 값 |
| `ActionCategory` | `action.json` | 11 값 (`swap`, `liquidity`, `lending`, `liquid_staking`, `restaking`, `rwa`, `bridge`, `perp`, `utility`, `aggregation`, `unknown`) |
| `ActionType` | `action.json` | 40+ 값 |
| `_kind` | 각 fields shape | type 과 동일 |
| `AssetRef.kind` | `_common.json` | `native`, `erc20`, `erc721`, `erc1155`, `unknown` |
| `AmountConstraint.kind` | `_common.json` | `exact`, `min`, `max`, `unlimited`, `estimated`, `unknown` |
| `TargetRole` | `envelope.json` | `entrypoint`, `router`, `aggregator`, `pool`, `vault`, `manager`, `token`, `permit`, `hook`, `account`, `unknown` |
| `CallType`, `CallDecodeSource`, `TargetDiscoverySource`, `slippage.source`, `settlement.kind` 등 | 각 파일 | 모두 닫힌 enum |
| `dot notation protocolId` | 각 fields | `uniswap.v2`, `pancakeswap.v3`, `balancer.v2` 등 |

dot notation 은 fork 분기를 위함입니다 (Uniswap V2 와 PancakeSwap V2 는 ABI 동일하지만 protocol 다름 → 다른 protocolId).

---

## 사용법

### 1. 인스턴스 검증

```bash
# AJV 또는 다른 JSON Schema Draft 2020-12 validator 사용.
# 22 개 schema 가 $ref 로 얽혀 있으므로 entry 는 normalized-request.json.
ajv validate -s normalized-request.json -d your-instance.json
```

### 2. 언어 바인딩 생성

JSON Schema 가 진리이고 TypeScript / Rust 타입은 codegen 됩니다.

- TS: `json-schema-to-typescript` (entry 는 dereferenced 단일 파일)
- Rust: `typify` (선택. 본 워크스페이스의 `policy-engine` crate 와 wire 호환되는 타입을 얻을 때)

생성된 코드는 손편집하지 않습니다. 형식이 바뀌면 본 JSON 부터 수정 후 재생성합니다.

### 3. 호스트가 채워야 할 정보

본 스키마는 calldata 만으로 알 수 있는 정보를 표현합니다. 다음 항목은 **호스트 책임** 입니다.

- `AssetRef.symbol` / `decimals` (토큰 레지스트리)
- `*.inputUsd` / `outputUsd` / `expectedOutputUsd` (가격 oracle)
- `targets[].protocol` 의 정확한 도트 표기 (예: `uniswap.v2` vs `pancakeswap.v2` — 같은 셀렉터의 fork 분기)
- `request.from` 의 portfolio / approvals snapshot (정책이 필요로 할 때)

---

## 자주 묻는 질문

**Q. 왜 `actions[]` 가 N 개인가요? UR 한 건이면 한 개 아닌가요?**
A. Universal Router `execute(...)` 한 호출은 보통 wrap → swap → unwrap 처럼 여러 의미를 담습니다. 각각을 별도 leaf 로 보존해야 leaf 단위 정책을 쓸 수 있습니다. 정책 평가 단위로 한 개의 통합 객체가 필요하면 별도 aggregator 단계에서 합칠 수 있습니다 (스키마 자체는 풍부한 형태를 유지).

**Q. 같은 selector 가 여러 프로토콜에 있는데 어떻게 구분하나요?**
A. `dispatch-table.json` 의 key 에 `protocol` 필드가 함께 있습니다 (예: Uniswap V2 와 PancakeSwap V2 는 셀렉터가 같지만 protocol 이 다름). 호스트가 `(chainId, address)` → protocol 매핑을 들고 있어야 합니다.

**Q. 새 함수 / 새 프로토콜을 지원하려면 어디를 건드리나요?**
1. `dispatch-table.json` 에 entry 한 행 추가 (key + decodeFields 식별자)
2. 필요하면 `action-fields/` 또는 `extensions/` 에 새 shape 추가
3. JSON Schema 가 self-validate 통과하는지 확인
4. 디코더 코드 (별도 디렉터리) 가 `decodeFields` 식별자를 처리하도록 추가

**Q. `decodedCalls[]` 와 `actions[]` 의 차이는?**
A. `decodedCalls[]` 는 **기술적 호출** (어떤 셀렉터의 어떤 함수가 어떤 인자로 불렸는가). `actions[]` 는 **사용자 의미** (이게 swap 인가, approval 인가, wrap 인가). 한 decodedCall 이 여러 action 으로 펼쳐지거나 (UR `execute`), 여러 decodedCall 이 한 action 으로 모일 수도 있습니다.

---

## 셀렉터 출처

각 프로토콜의 함수 셀렉터는 공식 컨트랙트 소스의 시그니처에서 keccak256 으로 직접 재계산되었습니다. 외부 셀렉터 DB (4byte 등) 는 신뢰 출처로 사용하지 않습니다.
