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
const V4_ACTION_TAKE_PORTION: u8 = 0x10;

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

    // Pass 1 — collect swaps + take_recipient + take_portion sidecar.
    let mut envelopes = Vec::new();
    let mut take_recipient: Option<Address> = None;
    let mut take_portion: Option<TakePortionInfo> = None;

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
            V4_ACTION_TAKE_PORTION => {
                // TAKE_PORTION(currency, recipient, bips) — dApp/aggregator
                // fee skim. Captured for SwapEnrichment so the wallet UI
                // can surface "X bps goes to Y".
                if let Some(info) = take_portion_from(step) {
                    take_portion = Some(info);
                }
            }
            // SETTLE / SETTLE_ALL / TAKE_PAIR / etc. — user→pool settlement
            // (already implicit in swap.amount_in) or pair-management ops.
            _ => continue,
        }
    }

    // Pass 2 — patch swap recipient + dApp fee enrichment.
    for env in &mut envelopes {
        let Action::Swap(s) = &mut env.action else {
            continue;
        };
        // Fix the recipient default. V4 swap params don't carry a recipient,
        // so inner decoders default to ctx.from; patch with TAKE's real
        // destination when present.
        if let Some(real_recipient) = take_recipient.as_ref() {
            if &s.recipient == ctx.from {
                s.recipient = real_recipient.clone();
            }
        }
        // Stamp dApp fee enrichment when TAKE_PORTION was seen.
        if let Some(info) = take_portion.as_ref() {
            s.enrichment.dapp_fee_bps = Some(info.bips);
            s.enrichment.dapp_fee_recipient = Some(info.recipient.clone());
        }
    }

    Ok(envelopes)
}

#[derive(Debug, Clone)]
struct TakePortionInfo {
    recipient: Address,
    bips: u32,
}

/// Extract the `recipient` field from a TAKE step's args. TAKE's input
/// signature is `(address currency, address recipient, uint256 amount)`,
/// so args[1] is the recipient.
fn take_recipient_from(step: &DecodedStep) -> Option<Address> {
    let args = step.args.as_ref()?;
    let recipient_arg = args.get(1)?;
    address_from(&recipient_arg.value)
}

/// Extract `(recipient, bips)` from a TAKE_PORTION step. Signature is
/// `(address currency, address recipient, uint256 bips)` so args[1] is
/// recipient, args[2] is bips. Caller drops the result silently when
/// either field can't be read — TAKE_PORTION is a best-effort enrichment,
/// not a correctness gate.
fn take_portion_from(step: &DecodedStep) -> Option<TakePortionInfo> {
    let args = step.args.as_ref()?;
    let recipient = address_from(&args.get(1)?.value)?;
    let DynSolValue::Uint(bips_u, _) = &args.get(2)?.value else {
        return None;
    };
    let bips = u32::try_from(*bips_u).ok()?;
    Some(TakePortionInfo { recipient, bips })
}

fn address_from(value: &DynSolValue) -> Option<Address> {
    use std::str::FromStr as _;
    let DynSolValue::Address(addr) = value else {
        return None;
    };
    Address::from_str(&format!("0x{}", hex::encode(addr.0))).ok()
}
