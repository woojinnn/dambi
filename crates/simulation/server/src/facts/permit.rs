//! `permit.*` enrichment-fact namespace — off-chain permit valuation/horizon
//! derivations against the simulated `WalletState` (sim-server fact host,
//! ADR-009).
//!
//! These facts value an off-chain permit's allowance against the refrigerated
//! `TokenHolding.price_usd` `LiveField` and derive its deadline horizon from the
//! host clock. Every method in this module is a `server: sim-server` planned
//! method drawn from `schema/method-catalog.json` (namespace `permit.`).
//!
//! ## Scaffold contract (FROZEN dispatch, stub bodies)
//!
//! [`dispatch`] is generated to mirror the catalog 1:1 and is **frozen**: one arm
//! per sim-server `permit.*` method plus a catch-all. Devs filling in the bodies
//! must never edit the match. Each per-method fn currently returns
//! [`FactError::NotImplemented`] so the server still boots and serves the methods
//! that ARE implemented in sibling namespaces.
//!
//! ## Param shape contract
//!
//! Like the rest of `facts/`, `params` arrive as **lowered Cedar** shapes from
//! the extension (not `simulation-state` shapes):
//!   - `chain_id`: string (e.g. `"eip155:1"`)
//!   - `token`: lowered `Core::TokenRef`
//!     (`{ "key": { "standard", "chain", "address" } }`)
//!   - `amount`: hex-encoded `U256` string
//!   - `deadline`: unix-seconds Long (signature expiry)

use serde_json::{json, Value};

use simulation_state::primitives::U256;
use simulation_state::token::TokenKey;

use super::params::{param_asset_contract, param_chain_id, param_long, param_u256};
use super::FactCtx;
use super::FactError;

/// Dispatch a `permit.*` enrichment fact against `ctx`.
///
/// FROZEN at scaffold time: one arm per sim-server `permit.*` method from the
/// catalog, plus a catch-all. Do not edit this match when filling in bodies.
///
/// # Errors
///
/// Returns [`FactError::UnknownMethod`] when `method` is not a `permit.*` method
/// in this registry, [`FactError::NotImplemented`] when the matched fact body is
/// still a scaffold stub, or [`FactError::BadParams`] from an implemented body
/// whose `params` are missing/ill-shaped.
pub(super) fn dispatch(method: &str, params: &Value, ctx: &FactCtx) -> Result<Value, FactError> {
    match method {
        "permit.allowance_horizon" => allowance_horizon(params, ctx),
        _ => Err(FactError::UnknownMethod(method.into())),
    }
}

/// `permit.allowance_horizon` — USD valuation of an off-chain permit's allowance
/// AND the validity horizon of its deadline, from one call (GEN-03). Emits TWO
/// context fields: `allowanceUsd = amount × token price_value` (state read) and
/// `expiryHorizonSec = deadline − host now` (the deadline is a Long action field
/// but the horizon needs the host clock, which Cedar lacks).
///
/// readKind: `derived`
///
/// Params (catalog):
///   - `chain_id`: Long (required) — `$.root.chain_id`
///   - `token`: `AssetRef` (required) — `$.action.token`
///   - `amount`: String (required) — `$.action.amount` (U256 hex / wei-form;
///     priced for `allowanceUsd`)
///   - `deadline`: Long (required) — `$.action.deadline` (unix seconds; horizon =
///     deadline − now)
///
/// Outputs (catalog, record):
///   - `allowanceUsd`: decimal — from `$.result.allowanceUsd`
///   - `expiryHorizonSec`: Long — from `$.result.expiryHorizonSec`
///
/// State accessors to call (Ground list):
///   - `WalletState.tokens: BTreeMap<TokenKey, TokenHolding>` — look up the
///     `TokenHolding` for `token`'s reconstructed `TokenKey`.
///   - `TokenHolding.price_usd: Option<LiveField<Price>>` — the DB price;
///     multiply by the (decimals-scaled) `amount` for `allowanceUsd`.
///
// `expiryHorizonSec` needs the host wall clock (deadline − now). That is NOT a
// WalletState read — match the valuation.rs `clock.now`-style host-clock helper
// rather than a state accessor (paramHelpersNeeded: host_now_secs).
fn allowance_horizon(params: &Value, ctx: &FactCtx) -> Result<Value, FactError> {
    let chain = param_chain_id(params, "chain_id")?;
    let token_contract = param_asset_contract(params, "token")?;
    let amount = param_u256(params, "amount")?;
    let deadline = param_long(params, "deadline")?;

    // allowanceUsd = (amount / 10^decimals) × price_value. Decimal is an opaque
    // string newtype with no arithmetic, so we parse the price into integer
    // fixed-point and do the multiply/divide in U256 (no float — amount can be
    // U256::MAX). Missing holding or absent price_usd ⇒ "0.0000" (unpriceable
    // token); we cannot fabricate a price, but a positive permit on an unpriced
    // asset is still a real, evaluable fact (the horizon half stands on its own).
    // A dotted 4dp zero (never a bare "0") so Cedar's decimal extension accepts it.
    let key = TokenKey::Erc20 {
        chain: chain.clone(),
        address: token_contract,
    };
    let allowance_usd = ctx
        .state
        .tokens
        .get(&key)
        .and_then(|h| {
            let price = &h.price_usd.as_ref()?.value;
            Some(amount_times_price_usd(amount, h.decimals, price.as_str()))
        })
        .unwrap_or_else(|| "0.0000".to_owned());

    // expiryHorizonSec = deadline − now. FactCtx carries no host wall clock (the
    // catalog's stateDependency names "host wall clock … not wallet state"; the
    // scaffold flags an unbuilt `host_now_secs` helper). The closest REAL clock
    // reachable from the fact context is the per-chain synced block timestamp
    // (`WalletState.block_heights[chain].time`, Unix seconds). We use that as the
    // "now" reference. Without a block height for `chain` we cannot compute the
    // horizon at all, so emit null rather than guess.
    let expiry_horizon_sec = ctx
        .state
        .block_heights
        .get(&chain)
        .map(|bh| deadline.saturating_sub(i64::try_from(bh.time).unwrap_or(i64::MAX)));

    Ok(json!({
        "allowanceUsd": allowance_usd,
        "expiryHorizonSec": expiry_horizon_sec,
    }))
}

