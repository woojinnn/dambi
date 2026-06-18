/**
 * ⚠️ GENERATED — wallet-guardians/pasu-docs 전체 임포트 데모 시드.
 * 생성: scripts/import-pasu-docs/import.mjs (직접 수정 금지, 재생성하세요).
 * 로컬에서 마켓 화면을 채우기 위한 폴백. 실데이터 올라오면 market.ts 의
 * import 를 "./market-seed-beginner" 로 되돌리면 됩니다.
 */
import type { ListingDetail, ListingSummary } from "./market";

const RELEASED = Date.UTC(2026, 5, 12) / 1000;

interface SeedPol { slug: string; code: string | null; name_ko: string; name_en: string; category: string; severity: "deny" | "warn"; cedar: string; manifest: unknown; installs: number; rating: number; ratings: number; }
interface SeedMember { slug: string; display_name: string; cedar_text: string; manifest: unknown; }
interface SeedPkg { slug: string; name_ko: string; name_en: string; description_ko: string; category: string; installs: number; rating: number; ratings: number; members: SeedMember[]; }

const POLICIES: SeedPol[] = [
  {
    "slug": "claim-recipient-not-allowlisted-warn",
    "code": "AIRDROP-001",
    "name_ko": "클레임 시 수령 주소가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
    "name_en": "Airdrop Claim to a Non-Allowlisted Recipient",
    "category": "Airdrop",
    "severity": "warn",
    "cedar": "@id(\"claim-recipient-not-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"클레임 보상을 등록되지 않은 주소로 보냅니다 — 수령 주소를 확인하세요\")\nforbid (\n    principal,\n    action == Airdrop::Action::\"Claim\",\n    resource\n)\nwhen\n{\n    context.recipient != principal.address &&\n      !([\n          \"0x1111111111111111111111111111111111111111\"\n      ].contains(context.recipient))\n};",
    "manifest": {
      "id": "claim-recipient-not-allowlisted-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "airdrop"
          },
          "action.tag": {
            "eq": "claim"
          }
        }
      },
      "_template": {
        "recipientAllowlist": {
          "cedar_set": "[\"0x1111111111111111111111111111111111111111\"]",
          "default": "0x1111111111111111111111111111111111111111",
          "meaning": "Claim recipients you approve in ADDITION to the signing wallet itself (your cold/secondary wallets). MUST be lowercase 0x-hex — the engine lowercases decoded addresses, so a checksummed entry never matches (silent dead no-op). The default is a placeholder example — replace it with your own addresses."
        }
      }
    },
    "installs": 962,
    "rating": 4.5,
    "ratings": 88
  },
  {
    "slug": "claim-donation-amount-cap-warn",
    "code": "AIRDROP-002",
    "name_ko": "클레임 시  결제 금액이 한도를 넘을 경우 경고",
    "name_en": "Pay-to-Claim Donation Above the Cap",
    "category": "Airdrop",
    "severity": "warn",
    "cedar": "@id(\"claim-donation-amount-cap-warn\")\n@severity(\"warn\")\n@reason(\"클레임 시 결제 금액이 설정 한도를 넘습니다 — 결제 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Airdrop::Action::\"Claim\",\n    resource\n)\nwhen\n{\n    context has donation &&\n    context.donation has amountNano &&\n    context.donation.amountNano > 1000000000000\n};",
    "manifest": {
      "id": "claim-donation-amount-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "airdrop"
          },
          "action.tag": {
            "eq": "claim"
          }
        }
      },
      "_template": {
        "donationCapNano": {
          "cedar_literal": "1000000000000",
          "default": "1000000000000",
          "meaning": "Maximum donation/fee you'll pay to claim, in token-native nano (1 token unit = 1e9 nano). For a stablecoin donation (USDC/USDT) nano ≈ USD, so 1000000000000 = $1,000; for a native-currency donation 1e9 nano = 1 native token. Tune to your own ceiling. The donation amount is the non-refundable payment a pay-to-claim distributor (e.g. LayerZero donateAndClaim) charges — this caps fat-finger and frontend-inflated over-payments. Dormant when the claim charges no donation or the donation token's decimals can't be resolved."
        }
      }
    },
    "installs": 1442,
    "rating": 4.5,
    "ratings": 38
  },
  {
    "slug": "bridge-recipient-not-self-warn",
    "code": "BRIDGE-001",
    "name_ko": "브리지 수령처가 본인 지갑이 아닐 시 경고",
    "name_en": "Bridge Recipient Is Not Your Own Wallet",
    "category": "Bridge",
    "severity": "warn",
    "cedar": "@id(\"bridge-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"도착 체인에서 자산을 받는 주소가 본인 지갑이 아닙니다 — 받는 주소가 맞는지 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context.dstRecipient.kind == \"evm\" &&\n    context.dstRecipient has address &&\n    context.dstRecipient.address != principal.address\n};",
    "manifest": {
      "id": "bridge-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      }
    },
    "installs": 1739,
    "rating": 4.5,
    "ratings": 15
  },
  {
    "slug": "bridge-recipient-denylist-deny",
    "code": "BRIDGE-002",
    "name_ko": "브리지 수령처가 블랙리스트 주소일 시 차단",
    "name_en": "Bridge Recipient is a Burn Address",
    "category": "Bridge",
    "severity": "deny",
    "cedar": "@id(\"bridge-recipient-denylist-deny\")\n@severity(\"deny\")\n@reason(\"도착 체인의 블랙리스트 주소로 자산이 전달됩니다 — 수령 주소를 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context.dstRecipient.kind == \"evm\" &&\n    context.dstRecipient has address &&\n    [\"0x0000000000000000000000000000000000000000\",\n     \"0x000000000000000000000000000000000000dead\"].contains\n        (\n            context.dstRecipient.address\n        )\n};",
    "manifest": {
      "id": "bridge-recipient-denylist-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      },
      "_template": {
        "burnAddresses": {
          "cedar_set": "[\"0x0000000000000000000000000000000000000000\", \"0x000000000000000000000000000000000000dead\"]",
          "default": "zero + 0x…dead",
          "meaning": "destination recipients whose delivered funds are permanently unspendable. Unlike a Lido withdrawal `owner` (where 0x0 normalizes to msg.sender), a bridge `dstRecipient` of 0x0 means funds are delivered to the zero address on the destination chain = lost, so 0x0 IS a burn here."
        }
      }
    },
    "installs": 781,
    "rating": 4.3,
    "ratings": 7
  },
  {
    "slug": "bridge-recipient-raw-nonevm-warn",
    "code": "BRIDGE-003",
    "name_ko": "EVM이 아닌 체인으로 브리지할 시 경고",
    "name_en": "Bridge to a Non-EVM Raw Address",
    "category": "Bridge",
    "severity": "warn",
    "cedar": "@id(\"bridge-recipient-raw-nonevm-warn\")\n@severity(\"warn\")\n@reason(\"EVM이 아닌 주소로 보냅니다 — EVM 체인만 사용하신다면 다시 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen { context.dstRecipient.kind != \"evm\" };",
    "manifest": {
      "id": "bridge-recipient-raw-nonevm-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      }
    },
    "installs": 1613,
    "rating": 4.5,
    "ratings": 39
  },
  {
    "slug": "bridge-dst-chain-not-allowlisted-deny",
    "code": "BRIDGE-004",
    "name_ko": "허용되지 않은 체인으로 브리지할 시 차단",
    "name_en": "Bridge to a Non-Allowlisted Destination Chain",
    "category": "Bridge",
    "severity": "deny",
    "cedar": "@id(\"bridge-dst-chain-not-allowlisted-deny\")\n@severity(\"deny\")\n@reason(\"허용한 도착 체인 목록에 없는 체인으로 보내려 합니다 — 도착 체인을 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    !([\"eip155:1\",\n      \"eip155:10\",\n      \"eip155:56\",\n      \"eip155:130\",\n      \"eip155:137\",\n      \"eip155:8453\",\n      \"eip155:42161\",\n      \"eip155:59144\",\n      \"eip155:999\",\n      \"eip155:43114\"].contains\n         (\n             context.dstChainId\n         ))\n};",
    "manifest": {
      "id": "bridge-dst-chain-not-allowlisted-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      },
      "_template": {
        "allowedDstChains": {
          "cedar_set": "[\"eip155:1\", \"eip155:10\", \"eip155:56\", \"eip155:130\", \"eip155:137\", \"eip155:8453\", \"eip155:42161\", \"eip155:59144\", \"eip155:999\", \"eip155:43114\"]",
          "default": "Ethereum, Optimism, BNB, Unichain, Polygon, Base, Arbitrum, Linea, HyperEVM, Avalanche — the usage-calibrated set covering ~97-99% of real Across + Li.Fi EVM destinations (Dune q7686050 / q7686070)",
          "meaning": "CAIP-2 destination chains the user expects to bridge to; bridging to any chain NOT in this set denys. NOTE: Li.Fi non-EVM destinations (Solana, ~23% of Li.Fi traffic) arrive as Raw{bytes32} and DENY by default here — intended (also caught by bridge-recipient-raw-nonevm-deny). Across also supports zkSync(324)/Scroll(534352)/Blast(81457) — add them if you use those routes. Narrow to lock down (e.g. only Base + Arbitrum)."
        }
      }
    },
    "installs": 475,
    "rating": 4.8,
    "ratings": 41
  },
  {
    "slug": "bridge-message-attached-warn",
    "code": "BRIDGE-005",
    "name_ko": "Callback이 포함된 브리지일 시 경고",
    "name_en": "Bridge with an Attached Execution Message",
    "category": "Bridge",
    "severity": "warn",
    "cedar": "@id(\"bridge-message-attached-warn\")\n@severity(\"warn\")\n@reason(\"도착 체인에서 실행될 메시지가 함께 담겼습니다 — 자산 도착 후 임의 호출이 실행되니 내용을 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen { context.hasMessage == true };",
    "manifest": {
      "id": "bridge-message-attached-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      }
    },
    "installs": 1595,
    "rating": 4.4,
    "ratings": 91
  },
  {
    "slug": "bridge-input-usd-cap-warn",
    "code": "BRIDGE-006",
    "name_ko": "브리지 금액이 USD 한도를 초과할 시 경고",
    "name_en": "Bridge Input Above USD Cap",
    "category": "Bridge",
    "severity": "warn",
    "cedar": "@id(\"bridge-input-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"한 번의 브리지로 설정한 USD 한도를 넘는 금액을 옮깁니다 — 정확한 액수가 맞는지 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context has custom &&\n    context.custom has bridgeInputUsd &&\n    context.custom.bridgeInputUsd.greaterThan(decimal(\"100000.0000\"))\n};",
    "manifest": {
      "id": "bridge-input-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "bridge-in-usd",
          "method": "oracle.usd_value",
          "params": {
            "chain_id": "$.root.chain_id",
            "asset": "$.action.srcToken.key.address",
            "amount": "$.action.inputAmount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "bridgeInputUsd",
              "type": "Decimal",
              "from": "$.result.usd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "bridgeInputUsd": "decimal"
        }
      },
      "_template": {
        "maxBridgeUsd": {
          "cedar_decimal": "100000.0000",
          "default": "100000.0000 (USD)",
          "meaning": "warn when a single bridge moves more than this USD value (oracle.usd_value of srcToken × inputAmount). Default $100k flags only ~0.3% of Across / ~0.9% of Li.Fi deposits (Dune q7686050 / q7686070) — the clean whale/outlier tail. Dynamic: requires login + synced prices, otherwise dormant (fail-open)."
        },
        "_note_selectors": "params `$.action.*` resolve against the LOWERED Cedar context (camelCase): srcToken.key.address + inputAmount, NOT the snake_case ActionBody."
      }
    },
    "installs": 645,
    "rating": 4.6,
    "ratings": 11
  },
  {
    "slug": "bridge-output-value-loss-warn",
    "code": "BRIDGE-007",
    "name_ko": "브리지 손실이 한도를 초과할 시 경고",
    "name_en": "Bridge Output Value Loss Above Cap",
    "category": "Bridge",
    "severity": "warn",
    "cedar": "@id(\"bridge-output-value-loss-warn\")\n@severity(\"warn\")\n@reason(\"보내는 자산에 비해 도착 체인에서 받는 자산이 크게 적습니다 — 손실이 설정 한도를 넘으니 도착 체인에서 받을 토큰과 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context has custom &&\n    context.custom has bridgeValueLossPct &&\n    context.custom.bridgeValueLossPct.greaterThan(decimal(\"5.0000\"))\n};",
    "manifest": {
      "id": "bridge-output-value-loss-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "bridge-value-loss",
          "method": "bridge.value_loss_pct",
          "params": {
            "src_chain_id": "$.root.chain_id",
            "src_asset": "$.action.srcToken.key.address",
            "input_amount": "$.action.inputAmount",
            "dst_chain_id": "$.action.dstChainId",
            "dst_asset": "$.action.dstToken.key.address",
            "output_amount": "$.action.outputAmount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "bridgeValueLossPct",
              "type": "Decimal",
              "from": "$.result.loss_pct",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "bridgeValueLossPct": "decimal"
        }
      },
      "_template": {
        "maxValueLossPct": {
          "cedar_decimal": "5.0000",
          "default": "5.0000 (%)",
          "meaning": "warn when a bridge's implied value loss ((inputUsd - outputUsd) / inputUsd * 100, computed by bridge.value_loss_pct) exceeds this %. Normal bridge fees ~0.1-1% (cross-token swap ~1-3%) pass; an abnormal skim (a frontend that sets outputAmount absurdly low) is flagged. CONSERVATIVE default — NOT yet Dune-calibrated (TODO: measure the same-stablecoin Across (inputAmount-outputAmount)/inputAmount p99). Dynamic: the method bridge.value_loss_pct IS served server-side (handler.rs); requires login + BOTH token prices synced + dstToken/outputAmount statically known, otherwise dormant (fail-open)."
        },
        "_note_selectors": "params `$.action.*` resolve against the LOWERED Cedar context (camelCase): srcToken.key.address / inputAmount / dstChainId / dstToken.key.address / outputAmount — NOT the snake_case ActionBody. dstToken/outputAmount are OPTIONAL (absent on some routes that do not statically expose the output) → selector miss → call skipped → dormant."
      }
    },
    "installs": 1762,
    "rating": 4.7,
    "ratings": 58
  },
  {
    "slug": "bridge-protocol-not-allowlisted-warn",
    "code": "BRIDGE-008",
    "name_ko": "허용되지 않은 프로토콜을 사용해 브리지할 시 경고",
    "name_en": "Bridge via a Protocols Not on the Allowlist",
    "category": "Bridge",
    "severity": "warn",
    "cedar": "@id(\"bridge-protocol-not-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"허용한 브리지 목록에 없는 프로토콜을 사용합니다 — 해당 프로토콜을 선택한게 맞는지 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    !([\"across_spoke_pool\", \"lifi_diamond\"].contains(context.protocol.name))\n};",
    "manifest": {
      "id": "bridge-protocol-not-allowlisted-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "bridge"
          },
          "action.tag": {
            "eq": "send"
          }
        }
      },
      "_template": {
        "allowedProtocols": {
          "cedar_set": "[\"across_spoke_pool\", \"lifi_diamond\"]",
          "default": "across_spoke_pool + lifi_diamond (both supported protocols → dormant by default)",
          "meaning": "bridge protocols the user trusts. With both allowed this never fires. Narrow to e.g. [\"across_spoke_pool\"] to warn on the Li.Fi aggregator route."
        }
      }
    },
    "installs": 1502,
    "rating": 4.8,
    "ratings": 8
  },
  {
    "slug": "ammlp-add-recipient-not-self-warn",
    "code": "AMM-002",
    "name_ko": "유동성 풀(LP)에 유동성을 공급할 때, LP Token 또는 포지션 NFT가 제3자에게 갈 시 경고",
    "name_en": "Third-Party Transfer of LP Tokens and Position NFTs",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"ammlp-add-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"이 유동성 공급은 다른 주소로 LP Token을 전송합니다. 수취인이 바르게 설정되었는지 거래를 검토하세요.\")\nforbid(principal, action == Amm::Action::\"AddLiquidity\", resource)\nwhen { \n    context.params has recipient \n    && context.params.recipient != principal.address \n};",
    "manifest": {
      "id": "ammlp-add-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "add_liquidity"
          }
        }
      }
    },
    "installs": 779,
    "rating": 4.4,
    "ratings": 35
  },
  {
    "slug": "ammlp-remove-recipient-not-self-warn",
    "code": "AMM-003",
    "name_ko": "유동성 풀(LP)에서 유동성을 회수할 때, 회수한 토큰이 제3자에게 갈 시 경고",
    "name_en": "Third-Party Transfer of Withdrawn Tokens",
    "category": "DEX",
    "severity": "deny",
    "cedar": "@id(\"ammlp-remove-recipient-not-self-warn\")\n@severity(\"deny\")\n@reason(\"회수한 유동성이 다른 지갑으로 전송됩니다. 수취인이 바르게 설정되었는지 거래를 검토하세요.\")\nforbid(principal, action == Amm::Action::\"RemoveLiquidity\", resource)\nwhen {\n  context.params has recipient\n  && context.params.recipient != principal.address\n};",
    "manifest": {
      "id": "ammlp-remove-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "remove_liquidity"
          }
        }
      }
    },
    "installs": 1822,
    "rating": 4.4,
    "ratings": 78
  },
  {
    "slug": "ammlp-collect-recipient-not-self-warn",
    "code": "AMM-004",
    "name_ko": "LP 수수료가 제3자에게 갈 시 경고",
    "name_en": "Third-Party Transfer of LP Fees",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"ammlp-collect-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"유동성 수수료를 받을 주소가 내 지갑이 아닙니다. 수수료가 다른 주소로 빠져나갈 수 있으니 트랜잭션을 검토하세요.\")\nforbid(principal, action == Amm::Action::\"CollectFees\", resource)\nwhen { \n    context.recipient != principal.address \n};",
    "manifest": {
      "id": "ammlp-collect-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "collect_fees"
          }
        }
      }
    },
    "installs": 2084,
    "rating": 4.4,
    "ratings": 40
  },
  {
    "slug": "swap-min-out-zero",
    "code": "AMM-005",
    "name_ko": "판매할 토큰의 수량을 정하는 Swap(Exact-Input)에서, 수령할 토큰의 수량을 정하지 않았을 시 경고",
    "name_en": "Unspecified Output Amount in Exact-Input Swaps",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-min-out-zero\")\n@severity(\"warn\")\n@reason(\"이 Swap으로 받을 토큰의 최소 수량이 지정되어 있지 않습니다. MEV를 당하지 않게 값을 지정하세요.\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context.direction.kind == \"exact_input\"\n  && context.direction has minAmountOut\n  && context.direction.minAmountOut == \"0x0\"\n};",
    "manifest": {
      "id": "swap-min-out-zero",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      }
    },
    "installs": 402,
    "rating": 4.3,
    "ratings": 48
  },
  {
    "slug": "addliquidity-low-liquidity-warn",
    "code": "AMM-006",
    "name_ko": "거래량이 적은 풀에 유동성을 공급할 시 경고",
    "name_en": "Adding Liquidity to a Low-Volume Pool",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"addliquidity-low-liquidity-warn\")\n@severity(\"warn\")\n@reason(\"이 풀은 24시간 거래량이 매우 적습니다 — LP를 빠져나오기 어렵고 share-inflation·비영구적 손실(IL)에 노출될 수 있습니다\")\nforbid(principal, action == Amm::Action::\"AddLiquidity\", resource)\nwhen {\n  context has custom\n  && context.custom has poolVol24hUsd\n  && context.custom.poolVol24hUsd.lessThan(decimal(\"10000.0000\"))\n};",
    "manifest": {
      "id": "addliquidity-low-liquidity-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "add_liquidity"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "pool-liq",
          "method": "pool.liquidity",
          "params": {
            "chain_id": "$.root.chain_id",
            "venue": "$.action.venue"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "poolVol24hUsd",
              "type": "Decimal",
              "from": "$.result.vol24hUsd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "poolVol24hUsd": "decimal"
        }
      }
    },
    "installs": 908,
    "rating": 4.8,
    "ratings": 14
  },
  {
    "slug": "swap-usd-cap-warn",
    "code": "AMM-007",
    "name_ko": "스왑 금액이 $25,000을 초과할 시 경고",
    "name_en": "Swap Above USD Cap",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"고액 스왑입니다(명목가 약 $25,000 초과) — 규모를 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has swapUsd\n  && context.custom.swapUsd.greaterThan(decimal(\"25000.0000\"))\n};",
    "manifest": {
      "id": "swap-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "swap-in-usd",
          "method": "oracle.usd_value",
          "params": {
            "chain_id": "$.root.chain_id",
            "asset": "$.action.tokenIn",
            "amount": "$.action.direction.amountIn"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "swapUsd",
              "type": "Decimal",
              "from": "$.result.usd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "swapUsd": "decimal"
        }
      }
    },
    "installs": 1000,
    "rating": 4.9,
    "ratings": 66
  },
  {
    "slug": "swap-fraction-of-holdings-warn",
    "code": "AMM-008",
    "name_ko": "보유한 토큰의 절반을 초과해 스왑할 시 경고",
    "name_en": "Swap of Over Half Your Input Token Holdings",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-fraction-of-holdings-warn\")\n@severity(\"warn\")\n@reason(\"이 스왑이 보유한 입력 토큰의 절반 넘게 팝니다 — 진행 전에 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has holdingsBp\n  && context.custom.holdingsBp > 5000\n};",
    "manifest": {
      "id": "swap-fraction-of-holdings-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "in-holdings-fraction",
          "method": "portfolio.input_fraction_bps",
          "params": {
            "chain_id": "$.root.chain_id",
            "owner": "$.root.from",
            "asset": "$.action.tokenIn",
            "amount": "$.action.direction.amountIn"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "holdingsBp",
              "type": "Long",
              "from": "$.result.bps",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "holdingsBp": "Long"
        }
      }
    },
    "installs": 1412,
    "rating": 4.6,
    "ratings": 68
  },
  {
    "slug": "swap-price-impact-cap-warn",
    "code": "AMM-009",
    "name_ko": "스왑이 풀 가격을 5% 넘게 움직일 시 경고",
    "name_en": "Swap Price Impact Above 5%",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-price-impact-cap-warn\")\n@severity(\"warn\")\n@reason(\"이 스왑이 풀 가격을 5% 넘게 움직입니다 — 호가가 얇은 마켓에서 비싸게 사는 것일 수 있습니다\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen { context.priceImpactBp > 500 };",
    "manifest": {
      "id": "swap-price-impact-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      }
    },
    "installs": 1568,
    "rating": 4.6,
    "ratings": 84
  },
  {
    "slug": "swap-high-slippage-warn",
    "code": "AMM-010",
    "name_ko": "슬리피지 허용치가 1%를 초과하는 스왑을 실행할 시 경고",
    "name_en": "Swap With Slippage Tolerance Above 1%",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-high-slippage-warn\")\n@severity(\"warn\")\n@reason(\"슬리피지 허용치가 1%를 넘습니다 — 샌드위치 공격으로 손해 볼 수 있습니다\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen { context.slippageBp > 100 };",
    "manifest": {
      "id": "swap-high-slippage-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      }
    },
    "installs": 1353,
    "rating": 4.3,
    "ratings": 29
  },
  {
    "slug": "swap-exact-output-unbounded-input-warn",
    "code": "AMM-011",
    "name_ko": "낼 금액에 상한이 없는 스왑을 서명할 시 경고",
    "name_en": "Exact-Output Swap With No Cap on the Input You Pay",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-exact-output-unbounded-input-warn\")\n@severity(\"warn\")\n@reason(\"이 스왑은 지불할 입력 수량에 상한이 없습니다(무제한 max-in) — 지불 금액을 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context.direction.kind == \"exact_output\"\n  && context.direction has maxAmountIn\n  && context.direction.maxAmountIn == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n};",
    "manifest": {
      "id": "swap-exact-output-unbounded-input-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      }
    },
    "installs": 588,
    "rating": 4.7,
    "ratings": 84
  },
  {
    "slug": "swap-output-token-reputation-warn",
    "code": "AMM-012",
    "name_ko": "스왑으로 받을 토큰이 스캠일 경우  경고",
    "name_en": "Swap Receiving a Token Flagged as a Scam",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-output-token-reputation-warn\")\n@severity(\"warn\")\n@reason(\"사려는 토큰이 알려진 스캠 토큰으로 분류됐습니다 — 진행 전에 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has reputationFlagged\n  && context.custom.reputationFlagged == true\n};",
    "manifest": {
      "id": "swap-output-token-reputation-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "out-token-rep",
          "method": "address.reputation",
          "params": {
            "chain_id": "$.root.chain_id",
            "address": "$.action.tokenOut.key.address"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "reputationFlagged",
              "type": "Bool",
              "from": "$.result.flagged",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "reputationFlagged": "Bool"
        }
      }
    },
    "installs": 1610,
    "rating": 4.8,
    "ratings": 76
  },
  {
    "slug": "swap-venue-reputation-deny",
    "code": "AMM-013",
    "name_ko": "악성으로 분류된 라우터를 통해 스왑할 시 차단",
    "name_en": "Swap Routed Through a Flagged Router or Aggregator",
    "category": "DEX",
    "severity": "deny",
    "cedar": "@id(\"swap-venue-reputation-deny\")\n@severity(\"deny\")\n@reason(\"이 스왑이 가짜·악성 어그리게이터로 분류된 라우터를 경유해 차단했습니다\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has reputationFlagged\n  && context.custom.reputationFlagged == true\n};",
    "manifest": {
      "id": "swap-venue-reputation-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "venue-rep",
          "method": "address.reputation",
          "params": {
            "chain_id": "$.root.chain_id",
            "address": "$.action.venue.router"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "reputationFlagged",
              "type": "Bool",
              "from": "$.result.flagged",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "reputationFlagged": "Bool"
        }
      }
    },
    "installs": 1070,
    "rating": 4.7,
    "ratings": 26
  },
  {
    "slug": "commit-recipient-not-self-warn",
    "code": "LAUNCH-001",
    "name_ko": "세일 배정 권리를 받을 주소가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
    "name_en": "Launchpad Allocation Sent to a Third Party",
    "category": "Launchpad",
    "severity": "warn",
    "cedar": "@id(\"commit-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"세일 배정 권리 수령처가 승인 목록에 없는 주소입니다 — 수령 주소를 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"Commit\", resource)\nwhen {\n    context.recipient != principal.address &&\n    ![\"0x1111111111111111111111111111111111111111\"].contains\n        (\n            context.recipient\n        )\n};",
    "manifest": {
      "id": "commit-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "commit"
          }
        }
      }
    },
    "installs": 1993,
    "rating": 4.3,
    "ratings": 39
  },
  {
    "slug": "commit-usd-cap-warn",
    "code": "LAUNCH-002",
    "name_ko": "세일 참여(commit) 금액이 한도를 초과할 시 경고",
    "name_en": "Launchpad Commit Above USD Cap",
    "category": "Launchpad",
    "severity": "warn",
    "cedar": "@id(\"commit-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"세일 참여 금액이 설정 한도를 넘습니다 — 참여 금액을 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"Commit\", resource)\nwhen {\n  context has custom\n  && context.custom has commitUsd\n  && context.custom.commitUsd.greaterThan(decimal(\"50000.0000\"))\n};",
    "manifest": {
      "id": "commit-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "commit"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "commit-usd",
          "method": "oracle.usd_value",
          "params": {
            "chain_id": "$.root.chain_id",
            "asset": "$.action.payToken",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "commitUsd",
              "type": "Decimal",
              "from": "$.result.usd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "commitUsd": "decimal"
        }
      }
    },
    "installs": 1876,
    "rating": 4.9,
    "ratings": 42
  },
  {
    "slug": "claim-allocation-recipient-not-self-warn",
    "code": "LAUNCH-003",
    "name_ko": "배정 토큰 클레임 수령처가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
    "name_en": "Launchpad Allocation Sent to a Third Party",
    "category": "Launchpad",
    "severity": "warn",
    "cedar": "@id(\"claim-allocation-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"배정 토큰 클레임 수령처가 승인 목록에 없는 주소입니다 — 수령 주소를 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"ClaimAllocation\", resource)\nwhen {\n    context.recipient != principal.address &&\n    ![\"0x1111111111111111111111111111111111111111\"].contains\n        (\n            context.recipient\n        )\n};",
    "manifest": {
      "id": "claim-allocation-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "claim_allocation"
          }
        }
      }
    },
    "installs": 1619,
    "rating": 4.6,
    "ratings": 55
  },
  {
    "slug": "refund-recipient-not-self-warn",
    "code": "LAUNCH-004",
    "name_ko": "환불 수령처가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
    "name_en": "Launchpad Refund Sent to a Third Party",
    "category": "Launchpad",
    "severity": "warn",
    "cedar": "@id(\"refund-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"환불 수령처가 승인 목록에 없는 주소입니다 — 수령 주소를 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"Refund\", resource)\nwhen {\n    context.recipient != principal.address &&\n    ![\"0x1111111111111111111111111111111111111111\"].contains\n        (\n            context.recipient\n        )  \n};",
    "manifest": {
      "id": "refund-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "refund"
          }
        }
      }
    },
    "installs": 1738,
    "rating": 4.8,
    "ratings": 74
  },
  {
    "slug": "set-authorization-grant-confirm-warn",
    "code": "LEND-001",
    "name_ko": "Morpho 포지션 관리 권한을 위임할 시 경고",
    "name_en": "Granting Position-Management Authorization on Morpho",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"set-authorization-grant-confirm-warn\")\n@severity(\"warn\")\n@reason(\"Morpho에서 어떤 주소에 권한을 주면 그 주소가 내 포지션을 관리할 수 있습니다 — 위임 대상을 확인하세요\")\nforbid(principal, action == Lending::Action::\"SetAuthorization\", resource)\nwhen { context.isAuthorized == true };",
    "manifest": {
      "id": "set-authorization-grant-confirm-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "set_authorization"
          }
        }
      }
    },
    "installs": 537,
    "rating": 4.5,
    "ratings": 23
  },
  {
    "slug": "set-authorization-operator-reputation-deny",
    "code": "LEND-002",
    "name_ko": "Morpho에서 악성으로 분류된 주소에 포지션 관리 권한을 위임할 시 차단",
    "name_en": "Morpho에서 악성으로 분류된 주소에 포지션 관리 권한을 위임할 시 차단",
    "category": "Lending",
    "severity": "deny",
    "cedar": "@id(\"set-authorization-operator-reputation-deny\")\n@severity(\"deny\")\n@reason(\"Morpho에서 권한을 주려는 주소가 악성으로 분류됐습니다 — 차단했습니다\")\nforbid(principal, action == Lending::Action::\"SetAuthorization\", resource)\nwhen {\n  context.isAuthorized == true\n  && context has custom\n  && context.custom has authorizedFlagged\n  && context.custom.authorizedFlagged == true\n};",
    "manifest": {
      "id": "set-authorization-operator-reputation-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "set_authorization"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "authorized-rep",
          "method": "address.reputation",
          "params": {
            "chain_id": "$.root.chain_id",
            "address": "$.action.authorized"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "authorizedFlagged",
              "type": "Bool",
              "from": "$.result.flagged",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "authorizedFlagged": "Bool"
        }
      }
    },
    "installs": 1852,
    "rating": 4.6,
    "ratings": 8
  },
  {
    "slug": "supply-on-behalf-mismatch-warn",
    "code": "LEND-003",
    "name_ko": "예치 담보 청구권(aToken)을 본인이 아닌 다른 주소로 받을 시 경고",
    "name_en": "Supply Crediting a Different aToken Recipient",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"supply-on-behalf-mismatch-warn\")\n@severity(\"warn\")\n@reason(\"이 예치는 담보 청구권(aToken)을 본인이 아닌 다른 주소로 발행합니다 — 수령 대상을 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
    "manifest": {
      "id": "supply-on-behalf-mismatch-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "supply"
          }
        }
      }
    },
    "installs": 1588,
    "rating": 4.5,
    "ratings": 94
  },
  {
    "slug": "borrow-on-behalf-mismatch-warn",
    "code": "LEND-004",
    "name_ko": "대출시에 빚이 본인이 아닌 다른 계정 앞으로 잡힐 시 경고",
    "name_en": "Borrow Taken Out on Behalf of Another Account",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"borrow-on-behalf-mismatch-warn\")\n@severity(\"warn\")\n@reason(\"이 대출이 본인이 아닌 다른 계정 앞으로 잡힙니다 — 신용 위임(credit delegation)이 맞는지 확인하세요\")\nforbid(principal, action == Lending::Action::\"Borrow\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
    "manifest": {
      "id": "borrow-on-behalf-mismatch-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "borrow"
          }
        }
      }
    },
    "installs": 298,
    "rating": 4.6,
    "ratings": 94
  },
  {
    "slug": "repay-on-behalf-confirm-warn",
    "code": "LEND-005",
    "name_ko": "내가 아닌 다른 주소의 빚을 상환할 시 경고",
    "name_en": "Repaying Another Address's Debt",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"repay-on-behalf-confirm-warn\")\n@severity(\"warn\")\n@reason(\"이 상환은 본인이 아닌 다른 주소의 빚을 갚습니다 — 내 자금으로 남의 대출을 갚는 게 맞는지 확인하세요\")\nforbid(principal, action == Lending::Action::\"Repay\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
    "manifest": {
      "id": "repay-on-behalf-confirm-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "repay"
          }
        }
      }
    },
    "installs": 1306,
    "rating": 4.8,
    "ratings": 52
  },
  {
    "slug": "supply-into-frozen-reserve-warn",
    "code": "LEND-006",
    "name_ko": "동결·일시정지된 자산 풀에 예치할 시 경고",
    "name_en": "Supply into a Frozen or Paused Reserve",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"supply-into-frozen-reserve-warn\")\n@severity(\"warn\")\n@reason(\"이 자산 풀이 동결(frozen)·일시정지(paused) 상태입니다 — 예치하면 자금이 묶일 수 있으니 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context.reserveState.isFrozen || context.reserveState.isPaused\n};",
    "manifest": {
      "id": "supply-into-frozen-reserve-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "supply"
          }
        }
      }
    },
    "installs": 1323,
    "rating": 4.8,
    "ratings": 29
  },
  {
    "slug": "supply-usd-cap-warn",
    "code": "LEND-007",
    "name_ko": "예치 금액이 $50,000을 초과할 시 경고",
    "name_en": "Lending Supply Above USD Cap",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"supply-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"고액 예치입니다(약 $50,000 초과) — 예치 규모를 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context has custom\n  && context.custom has supplyUsd\n  && context.custom.supplyUsd.greaterThan(decimal(\"50000.0000\"))\n};",
    "manifest": {
      "id": "supply-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "supply"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "supply-usd",
          "method": "oracle.usd_value",
          "params": {
            "chain_id": "$.root.chain_id",
            "asset": "$.action.asset",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "supplyUsd",
              "type": "Decimal",
              "from": "$.result.usd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "supplyUsd": "decimal"
        }
      }
    },
    "installs": 1868,
    "rating": 4.8,
    "ratings": 94
  },
  {
    "slug": "withdraw-recipient-not-self-warn",
    "code": "LEND-008",
    "name_ko": "대출 자산을 본인이 아닌 주소로 인출할 시 경고",
    "name_en": "Withdrawal Sent to an Address Other Than Yourself",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"withdraw-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"이 인출은 본인 지갑이 아닌 주소로 자금을 보냅니다 — 받는 주소를 확인하세요\")\nforbid(principal, action == Lending::Action::\"Withdraw\", resource)\nwhen {\n  context.recipient != principal.address\n};",
    "manifest": {
      "id": "withdraw-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "withdraw"
          }
        }
      }
    },
    "installs": 1292,
    "rating": 4.7,
    "ratings": 28
  },
  {
    "slug": "withdraw-full-balance-confirm-warn",
    "code": "LEND-009",
    "name_ko": "대출이 남은 상태에서 예치 잔액을 전부 인출할 시 경고",
    "name_en": "Full Collateral Withdrawal While Debt Remains",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"withdraw-full-balance-confirm-warn\")\n@severity(\"warn\")\n@reason(\"대출이 남은 상태에서 예치 잔액 전부를 인출합니다 — 포지션이 청산에 가까워질 수 있으니 확인하세요\")\nforbid(principal, action == Lending::Action::\"Withdraw\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n  && context.userStateBefore.totalDebtUsd != \"0x0\"\n};",
    "manifest": {
      "id": "withdraw-full-balance-confirm-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "withdraw"
          }
        }
      }
    },
    "installs": 1077,
    "rating": 4.4,
    "ratings": 53
  },
  {
    "slug": "borrow-into-frozen-reserve-warn",
    "code": "LEND-010",
    "name_ko": "동결·일시정지된 자산 풀에서 대출할 시 경고",
    "name_en": "Borrowing from a Frozen or Paused Reserve",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"borrow-into-frozen-reserve-warn\")\n@severity(\"warn\")\n@reason(\"이 자산 풀이 동결(frozen)·일시정지(paused) 상태입니다 — 빌리면 포지션을 관리하지 못할 수 있으니 확인하세요\")\nforbid(principal, action == Lending::Action::\"Borrow\", resource)\nwhen {\n  context.reserveState.isFrozen || context.reserveState.isPaused\n};",
    "manifest": {
      "id": "borrow-into-frozen-reserve-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "borrow"
          }
        }
      }
    },
    "installs": 373,
    "rating": 4.6,
    "ratings": 79
  },
  {
    "slug": "borrow-low-health-factor-warn",
    "code": "LEND-011",
    "name_ko": "대출 후 Health Factor가 1.5 미만이 될 시 경고",
    "name_en": "Borrow That Pushes Health Factor Below 1.5",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"borrow-low-health-factor-warn\")\n@severity(\"warn\")\n@reason(\"이 대출 후 건강도(health factor)가 1.5 미만으로 청산에 가까워집니다 — 확인하세요\")\nforbid(principal, action == Lending::Action::\"Borrow\", resource)\nwhen {\n  context has custom\n  && context.custom has postActionHf\n  && context.custom.postActionHf.lessThan(decimal(\"1.5000\"))\n};",
    "manifest": {
      "id": "borrow-low-health-factor-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "borrow"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "post-borrow-hf",
          "method": "lending.health_factor",
          "params": {
            "chain_id": "$.root.chain_id",
            "owner": "$.root.from",
            "venue": "$.action.venue",
            "asset": "$.action.asset",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "postActionHf",
              "type": "Decimal",
              "from": "$.result.postActionHf",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "postActionHf": "decimal"
        }
      }
    },
    "installs": 490,
    "rating": 4.4,
    "ratings": 6
  },
  {
    "slug": "withdraw-low-health-factor-warn",
    "code": "LEND-012",
    "name_ko": "담보 인출 후 Health Factor가 1.5 미만이 될 시 경고",
    "name_en": "Collateral Withdrawal That Drops Health Factor Below 1.5",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"withdraw-low-health-factor-warn\")\n@severity(\"warn\")\n@reason(\"이만큼 담보를 빼면 건강도(health factor)가 1.5 미만으로 청산에 가까워집니다 — 확인하세요\")\nforbid(principal, action == Lending::Action::\"Withdraw\", resource)\nwhen {\n  context has custom\n  && context.custom has postActionHf\n  && context.custom.postActionHf.lessThan(decimal(\"1.5000\"))\n};",
    "manifest": {
      "id": "withdraw-low-health-factor-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "withdraw"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "post-withdraw-hf",
          "method": "lending.health_factor",
          "params": {
            "chain_id": "$.root.chain_id",
            "owner": "$.root.from",
            "venue": "$.action.venue",
            "asset": "$.action.asset",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "postActionHf",
              "type": "Decimal",
              "from": "$.result.postActionHf",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "postActionHf": "decimal"
        }
      }
    },
    "installs": 1221,
    "rating": 4.3,
    "ratings": 57
  },
  {
    "slug": "disable-collateral-while-borrowing-warn",
    "code": "LEND-013",
    "name_ko": "담보 해제 후 Health Factor가 1.1 미만일 시 경고",
    "name_en": "Disabling Collateral Pushes Health Factor Near Liquidation",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"disable-collateral-while-borrowing-warn\")\n@severity(\"warn\")\n@reason(\"이 담보를 해제하면 건강도(health factor)가 1.1 미만으로 청산에 가까워집니다 — 확인하세요\")\nforbid(principal, action == Lending::Action::\"DisableCollateral\", resource)\nwhen {\n  context has custom\n  && context.custom has postActionHf\n  && context.custom.postActionHf.lessThan(decimal(\"1.1000\"))\n};",
    "manifest": {
      "id": "disable-collateral-while-borrowing-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "disable_collateral"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "post-disable-hf",
          "method": "lending.health_factor",
          "params": {
            "chain_id": "$.root.chain_id",
            "owner": "$.root.from",
            "venue": "$.action.venue",
            "asset": "$.action.asset",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "postActionHf",
              "type": "Decimal",
              "from": "$.result.postActionHf",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "postActionHf": "decimal"
        }
      }
    },
    "installs": 169,
    "rating": 4.4,
    "ratings": 75
  },
  {
    "slug": "set-emode-with-open-debt-warn",
    "code": "LEND-014",
    "name_ko": "e-mode를 대출이 남은 상태에서 변경할 시 경고",
    "name_en": "Changing E-Mode While Debt Is Still Open",
    "category": "Lending",
    "severity": "warn",
    "cedar": "@id(\"set-emode-with-open-debt-warn\")\n@severity(\"warn\")\n@reason(\"대출이 남은 상태에서 e-mode를 바꿉니다 — 청산 기준선이 달라지니 확인하세요\")\nforbid(principal, action == Lending::Action::\"SetEMode\", resource)\nwhen {\n  context.userStateBefore.totalDebtUsd != \"0x0\"\n};",
    "manifest": {
      "id": "set-emode-with-open-debt-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "set_e_mode"
          }
        }
      }
    },
    "installs": 1690,
    "rating": 4.6,
    "ratings": 36
  },
  {
    "slug": "stake-during-steth-discount-warn",
    "code": "LIDO-002",
    "name_ko": "stETH가 ETH보다 쌀 때 Lido에 스테이킹할 시 경고",
    "name_en": "stETH가 ETH보다 쌀 때 Lido에 스테이킹할 시 경고",
    "category": "LiquidStaking",
    "severity": "warn",
    "cedar": "@id(\"stake-during-steth-discount-warn\")\n@severity(\"warn\")\n@reason(\"지금 stETH가 ETH보다 쌉니다. 지금은 스테이킹보다 시장에서 stETH를 사는 편이 유리할 수 있습니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"lido\" &&\n    context has custom &&\n    context.custom has stethDiscountBps &&\n    context.custom.stethDiscountBps.greaterThan(decimal(\"100.0000\"))\n};",
    "manifest": {
      "id": "stake-during-steth-discount-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "stake"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "peg",
          "method": "oracle.steth_peg_status_bps",
          "params": {
            "chain_id": "$.root.chain_id"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "stethDiscountBps",
              "type": "Decimal",
              "from": "$.result.discountBps",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "stethDiscountBps": "decimal"
        }
      },
      "_template": {
        "maxStethDiscountBps": {
          "cedar_literal": "decimal(\"100.0000\")",
          "default": "100 bps (1.00%)",
          "meaning": "warn when stETH trades below ETH by more than this discount"
        }
      }
    },
    "installs": 1706,
    "rating": 4.8,
    "ratings": 92
  },
  {
    "slug": "transfer-shares-burn-recipient-deny",
    "code": "LIDO-006",
    "name_ko": "stETH 지분을 소각 주소로 전송할 시 차단",
    "name_en": "stETH 지분을 소각 주소로 전송할 시 차단",
    "category": "LiquidStaking",
    "severity": "deny",
    "cedar": "@id(\"transfer-shares-burn-recipient-deny\")\n@severity(\"deny\")\n@reason(\"지분 전송 수신자가 소각 주소입니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"TransferShares\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    [\"0x0000000000000000000000000000000000000000\",\n     \"0x000000000000000000000000000000000000dead\"].contains\n        (\n            context.recipient\n        )\n};",
    "manifest": {
      "id": "transfer-shares-burn-recipient-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "transfer_shares"
          }
        }
      },
      "_template": {
        "burnAddresses": {
          "cedar_set": "[\"0x0000000000000000000000000000000000000000\", \"0x000000000000000000000000000000000000dead\"]",
          "default": "zero + dead",
          "meaning": "addresses whose funds are permanently unrecoverable (protocol constants)"
        }
      }
    },
    "installs": 2125,
    "rating": 4.8,
    "ratings": 41
  },
  {
    "slug": "withdrawal-owner-not-self-warn",
    "code": "LIDO-007",
    "name_ko": "출금 청구권이 본인이 아닌 주소로 발행될 시 차단",
    "name_en": "출금 청구권이 본인이 아닌 주소로 발행될 시 차단",
    "category": "LiquidStaking",
    "severity": "deny",
    "cedar": "@id(\"withdrawal-owner-not-self-warn\")\n@severity(\"deny\")\n@reason(\"출금 ETH에 대한 청구권인 unstETH NFT이 본인 지갑이 아닌 주소로 발행됩니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"RequestWithdrawal\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    context.owner != principal.address &&\n    context.owner != \"0x0000000000000000000000000000000000000000\"\n};",
    "manifest": {
      "id": "withdrawal-owner-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "request_withdrawal"
          }
        }
      },
      "_template": {
        "trustedRecipients": {
          "cedar_extension": "&& !([\"0x...\"].contains(context.owner))",
          "default": "[] (not applied)",
          "meaning": "optional allowlist of non-self owners you trust; add to the cedar guard to suppress the warn"
        }
      }
    },
    "installs": 1329,
    "rating": 4.4,
    "ratings": 85
  },
  {
    "slug": "withdrawal-owner-burn-deny",
    "code": "LIDO-008",
    "name_ko": "출금 청구권이 소각 주소로 발행될 시 차단",
    "name_en": "출금 청구권이 소각 주소로 발행될 시 차단",
    "category": "LiquidStaking",
    "severity": "deny",
    "cedar": "@id(\"withdrawal-owner-burn-deny\")\n@severity(\"deny\")\n@reason(\"출금 ETH에 대한 청구권인 unstETH NFT이 소각 주소로 발행됩니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"RequestWithdrawal\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    [\"0x000000000000000000000000000000000000dead\"].contains(context.owner)\n};",
    "manifest": {
      "id": "withdrawal-owner-burn-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "request_withdrawal"
          }
        }
      },
      "_template": {
        "burnAddresses": {
          "cedar_set": "[\"0x000000000000000000000000000000000000dead\"]",
          "default": "dead only (0x0 EXCLUDED — Lido normalizes _owner==0 to msg.sender, so a zero owner is self, not a burn)",
          "meaning": "owner addresses whose claim rights are permanently unrecoverable (0x…dead is not normalized; 0x0 is the self-sentinel)"
        }
      }
    },
    "installs": 1790,
    "rating": 4.5,
    "ratings": 6
  },
  {
    "slug": "withdrawal-permit-unlimited-warn",
    "code": "LIDO-009",
    "name_ko": "Lido에서 permit 요청이 무제한 출금 요청일 때 경고",
    "name_en": "Lido에서 permit 요청이 무제한 출금 요청일 때 경고",
    "category": "LiquidStaking",
    "severity": "warn",
    "cedar": "@id(\"withdrawal-permit-unlimited-warn\")\n@severity(\"warn\")\n@reason(\"이 출금 요청이 무제한 permit을 서명합니다. 한도를 정한 permit이 더 안전합니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"RequestWithdrawal\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"lido\" &&\n    context has embedded_permit &&\n    context.embedded_permit\n        .value == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n};",
    "manifest": {
      "id": "withdrawal-permit-unlimited-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "request_withdrawal"
          }
        }
      },
      "_template": {
        "unlimitedAmount": {
          "cedar_literal": "\"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"",
          "default": "uint256 MAX",
          "meaning": "the raw-hex permit value treated as unlimited"
        }
      }
    },
    "installs": 2098,
    "rating": 4.9,
    "ratings": 24
  },
  {
    "slug": "claim-recipient-not-self-warn",
    "code": "LIDO-010",
    "name_ko": "Lido에서 출금 청구 시 ETH를 받는 주소가 본인이 아닌 경우 차단",
    "name_en": "Lido에서 출금 청구 시 ETH를 받는 주소가 본인이 아닌 경우 차단",
    "category": "LiquidStaking",
    "severity": "deny",
    "cedar": "@id(\"claim-recipient-not-self-warn\")\n@severity(\"deny\")\n@reason(\"본인 지갑이 아닌 주소로 출금됩니다. 받는 주소를 확인하세요\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"ClaimWithdrawal\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
    "manifest": {
      "id": "claim-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "claim_withdrawal"
          }
        }
      }
    },
    "installs": 2094,
    "rating": 4.5,
    "ratings": 40
  },
  {
    "slug": "claim-recipient-burn-deny",
    "code": "LIDO-011",
    "name_ko": "Lido에서 출금 청구 시 ETH를 받는 주소가 소각 주소인 경우 차단",
    "name_en": "ETH Withdrawal Claim Sent to a Burn Address",
    "category": "LiquidStaking",
    "severity": "deny",
    "cedar": "@id(\"claim-recipient-burn-deny\")\n@severity(\"deny\")\n@reason(\"소각 주소로 출금됩니다. 받는 주소를 확인하세요\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"ClaimWithdrawal\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"lido\" &&\n    context has recipient &&\n    [\"0x0000000000000000000000000000000000000000\",\n     \"0x000000000000000000000000000000000000dead\"].contains\n        (\n            context.recipient\n        )\n};",
    "manifest": {
      "id": "claim-recipient-burn-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "liquid_staking"
          },
          "action.tag": {
            "eq": "claim_withdrawal"
          }
        }
      },
      "_template": {
        "burnAddresses": {
          "cedar_set": "[\"0x0000000000000000000000000000000000000000\", \"0x000000000000000000000000000000000000dead\"]",
          "default": "zero + dead",
          "meaning": "addresses whose funds are permanently unrecoverable (protocol constants)"
        }
      }
    },
    "installs": 363,
    "rating": 4.5,
    "ratings": 89
  },
  {
    "slug": "steth-wsteth-approve-non-allowlisted-warn",
    "code": "LIDO-012",
    "name_ko": "stETH/wstETH 승인을 요청하는 주소가 Lido에서 자주 사용하는 주소가 아닐 시 경고",
    "name_en": "stETH/wstETH 승인을 요청하는 주소가 Lido에서 자주 사용하는 주소가 아닐 시 경고",
    "category": "LiquidStaking",
    "severity": "warn",
    "cedar": "@id(\"steth-wsteth-approve-non-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"stETH/wstETH 사용 승인을 요청하는 주소를 한번 더 확인해 주세요\")\nforbid (\n    principal,\n    action == Token::Action::\"Erc20Approve\",\n    resource\n)\nwhen\n{\n    context.token.key has address &&\n    [\"0xae7ab96520de3a18e5e111b5eaab095312d7fe84\",\n     \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n        (\n            context.token.key.address\n        ) &&\n    context.amount != \"0x0\" &&\n    !([\"0x000000000022d473030f116ddee9f6b43ac78ba3\",\n      \"0x889edc2edab5f40e902b864ad4d7ade8e412f9b1\",\n      \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n         (\n             context.spender\n         ))\n};",
    "manifest": null,
    "installs": 234,
    "rating": 4.5,
    "ratings": 90
  },
  {
    "slug": "steth-wsteth-permit-non-allowlisted-warn",
    "code": "LIDO-014",
    "name_ko": "stETH/wstETH 사용 permit 서명을 요청하는 주소가 Lido에서 자주 사용하는 주소가 아닐 시 경고",
    "name_en": "stETH/wstETH 사용 permit 서명을 요청하는 주소가 Lido에서 자주 사용하는 주소가 아닐 시 경고",
    "category": "LiquidStaking",
    "severity": "warn",
    "cedar": "@id(\"steth-wsteth-permit-non-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"stETH/wstETH 사용 승인을 요청하는 주소를 한번 더 확인해 주세요\")\nforbid (\n    principal,\n    action == Token::Action::\"Erc20Permit\",\n    resource\n)\nwhen\n{\n    context.token.key has address &&\n    [\"0xae7ab96520de3a18e5e111b5eaab095312d7fe84\",\n     \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n        (\n            context.token.key.address\n        ) &&\n    context.amount != \"0x0\" &&\n    !([\"0x000000000022d473030f116ddee9f6b43ac78ba3\",\n      \"0x889edc2edab5f40e902b864ad4d7ade8e412f9b1\",\n      \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n         (\n             context.spender\n         ))\n};",
    "manifest": null,
    "installs": 1230,
    "rating": 4.4,
    "ratings": 56
  },
  {
    "slug": "nft-setapprovalforall-conduit-warn",
    "code": "NFT-002",
    "name_ko": "알려지지 않은 곳에 NFT 컬렉션 전체 사용 권한을 줄 시 경고",
    "name_en": "Collection-Wide Approval to an Unknown Operator",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"nft-setapprovalforall-conduit-warn\")\n@severity(\"warn\")\n@reason(\"내 컬렉션 전체를 옮길 권한을 주는데 알려진 거래소 위임처가 아닙니다. 승인 대상이 맞는지 확인해 주십시오.\")\nforbid(principal, action == Token::Action::\"NftSetApprovalForAll\", resource)\nwhen {\n  context.approved\n  && !([\n    \"0x1e0049783f008a0085193e00003d00cd54003c71\", // OpenSea Conduit\n    \"0x00000000000111abe46ff893f3b2fdf1f759a8a8\", // Blur ExecutionDelegate\n    \"0x000000000060c4ca14cfc4325359062ace33fe3d\", // LooksRare v2 TransferManager\n    \"0xf849de01b080adc3a814fabe1e2087475cf2e354\"  // X2Y2 ERC721Delegate\n  ].contains(context.spender))\n};",
    "manifest": {
      "id": "nft-setapprovalforall-conduit-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "nft_set_approval_for_all"
          }
        }
      }
    },
    "installs": 556,
    "rating": 4.5,
    "ratings": 52
  },
  {
    "slug": "nft-transfer-burn-recipient-deny",
    "code": "NFT-003",
    "name_ko": "NFT를 소각 주소로 보낼 시 차단",
    "name_en": "NFT Transfer to a Burn Address",
    "category": "NFT",
    "severity": "deny",
    "cedar": "@id(\"nft-transfer-burn-recipient-deny\")\n@severity(\"deny\")\n@reason(\"이 NFT를 소각 주소로 보내는 거래입니다. 한 번 보내면 영영 되찾을 수 없어 차단합니다.\")\nforbid(principal, action == Token::Action::\"NftTransfer\", resource)\nwhen {\n  [\"0x0000000000000000000000000000000000000000\",\n   \"0x000000000000000000000000000000000000dead\"].contains(context.recipient)\n};",
    "manifest": {
      "id": "nft-transfer-burn-recipient-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "nft_transfer"
          }
        }
      }
    },
    "installs": 627,
    "rating": 4.5,
    "ratings": 33
  },
  {
    "slug": "nft-transfer-blocklisted-recipient-deny",
    "code": "NFT-004",
    "name_ko": "블랙리스트에 오른 주소로 NFT를 전송할 시 차단",
    "name_en": "NFT Transfer to a Blocklisted Address",
    "category": "NFT",
    "severity": "deny",
    "cedar": "@id(\"nft-transfer-blocklisted-recipient-deny\")\n@severity(\"deny\")\n@reason(\"받는 주소가 알려진 드레이너/제재 블록리스트에 있습니다 — NFT 전송을 차단합니다. 주소를 다시 확인하세요.\")\nforbid(principal, action == Token::Action::\"NftTransfer\", resource)\nwhen {\n  context has custom\n  && context.custom has recipientFlagged\n  && context.custom.recipientFlagged\n};",
    "manifest": {
      "id": "nft-transfer-blocklisted-recipient-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "nft_transfer"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "recipient-reputation",
          "method": "address.reputation",
          "params": {
            "chain_id": "$.root.chain_id",
            "address": "$.action.recipient"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "recipientFlagged",
              "type": "Bool",
              "from": "$.result.flagged"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "recipientFlagged": "Bool"
        }
      }
    },
    "installs": 618,
    "rating": 4.8,
    "ratings": 44
  },
  {
    "slug": "fulfill-recipient-not-self-warn",
    "code": "NFT-005",
    "name_ko": "구매한 NFT가 본인이 아닌 다른 주소로 갈 시 경고",
    "name_en": "Fulfilled Order Sends the NFT to a Non-Self Address",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"fulfill-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"이 구매로 받을 NFT가 본인 지갑이 아닌 다른 주소로 갑니다 — 승인 전에 받는 주소를 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"FulfillOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.recipient != context.meta.submitter\n};",
    "manifest": {
      "id": "fulfill-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "fulfill_order"
          }
        }
      }
    },
    "installs": 418,
    "rating": 4.5,
    "ratings": 24
  },
  {
    "slug": "fulfill-overpay-vs-floor-warn",
    "code": "NFT-006",
    "name_ko": "Seaport 구매에서 최저가의 50배가 넘는 금액을 지불할 시 경고",
    "name_en": "Seaport Purchase Far Above the Collection Floor Price",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"fulfill-overpay-vs-floor-warn\")\n@severity(\"warn\")\n@reason(\"받는 NFT의 바닥가(floor)보다 훨씬 비싸게 지불합니다 — 승인 전에 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"FulfillOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context has custom &&\n    context.custom has overpayMultiple &&\n    context.custom.overpayMultiple.greaterThan(decimal(\"50.0000\"))\n};",
    "manifest": {
      "id": "fulfill-overpay-vs-floor-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "fulfill_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "floor",
          "method": "marketplace.fulfill_overpay_vs_floor",
          "params": {
            "chain_id": "$.root.chain_id",
            "offer": "$.action.offer",
            "consideration": "$.action.consideration"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "overpayMultiple",
              "type": "Decimal",
              "from": "$.result.overpayMultiple",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "overpayMultiple": "decimal"
        }
      },
      "_template": {
        "maxOverpayMultiple": {
          "cedar_decimal": "50.0000",
          "default": "50x floor",
          "meaning": "Warn when the taker pays more than this multiple of the received collection's floor price (50.0 = paying 50x floor). The most tunable taker check — floor is a weak upper anchor on the buy side (rare items sell far above floor), so keep it generous."
        }
      }
    },
    "installs": 567,
    "rating": 4.4,
    "ratings": 63
  },
  {
    "slug": "non-opensea-conduit-warn",
    "code": "NFT-007",
    "name_ko": "낯선 운영자(Conduit)를 통해 자산을 옮기는 마켓플레이스 주문에 서명할 시 경고",
    "name_en": "Seaport Order Routed Through a Non-OpenSea Conduit",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"non-opensea-conduit-warn\")\n@severity(\"warn\")\n@reason(\"이 주문이 알려진 마켓플레이스가 아닌 낯선 운영자(conduit)를 통해 토큰을 옮깁니다 — 서명 전에 출처를 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.usesConduit == true &&\n    !([\"0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000\"].contains(context.conduitKey))\n};",
    "manifest": {
      "id": "non-opensea-conduit-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "sign_order"
          }
        }
      },
      "_template": {
        "trustedConduitKeys": {
          "cedar_set": "[\"0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000\"]",
          "default": "OpenSea conduit key (conduit 0x1e0049783f008a0085193e00003d00cd54003c71)",
          "meaning": "Allowlisted bytes32 conduit keys (lowercase). Orders routed through these operators are not flagged. The zero key (direct Seaport) never triggers this policy (usesConduit=false)."
        }
      }
    },
    "installs": 323,
    "rating": 4.8,
    "ratings": 89
  },
  {
    "slug": "listing-proceeds-below-floor-warn",
    "code": "NFT-008",
    "name_ko": "받을 대금이 최저가보다 크게 낮은 NFT 리스팅 시 경고",
    "name_en": "Seaport Listing Far Below Collection Floor Price",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"listing-proceeds-below-floor-warn\")\n@severity(\"warn\")\n@reason(\"받게 될 대금이 이 컬렉션 바닥가(floor)보다 훨씬 낮습니다 — 거의 공짜로 리스팅하는 게 아닌지 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context has custom &&\n    context.custom has proceedsBelowFloorBps &&\n    context.custom.proceedsBelowFloorBps.greaterThan(decimal(\"5000.0000\"))\n};",
    "manifest": {
      "id": "listing-proceeds-below-floor-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "sign_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "floor",
          "method": "marketplace.sign_order_proceeds_floor",
          "params": {
            "chain_id": "$.root.chain_id",
            "offerer": "$.action.offerer",
            "offer": "$.action.offer",
            "consideration": "$.action.consideration"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "proceedsBelowFloorBps",
              "type": "Decimal",
              "from": "$.result.proceedsBelowFloorBps",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "proceedsBelowFloorBps": "decimal"
        }
      },
      "_template": {
        "maxBelowFloorBps": {
          "cedar_decimal": "5000.0000",
          "default": "50% below floor",
          "meaning": "Warn when the offerer's proceeds are this many basis points below the offered collection's floor price (10000 bps = 100%)."
        }
      }
    },
    "installs": 552,
    "rating": 4.5,
    "ratings": 68
  },
  {
    "slug": "proceeds-not-to-self-warn",
    "code": "NFT-009",
    "name_ko": "마켓 주문 대금이 본인에게 들어오지 않을 시 경고",
    "name_en": "Marketplace Order Whose Proceeds Are Not Paid to You",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"proceeds-not-to-self-warn\")\n@severity(\"warn\")\n@reason(\"이 주문의 대금이 본인 주소로 한 푼도 들어오지 않습니다 — 내놓은 자산을 주고 아무것도 받지 못하니 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.proceedsToOfferer == false\n};",
    "manifest": {
      "id": "proceeds-not-to-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "sign_order"
          }
        }
      }
    },
    "installs": 1037,
    "rating": 4.6,
    "ratings": 63
  },
  {
    "slug": "offer-collection-giveaway-deny",
    "code": "NFT-010",
    "name_ko": "컬렉션을 통째로 내주는 오퍼에 서명할 시 차단",
    "name_en": "Seaport Offer that Gives Away an Entire Collection",
    "category": "NFT",
    "severity": "deny",
    "cedar": "@id(\"offer-collection-giveaway-deny\")\n@severity(\"deny\")\n@reason(\"서명하면 구매자가 이 컬렉션에서 본인이 일일이 고르지 않은 NFT까지 가져갈 수 있습니다 — 한 점이 아니라 컬렉션 전체를 내주는 서명이라 차단했습니다\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.offerHasCriteria == true\n};",
    "manifest": {
      "id": "offer-collection-giveaway-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "sign_order"
          }
        }
      },
      "_template": {
        "strictMode": {
          "severity_toggle": "warn | deny",
          "default": "deny",
          "meaning": "Offer-side any-token criteria is near-certainly a drain (research: no legit human-signed maker order has this shape) — deny (hard-block) by default. Flip @severity to warn for an advisory-only posture."
        }
      }
    },
    "installs": 1250,
    "rating": 4.7,
    "ratings": 86
  },
  {
    "slug": "contract-order-anomaly-deny",
    "code": "NFT-011",
    "name_ko": "비정상 타입의 마켓플레이스 주문에 서명할 시 차단",
    "name_en": "Signing a Marketplace Order with an Abnormal Order Type",
    "category": "NFT",
    "severity": "deny",
    "cedar": "@id(\"contract-order-anomaly-deny\")\n@severity(\"deny\")\n@reason(\"이 주문 타입은 정상 마켓플레이스 리스팅·오퍼가 아닙니다(contract·unknown 타입) — 사람의 정상 서명 흐름에 없는 형태라 차단했습니다\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    [\"contract\", \"unknown\"].contains(context.orderType)\n};",
    "manifest": {
      "id": "contract-order-anomaly-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "sign_order"
          }
        }
      }
    },
    "installs": 326,
    "rating": 4.8,
    "ratings": 82
  },
  {
    "slug": "far-future-expiry-warn",
    "code": "NFT-012",
    "name_ko": "Seaport 주문의 만료가 지나치게 멀 시 경고",
    "name_en": "Seaport Order with a Far-Future Expiry",
    "category": "NFT",
    "severity": "warn",
    "cedar": "@id(\"far-future-expiry-warn\")\n@severity(\"warn\")\n@reason(\"이 주문은 보통 리스팅보다 훨씬 오래 유효합니다 — 오래 살아 있는 서명 주문은 한참 뒤에 본인에게 불리하게 체결될 수 있으니 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.startTime != 0 &&\n    (context.endTime - context.startTime) > 15552000\n};",
    "manifest": {
      "id": "far-future-expiry-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "marketplace"
          },
          "action.tag": {
            "eq": "sign_order"
          }
        }
      },
      "_template": {
        "maxValiditySeconds": {
          "cedar_long": "15552000",
          "default": "180 days (~6 months, OpenSea's listing cap)",
          "meaning": "Warn when (endTime - startTime) exceeds this many seconds. Tune higher if you routinely use long-lived orders on raw Seaport / other venues."
        }
      }
    },
    "installs": 1970,
    "rating": 4.7,
    "ratings": 46
  },
  {
    "slug": "update-leverage-cap-warn",
    "code": "PERP-001",
    "name_ko": "레버리지를 10배 초과로 설정할 시 경고",
    "name_en": "Setting Hyperliquid Leverage Above 10x",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"update-leverage-cap-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid 레버리지를 10배 넘게 설정합니다 — 작은 역방향 움직임에도 청산될 수 있으니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"ChangeLeverage\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.newLeverage.greaterThan(decimal(\"10.0\"))\n};",
    "manifest": {
      "id": "update-leverage-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "change_leverage"
          }
        }
      },
      "_template": {
        "maxLeverage": {
          "cedar_decimal": "10.0",
          "default": "10.0x",
          "meaning": "Warn when the leverage being SET exceeds this (Cedar decimal, .greaterThan comparison). Placeholder — tune to your risk posture."
        }
      }
    },
    "installs": 907,
    "rating": 4.4,
    "ratings": 13
  },
  {
    "slug": "order-leverage-high-warn",
    "code": "PERP-002",
    "name_ko": "레버리지가 10배를 초과하는 주문을 넣을 시 경고",
    "name_en": "Placing a Perp Order Above 10x Leverage",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-leverage-high-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓의 계정 레버리지가 10배를 넘습니다 — 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has leverage &&\n    context.leverage > 10\n};",
    "manifest": {
      "id": "order-leverage-high-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "maxLeverage": {
          "cedar_long": "10",
          "default": "10x",
          "meaning": "Warn when the host-enriched order-time effective leverage exceeds this. Long, direct > comparison. Placeholder — tune to your risk posture (conservative 3-5x, experienced 5-10x)."
        }
      }
    },
    "installs": 1438,
    "rating": 4.9,
    "ratings": 14
  },
  {
    "slug": "order-leverage-at-market-max-warn",
    "code": "PERP-003",
    "name_ko": "레버리지가 마켓 최대 등급에 도달한 주문일 시 경고",
    "name_en": "Perp Order at the Market's Maximum Leverage",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-leverage-at-market-max-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓의 레버리지가 마켓 최대 허용 등급에 도달했습니다 — 청산에 가장 민감한 설정이니 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has leverage &&\n    context has maxLeverage &&\n    context.leverage >= context.maxLeverage\n};",
    "manifest": {
      "id": "order-leverage-at-market-max-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      }
    },
    "installs": 997,
    "rating": 4.8,
    "ratings": 33
  },
  {
    "slug": "order-alt-leverage-warn",
    "code": "PERP-004",
    "name_ko": "알트 마켓을 5배 넘는 레버리지로 주문할 시 경고",
    "name_en": "Alt-Market Order Above 5x Leverage on HyperLiquid",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-alt-leverage-warn\")\n@severity(\"warn\")\n@reason(\"알트 마켓 Hyperliquid 포지션을 5배 넘는 레버리지로 엽니다 — 알트는 변동이 격해 설정한 알트 레버리지 한도에 걸렸으니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    !([\"BTC\", \"ETH\", \"SOL\"].contains(context.market.symbol)) &&\n    context has leverage &&\n    context.leverage > 5\n};",
    "manifest": {
      "id": "order-alt-leverage-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "majorsList": {
          "cedar_set": "[\"BTC\", \"ETH\", \"SOL\"]",
          "default": "BTC, ETH, SOL",
          "meaning": "Markets EXEMPT from the alt leverage cap (the global cap in order-leverage-high-warn still applies to them). Use HL universe names, case-sensitive (kPEPE not PEPE)."
        },
        "altMaxLeverage": {
          "cedar_long": "5",
          "default": "5x",
          "meaning": "Warn when effective leverage on a NON-majors market exceeds this. Placeholder — the classic two-tier desk rule (10x majors / 5x alts)."
        }
      }
    },
    "installs": 1633,
    "rating": 4.6,
    "ratings": 49
  },
  {
    "slug": "order-cross-margin-warn",
    "code": "PERP-005",
    "name_ko": "크로스 마진(cross) 마켓에 주문을 넣을 시 경고",
    "name_en": "Opening or Adding to a Cross-Margin Position on Hyperliquid",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-cross-margin-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓은 크로스 마진(cross)입니다 — 청산 시 계정 잔액 전체가 끌려갈 수 있으니 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has leverageType &&\n    context.leverageType == \"cross\"\n};",
    "manifest": {
      "id": "order-cross-margin-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      }
    },
    "installs": 319,
    "rating": 4.3,
    "ratings": 65
  },
  {
    "slug": "isolated-margin-remove-warn",
    "code": "PERP-006",
    "name_ko": "격리 마진을 빼낼 시 경고",
    "name_en": "Removing Isolated Margin From a Hyperliquid Position",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"isolated-margin-remove-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid에서 격리 마진(isolated margin)을 빼냅니다 — 레버리지가 올라가고 청산가가 가까워지니 마켓과 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"AdjustMargin\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.delta like \"-*\"\n};",
    "manifest": {
      "id": "isolated-margin-remove-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "adjust_margin"
          }
        }
      }
    },
    "installs": 1002,
    "rating": 4.8,
    "ratings": 8
  },
  {
    "slug": "order-notional-usd-cap-warn",
    "code": "PERP-007",
    "name_ko": "주문 명목가가 $10,000을 초과할 시 경고",
    "name_en": "HyperLiquid Order Notional Above USD Cap",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-notional-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 주문의 명목가가 $10,000을 넘습니다 — 나가기 전에 수량과 가격을 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has notionalUsd &&\n    context.notionalUsd > 10000\n};",
    "manifest": {
      "id": "order-notional-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "maxNotionalUsd": {
          "cedar_long": "10000",
          "default": "$10,000",
          "meaning": "Warn when the order's USD notional (size × mark price, host-computed integer USD) exceeds this. Placeholder — tune to your typical order size."
        }
      }
    },
    "installs": 1964,
    "rating": 4.7,
    "ratings": 90
  },
  {
    "slug": "order-symbol-not-allowlisted-warn",
    "code": "PERP-008",
    "name_ko": "허용 목록에 없는 마켓에 주문할 시 경고",
    "name_en": "Opening a Position on a Market Outside the Allowlist",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-symbol-not-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"허용 목록에 없는 Hyperliquid 마켓에서 포지션을 엽니다 — 낯설거나 유동성 낮은 마켓은 위험이 크니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    !([\"BTC\", \"ETH\", \"SOL\", \"HYPE\"].contains(context.market.symbol))\n};",
    "manifest": {
      "id": "order-symbol-not-allowlisted-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "marketAllowlist": {
          "cedar_set": "[\"BTC\", \"ETH\", \"SOL\", \"HYPE\"]",
          "default": "BTC, ETH, SOL, HYPE",
          "meaning": "Warn on any order whose market symbol is NOT in this set. Use HL UNIVERSE names, matched exactly (case-sensitive; memecoin perps are k-prefixed: kPEPE not PEPE). Placeholder majors — replace with the markets you actually trade (every market you use MUST be listed or ~every order warns)."
        }
      }
    },
    "installs": 2147,
    "rating": 4.8,
    "ratings": 23
  },
  {
    "slug": "order-illiquid-market-warn",
    "code": "PERP-009",
    "name_ko": "레버리지 등급이 낮은 마켓에 주문할 시 경고",
    "name_en": "Order on a Low-Leverage-Tier (Illiquid) HyperLiquid Market",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-illiquid-market-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓은 최대 레버리지 등급이 낮습니다(10배 이하) — 호가가 얇고 조작되기 쉽다는 HL의 신호이니 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has maxLeverage &&\n    context.maxLeverage <= 10\n};",
    "manifest": {
      "id": "order-illiquid-market-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "maxLeverageTierFloor": {
          "cedar_long": "10",
          "default": "10x tier",
          "meaning": "Warn when the market's HL max-leverage tier is at or below this (low tier = HL's own illiquidity signal). Placeholder — raise to 20 to also flag mid-caps, lower to 5 for only the thinnest books."
        }
      }
    },
    "installs": 1774,
    "rating": 4.9,
    "ratings": 30
  },
  {
    "slug": "order-no-new-short-warn",
    "code": "PERP-010",
    "name_ko": "숏 포지션을 열 시 경고",
    "name_en": "New Short Position While Long-Only Is Set",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-no-new-short-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid에서 숏 포지션을 엽니다 — 롱 전용(long-only) 설정에 걸렸으니 의도한 것인지 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context.side == \"short\"\n};",
    "manifest": {
      "id": "order-no-new-short-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      }
    },
    "installs": 1863,
    "rating": 4.5,
    "ratings": 59
  },
  {
    "slug": "order-position-stacking-warn",
    "code": "PERP-011",
    "name_ko": "이미 포지션이 있는 마켓에 주문을 더 쌓을 시 경고",
    "name_en": "Adding to an Existing Position on the Same HyperLiquid Market",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-position-stacking-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓에 이미 포지션이 있습니다 — 이 주문이 거기에 더 쌓으니(stacking) 의도한 것인지 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has hasOpenPosition &&\n    context.hasOpenPosition == true\n};",
    "manifest": {
      "id": "order-position-stacking-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      }
    },
    "installs": 1466,
    "rating": 4.8,
    "ratings": 62
  },
  {
    "slug": "order-adding-to-loser-warn",
    "code": "PERP-012",
    "name_ko": "손실 중인 HyperLiquid 포지션에 물타기할 시 경고",
    "name_en": "Adding to a Losing HyperLiquid Position",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-adding-to-loser-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 포지션이 20% 넘게 손실 중입니다 — 손실 포지션에 물타기를 하는 것이니 의도한 것인지 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has hasOpenPosition &&\n    context.hasOpenPosition == true &&\n    context has positionRoeBps &&\n    context.positionRoeBps < -2000\n};",
    "manifest": {
      "id": "order-adding-to-loser-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "maxLossBps": {
          "cedar_long": "-2000",
          "default": "-2000 bps (-20%)",
          "meaning": "Warn when adding to an existing position whose return-on-equity (signed bps) is below this. Placeholder — tune to your max-drawdown discipline."
        }
      }
    },
    "installs": 353,
    "rating": 4.8,
    "ratings": 49
  },
  {
    "slug": "order-margin-health-warn",
    "code": "PERP-013",
    "name_ko": "마진 사용률이 50%를 초과한 상태에서 주문할 시 경고",
    "name_en": "Placing a New Order While Margin Usage Already Exceeds 50%",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-margin-health-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid 계정 마진의 절반 이상을 이미 쓰고 있습니다 — 노출을 더 늘리기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has maxLeverage &&\n    context has marginUsedRatioBps &&\n    context.marginUsedRatioBps > 5000\n};",
    "manifest": {
      "id": "order-margin-health-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "maxMarginUsedBps": {
          "cedar_long": "5000",
          "default": "5000 bps (50%)",
          "meaning": "Warn when account-wide margin utilization (totalMarginUsed / accountValue, bps) exceeds this at order time. Placeholder — tune to your buffer comfort."
        }
      }
    },
    "installs": 605,
    "rating": 4.8,
    "ratings": 41
  },
  {
    "slug": "order-liquidation-proximity-warn",
    "code": "PERP-014",
    "name_ko": "청산가까지 10% 이내로 가까운 포지션에 리스크를 더할 시 경고",
    "name_en": "Adding Risk to a Position Near Its Liquidation Price",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-liquidation-proximity-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓의 포지션이 청산가까지 10% 미만입니다 — 여기서 리스크를 더하면 청산될 수 있으니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has liquidationDistanceBps &&\n    context.liquidationDistanceBps < 1000\n};",
    "manifest": {
      "id": "order-liquidation-proximity-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "minLiqDistanceBps": {
          "cedar_long": "1000",
          "default": "1000 bps (10%)",
          "meaning": "Warn when the existing position's liquidation price is closer than this (|markPx − liqPx| / markPx, bps) and the order adds risk. Placeholder — tune to your comfort buffer."
        }
      }
    },
    "installs": 1501,
    "rating": 4.7,
    "ratings": 87
  },
  {
    "slug": "order-max-drawdown-warn",
    "code": "PERP-015",
    "name_ko": "계정이 고점 대비 8% 넘게 빠진 상태에서 신규 주문을 넣을 시 경고",
    "name_en": "New Order While Account Is Down 8% From Its High-Water Mark",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-max-drawdown-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid 계정이 최고점(high-water mark) 대비 8% 아래입니다 — 리스크를 더하기 전에 확인하세요(트레일링 드로다운 서킷 브레이커)\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has custom &&\n    context.custom has peakDrawdownBps &&\n    context.custom.peakDrawdownBps >= 800\n};",
    "manifest": {
      "id": "order-max-drawdown-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "equity-drawdown",
          "method": "perp.equity_drawdown_bps",
          "params": {
            "chain_id": "$.root.chain_id"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "peakDrawdownBps",
              "type": "Long",
              "from": "$.result.peakDrawdownBps"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "peakDrawdownBps": "Long"
        }
      },
      "_template": {
        "maxPeakDrawdownBps": {
          "cedar_long": "800",
          "default": "800 bps (8% trailing)",
          "meaning": "Warn when account equity is down this many bps from its high-water mark at order time. Prop-firm trailing max-drawdown (Propr / Breakout 2-step) = 8%; static-rule variant = 600 bps (6%). Measured on EQUITY (unrealized PnL included) vs a server-persisted high-water mark. Placeholder — tune to your rulebook."
        }
      }
    },
    "installs": 283,
    "rating": 4.6,
    "ratings": 19
  },
  {
    "slug": "order-loss-streak-cooldown-warn",
    "code": "PERP-016",
    "name_ko": "연속 손실이 3번 이어진 뒤 주문을 넣을 시 경고",
    "name_en": "Cooldown After a Streak of Losing Trades",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-loss-streak-cooldown-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid에서 3연속 손실 거래입니다 — 다음 주문 전에 잠시 멈추세요(보복 매매 쿨다운)\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has custom &&\n    context.custom has lossStreak &&\n    context.custom.lossStreak >= 3\n};",
    "manifest": {
      "id": "order-loss-streak-cooldown-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "session-fill-stats",
          "method": "perp.session_fill_stats",
          "params": {
            "chain_id": "$.root.chain_id",
            "min_loss_usd": "1"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "lossStreak",
              "type": "Long",
              "from": "$.result.lossStreak"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "lossStreak": "Long"
        }
      },
      "_template": {
        "minLossStreak": {
          "cedar_long": "3",
          "default": "3 consecutive losing trades (range 3–5)",
          "meaning": "Warn when the account's most-recent run of consecutive losing closed trades TODAY reaches this. HEURISTIC placeholder (no rulebook number; the behavior — post-loss risk escalation / tilt — is evidence-backed, the cutoff is not). Lower = more cautious."
        },
        "minLossUsd": {
          "param": "min_loss_usd",
          "default": "1",
          "meaning": "Minimum realized loss (USD) for a closed trade to count toward the streak — sub-threshold scratch closes are invisible (neither extend nor reset the streak), and a win must clear +$min to reset. Per-policy via the policy_rpc `min_loss_usd` literal param (default $1)."
        }
      }
    },
    "installs": 1642,
    "rating": 4.7,
    "ratings": 68
  },
  {
    "slug": "order-overtrading-warn",
    "code": "PERP-017",
    "name_ko": "오늘 Hyperliquid 거래가 15건을 초과할 시 경고",
    "name_en": "Excessive Number of Trades on Hyperliquid in a Single Day",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-overtrading-warn\")\n@severity(\"warn\")\n@reason(\"오늘 Hyperliquid 거래가 15건을 넘습니다 — 과도한 매매가 아닌지 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has custom &&\n    context.custom has tradesToday &&\n    context.custom.tradesToday > 15\n};",
    "manifest": {
      "id": "order-overtrading-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "session-fill-stats",
          "method": "perp.session_fill_stats",
          "params": {
            "chain_id": "$.root.chain_id"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "tradesToday",
              "type": "Long",
              "from": "$.result.tradesToday"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "tradesToday": "Long"
        }
      },
      "_template": {
        "maxTradesToday": {
          "cedar_long": "15",
          "default": "15 trades/day",
          "meaning": "Warn when filled trades since today's session anchor exceed this. HEURISTIC placeholder (no rulebook number; trading frequency → worse returns is evidence-backed, the cutoff is not). Set to your own normal-day baseline."
        }
      }
    },
    "installs": 2043,
    "rating": 4.3,
    "ratings": 49
  },
  {
    "slug": "order-daily-loss-count-warn",
    "code": "PERP-018",
    "name_ko": "오늘 손실 거래가 5건에 도달한 뒤 새 주문을 낼 시 경고",
    "name_en": "New Order After Five Losing Trades Today",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-daily-loss-count-warn\")\n@severity(\"warn\")\n@reason(\"오늘 Hyperliquid에서 손실 거래가 5건입니다 — 리스크를 더하기 전에 확인하세요(일일 손실 횟수 서킷 브레이커)\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has custom &&\n    context.custom has lossesToday &&\n    context.custom.lossesToday >= 5\n};",
    "manifest": {
      "id": "order-daily-loss-count-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "session-fill-stats",
          "method": "perp.session_fill_stats",
          "params": {
            "chain_id": "$.root.chain_id",
            "min_loss_usd": "1"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "lossesToday",
              "type": "Long",
              "from": "$.result.lossesToday"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "lossesToday": "Long"
        }
      },
      "_template": {
        "minDailyLossCount": {
          "cedar_long": "5",
          "default": "5 losing trades/day",
          "meaning": "Warn when the account's count of losing closed trades today (UTC day-start) reaches this. HEURISTIC placeholder (no rulebook number; loss-frequency churning is evidence-backed, the cutoff is not). Set to your own baseline."
        },
        "minLossUsd": {
          "param": "min_loss_usd",
          "default": "1",
          "meaning": "Minimum realized loss (USD) for a closed trade to count toward lossesToday — sub-threshold scratch closes are ignored. Per-policy via the policy_rpc `min_loss_usd` literal param (default $1)."
        }
      }
    },
    "installs": 833,
    "rating": 4.7,
    "ratings": 89
  },
  {
    "slug": "order-daily-loss-limit-warn",
    "code": "PERP-019",
    "name_ko": "오늘 계정이 5% 넘게 손실 난 상태에서 신규 주문을 넣을 시 경고",
    "name_en": "New Order While Account Is Down 5% On the Day",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-daily-loss-limit-warn\")\n@severity(\"warn\")\n@reason(\"오늘 Hyperliquid 계정이 5% 손실입니다 — 리스크를 더하기 전에 확인하세요(일일 손실 서킷 브레이커)\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has custom &&\n    context.custom has dayDrawdownBps &&\n    context.custom.dayDrawdownBps >= 500\n};",
    "manifest": {
      "id": "order-daily-loss-limit-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "equity-drawdown",
          "method": "perp.equity_drawdown_bps",
          "params": {
            "chain_id": "$.root.chain_id"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "dayDrawdownBps",
              "type": "Long",
              "from": "$.result.dayDrawdownBps"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "dayDrawdownBps": "Long"
        }
      },
      "_template": {
        "maxDayDrawdownBps": {
          "cedar_long": "500",
          "default": "500 bps (5%)",
          "meaning": "Warn when account equity is down this many bps from today's baseline at order time. Prop-firm headline daily loss = 5%; strict (1-step / aggressive) = 300 bps (3%). Measured on EQUITY (unrealized PnL included) vs a server-persisted day-start baseline. Placeholder — tune to your rulebook."
        }
      }
    },
    "installs": 1573,
    "rating": 4.9,
    "ratings": 9
  },
  {
    "slug": "order-daily-realized-loss-warn",
    "code": "PERP-020",
    "name_ko": "오늘 실현 손실이 $500에 이른 뒤 새 주문을 낼 시 경고",
    "name_en": "New Order After Today's Realized Loss Hits $500",
    "category": "Perp",
    "severity": "warn",
    "cedar": "@id(\"order-daily-realized-loss-warn\")\n@severity(\"warn\")\n@reason(\"오늘 Hyperliquid 실현 손실이 $500입니다 — 리스크를 더하기 전에 확인하세요(일일 실현 손실 한도)\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has custom &&\n    context.custom has realizedPnlTodayUsd &&\n    context.custom.realizedPnlTodayUsd <= -500\n};",
    "manifest": {
      "id": "order-daily-realized-loss-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "session-fill-stats",
          "method": "perp.session_fill_stats",
          "params": {
            "chain_id": "$.root.chain_id"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "realizedPnlTodayUsd",
              "type": "Long",
              "from": "$.result.realizedPnlTodayUsd"
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "realizedPnlTodayUsd": "Long"
        }
      },
      "_template": {
        "maxDailyRealizedLossUsd": {
          "cedar_long": "-500",
          "default": "-500 ($500/day realized loss)",
          "meaning": "Warn when today's signed realized PnL (UTC day-start, whole USD) is at or below this — i.e. you've booked >= $500 in net realized losses. PLACEHOLDER personal budget, not a rulebook number; funding excluded (trade closedPnl only). Set to your own daily stop."
        }
      }
    },
    "installs": 730,
    "rating": 4.3,
    "ratings": 46
  },
  {
    "slug": "order-symbol-denylisted-deny",
    "code": "PERP-021",
    "name_ko": "차단 목록에 있는 마켓에 주문을 넣을 시 차단",
    "name_en": "HyperLiquid Order on a Denylisted Market",
    "category": "Perp",
    "severity": "deny",
    "cedar": "@id(\"order-symbol-denylisted-deny\")\n@severity(\"deny\")\n@reason(\"이 Hyperliquid 마켓이 차단 목록에 있어 정책에 따라 주문을 차단했습니다\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    [\"DOGE\", \"kPEPE\", \"kSHIB\"].contains(context.market.symbol)\n};",
    "manifest": {
      "id": "order-symbol-denylisted-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      },
      "_template": {
        "marketDenylist": {
          "cedar_set": "[\"DOGE\", \"kPEPE\", \"kSHIB\"]",
          "default": "DOGE, kPEPE, kSHIB",
          "meaning": "Block any order whose market symbol IS in this set. Use HL UNIVERSE names, matched exactly (case-sensitive): HL lists 1000-unit memecoin perps with a k prefix (kPEPE, kSHIB, kBONK — NOT PEPE/SHIB). Placeholder examples — replace with the markets you want banned."
        }
      }
    },
    "installs": 560,
    "rating": 4.4,
    "ratings": 66
  },
  {
    "slug": "order-reduce-only-lockdown-deny",
    "code": "PERP-022",
    "name_ko": "리듀스온리(reduce-only) 잠금 중 포지션을 늘리는 주문을 낼 시 차단",
    "name_en": "Reduce-Only Lockdown Blocking Position-Increasing Orders",
    "category": "Perp",
    "severity": "deny",
    "cedar": "@id(\"order-reduce-only-lockdown-deny\")\n@severity(\"deny\")\n@reason(\"리듀스온리(reduce-only) 잠금이 켜져 있어 포지션을 줄이는 주문만 허용됩니다 — 차단했습니다\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false\n};",
    "manifest": {
      "id": "order-reduce-only-lockdown-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "place_order"
          }
        }
      }
    },
    "installs": 1561,
    "rating": 4.6,
    "ratings": 37
  },
  {
    "slug": "deposit-on-behalf-other-staker-warn",
    "code": "RESTAKE-002",
    "name_ko": "리스테이킹 예치 지분이 내 지갑이 아닌 주소로 잡힐 시 차단",
    "name_en": "리스테이킹 예치 지분이 내 지갑이 아닌 주소로 잡힐 시 차단",
    "category": "Restaking",
    "severity": "deny",
    "cedar": "@id(\"deposit-on-behalf-other-staker-warn\")\n@severity(\"deny\")\n@reason(\"서명하는 예치(Deposit) 지분이 본인 지갑이 아닙니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Deposit\",\n    resource\n)\nwhen { context has staker && context.staker != context.meta.submitter };",
    "manifest": {
      "id": "deposit-on-behalf-other-staker-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "deposit"
          }
        }
      }
    },
    "installs": 2028,
    "rating": 4.9,
    "ratings": 84
  },
  {
    "slug": "deposit-strategy-not-allowlisted-warn",
    "code": "RESTAKE-003",
    "name_ko": "허용 목록에 없는 스트래티지로 리스테이크를 예치할 시 차단",
    "name_en": "허용 목록에 없는 스트래티지로 리스테이크를 예치할 시 차단",
    "category": "Restaking",
    "severity": "deny",
    "cedar": "@id(\"deposit-strategy-not-allowlisted-warn\")\n@severity(\"deny\")\n@reason(\"허용 목록에 없는 스트래티지로 예치합니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Deposit\",\n    resource\n)\nwhen\n{\n    !([\"0x0000000000000000000000000000000000000000\"].contains(context.strategy))\n};",
    "manifest": {
      "id": "deposit-strategy-not-allowlisted-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "deposit"
          }
        }
      }
    },
    "installs": 296,
    "rating": 4.4,
    "ratings": 52
  },
  {
    "slug": "restake-usd-cap-warn",
    "code": "RESTAKE-005",
    "name_ko": "리스테이크 예치 금액이 $50,000을 초과할 시 경고",
    "name_en": "Restaking Deposit Above USD Cap",
    "category": "Restaking",
    "severity": "warn",
    "cedar": "@id(\"restake-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"고액 리스테이크 예치입니다(약 $50,000 초과) — 예치 규모를 확인하세요\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Deposit\",\n    resource\n)\nwhen\n{\n    context has custom &&\n    context.custom has restakeUsd &&\n    context.custom.restakeUsd.greaterThan(decimal(\"50000.0000\"))\n};",
    "manifest": {
      "id": "restake-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "deposit"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "restake-usd",
          "method": "oracle.usd_value",
          "params": {
            "chain_id": "$.root.chain_id",
            "asset": "$.action.token.key.address",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "restakeUsd",
              "type": "Decimal",
              "from": "$.result.usd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "restakeUsd": "decimal"
        }
      }
    },
    "installs": 1844,
    "rating": 4.6,
    "ratings": 40
  },
  {
    "slug": "delegate-operator-not-allowlisted-deny",
    "code": "RESTAKE-007",
    "name_ko": "허용 목록에 없는 오퍼레이터에게 위임할 시 차단",
    "name_en": "허용 목록에 없는 오퍼레이터에게 위임할 시 차단",
    "category": "Restaking",
    "severity": "deny",
    "cedar": "@id(\"delegate-operator-not-allowlisted-deny\")\n@severity(\"deny\")\n@reason(\"허용 목록에 없는 오퍼레이터 주소입니다. 허용 목록을 확인해주세요\")\nforbid (\n    principal,\n    action == Restaking::Action::\"DelegateTo\",\n    resource\n)\nwhen\n{\n    !([\"0x0000000000000000000000000000000000000000\"].contains(context.operator))\n};",
    "manifest": {
      "id": "delegate-operator-not-allowlisted-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "delegate_to"
          }
        }
      }
    },
    "installs": 1444,
    "rating": 4.4,
    "ratings": 50
  },
  {
    "slug": "redelegate-new-operator-not-allowlisted-deny",
    "code": "RESTAKE-009",
    "name_ko": "허용 목록에 없는 오퍼레이터에게 재위임할 시 차단",
    "name_en": "허용 목록에 없는 오퍼레이터에게 재위임할 시 차단",
    "category": "Restaking",
    "severity": "deny",
    "cedar": "@id(\"redelegate-new-operator-not-allowlisted-deny\")\n@severity(\"deny\")\n@reason(\"허용 목록에 없는 새 오퍼레이터로 재위임하려 합니다 — 먼저 신뢰 목록에 추가해야 하므로 차단했습니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Redelegate\",\n    resource\n)\nwhen\n{\n    !([\"0x0000000000000000000000000000000000000000\"].contains\n         (\n             context.newOperator\n         ))\n};",
    "manifest": {
      "id": "redelegate-new-operator-not-allowlisted-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "redelegate"
          }
        }
      }
    },
    "installs": 426,
    "rating": 4.7,
    "ratings": 82
  },
  {
    "slug": "complete-withdrawal-receive-as-shares-warn",
    "code": "RESTAKE-013",
    "name_ko": "출금을 토큰이 아닌 지분으로 받을 시 경고",
    "name_en": "Completing a Restaking Withdrawal as Shares Instead of Tokens",
    "category": "Restaking",
    "severity": "warn",
    "cedar": "@id(\"complete-withdrawal-receive-as-shares-warn\")\n@severity(\"warn\")\n@reason(\"지금 출금은 지갑으로 토큰이 입금되는 출금이 아니라, 오퍼레이터에게 다시 예치·위임되는 출금입니다.\")\nforbid (\n    principal,\n    action == Restaking::Action::\"CompleteWithdrawal\",\n    resource\n)\nwhen { context has receiveAsTokens && context.receiveAsTokens == false };",
    "manifest": {
      "id": "complete-withdrawal-receive-as-shares-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "complete_withdrawal"
          }
        }
      }
    },
    "installs": 456,
    "rating": 4.6,
    "ratings": 82
  },
  {
    "slug": "register-as-operator-deny",
    "code": "RESTAKE-015",
    "name_ko": "EigenLayer 오퍼레이터로 등록할 시 경고",
    "name_en": "EigenLayer 오퍼레이터로 등록할 시 경고",
    "category": "Restaking",
    "severity": "warn",
    "cedar": "@id(\"register-as-operator-deny\")\n@severity(\"warn\")\n@reason(\"EigenLayer 오퍼레이터로 등록하려 합니다 — 패시브 리스테이커는 오퍼레이터가 되어선 안 되므로 차단했습니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"RegisterOperator\",\n    resource\n);",
    "manifest": {
      "id": "register-as-operator-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "register_operator"
          }
        }
      }
    },
    "installs": 1242,
    "rating": 4.5,
    "ratings": 18
  },
  {
    "slug": "aave-stake-recipient-self",
    "code": "STAKE-001",
    "name_ko": "Aave 스테이킹 지분을 본인이 아닌 주소로 받을 시 차단",
    "name_en": "Aave 스테이킹 지분을 본인이 아닌 주소로 받을 시 차단",
    "category": "Staking",
    "severity": "deny",
    "cedar": "@id(\"aave-stake-recipient-self\")\n@severity(\"deny\")\n@reason(\"Aave 스테이킹 지분이 본인 지갑이 아닌 주소로 발행됩니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    [\"aave_safety_module\",\n     \"aave_savings_gho\",\n     \"aave_umbrella_stake_token\"].contains\n        (\n            context.venue.name\n        ) &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
    "manifest": {
      "id": "aave-stake-recipient-self",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "stake"
          }
        }
      }
    },
    "installs": 983,
    "rating": 4.5,
    "ratings": 19
  },
  {
    "slug": "aave-stake-slashing-warn",
    "code": "STAKE-002",
    "name_ko": "Aave Safety Module에 원금 슬래싱을 감수하고 스테이킹할 시 경고",
    "name_en": "Staking into Aave's Slashing-Backed Safety Module",
    "category": "Staking",
    "severity": "warn",
    "cedar": "@id(\"aave-stake-slashing-warn\")\n@severity(\"warn\")\n@reason(\"이 스테이킹은 원금이 슬래싱 위험에 노출될 수 있습니다 — 감수할지 확인하세요\")\nforbid (\n    principal,\n    action == Staking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    [\"aave_safety_module\",\n     \"aave_umbrella_stake_token\"].contains\n        (\n            context.protocol.name\n        )\n};",
    "manifest": {
      "id": "aave-stake-slashing-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "stake"
          }
        }
      }
    },
    "installs": 227,
    "rating": 4.8,
    "ratings": 53
  },
  {
    "slug": "aave-cooldown-confirm-warn",
    "code": "STAKE-003",
    "name_ko": "Aave 언스테이킹 쿨다운 시 인출 기간을 확인하도록 경고",
    "name_en": "Aave 언스테이킹 쿨다운 시 인출 기간을 확인하도록 경고",
    "category": "Staking",
    "severity": "warn",
    "cedar": "@id(\"aave-cooldown-confirm-warn\")\n@severity(\"warn\")\n@reason(\"Aave 언스테이크 쿨다운을 시작합니다 — 이후 열리는 인출 기간 동안에만 회수(redeem) 할 수 있으니 확인하세요\")\nforbid(principal, action == Staking::Action::\"Cooldown\", resource)\nwhen {\n  [\"aave_safety_module\", \"aave_umbrella_stake_token\"].contains(context.venue.name)\n};",
    "manifest": {
      "id": "aave-cooldown-confirm-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "cooldown"
          }
        }
      }
    },
    "installs": 909,
    "rating": 4.8,
    "ratings": 45
  },
  {
    "slug": "aave-redeem-recipient-self",
    "code": "STAKE-004",
    "name_ko": "Aave 스테이킹 자산을 본인 지갑이 아닌 주소로 인출할 시 차단",
    "name_en": "Aave 스테이킹 자산을 본인 지갑이 아닌 주소로 인출할 시 차단",
    "category": "Staking",
    "severity": "deny",
    "cedar": "@id(\"aave-redeem-recipient-self\")\n@severity(\"deny\")\n@reason(\"이 Aave redeem 이 인출한 자산을 본인 지갑이 아닌 주소로 보냅니다 — 차단했습니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Redeem\",\n    resource\n)\nwhen\n{\n    [\"aave_safety_module\",\n     \"aave_savings_gho\",\n     \"aave_umbrella_stake_token\"].contains\n        (\n            context.venue.name\n        ) &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
    "manifest": {
      "id": "aave-redeem-recipient-self",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "redeem"
          }
        }
      }
    },
    "installs": 1833,
    "rating": 4.3,
    "ratings": 29
  },
  {
    "slug": "aave-redeem-full-balance-warn",
    "code": "STAKE-006",
    "name_ko": "Aave 스테이킹 자산을 전액 인출할 시 경고",
    "name_en": "Aave 스테이킹 자산을 전액 인출할 시 경고",
    "category": "Staking",
    "severity": "warn",
    "cedar": "@id(\"aave-redeem-full-balance-warn\")\n@severity(\"warn\")\n@reason(\"스테이킹 잔액 전부를 인출하는 것이 맞는지 한번 더 확인해주세요\")\nforbid(principal, action == Staking::Action::\"Redeem\", resource)\nwhen {\n  context.venue.name == \"aave_safety_module\"\n  && context.amount == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n};",
    "manifest": {
      "id": "aave-redeem-full-balance-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "redeem"
          }
        }
      }
    },
    "installs": 184,
    "rating": 4.8,
    "ratings": 90
  },
  {
    "slug": "aave-claim-rewards-recipient-self",
    "code": "STAKE-007",
    "name_ko": "Aave 스테이킹 보상 수령자가 본인이 아닐 시 차단",
    "name_en": "Aave 스테이킹 보상 수령자가 본인이 아닐 시 차단",
    "category": "Staking",
    "severity": "deny",
    "cedar": "@id(\"aave-claim-rewards-recipient-self\")\n@severity(\"deny\")\n@reason(\"Aave 보상 수령자가 본인 지갑이 아닙니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"ClaimRewards\",\n    resource\n)\nwhen\n{\n    ([\"aave_safety_module\",\n     \"aave_umbrella_rewards_controller\"].contains\n        (\n            context.protocol.name\n        ) &&\n    context has recipient &&\n    context.recipient != principal.address)\n    ||\n    (\n      context.protocol.name == \"aave_umbrella_rewards_controller\"\n      && context has onBehalfOf\n      && context.onBehalfOf != principal.address\n    )\n};",
    "manifest": {
      "id": "aave-claim-rewards-recipient-self",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "claim_rewards"
          }
        }
      }
    },
    "installs": 1406,
    "rating": 4.9,
    "ratings": 62
  },
  {
    "slug": "ethena-stake-recipient-self",
    "code": "STAKE-013",
    "name_ko": "Ethena USDe 지분(sUSDe) 수령자가 본인이 아닌 경우 차단",
    "name_en": "Ethena USDe 지분(sUSDe) 수령자가 본인이 아닌 경우 차단",
    "category": "Staking",
    "severity": "deny",
    "cedar": "@id(\"ethena-stake-recipient-self\")\n@severity(\"deny\")\n@reason(\"USDe 스테이킹 지분(sUSDe) 수령자가 내 지갑이 아닙니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    context.protcool.name == \"ethena_staked_usde\" &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
    "manifest": {
      "id": "ethena-stake-recipient-self",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "stake"
          }
        }
      }
    },
    "installs": 583,
    "rating": 4.8,
    "ratings": 9
  },
  {
    "slug": "ethena-redeem-recipient-self",
    "code": "STAKE-014",
    "name_ko": "sUSDe 인출 자금 수령자가 본인이 아닌 경우 차단",
    "name_en": "sUSDe 인출 자금 수령자가 본인이 아닌 경우 차단",
    "category": "Staking",
    "severity": "deny",
    "cedar": "@id(\"ethena-redeem-recipient-self\")\n@severity(\"deny\")\n@reason(\"이 sUSDe redeem 이 인출한 USDe를 본인 지갑이 아닌 주소로 보냅니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Redeem\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"ethena_staked_usde\" &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
    "manifest": {
      "id": "ethena-redeem-recipient-self",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "staking"
          },
          "action.tag": {
            "eq": "redeem"
          }
        }
      }
    },
    "installs": 2105,
    "rating": 4.3,
    "ratings": 61
  },
  {
    "slug": "approve-spender-reputation-deny",
    "code": "TOKEN-003",
    "name_ko": "악성으로 알려진 주소에 토큰 사용을 승인할 시 차단",
    "name_en": "Token Approval to a Known-Malicious Spender",
    "category": "Token",
    "severity": "deny",
    "cedar": "@id(\"approve-spender-reputation-deny\")\n@severity(\"deny\")\n@reason(\"악성으로 신고된 주소에 토큰 사용 권한을 넘기려 합니다 - 자금 탈취 위험이 있어 차단합니다\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has spenderFlagged\n  && context.custom.spenderFlagged == true\n};",
    "manifest": {
      "id": "approve-spender-reputation-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_approve"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "spender-rep",
          "method": "address.reputation",
          "params": {
            "chain_id": "$.root.chain_id",
            "address": "$.action.spender"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "spenderFlagged",
              "type": "Bool",
              "from": "$.result.flagged",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "spenderFlagged": "Bool"
        }
      }
    },
    "installs": 532,
    "rating": 4.3,
    "ratings": 28
  },
  {
    "slug": "approve-usd-cap-warn",
    "code": "TOKEN-004",
    "name_ko": "승인 금액이 한도를 초과할 시 경고",
    "name_en": "Token Approval Above USD Cap",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"approve-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"승인 금액이 한도를 넘습니다 - 승인 대상과 금액이 맞는지 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has approveUsd\n  && context.custom.approveUsd.greaterThan(decimal(\"10000.0000\"))\n};",
    "manifest": {
      "id": "approve-usd-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_approve"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "approve-usd",
          "method": "oracle.usd_value",
          "params": {
            "chain_id": "$.root.chain_id",
            "asset": "$.action.token",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "approveUsd",
              "type": "Decimal",
              "from": "$.result.usd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "approveUsd": "decimal"
        }
      }
    },
    "installs": 878,
    "rating": 4.3,
    "ratings": 44
  },
  {
    "slug": "daily-cumulative-approval-cap-warn",
    "code": "TOKEN-005",
    "name_ko": "하루 누적 활동이 한도를 넘은 경우 경고",
    "name_en": "New Approval After Daily Cumulative Cap",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"daily-cumulative-approval-cap-warn\")\n@severity(\"warn\")\n@reason(\"오늘 지갑에서 빠져나간 금액이 이미 한도를 넘었습니다 - 의도된 승인이 맞는지 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has windowOutflowUsd\n  && context.custom.windowOutflowUsd.greaterThan(decimal(\"10000.0000\"))\n};",
    "manifest": {
      "id": "daily-cumulative-approval-cap-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_approve"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "approval-window",
          "method": "stat_window.snapshot",
          "params": {
            "owner": "$.root.from"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "windowOutflowUsd",
              "type": "Decimal",
              "from": "$.result.windowOutflowUsd",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "windowOutflowUsd": "decimal"
        }
      }
    },
    "installs": 171,
    "rating": 4.8,
    "ratings": 77
  },
  {
    "slug": "permit2-sign-unlimited-warn",
    "code": "TOKEN-006",
    "name_ko": "무제한 Permit2 승인 서명 요청 시 경고",
    "name_en": "Unlimited Permit2 Allowance Signature",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"permit2-sign-unlimited-warn\")\n@severity(\"warn\")\n@reason(\"Permit2 허용량이 무제한으로 설정돼 있습니다 - 신뢰할 수 있는 대상인지 확인하세요\")\nforbid(principal, action == Token::Action::\"Permit2SignAllowance\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffff\"\n};",
    "manifest": {
      "id": "permit2-sign-unlimited-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "permit2_sign_allowance"
          }
        }
      }
    },
    "installs": 2114,
    "rating": 4.4,
    "ratings": 80
  },
  {
    "slug": "permit2-far-expiration-warn",
    "code": "TOKEN-007",
    "name_ko": "만료가 특정기간 이상 남은 Permit2 승인 요청 시 경고",
    "name_en": "Permit2 Allowance With Far-Future Expiration",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"permit2-far-expiration-warn\")\n@severity(\"warn\")\n@reason(\"Permit2 승인의 만료가 설정값을 초과합니다 - 만료 기간을 확인하세요\")\nforbid(principal, action == Token::Action::\"Permit2Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has nowTs\n  && context.expiresAt > context.custom.nowTs + 31536000\n};",
    "manifest": {
      "id": "permit2-far-expiration-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "permit2_approve"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "now",
          "method": "clock.now",
          "params": {},
          "outputs": [
            {
              "kind": "context",
              "field": "nowTs",
              "type": "Long",
              "from": "$.result.nowTs",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "nowTs": "Long"
        }
      }
    },
    "installs": 958,
    "rating": 4.3,
    "ratings": 74
  },
  {
    "slug": "transfer-recipient-sanctioned-deny",
    "code": "TOKEN-008",
    "name_ko": "제재 목록에 오른 주소로 토큰을 전송할 시 차단",
    "name_en": "Transfer to a Sanctioned Address",
    "category": "Token",
    "severity": "deny",
    "cedar": "@id(\"transfer-recipient-sanctioned-deny\")\n@severity(\"deny\")\n@reason(\"제재된 주소(OFAC·EU·UN) 토큰을 전송합니다 - 토큰 수령 주소를 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context has custom\n  && context.custom has sanctioned\n  && context.custom.sanctioned == true\n};",
    "manifest": {
      "id": "transfer-recipient-sanctioned-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_transfer"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "recipient-sanctions",
          "method": "address.sanctions",
          "params": {
            "address": "$.action.recipient"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "sanctioned",
              "type": "Bool",
              "from": "$.result.sanctioned",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "sanctioned": "Bool"
        }
      }
    },
    "installs": 771,
    "rating": 4.6,
    "ratings": 77
  },
  {
    "slug": "transfer-address-poisoning-warn",
    "code": "TOKEN-009",
    "name_ko": "거래 이력이 있는 주소와 닮은 위장 주소로 전송할 시 경고",
    "name_en": "Transfer to a Lookalike (Address-Poisoning) Recipient",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"transfer-address-poisoning-warn\")\n@severity(\"warn\")\n@reason(\"받는 주소가 예전에 쓰던 주소와 닮았지만 다른 주소입니다. 주소 오염일 수 있으니 꼼꼼히 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context has custom\n  && context.custom has poisonCollision\n  && context.custom.poisonCollision == true\n};",
    "manifest": {
      "id": "transfer-address-poisoning-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_transfer"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "recipient-similarity",
          "method": "address.similarity",
          "params": {
            "chain_id": "$.root.chain_id",
            "candidate": "$.action.recipient"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "poisonCollision",
              "type": "Bool",
              "from": "$.result.poisonCollision",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "poisonCollision": "Bool"
        }
      }
    },
    "installs": 1146,
    "rating": 4.4,
    "ratings": 62
  },
  {
    "slug": "transfer-fraction-of-holdings-warn",
    "code": "TOKEN-010",
    "name_ko": "보유량의 절반을 초과하는 토큰을 한 번에 전송할 시 경고",
    "name_en": "Transfer of Over Half Your Token Holdings",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"transfer-fraction-of-holdings-warn\")\n@severity(\"warn\")\n@reason(\"이 전송은 해당 토큰 보유량의 절반이 넘는 양을 옮깁니다 - 전송 수량을 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context has custom\n  && context.custom has holdingsBp\n  && context.custom.holdingsBp > 5000\n};",
    "manifest": {
      "id": "transfer-fraction-of-holdings-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_transfer"
          }
        }
      },
      "policy_rpc": [
        {
          "id": "holdings-fraction",
          "method": "portfolio.input_fraction_bps",
          "params": {
            "chain_id": "$.root.chain_id",
            "owner": "$.root.from",
            "asset": "$.action.token",
            "amount": "$.action.amount"
          },
          "outputs": [
            {
              "kind": "context",
              "field": "holdingsBp",
              "type": "Long",
              "from": "$.result.bps",
              "required": false
            }
          ],
          "optional": true
        }
      ],
      "custom_context": {
        "fields": {
          "holdingsBp": "Long"
        }
      }
    },
    "installs": 1836,
    "rating": 4.8,
    "ratings": 22
  },
  {
    "slug": "transfer-to-token-contract-warn",
    "code": "TOKEN-011",
    "name_ko": "토큰의 컨트랙트 주소로 해당 토큰을 전송할 시 경고",
    "name_en": "Transfer to the Token's Own Contract",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"transfer-to-token-contract-warn\")\n@severity(\"warn\")\n@reason(\"토큰 자체 컨트랙트로 토큰을 전솝합니다 - 보낸 토큰이 영영 묶일 수 있으니 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context.token.key has address\n  && context.recipient == context.token.key.address\n};",
    "manifest": {
      "id": "transfer-to-token-contract-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_transfer"
          }
        }
      }
    },
    "installs": 851,
    "rating": 4.4,
    "ratings": 37
  },
  {
    "slug": "swap-recipient-not-self-warn",
    "code": "AMM-001",
    "name_ko": "Swap으로 받을 자산이 제3자에게 갈 시 경고",
    "name_en": "Swap Output Destined for a Third-Party Address",
    "category": "DEX",
    "severity": "warn",
    "cedar": "@id(\"swap-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"Swap 후 토큰이 제3자에게 전송될 수 있습니다. 거래 설정이 맞는지 확인하세요.\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context.recipient != principal.address\n  && !([\n    \"0x0000000000000000000000000000000000000001\", // UR MSG_SENDER (= signer)\n    \"0x0000000000000000000000000000000000000002\"  // UR ADDRESS_THIS (= router, normal routing)\n  ].contains(context.recipient))\n};",
    "manifest": {
      "id": "swap-recipient-not-self-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "swap"
          }
        }
      }
    },
    "installs": 1013,
    "rating": 4.3,
    "ratings": 79
  },
  {
    "slug": "nft-set-approval-for-all-warn",
    "code": "NFT-001",
    "name_ko": "선별되지 않은 마켓플레이스 컨트랙트의 NFT 컬렉션 위임 요청 시 경고",
    "name_en": "Uncurated Marketplace Requesting NFT Collection Delegation",
    "category": "NFT",
    "severity": "warn",
    "cedar": "// Day-1 Safety — NFT 컬렉션 전체 승인(setApprovalForAll) 경고 (순수 Cedar).\n// 알려진 마켓플레이스 operator(OpenSea/Blur/LooksRare)는 allowlist 제외 — 그 밖 operator에게 grant(true) 할 때만 경고. operator = context.spender. revoke(false)는 통과.\n@id(\"nft-set-approval-for-all-warn\")\n@severity(\"warn\")\n@reason(\"잘 알려지지 않은 NFT 마켓플레이스로 NFT 권한이 위임됩니다. 신뢰할 수 있는 거래소인지 검토하세요.\")\nforbid(principal, action == Token::Action::\"NftSetApprovalForAll\", resource)\nwhen {\n  context.approved == true\n  && !([\n    \"0x1e0049783f008a0085193e00003d00cd54003c71\", // OpenSea Seaport conduit\n    \"0x00000000000111abe46ff893f3b2fdf1f759a8a8\", // Blur ExecutionDelegate\n    \"0x000000000060c4ca14cfc4325359062ace33fe3d\"  // LooksRare TransferManager\n  ].contains(context.spender))\n};",
    "manifest": {
      "id": "nft-set-approval-for-all-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "nft_set_approval_for_all"
          }
        }
      }
    },
    "installs": 1674,
    "rating": 4.8,
    "ratings": 20
  },
  {
    "slug": "unknown-blind-sign-warn",
    "code": "OTHER-001",
    "name_ko": "지원하지 않는 프로토콜의 서명 요청일 시 경고",
    "name_en": "Unsupported Protocol Signature Request",
    "category": "Others",
    "severity": "warn",
    "cedar": "@id(\"unknown-blind-sign-warn\")\n@severity(\"warn\")\n@reason(\"이 트랜잭션은 PASU의 해석 범위 밖에 있습니다. 안전한 프로토콜인지 서명 전 검토하세요.\")\nforbid(principal, action == Core::Action::\"Unknown\", resource);",
    "manifest": {
      "id": "unknown-blind-sign-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.domain": {
            "eq": "unknown"
          }
        }
      }
    },
    "installs": 209,
    "rating": 4.9,
    "ratings": 45
  },
  {
    "slug": "unlimited-approval-warn",
    "code": "TOKEN-001",
    "name_ko": "승인되지 않은 컨트랙트의 토큰 무제한 승인 요청 시 경고",
    "name_en": "Maximum Token Approval Requested by Unauthorized Contract",
    "category": "Token",
    "severity": "warn",
    "cedar": "@id(\"unlimited-approval-warn\")\n@severity(\"warn\")\n@reason(\"허용되지 않은 컨트랙트에 무제한 승인을 합니다 - 신뢰 가능한 토큰 사용자인지 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n  && !([\n    \"0x000000000022d473030f116ddee9f6b43ac78ba3\", // Permit2\n    \"0x7a250d5630b4cf539739df2c5dacb4c659f2488d\", // Uniswap V2 Router02\n    \"0xe592427a0aece92de3edee1f18e0157c05861564\", // Uniswap V3 SwapRouter\n    \"0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45\", // Uniswap V3 SwapRouter02\n    \"0x66a9893cc07d91d95644aedd05d03f95e1dba8af\", // Uniswap Universal Router\n    \"0x1111111254eeb25477b68fb85ed929f73a960582\", // 1inch Aggregation Router V5\n    \"0x111111125421ca6dc452d289314280a0f8842a65\", // 1inch Aggregation Router V6\n    \"0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2\", // Aave V3 Pool\n    \"0xc92e8bdf79f0507f65a392b0ab4667716bfe0110\"  // CoW Protocol GPv2VaultRelayer\n  ].contains(context.spender))\n};",
    "manifest": {
      "id": "unlimited-approval-warn",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_approve"
          }
        }
      }
    },
    "installs": 1578,
    "rating": 4.3,
    "ratings": 74
  },
  {
    "slug": "send-burn-recipient-deny",
    "code": "TOKEN-002",
    "name_ko": "토큰이 소각 주소로 전송되는 경우 차단",
    "name_en": "Swap Output Destined for a Third-Party Address",
    "category": "Token",
    "severity": "deny",
    "cedar": "@id(\"send-burn-recipient-deny\")\n@severity(\"deny\")\n@reason(\"소각 주소로 자산이 전송됩니다 - 수신자가 정확한지 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  [\"0x0000000000000000000000000000000000000000\",\n   \"0x000000000000000000000000000000000000dead\"].contains(context.recipient)\n};",
    "manifest": {
      "id": "send-burn-recipient-deny",
      "schema_version": 2,
      "trigger": {
        "where": {
          "action.tag": {
            "eq": "erc20_transfer"
          }
        }
      }
    },
    "installs": 2095,
    "rating": 4.7,
    "ratings": 51
  }
];

