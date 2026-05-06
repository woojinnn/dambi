use crate::core::{Action, AmountSpec, UsdValuation};
use crate::host::HostCapabilities;
use crate::oracle::Oracle;
use crate::policy::PolicyRequest;
use crate::stat_windows::{StatDelta, StatKey, StatValue};
use alloy_primitives::U256;
use serde_json::{json, Value};

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

pub fn enrich_tx_request_with_window_stats(
    tx_request: &mut PolicyRequest,
    actor: &crate::core::Address,
    keys: &[StatKey],
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
        if let Some(value) = snapshot.get(key) {
            match value {
                StatValue::Decimal(value) => {
                    window_stats.insert(
                        key.as_str().into(),
                        json!({ "__extn": { "fn": "decimal", "arg": value } }),
                    );
                }
                StatValue::Count(value) => {
                    window_stats.insert(key.as_str().into(), Value::from(*value));
                }
            }
        }
    }

    if !window_stats.is_empty() {
        context.insert("windowStats".into(), Value::Object(window_stats));
    }
}

pub fn compute_swap_window_deltas(
    leaves: &[Action],
    leaf_requests: &[PolicyRequest],
) -> Vec<StatDelta> {
    let mut swap_volume_24h: Option<String> = None;
    let mut swap_count_24h: i64 = 0;

    let mut zip = leaves.iter().zip(leaf_requests.iter());
    for (action, leaf_request) in zip.by_ref() {
        if !matches!(action, Action::Swap(_)) {
            continue;
        }
        swap_count_24h = swap_count_24h.saturating_add(1);

        let maybe_value = leaf_request
            .context
            .get("inputAmount")
            .and_then(|input_amount| input_amount.get("usd"))
            .and_then(|usd| usd.get("value"))
            .and_then(|value| value.get("__extn"))
            .and_then(|extn| extn.get("arg"))
            .and_then(Value::as_str);

        if let Some(value) = maybe_value {
            swap_volume_24h = Some(match swap_volume_24h {
                Some(previous) => super::decimal::add_decimal_strings(&previous, value),
                None => value.to_string(),
            });
        }
    }

    let mut deltas = Vec::new();
    if let Some(value) = swap_volume_24h {
        deltas.push(StatDelta {
            key: StatKey::new("swap_volume_usd_24h"),
            value: StatValue::Decimal(value),
        });
    }
    if swap_count_24h > 0 {
        deltas.push(StatDelta {
            key: StatKey::new("swap_count_24h"),
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

    match action {
        Action::Swap(s) => {
            if let Some(portfolio) = host.portfolio() {
                if let Ok(balance) = portfolio.balance(&s.actor, &s.input_token) {
                    let balance_forced_usd = inject_amount_usd(balance.clone(), host.oracle());
                    if let Value::Object(balance_obj) = balance_forced_usd {
                        context.insert("actorBalanceInputToken".into(), Value::Object(balance_obj));
                    }

                    if let Some(fraction_bps) = input_fraction_bps(&s.input_amount, &balance) {
                        context.insert(
                            "inputFractionOfBalanceBps".into(),
                            Value::from(fraction_bps),
                        );
                    }
                }
            }

            if !s.input_token.is_native {
                if let Some(approvals) = host.approvals() {
                    if let Ok(allowance) = approvals.allowance(&s.actor, &s.input_token, &s.target)
                    {
                        let allowance_forced_usd =
                            inject_amount_usd(allowance.clone(), host.oracle());
                        if let Value::Object(allowance_obj) = allowance_forced_usd {
                            context.insert("currentAllowance".into(), Value::Object(allowance_obj));
                        }
                        let allowance_covers_input =
                            amount_raw_u256(&allowance.raw) >= amount_raw_u256(&s.input_amount.raw);
                        context.insert(
                            "allowanceCoversInput".into(),
                            Value::from(allowance_covers_input),
                        );
                    }
                }
            }
        }
        Action::Multi(_) => {}
        Action::Other { .. } => {}
    }
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
    U256::from_str_radix(raw, 10).unwrap_or(U256::ZERO)
}

fn inject_amount_usd(mut amount: AmountSpec, oracle: &dyn Oracle) -> Value {
    let token = amount.token.clone();
    if let Ok(v) = oracle.price(&token) {
        amount.usd = Some(scaled_usd(&amount.raw, amount.token.decimals, &v));
    }
    super::request::amount_json(&amount)
}
