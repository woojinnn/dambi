//! Universal Router command-stream dispatcher.
//!
//! Walks the `(commands, inputs)` pair produced by [`super::execute::decode_outer_call`]
//! and emits an `ActionEnvelope` per recognized opcode. Per-opcode decoding lives
//! in [`super::command_decode`].
//!
//! # Safety guards
//!
//! - `MAX_DEPTH` (4): caps `EXECUTE_SUB_PLAN` recursion depth (added in PR 2).
//! - `MAX_COMMANDS` (64): caps the number of commands per stream — bounds memory
//!   and CPU use against malicious or buggy calldata.
//! - Length mismatch (`commands.len() != inputs.len()`) → error.
//! - Unknown opcodes → error (no silent skips). Use the explicit "recognised
//!   non-swap" arm to opt out cleanly.

use policy_engine::action::{ActionEnvelope, Validity};

use crate::{AdapterError, CallContext};

use super::command_decode;

const V3_SWAP_EXACT_IN: u8 = 0x00;
const V3_SWAP_EXACT_OUT: u8 = 0x01;
const PERMIT2_TRANSFER_FROM: u8 = 0x02;
const PERMIT2_PERMIT_BATCH: u8 = 0x03;
const SWEEP: u8 = 0x04;
const TRANSFER: u8 = 0x05;
const PAY_PORTION: u8 = 0x06;
const PAY_PORTION_FULL_PRECISION: u8 = 0x07;
const V2_SWAP_EXACT_IN: u8 = 0x08;
const V2_SWAP_EXACT_OUT: u8 = 0x09;
const PERMIT2_PERMIT: u8 = 0x0a;
const WRAP_ETH: u8 = 0x0b;
const UNWRAP_WETH: u8 = 0x0c;
const PERMIT2_TRANSFER_FROM_BATCH: u8 = 0x0d;
const BALANCE_CHECK_ERC20: u8 = 0x0e;
const V4_SWAP_OPCODE: u8 = 0x10;
const V3_POSITION_MANAGER_PERMIT: u8 = 0x11;
const V3_POSITION_MANAGER_CALL: u8 = 0x12;
const V4_INITIALIZE_POOL: u8 = 0x13;
const V4_POSITION_MANAGER_CALL: u8 = 0x14;
const COMMAND_TYPE_MASK: u8 = 0x7f;

/// Maximum number of commands per stream (protects against memory exhaustion).
pub(super) const MAX_COMMANDS: usize = 64;

/// Maximum sub-plan recursion depth (protects against stack exhaustion via
/// `EXECUTE_SUB_PLAN` cycles). Used by PR 2 when sub-plan dispatch lands.
pub(super) const MAX_DEPTH: usize = 4;

/// Walk a UR command stream, dispatching each opcode to its decoder and
/// collecting the resulting envelopes.
///
/// `depth` tracks `EXECUTE_SUB_PLAN` recursion (top-level call passes `0`).
pub(super) fn expand_commands(
    ctx: &CallContext<'_>,
    commands: &[u8],
    inputs: &[Vec<u8>],
    validity: Option<Validity>,
    depth: usize,
) -> Result<Vec<ActionEnvelope>, AdapterError> {
    if depth > MAX_DEPTH {
        return Err(AdapterError::Invalid(format!(
            "Universal Router sub-plan depth exceeds max {MAX_DEPTH}"
        )));
    }
    if commands.len() != inputs.len() {
        return Err(AdapterError::Invalid(format!(
            "Universal Router length mismatch: {} commands, {} inputs",
            commands.len(),
            inputs.len()
        )));
    }
    if commands.len() > MAX_COMMANDS {
        return Err(AdapterError::Invalid(format!(
            "Universal Router command count {} exceeds max {MAX_COMMANDS}",
            commands.len()
        )));
    }

    let mut envelopes = Vec::new();

    for (index, raw_opcode) in commands.iter().copied().enumerate() {
        let input = &inputs[index];
        let opcode = raw_opcode & COMMAND_TYPE_MASK;
        match opcode {
            V3_SWAP_EXACT_IN => {
                envelopes.push(command_decode::v3_swap_exact_in::decode(
                    ctx,
                    input,
                    validity.clone(),
                )?);
            }
            V3_SWAP_EXACT_OUT => {
                envelopes.push(command_decode::v3_swap_exact_out::decode(
                    ctx,
                    input,
                    validity.clone(),
                )?);
            }
            V2_SWAP_EXACT_IN => {
                envelopes.push(command_decode::v2_swap_exact_in::decode(
                    ctx,
                    input,
                    validity.clone(),
                )?);
            }
            V2_SWAP_EXACT_OUT => {
                envelopes.push(command_decode::v2_swap_exact_out::decode(
                    ctx,
                    input,
                    validity.clone(),
                )?);
            }
            WRAP_ETH => {
                envelopes.push(command_decode::wrap_eth::decode(ctx, input)?);
            }
            UNWRAP_WETH => {
                envelopes.push(command_decode::unwrap_weth::decode(ctx, input)?);
            }
            V4_SWAP_OPCODE => {
                envelopes.extend(command_decode::v4_swap::decode(
                    ctx,
                    input,
                    validity.clone(),
                )?);
            }
            // ── Recognised non-swap commands — intentionally ignored ─────
            //
            // Permit2 family: permit semantics are gated on the *sign* side
            // by `sign_resolver::adapters::permit2`, which evaluates the
            // typed-data signature the wallet showed the user before the
            // swap calldata was even built. Inside UR these commands just
            // replay the same permit (or `transferFrom`) the user already
            // authorised, so we emit no extra envelope here.
            //
            // Settlement/utility (SWEEP, TRANSFER, PAY_PORTION,
            // PAY_PORTION_FULL_PRECISION, BALANCE_CHECK_ERC20): plumbing
            // around the swap result. Don't change user intent. Will be
            // absorbed by the merge step (PR 3); explicit recognition here
            // ensures they don't trigger the unknown-opcode error below.
            //
            // V3/V4 position manager (V3_POSITION_MANAGER_PERMIT,
            // V3_POSITION_MANAGER_CALL, V4_INITIALIZE_POOL,
            // V4_POSITION_MANAGER_CALL): liquidity-position operations
            // outside the current swap policy scope.
            PERMIT2_PERMIT
            | PERMIT2_PERMIT_BATCH
            | PERMIT2_TRANSFER_FROM
            | PERMIT2_TRANSFER_FROM_BATCH
            | SWEEP
            | TRANSFER
            | PAY_PORTION
            | PAY_PORTION_FULL_PRECISION
            | BALANCE_CHECK_ERC20
            | V3_POSITION_MANAGER_PERMIT
            | V3_POSITION_MANAGER_CALL
            | V4_INITIALIZE_POOL
            | V4_POSITION_MANAGER_CALL => {}
            other => {
                return Err(AdapterError::Invalid(format!(
                    "unsupported Universal Router command 0x{other:02x}"
                )));
            }
        }
    }

    Ok(envelopes)
}