const PACKAGES: SeedPkg[] = [
  {
    "slug": "airdrop",
    "name_ko": "[Airdrop] 클레임 피싱 차단",
    "name_en": "[Airdrop] Claim Phishing Shield",
    "description_ko": "안전한 에어드롭 클레임을 위한 패키지",
    "category": "Airdrop",
    "members": [
      {
        "slug": "unlimited-approval-warn",
        "display_name": "승인되지 않은 컨트랙트의 토큰 무제한 승인 요청 시 경고",
        "cedar_text": "@id(\"unlimited-approval-warn\")\n@severity(\"warn\")\n@reason(\"허용되지 않은 컨트랙트에 무제한 승인을 합니다 - 신뢰 가능한 토큰 사용자인지 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n  && !([\n    \"0x000000000022d473030f116ddee9f6b43ac78ba3\", // Permit2\n    \"0x7a250d5630b4cf539739df2c5dacb4c659f2488d\", // Uniswap V2 Router02\n    \"0xe592427a0aece92de3edee1f18e0157c05861564\", // Uniswap V3 SwapRouter\n    \"0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45\", // Uniswap V3 SwapRouter02\n    \"0x66a9893cc07d91d95644aedd05d03f95e1dba8af\", // Uniswap Universal Router\n    \"0x1111111254eeb25477b68fb85ed929f73a960582\", // 1inch Aggregation Router V5\n    \"0x111111125421ca6dc452d289314280a0f8842a65\", // 1inch Aggregation Router V6\n    \"0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2\", // Aave V3 Pool\n    \"0xc92e8bdf79f0507f65a392b0ab4667716bfe0110\"  // CoW Protocol GPv2VaultRelayer\n  ].contains(context.spender))\n};",
        "manifest": {
          "id": "unlimited-approval-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_approve"
              }
            }
          }
        }
      },
      {
        "slug": "approve-spender-reputation-deny",
        "display_name": "악성으로 알려진 주소에 토큰 사용을 승인할 시 차단",
        "cedar_text": "@id(\"approve-spender-reputation-deny\")\n@severity(\"deny\")\n@reason(\"악성으로 신고된 주소에 토큰 사용 권한을 넘기려 합니다 - 자금 탈취 위험이 있어 차단합니다\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has spenderFlagged\n  && context.custom.spenderFlagged == true\n};",
        "manifest": {
          "id": "approve-spender-reputation-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_approve"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "spender-rep",
              "method": "address.reputation",
              "params": {
                "chain_id": "$.root.chain_id",
                "address": "$.action.spender"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "spenderFlagged",
                  "type": "Bool",
                  "from": "$.result.flagged",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "spenderFlagged": "Bool"
            }
          }
        }
      },
      {
        "slug": "permit2-sign-unlimited-warn",
        "display_name": "무제한 Permit2 승인 서명 요청 시 경고",
        "cedar_text": "@id(\"permit2-sign-unlimited-warn\")\n@severity(\"warn\")\n@reason(\"Permit2 허용량이 무제한으로 설정돼 있습니다 - 신뢰할 수 있는 대상인지 확인하세요\")\nforbid(principal, action == Token::Action::\"Permit2SignAllowance\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffff\"\n};",
        "manifest": {
          "id": "permit2-sign-unlimited-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "permit2_sign_allowance"
              }
            }
          }
        }
      },
      {
        "slug": "claim-recipient-not-allowlisted-warn",
        "display_name": "클레임 시 수령 주소가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
        "cedar_text": "@id(\"claim-recipient-not-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"클레임 보상을 등록되지 않은 주소로 보냅니다 — 수령 주소를 확인하세요\")\nforbid (\n    principal,\n    action == Airdrop::Action::\"Claim\",\n    resource\n)\nwhen\n{\n    context.recipient != principal.address &&\n      !([\n          \"0x1111111111111111111111111111111111111111\"\n      ].contains(context.recipient))\n};",
        "manifest": {
          "id": "claim-recipient-not-allowlisted-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "airdrop"
              },
              "action.tag": {
                "eq": "claim"
              }
            }
          },
          "_template": {
            "recipientAllowlist": {
              "cedar_set": "[\"0x1111111111111111111111111111111111111111\"]",
              "default": "0x1111111111111111111111111111111111111111",
              "meaning": "Claim recipients you approve in ADDITION to the signing wallet itself (your cold/secondary wallets). MUST be lowercase 0x-hex — the engine lowercases decoded addresses, so a checksummed entry never matches (silent dead no-op). The default is a placeholder example — replace it with your own addresses."
            }
          }
        }
      },
      {
        "slug": "claim-donation-amount-cap-warn",
        "display_name": "클레임 시  결제 금액이 한도를 넘을 경우 경고",
        "cedar_text": "@id(\"claim-donation-amount-cap-warn\")\n@severity(\"warn\")\n@reason(\"클레임 시 결제 금액이 설정 한도를 넘습니다 — 결제 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Airdrop::Action::\"Claim\",\n    resource\n)\nwhen\n{\n    context has donation &&\n    context.donation has amountNano &&\n    context.donation.amountNano > 1000000000000\n};",
        "manifest": {
          "id": "claim-donation-amount-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "airdrop"
              },
              "action.tag": {
                "eq": "claim"
              }
            }
          },
          "_template": {
            "donationCapNano": {
              "cedar_literal": "1000000000000",
              "default": "1000000000000",
              "meaning": "Maximum donation/fee you'll pay to claim, in token-native nano (1 token unit = 1e9 nano). For a stablecoin donation (USDC/USDT) nano ≈ USD, so 1000000000000 = $1,000; for a native-currency donation 1e9 nano = 1 native token. Tune to your own ceiling. The donation amount is the non-refundable payment a pay-to-claim distributor (e.g. LayerZero donateAndClaim) charges — this caps fat-finger and frontend-inflated over-payments. Dormant when the claim charges no donation or the donation token's decimals can't be resolved."
            }
          }
        }
      }
    ],
    "installs": 1743,
    "rating": 4.6,
    "ratings": 49
  },
  {
    "slug": "bridge-destination-and-execution-safety",
    "name_ko": "[Bridge] 도착 체인 안전 가드",
    "name_en": "[Bridge] Destination & Execution Safety",
    "description_ko": "자산이 의도치 않은 체인으로 가거나 도착 후 위험한 코드가 실행되는 것을 막는 패키지",
    "category": "Bridge",
    "members": [
      {
        "slug": "bridge-recipient-raw-nonevm-warn",
        "display_name": "EVM이 아닌 체인으로 브리지할 시 경고",
        "cedar_text": "@id(\"bridge-recipient-raw-nonevm-warn\")\n@severity(\"warn\")\n@reason(\"EVM이 아닌 주소로 보냅니다 — EVM 체인만 사용하신다면 다시 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen { context.dstRecipient.kind != \"evm\" };",
        "manifest": {
          "id": "bridge-recipient-raw-nonevm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          }
        }
      },
      {
        "slug": "bridge-dst-chain-not-allowlisted-deny",
        "display_name": "허용되지 않은 체인으로 브리지할 시 차단",
        "cedar_text": "@id(\"bridge-dst-chain-not-allowlisted-deny\")\n@severity(\"deny\")\n@reason(\"허용한 도착 체인 목록에 없는 체인으로 보내려 합니다 — 도착 체인을 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    !([\"eip155:1\",\n      \"eip155:10\",\n      \"eip155:56\",\n      \"eip155:130\",\n      \"eip155:137\",\n      \"eip155:8453\",\n      \"eip155:42161\",\n      \"eip155:59144\",\n      \"eip155:999\",\n      \"eip155:43114\"].contains\n         (\n             context.dstChainId\n         ))\n};",
        "manifest": {
          "id": "bridge-dst-chain-not-allowlisted-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          },
          "_template": {
            "allowedDstChains": {
              "cedar_set": "[\"eip155:1\", \"eip155:10\", \"eip155:56\", \"eip155:130\", \"eip155:137\", \"eip155:8453\", \"eip155:42161\", \"eip155:59144\", \"eip155:999\", \"eip155:43114\"]",
              "default": "Ethereum, Optimism, BNB, Unichain, Polygon, Base, Arbitrum, Linea, HyperEVM, Avalanche — the usage-calibrated set covering ~97-99% of real Across + Li.Fi EVM destinations (Dune q7686050 / q7686070)",
              "meaning": "CAIP-2 destination chains the user expects to bridge to; bridging to any chain NOT in this set denys. NOTE: Li.Fi non-EVM destinations (Solana, ~23% of Li.Fi traffic) arrive as Raw{bytes32} and DENY by default here — intended (also caught by bridge-recipient-raw-nonevm-deny). Across also supports zkSync(324)/Scroll(534352)/Blast(81457) — add them if you use those routes. Narrow to lock down (e.g. only Base + Arbitrum)."
            }
          }
        }
      },
      {
        "slug": "bridge-message-attached-warn",
        "display_name": "Callback이 포함된 브리지일 시 경고",
        "cedar_text": "@id(\"bridge-message-attached-warn\")\n@severity(\"warn\")\n@reason(\"도착 체인에서 실행될 메시지가 함께 담겼습니다 — 자산 도착 후 임의 호출이 실행되니 내용을 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen { context.hasMessage == true };",
        "manifest": {
          "id": "bridge-message-attached-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          }
        }
      }
    ],
    "installs": 1654,
    "rating": 4.8,
    "ratings": 40
  },
  {
    "slug": "bridge-recipient-safety",
    "name_ko": "[Bridge] 도착 주소 관리",
    "name_en": "[Bridge] Recipient Safety",
    "description_ko": "자금이 잘못된 도착 주소로 가는 사고를 막는 패키지",
    "category": "Bridge",
    "members": [
      {
        "slug": "bridge-recipient-not-self-warn",
        "display_name": "브리지 수령처가 본인 지갑이 아닐 시 경고",
        "cedar_text": "@id(\"bridge-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"도착 체인에서 자산을 받는 주소가 본인 지갑이 아닙니다 — 받는 주소가 맞는지 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context.dstRecipient.kind == \"evm\" &&\n    context.dstRecipient has address &&\n    context.dstRecipient.address != principal.address\n};",
        "manifest": {
          "id": "bridge-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          }
        }
      },
      {
        "slug": "bridge-recipient-denylist-deny",
        "display_name": "브리지 수령처가 블랙리스트 주소일 시 차단",
        "cedar_text": "@id(\"bridge-recipient-denylist-deny\")\n@severity(\"deny\")\n@reason(\"도착 체인의 블랙리스트 주소로 자산이 전달됩니다 — 수령 주소를 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context.dstRecipient.kind == \"evm\" &&\n    context.dstRecipient has address &&\n    [\"0x0000000000000000000000000000000000000000\",\n     \"0x000000000000000000000000000000000000dead\"].contains\n        (\n            context.dstRecipient.address\n        )\n};",
        "manifest": {
          "id": "bridge-recipient-denylist-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          },
          "_template": {
            "burnAddresses": {
              "cedar_set": "[\"0x0000000000000000000000000000000000000000\", \"0x000000000000000000000000000000000000dead\"]",
              "default": "zero + 0x…dead",
              "meaning": "destination recipients whose delivered funds are permanently unspendable. Unlike a Lido withdrawal `owner` (where 0x0 normalizes to msg.sender), a bridge `dstRecipient` of 0x0 means funds are delivered to the zero address on the destination chain = lost, so 0x0 IS a burn here."
            }
          }
        }
      },
      {
        "slug": "bridge-recipient-raw-nonevm-warn",
        "display_name": "EVM이 아닌 체인으로 브리지할 시 경고",
        "cedar_text": "@id(\"bridge-recipient-raw-nonevm-warn\")\n@severity(\"warn\")\n@reason(\"EVM이 아닌 주소로 보냅니다 — EVM 체인만 사용하신다면 다시 확인하세요.\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen { context.dstRecipient.kind != \"evm\" };",
        "manifest": {
          "id": "bridge-recipient-raw-nonevm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          }
        }
      }
    ],
    "installs": 1328,
    "rating": 4.4,
    "ratings": 34
  },
  {
    "slug": "bridge-value-and-venue-control",
    "name_ko": "[Bridge] 금액 및 경로 관리",
    "name_en": "[Bridge] Value & Venue Control",
    "description_ko": "브릿지 과정 중 자산 손실을 방지하는 패키지",
    "category": "Bridge",
    "members": [
      {
        "slug": "bridge-input-usd-cap-warn",
        "display_name": "브리지 금액이 USD 한도를 초과할 시 경고",
        "cedar_text": "@id(\"bridge-input-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"한 번의 브리지로 설정한 USD 한도를 넘는 금액을 옮깁니다 — 정확한 액수가 맞는지 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context has custom &&\n    context.custom has bridgeInputUsd &&\n    context.custom.bridgeInputUsd.greaterThan(decimal(\"100000.0000\"))\n};",
        "manifest": {
          "id": "bridge-input-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "bridge-in-usd",
              "method": "oracle.usd_value",
              "params": {
                "chain_id": "$.root.chain_id",
                "asset": "$.action.srcToken.key.address",
                "amount": "$.action.inputAmount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "bridgeInputUsd",
                  "type": "Decimal",
                  "from": "$.result.usd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "bridgeInputUsd": "decimal"
            }
          },
          "_template": {
            "maxBridgeUsd": {
              "cedar_decimal": "100000.0000",
              "default": "100000.0000 (USD)",
              "meaning": "warn when a single bridge moves more than this USD value (oracle.usd_value of srcToken × inputAmount). Default $100k flags only ~0.3% of Across / ~0.9% of Li.Fi deposits (Dune q7686050 / q7686070) — the clean whale/outlier tail. Dynamic: requires login + synced prices, otherwise dormant (fail-open)."
            },
            "_note_selectors": "params `$.action.*` resolve against the LOWERED Cedar context (camelCase): srcToken.key.address + inputAmount, NOT the snake_case ActionBody."
          }
        }
      },
      {
        "slug": "bridge-output-value-loss-warn",
        "display_name": "브리지 손실이 한도를 초과할 시 경고",
        "cedar_text": "@id(\"bridge-output-value-loss-warn\")\n@severity(\"warn\")\n@reason(\"보내는 자산에 비해 도착 체인에서 받는 자산이 크게 적습니다 — 손실이 설정 한도를 넘으니 도착 체인에서 받을 토큰과 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    context has custom &&\n    context.custom has bridgeValueLossPct &&\n    context.custom.bridgeValueLossPct.greaterThan(decimal(\"5.0000\"))\n};",
        "manifest": {
          "id": "bridge-output-value-loss-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "bridge-value-loss",
              "method": "bridge.value_loss_pct",
              "params": {
                "src_chain_id": "$.root.chain_id",
                "src_asset": "$.action.srcToken.key.address",
                "input_amount": "$.action.inputAmount",
                "dst_chain_id": "$.action.dstChainId",
                "dst_asset": "$.action.dstToken.key.address",
                "output_amount": "$.action.outputAmount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "bridgeValueLossPct",
                  "type": "Decimal",
                  "from": "$.result.loss_pct",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "bridgeValueLossPct": "decimal"
            }
          },
          "_template": {
            "maxValueLossPct": {
              "cedar_decimal": "5.0000",
              "default": "5.0000 (%)",
              "meaning": "warn when a bridge's implied value loss ((inputUsd - outputUsd) / inputUsd * 100, computed by bridge.value_loss_pct) exceeds this %. Normal bridge fees ~0.1-1% (cross-token swap ~1-3%) pass; an abnormal skim (a frontend that sets outputAmount absurdly low) is flagged. CONSERVATIVE default — NOT yet Dune-calibrated (TODO: measure the same-stablecoin Across (inputAmount-outputAmount)/inputAmount p99). Dynamic: the method bridge.value_loss_pct IS served server-side (handler.rs); requires login + BOTH token prices synced + dstToken/outputAmount statically known, otherwise dormant (fail-open)."
            },
            "_note_selectors": "params `$.action.*` resolve against the LOWERED Cedar context (camelCase): srcToken.key.address / inputAmount / dstChainId / dstToken.key.address / outputAmount — NOT the snake_case ActionBody. dstToken/outputAmount are OPTIONAL (absent on some routes that do not statically expose the output) → selector miss → call skipped → dormant."
          }
        }
      },
      {
        "slug": "bridge-protocol-not-allowlisted-warn",
        "display_name": "허용되지 않은 프로토콜을 사용해 브리지할 시 경고",
        "cedar_text": "@id(\"bridge-protocol-not-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"허용한 브리지 목록에 없는 프로토콜을 사용합니다 — 해당 프로토콜을 선택한게 맞는지 확인하세요\")\nforbid (\n    principal,\n    action == Bridge::Action::\"Send\",\n    resource\n)\nwhen\n{\n    !([\"across_spoke_pool\", \"lifi_diamond\"].contains(context.protocol.name))\n};",
        "manifest": {
          "id": "bridge-protocol-not-allowlisted-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "bridge"
              },
              "action.tag": {
                "eq": "send"
              }
            }
          },
          "_template": {
            "allowedProtocols": {
              "cedar_set": "[\"across_spoke_pool\", \"lifi_diamond\"]",
              "default": "across_spoke_pool + lifi_diamond (both supported protocols → dormant by default)",
              "meaning": "bridge protocols the user trusts. With both allowed this never fires. Narrow to e.g. [\"across_spoke_pool\"] to warn on the Li.Fi aggregator route."
            }
          }
        }
      }
    ],
    "installs": 1263,
    "rating": 4.7,
    "ratings": 29
  },
  {
    "slug": "dex-anti-mev-shield",
    "name_ko": "[DEX] 예상보다 큰 거래 비용 보호",
    "name_en": "[DEX] Anti-MEV Shield",
    "description_ko": "큰 금액을 스왑하는 일이 잦은 트레이더를 위한",
    "category": "DEX",
    "members": [
      {
        "slug": "swap-min-out-zero",
        "display_name": "판매할 토큰의 수량을 정하는 Swap(Exact-Input)에서, 수령할 토큰의 수량을 정하지 않았을 시 경고",
        "cedar_text": "@id(\"swap-min-out-zero\")\n@severity(\"warn\")\n@reason(\"이 Swap으로 받을 토큰의 최소 수량이 지정되어 있지 않습니다. MEV를 당하지 않게 값을 지정하세요.\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context.direction.kind == \"exact_input\"\n  && context.direction has minAmountOut\n  && context.direction.minAmountOut == \"0x0\"\n};",
        "manifest": {
          "id": "swap-min-out-zero",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          }
        }
      },
      {
        "slug": "swap-usd-cap-warn",
        "display_name": "스왑 금액이 $25,000을 초과할 시 경고",
        "cedar_text": "@id(\"swap-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"고액 스왑입니다(명목가 약 $25,000 초과) — 규모를 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has swapUsd\n  && context.custom.swapUsd.greaterThan(decimal(\"25000.0000\"))\n};",
        "manifest": {
          "id": "swap-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "swap-in-usd",
              "method": "oracle.usd_value",
              "params": {
                "chain_id": "$.root.chain_id",
                "asset": "$.action.tokenIn",
                "amount": "$.action.direction.amountIn"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "swapUsd",
                  "type": "Decimal",
                  "from": "$.result.usd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "swapUsd": "decimal"
            }
          }
        }
      },
      {
        "slug": "swap-fraction-of-holdings-warn",
        "display_name": "보유한 토큰의 절반을 초과해 스왑할 시 경고",
        "cedar_text": "@id(\"swap-fraction-of-holdings-warn\")\n@severity(\"warn\")\n@reason(\"이 스왑이 보유한 입력 토큰의 절반 넘게 팝니다 — 진행 전에 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has holdingsBp\n  && context.custom.holdingsBp > 5000\n};",
        "manifest": {
          "id": "swap-fraction-of-holdings-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "in-holdings-fraction",
              "method": "portfolio.input_fraction_bps",
              "params": {
                "chain_id": "$.root.chain_id",
                "owner": "$.root.from",
                "asset": "$.action.tokenIn",
                "amount": "$.action.direction.amountIn"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "holdingsBp",
                  "type": "Long",
                  "from": "$.result.bps",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "holdingsBp": "Long"
            }
          }
        }
      },
      {
        "slug": "swap-price-impact-cap-warn",
        "display_name": "스왑이 풀 가격을 5% 넘게 움직일 시 경고",
        "cedar_text": "@id(\"swap-price-impact-cap-warn\")\n@severity(\"warn\")\n@reason(\"이 스왑이 풀 가격을 5% 넘게 움직입니다 — 호가가 얇은 마켓에서 비싸게 사는 것일 수 있습니다\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen { context.priceImpactBp > 500 };",
        "manifest": {
          "id": "swap-price-impact-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          }
        }
      },
      {
        "slug": "swap-venue-reputation-deny",
        "display_name": "악성으로 분류된 라우터를 통해 스왑할 시 차단",
        "cedar_text": "@id(\"swap-venue-reputation-deny\")\n@severity(\"deny\")\n@reason(\"이 스왑이 가짜·악성 어그리게이터로 분류된 라우터를 경유해 차단했습니다\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has reputationFlagged\n  && context.custom.reputationFlagged == true\n};",
        "manifest": {
          "id": "swap-venue-reputation-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "venue-rep",
              "method": "address.reputation",
              "params": {
                "chain_id": "$.root.chain_id",
                "address": "$.action.venue.router"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "reputationFlagged",
                  "type": "Bool",
                  "from": "$.result.flagged",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "reputationFlagged": "Bool"
            }
          }
        }
      }
    ],
    "installs": 691,
    "rating": 4.7,
    "ratings": 17
  },
  {
    "slug": "dex-liquidity-provider-shield",
    "name_ko": "[DEX] 유동성 공급(LP) 기본 보호",
    "name_en": "[DEX] Liquidity Provider Shield",
    "description_ko": "풀에 유동성을 안전하게 공급하고 싶은 분들을 위한 패키지",
    "category": "DEX",
    "members": [
      {
        "slug": "ammlp-add-recipient-not-self-warn",
        "display_name": "유동성 풀(LP)에 유동성을 공급할 때, LP Token 또는 포지션 NFT가 제3자에게 갈 시 경고",
        "cedar_text": "@id(\"ammlp-add-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"이 유동성 공급은 다른 주소로 LP Token을 전송합니다. 수취인이 바르게 설정되었는지 거래를 검토하세요.\")\nforbid(principal, action == Amm::Action::\"AddLiquidity\", resource)\nwhen { \n    context.params has recipient \n    && context.params.recipient != principal.address \n};",
        "manifest": {
          "id": "ammlp-add-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "add_liquidity"
              }
            }
          }
        }
      },
      {
        "slug": "ammlp-remove-recipient-not-self-warn",
        "display_name": "유동성 풀(LP)에서 유동성을 회수할 때, 회수한 토큰이 제3자에게 갈 시 경고",
        "cedar_text": "@id(\"ammlp-remove-recipient-not-self-warn\")\n@severity(\"deny\")\n@reason(\"회수한 유동성이 다른 지갑으로 전송됩니다. 수취인이 바르게 설정되었는지 거래를 검토하세요.\")\nforbid(principal, action == Amm::Action::\"RemoveLiquidity\", resource)\nwhen {\n  context.params has recipient\n  && context.params.recipient != principal.address\n};",
        "manifest": {
          "id": "ammlp-remove-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "remove_liquidity"
              }
            }
          }
        }
      },
      {
        "slug": "ammlp-collect-recipient-not-self-warn",
        "display_name": "LP 수수료가 제3자에게 갈 시 경고",
        "cedar_text": "@id(\"ammlp-collect-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"유동성 수수료를 받을 주소가 내 지갑이 아닙니다. 수수료가 다른 주소로 빠져나갈 수 있으니 트랜잭션을 검토하세요.\")\nforbid(principal, action == Amm::Action::\"CollectFees\", resource)\nwhen { \n    context.recipient != principal.address \n};",
        "manifest": {
          "id": "ammlp-collect-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "collect_fees"
              }
            }
          }
        }
      },
      {
        "slug": "addliquidity-low-liquidity-warn",
        "display_name": "거래량이 적은 풀에 유동성을 공급할 시 경고",
        "cedar_text": "@id(\"addliquidity-low-liquidity-warn\")\n@severity(\"warn\")\n@reason(\"이 풀은 24시간 거래량이 매우 적습니다 — LP를 빠져나오기 어렵고 share-inflation·비영구적 손실(IL)에 노출될 수 있습니다\")\nforbid(principal, action == Amm::Action::\"AddLiquidity\", resource)\nwhen {\n  context has custom\n  && context.custom has poolVol24hUsd\n  && context.custom.poolVol24hUsd.lessThan(decimal(\"10000.0000\"))\n};",
        "manifest": {
          "id": "addliquidity-low-liquidity-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "add_liquidity"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "pool-liq",
              "method": "pool.liquidity",
              "params": {
                "chain_id": "$.root.chain_id",
                "venue": "$.action.venue"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "poolVol24hUsd",
                  "type": "Decimal",
                  "from": "$.result.vol24hUsd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "poolVol24hUsd": "decimal"
            }
          }
        }
      }
    ],
    "installs": 650,
    "rating": 4.3,
    "ratings": 86
  },
  {
    "slug": "dex-safe-swap",
    "name_ko": "[DEX] Swap 기본 보호",
    "name_en": "[DEX] Safe Swap",
    "description_ko": "토큰을 안전하게 Swap하고 싶은 분들을 위한 패키지",
    "category": "DEX",
    "members": [
      {
        "slug": "swap-recipient-not-self-warn",
        "display_name": "Swap으로 받을 자산이 제3자에게 갈 시 경고",
        "cedar_text": "@id(\"swap-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"Swap 후 토큰이 제3자에게 전송될 수 있습니다. 거래 설정이 맞는지 확인하세요.\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context.recipient != principal.address\n  && !([\n    \"0x0000000000000000000000000000000000000001\", // UR MSG_SENDER (= signer)\n    \"0x0000000000000000000000000000000000000002\"  // UR ADDRESS_THIS (= router, normal routing)\n  ].contains(context.recipient))\n};",
        "manifest": {
          "id": "swap-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          }
        }
      },
      {
        "slug": "swap-high-slippage-warn",
        "display_name": "슬리피지 허용치가 1%를 초과하는 스왑을 실행할 시 경고",
        "cedar_text": "@id(\"swap-high-slippage-warn\")\n@severity(\"warn\")\n@reason(\"슬리피지 허용치가 1%를 넘습니다 — 샌드위치 공격으로 손해 볼 수 있습니다\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen { context.slippageBp > 100 };",
        "manifest": {
          "id": "swap-high-slippage-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          }
        }
      },
      {
        "slug": "swap-output-token-reputation-warn",
        "display_name": "스왑으로 받을 토큰이 스캠일 경우  경고",
        "cedar_text": "@id(\"swap-output-token-reputation-warn\")\n@severity(\"warn\")\n@reason(\"사려는 토큰이 알려진 스캠 토큰으로 분류됐습니다 — 진행 전에 확인하세요\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom\n  && context.custom has reputationFlagged\n  && context.custom.reputationFlagged == true\n};",
        "manifest": {
          "id": "swap-output-token-reputation-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "swap"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "out-token-rep",
              "method": "address.reputation",
              "params": {
                "chain_id": "$.root.chain_id",
                "address": "$.action.tokenOut.key.address"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "reputationFlagged",
                  "type": "Bool",
                  "from": "$.result.flagged",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "reputationFlagged": "Bool"
            }
          }
        }
      }
    ],
    "installs": 1139,
    "rating": 4.7,
    "ratings": 45
  },
  {
    "slug": "token-1",
    "name_ko": "[Token] 안전 ERC-20 송금",
    "name_en": "[Token] Safe Transfer",
    "description_ko": "ERC-20 토큰을 안전하게 송금하고 싶은 사용자를 위한 패키지",
    "category": "Token",
    "members": [
      {
        "slug": "send-burn-recipient-deny",
        "display_name": "토큰이 소각 주소로 전송되는 경우 차단",
        "cedar_text": "@id(\"send-burn-recipient-deny\")\n@severity(\"deny\")\n@reason(\"소각 주소로 자산이 전송됩니다 - 수신자가 정확한지 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  [\"0x0000000000000000000000000000000000000000\",\n   \"0x000000000000000000000000000000000000dead\"].contains(context.recipient)\n};",
        "manifest": {
          "id": "send-burn-recipient-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_transfer"
              }
            }
          }
        }
      },
      {
        "slug": "transfer-recipient-sanctioned-deny",
        "display_name": "제재 목록에 오른 주소로 토큰을 전송할 시 차단",
        "cedar_text": "@id(\"transfer-recipient-sanctioned-deny\")\n@severity(\"deny\")\n@reason(\"제재된 주소(OFAC·EU·UN) 토큰을 전송합니다 - 토큰 수령 주소를 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context has custom\n  && context.custom has sanctioned\n  && context.custom.sanctioned == true\n};",
        "manifest": {
          "id": "transfer-recipient-sanctioned-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_transfer"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "recipient-sanctions",
              "method": "address.sanctions",
              "params": {
                "address": "$.action.recipient"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "sanctioned",
                  "type": "Bool",
                  "from": "$.result.sanctioned",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "sanctioned": "Bool"
            }
          }
        }
      },
      {
        "slug": "transfer-address-poisoning-warn",
        "display_name": "거래 이력이 있는 주소와 닮은 위장 주소로 전송할 시 경고",
        "cedar_text": "@id(\"transfer-address-poisoning-warn\")\n@severity(\"warn\")\n@reason(\"받는 주소가 예전에 쓰던 주소와 닮았지만 다른 주소입니다. 주소 오염일 수 있으니 꼼꼼히 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context has custom\n  && context.custom has poisonCollision\n  && context.custom.poisonCollision == true\n};",
        "manifest": {
          "id": "transfer-address-poisoning-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_transfer"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "recipient-similarity",
              "method": "address.similarity",
              "params": {
                "chain_id": "$.root.chain_id",
                "candidate": "$.action.recipient"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "poisonCollision",
                  "type": "Bool",
                  "from": "$.result.poisonCollision",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "poisonCollision": "Bool"
            }
          }
        }
      },
      {
        "slug": "transfer-fraction-of-holdings-warn",
        "display_name": "보유량의 절반을 초과하는 토큰을 한 번에 전송할 시 경고",
        "cedar_text": "@id(\"transfer-fraction-of-holdings-warn\")\n@severity(\"warn\")\n@reason(\"이 전송은 해당 토큰 보유량의 절반이 넘는 양을 옮깁니다 - 전송 수량을 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context has custom\n  && context.custom has holdingsBp\n  && context.custom.holdingsBp > 5000\n};",
        "manifest": {
          "id": "transfer-fraction-of-holdings-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_transfer"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "holdings-fraction",
              "method": "portfolio.input_fraction_bps",
              "params": {
                "chain_id": "$.root.chain_id",
                "owner": "$.root.from",
                "asset": "$.action.token",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "holdingsBp",
                  "type": "Long",
                  "from": "$.result.bps",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "holdingsBp": "Long"
            }
          }
        }
      },
      {
        "slug": "transfer-to-token-contract-warn",
        "display_name": "토큰의 컨트랙트 주소로 해당 토큰을 전송할 시 경고",
        "cedar_text": "@id(\"transfer-to-token-contract-warn\")\n@severity(\"warn\")\n@reason(\"토큰 자체 컨트랙트로 토큰을 전솝합니다 - 보낸 토큰이 영영 묶일 수 있으니 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  context.token.key has address\n  && context.recipient == context.token.key.address\n};",
        "manifest": {
          "id": "transfer-to-token-contract-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_transfer"
              }
            }
          }
        }
      }
    ],
    "installs": 595,
    "rating": 4.7,
    "ratings": 81
  },
  {
    "slug": "token-approve-in-self-management",
    "name_ko": "[Token] ERC-20 권한 관리",
    "name_en": "[Token] Approve in Self Management",
    "description_ko": "다양한 dApp을 사용하는 사용자를 위한 자산 보호 정책 패키지",
    "category": "Token",
    "members": [
      {
        "slug": "approve-spender-reputation-deny",
        "display_name": "악성으로 알려진 주소에 토큰 사용을 승인할 시 차단",
        "cedar_text": "@id(\"approve-spender-reputation-deny\")\n@severity(\"deny\")\n@reason(\"악성으로 신고된 주소에 토큰 사용 권한을 넘기려 합니다 - 자금 탈취 위험이 있어 차단합니다\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has spenderFlagged\n  && context.custom.spenderFlagged == true\n};",
        "manifest": {
          "id": "approve-spender-reputation-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_approve"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "spender-rep",
              "method": "address.reputation",
              "params": {
                "chain_id": "$.root.chain_id",
                "address": "$.action.spender"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "spenderFlagged",
                  "type": "Bool",
                  "from": "$.result.flagged",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "spenderFlagged": "Bool"
            }
          }
        }
      },
      {
        "slug": "approve-usd-cap-warn",
        "display_name": "승인 금액이 한도를 초과할 시 경고",
        "cedar_text": "@id(\"approve-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"승인 금액이 한도를 넘습니다 - 승인 대상과 금액이 맞는지 확인하세요.\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has approveUsd\n  && context.custom.approveUsd.greaterThan(decimal(\"10000.0000\"))\n};",
        "manifest": {
          "id": "approve-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_approve"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "approve-usd",
              "method": "oracle.usd_value",
              "params": {
                "chain_id": "$.root.chain_id",
                "asset": "$.action.token",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "approveUsd",
                  "type": "Decimal",
                  "from": "$.result.usd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "approveUsd": "decimal"
            }
          }
        }
      },
      {
        "slug": "daily-cumulative-approval-cap-warn",
        "display_name": "하루 누적 활동이 한도를 넘은 경우 경고",
        "cedar_text": "@id(\"daily-cumulative-approval-cap-warn\")\n@severity(\"warn\")\n@reason(\"오늘 지갑에서 빠져나간 금액이 이미 한도를 넘었습니다 - 의도된 승인이 맞는지 확인하세요\")\nforbid(principal, action == Token::Action::\"Erc20Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has windowOutflowUsd\n  && context.custom.windowOutflowUsd.greaterThan(decimal(\"10000.0000\"))\n};",
        "manifest": {
          "id": "daily-cumulative-approval-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "erc20_approve"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "approval-window",
              "method": "stat_window.snapshot",
              "params": {
                "owner": "$.root.from"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "windowOutflowUsd",
                  "type": "Decimal",
                  "from": "$.result.windowOutflowUsd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "windowOutflowUsd": "decimal"
            }
          }
        }
      },
      {
        "slug": "permit2-sign-unlimited-warn",
        "display_name": "무제한 Permit2 승인 서명 요청 시 경고",
        "cedar_text": "@id(\"permit2-sign-unlimited-warn\")\n@severity(\"warn\")\n@reason(\"Permit2 허용량이 무제한으로 설정돼 있습니다 - 신뢰할 수 있는 대상인지 확인하세요\")\nforbid(principal, action == Token::Action::\"Permit2SignAllowance\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffff\"\n};",
        "manifest": {
          "id": "permit2-sign-unlimited-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "permit2_sign_allowance"
              }
            }
          }
        }
      },
      {
        "slug": "permit2-far-expiration-warn",
        "display_name": "만료가 특정기간 이상 남은 Permit2 승인 요청 시 경고",
        "cedar_text": "@id(\"permit2-far-expiration-warn\")\n@severity(\"warn\")\n@reason(\"Permit2 승인의 만료가 설정값을 초과합니다 - 만료 기간을 확인하세요\")\nforbid(principal, action == Token::Action::\"Permit2Approve\", resource)\nwhen {\n  context has custom\n  && context.custom has nowTs\n  && context.expiresAt > context.custom.nowTs + 31536000\n};",
        "manifest": {
          "id": "permit2-far-expiration-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "permit2_approve"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "now",
              "method": "clock.now",
              "params": {},
              "outputs": [
                {
                  "kind": "context",
                  "field": "nowTs",
                  "type": "Long",
                  "from": "$.result.nowTs",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "nowTs": "Long"
            }
          }
        }
      }
    ],
    "installs": 1974,
    "rating": 4.6,
    "ratings": 10
  },
  {
    "slug": "token",
    "name_ko": "[Token] 기본 정책 모음",
    "name_en": "[Token] Beginner Shield",
    "description_ko": "DeFi 거래가 익숙하지 않은 분들을 위한 보호 패키지",
    "category": "Token",
    "members": [],
    "installs": 1455,
    "rating": 4.3,
    "ratings": 71
  },
  {
    "slug": "launchpad-launchpad-participation-shield",
    "name_ko": "[Launchpad] 세일 참여 자금 및 배정 가드",
    "name_en": "[Launchpad] Launchpad Participation Shield",
    "description_ko": "안전한 런치패드 사용을 위한 보호 패키지",
    "category": "Launchpad",
    "members": [
      {
        "slug": "commit-recipient-not-self-warn",
        "display_name": "세일 배정 권리를 받을 주소가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
        "cedar_text": "@id(\"commit-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"세일 배정 권리 수령처가 승인 목록에 없는 주소입니다 — 수령 주소를 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"Commit\", resource)\nwhen {\n    context.recipient != principal.address &&\n    ![\"0x1111111111111111111111111111111111111111\"].contains\n        (\n            context.recipient\n        )\n};",
        "manifest": {
          "id": "commit-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "commit"
              }
            }
          }
        }
      },
      {
        "slug": "commit-usd-cap-warn",
        "display_name": "세일 참여(commit) 금액이 한도를 초과할 시 경고",
        "cedar_text": "@id(\"commit-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"세일 참여 금액이 설정 한도를 넘습니다 — 참여 금액을 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"Commit\", resource)\nwhen {\n  context has custom\n  && context.custom has commitUsd\n  && context.custom.commitUsd.greaterThan(decimal(\"50000.0000\"))\n};",
        "manifest": {
          "id": "commit-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "commit"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "commit-usd",
              "method": "oracle.usd_value",
              "params": {
                "chain_id": "$.root.chain_id",
                "asset": "$.action.payToken",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "commitUsd",
                  "type": "Decimal",
                  "from": "$.result.usd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "commitUsd": "decimal"
            }
          }
        }
      },
      {
        "slug": "claim-allocation-recipient-not-self-warn",
        "display_name": "배정 토큰 클레임 수령처가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
        "cedar_text": "@id(\"claim-allocation-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"배정 토큰 클레임 수령처가 승인 목록에 없는 주소입니다 — 수령 주소를 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"ClaimAllocation\", resource)\nwhen {\n    context.recipient != principal.address &&\n    ![\"0x1111111111111111111111111111111111111111\"].contains\n        (\n            context.recipient\n        )\n};",
        "manifest": {
          "id": "claim-allocation-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "claim_allocation"
              }
            }
          }
        }
      },
      {
        "slug": "refund-recipient-not-self-warn",
        "display_name": "환불 수령처가 본인 지갑이 아니고 승인 목록에도 없을 경우 경고",
        "cedar_text": "@id(\"refund-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"환불 수령처가 승인 목록에 없는 주소입니다 — 수령 주소를 확인하세요\")\nforbid(principal, action == Launchpad::Action::\"Refund\", resource)\nwhen {\n    context.recipient != principal.address &&\n    ![\"0x1111111111111111111111111111111111111111\"].contains\n        (\n            context.recipient\n        )  \n};",
        "manifest": {
          "id": "refund-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "refund"
              }
            }
          }
        }
      }
    ],
    "installs": 597,
    "rating": 4.4,
    "ratings": 13
  },
  {
    "slug": "lending-position-authorization-guard",
    "name_ko": "[대출] 권한 위임 기본 보호",
    "name_en": "[Lending] Position Authorization Guard",
    "description_ko": "대출 프로토콜에서 안전하게 권한을 위임하고 싶은 분들을 위한 패키지",
    "category": "Lending",
    "members": [
      {
        "slug": "set-authorization-grant-confirm-warn",
        "display_name": "Morpho 포지션 관리 권한을 위임할 시 경고 (002와 겹쳐서 삭제 예정)",
        "cedar_text": "@id(\"set-authorization-grant-confirm-warn\")\n@severity(\"warn\")\n@reason(\"Morpho에서 어떤 주소에 권한을 주면 그 주소가 내 포지션을 관리할 수 있습니다 — 위임 대상을 확인하세요\")\nforbid(principal, action == Lending::Action::\"SetAuthorization\", resource)\nwhen { context.isAuthorized == true };",
        "manifest": {
          "id": "set-authorization-grant-confirm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "set_authorization"
              }
            }
          }
        }
      },
      {
        "slug": "set-authorization-operator-reputation-deny",
        "display_name": "Morpho에서 악성으로 분류된 주소에 포지션 관리 권한을 위임할 시 차단",
        "cedar_text": "@id(\"set-authorization-operator-reputation-deny\")\n@severity(\"deny\")\n@reason(\"Morpho에서 권한을 주려는 주소가 악성으로 분류됐습니다 — 차단했습니다\")\nforbid(principal, action == Lending::Action::\"SetAuthorization\", resource)\nwhen {\n  context.isAuthorized == true\n  && context has custom\n  && context.custom has authorizedFlagged\n  && context.custom.authorizedFlagged == true\n};",
        "manifest": {
          "id": "set-authorization-operator-reputation-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "set_authorization"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "authorized-rep",
              "method": "address.reputation",
              "params": {
                "chain_id": "$.root.chain_id",
                "address": "$.action.authorized"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "authorizedFlagged",
                  "type": "Bool",
                  "from": "$.result.flagged",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "authorizedFlagged": "Bool"
            }
          }
        }
      },
      {
        "slug": "supply-on-behalf-mismatch-warn",
        "display_name": "예치 담보 청구권(aToken)을 본인이 아닌 다른 주소로 받을 시 경고",
        "cedar_text": "@id(\"supply-on-behalf-mismatch-warn\")\n@severity(\"warn\")\n@reason(\"이 예치는 담보 청구권(aToken)을 본인이 아닌 다른 주소로 발행합니다 — 수령 대상을 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
        "manifest": {
          "id": "supply-on-behalf-mismatch-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "supply"
              }
            }
          }
        }
      },
      {
        "slug": "borrow-on-behalf-mismatch-warn",
        "display_name": "대출시에 빚이 본인이 아닌 다른 계정 앞으로 잡힐 시 경고",
        "cedar_text": "@id(\"borrow-on-behalf-mismatch-warn\")\n@severity(\"warn\")\n@reason(\"이 대출이 본인이 아닌 다른 계정 앞으로 잡힙니다 — 신용 위임(credit delegation)이 맞는지 확인하세요\")\nforbid(principal, action == Lending::Action::\"Borrow\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
        "manifest": {
          "id": "borrow-on-behalf-mismatch-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "borrow"
              }
            }
          }
        }
      },
      {
        "slug": "repay-on-behalf-confirm-warn",
        "display_name": "내가 아닌 다른 주소의 빚을 상환할 시 경고",
        "cedar_text": "@id(\"repay-on-behalf-confirm-warn\")\n@severity(\"warn\")\n@reason(\"이 상환은 본인이 아닌 다른 주소의 빚을 갚습니다 — 내 자금으로 남의 대출을 갚는 게 맞는지 확인하세요\")\nforbid(principal, action == Lending::Action::\"Repay\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
        "manifest": {
          "id": "repay-on-behalf-confirm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "repay"
              }
            }
          }
        }
      }
    ],
    "installs": 1149,
    "rating": 4.5,
    "ratings": 65
  },
  {
    "slug": "lending-safe-supply-and-withdraw",
    "name_ko": "[대출] 예치 & 출금 기본 보호",
    "name_en": "[Lending] Safe Supply & Withdraw",
    "description_ko": "대출 프로토콜에 자산을 안전하게 예치하고 출금하고 싶은 분을 위한 패키지",
    "category": "Lending",
    "members": [
      {
        "slug": "supply-on-behalf-mismatch-warn",
        "display_name": "예치 담보 청구권(aToken)을 본인이 아닌 다른 주소로 받을 시 경고",
        "cedar_text": "@id(\"supply-on-behalf-mismatch-warn\")\n@severity(\"warn\")\n@reason(\"이 예치는 담보 청구권(aToken)을 본인이 아닌 다른 주소로 발행합니다 — 수령 대상을 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
        "manifest": {
          "id": "supply-on-behalf-mismatch-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "supply"
              }
            }
          }
        }
      },
      {
        "slug": "repay-on-behalf-confirm-warn",
        "display_name": "내가 아닌 다른 주소의 빚을 상환할 시 경고",
        "cedar_text": "@id(\"repay-on-behalf-confirm-warn\")\n@severity(\"warn\")\n@reason(\"이 상환은 본인이 아닌 다른 주소의 빚을 갚습니다 — 내 자금으로 남의 대출을 갚는 게 맞는지 확인하세요\")\nforbid(principal, action == Lending::Action::\"Repay\", resource)\nwhen {\n  context has onBehalfOf\n  && context.onBehalfOf != context.meta.submitter\n};",
        "manifest": {
          "id": "repay-on-behalf-confirm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "repay"
              }
            }
          }
        }
      },
      {
        "slug": "supply-into-frozen-reserve-warn",
        "display_name": "동결·일시정지된 자산 풀에 예치할 시 경고",
        "cedar_text": "@id(\"supply-into-frozen-reserve-warn\")\n@severity(\"warn\")\n@reason(\"이 자산 풀이 동결(frozen)·일시정지(paused) 상태입니다 — 예치하면 자금이 묶일 수 있으니 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context.reserveState.isFrozen || context.reserveState.isPaused\n};",
        "manifest": {
          "id": "supply-into-frozen-reserve-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "supply"
              }
            }
          }
        }
      },
      {
        "slug": "supply-usd-cap-warn",
        "display_name": "예치 금액이 $50,000을 초과할 시 경고",
        "cedar_text": "@id(\"supply-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"고액 예치입니다(약 $50,000 초과) — 예치 규모를 확인하세요\")\nforbid(principal, action == Lending::Action::\"Supply\", resource)\nwhen {\n  context has custom\n  && context.custom has supplyUsd\n  && context.custom.supplyUsd.greaterThan(decimal(\"50000.0000\"))\n};",
        "manifest": {
          "id": "supply-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "supply"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "supply-usd",
              "method": "oracle.usd_value",
              "params": {
                "chain_id": "$.root.chain_id",
                "asset": "$.action.asset",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "supplyUsd",
                  "type": "Decimal",
                  "from": "$.result.usd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "supplyUsd": "decimal"
            }
          }
        }
      },
      {
        "slug": "withdraw-recipient-not-self-warn",
        "display_name": "대출 자산을 본인이 아닌 주소로 인출할 시 경고",
        "cedar_text": "@id(\"withdraw-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"이 인출은 본인 지갑이 아닌 주소로 자금을 보냅니다 — 받는 주소를 확인하세요\")\nforbid(principal, action == Lending::Action::\"Withdraw\", resource)\nwhen {\n  context.recipient != principal.address\n};",
        "manifest": {
          "id": "withdraw-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "withdraw"
              }
            }
          }
        }
      },
      {
        "slug": "withdraw-full-balance-confirm-warn",
        "display_name": "대출이 남은 상태에서 예치 잔액을 전부 인출할 시 경고",
        "cedar_text": "@id(\"withdraw-full-balance-confirm-warn\")\n@severity(\"warn\")\n@reason(\"대출이 남은 상태에서 예치 잔액 전부를 인출합니다 — 포지션이 청산에 가까워질 수 있으니 확인하세요\")\nforbid(principal, action == Lending::Action::\"Withdraw\", resource)\nwhen {\n  context.amount == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n  && context.userStateBefore.totalDebtUsd != \"0x0\"\n};",
        "manifest": {
          "id": "withdraw-full-balance-confirm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "withdraw"
              }
            }
          }
        }
      }
    ],
    "installs": 1294,
    "rating": 4.9,
    "ratings": 60
  },
  {
    "slug": "undefined",
    "name_ko": "[대출] 청산 위험 보호",
    "name_en": "[Lending] Liquidation Guard (청산 방어)",
    "description_ko": "대출 자산을 건전하게 유지하고 싶은 분들을 위한 안전 패키지",
    "category": "Lending",
    "members": [
      {
        "slug": "borrow-low-health-factor-warn",
        "display_name": "대출 후 Health Factor가 1.5 미만이 될 시 경고",
        "cedar_text": "@id(\"borrow-low-health-factor-warn\")\n@severity(\"warn\")\n@reason(\"이 대출 후 건강도(health factor)가 1.5 미만으로 청산에 가까워집니다 — 확인하세요\")\nforbid(principal, action == Lending::Action::\"Borrow\", resource)\nwhen {\n  context has custom\n  && context.custom has postActionHf\n  && context.custom.postActionHf.lessThan(decimal(\"1.5000\"))\n};",
        "manifest": {
          "id": "borrow-low-health-factor-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "borrow"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "post-borrow-hf",
              "method": "lending.health_factor",
              "params": {
                "chain_id": "$.root.chain_id",
                "owner": "$.root.from",
                "venue": "$.action.venue",
                "asset": "$.action.asset",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "postActionHf",
                  "type": "Decimal",
                  "from": "$.result.postActionHf",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "postActionHf": "decimal"
            }
          }
        }
      },
      {
        "slug": "withdraw-low-health-factor-warn",
        "display_name": "담보 인출 후 Health Factor가 1.5 미만이 될 시 경고",
        "cedar_text": "@id(\"withdraw-low-health-factor-warn\")\n@severity(\"warn\")\n@reason(\"이만큼 담보를 빼면 건강도(health factor)가 1.5 미만으로 청산에 가까워집니다 — 확인하세요\")\nforbid(principal, action == Lending::Action::\"Withdraw\", resource)\nwhen {\n  context has custom\n  && context.custom has postActionHf\n  && context.custom.postActionHf.lessThan(decimal(\"1.5000\"))\n};",
        "manifest": {
          "id": "withdraw-low-health-factor-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "withdraw"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "post-withdraw-hf",
              "method": "lending.health_factor",
              "params": {
                "chain_id": "$.root.chain_id",
                "owner": "$.root.from",
                "venue": "$.action.venue",
                "asset": "$.action.asset",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "postActionHf",
                  "type": "Decimal",
                  "from": "$.result.postActionHf",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "postActionHf": "decimal"
            }
          }
        }
      },
      {
        "slug": "disable-collateral-while-borrowing-warn",
        "display_name": "담보 해제 후 Health Factor가 1.1 미만일 시 경고",
        "cedar_text": "@id(\"disable-collateral-while-borrowing-warn\")\n@severity(\"warn\")\n@reason(\"이 담보를 해제하면 건강도(health factor)가 1.1 미만으로 청산에 가까워집니다 — 확인하세요\")\nforbid(principal, action == Lending::Action::\"DisableCollateral\", resource)\nwhen {\n  context has custom\n  && context.custom has postActionHf\n  && context.custom.postActionHf.lessThan(decimal(\"1.1000\"))\n};",
        "manifest": {
          "id": "disable-collateral-while-borrowing-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "disable_collateral"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "post-disable-hf",
              "method": "lending.health_factor",
              "params": {
                "chain_id": "$.root.chain_id",
                "owner": "$.root.from",
                "venue": "$.action.venue",
                "asset": "$.action.asset",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "postActionHf",
                  "type": "Decimal",
                  "from": "$.result.postActionHf",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "postActionHf": "decimal"
            }
          }
        }
      },
      {
        "slug": "set-emode-with-open-debt-warn",
        "display_name": "e-mode를 대출이 남은 상태에서 변경할 시 경고",
        "cedar_text": "@id(\"set-emode-with-open-debt-warn\")\n@severity(\"warn\")\n@reason(\"대출이 남은 상태에서 e-mode를 바꿉니다 — 청산 기준선이 달라지니 확인하세요\")\nforbid(principal, action == Lending::Action::\"SetEMode\", resource)\nwhen {\n  context.userStateBefore.totalDebtUsd != \"0x0\"\n};",
        "manifest": {
          "id": "set-emode-with-open-debt-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "set_e_mode"
              }
            }
          }
        }
      },
      {
        "slug": "borrow-into-frozen-reserve-warn",
        "display_name": "동결·일시정지된 자산 풀에서 대출할 시 경고",
        "cedar_text": "@id(\"borrow-into-frozen-reserve-warn\")\n@severity(\"warn\")\n@reason(\"이 자산 풀이 동결(frozen)·일시정지(paused) 상태입니다 — 빌리면 포지션을 관리하지 못할 수 있으니 확인하세요\")\nforbid(principal, action == Lending::Action::\"Borrow\", resource)\nwhen {\n  context.reserveState.isFrozen || context.reserveState.isPaused\n};",
        "manifest": {
          "id": "borrow-into-frozen-reserve-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "borrow"
              }
            }
          }
        }
      }
    ],
    "installs": 582,
    "rating": 4.6,
    "ratings": 48
  },
  {
    "slug": "liquid-staking-lido",
    "name_ko": "[Liquid Staking] Lido 스테이킹 가드",
    "name_en": "[Liquid Staking] stETH Share Transfer Safety",
    "description_ko": "",
    "category": "LiquidStaking",
    "members": [
      {
        "slug": "stake-during-steth-discount-warn",
        "display_name": "stETH가 ETH보다 쌀 때 Lido에 스테이킹할 시 경고",
        "cedar_text": "@id(\"stake-during-steth-discount-warn\")\n@severity(\"warn\")\n@reason(\"지금 stETH가 ETH보다 쌉니다. 지금은 스테이킹보다 시장에서 stETH를 사는 편이 유리할 수 있습니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"lido\" &&\n    context has custom &&\n    context.custom has stethDiscountBps &&\n    context.custom.stethDiscountBps.greaterThan(decimal(\"100.0000\"))\n};",
        "manifest": {
          "id": "stake-during-steth-discount-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "stake"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "peg",
              "method": "oracle.steth_peg_status_bps",
              "params": {
                "chain_id": "$.root.chain_id"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "stethDiscountBps",
                  "type": "Decimal",
                  "from": "$.result.discountBps",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "stethDiscountBps": "decimal"
            }
          },
          "_template": {
            "maxStethDiscountBps": {
              "cedar_literal": "decimal(\"100.0000\")",
              "default": "100 bps (1.00%)",
              "meaning": "warn when stETH trades below ETH by more than this discount"
            }
          }
        }
      }
    ],
    "installs": 517,
    "rating": 4.5,
    "ratings": 73
  },
  {
    "slug": "liquid-staking-stake-and-wrap-amount-guard",
    "name_ko": "[Liquid Staking] 출금 주소 가드",
    "name_en": "[Liquid Staking] Stake & Wrap Amount Guard",
    "description_ko": "",
    "category": "LiquidStaking",
    "members": [
      {
        "slug": "withdrawal-owner-not-self-warn",
        "display_name": "출금 청구권이 본인이 아닌 주소로 발행될 시 차단",
        "cedar_text": "@id(\"withdrawal-owner-not-self-warn\")\n@severity(\"deny\")\n@reason(\"출금 ETH에 대한 청구권인 unstETH NFT이 본인 지갑이 아닌 주소로 발행됩니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"RequestWithdrawal\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    context.owner != principal.address &&\n    context.owner != \"0x0000000000000000000000000000000000000000\"\n};",
        "manifest": {
          "id": "withdrawal-owner-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "request_withdrawal"
              }
            }
          },
          "_template": {
            "trustedRecipients": {
              "cedar_extension": "&& !([\"0x...\"].contains(context.owner))",
              "default": "[] (not applied)",
              "meaning": "optional allowlist of non-self owners you trust; add to the cedar guard to suppress the warn"
            }
          }
        }
      },
      {
        "slug": "withdrawal-owner-burn-deny",
        "display_name": "출금 청구권이 소각 주소로 발행될 시 차단",
        "cedar_text": "@id(\"withdrawal-owner-burn-deny\")\n@severity(\"deny\")\n@reason(\"출금 ETH에 대한 청구권인 unstETH NFT이 소각 주소로 발행됩니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"RequestWithdrawal\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    [\"0x000000000000000000000000000000000000dead\"].contains(context.owner)\n};",
        "manifest": {
          "id": "withdrawal-owner-burn-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "request_withdrawal"
              }
            }
          },
          "_template": {
            "burnAddresses": {
              "cedar_set": "[\"0x000000000000000000000000000000000000dead\"]",
              "default": "dead only (0x0 EXCLUDED — Lido normalizes _owner==0 to msg.sender, so a zero owner is self, not a burn)",
              "meaning": "owner addresses whose claim rights are permanently unrecoverable (0x…dead is not normalized; 0x0 is the self-sentinel)"
            }
          }
        }
      },
      {
        "slug": "claim-recipient-not-self-warn",
        "display_name": "Lido에서 출금 청구 시 ETH를 받는 주소가 본인이 아닌 경우 차단",
        "cedar_text": "@id(\"claim-recipient-not-self-warn\")\n@severity(\"deny\")\n@reason(\"본인 지갑이 아닌 주소로 출금됩니다. 받는 주소를 확인하세요\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"ClaimWithdrawal\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
        "manifest": {
          "id": "claim-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "claim_withdrawal"
              }
            }
          }
        }
      },
      {
        "slug": "claim-recipient-burn-deny",
        "display_name": "Lido에서 출금 청구 시 ETH를 받는 주소가 소각 주소인 경우 차단",
        "cedar_text": "@id(\"claim-recipient-burn-deny\")\n@severity(\"deny\")\n@reason(\"소각 주소로 출금됩니다. 받는 주소를 확인하세요\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"ClaimWithdrawal\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"lido\" &&\n    context has recipient &&\n    [\"0x0000000000000000000000000000000000000000\",\n     \"0x000000000000000000000000000000000000dead\"].contains\n        (\n            context.recipient\n        )\n};",
        "manifest": {
          "id": "claim-recipient-burn-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "claim_withdrawal"
              }
            }
          },
          "_template": {
            "burnAddresses": {
              "cedar_set": "[\"0x0000000000000000000000000000000000000000\", \"0x000000000000000000000000000000000000dead\"]",
              "default": "zero + dead",
              "meaning": "addresses whose funds are permanently unrecoverable (protocol constants)"
            }
          }
        }
      },
      {
        "slug": "withdrawal-permit-unlimited-warn",
        "display_name": "Lido에서 permit 요청이 무제한 출금 요청일 때 경고",
        "cedar_text": "@id(\"withdrawal-permit-unlimited-warn\")\n@severity(\"warn\")\n@reason(\"이 출금 요청이 무제한 permit을 서명합니다. 한도를 정한 permit이 더 안전합니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"RequestWithdrawal\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"lido\" &&\n    context has embedded_permit &&\n    context.embedded_permit\n        .value == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n};",
        "manifest": {
          "id": "withdrawal-permit-unlimited-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "request_withdrawal"
              }
            }
          },
          "_template": {
            "unlimitedAmount": {
              "cedar_literal": "\"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"",
              "default": "uint256 MAX",
              "meaning": "the raw-hex permit value treated as unlimited"
            }
          }
        }
      }
    ],
    "installs": 1321,
    "rating": 4.8,
    "ratings": 7
  },
  {
    "slug": "liquid-staking-steth-share-transfer-safety",
    "name_ko": "[Liquid Staking] 지분 전송 가드",
    "name_en": "[Liquid Staking] stETH Share Transfer Safety",
    "description_ko": "",
    "category": "LiquidStaking",
    "members": [
      {
        "slug": "transfer-shares-burn-recipient-deny",
        "display_name": "stETH 지분을 소각 주소로 전송할 시 차단",
        "cedar_text": "@id(\"transfer-shares-burn-recipient-deny\")\n@severity(\"deny\")\n@reason(\"지분 전송 수신자가 소각 주소입니다\")\nforbid (\n    principal,\n    action == LiquidStaking::Action::\"TransferShares\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"lido\" &&\n    [\"0x0000000000000000000000000000000000000000\",\n     \"0x000000000000000000000000000000000000dead\"].contains\n        (\n            context.recipient\n        )\n};",
        "manifest": {
          "id": "transfer-shares-burn-recipient-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "liquid_staking"
              },
              "action.tag": {
                "eq": "transfer_shares"
              }
            }
          },
          "_template": {
            "burnAddresses": {
              "cedar_set": "[\"0x0000000000000000000000000000000000000000\", \"0x000000000000000000000000000000000000dead\"]",
              "default": "zero + dead",
              "meaning": "addresses whose funds are permanently unrecoverable (protocol constants)"
            }
          }
        }
      },
      {
        "slug": "steth-wsteth-approve-non-allowlisted-warn",
        "display_name": "stETH/wstETH 승인을 요청하는 주소가 Lido에서 자주 사용하는 주소가 아닐 시 경고",
        "cedar_text": "@id(\"steth-wsteth-approve-non-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"stETH/wstETH 사용 승인을 요청하는 주소를 한번 더 확인해 주세요\")\nforbid (\n    principal,\n    action == Token::Action::\"Erc20Approve\",\n    resource\n)\nwhen\n{\n    context.token.key has address &&\n    [\"0xae7ab96520de3a18e5e111b5eaab095312d7fe84\",\n     \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n        (\n            context.token.key.address\n        ) &&\n    context.amount != \"0x0\" &&\n    !([\"0x000000000022d473030f116ddee9f6b43ac78ba3\",\n      \"0x889edc2edab5f40e902b864ad4d7ade8e412f9b1\",\n      \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n         (\n             context.spender\n         ))\n};",
        "manifest": null
      },
      {
        "slug": "steth-wsteth-permit-non-allowlisted-warn",
        "display_name": "stETH/wstETH 사용 permit 서명을 요청하는 주소가 Lido에서 자주 사용하는 주소가 아닐 시 경고",
        "cedar_text": "@id(\"steth-wsteth-permit-non-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"stETH/wstETH 사용 승인을 요청하는 주소를 한번 더 확인해 주세요\")\nforbid (\n    principal,\n    action == Token::Action::\"Erc20Permit\",\n    resource\n)\nwhen\n{\n    context.token.key has address &&\n    [\"0xae7ab96520de3a18e5e111b5eaab095312d7fe84\",\n     \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n        (\n            context.token.key.address\n        ) &&\n    context.amount != \"0x0\" &&\n    !([\"0x000000000022d473030f116ddee9f6b43ac78ba3\",\n      \"0x889edc2edab5f40e902b864ad4d7ade8e412f9b1\",\n      \"0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0\"].contains\n         (\n             context.spender\n         ))\n};",
        "manifest": null
      }
    ],
    "installs": 2048,
    "rating": 4.7,
    "ratings": 24
  },
  {
    "slug": "nft-nft-1",
    "name_ko": "[NFT] NFT 구매 및 전송 관리",
    "name_en": "[NFT] Safe Purchase & Transfer",
    "description_ko": "",
    "category": "NFT",
    "members": [
      {
        "slug": "nft-transfer-burn-recipient-deny",
        "display_name": "NFT를 소각 주소로 보낼 시 차단",
        "cedar_text": "@id(\"nft-transfer-burn-recipient-deny\")\n@severity(\"deny\")\n@reason(\"이 NFT를 소각 주소로 보내는 거래입니다. 한 번 보내면 영영 되찾을 수 없어 차단합니다.\")\nforbid(principal, action == Token::Action::\"NftTransfer\", resource)\nwhen {\n  [\"0x0000000000000000000000000000000000000000\",\n   \"0x000000000000000000000000000000000000dead\"].contains(context.recipient)\n};",
        "manifest": {
          "id": "nft-transfer-burn-recipient-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "nft_transfer"
              }
            }
          }
        }
      },
      {
        "slug": "nft-transfer-blocklisted-recipient-deny",
        "display_name": "블랙리스트에 오른 주소로 NFT를 전송할 시 차단",
        "cedar_text": "@id(\"nft-transfer-blocklisted-recipient-deny\")\n@severity(\"deny\")\n@reason(\"받는 주소가 알려진 드레이너/제재 블록리스트에 있습니다 — NFT 전송을 차단합니다. 주소를 다시 확인하세요.\")\nforbid(principal, action == Token::Action::\"NftTransfer\", resource)\nwhen {\n  context has custom\n  && context.custom has recipientFlagged\n  && context.custom.recipientFlagged\n};",
        "manifest": {
          "id": "nft-transfer-blocklisted-recipient-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "nft_transfer"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "recipient-reputation",
              "method": "address.reputation",
              "params": {
                "chain_id": "$.root.chain_id",
                "address": "$.action.recipient"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "recipientFlagged",
                  "type": "Bool",
                  "from": "$.result.flagged"
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "recipientFlagged": "Bool"
            }
          }
        }
      },
      {
        "slug": "fulfill-recipient-not-self-warn",
        "display_name": "구매한 NFT가 본인이 아닌 다른 주소로 갈 시 경고",
        "cedar_text": "@id(\"fulfill-recipient-not-self-warn\")\n@severity(\"warn\")\n@reason(\"이 구매로 받을 NFT가 본인 지갑이 아닌 다른 주소로 갑니다 — 승인 전에 받는 주소를 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"FulfillOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.recipient != context.meta.submitter\n};",
        "manifest": {
          "id": "fulfill-recipient-not-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "fulfill_order"
              }
            }
          }
        }
      },
      {
        "slug": "fulfill-overpay-vs-floor-warn",
        "display_name": "Seaport 구매에서 최저가의 50배가 넘는 금액을 지불할 시 경고",
        "cedar_text": "@id(\"fulfill-overpay-vs-floor-warn\")\n@severity(\"warn\")\n@reason(\"받는 NFT의 바닥가(floor)보다 훨씬 비싸게 지불합니다 — 승인 전에 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"FulfillOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context has custom &&\n    context.custom has overpayMultiple &&\n    context.custom.overpayMultiple.greaterThan(decimal(\"50.0000\"))\n};",
        "manifest": {
          "id": "fulfill-overpay-vs-floor-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "fulfill_order"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "floor",
              "method": "marketplace.fulfill_overpay_vs_floor",
              "params": {
                "chain_id": "$.root.chain_id",
                "offer": "$.action.offer",
                "consideration": "$.action.consideration"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "overpayMultiple",
                  "type": "Decimal",
                  "from": "$.result.overpayMultiple",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "overpayMultiple": "decimal"
            }
          },
          "_template": {
            "maxOverpayMultiple": {
              "cedar_decimal": "50.0000",
              "default": "50x floor",
              "meaning": "Warn when the taker pays more than this multiple of the received collection's floor price (50.0 = paying 50x floor). The most tunable taker check — floor is a weak upper anchor on the buy side (rare items sell far above floor), so keep it generous."
            }
          }
        }
      }
    ],
    "installs": 469,
    "rating": 4.6,
    "ratings": 45
  },
  {
    "slug": "nft-nft",
    "name_ko": "[NFT] NFT 컬렉션 권한 위임 보호",
    "name_en": "[NFT] Safe Collection Approval",
    "description_ko": "",
    "category": "NFT",
    "members": [
      {
        "slug": "nft-set-approval-for-all-warn",
        "display_name": "선별되지 않은 마켓플레이스 컨트랙트의 NFT 컬렉션 위임 요청 시 경고",
        "cedar_text": "// Day-1 Safety — NFT 컬렉션 전체 승인(setApprovalForAll) 경고 (순수 Cedar).\n// 알려진 마켓플레이스 operator(OpenSea/Blur/LooksRare)는 allowlist 제외 — 그 밖 operator에게 grant(true) 할 때만 경고. operator = context.spender. revoke(false)는 통과.\n@id(\"nft-set-approval-for-all-warn\")\n@severity(\"warn\")\n@reason(\"잘 알려지지 않은 NFT 마켓플레이스로 NFT 권한이 위임됩니다. 신뢰할 수 있는 거래소인지 검토하세요.\")\nforbid(principal, action == Token::Action::\"NftSetApprovalForAll\", resource)\nwhen {\n  context.approved == true\n  && !([\n    \"0x1e0049783f008a0085193e00003d00cd54003c71\", // OpenSea Seaport conduit\n    \"0x00000000000111abe46ff893f3b2fdf1f759a8a8\", // Blur ExecutionDelegate\n    \"0x000000000060c4ca14cfc4325359062ace33fe3d\"  // LooksRare TransferManager\n  ].contains(context.spender))\n};",
        "manifest": {
          "id": "nft-set-approval-for-all-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "nft_set_approval_for_all"
              }
            }
          }
        }
      },
      {
        "slug": "nft-setapprovalforall-conduit-warn",
        "display_name": "알려지지 않은 곳에 NFT 컬렉션 전체 사용 권한을 줄 시 경고",
        "cedar_text": "@id(\"nft-setapprovalforall-conduit-warn\")\n@severity(\"warn\")\n@reason(\"내 컬렉션 전체를 옮길 권한을 주는데 알려진 거래소 위임처가 아닙니다. 승인 대상이 맞는지 확인해 주십시오.\")\nforbid(principal, action == Token::Action::\"NftSetApprovalForAll\", resource)\nwhen {\n  context.approved\n  && !([\n    \"0x1e0049783f008a0085193e00003d00cd54003c71\", // OpenSea Conduit\n    \"0x00000000000111abe46ff893f3b2fdf1f759a8a8\", // Blur ExecutionDelegate\n    \"0x000000000060c4ca14cfc4325359062ace33fe3d\", // LooksRare v2 TransferManager\n    \"0xf849de01b080adc3a814fabe1e2087475cf2e354\"  // X2Y2 ERC721Delegate\n  ].contains(context.spender))\n};",
        "manifest": {
          "id": "nft-setapprovalforall-conduit-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "nft_set_approval_for_all"
              }
            }
          }
        }
      },
      {
        "slug": "non-opensea-conduit-warn",
        "display_name": "낯선 운영자(Conduit)를 통해 자산을 옮기는 마켓플레이스 주문에 서명할 시 경고",
        "cedar_text": "@id(\"non-opensea-conduit-warn\")\n@severity(\"warn\")\n@reason(\"이 주문이 알려진 마켓플레이스가 아닌 낯선 운영자(conduit)를 통해 토큰을 옮깁니다 — 서명 전에 출처를 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.usesConduit == true &&\n    !([\"0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000\"].contains(context.conduitKey))\n};",
        "manifest": {
          "id": "non-opensea-conduit-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "sign_order"
              }
            }
          },
          "_template": {
            "trustedConduitKeys": {
              "cedar_set": "[\"0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000\"]",
              "default": "OpenSea conduit key (conduit 0x1e0049783f008a0085193e00003d00cd54003c71)",
              "meaning": "Allowlisted bytes32 conduit keys (lowercase). Orders routed through these operators are not flagged. The zero key (direct Seaport) never triggers this policy (usesConduit=false)."
            }
          }
        }
      }
    ],
    "installs": 673,
    "rating": 4.3,
    "ratings": 39
  },
  {
    "slug": "nft-safe-listing-and-sale",
    "name_ko": "[NFT] NFT 판매 관리",
    "name_en": "[NFT] Safe Listing & Sale",
    "description_ko": "",
    "category": "NFT",
    "members": [
      {
        "slug": "proceeds-not-to-self-warn",
        "display_name": "마켓 주문 대금이 본인에게 들어오지 않을 시 경고",
        "cedar_text": "@id(\"proceeds-not-to-self-warn\")\n@severity(\"warn\")\n@reason(\"이 주문의 대금이 본인 주소로 한 푼도 들어오지 않습니다 — 내놓은 자산을 주고 아무것도 받지 못하니 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.proceedsToOfferer == false\n};",
        "manifest": {
          "id": "proceeds-not-to-self-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "sign_order"
              }
            }
          }
        }
      },
      {
        "slug": "listing-proceeds-below-floor-warn",
        "display_name": "받을 대금이 최저가보다 크게 낮은 NFT 리스팅 시 경고",
        "cedar_text": "@id(\"listing-proceeds-below-floor-warn\")\n@severity(\"warn\")\n@reason(\"받게 될 대금이 이 컬렉션 바닥가(floor)보다 훨씬 낮습니다 — 거의 공짜로 리스팅하는 게 아닌지 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context has custom &&\n    context.custom has proceedsBelowFloorBps &&\n    context.custom.proceedsBelowFloorBps.greaterThan(decimal(\"5000.0000\"))\n};",
        "manifest": {
          "id": "listing-proceeds-below-floor-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "sign_order"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "floor",
              "method": "marketplace.sign_order_proceeds_floor",
              "params": {
                "chain_id": "$.root.chain_id",
                "offerer": "$.action.offerer",
                "offer": "$.action.offer",
                "consideration": "$.action.consideration"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "proceedsBelowFloorBps",
                  "type": "Decimal",
                  "from": "$.result.proceedsBelowFloorBps",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "proceedsBelowFloorBps": "decimal"
            }
          },
          "_template": {
            "maxBelowFloorBps": {
              "cedar_decimal": "5000.0000",
              "default": "50% below floor",
              "meaning": "Warn when the offerer's proceeds are this many basis points below the offered collection's floor price (10000 bps = 100%)."
            }
          }
        }
      },
      {
        "slug": "offer-collection-giveaway-deny",
        "display_name": "컬렉션을 통째로 내주는 오퍼에 서명할 시 차단",
        "cedar_text": "@id(\"offer-collection-giveaway-deny\")\n@severity(\"deny\")\n@reason(\"서명하면 구매자가 이 컬렉션에서 본인이 일일이 고르지 않은 NFT까지 가져갈 수 있습니다 — 한 점이 아니라 컬렉션 전체를 내주는 서명이라 차단했습니다\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.offerHasCriteria == true\n};",
        "manifest": {
          "id": "offer-collection-giveaway-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "sign_order"
              }
            }
          },
          "_template": {
            "strictMode": {
              "severity_toggle": "warn | deny",
              "default": "deny",
              "meaning": "Offer-side any-token criteria is near-certainly a drain (research: no legit human-signed maker order has this shape) — deny (hard-block) by default. Flip @severity to warn for an advisory-only posture."
            }
          }
        }
      },
      {
        "slug": "contract-order-anomaly-deny",
        "display_name": "비정상 타입의 마켓플레이스 주문에 서명할 시 차단",
        "cedar_text": "@id(\"contract-order-anomaly-deny\")\n@severity(\"deny\")\n@reason(\"이 주문 타입은 정상 마켓플레이스 리스팅·오퍼가 아닙니다(contract·unknown 타입) — 사람의 정상 서명 흐름에 없는 형태라 차단했습니다\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    [\"contract\", \"unknown\"].contains(context.orderType)\n};",
        "manifest": {
          "id": "contract-order-anomaly-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "sign_order"
              }
            }
          }
        }
      },
      {
        "slug": "far-future-expiry-warn",
        "display_name": "Seaport 주문의 만료가 지나치게 멀 시 경고",
        "cedar_text": "@id(\"far-future-expiry-warn\")\n@severity(\"warn\")\n@reason(\"이 주문은 보통 리스팅보다 훨씬 오래 유효합니다 — 오래 살아 있는 서명 주문은 한참 뒤에 본인에게 불리하게 체결될 수 있으니 확인하세요\")\nforbid (\n    principal,\n    action == Marketplace::Action::\"SignOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"seaport\" &&\n    context.startTime != 0 &&\n    (context.endTime - context.startTime) > 15552000\n};",
        "manifest": {
          "id": "far-future-expiry-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "marketplace"
              },
              "action.tag": {
                "eq": "sign_order"
              }
            }
          },
          "_template": {
            "maxValiditySeconds": {
              "cedar_long": "15552000",
              "default": "180 days (~6 months, OpenSea's listing cap)",
              "meaning": "Warn when (endTime - startTime) exceeds this many seconds. Tune higher if you routinely use long-lived orders on raw Seaport / other venues."
            }
          }
        }
      }
    ],
    "installs": 1115,
    "rating": 4.9,
    "ratings": 81
  },
  {
    "slug": "perp-1",
    "name_ko": "[Perp] 청산 및 마진 관리",
    "name_en": "[Perp] Liquidation & Margin Defense",
    "description_ko": "DeFi 선물 시장을 이용하는 투자자의 안전한 투자를 위한 포지션 관리 패키지",
    "category": "Perp",
    "members": [
      {
        "slug": "order-liquidation-proximity-warn",
        "display_name": "청산가까지 10% 이내로 가까운 포지션에 리스크를 더할 시 경고",
        "cedar_text": "@id(\"order-liquidation-proximity-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓의 포지션이 청산가까지 10% 미만입니다 — 여기서 리스크를 더하면 청산될 수 있으니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has liquidationDistanceBps &&\n    context.liquidationDistanceBps < 1000\n};",
        "manifest": {
          "id": "order-liquidation-proximity-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "minLiqDistanceBps": {
              "cedar_long": "1000",
              "default": "1000 bps (10%)",
              "meaning": "Warn when the existing position's liquidation price is closer than this (|markPx − liqPx| / markPx, bps) and the order adds risk. Placeholder — tune to your comfort buffer."
            }
          }
        }
      },
      {
        "slug": "order-margin-health-warn",
        "display_name": "마진 사용률이 50%를 초과한 상태에서 주문할 시 경고",
        "cedar_text": "@id(\"order-margin-health-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid 계정 마진의 절반 이상을 이미 쓰고 있습니다 — 노출을 더 늘리기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has maxLeverage &&\n    context has marginUsedRatioBps &&\n    context.marginUsedRatioBps > 5000\n};",
        "manifest": {
          "id": "order-margin-health-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "maxMarginUsedBps": {
              "cedar_long": "5000",
              "default": "5000 bps (50%)",
              "meaning": "Warn when account-wide margin utilization (totalMarginUsed / accountValue, bps) exceeds this at order time. Placeholder — tune to your buffer comfort."
            }
          }
        }
      },
      {
        "slug": "isolated-margin-remove-warn",
        "display_name": "격리 마진을 빼낼 시 경고",
        "cedar_text": "@id(\"isolated-margin-remove-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid에서 격리 마진(isolated margin)을 빼냅니다 — 레버리지가 올라가고 청산가가 가까워지니 마켓과 금액을 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"AdjustMargin\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.delta like \"-*\"\n};",
        "manifest": {
          "id": "isolated-margin-remove-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "adjust_margin"
              }
            }
          }
        }
      },
      {
        "slug": "order-cross-margin-warn",
        "display_name": "크로스 마진(cross) 마켓에 주문을 넣을 시 경고",
        "cedar_text": "@id(\"order-cross-margin-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓은 크로스 마진(cross)입니다 — 청산 시 계정 잔액 전체가 끌려갈 수 있으니 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has leverageType &&\n    context.leverageType == \"cross\"\n};",
        "manifest": {
          "id": "order-cross-margin-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          }
        }
      },
      {
        "slug": "order-adding-to-loser-warn",
        "display_name": "손실 중인 HyperLiquid 포지션에 물타기할 시 경고",
        "cedar_text": "@id(\"order-adding-to-loser-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 포지션이 20% 넘게 손실 중입니다 — 손실 포지션에 물타기를 하는 것이니 의도한 것인지 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has hasOpenPosition &&\n    context.hasOpenPosition == true &&\n    context has positionRoeBps &&\n    context.positionRoeBps < -2000\n};",
        "manifest": {
          "id": "order-adding-to-loser-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "maxLossBps": {
              "cedar_long": "-2000",
              "default": "-2000 bps (-20%)",
              "meaning": "Warn when adding to an existing position whose return-on-equity (signed bps) is below this. Placeholder — tune to your max-drawdown discipline."
            }
          }
        }
      }
    ],
    "installs": 1933,
    "rating": 4.8,
    "ratings": 89
  },
  {
    "slug": "perp-and",
    "name_ko": "[Perp] 슬리피지 & 잡코인 방어 패키지",
    "name_en": "[Perp] Sizing & Market Discipline",
    "description_ko": "",
    "category": "Perp",
    "members": [
      {
        "slug": "order-notional-usd-cap-warn",
        "display_name": "주문 명목가가 $10,000을 초과할 시 경고",
        "cedar_text": "@id(\"order-notional-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 주문의 명목가가 $10,000을 넘습니다 — 나가기 전에 수량과 가격을 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has notionalUsd &&\n    context.notionalUsd > 10000\n};",
        "manifest": {
          "id": "order-notional-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "maxNotionalUsd": {
              "cedar_long": "10000",
              "default": "$10,000",
              "meaning": "Warn when the order's USD notional (size × mark price, host-computed integer USD) exceeds this. Placeholder — tune to your typical order size."
            }
          }
        }
      },
      {
        "slug": "order-symbol-not-allowlisted-warn",
        "display_name": "허용 목록에 없는 마켓에 주문할 시 경고",
        "cedar_text": "@id(\"order-symbol-not-allowlisted-warn\")\n@severity(\"warn\")\n@reason(\"허용 목록에 없는 Hyperliquid 마켓에서 포지션을 엽니다 — 낯설거나 유동성 낮은 마켓은 위험이 크니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    !([\"BTC\", \"ETH\", \"SOL\", \"HYPE\"].contains(context.market.symbol))\n};",
        "manifest": {
          "id": "order-symbol-not-allowlisted-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "marketAllowlist": {
              "cedar_set": "[\"BTC\", \"ETH\", \"SOL\", \"HYPE\"]",
              "default": "BTC, ETH, SOL, HYPE",
              "meaning": "Warn on any order whose market symbol is NOT in this set. Use HL UNIVERSE names, matched exactly (case-sensitive; memecoin perps are k-prefixed: kPEPE not PEPE). Placeholder majors — replace with the markets you actually trade (every market you use MUST be listed or ~every order warns)."
            }
          }
        }
      },
      {
        "slug": "order-illiquid-market-warn",
        "display_name": "레버리지 등급이 낮은 마켓에 주문할 시 경고",
        "cedar_text": "@id(\"order-illiquid-market-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓은 최대 레버리지 등급이 낮습니다(10배 이하) — 호가가 얇고 조작되기 쉽다는 HL의 신호이니 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has maxLeverage &&\n    context.maxLeverage <= 10\n};",
        "manifest": {
          "id": "order-illiquid-market-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "maxLeverageTierFloor": {
              "cedar_long": "10",
              "default": "10x tier",
              "meaning": "Warn when the market's HL max-leverage tier is at or below this (low tier = HL's own illiquidity signal). Placeholder — raise to 20 to also flag mid-caps, lower to 5 for only the thinnest books."
            }
          }
        }
      },
      {
        "slug": "order-symbol-denylisted-deny",
        "display_name": "차단 목록에 있는 마켓에 주문을 넣을 시 차단",
        "cedar_text": "@id(\"order-symbol-denylisted-deny\")\n@severity(\"deny\")\n@reason(\"이 Hyperliquid 마켓이 차단 목록에 있어 정책에 따라 주문을 차단했습니다\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    [\"DOGE\", \"kPEPE\", \"kSHIB\"].contains(context.market.symbol)\n};",
        "manifest": {
          "id": "order-symbol-denylisted-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "marketDenylist": {
              "cedar_set": "[\"DOGE\", \"kPEPE\", \"kSHIB\"]",
              "default": "DOGE, kPEPE, kSHIB",
              "meaning": "Block any order whose market symbol IS in this set. Use HL UNIVERSE names, matched exactly (case-sensitive): HL lists 1000-unit memecoin perps with a k prefix (kPEPE, kSHIB, kBONK — NOT PEPE/SHIB). Placeholder examples — replace with the markets you want banned."
            }
          }
        }
      }
    ],
    "installs": 1507,
    "rating": 4.5,
    "ratings": 73
  },
  {
    "slug": "perp",
    "name_ko": "[Perp] 고배율 레버리지 관리",
    "name_en": "[Perp] Leverage Guard",
    "description_ko": "건전한 무기한 선물 투자를 위한 레버리지 관리 패키지",
    "category": "Perp",
    "members": [
      {
        "slug": "update-leverage-cap-warn",
        "display_name": "레버리지를 10배 초과로 설정할 시 경고(2번과 같아서 삭제예정)",
        "cedar_text": "@id(\"update-leverage-cap-warn\")\n@severity(\"warn\")\n@reason(\"Hyperliquid 레버리지를 10배 넘게 설정합니다 — 작은 역방향 움직임에도 청산될 수 있으니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"ChangeLeverage\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.newLeverage.greaterThan(decimal(\"10.0\"))\n};",
        "manifest": {
          "id": "update-leverage-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "change_leverage"
              }
            }
          },
          "_template": {
            "maxLeverage": {
              "cedar_decimal": "10.0",
              "default": "10.0x",
              "meaning": "Warn when the leverage being SET exceeds this (Cedar decimal, .greaterThan comparison). Placeholder — tune to your risk posture."
            }
          }
        }
      },
      {
        "slug": "order-leverage-high-warn",
        "display_name": "레버리지가 10배를 초과하는 주문을 넣을 시 경고",
        "cedar_text": "@id(\"order-leverage-high-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓의 계정 레버리지가 10배를 넘습니다 — 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has leverage &&\n    context.leverage > 10\n};",
        "manifest": {
          "id": "order-leverage-high-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "maxLeverage": {
              "cedar_long": "10",
              "default": "10x",
              "meaning": "Warn when the host-enriched order-time effective leverage exceeds this. Long, direct > comparison. Placeholder — tune to your risk posture (conservative 3-5x, experienced 5-10x)."
            }
          }
        }
      },
      {
        "slug": "order-leverage-at-market-max-warn",
        "display_name": "레버리지가 마켓 최대 등급에 도달한 주문일 시 경고",
        "cedar_text": "@id(\"order-leverage-at-market-max-warn\")\n@severity(\"warn\")\n@reason(\"이 Hyperliquid 마켓의 레버리지가 마켓 최대 허용 등급에 도달했습니다 — 청산에 가장 민감한 설정이니 열거나 추가하기 전에 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    context has leverage &&\n    context has maxLeverage &&\n    context.leverage >= context.maxLeverage\n};",
        "manifest": {
          "id": "order-leverage-at-market-max-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          }
        }
      },
      {
        "slug": "order-alt-leverage-warn",
        "display_name": "알트 마켓을 5배 넘는 레버리지로 주문할 시 경고",
        "cedar_text": "@id(\"order-alt-leverage-warn\")\n@severity(\"warn\")\n@reason(\"알트 마켓 Hyperliquid 포지션을 5배 넘는 레버리지로 엽니다 — 알트는 변동이 격해 설정한 알트 레버리지 한도에 걸렸으니 확인하세요\")\nforbid (\n    principal,\n    action == Perp::Action::\"PlaceOrder\",\n    resource\n)\nwhen\n{\n    context.venue.name == \"hyperliquid\" &&\n    context.reduceOnly == false &&\n    !([\"BTC\", \"ETH\", \"SOL\"].contains(context.market.symbol)) &&\n    context has leverage &&\n    context.leverage > 5\n};",
        "manifest": {
          "id": "order-alt-leverage-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "place_order"
              }
            }
          },
          "_template": {
            "majorsList": {
              "cedar_set": "[\"BTC\", \"ETH\", \"SOL\"]",
              "default": "BTC, ETH, SOL",
              "meaning": "Markets EXEMPT from the alt leverage cap (the global cap in order-leverage-high-warn still applies to them). Use HL universe names, case-sensitive (kPEPE not PEPE)."
            },
            "altMaxLeverage": {
              "cedar_long": "5",
              "default": "5x",
              "meaning": "Warn when effective leverage on a NON-majors market exceeds this. Placeholder — the classic two-tier desk rule (10x majors / 5x alts)."
            }
          }
        }
      }
    ],
    "installs": 1449,
    "rating": 4.8,
    "ratings": 25
  },
  {
    "slug": "restaking-operator-delegation-guard",
    "name_ko": "[Restaking] 스트레티지 예치/오퍼레이터 위임 가드",
    "name_en": "[Restaking] Operator Delegation Guard",
    "description_ko": "",
    "category": "Restaking",
    "members": [
      {
        "slug": "deposit-strategy-not-allowlisted-warn",
        "display_name": "허용 목록에 없는 스트래티지로 리스테이크를 예치할 시 차단",
        "cedar_text": "@id(\"deposit-strategy-not-allowlisted-warn\")\n@severity(\"deny\")\n@reason(\"허용 목록에 없는 스트래티지로 예치합니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Deposit\",\n    resource\n)\nwhen\n{\n    !([\"0x0000000000000000000000000000000000000000\"].contains(context.strategy))\n};",
        "manifest": {
          "id": "deposit-strategy-not-allowlisted-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "deposit"
              }
            }
          }
        }
      },
      {
        "slug": "delegate-operator-not-allowlisted-deny",
        "display_name": "허용 목록에 없는 오퍼레이터에게 위임할 시 차단",
        "cedar_text": "@id(\"delegate-operator-not-allowlisted-deny\")\n@severity(\"deny\")\n@reason(\"허용 목록에 없는 오퍼레이터 주소입니다. 허용 목록을 확인해주세요\")\nforbid (\n    principal,\n    action == Restaking::Action::\"DelegateTo\",\n    resource\n)\nwhen\n{\n    !([\"0x0000000000000000000000000000000000000000\"].contains(context.operator))\n};",
        "manifest": {
          "id": "delegate-operator-not-allowlisted-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "delegate_to"
              }
            }
          }
        }
      },
      {
        "slug": "redelegate-new-operator-not-allowlisted-deny",
        "display_name": "허용 목록에 없는 오퍼레이터에게 재위임할 시 차단",
        "cedar_text": "@id(\"redelegate-new-operator-not-allowlisted-deny\")\n@severity(\"deny\")\n@reason(\"허용 목록에 없는 새 오퍼레이터로 재위임하려 합니다 — 먼저 신뢰 목록에 추가해야 하므로 차단했습니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Redelegate\",\n    resource\n)\nwhen\n{\n    !([\"0x0000000000000000000000000000000000000000\"].contains\n         (\n             context.newOperator\n         ))\n};",
        "manifest": {
          "id": "redelegate-new-operator-not-allowlisted-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "redelegate"
              }
            }
          }
        }
      },
      {
        "slug": "register-as-operator-deny",
        "display_name": "EigenLayer 오퍼레이터로 등록할 시 경고",
        "cedar_text": "@id(\"register-as-operator-deny\")\n@severity(\"warn\")\n@reason(\"EigenLayer 오퍼레이터로 등록하려 합니다 — 패시브 리스테이커는 오퍼레이터가 되어선 안 되므로 차단했습니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"RegisterOperator\",\n    resource\n);",
        "manifest": {
          "id": "register-as-operator-deny",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "register_operator"
              }
            }
          }
        }
      }
    ],
    "installs": 1398,
    "rating": 4.8,
    "ratings": 84
  },
  {
    "slug": "restaking-safe-withdrawal-and-undelegation",
    "name_ko": "[Restaking] 안전하게 예치/출금하기",
    "name_en": "[Restaking] Safe Withdrawal & Undelegation",
    "description_ko": "",
    "category": "Restaking",
    "members": [
      {
        "slug": "deposit-on-behalf-other-staker-warn",
        "display_name": "리스테이킹 예치 지분이 내 지갑이 아닌 주소로 잡힐 시 차단",
        "cedar_text": "@id(\"deposit-on-behalf-other-staker-warn\")\n@severity(\"deny\")\n@reason(\"서명하는 예치(Deposit) 지분이 본인 지갑이 아닙니다\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Deposit\",\n    resource\n)\nwhen { context has staker && context.staker != context.meta.submitter };",
        "manifest": {
          "id": "deposit-on-behalf-other-staker-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "deposit"
              }
            }
          }
        }
      },
      {
        "slug": "restake-usd-cap-warn",
        "display_name": "리스테이크 예치 금액이 $50,000을 초과할 시 경고",
        "cedar_text": "@id(\"restake-usd-cap-warn\")\n@severity(\"warn\")\n@reason(\"고액 리스테이크 예치입니다(약 $50,000 초과) — 예치 규모를 확인하세요\")\nforbid (\n    principal,\n    action == Restaking::Action::\"Deposit\",\n    resource\n)\nwhen\n{\n    context has custom &&\n    context.custom has restakeUsd &&\n    context.custom.restakeUsd.greaterThan(decimal(\"50000.0000\"))\n};",
        "manifest": {
          "id": "restake-usd-cap-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "deposit"
              }
            }
          },
          "policy_rpc": [
            {
              "id": "restake-usd",
              "method": "oracle.usd_value",
              "params": {
                "chain_id": "$.root.chain_id",
                "asset": "$.action.token.key.address",
                "amount": "$.action.amount"
              },
              "outputs": [
                {
                  "kind": "context",
                  "field": "restakeUsd",
                  "type": "Decimal",
                  "from": "$.result.usd",
                  "required": false
                }
              ],
              "optional": true
            }
          ],
          "custom_context": {
            "fields": {
              "restakeUsd": "decimal"
            }
          }
        }
      },
      {
        "slug": "complete-withdrawal-receive-as-shares-warn",
        "display_name": "출금을 토큰이 아닌 지분으로 받을 시 경고",
        "cedar_text": "@id(\"complete-withdrawal-receive-as-shares-warn\")\n@severity(\"warn\")\n@reason(\"지금 출금은 지갑으로 토큰이 입금되는 출금이 아니라, 오퍼레이터에게 다시 예치·위임되는 출금입니다.\")\nforbid (\n    principal,\n    action == Restaking::Action::\"CompleteWithdrawal\",\n    resource\n)\nwhen { context has receiveAsTokens && context.receiveAsTokens == false };",
        "manifest": {
          "id": "complete-withdrawal-receive-as-shares-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.tag": {
                "eq": "complete_withdrawal"
              }
            }
          }
        }
      }
    ],
    "installs": 222,
    "rating": 4.7,
    "ratings": 78
  },
  {
    "slug": "aave-aave-safety-module-exit",
    "name_ko": "[Aave] Aave Safety Module 스테이킹 가이드",
    "name_en": "[Aave] Aave Safety Module Exit",
    "description_ko": "",
    "category": "Staking",
    "members": [
      {
        "slug": "aave-cooldown-confirm-warn",
        "display_name": "Aave 언스테이킹 쿨다운 시 인출 기간을 확인하도록 경고",
        "cedar_text": "@id(\"aave-cooldown-confirm-warn\")\n@severity(\"warn\")\n@reason(\"Aave 언스테이크 쿨다운을 시작합니다 — 이후 열리는 인출 기간 동안에만 회수(redeem) 할 수 있으니 확인하세요\")\nforbid(principal, action == Staking::Action::\"Cooldown\", resource)\nwhen {\n  [\"aave_safety_module\", \"aave_umbrella_stake_token\"].contains(context.venue.name)\n};",
        "manifest": {
          "id": "aave-cooldown-confirm-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "cooldown"
              }
            }
          }
        }
      },
      {
        "slug": "aave-stake-slashing-warn",
        "display_name": "Aave Safety Module에 원금 슬래싱을 감수하고 스테이킹할 시 경고",
        "cedar_text": "@id(\"aave-stake-slashing-warn\")\n@severity(\"warn\")\n@reason(\"이 스테이킹은 원금이 슬래싱 위험에 노출될 수 있습니다 — 감수할지 확인하세요\")\nforbid (\n    principal,\n    action == Staking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    [\"aave_safety_module\",\n     \"aave_umbrella_stake_token\"].contains\n        (\n            context.protocol.name\n        )\n};",
        "manifest": {
          "id": "aave-stake-slashing-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "stake"
              }
            }
          }
        }
      },
      {
        "slug": "aave-redeem-full-balance-warn",
        "display_name": "Aave 스테이킹 자산을 전액 인출할 시 경고",
        "cedar_text": "@id(\"aave-redeem-full-balance-warn\")\n@severity(\"warn\")\n@reason(\"스테이킹 잔액 전부를 인출하는 것이 맞는지 한번 더 확인해주세요\")\nforbid(principal, action == Staking::Action::\"Redeem\", resource)\nwhen {\n  context.venue.name == \"aave_safety_module\"\n  && context.amount == \"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"\n};",
        "manifest": {
          "id": "aave-redeem-full-balance-warn",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "redeem"
              }
            }
          }
        }
      }
    ],
    "installs": 666,
    "rating": 4.4,
    "ratings": 52
  },
  {
    "slug": "staking",
    "name_ko": "[Staking] 스테이킹 보상 수령 주소 관리",
    "name_en": "[Staking] Stake & Reward Recipient Guard",
    "description_ko": "",
    "category": "Staking",
    "members": [
      {
        "slug": "aave-stake-recipient-self",
        "display_name": "Aave 스테이킹 지분을 본인이 아닌 주소로 받을 시 차단",
        "cedar_text": "@id(\"aave-stake-recipient-self\")\n@severity(\"deny\")\n@reason(\"Aave 스테이킹 지분이 본인 지갑이 아닌 주소로 발행됩니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    [\"aave_safety_module\",\n     \"aave_savings_gho\",\n     \"aave_umbrella_stake_token\"].contains\n        (\n            context.venue.name\n        ) &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
        "manifest": {
          "id": "aave-stake-recipient-self",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "stake"
              }
            }
          }
        }
      },
      {
        "slug": "aave-redeem-recipient-self",
        "display_name": "Aave 스테이킹 자산을 본인 지갑이 아닌 주소로 인출할 시 차단",
        "cedar_text": "@id(\"aave-redeem-recipient-self\")\n@severity(\"deny\")\n@reason(\"이 Aave redeem 이 인출한 자산을 본인 지갑이 아닌 주소로 보냅니다 — 차단했습니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Redeem\",\n    resource\n)\nwhen\n{\n    [\"aave_safety_module\",\n     \"aave_savings_gho\",\n     \"aave_umbrella_stake_token\"].contains\n        (\n            context.venue.name\n        ) &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
        "manifest": {
          "id": "aave-redeem-recipient-self",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "redeem"
              }
            }
          }
        }
      },
      {
        "slug": "aave-claim-rewards-recipient-self",
        "display_name": "Aave 스테이킹 보상 수령자가 본인이 아닐 시 차단",
        "cedar_text": "@id(\"aave-claim-rewards-recipient-self\")\n@severity(\"deny\")\n@reason(\"Aave 보상 수령자가 본인 지갑이 아닙니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"ClaimRewards\",\n    resource\n)\nwhen\n{\n    ([\"aave_safety_module\",\n     \"aave_umbrella_rewards_controller\"].contains\n        (\n            context.protocol.name\n        ) &&\n    context has recipient &&\n    context.recipient != principal.address)\n    ||\n    (\n      context.protocol.name == \"aave_umbrella_rewards_controller\"\n      && context has onBehalfOf\n      && context.onBehalfOf != principal.address\n    )\n};",
        "manifest": {
          "id": "aave-claim-rewards-recipient-self",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "claim_rewards"
              }
            }
          }
        }
      },
      {
        "slug": "ethena-stake-recipient-self",
        "display_name": "Ethena USDe 지분(sUSDe) 수령자가 본인이 아닌 경우 차단",
        "cedar_text": "@id(\"ethena-stake-recipient-self\")\n@severity(\"deny\")\n@reason(\"USDe 스테이킹 지분(sUSDe) 수령자가 내 지갑이 아닙니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Stake\",\n    resource\n)\nwhen\n{\n    context.protcool.name == \"ethena_staked_usde\" &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
        "manifest": {
          "id": "ethena-stake-recipient-self",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "stake"
              }
            }
          }
        }
      },
      {
        "slug": "ethena-redeem-recipient-self",
        "display_name": "sUSDe 인출 자금 수령자가 본인이 아닌 경우 차단",
        "cedar_text": "@id(\"ethena-redeem-recipient-self\")\n@severity(\"deny\")\n@reason(\"이 sUSDe redeem 이 인출한 USDe를 본인 지갑이 아닌 주소로 보냅니다\")\nforbid (\n    principal,\n    action == Staking::Action::\"Redeem\",\n    resource\n)\nwhen\n{\n    context.protocol.name == \"ethena_staked_usde\" &&\n    context has recipient &&\n    context.recipient != principal.address\n};",
        "manifest": {
          "id": "ethena-redeem-recipient-self",
          "schema_version": 2,
          "trigger": {
            "where": {
              "action.domain": {
                "eq": "staking"
              },
              "action.tag": {
                "eq": "redeem"
              }
            }
          }
        }
      }
    ],
    "installs": 1469,
    "rating": 4.7,
    "ratings": 45
  }
];

