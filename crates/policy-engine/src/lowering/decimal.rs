//! Decimal helpers. `add_decimal_strings` keeps Cedar extension decimals at a
//! fixed 4-decimal precision so stat-window deltas serialize consistently.

use alloy_primitives::U256;

/// Cedar decimal fractional precision used by this engine.
pub const DECIMAL_SCALE: u32 = 4;

pub(crate) fn add_decimal_strings(left: &str, right: &str) -> String {
    match (
        decimal_to_fixed(left, DECIMAL_SCALE),
        decimal_to_fixed(right, DECIMAL_SCALE),
    ) {
        (Some(left_fixed), Some(right_fixed)) => fixed_to_decimal(
            U256::from(left_fixed.saturating_add(right_fixed)),
            DECIMAL_SCALE,
        ),
        (Some(left_fixed), None) => fixed_to_decimal(U256::from(left_fixed), DECIMAL_SCALE),
        (None, Some(right_fixed)) => fixed_to_decimal(U256::from(right_fixed), DECIMAL_SCALE),
        (None, None) => zero_decimal(DECIMAL_SCALE),
    }
}

pub(super) fn decimal_to_fixed(s: &str, scale: u32) -> Option<u128> {
    let (whole, frac) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    if whole.is_empty() && frac.is_empty() {
        return None;
    }
    if !whole.chars().all(|ch| ch.is_ascii_digit()) || !frac.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }

    let mut frac_padded = String::from(frac);
    while frac_padded.len() < scale as usize {
        frac_padded.push('0');
    }
    if frac_padded.len() > scale as usize {
        frac_padded.truncate(scale as usize);
    }
    let combined = format!("{whole}{frac_padded}");
    combined.parse::<u128>().ok()
}

pub(super) fn fixed_to_decimal(value: U256, scale: u32) -> String {
    let value_str = value.to_string();
    let scale = scale as usize;
    let padded = if value_str.len() <= scale {
        format!("{}{}", "0".repeat(scale + 1 - value_str.len()), value_str)
    } else {
        value_str
    };
    let split = padded.len() - scale;
    let (whole, frac) = padded.split_at(split);
    if scale == 0 {
        whole.to_string()
    } else {
        format!("{whole}.{frac}")
    }
}

fn zero_decimal(scale: u32) -> String {
    fixed_to_decimal(U256::from(0u64), scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_to_fixed_pads_short_fraction() {
        assert_eq!(super::decimal_to_fixed("1.5", 4), Some(15000));
        assert_eq!(super::decimal_to_fixed("1", 4), Some(10000));
        assert_eq!(super::decimal_to_fixed("0", 4), Some(0));
    }

    #[test]
    fn decimal_to_fixed_truncates_long_fraction() {
        assert_eq!(super::decimal_to_fixed("1.123456", 4), Some(11234));
    }

    #[test]
    fn decimal_to_fixed_rejects_malformed_decimal() {
        assert_eq!(super::decimal_to_fixed("not-a-decimal", 4), None);
        assert_eq!(super::decimal_to_fixed("1.12x", 4), None);
    }

    #[test]
    fn add_decimal_strings_skips_malformed_operand() {
        assert_eq!(add_decimal_strings("1.00", "bad"), "1.0000");
        assert_eq!(add_decimal_strings("bad", "2.00"), "2.0000");
        assert_eq!(add_decimal_strings("bad", "also-bad"), "0.0000");
    }
}
