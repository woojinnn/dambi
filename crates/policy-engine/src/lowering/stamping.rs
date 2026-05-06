//! Enrichment utilities that stamp optional policy context before evaluation.
//!
//! - `enrich_with_usd`: add input/minOutput USD valuation to swap actions.
//! - `enrich_request_with_capabilities`: add portfolio + approval-derived
//!   policy context for swap actions (only when capability data exists).
//! - `enrich_tx_request_with_window_stats`: add projected swap window keys.
//!   Policies must guard `context has "windowStats"` before reading keys.

use crate::context_keys::{
    ACTOR_BALANCE_INPUT_TOKEN, ALLOWANCE_COVERS_INPUT, CURRENT_ALLOWANCE, EXTN_ARG, EXTN_DECIMAL,
    EXTN_FN, EXTN_KEY, INPUT_FRACTION_OF_BALANCE_BPS, WINDOW_STATS,
};
use crate::core::{Action, AmountSpec, SwapAction, UsdValuation};
use crate::host::stat_windows::{StatDelta, StatKey, StatValue};
use crate::host::HostCapabilities;
use crate::host::Oracle;
use crate::policy::PolicyRequest;
use alloy_primitives::U256;
use serde_json::Value;

/// Walk a swap action's amount specs and populate `usd` valuations from the
/// oracle. Missing prices leave `usd` as `None` — fail-open by default; the
/// policy layer chooses fail-closed via `has "usd"`.
pub fn enrich_with_usd(action: &mut Action, oracle: &dyn Oracle) {
    match action {
        Action::Swap(s) => populate_usd(s, oracle),
        Action::Multi(m) => enrich_actions_with_usd(&mut m.children, oracle),
        Action::Other { .. } => {}
    }
}

pub fn enrich_actions_with_usd(actions: &mut [Action], oracle: &dyn Oracle) {
    for action in actions {
        enrich_with_usd(action, oracle);
    }
}

fn populate_usd(s: &mut crate::core::SwapAction, oracle: &dyn Oracle) {
    if let Ok(v) = oracle.price(&s.input_amount.token) {
        s.input_amount.usd = Some(scaled_usd(
            &s.input_amount.raw,
            s.input_amount.token.decimals,
            &v,
        ));
    }
    if let Some(min) = s.min_output_amount.as_mut() {
        if let Ok(v) = oracle.price(&min.token) {
            min.usd = Some(scaled_usd(&min.raw, min.token.decimals, &v));
        }
    }
}

fn scaled_usd(raw: &str, decimals: u32, valuation: &UsdValuation) -> UsdValuation {
    let value = super::decimal::multiply_decimal_strings(raw, decimals, &valuation.value);
    UsdValuation {
        value,
        as_of_ts: valuation.as_of_ts,
        sources: valuation.sources.clone(),
        stale_sec: valuation.stale_sec,
    }
}

/// Stamp tx-level `windowStats` so it reflects post-this-tx projected state.
/// Callers can pass `pending_deltas` when they do not already hold a reservation
/// so the snapshot is projected with this tx's intent.
pub fn enrich_tx_request_with_window_stats(
    tx_request: &mut PolicyRequest,
    actor: &crate::core::Address,
    keys: &[StatKey],
    pending_deltas: &[StatDelta],
    host: &HostCapabilities,
) {
    let Some(context) = tx_request.context.as_object_mut() else {
        return;
    };

    let Some(stats) = host.stats() else {
        return;
    };

    let snapshot = stats.snapshot(actor, keys);
    let mut window_stats = serde_json::Map::new();

    for key in keys {
        let mut value = snapshot.get(key).cloned();
        for delta in pending_deltas.iter().filter(|delta| &delta.key == key) {
            value = Some(match value {
                None => delta.value.clone(),
                Some(mut base) => match (&mut base, &delta.value) {
                    (StatValue::Decimal(left), StatValue::Decimal(right)) => {
                        *left = super::decimal::add_decimal_strings(left, right);
                        base
                    }
                    (StatValue::Count(left), StatValue::Count(right)) => {
                        *left = left.saturating_add(*right);
                        base
                    }
                    (other, _) => other.clone(),
                },
            });
        }

        if let Some(value) = value {
            match value {
                StatValue::Decimal(value) => {
                    let mut extn = serde_json::Map::new();
                    extn.insert(EXTN_FN.into(), Value::from(EXTN_DECIMAL));
                    extn.insert(EXTN_ARG.into(), Value::from(value));
                    window_stats.insert(
                        key.as_str().into(),
                        Value::Object({
                            let mut outer = serde_json::Map::new();
                            outer.insert(EXTN_KEY.into(), Value::Object(extn));
                            outer
                        }),
                    );
                }
                StatValue::Count(value) => {
                    window_stats.insert(key.as_str().into(), Value::from(value));
                }
            }
        }
    }

    if !window_stats.is_empty() {
        context.insert(WINDOW_STATS.into(), Value::Object(window_stats));
    }
}

