# scopeball 정책 엔진 — JSON 스키마

scopeball 워크스페이스의 `crates/policy-engine/src/core.rs::Action` 5종(`Dex`/`Other`/`Permit2`/`Eip2612`/`Eip712Other`) 출력 형태를 **JSON Schema 2020-12** 로 표현하고, 그 위에 dispatch / registries / examples / docs 의 부속 자료를 함께 둔 패키지.

본 자료는 Rust 어댑터의 `serde_json` 직렬화 결과와 1:1 일치하도록 설계되어, Rust 외 클라이언트(JS/TS 지갑 UI, Go 백엔드 등)가 동일 의미 모델을 읽고 해석할 수 있게 한다. Cedar 정책 엔진의 동작과는 별개의 사양이며, 기존 `policy-schema/*.cedarschema` 파일은 변경하지 않는다.

---

## 디렉터리 구조

```
policy-schema/json/
├── README.md                                      ← 본 파일 (진입점)
├── package.json                                   ← ajv-cli 검증용
│
├── core.schema.json                               ← Address / Hex / ChainId / Token / UsdValuation / WindowStatsContext / OracleRequirement / DexTrace / AmountSpec primitives
├── dex-facts.schema.json                          ← DexFacts 11필드
├── action.schema.json                             ← Action union (oneOf 5)
├── actions/
│   ├── dex.schema.json
│   ├── other.schema.json
│   ├── permit2.schema.json
│   ├── eip2612.schema.json
│   └── eip712-other.schema.json
│
├── dispatch.json                                  ← (chain, target, selector) → adapter / (verifying_contract, primary_type) → adapter
├── registries.json                                ← chain × 라우터/풀/토큰 주소 정적 테이블
│
├── examples/                                      ← 11개 그룹별 인스턴스 (ajv 검증 통과)
│   ├── group-a-constant-product/                    (V2-shape: uniswap-v2 / pancakeswap-amm / aerodrome-v1)
│   ├── group-b-concentrated-liquidity/              (V3-shape: uniswap-v3 / pancakeswap-v3 / aerodrome-slipstream)
│   ├── group-c-stableswap/                          (Curve-shape: pancakeswap-stableswap)
│   ├── group-d-meta-router/                         (universal-router)
│   └── group-e-signature/                           (permit2 / eip2612)
│
└── docs/                                          ← 한국어 산문 리퍼런스
    ├── README.md
    ├── baseline.md                                ← 핵심 모델 (Action 5종 + DexFacts 11필드)
    ├── field-reference.md                         ← 필드별 의미 / 채우는 측 / 정책 활용
    ├── function-inventory.md                      ← selector × protocol × function 통합 표
    ├── dispatch-table.md                          ← dispatch.json 산문 설명
    ├── registry.md                                ← registries.json 산문 설명
    ├── adding-a-new-protocol.md                   ← 신규 어댑터 추가 시 갱신할 항목
    └── protocols/                                 ← 어댑터별 노트 (10개)
        ├── uniswap-v2.md / uniswap-v3.md / universal-router.md
        ├── pancakeswap-amm.md / pancakeswap-v3.md / pancakeswap-stableswap.md
        ├── aerodrome-v1.md / aerodrome-slipstream.md
        └── permit2.md / eip2612.md
```

---

## 빠른 사용법

### JSON Schema 로 Action 인스턴스 검증

```bash
cd policy-schema/json
npx --yes -p ajv-cli@5.0.0 ajv validate \
  --spec=draft2020 \
  -s action.schema.json \
  -r 'core.schema.json' \
  -r 'dex-facts.schema.json' \
  -r 'actions/dex.schema.json' \
  -r 'actions/other.schema.json' \
  -r 'actions/permit2.schema.json' \
  -r 'actions/eip2612.schema.json' \
  -r 'actions/eip712-other.schema.json' \
  -d 'examples/**/*.json'
```

### dispatch lookup (의사 코드)

```ts
import dispatch from "./dispatch.json";

// 1. 트랜잭션의 (chainId, to, selector) 로 어댑터 식별
const entry = dispatch.transactionEntries.find(
  e => e.chainId === tx.chainId
    && e.target.toLowerCase() === tx.to.toLowerCase()
    && e.selector === tx.selector
);
// entry === { protocolId: "uniswap-v2", adapterId: "...", functionName: "swapExactTokensForTokens", actionKind: "dex", group: "constant-product", feePolicy: "constant_30_bps" }

// 2. 매칭 실패 → fallback 으로 OtherAction
if (!entry) emitOther(tx);
```

### registries 조회

```ts
import registries from "./registries.json";

// chain 56 의 PancakeSwap V2 router 주소
const router = registries.routers.find(
  r => r.chainId === 56 && r.protocolId === "pancakeswap-amm"
)?.address;
```

---

## 5분 요약

1. **JSON Schema 9개**가 Action 의 가능한 모든 형태를 폐쇄적으로 (additionalProperties: false) 정의한다. `oneOf` 5 변형 + 각 variant 의 모든 필드.
2. **dispatch.json** 은 selector / EIP-712 primary type 으로 어댑터를 lookup 하기 위한 분류기 데이터. 35 transaction entry + 7 signature entry = 42 dispatch rows.
3. **registries.json** 은 chain 별 라우터/풀/verifying contract/토큰 주소 정적 카탈로그. Rust 의 `crates/adapters/<name>/src/common.rs` 상수에서 1:1 추출.
4. **examples/** 12개는 ajv 로 검증된 표본 인스턴스. 각 그룹의 핵심 시나리오 + host enrichment 후 케이스 1개. 자세한 카탈로그는 [`examples/README.md`](examples/README.md).
5. **docs/** 18개는 한국어 산문 리퍼런스. baseline / field-reference / function-inventory / dispatch-table / registry / adding-a-new-protocol + protocols/<name>.md × 10.

---

## 자료 정합성 보장

- `core.schema.json` 의 Address 패턴 (`^0x[0-9a-f]{40}$`) 은 lowercase 만 허용. Rust `Address::new()` 가 lowercase 정규화하는 것과 일치.
- `DecimalString4` 패턴은 Cedar Decimal 의 4-소수점 정밀도를 반영.
- `dispatch.json` 의 모든 selector 값은 `cast sig` 또는 어댑터의 `selector_pin` unit test 가 인정한 값과 일치.
- `registries.json` 의 모든 주소는 어댑터 `common.rs` 의 `pub const` 상수와 lowercase 일치 (수동 cross-check, `docs/registry.md` 참조).
- 11 examples 가 `action.schema.json` 검증을 통과 (`npm run validate:examples`).

---

## 변경 정책

- **이 디렉터리는 데이터 + 사양 디렉터리.** Rust 코드를 컴파일타임 의존시키지 않으므로 자료 갱신만으로 변경 가능.
- 기존 `policy-schema/*.cedarschema` 파일은 절대 변경하지 않음 (Rust `crates/policy-engine/src/schema.rs` 가 `include_str!` 로 컴파일타임 의존).
- 신규 어댑터 추가 시 절차는 [`docs/adding-a-new-protocol.md`](docs/adding-a-new-protocol.md) 참조.
