//! UR command 0x10 V4_SWAP — `input = abi.encode(bytes actions, bytes[] params)`.
//!
//! V4Router takes a parallel command-stream of its own (action bytes + ABI-
//! encoded params) and dispatches against [`V4_ROUTER_TABLE`]. The four
//! swap actions emit `SwapAction` envelopes; the settlement actions
//! (SETTLE / TAKE / TAKE_PORTION) carry the real recipient and dApp-fee
//! bookkeeping that the swap action itself can't see.
//!
//! Two-pass design:
//!   1. Walk inner steps, building a `SwapAction` from each swap action
//!      and capturing the TAKE recipient / TAKE_PORTION (currency, recipient,
//!      bips) sidecar.
//!   2. Patch each swap envelope so its `recipient` matches the TAKE
//!      destination (when present), so the wallet UI shows where the user
//!      actually receives the output instead of the V4 default `ctx.from`.
//!
//! The dApp-fee enrichment recovered here is currently dropped (no field
//! on `SwapAction.enrichment` yet); PR 12 plumbs it through.

use abi_resolver::subdecode::opcode_stream::{dispatch as dispatch_opcodes, DecodedStep};
use abi_resolver::subdecode::protocols::v4_router::V4_ROUTER_TABLE;
use alloy_dyn_abi::DynSolValue;
use alloy_sol_types::{sol, SolValue};
use policy_engine::action::{Action, ActionEnvelope, Address, Validity};

use crate::{AdapterError, CallContext};

use super::super::v4_actions::{exact_input, exact_input_single, exact_output, exact_output_single};

// Inner V4 action opcodes (dispatched against V4_ROUTER_TABLE).
const V4_ACTION_SWAP_EXACT_IN_SINGLE: u8 = 0x06;
const V4_ACTION_SWAP_EXACT_IN: u8 = 0x07;
const V4_ACTION_SWAP_EXACT_OUT_SINGLE: u8 = 0x08;
const V4_ACTION_SWAP_EXACT_OUT: u8 = 0x09;
// Settlement actions — used for two-pass recipient patching, not emitted
// as their own envelopes.
const V4_ACTION_TAKE: u8 = 0x0e;
// const V4_ACTION_TAKE_PORTION: u8 = 0x10;  // captured for PR 12

sol! {
    #[allow(clippy::too_many_arguments)]
    struct V4SwapInput {
        bytes actions;
        bytes[] params;
    }
}

pub(in crate::multi_router) fn decode(
    ctx: &CallContext<'_>,
    input: &[u8],
    validity: Option<Validity>,
) -> Result<Vec<ActionEnvelope>, AdapterError> {
    let parsed = V4SwapInput::abi_decode_sequence(input, true)
        .map_err(|e| AdapterError::Invalid(format!("V4_SWAP outer decode failed: {e}")))?;
    let actions = parsed.actions.to_vec();
    let params: Vec<Vec<u8>> = parsed.params.iter().map(|b| b.to_vec()).collect();
    let steps = dispatch_opcodes(&actions, &params, &V4_ROUTER_TABLE);

    // Pass 1 — collect swaps + take recipient sidecar.
    let mut envelopes = Vec::new();
    let mut take_recipient: Option<Address> = None;

    for step in &steps {
        match step.opcode {
            V4_ACTION_SWAP_EXACT_IN_SINGLE => {
                envelopes.push(exact_input_single::decode(ctx, step, validity.clone())?);
            }
            V4_ACTION_SWAP_EXACT_IN => {
                envelopes.push(exact_input::decode(ctx, step, validity.clone())?);
            }
            V4_ACTION_SWAP_EXACT_OUT_SINGLE => {
                envelopes.push(exact_output_single::decode(ctx, step, validity.clone())?);
            }
            V4_ACTION_SWAP_EXACT_OUT => {
                envelopes.push(exact_output::decode(ctx, step, validity.clone())?);
            }
            V4_ACTION_TAKE => {
                // TAKE(currency, recipient, amount) — capture recipient.
                // If multiple TAKEs appear, the last one wins (typical V4
                // pattern is a single TAKE for the swap output).
                if let Some(r) = take_recipient_from(step) {
                    take_recipient = Some(r);
                }
            }
            // SETTLE / TAKE_PORTION / TAKE_PAIR / etc. are intentionally
            // unobserved here — they're either user→pool settlement (already
            // implicit in swap.amount_in) or fee/closure ops the simulator
            // would need richer state to reason about.
            _ => continue,
        }
    }

    // Pass 2 — patch swap recipient if a TAKE destination was seen and
    // the swap action's own recipient still defaults to ctx.from (V4
    // doesn't carry recipient in swap params, so the inner decoders fall
    // back to that default).
    if let Some(real_recipient) = take_recipient {
        for env in &mut envelopes {
            if let Action::Swap(s) = &mut env.action {
                if &s.recipient == ctx.from {
                    s.recipient = real_recipient.clone();
                }
            }
        }
    }

    Ok(envelopes)
}

/// Extract the `recipient` field from a TAKE step's args. TAKE's input
/// signature is `(address currency, address recipient, uint256 amount)`,
/// so args[1] is the recipient.
fn take_recipient_from(step: &DecodedStep) -> Option<Address> {
    use std::str::FromStr as _;
    let args = step.args.as_ref()?;
    let recipient_arg = args.get(1)?;
    let DynSolValue::Address(addr) = &recipient_arg.value else {
        return None;
    };
    Address::from_str(&format!("0x{}", hex::encode(addr.0))).ok()
}
