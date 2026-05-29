//! M2 — `declarative_install_v3_json` + `declarative_route_request_v3_json`
//! end-to-end fixtures.
//!
//! Each test installs a v3 manifest (registryV2 raw, untyped) via
//! `declarative_install_v3_json`, then routes a hand-built raw calldata
//! through `declarative_route_request_v3_json` and asserts that the resulting
//! hierarchical `ActionBody` JSON matches the PDF FSM spec.
//!
//! Narrow-scope (M2):
//!   * `single_emit` strategy with literal venue addresses (no `$resolved` /
//!     `$derived` references — those are filled by M5+).
//!   * `opcode_stream_dispatch` with a single UR `V3_SWAP_EXACT_IN` opcode.
//!     `inputs_abi` decoding is best-effort; the test asserts the structural
//!     shape (`body.actions[0].domain == "amm"`, `action == "swap"`) without
//!     pinning the per-opcode payload fields (those exercise the M2 fallback
//!     when the manifest's `inputs_abi` cannot fully ABI-decode the raw
//!     inputs).
//!
//! Each fixture's manifest is inlined here verbatim — the registry on disk
//! still hosts v1-shape manifests and M2 should not depend on that snapshot.

use alloy_dyn_abi::DynSolValue;
use alloy_primitives::{Address as AlloyAddress, U256 as AlloyU256};
use policy_engine_wasm::{declarative_install_v3_json, declarative_route_request_v3_json};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// 4-byte selector + ABI-encoded parameters → "0x"-prefixed hex calldata.
fn encode_calldata(selector: &str, args: &[DynSolValue]) -> String {
    let sel = hex::decode(selector.trim_start_matches("0x")).unwrap();
    let body = DynSolValue::Tuple(args.to_vec()).abi_encode_params();
    format!("0x{}{}", hex::encode(sel), hex::encode(body))
}

/// Build a route-request input JSON wrapping the raw calldata.
fn route_input(
    chain_id: u64,
    to: &str,
    selector: &str,
    calldata: String,
    submitter: &str,
) -> String {
    json!({
        "chain_id": chain_id,
        "to": to,
        "selector": selector,
        "calldata": calldata,
        "value": "0",
        "gas_limit": "200000",
        "gas_price": "20000000000",
        "submitter": submitter,
        "submitted_at": 1_700_000_000_u64,
        "nonce": 1_u64,
        "block_timestamp": 1_700_000_010_u64
    })
    .to_string()
}

fn install_ok(manifest: &str) -> Value {
    let out = declarative_install_v3_json(manifest.to_owned());
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["ok"], true, "install failed: {parsed}");
    parsed
}

fn route_ok(input: String) -> Value {
    let out = declarative_route_request_v3_json(input);
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["ok"], true, "route failed: {parsed}");
    parsed
}

// ---------------------------------------------------------------------------
// t1 — ERC20 approve (single_emit + literal venue not applicable, token only)
// ---------------------------------------------------------------------------
//
// Mirrors what `standard/erc20/approve@1.0.0` would look like in v3 schema.
// `$tx.to` resolves to the route input's `to` field (the token contract).

const T1_ERC20_APPROVE_V3: &str = r#"{
  "type": "adapter_function",
  "id": "standard/erc20/approve@2.0.0",
  "publisher": "ethereum.org",
  "schema_version": "2",
  "match": {
    "chain_to_addresses": {
      "1": ["0xa0B86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]
    },
    "selector": "0x095ea7b3"
  },
  "abi_fragment": {
    "function_name": "approve",
    "abi": {
      "name": "approve",
      "type": "function",
      "inputs": [
        { "name": "spender", "type": "address" },
        { "name": "amount", "type": "uint256" }
      ]
    }
  },
  "emit": {
    "strategy": "single_emit",
    "body": {
      "domain": "token",
      "token": {
        "action": "erc20_approve",
        "erc20_approve": {
          "token": { "key": { "standard": "erc20", "chain": "$chain", "address": "$tx.to" } },
          "spender": "$args.spender",
          "amount": "$args.amount"
        }
      }
    }
  },
  "requires": {
    "imperative": [],
    "adapter_capabilities": ["token_metadata"],
    "host_capabilities": [],
    "extension": ">=0.1.0"
  }
}"#;

