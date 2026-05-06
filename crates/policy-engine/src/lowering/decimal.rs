//! Decimal helpers keep `multiply_decimal_strings` and `add_decimal_strings` at a
//! fixed 4-decimal precision because Cedar extension decimals in this project are
//! serialized to 4 fractional places.

use alloy_primitives::U256;

pub(crate) fn multiply_decimal_strings(raw: &str, decimals: u32, price: &str) -> String {
    let raw_u = U256::from_str_radix(raw, 10).unwrap_or(U256::ZERO);

    const PRICE_SCALE: u32 = 4;
    let price_int = decimal_to_fixed(price, PRICE_SCALE);

    let product = raw_u.saturating_mul(U256::from(price_int));
    let scale = U256::from(10u64).pow(U256::from(decimals));
    let scaled = if scale.is_zero() {
        product
    } else {
        product / scale
    };

    fixed_to_decimal(scaled, PRICE_SCALE)
}

pub(crate) fn add_decimal_strings(left: &str, right: &str) -> String {
    let left_fixed = decimal_to_fixed(left, 4);
    let right_fixed = decimal_to_fixed(right, 4);
    let sum = left_fixed.saturating_add(right_fixed);
    fixed_to_decimal(
        U256::from_str_radix(&sum.to_string(), 10).unwrap_or(U256::ZERO),
        4,
    )
}

pub(super) fn decimal_to_fixed(s: &str, scale: u32) -> u128 {
    let (whole, frac) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    let mut frac_padded = String::from(frac);
    while frac_padded.len() < scale as usize {
        frac_padded.push('0');
    }
    if frac_padded.len() > scale as usize {
        frac_padded.truncate(scale as usize);
    }
    let combined = format!("{whole}{frac_padded}");
    combined.parse::<u128>().unwrap_or(0)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiply_decimal_strings_basic() {
        assert_eq!(multiply_decimal_strings("200000000", 6, "1.00"), "200.0000");
    }

    #[test]
    fn multiply_decimal_strings_weth_at_3000() {
        assert_eq!(
            multiply_decimal_strings("1000000000000000000", 18, "3000.0000"),
            "3000.0000"
        );
    }

    #[test]
    fn multiply_decimal_strings_fractional_token() {
        assert_eq!(
            multiply_decimal_strings("500000000000000000", 18, "3000.00"),
            "1500.0000"
        );
    }

    #[test]
    fn decimal_to_fixed_pads_short_fraction() {
        assert_eq!(super::decimal_to_fixed("1.5", 4), 15000);
        assert_eq!(super::decimal_to_fixed("1", 4), 10000);
        assert_eq!(super::decimal_to_fixed("0", 4), 0);
    }

    #[test]
    fn decimal_to_fixed_truncates_long_fraction() {
        assert_eq!(super::decimal_to_fixed("1.123456", 4), 11234);
    }
}
