# default_policies_v2 — 구현 단계(phase)별 분리

scopeball 기본 v2 정책 번들을 **구현 단계·담당·난이도별 디렉터리**로 둔다.

## 스킴 (2026-06-05 라운드4 — Phase2 작업단위별 A/B/C 분할)

| 폴더 | 수 | 작업 단위 (담당) |
|---|---:|---|
| **phase1** | 35 | 없음 — 지금 작동 (calldata/auto-synced/구현fact, v3 디코드) |
| **phase2/A** | 22 | 프로토콜 ABI decode manifest (registry팀). 9개는 디코드 즉시 phase1 |
| **phase2/B** | 42 | in-house enrichment: state sync·live-input deriver·fact stub (우리/sync팀) |
| **phase2/C** | 57 | external 오프체인 피드: 제재·oracle·평판·메타 (IO팀) |
| **phase3** | 19 | 신규 action 표면(x402·EIP-7702)·거래행동 이력 |
| **phase-not-classified** | 7 | main pool_state/current_price lowering 보류 |

합계 **182** (구 1A/1B 통합→phase1, 구 1B 1건→phase2/B). 난이도: phase1 < 2A < 2B < 2C < phase3. registry팀 2A만 해도 9개 즉시 phase1.

> 결정론적: 디코드=registryV2 emit.body(90)+HL / method=facts grep / v3 live_inputs 0 emit / 적대검증. 디코드 진실=배포 GCS. fail-closed 게이트는 phase1만. 상세 agentBase/team/state-validation/. (phase-not-classified엔 팀 작업중 draft가 untracked로 더 있을 수 있음 — 본 표는 분류 확정분.)

## 로더 규약
임의깊이 재귀. 재분류=`git mv`(id·내용 불변). `// BLOCKED-BY-ACTION` 번들 skip.

## Phase 1 — 지금 작동 (추가작업 0) — 35개

- `aave-delegate-borrow-allowlist-deny`
- `air-claim-locks-received-warn`
- `air-delegatee-not-self-deny`
- `air-merkle-without-proof-warn`
- `air-recipient-not-self-deny`
- `ammlp-collect-recipient-not-self-deny`
- `ammlp-remove-recipient-not-self-deny`
- `bridge-recipient-not-self-deny`
- `bridge-refund-not-self-warn`
- `bridge-target-not-allowlisted-deny`
- `bridge-unlimited-approval-deny`
- `gov-delegatee-allowlist-deny`
- `hl-confirm-approve-agent`
- `hl-confirm-high-leverage`
- `hl-confirm-unknown`
- `hl-confirm-usd-send`
- `hl-confirm-withdraw`
- `hl-no-short-perp`
- `holding-pct-outflow-warn`
- `increase-allowance-cap-warn`
- `multicall-hidden-approval-warn`
- `nft-bid-weth-unlimited-warn`
- `nft-setapprovalforall-conduit-warn`
- `nft-transfer-burn-recipient-deny`
- `permit2-sign-allowance-confirm`
- `permit2-sign-allowance-far-expiry-warn`
- `reapprove-already-granted-warn`
- `send-first-time-or-burn-recipient-warn`
- `setapprovalforall-operator-warning`
- `signature-chain-mismatch-permit-warn`
- `swap-recipient-not-self-deny`
- `transfer-to-token-own-contract-deny`
- `unknown-blind-sign-warning`
- `unlimited-approval-deny`
- `values-recipient-denylist-deny`

## Phase 2A — decode (registry팀: 프로토콜별 ABI manifest 추가) — 22개

- `cftc-retail-leverage-cap-warn`
- `eu-esma-retail-perp-leverage-cap-deny`
- `jp-perp-leverage-cap-2x-deny`
- `lp-bonding-curve-premium-deny`
- `lp-claim-recipient-self-warn`
- `lp-claim-target-sale-mismatch-deny`
- `lp-commit-cumulative-cap-warn`
- `lp-commit-pay-token-mismatch-deny`
- `lp-commit-platform-allowlist-deny`
- `perp-adding-to-loser-warn`
- `perp-averaging-down-warn`
- `perp-concentration-warn`
- `perp-cross-exposure-cap-warn`
- `perp-funding-adverse-warn`
- `perp-isolated-to-cross-warn`
- `perp-leverage-cap-deny`
- `perp-leverage-increase-warn`
- `perp-liq-distance-thin-warn`
- `perp-market-slippage-warn`
- `perp-reduce-only-flip-deny`
- `perp-self-leverage-ceiling-deny`
- `perp-stop-trigger-misplaced-warn`

## Phase 2B — in-house enrichment (우리/sync팀: state sync·live-input deriver·fact stub) — 42개

