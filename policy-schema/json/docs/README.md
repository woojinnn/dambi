# scopeball JSON 스키마 — 문서

`policy-schema/json/` 의 사양과 자료를 산문으로 설명한 한국어 리퍼런스.

## 문서 진입 순서

1. **[`baseline.md`](baseline.md)** — 핵심 모델 (Action 5종 + DexFacts 11필드). 처음 본 사람이 가장 먼저 읽을 문서.
2. **[`field-reference.md`](field-reference.md)** — DexFacts / 각 Action variant 필드별 의미·채우는 측·정책 활용 매트릭스.
3. **[`function-inventory.md`](function-inventory.md)** — selector × protocol × function 통합 표. 어떤 selector 가 어떤 어댑터에 매칭되는지 한눈에.
4. **[`dispatch-table.md`](dispatch-table.md)** — `dispatch.json` 의 분류 규칙·그룹 분류·결정 로그를 산문으로.
5. **[`registry.md`](registry.md)** — `registries.json` 의 chain × 주소 카탈로그를 산문으로 (출처/갱신 절차 포함).
6. **[`adding-a-new-protocol.md`](adding-a-new-protocol.md)** — 신규 어댑터 추가 시 본 JSON 자료 묶음에 갱신해야 할 항목 체크리스트.

## 어댑터별 노트

`protocols/<name>.md` 10개는 각 어댑터의 그룹 분류·selector 표·DexFacts 매핑 매트릭스·출처 코드 위치를 담는다.

| 그룹 | 어댑터 | 문서 |
|---|---|---|
| Constant-product (V2-shape) | uniswap-v2 | [`protocols/uniswap-v2.md`](protocols/uniswap-v2.md) |
| Constant-product | pancakeswap-amm | [`protocols/pancakeswap-amm.md`](protocols/pancakeswap-amm.md) |
| Constant-product (Solidly variant) | aerodrome-v1 | [`protocols/aerodrome-v1.md`](protocols/aerodrome-v1.md) |
| Concentrated liquidity (V3-shape) | uniswap-v3 | [`protocols/uniswap-v3.md`](protocols/uniswap-v3.md) |
| Concentrated liquidity | pancakeswap-v3 | [`protocols/pancakeswap-v3.md`](protocols/pancakeswap-v3.md) |
| Concentrated liquidity (tickSpacing variant) | aerodrome-slipstream | [`protocols/aerodrome-slipstream.md`](protocols/aerodrome-slipstream.md) |
| StableSwap | pancakeswap-stableswap | [`protocols/pancakeswap-stableswap.md`](protocols/pancakeswap-stableswap.md) |
| Meta router | universal-router | [`protocols/universal-router.md`](protocols/universal-router.md) |
| Signature (Permit2) | permit2 | [`protocols/permit2.md`](protocols/permit2.md) |
| Signature (EIP-2612) | eip2612 | [`protocols/eip2612.md`](protocols/eip2612.md) |
