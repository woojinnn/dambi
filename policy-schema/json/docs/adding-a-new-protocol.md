# 새 어댑터 추가 시 본 JSON 자료에 반영할 항목

scopeball Rust 워크스페이스에 새 어댑터(`crates/adapters/<name>/`)를 추가했다면, 본 JSON 자료 묶음에도 다음 항목을 갱신해야 한다. **본 절차는 Rust 코드 변경 절차의 후속 단계이며, Rust 어댑터 작성 절차 자체는 별도 문서 (예: `docs/specs/2026-05-08-dex-adapter-extension.md`) 참조.**

---

## 0. 사전 체크리스트

- [ ] 새 어댑터 crate (`crates/adapters/<name>/`) 가 빌드/테스트 통과
- [ ] `selector_pin` 단위 테스트가 통과 (selector hex 가 코드와 일치)
- [ ] `crates/adapters-bundle/src/lib.rs::default_registry()` 에 등록됨

---

## 1. 그룹 결정

5개 그룹 중 하나로 분류 (자세한 분류 기준은 [`dispatch-table.md`](dispatch-table.md) §2):

- `constant-product` — V2 path/Route 기반 6-함수
- `concentrated-liquidity` — V3 params struct + packed path + multicall
- `stableswap` — Curve-style `exchange(i,j,dx,min_dy)`
- `meta-router` — N 프로토콜 commands 디스패처
- `signature` — EIP-712 서명 (primary type 으로 매칭)

기존 그룹에 안 맞으면:
- 새 그룹을 만든다 (`dispatch.json.groups` 에 추가).
- `dispatch-table.md` §2 표 갱신.

---

## 2. selector 추출

- DEX 어댑터: 어댑터의 모든 `pub const SELECTOR` 또는 `SELECTOR_*` 상수 hex 값 추출.
- 서명 어댑터: 매칭하는 EIP-712 primary type 문자열 (e.g., "PermitSingle").

확인 방법:
```bash
# 어댑터의 selector_pin 테스트가 인정한 hex
grep "assert_eq!(SELECTOR" crates/adapters/<name>/src/*.rs

# 또는 cast sig 로 직접 계산
cast sig "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
```

---

## 3. fee policy 결정

`max_fee_bps` 의 출처에 따라 §3 [`dispatch-table.md`](dispatch-table.md) 의 9개 fee policy 코드 중 하나 선택:

- `constant_<N>_bps` — 어댑터 코드에 상수 fee 가 박힌 경우
- `calldata_fee_div_100` — params struct 에 `uint24 fee` 가 있고 `fee/100` bps 매핑
- `calldata_packed_path_max_fee` — packed bytes path 에 fee 가 인코딩
- `estimate_stable_<S>_volatile_<V>` — Solidly 풍의 stable 플래그 기반 추정
- `none_tickspacing_only` — fee 산출 불가 → `null`
- `merged_max_across_children` / `merged_max_across_subprotocols` — multicall 또는 메타 라우터의 합산

기존 코드에 안 맞으면 새 코드 정의 후 [`dispatch-table.md`](dispatch-table.md) 갱신.

---

## 4. dispatch.json 갱신

`dispatch.json.transactionEntries` (또는 `signatureEntries`) 배열에 함수당 한 행씩 추가:

```json
{
  "chainId": <u64>,
  "target": "<lowercase 0x address>",
  "selector": "<0xXXXXXXXX>",
  "protocolId": "<protocol-id>",
  "adapterId": "<protocol-id>/<function>@<version>",
  "functionName": "<solidity-function-name>",
  "actionKind": "dex" | "permit2" | "eip2612",
  "group": "<group-key>",
  "feePolicy": "<fee-policy-code>",
  "notes": "<선택>"
}
```

- `target` 은 lowercase 정규화 (registries.json 과 일치).
- `selector` 은 0x 접두 8 hex char.
- `adapterId` 는 어댑터의 `static_adapter_id()` 인자와 일치 (Rust 와 같은 문자열).

---

## 5. registries.json 갱신

새 라우터 또는 풀 주소가 등장하면:

