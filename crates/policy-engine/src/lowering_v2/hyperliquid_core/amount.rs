//! Normalize an HL human-decimal amount to the EVM token amount projection.
//!
//! An HL fund-movement action (`usd_send` / `spot_send` / `vault_transfer` /
//! `sub_account_transfer`) carries its amount as a human decimal string
//! (e.g. `"250"`, `"500.25"`). The `Token::Erc20Transfer` context it now lowers
//! to expects the EVM 3-layer projection: `amount` (raw smallest-unit `U256`
//! hex) + the host-populated `amountNano` (`Long`). `amountUsd` (Cedar
//! `decimal`) stays host-populated and is NOT emitted here — every token leaf
//! omits it (see `token/erc20_transfer.rs`).

use policy_state::primitives::{Decimal, U256};

use super::super::common::amount::nano_from_decimals;
use super::super::common::cedar::u256_hex;

/// The amount layers a `Token::Erc20Transfer` context carries from a lowering.
pub(super) struct HlAmount {
    /// `context.amount` — raw smallest-unit `U256`, lower-hex.
    pub raw_hex: String,
    /// `context.amountNano` — `raw × 10^(9 − decimals)`, SATURATED to `i64::MAX`
    /// when too large (fail-CLOSED for a quantity cap). Always `Some` here
    /// (decimals are caller-supplied); the `Option` mirrors the EVM projection.
    pub nano: Option<i64>,
}

/// Normalize an HL human-decimal `amount` (e.g. `"250"`, `"500.25"`) with
/// `decimals` (USDC = 6) to raw smallest-unit hex + nano. Parses the decimal as
/// integer-part + fractional-part to avoid float error; pads/truncates the
/// fraction to `decimals` digits.
// Casts are over a tiny domain — `decimals` is a token-decimals count (≤ 18),
// so the int/scale conversions never truncate, wrap, or lose a sign.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
pub(super) fn hl_amount_projection(amount: &Decimal, decimals: u32) -> HlAmount {
    let s = amount.0.as_str();
    let (int_part, frac_part) = s.split_once('.').unwrap_or((s, ""));
    let mut digits = String::new();
    digits.push_str(int_part.trim_start_matches('+'));
    let mut frac: String = frac_part.chars().take(decimals as usize).collect();
    while (frac.len() as u32) < decimals {
        frac.push('0');
    }
    digits.push_str(&frac);
    let trimmed = digits.trim_start_matches('0');
    let raw = if trimmed.is_empty() {
        U256::ZERO
    } else {
        U256::from_str_radix(trimmed, 10).unwrap_or(U256::ZERO)
    };
    // Reuse the shared SATURATE-CLOSED nano projection: an HL amount too large for
    // i64 saturates to i64::MAX (so an `amountNano >= N` quantity cap fails CLOSED)
    // rather than omitting the field — which would fail OPEN, letting the order
    // ride past the cap. Decimals are caller-supplied (always known) here.
    let nano = Some(nano_from_decimals(
        raw,
        u8::try_from(decimals).unwrap_or(u8::MAX),
    ));
    HlAmount {
        raw_hex: u256_hex(raw),
        nano,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use policy_state::primitives::Decimal;

    #[test]
    fn usdc_250_normalizes() {
        // 250 USDC, 6 dp → raw 250_000000 → hex 0xee6b280; nano = raw*10^(9-6)=2.5e11.
        let p = hl_amount_projection(&Decimal::new("250"), 6);
        assert_eq!(p.raw_hex, "0xee6b280");
        assert_eq!(p.nano, Some(250_000_000_000));
    }

    #[test]
    fn fractional_round_trips() {
        let p = hl_amount_projection(&Decimal::new("500.25"), 6);
        assert_eq!(p.raw_hex, "0x1dd13590"); // 500_250000
        assert_eq!(p.nano, Some(500_250_000_000));
    }

    #[test]
    fn zero_amount_is_zero_hex() {
        let p = hl_amount_projection(&Decimal::new("0"), 6);
        assert_eq!(p.raw_hex, "0x0");
        assert_eq!(p.nano, Some(0));
    }

    /// An astronomically large HL amount must SATURATE to i64::MAX (fail-CLOSED so
    /// an `amountNano >= N` quantity cap still fires), NOT omit amountNano — which
    /// would fail OPEN, letting the order ride past the cap.
    #[test]
    fn over_large_amount_saturates_closed_not_omitted() {
        let huge = Decimal::new("99999999999999999999999999"); // ~10^26 USDC
        let p = hl_amount_projection(&huge, 6);
        assert_eq!(
            p.nano,
            Some(i64::MAX),
            "over-large HL nano must saturate to i64::MAX, never None (fail-open)"
        );
    }
}
