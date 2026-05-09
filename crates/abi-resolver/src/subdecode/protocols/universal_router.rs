//! Uniswap Universal Router opcode table (Cat B).
//!
//! Each entry maps an opcode (after applying the table's `mask` — see
//! [`UNISWAP_UR_TABLE`]) to its name and a list of candidate Solidity tuple
//! types to try for `inputs[i]`. The list approach handles the fact that the
//! V2/V3 swap opcode schemas changed between deployments: the current
//! `Dispatcher.sol` on `main` uses
//! `(address,uint256,uint256,bytes,bool,uint256[])` (with
//! `uint256[] minHopPriceX36`), while earlier deployments still in production
//! use the shorter `(address,uint256,uint256,bytes,bool)` shape. We list
//! both and the engine picks whichever decodes cleanly.
//!
//! The opcode set itself was cross-checked against the upstream
//! `contracts/libraries/Commands.sol` and `contracts/base/Dispatcher.sol`
//! (Uniswap/universal-router @ `main`). Placeholder ranges (0x0f, 0x15-0x20,
//! 0x22-0x3f, 0x41-0x5f) are intentionally omitted — the dispatcher reverts
//! on those, and our engine falls back to `UNKNOWN(raw …)` which is the
//! right under-decode behaviour.
//!
//! Coverage is partial: opcodes whose `inputs[i]` is a complex variable-
//! length struct (`PERMIT2_PERMIT*`, NPM permits/calls, V4_SWAP) are
//! recognised by name but kept as raw bytes for now. Adding their schemas
//! is independent of the engine.

use crate::subdecode::opcode_stream::{OpcodeEntry, OpcodeTable};

/// Uniswap UR command bytes use the high bit (`0x80`) for `allowRevert`.
pub const UNISWAP_UR_MASK: u8 = 0x7f;
/// Bit set on a command byte when its revert should be tolerated by the
/// dispatcher.
pub const UNISWAP_UR_ALLOW_REVERT: u8 = 0x80;

/// Uniswap UR opcode dispatch table.
///
/// See `crates/abi-resolver/docs` (or the inventory in CLAUDE.md §3.2) for
/// the full reference list.
pub static UNISWAP_UR_TABLE: OpcodeTable = OpcodeTable {
    mask: UNISWAP_UR_MASK,
    allow_revert_bit: UNISWAP_UR_ALLOW_REVERT,
    entries: ENTRIES,
};