```json
// registries.json.routers 또는 .pools 에 추가
{
  "protocolId": "<protocol-id>",
  "chainId": <u64>,
  "address": "<lowercase 0x address>",
  "kind": "router" | "stableswap-pool" | "permit2",
  "label": "<human readable label>",
  "source": "crates/adapters/<name>/src/common.rs::<CONST_NAME>",
  "notes": "<선택>"
}
```

새 chain 이 등장하면:
1. `chains` 배열에 `{ chainId, name, nativeSymbol }` 추가.
2. `tokens` 배열에 native sentinel (`0xeeee...eeee`, `isNative: true`) + 주요 ERC-20 추가.
3. 어댑터 `TokenLookup::with_<chain>_defaults()` 와 1:1 일치하도록 토큰 행 추가.

---

## 6. examples/ 인스턴스 추가

새 그룹이면 `examples/<group>/` 디렉터리 생성. 그룹 안에 어댑터 대표 케이스 1개 이상 JSON 파일로 추가.

각 인스턴스 파일은 `action.schema.json` 검증을 통과해야 한다. 작성 후:

```bash
cd policy-schema/json
npx --yes -p ajv-cli@5.0.0 ajv validate \
  --spec=draft2020 \
  -s action.schema.json \
  -r 'core.schema.json' -r 'dex-facts.schema.json' \
  -r 'actions/dex.schema.json' -r 'actions/other.schema.json' \
  -r 'actions/permit2.schema.json' -r 'actions/eip2612.schema.json' \
  -r 'actions/eip712-other.schema.json' \
  -d 'examples/**/*.json'
```

모든 파일이 `valid` 출력해야 함.

---

## 7. docs/protocols/<name>.md 추가

기존 `protocols/uniswap-v2.md` 등을 템플릿으로 복사하여 다음 섹션을 채운다:

1. **개요** — 그룹 분류, chain, 라우터 주소, 출처 GitHub repo + commit
2. **selector 표** — 함수당 selector + Solidity signature
3. **DexFacts 매핑** — 각 calldata 필드가 DexFacts 의 어떤 필드로 들어가는지
4. **특이사항** — fee 출처 / 변형 패턴 / 알려진 위험
5. **어댑터 코드 위치** — `crates/adapters/<name>/src/...`

---

## 8. docs/function-inventory.md 갱신

§1~5 표에 새 어댑터 행 추가. 그룹 카운트 업데이트 (§6).

---

## 9. 정합성 검증

```bash
# Rust 빌드/테스트
cargo build --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# JSON 스키마 검증
cd policy-schema/json
npx --yes -p ajv-cli@5.0.0 ajv compile --spec=draft2020 -s action.schema.json [...]
npx --yes -p ajv-cli@5.0.0 ajv validate --spec=draft2020 -s action.schema.json [...] -d 'examples/**/*.json'

# selector cross-check (수동)
# dispatch.json 의 selector 들이 cast sig 로 다시 계산했을 때 일치하는지 샘플 확인
cast sig "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
# → 0x38ed1739 가 dispatch.json 과 일치하는지

# address cross-check (수동)
grep -i "<router_address>" crates/adapters/<name>/src/common.rs
```

---

## 10. 흔한 함정

| 함정 | 회피 |
|---|---|
| selector 가 V2 와 동일해 보여 selector 계산 안 함 | Solidity signature 의 모든 인자 (struct/배열 포함) 가 byte-identical 인지 확인 — 한 글자 다르면 selector 다름 |
| address 가 mixed-case 인데 lowercase 정규화 안 함 | dispatch.json / registries.json 의 모든 address 는 lowercase. Rust `Address::new()` 도 lowercase 정규화 |
| Token decimals 를 다른 chain 의 동명 토큰으로 가정 | BSC USDT 는 18 decimals 임 (mainnet 6 와 다름). chain × symbol 마다 토큰 별도 등록 |
| native asset symbol 을 ETH 로 통일 | BSC 의 native 는 BNB. native sentinel address 는 같은 `0xeeee...eeee` 지만 symbol 만 다름 |
| examples 인스턴스가 schema 에 없는 필드 누락 | DexFacts 11필드 모두 required. host enrichment 채울 필드는 `null` 로 explicit 채움 |