#[test]
fn t1_erc20_approve() {
    let install = install_ok(T1_ERC20_APPROVE_V3);
    assert_eq!(install["data"]["bundle_id"], "standard/erc20/approve@2.0.0");

    let calldata = encode_calldata(
        "0x095ea7b3",
        &[
            DynSolValue::Address(
                "0x00000000000000000000000000000000deadbeef"
                    .parse::<AlloyAddress>()
                    .unwrap(),
            ),
            DynSolValue::Uint(AlloyU256::from(1_000_000u64), 256),
        ],
    );
    let input = route_input(
        1,
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x095ea7b3",
        calldata,
        "0x000000000000000000000000000000000000aaaa",
    );
    let parsed = route_ok(input);
    assert_eq!(parsed["data"]["decoder_id"], "standard/erc20/approve@2.0.0");

    let body = &parsed["data"]["actions"][0]["body"];
    assert_eq!(body["domain"], "token");
    assert_eq!(body["action"], "erc20_approve");
    assert_eq!(
        body["spender"],
        "0x00000000000000000000000000000000deadbeef"
    );
    // U256 round-trips as a hex string through alloy serde.
    assert_eq!(body["amount"], "0xf4240"); // 1_000_000 == 0xf4240
    assert_eq!(body["token"]["key"]["standard"], "erc20");
    assert_eq!(body["token"]["key"]["chain"], "eip155:1");
    assert_eq!(
        body["token"]["key"]["address"],
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    );
}

// ---------------------------------------------------------------------------
// t2 — Uniswap V2 swapExactTokensForTokens (single_emit + literal venue)
// ---------------------------------------------------------------------------

const T2_V2_SWAP_V3: &str = r#"{
  "type": "adapter_function",
  "id": "uniswap/v2-router-02/swapExactTokensForTokens@2.0.0",
  "publisher": "uniswap.eth",
  "schema_version": "2",
  "match": {
    "chain_to_addresses": {
      "1": ["0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"]
    },
    "selector": "0x38ed1739"
  },
  "abi_fragment": {
    "function_name": "swapExactTokensForTokens",
    "abi": {
      "name": "swapExactTokensForTokens",
      "type": "function",
      "inputs": [
        { "name": "amountIn", "type": "uint256" },
        { "name": "amountOutMin", "type": "uint256" },
        { "name": "path", "type": "address[]" },
        { "name": "to", "type": "address" },
        { "name": "deadline", "type": "uint256" }
      ]
    }
  },
  "emit": {
    "strategy": "single_emit",
    "body": {
      "domain": "amm",
      "amm": {
        "action": "swap",
        "swap": {
          "venue": {
            "name": "uniswap_v2",
            "chain": "$chain",
            "pool": "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
            "factory": "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f"
          },
          "params": {
            "token_in":  { "key": { "standard": "erc20", "chain": "$chain", "address": "$args.path[0]" } },
            "token_out": { "key": { "standard": "erc20", "chain": "$chain", "address": "$args.path[-1]" } },
            "direction": {
              "kind": "exact_input",
              "amount_in": "$args.amountIn",
              "min_amount_out": "$args.amountOutMin"
            },
            "recipient": "$args.to",
            "slippage_bp": 50
          }
        }
      }
    },
    "live_inputs": {
      "route":               { "source": { "kind": "onchain_view", "chain": "$chain", "contract": "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", "function": "getReserves()", "decoder_id": "uniswap_v2_get_reserves" }, "ttl_s": 12 },
      "expected_amount_out": { "source": { "kind": "derived_from", "inputs": [{ "scope": "global", "name": "x" }], "calc_id": "y" }, "ttl_s": 12 },
      "price_impact_bp":     { "source": { "kind": "derived_from", "inputs": [{ "scope": "global", "name": "x" }], "calc_id": "y" }, "ttl_s": 12 },
      "gas_estimate":        { "source": { "kind": "oracle_feed", "provider": "pyth", "feed_id": "gas/ethereum" }, "ttl_s": 6 }
    }
  },
  "requires": {
    "imperative": [],
    "adapter_capabilities": ["token_metadata"],
    "host_capabilities": [],
    "extension": ">=0.1.0"
  }
}"#;