/// Value `amount` (wei-form, `decimals`-scaled) at `price` (a decimal-string USD
/// price per whole token) into a USD decimal string, using U256 integer math.
///
/// Renders to [`USD_DP`] decimal places: `usd = amount × price / 10^decimals`,
/// computed as `amount × price_scaled / 10^(decimals + price_frac_len − USD_DP)`
/// so no precision is lost to a float. A malformed price string yields `"0.0000"`
/// (a dotted 4dp zero — never a bare "0" that Cedar's decimal would reject).
fn amount_times_price_usd(amount: U256, decimals: u8, price: &str) -> String {
    let Some((price_scaled, price_frac_len)) = parse_decimal_to_u256(price) else {
        return "0.0000".to_owned();
    };
    // numerator = amount × price_scaled × 10^USD_DP
    let numerator = amount
        .saturating_mul(price_scaled)
        .saturating_mul(U256::from(10u64).pow(U256::from(USD_DP)));
    // denominator = 10^(decimals + price_frac_len)
    let denom_pow = u64::from(decimals) + u64::from(price_frac_len);
    let denominator = U256::from(10u64).pow(U256::from(denom_pow));
    if denominator.is_zero() {
        return "0.0000".to_owned();
    }
    let scaled = numerator / denominator;
    let unit = U256::from(10u64).pow(U256::from(USD_DP));
    let whole = scaled / unit;
    let frac = scaled % unit;
    format!("{whole}.{frac:0width$}", width = USD_DP as usize)
}

/// USD output precision (decimal places) for [`amount_times_price_usd`]. Pinned
/// to 4 to match `valuation.rs`/`over_balance_4dp` and Cedar's decimal extension,
/// which rejects any arg with more than 4 fractional digits.
const USD_DP: u32 = 4;