pub fn compute_swap_window_deltas(leaves: &[Action]) -> Vec<StatDelta> {
    let mut swap_volume_24h: Option<String> = None;
    let mut swap_count_24h: i64 = 0;

    for action in leaves {
        let Action::Swap(s) = action else {
            continue;
        };
        swap_count_24h = swap_count_24h.saturating_add(1);

        if let Some(usd) = &s.input_amount.usd {
            swap_volume_24h = Some(match swap_volume_24h {
                Some(previous) => super::decimal::add_decimal_strings(&previous, &usd.value),
                None => usd.value.clone(),
            });
        }
    }

    let mut deltas = Vec::new();
    if let Some(value) = swap_volume_24h {
        deltas.push(StatDelta {
            key: StatKey::SWAP_VOLUME_USD_24H,
            value: StatValue::Decimal(value),
        });
    }
    if swap_count_24h > 0 {
        deltas.push(StatDelta {
            key: StatKey::SWAP_COUNT_24H,
            value: StatValue::Count(swap_count_24h),
        });
    }
    deltas
}

pub fn enrich_request_with_capabilities(
    request: &mut PolicyRequest,
    action: &Action,
    host: &HostCapabilities,
) {
    let Some(context) = request.context.as_object_mut() else {
        return;
    };
    let Action::Swap(s) = action else {
        return;
    };

    stamp_portfolio_fields(context, s, host);
    if !s.input_token.is_native {
        stamp_approval_fields(context, s, host);
    }
}

fn stamp_portfolio_fields(
    context: &mut serde_json::Map<String, Value>,
    s: &SwapAction,
    host: &HostCapabilities,
) {
    let Some(portfolio) = host.portfolio() else {
        return;
    };
    let Ok(balance) = portfolio.balance(&s.actor, &s.input_token) else {
        return;
    };
    let balance_forced_usd = inject_amount_usd(balance.clone(), host.oracle());
    if let Value::Object(balance_obj) = balance_forced_usd {
        context.insert(ACTOR_BALANCE_INPUT_TOKEN.into(), Value::Object(balance_obj));
    }

    if let Some(fraction_bps) = input_fraction_bps(&s.input_amount, &balance) {
        context.insert(
            INPUT_FRACTION_OF_BALANCE_BPS.into(),
            Value::from(fraction_bps),
        );
    }
}

fn stamp_approval_fields(
    context: &mut serde_json::Map<String, Value>,
    s: &SwapAction,
    host: &HostCapabilities,
) {
    let Some(approvals) = host.approvals() else {
        return;
    };
    let Ok(allowance) = approvals.allowance(&s.actor, &s.input_token, &s.target) else {
        return;
    };

    let allowance_forced_usd = inject_amount_usd(allowance.clone(), host.oracle());
    if let Value::Object(allowance_obj) = allowance_forced_usd {
        context.insert(CURRENT_ALLOWANCE.into(), Value::Object(allowance_obj));
    }
    let allowance_covers_input =
        amount_raw_u256(&allowance.raw) >= amount_raw_u256(&s.input_amount.raw);
    context.insert(
        ALLOWANCE_COVERS_INPUT.into(),
        Value::from(allowance_covers_input),
    );
}

fn input_fraction_bps(input: &AmountSpec, balance: &AmountSpec) -> Option<i64> {
    let input_raw = amount_raw_u256(&input.raw);
    let balance_raw = amount_raw_u256(&balance.raw);

    if balance_raw.is_zero() {
        return None;
    }

    let ratio = input_raw.saturating_mul(U256::from(10_000u64)) / balance_raw;
    let max = U256::from(i64::MAX as u64);
    if ratio > max {
        Some(i64::MAX)
    } else {
        ratio.to_string().parse::<i64>().ok()
    }
}

fn amount_raw_u256(raw: &str) -> U256 {
    U256::from_str_radix(raw, 10).expect("invariant: amount raw string must be a valid U256")
}

fn inject_amount_usd(mut amount: AmountSpec, oracle: &dyn Oracle) -> Value {
    let token = amount.token.clone();
    if let Ok(v) = oracle.price(&token) {
        amount.usd = Some(scaled_usd(&amount.raw, amount.token.decimals, &v));
    }
    super::request::amount_json(&amount)
}