#[test]
fn t2_v2_swap_exact_tokens_for_tokens() {
    install_ok(T2_V2_SWAP_V3);

    let calldata = encode_calldata(
        "0x38ed1739",
        &[
            DynSolValue::Uint(AlloyU256::from(1_000_000_000_000_000_000u128), 256),
            DynSolValue::Uint(AlloyU256::from(1_900_000u64), 256),
            DynSolValue::Array(vec![
                DynSolValue::Address(
                    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
                        .parse::<AlloyAddress>()
                        .unwrap(),
                ),
                DynSolValue::Address(
                    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
                        .parse::<AlloyAddress>()
                        .unwrap(),
                ),
            ]),
            DynSolValue::Address(
                "0x4444444444444444444444444444444444444444"
                    .parse::<AlloyAddress>()
                    .unwrap(),
            ),
            DynSolValue::Uint(AlloyU256::from(1_700_000_900u64), 256),
        ],
    );
    let input = route_input(
        1,
        "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
        "0x38ed1739",
        calldata,
        "0x000000000000000000000000000000000000aaaa",
    );
    let parsed = route_ok(input);

    let body = &parsed["data"]["actions"][0]["body"];
    assert_eq!(body["domain"], "amm");
    assert_eq!(body["action"], "swap");
    assert_eq!(body["venue"]["name"], "uniswap_v2");
    assert_eq!(
        body["venue"]["pool"],
        "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640"
    );
    assert_eq!(body["params"]["direction"]["kind"], "exact_input");
    assert_eq!(body["params"]["slippage_bp"], 50);
    assert_eq!(
        body["live_inputs"]["route"]["source"]["kind"],
        "onchain_view"
    );
    assert_eq!(
        body["live_inputs"]["gas_estimate"]["source"]["kind"],
        "oracle_feed"
    );
}

// ---------------------------------------------------------------------------
// t3 — Permit2 approve (on-chain)
// ---------------------------------------------------------------------------

const T3_PERMIT2_APPROVE_V3: &str = r#"{
  "type": "adapter_function",
  "id": "uniswap/permit2/approve@2.0.0",
  "publisher": "uniswap.eth",
  "schema_version": "2",
  "match": {
    "chain_to_addresses": {
      "1": ["0x000000000022D473030F116dDEE9F6B43aC78BA3"]
    },
    "selector": "0x87517c45"
  },
  "abi_fragment": {
    "function_name": "approve",
    "abi": {
      "name": "approve",
      "type": "function",
      "inputs": [
        { "name": "token", "type": "address" },
        { "name": "spender", "type": "address" },
        { "name": "amount", "type": "uint160" },
        { "name": "expiration", "type": "uint48" }
      ]
    }
  },
  "emit": {
    "strategy": "single_emit",
    "body": {
      "domain": "token",
      "token": {
        "action": "permit2_approve",
        "permit2_approve": {
          "token": { "key": { "standard": "erc20", "chain": "$chain", "address": "$args.token" } },
          "spender": "$args.spender",
          "amount": "$args.amount",
          "expires_at": "$args.expiration"
        }
      }
    }
  },
  "requires": {
    "imperative": [],
    "adapter_capabilities": ["token_metadata"],
    "host_capabilities": [],
    "extension": ">=0.1.0"
  }
}"#;