/// Parse a non-negative decimal string (`"1.0005"`, `"42"`, `".5"`) into
/// `(scaled_integer, fractional_len)` where `value = scaled_integer / 10^len`.
/// Returns `None` on any non-`[0-9.]` content or more than one `.`.
fn parse_decimal_to_u256(s: &str) -> Option<(U256, u32)> {
    let s = s.trim();
    let mut parts = s.splitn(2, '.');
    let int_part = parts.next().unwrap_or("");
    let frac_part = parts.next().unwrap_or("");
    if s.contains('.') && s.matches('.').count() > 1 {
        return None;
    }
    if !int_part.chars().all(|c| c.is_ascii_digit())
        || !frac_part.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let digits = format!("{int_part}{frac_part}");
    let digits = if digits.is_empty() { "0" } else { &digits };
    let scaled = U256::from_str_radix(digits, 10).ok()?;
    Some((scaled, u32::try_from(frac_part.len()).ok()?))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    use std::str::FromStr;

    use simulation_state::live_field::{DataSource, LiveField};
    use simulation_state::primitives::{Address, BlockHeight, ChainId, Price, Time};
    use simulation_state::token::holding::{Balance, TokenHolding};
    use simulation_state::token::kind::{BaseCategory, TokenKind};
    use simulation_state::token::TokenKey;
    use simulation_state::{WalletId, WalletState};

    const TOKEN: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

    fn chain() -> ChainId {
        ChainId::ethereum_mainnet()
    }

    fn token_addr() -> Address {
        Address::from_str(TOKEN).unwrap()
    }

    fn token_key() -> TokenKey {
        TokenKey::Erc20 {
            chain: chain(),
            address: token_addr(),
        }
    }

    fn wallet_id() -> WalletId {
        WalletId::new(
            Address::from_str("0x000000000000000000000000000000000000a01c").unwrap(),
            [chain()],
        )
    }

    /// `WalletState` holding a priced USDC (6 decimals, `price` USD) and a synced
    /// block whose timestamp is `block_time` (the "now" reference for the horizon).
    fn state_with(price: Option<&str>, block_time: Option<u64>) -> WalletState {
        let mut state = WalletState::new(wallet_id());
        let price_usd = price.map(|p| {
            LiveField::new(
                Price::new(p),
                DataSource::OracleFeed {
                    provider: simulation_state::live_field::OracleProvider::Pyth,
                    feed_id: "USDC/USD".into(),
                },
                Time::from_unix(1_700_000_000),
            )
        });
        state.tokens.insert(
            token_key(),
            TokenHolding {
                key: token_key(),
                kind: TokenKind::Base {
                    category: BaseCategory::Stable,
                    peg_to: None,
                },
                symbol: "USDC".to_owned(),
                decimals: 6,
                balance: Balance::fungible(U256::from(1_000u64)),
                committed: Balance::zero_fungible(),
                approved_to: None,
                price_usd,
                last_synced_at: Time::from_unix(1_700_000_000),
                primitives_source: DataSource::OnchainView {
                    chain: chain(),
                    contract: token_addr(),
                    function: "balanceOf(address)".into(),
                    decoder_id: "erc20_balance".into(),
                },
            },
        );
        if let Some(t) = block_time {
            state.block_heights.insert(
                chain(),
                BlockHeight {
                    number: 18_000_000,
                    time: t,
                },
            );
        }
        state
    }

    fn token_param() -> Value {
        json!({
            "key": {
                "standard": "erc20",
                "chain": chain().to_string(),
                "address": TOKEN
            }
        })
    }

    fn params(amount_hex: &str, deadline: i64) -> Value {
        json!({
            "chain_id": chain().to_string(),
            "token": token_param(),
            "amount": amount_hex,
            "deadline": deadline
        })
    }

    #[test]
    fn prices_allowance_and_derives_positive_horizon() {
        // 1.0 USDC (1_000_000 wei) at $1.0001 → $1.0001 (4dp).
        let state = state_with(Some("1.0001"), Some(1_700_000_500));
        let amount_hex = format!("{:#x}", U256::from(1_000_000u64));
        let out = dispatch(
            "permit.allowance_horizon",
            &params(&amount_hex, 1_700_000_900),
            &FactCtx { state: &state },
        )
        .unwrap();
        assert_eq!(out["allowanceUsd"], json!("1.0001"));
        // 1_700_000_900 − 1_700_000_500 = 400.
        assert_eq!(out["expiryHorizonSec"], json!(400));
    }

    #[test]
    fn negative_horizon_when_deadline_already_passed() {
        let state = state_with(Some("2"), Some(1_700_000_500));
        let amount_hex = format!("{:#x}", U256::from(500_000u64));
        let out = dispatch(
            "permit.allowance_horizon",
            &params(&amount_hex, 1_700_000_100),
            &FactCtx { state: &state },
        )
        .unwrap();
        // 0.5 USDC × $2 = $1.0000 (4dp).
        assert_eq!(out["allowanceUsd"], json!("1.0000"));
        // 1_700_000_100 − 1_700_000_500 = −400 (expired permit).
        assert_eq!(out["expiryHorizonSec"], json!(-400));
    }

    #[test]
    fn unpriced_token_yields_zero_allowance_but_still_horizon() {
        let state = state_with(None, Some(1_700_000_500));
        let amount_hex = format!("{:#x}", U256::from(1_000_000u64));
        let out = dispatch(
            "permit.allowance_horizon",
            &params(&amount_hex, 1_700_000_700),
            &FactCtx { state: &state },
        )
        .unwrap();
        assert_eq!(out["allowanceUsd"], json!("0.0000"));
        assert_eq!(out["expiryHorizonSec"], json!(200));
    }

    #[test]
    fn no_block_height_yields_null_horizon() {
        // PARTIAL behavior: without a synced block for `chain`, the host-clock
        // proxy is unavailable, so the horizon is null (never fabricated).
        let state = state_with(Some("1"), None);
        let amount_hex = format!("{:#x}", U256::from(1_000_000u64));
        let out = dispatch(
            "permit.allowance_horizon",
            &params(&amount_hex, 1_700_000_700),
            &FactCtx { state: &state },
        )
        .unwrap();
        assert_eq!(out["allowanceUsd"], json!("1.0000"));
        assert_eq!(out["expiryHorizonSec"], json!(null));
    }

    #[test]
    fn parse_decimal_handles_int_frac_and_garbage() {
        assert_eq!(parse_decimal_to_u256("42"), Some((U256::from(42u64), 0)));
        assert_eq!(
            parse_decimal_to_u256("1.0005"),
            Some((U256::from(10_005u64), 4))
        );
        assert_eq!(parse_decimal_to_u256(".5"), Some((U256::from(5u64), 1)));
        assert_eq!(parse_decimal_to_u256("not-a-number"), None);
        assert_eq!(parse_decimal_to_u256("1.2.3"), None);
    }
}