- `aave-borrow-fraction-warn`
- `aave-cap-nearly-full-warn`
- `aave-emode-leverage-warn`
- `aave-frozen-paused-supply-deny`
- `aave-hf-band-volatile-warn`
- `aave-hf-floor-warn`
- `aave-utilization-high-warn`
- `aave-withdraw-hf-floor-deny`
- `air-source-contract-mismatch-warn`
- `air-unknown-token-warn`
- `alloc-bucket-overweight-warn`
- `ammlp-cancel-target-missing-warn`
- `ammlp-intent-cap-over-balance-warn`
- `ammlp-intent-duplicate-warn`
- `ammlp-uni-v3v4-out-of-range-warn`
- `approve-dormant-deprecated-contract-warn`
- `approve-first-seen-spender-warn`
- `bridge-cctp-recipient-unreceivable-deny`
- `bridge-dest-chain-unsupported-warn`
- `bridge-min-out-haircut-warn`
- `bridge-permission-change-deny`
- `bridge-relayer-fee-band-warn`
- `gov-redelegate-large-power-warn`
- `intent-dutch-decay-warn`
- `intent-validity-horizon-warn`
- `morpho-withdraw-illiquid-or-paused-warn`
- `multicall-outflow-cap-deny`
- `nft-far-expiry-order-warn`
- `nft-untrusted-blur-root-deny`
- `permit-unlimited-allowance-warn`
- `permit2-sign-allowance-phishing-trigger-fanout-warn`
- `permit2-unknown-spender-full-balance-warn`
- `portfolio-category-concentration-cap-warn`
- `portfolio-fiat-peg-exposure-cap-warn`
- `portfolio-stable-reserve-floor-warn`
- `portfolio-token-concentration-cap-warn`
- `stk-lst-concentration-warn`
- `stk-unstake-cooldown-warn`
- `swap-native-gas-starvation-warn`
- `swap-price-impact-warn`
- `swap-slippage-high-warn`
- `values-interest-bearing-exclude-warn`

## Phase 2C — external 피드 커넥터 (IO팀: 제재목록·oracle·평판·토큰메타) — 57개

- `aave-isolation-debt-ceiling-warn`
- `aave-lst-emode-divergence-warn`
- `aave-oracle-stale-borrow-warn`
- `aave-repay-swap-slippage-deny`
- `aave-siloed-borrow-warn`
- `air-recipient-is-contract-warn`
- `ammlp-intent-isolated-fill-warn`
- `approve-fresh-domain-airdrop-context-deny`
- `approve-spender-eoa-warn`
- `approve-spender-unknown-contract-warn`
- `behav-fomo-pump-chase-warn`
- `buy-hidden-mint-proxy-power-warn`
- `buy-rug-risk-lp-owner-power-warn`
- `eu-mica-nonauthorized-emt-acquire-deny`
- `eu-mica-nonauthorized-emt-acquire-warn`
- `eu-sanctions-listed-recipient-deny`
- `fefta-designated-party-payment-deny`
- `gas-cost-ratio-warn`
- `gas-cost-usd-cap-deny`
- `honeypot-buy-block-presign`
- `jp-fefta-sanctioned-recipient-deny`
- `kr-darkcoin-privacy-token-swap-warn`
- `kr-terror-financing-designated-recipient-deny`
- `large-swap-usd-warning`
- `lido-rebasing-steth-as-lp-warn`
- `lido-rebasing-steth-to-contract-warn`
- `morpho-approve-to-bundler-core-warn`
- `morpho-blue-unrecognized-market-supply-warn`
- `morpho-set-authorization-operator-warn`
- `morpho-vault-unrecognized-deposit-warn`
- `nft-low-floor-listing-warn`
- `nft-low-offer-accept-warn`
- `nft-seaport-wildcard-zone-deny`
- `nft-seaport-zero-consideration-sign-deny`
- `nft-transfer-blocklisted-recipient-deny`
- `nft-zero-price-sale-deny`
- `ofac-sanctioned-mixer-receipt-deny`
- `ofac-sdn-sanctioned-address-deny`
- `ofac-sdn-sanctioned-recipient-deny`
- `permit-allowance-horizon-warn`
- `privacy-coin-delisted-acquire-warn`
- `send-wrong-network-mismatch-deny`
- `stk-lst-depeg-sell-warn`
- `suitability-leveraged-token-buy-warn`
- `swap-exactout-maxin-vs-fair-warn`
- `swap-floor-vs-fair-warn`
- `swap-out-token-honeypot-warn`
- `swap-out-token-symbol-spoof-warn`
- `swap-permit2-spender-not-router-deny`
- `swap-shallow-route-warn`
- `swap-special-token-fot-rebasing-warn`
- `swap-uni-v3v4-effective-fee-warn`
- `transfer-blocklisted-recipient-deny`
- `transfer-first-time-recipient-warn`
- `transfer-outflow-usd-cap`
- `transfer-recipient-is-contract-warn`
- `transfer-unknown-recipient-warn`

## Phase 3 — 신규 action 표면(x402·EIP-7702)·거래행동 이력 — 19개

- `ap-doppelganger-recipient-guard`
- `behav-overtrading-daily-count-warn`
- `cooling-off-lock-deny`
- `daily-loss-limit-lockout-deny`
- `eip7702-delegate-sweeper-deny`
- `perp-revenge-reentry-cooldown-warn`
- `perp-revenge-trade-cooldown-warn`
- `self-exclusion-block-deny`
- `transfer-recipient-lookalike-poisoning-deny`
- `x402-agentic-cumulative-spend-cap-warn`
- `x402-auth-far-future-expiry-warn`
- `x402-first-time-pay-to-warn`
- `x402-from-not-connected-wallet-warn`
- `x402-future-validafter-dormant-warn`
- `x402-micro-payment-value-cap-warn`
- `x402-near-full-usdc-balance-warn`
- `x402-pay-to-blocklisted-deny`
- `x402-pay-to-is-contract-frontrun-warn`
- `x402-unknown-blind-sign-replaces-warn`

## 미분류 — main 브랜치 pool_state/current_price lowering 보류 (curve/lp) — 7개

- `air-permit-on-held-token-deny`
- `air-upfront-payment-warn`
- `ammlp-remove-exit-asymmetry-warn`
- `curve-depeg-pool-add-warn`
- `curve-imbalanced-add-skew-warn`
- `curve-metapool-base-depeg-warn`
- `curve-one-coin-withdraw-penalty-warn`