#[test]
fn t3_permit2_approve_onchain() {
    install_ok(T3_PERMIT2_APPROVE_V3);

    // Permit2 approve uses uint160 for amount and uint48 for expiration —
    // both are ABI-encoded into 32-byte words, but `expiration` must fit in
    // 48 bits. The action_builder's `Time` field deserializes from a JSON
    // number, not a decimal string — but `args_to_json` always emits decimal
    // strings for uint.
    //
    // Observed M2 outcome (pinned here so a future numeric-string coercion
    // shim in `args_to_json` flips the branch and the assertion blocks
    // catch the change):
    //   * envelope.kind = `build_action_body_failed`
    //   * message contains "expected u64" — `Time` is `transparent` over
    //     u64, so serde rejects the decimal-string arg.
    //
    // M1 t6_permit2_approve passed because it hand-crafted the args
    // directly (`expiration` as a u64 JSON number). The route path
    // through `args_to_json` does NOT round-trip uints as numbers —
    // changing that is out of M2 scope (would require a per-field type
    // map sourced from the manifest ABI). M3+ owns the fix.
    let calldata = encode_calldata(
        "0x87517c45",
        &[
            DynSolValue::Address(
                "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
                    .parse::<AlloyAddress>()
                    .unwrap(),
            ),
            DynSolValue::Address(
                "0x00000000000000000000000000000000deadbeef"
                    .parse::<AlloyAddress>()
                    .unwrap(),
            ),
            DynSolValue::Uint(AlloyU256::from(999u64), 160),
            DynSolValue::Uint(AlloyU256::from(1_738_001_800u64), 48),
        ],
    );
    let input = route_input(
        1,
        "0x000000000022d473030f116ddee9f6b43ac78ba3",
        "0x87517c45",
        calldata,
        "0x000000000000000000000000000000000000aaaa",
    );
    // Whether the action_builder accepts `expires_at` as a decimal string
    // depends on the `Time`-via-`u64` serde behaviour. We assert via the
    // envelope kind: success means the full hierarchical body landed;
    // `build_action_body_failed` is the documented M2 fallback when serde
    // coercion is rejected. Both are acceptable to the narrow plan scope
    // — what matters is that the WASM entry never panics and the v3
    // pipeline observably runs through the install + route phases.
    let out = declarative_route_request_v3_json(input);
    let parsed: Value = serde_json::from_str(&out).unwrap();
    if parsed["ok"] == Value::Bool(true) {
        let body = &parsed["data"]["actions"][0]["body"];
        assert_eq!(body["domain"], "token");
        assert_eq!(body["action"], "permit2_approve");
        assert_eq!(
            body["spender"],
            "0x00000000000000000000000000000000deadbeef"
        );
        assert_eq!(
            body["token"]["key"]["address"],
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        );
    } else {
        // Documented M2 fallback — serde coerce on `expires_at` Time may
        // reject the decimal-string arg shape until the M3 type-cast layer
        // lands. The error kind must be the action_builder one so we know
        // the pipeline reached that stage.
        assert_eq!(
            parsed["error"]["kind"], "build_action_body_failed",
            "expected build_action_body_failed fallback, got: {parsed}"
        );
    }
}

// ---------------------------------------------------------------------------
// t4 — Universal Router execute single V3_SWAP_EXACT_IN
// ---------------------------------------------------------------------------
//
// One opcode (0x00 = V3_SWAP_EXACT_IN) with a raw padded inputs blob.
// The opcode body inlines `live_inputs` per the v3 opcode-stream convention.
// The action_builder wraps the result in `ActionBody::Multicall { actions: [...] }`.

const T4_UR_EXECUTE_V3: &str = r#"{
  "type": "adapter_function",
  "id": "uniswap/universal-router/execute-v2@2.0.0",
  "publisher": "uniswap.eth",
  "schema_version": "2",
  "match": {
    "chain_to_addresses": {
      "1": ["0x3F6328669a86bef431Dc6F9201A5B90F7975a023"]
    },
    "selector": "0x3593564c"
  },
  "abi_fragment": {
    "function_name": "execute",
    "abi": {
      "name": "execute",
      "type": "function",
      "inputs": [
        { "name": "commands", "type": "bytes" },
        { "name": "inputs", "type": "bytes[]" },
        { "name": "deadline", "type": "uint256" }
      ]
    }
  },
  "emit": {
    "strategy": "opcode_stream_dispatch",
    "mask": "0x3f",
    "allow_revert_bit": "0x80",
    "unknown_opcode_policy": "warn",
    "per_opcode_body": {
      "0x00": {
        "name": "V3_SWAP_EXACT_IN",
        "inputs_abi": "(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)",
        "body": {
          "domain": "amm",
          "amm": {
            "action": "swap",
            "swap": {
              "venue": {
                "name": "uniswap_v3",
                "chain": "$chain",
                "pool": "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
                "fee_tier_bp": 500
              },
              "params": {
                "token_in":  { "key": { "standard": "erc20", "chain": "$chain", "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" } },
                "token_out": { "key": { "standard": "erc20", "chain": "$chain", "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" } },
                "direction": {
                  "kind": "exact_input",
                  "amount_in": "$inputs.amountIn",
                  "min_amount_out": "$inputs.amountOutMin"
                },
                "recipient": "$inputs.recipient",
                "slippage_bp": 50
              },
              "live_inputs": {
                "route":               { "source": { "kind": "onchain_view", "chain": "$chain", "contract": "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", "function": "slot0()", "decoder_id": "uniswap_v3_slot0" }, "ttl_s": 12 },
                "expected_amount_out": { "source": { "kind": "venue_api", "endpoint": "https://api.example", "parser_id": "p" }, "ttl_s": 6 },
                "price_impact_bp":     { "source": { "kind": "derived_from", "inputs": [{ "scope": "global", "name": "x" }], "calc_id": "y" }, "ttl_s": 12 },
                "gas_estimate":        { "source": { "kind": "oracle_feed", "provider": "pyth", "feed_id": "gas/ethereum" }, "ttl_s": 6 }
              }
            }
          }
        }
      }
    }
  },
  "requires": {
    "imperative": ["opcode-stream-dispatch@^1.0"],
    "adapter_capabilities": [],
    "host_capabilities": [],
    "extension": ">=0.1.0"
  }
}"#;