function polSummary(p: SeedPol): ListingSummary {
  return {
    id: `seed-${p.slug}`, slug: p.slug, kind: "policy",
    publisher_id: "wallet-guardians", publisher_tier: "official",
    display_name: { en: p.name_en, ko: p.name_ko },
    description: { en: p.name_en, ko: p.name_ko },
    category: p.category, severity: p.severity, status: "published",
    current_version: "1.0.0", created_at: RELEASED, updated_at: RELEASED,
    install_count: p.installs, rating_avg: p.rating, rating_count: p.ratings,
    is_installed: false,
  };
}
function pkgSummary(p: SeedPkg): ListingSummary {
  return {
    id: `seed-${p.slug}`, slug: p.slug, kind: "set",
    publisher_id: "wallet-guardians", publisher_tier: "official",
    display_name: { en: p.name_en, ko: p.name_ko },
    description: { en: p.description_ko, ko: p.description_ko },
    category: p.category, status: "published",
    current_version: "1.0.0", created_at: RELEASED, updated_at: RELEASED,
    install_count: p.installs, rating_avg: p.rating, rating_count: p.ratings,
    is_installed: false,
  };
}

export function seedListings(): ListingSummary[] {
  return [...PACKAGES.map(pkgSummary), ...POLICIES.map(polSummary)];
}

export function seedDetail(slug: string): ListingDetail | null {
  const pkg = PACKAGES.find((p) => p.slug === slug);
  if (pkg) {
    return {
      ...pkgSummary(pkg),
      latest_version: {
        listing_id: `seed-${pkg.slug}`, version: "1.0.0", major: 1, minor: 0, patch: 0,
        members: pkg.members.map((m) => ({ slug: m.slug, display_name: m.display_name, cedar_text: m.cedar_text, manifest: m.manifest })),
        published_at: RELEASED,
      },
      recent_reviews: [],
    };
  }
  const p = POLICIES.find((x) => x.slug === slug);
  if (!p) return null;
  return {
    ...polSummary(p),
    latest_version: {
      listing_id: `seed-${p.slug}`, version: "1.0.0", major: 1, minor: 0, patch: 0,
      cedar_text: p.cedar, manifest: p.manifest, published_at: RELEASED,
    },
    recent_reviews: [],
  };
}