const ENTRIES: &[OpcodeEntry] = &[
    // 0x00 V3_SWAP_EXACT_IN — current Dispatcher.sol uses the 6-tuple with
    // minHopPriceX36; older deployments use the 5-tuple shape.
    OpcodeEntry {
        opcode: 0x00,
        name: "V3_SWAP_EXACT_IN",
        input_signatures: &[
            "(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser, uint256[] minHopPriceX36)",
            "(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)",
        ],
    },
    OpcodeEntry {
        opcode: 0x01,
        name: "V3_SWAP_EXACT_OUT",
        input_signatures: &[
            "(address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser, uint256[] minHopPriceX36)",
            "(address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)",
        ],
    },
    OpcodeEntry {
        opcode: 0x02,
        name: "PERMIT2_TRANSFER_FROM",
        input_signatures: &["(address token, address recipient, uint160 amount)"],
    },
    OpcodeEntry {
        opcode: 0x03,
        name: "PERMIT2_PERMIT_BATCH",
        input_signatures: &[
            "(((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature)",
        ],
    },
    OpcodeEntry {
        opcode: 0x04,
        name: "SWEEP",
        input_signatures: &["(address token, address recipient, uint256 amountMin)"],
    },
    OpcodeEntry {
        opcode: 0x05,
        name: "TRANSFER",
        input_signatures: &["(address token, address recipient, uint256 value)"],
    },
    OpcodeEntry {
        opcode: 0x06,
        name: "PAY_PORTION",
        input_signatures: &["(address token, address recipient, uint256 bips)"],
    },
    // 0x07 — Uniswap-only opcode (Pancake UR has placeholder here).
    OpcodeEntry {
        opcode: 0x07,
        name: "PAY_PORTION_FULL_PRECISION",
        input_signatures: &["(address token, address recipient, uint256 portion)"],
    },
    OpcodeEntry {
        opcode: 0x08,
        name: "V2_SWAP_EXACT_IN",
        input_signatures: &[
            "(address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser, uint256[] minHopPriceX36)",
            "(address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)",
        ],
    },
    OpcodeEntry {
        opcode: 0x09,
        name: "V2_SWAP_EXACT_OUT",
        input_signatures: &[
            "(address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser, uint256[] minHopPriceX36)",
            "(address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser)",
        ],
    },
    OpcodeEntry {
        opcode: 0x0a,
        name: "PERMIT2_PERMIT",
        input_signatures: &[
            "(((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)",
        ],
    },
    OpcodeEntry {
        opcode: 0x0b,
        name: "WRAP_ETH",
        input_signatures: &["(address recipient, uint256 amountMin)"],
    },
    OpcodeEntry {
        opcode: 0x0c,
        name: "UNWRAP_WETH",
        input_signatures: &["(address recipient, uint256 amountMin)"],
    },
    OpcodeEntry {
        opcode: 0x0d,
        name: "PERMIT2_TRANSFER_FROM_BATCH",
        input_signatures: &[
            "((address from, address to, uint160 amount, address token)[] transferDetails)",
        ],
    },
    OpcodeEntry {
        opcode: 0x0e,
        name: "BALANCE_CHECK_ERC20",
        input_signatures: &["(address owner, address token, uint256 minBalance)"],
    },
    OpcodeEntry {
        opcode: 0x10,
        name: "V4_SWAP",
        // Top-level shape is a 2-tuple `(bytes actions, bytes[] params)` —
        // the inner `actions` byte stream and per-action `params[i]` are
        // dispatched by the V4Router opcode table (Actions.sol), which is
        // not yet wired up here. Decoding the outer pair still gives the
        // user a peek at the action byte string and parameter sub-blobs.
        input_signatures: &["(bytes actions, bytes[] params)"],
    },
    OpcodeEntry {
        opcode: 0x11,
        name: "V3_POSITION_MANAGER_PERMIT",
        // Input is a complete calldata for the V3 NonfungiblePositionManager
        // (selector + ABI args), `address(V3_POSITION_MANAGER).call(inputs)`
        // upstream. Decoding it cleanly needs Cat A nested recursion through
        // the resolver against the NPM ABI — out of PR3 scope.
        input_signatures: &[],
    },
    OpcodeEntry {
        opcode: 0x12,
        name: "V3_POSITION_MANAGER_CALL",
        // Same as 0x11: input IS NPM calldata, not a tuple. Recurse via
        // resolver in a follow-up PR.
        input_signatures: &[],
    },
    OpcodeEntry {
        opcode: 0x13,
        name: "V4_INITIALIZE_POOL",
        input_signatures: &[
            "((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint160 sqrtPriceX96)",
        ],
    },
    OpcodeEntry {
        opcode: 0x14,
        name: "V4_POSITION_MANAGER_CALL",
        // Input is a complete calldata for V4 PositionManager
        // (selector + args), forwarded via `.call(inputs)` upstream. Decoding
        // requires Cat A nested recursion through the resolver — same reason
        // as 0x11 / 0x12.
        input_signatures: &[],
    },
    OpcodeEntry {
        opcode: 0x21,
        name: "EXECUTE_SUB_PLAN",
        // Top-level shape is `(bytes commands, bytes[] inputs)` — the same
        // pair shape as the outer `execute(...)` entrypoint. The orchestrator
        // would ideally re-dispatch this through the same UR opcode table
        // (self-recursive Cat B); for now we surface the inner pair so the
        // user can at least see the nested commands byte stream.
        input_signatures: &["(bytes commands, bytes[] inputs)"],
    },
    // 0x40 — third-party integration: Across V3 bridge deposit. The struct
    // matches `AcrossV4DepositV3Params` in
    // `contracts/interfaces/IUniversalRouter.sol`.
    OpcodeEntry {
        opcode: 0x40,
        name: "ACROSS_V4_DEPOSIT_V3",
        input_signatures: &[
            "((address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message, bool useNative) params)",
        ],
    },
];