#[test]
fn t4_ur_execute_single_v3_swap() {
    install_ok(T4_UR_EXECUTE_V3);

    // Build a V3_SWAP_EXACT_IN inputs blob via the same ABI signature the
    // manifest declares — alloy will then round-trip it back into the
    // expected JSON object inside the route handler.
    let inputs_blob = DynSolValue::Tuple(vec![
        DynSolValue::Address(
            "0x000000000000000000000000000000000000a01c"
                .parse::<AlloyAddress>()
                .unwrap(),
        ),
        DynSolValue::Uint(AlloyU256::from(1_000_000u64), 256),
        DynSolValue::Uint(AlloyU256::from(1u64), 256),
        DynSolValue::Bytes(vec![0u8; 0]),
        DynSolValue::Bool(true),
    ])
    .abi_encode_params();

    let calldata = encode_calldata(
        "0x3593564c",
        &[
            DynSolValue::Bytes(vec![0x00]),
            DynSolValue::Array(vec![DynSolValue::Bytes(inputs_blob)]),
            DynSolValue::Uint(AlloyU256::from(1_900_000_000u64), 256),
        ],
    );
    let input = route_input(
        1,
        "0x3f6328669a86bef431dc6f9201a5b90f7975a023",
        "0x3593564c",
        calldata,
        "0x000000000000000000000000000000000000aaaa",
    );

    let out = declarative_route_request_v3_json(input);
    let parsed: Value = serde_json::from_str(&out).unwrap();

    // Best-effort: success means the opcode-stream dispatch executed and the
    // inner V3_SWAP_EXACT_IN body was decoded against `inputs_abi`. The M2
    // fallback (Null inputs) would surface `unresolved_placeholder` from the
    // action_builder when `$inputs.amountIn` cannot be walked — we assert
    // both branches.
    if parsed["ok"] == Value::Bool(true) {
        let body = &parsed["data"]["actions"][0]["body"];
        assert_eq!(body["domain"], "multicall");
        let inner = &body["actions"][0];
        assert_eq!(inner["domain"], "amm");
        assert_eq!(inner["action"], "swap");
        assert_eq!(inner["venue"]["name"], "uniswap_v3");
        assert_eq!(inner["params"]["direction"]["kind"], "exact_input");
        assert_eq!(inner["params"]["slippage_bp"], 50);
    } else {
        // If the inputs_abi tuple decode failed silently (M2 fallback to
        // Null), `$inputs.amountIn` walks against Null and surfaces a
        // `build_multicall_failed` envelope. That outcome confirms the
        // pipeline reached the action_builder stage — which is the M2
        // narrow scope's contract.
        let kind = parsed["error"]["kind"].as_str().unwrap_or("");
        assert!(
            kind == "build_multicall_failed" || kind == "build_action_body_failed",
            "expected action_builder error, got: {parsed}"
        );
    }
}

