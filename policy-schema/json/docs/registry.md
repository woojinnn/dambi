# Registry — `registries.json` 산문 리퍼런스

`registries.json` 은 chain × (라우터/풀/verifying contract/토큰) 정적 카탈로그. Rust `crates/adapters/<name>/src/common.rs` 의 상수와 `TokenLookup::with_*_defaults()` 정의에서 1:1 추출.

---

## 1. chains 카탈로그

| chainId | 이름 | nativeSymbol |
|---|---|---|
| 1 | Ethereum mainnet | ETH |
| 56 | BNB Smart Chain (BSC) | BNB |
| 8453 | Base | ETH |

신규 chain 추가 시:
1. `chains` 배열에 한 행 추가.
2. `tokens` 배열에 native sentinel (`0xeeee...eeee`, `isNative: true`) + 주요 ERC-20 추가.
3. 어댑터 `TokenLookup::with_<chain>_defaults()` 와 일치 검증.

---

## 2. routers 카탈로그 (7행)

| protocolId | chainId | address | source |
|---|---|---|---|
| uniswap-v2 | 1 | `0x7a25...488d` | `crates/adapters/uniswap-v2/src/common.rs::UNISWAP_V2_ROUTER_MAINNET` |
| uniswap-v3 | 1 | `0xE592...564` | `crates/adapters/uniswap-v3/src/common.rs::SWAP_ROUTER_MAINNET` |
| uniswap-universal-router | 1 | `0x66a9...8af` | `crates/adapters/universal-router/src/common.rs::UNIVERSAL_ROUTER_MAINNET` |
| pancakeswap-amm | 56 | `0x10ED...4E` | `crates/adapters/pancakeswap-amm/src/common.rs::PANCAKESWAP_V2_ROUTER_BSC` |
| pancakeswap-v3 | 56 | `0x1b81...B14` | `crates/adapters/pancakeswap-v3/src/common.rs::PANCAKESWAP_V3_SWAP_ROUTER_BSC` |
| aerodrome-v1 | 8453 | `0xcF77...E43` | `crates/adapters/aerodrome-v1/src/common.rs::AERODROME_V1_ROUTER_BASE` |
| aerodrome-slipstream | 8453 | `0xBE6D...8a5` | `crates/adapters/aerodrome-slipstream/src/common.rs::AERODROME_SLIPSTREAM_SWAP_ROUTER_BASE` |

**주소 확인 절차**: `bscscan.com` / `basescan.org` / `etherscan.io` 에서 verified contract 인지 + 마지막 트랜잭션 활성도 (production 사용 검증).

---

## 3. pools 카탈로그 (StableSwap 한정)

| protocolId | chainId | address | coins[] |
|---|---|---|---|
| pancakeswap-stableswap | 56 | `0x4f31...9818` | USDT, USDC (N=2) |
| pancakeswap-stableswap | 56 | `0x3684...aa98` | USDT, BUSD, USDC (N=3) |

`coins[]` 의 순서는 `exchange(i, j, dx, min_dy)` 의 i/j 인덱스에 직접 대응 (i=0 → coins[0]). 풀 컨트랙트의 `coins(uint256 i)` view 함수와 일치해야 한다.

**v0.1 한계**: 위 두 풀은 illustrative placeholder 이며 production 시 매니페스트 기반 capability 로 대체 필요. `crates/adapters/pancakeswap-stableswap/src/common.rs::seeded_bsc_pools` 의 rustdoc 도 같은 경고를 명시.

---

## 4. verifyingContracts 카탈로그

| protocolId | address | kind |
|---|---|---|
| permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` | permit2 |

Permit2 는 모든 chain 에서 동일 주소 (CREATE2 deterministic deployment).

EIP-2612 의 verifyingContract 는 토큰 컨트랙트 자체이므로 별도 entry 없이 `tokens` 카탈로그가 후보 화이트리스트 역할을 한다.

---

## 5. tokens 카탈로그 (15행, chain별)

### Ethereum mainnet (chainId=1, 4행)

| Symbol | Address | Decimals |
|---|---|---|
| USDT | `0xdAC1...1ec7` | 6 |
| USDC | `0xA0b8...eB48` | 6 |
| WETH | `0xC02a...6Cc2` | 18 |
| ETH (native) | `0xeeee...eeee` | 18 |

### BNB Smart Chain (chainId=56, 6행)

| Symbol | Address | Decimals |
|---|---|---|
| WBNB | `0xbb4C...095c` | 18 |
| USDT | `0x55d3...7955` | 18 (★ mainnet 6 dec 와 다름) |
| BUSD | `0xe9e7...7D56` | 18 |
| CAKE | `0x0E09...cE82` | 18 |
| USDC | `0x8ac7...580d` | 18 (StableSwap 풀 전용) |
| BNB (native) | `0xeeee...eeee` | 18 |

### Base (chainId=8453, 4행)

| Symbol | Address | Decimals |
|---|---|---|
| USDC | `0x8335...2913` | 6 |
| WETH | `0x4200...0006` | 18 |
| AERO | `0x9401...8631` | 18 |
| ETH (native) | `0xeeee...eeee` | 18 |

---

## 6. 갱신 절차

본 파일은 Rust 빌드와 분리되어 운영자가 갱신 가능. 어댑터의 `TokenLookup::with_*_defaults()` 를 변경한 경우:

1. 변경된 토큰을 `tokens` 배열에 반영 (또는 삭제).
2. 변경된 라우터 주소를 `routers` 배열에 반영.
3. `docs/protocols/<name>.md` 의 주소 표 갱신.
4. cross-check: 본 파일의 모든 address 가 어댑터 코드 상수와 lowercase 일치하는지 grep 으로 검증.

---

## 7. 정합성 검증 스크립트 (제안)

```bash
# registries.json 의 모든 router address 가 어댑터 common.rs 에 등장하는지
for addr in $(jq -r '.routers[].address' registries.json); do
  grep -qi "$addr" ../../crates/adapters/*/src/common.rs \
    || echo "MISS: $addr"
done

# pool addresses
for addr in $(jq -r '.pools[].address' registries.json); do
  grep -qi "$addr" ../../crates/adapters/pancakeswap-stableswap/src/common.rs \
    || echo "MISS: $addr"
done
```

production CI 에 본 스크립트를 추가하면 어댑터 코드와 registries 의 drift 를 빌드 타임에 잡을 수 있다.