/// Selector for `execute(bytes,bytes[],uint256)` — the deadline-checked
/// Universal Router entrypoint. Most production txs use this overload.
pub const EXECUTE_DEADLINE_SELECTOR: [u8; 4] = [0x35, 0x93, 0x56, 0x4c];
/// Selector for `execute(bytes,bytes[])` — no deadline.
pub const EXECUTE_SELECTOR: [u8; 4] = [0x24, 0x85, 0x6b, 0xc3];

/// True when the selector matches one of the public Universal Router
/// `execute` overloads.
#[must_use]
pub fn is_universal_router_execute(selector: &[u8; 4]) -> bool {
    matches!(*selector, EXECUTE_DEADLINE_SELECTOR | EXECUTE_SELECTOR)
}

/// Pull the `(commands, inputs)` pair out of a decoded `execute(...)` call.
///
/// Both UR overloads put `commands` at arg index 0 and `inputs` at arg index
/// 1; the deadline (when present) is arg 2 and is ignored here. Returns
/// `None` when the args don't structurally match — e.g. when callers pass a
/// non-execute decoded call by accident.
#[must_use]
pub fn extract_commands_and_inputs(
    decoded: &crate::decode::DecodedCall,
) -> Option<(Vec<u8>, Vec<Vec<u8>>)> {
    if decoded.args.len() < 2 {
        return None;
    }
    let alloy_dyn_abi::DynSolValue::Bytes(commands) = &decoded.args[0].value else {
        return None;
    };
    let alloy_dyn_abi::DynSolValue::Array(items) = &decoded.args[1].value else {
        return None;
    };
    let mut inputs = Vec::with_capacity(items.len());
    for v in items {
        let alloy_dyn_abi::DynSolValue::Bytes(b) = v else {
            return None;
        };
        inputs.push(b.clone());
    }
    Some((commands.clone(), inputs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subdecode::opcode_stream::dispatch;
    use alloy_dyn_abi::{DynSolValue, JsonAbiExt};
    use alloy_json_abi::Function;
    use alloy_primitives::{Address, U256};

    fn encode_wrap_eth_input(recipient: [u8; 20], amount: u128) -> Vec<u8> {
        let func = Function::parse("step(address,uint256)").unwrap();
        let values = vec![
            DynSolValue::Address(Address::from(recipient)),
            DynSolValue::Uint(U256::from(amount), 256),
        ];
        let raw = func.abi_encode_input(&values).unwrap();
        raw[4..].to_vec()
    }

    #[test]
    fn execute_selectors_recognised() {
        assert!(is_universal_router_execute(&EXECUTE_DEADLINE_SELECTOR));
        assert!(is_universal_router_execute(&EXECUTE_SELECTOR));
        assert!(!is_universal_router_execute(&[0x09, 0x5e, 0xa7, 0xb3]));
    }

    #[test]
    fn dispatch_decodes_wrap_then_unwrap() {
        let commands = vec![0x0b, 0x0c];
        let inputs = vec![
            encode_wrap_eth_input([0xaa; 20], 1_000_000),
            encode_wrap_eth_input([0xbb; 20], 2_000_000),
        ];
        let steps = dispatch(&commands, &inputs, &UNISWAP_UR_TABLE);
        assert_eq!(steps[0].name, "WRAP_ETH");
        assert_eq!(steps[1].name, "UNWRAP_WETH");
        assert!(steps[0].args.is_some());
        assert!(steps[1].args.is_some());
    }

    #[test]
    fn opcodes_without_schema_keep_label() {
        let commands = vec![0x10, 0x21]; // V4_SWAP, EXECUTE_SUB_PLAN
        let inputs = vec![vec![0x00], vec![0x01]];
        let steps = dispatch(&commands, &inputs, &UNISWAP_UR_TABLE);
        assert_eq!(steps[0].name, "V4_SWAP");
        assert_eq!(steps[1].name, "EXECUTE_SUB_PLAN");
        assert!(steps[0].args.is_none());
        assert!(steps[1].args.is_none());
    }
}