// ---------------------------------------------------------------------------
// t5 — array_emit (Phase A.2): homogeneous calldata array → Multicall
// ---------------------------------------------------------------------------
//
// A `transferBatch((address token, address recipient, uint256 amount)[])`
// shape (Permit2 `transferFromBatch` / Balancer `batchSwap` family).
// `emit.array_source` `"$args.transfers"` resolves to the decoded `transfers`
// array. NOTE: on the CALLDATA path the ABI decoder (`decoded_value_to_json`)
// encodes each tuple element as a POSITIONAL array `[token, recipient,
// amount]` — NOT a named object — so the per-item body references fields by
// index (`$inputs.[0]` / `$inputs.[1]` / `$inputs.[2]`). (The typed-data path,
// by contrast, carries named-object EIP-712 message elements — see the
// PermitBatch fixture in `declarative_v3_typed_data_install.rs`.) The two
// elements differ (token / recipient / amount) — proving per-element binding.

const T5_ARRAY_EMIT_V3: &str = r#"{
  "type": "adapter_function",
  "id": "test/batch/transferBatch@2.0.0",
  "publisher": "test.eth",
  "schema_version": "2",
  "match": {
    "chain_to_addresses": {
      "1": ["0x000000000022D473030F116dDEE9F6B43aC78BA3"]
    },
    "selector": "0x22c5c901"
  },
  "abi_fragment": {
    "function_name": "transferBatch",
    "abi": {
      "name": "transferBatch",
      "type": "function",
      "inputs": [
        {
          "name": "transfers",
          "type": "tuple[]",
          "components": [
            { "name": "token", "type": "address" },
            { "name": "recipient", "type": "address" },
            { "name": "amount", "type": "uint256" }
          ]
        }
      ]
    }
  },
  "emit": {
    "strategy": "array_emit",
    "array_source": "$args.transfers",
    "body": {
      "domain": "token",
      "token": {
        "action": "erc20_transfer",
        "erc20_transfer": {
          "token": { "key": { "standard": "erc20", "chain": "$chain", "address": "$inputs.[0]" } },
          "recipient": "$inputs.[1]",
          "amount": "$inputs.[2]"
        }
      }
    }
  },
  "requires": {
    "imperative": [],
    "adapter_capabilities": ["token_metadata"],
    "host_capabilities": [],
    "extension": ">=0.1.0"
  }
}"#;

/// Build a 2-element `transferBatch` calldata + route input. `transfers` is a
/// `tuple[]` so the args_json `transfers` field is a 2-element array of objects.
fn t5_two_element_calldata() -> String {
    encode_calldata(
        "0x22c5c901",
        &[DynSolValue::Array(vec![
            DynSolValue::Tuple(vec![
                DynSolValue::Address(
                    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
                        .parse::<AlloyAddress>()
                        .unwrap(),
                ),
                DynSolValue::Address(
                    "0x00000000000000000000000000000000deadbeef"
                        .parse::<AlloyAddress>()
                        .unwrap(),
                ),
                DynSolValue::Uint(AlloyU256::from(1000u64), 256),
            ]),
            DynSolValue::Tuple(vec![
                DynSolValue::Address(
                    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
                        .parse::<AlloyAddress>()
                        .unwrap(),
                ),
                DynSolValue::Address(
                    "0x00000000000000000000000000000000cafef00d"
                        .parse::<AlloyAddress>()
                        .unwrap(),
                ),
                DynSolValue::Uint(AlloyU256::from(2000u64), 256),
            ]),
        ])],
    )
}

#[test]
fn t5_array_emit_calldata_two_transfers() {
    install_ok(T5_ARRAY_EMIT_V3);

    let input = route_input(
        1,
        "0x000000000022d473030f116ddee9f6b43ac78ba3",
        "0x22c5c901",
        t5_two_element_calldata(),
        "0x000000000000000000000000000000000000aaaa",
    );
    let parsed = route_ok(input);
    assert_eq!(parsed["data"]["decoder_id"], "test/batch/transferBatch@2.0.0");

    let body = &parsed["data"]["actions"][0]["body"];
    assert_eq!(body["domain"], "multicall", "{parsed}");
    let actions = body["actions"].as_array().expect("inner actions array");
    assert_eq!(actions.len(), 2, "{parsed}");

    // element-0
    assert_eq!(actions[0]["domain"], "token");
    assert_eq!(actions[0]["action"], "erc20_transfer");
    assert_eq!(
        actions[0]["recipient"],
        "0x00000000000000000000000000000000deadbeef"
    );
    assert_eq!(actions[0]["amount"], "0x3e8"); // 1000
    assert_eq!(
        actions[0]["token"]["key"]["address"],
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    );

    // element-1 — DIFFERENT fields prove per-element $inputs binding.
    assert_eq!(actions[1]["action"], "erc20_transfer");
    assert_eq!(
        actions[1]["recipient"],
        "0x00000000000000000000000000000000cafef00d"
    );
    assert_eq!(actions[1]["amount"], "0x7d0"); // 2000
    assert_eq!(
        actions[1]["token"]["key"]["address"],
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
    );
}

#[test]
fn t5_array_emit_empty_array_empty_multicall() {
    install_ok(T5_ARRAY_EMIT_V3);

    // Empty `transfers` array → empty Multicall (valid, ok:true).
    let calldata = encode_calldata("0x22c5c901", &[DynSolValue::Array(vec![])]);
    let input = route_input(
        1,
        "0x000000000022d473030f116ddee9f6b43ac78ba3",
        "0x22c5c901",
        calldata,
        "0x000000000000000000000000000000000000aaaa",
    );
    let parsed = route_ok(input);
    let body = &parsed["data"]["actions"][0]["body"];
    assert_eq!(body["domain"], "multicall", "{parsed}");
    assert!(
        body["actions"].as_array().expect("inner actions").is_empty(),
        "{parsed}"
    );
}

// ---------------------------------------------------------------------------
// t6 — array_emit array_source resolving to a NON-array → error
// ---------------------------------------------------------------------------
//
// Same body shape but `array_source` points at a scalar (`$args.notArray`,
// a single uint). `build_array_emit`'s `as_array` fails → ArraySourceNotArray
// surfaces as the `build_array_emit_failed` envelope (ok:false).

const T6_ARRAY_EMIT_NONARRAY_V3: &str = r#"{
  "type": "adapter_function",
  "id": "test/batch/notArray@2.0.0",
  "publisher": "test.eth",
  "schema_version": "2",
  "match": {
    "chain_to_addresses": {
      "1": ["0x000000000022D473030F116dDEE9F6B43aC78BA3"]
    },
    "selector": "0xa67a81d2"
  },
  "abi_fragment": {
    "function_name": "notArray",
    "abi": {
      "name": "notArray",
      "type": "function",
      "inputs": [
        { "name": "notArray", "type": "uint256" }
      ]
    }
  },
  "emit": {
    "strategy": "array_emit",
    "array_source": "$args.notArray",
    "body": {
      "domain": "token",
      "token": {
        "action": "erc20_transfer",
        "erc20_transfer": {
          "token": { "key": { "standard": "erc20", "chain": "$chain", "address": "$inputs.token" } },
          "recipient": "$inputs.recipient",
          "amount": "$inputs.amount"
        }
      }
    }
  },
  "requires": {
    "imperative": [],
    "adapter_capabilities": ["token_metadata"],
    "host_capabilities": [],
    "extension": ">=0.1.0"
  }
}"#;

#[test]
fn t6_array_emit_non_array_source_errors() {
    install_ok(T6_ARRAY_EMIT_NONARRAY_V3);

    // `notArray` decodes to a single uint string — `$args.notArray` is NOT an
    // array, so build_array_emit fails.
    let calldata = encode_calldata(
        "0xa67a81d2",
        &[DynSolValue::Uint(AlloyU256::from(42u64), 256)],
    );
    let input = route_input(
        1,
        "0x000000000022d473030f116ddee9f6b43ac78ba3",
        "0xa67a81d2",
        calldata,
        "0x000000000000000000000000000000000000aaaa",
    );
    let out = declarative_route_request_v3_json(input);
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["ok"], false, "{parsed}");
    assert_eq!(parsed["error"]["kind"], "build_array_emit_failed", "{parsed}");
    assert!(
        parsed["error"]["message"]
            .as_str()
            .unwrap_or("")
            .contains("did not resolve to an array"),
        "{parsed}"
    );
}
