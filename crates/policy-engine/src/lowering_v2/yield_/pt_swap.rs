//! `Yield::PtSwap` lowering → `Yield::PtSwapContext`.

use serde_json::{Map, Value};

use policy_transition::action::yield_::{PtSwapAction, PtSwapDirection};

use super::super::common::cedar::{addr, u256_hex};
use super::super::common::token::lower_token_ref;
use super::super::dispatch::{LowerCtx, LowerError, LoweredAction};
use super::{enum_tag, lower_yield_venue};

/// Lower a `Yield::PtSwap` action.
///
/// # Errors
///
/// Infallible today (returns `Ok`); the `Result` matches the per-action `lower`
/// contract so callers stay uniform across the fan-out.
#[allow(clippy::unnecessary_wraps)]
pub(crate) fn lower(
    action: &PtSwapAction,
    ctx: &LowerCtx<'_>,
) -> Result<LoweredAction, LowerError> {
    let mut m = Map::new();
    m.insert("meta".into(), ctx.meta());
    m.insert("venue".into(), lower_yield_venue(&action.venue));
    m.insert("market".into(), Value::String(addr(&action.market)));
    m.insert("direction".into(), enum_tag(&action.direction));
    if let Some(token) = &action.external_token {
        m.insert("externalToken".into(), lower_token_ref(token));
    }
    m.insert(
        "exactAmountIn".into(),
        Value::String(u256_hex(action.exact_amount_in)),
    );
    // `exact_amount_in` is denominated in the INPUT instrument, which depends on
    // direction: `TokenForPt` → the external token; `PtForToken` / `PtForSy` →
    // PT (Pendle PT is 18-decimal). `SyForPt`'s SY input has no statically-known
    // token ref, so its nano is left to enrichment. Pairing every direction with
    // `external_token` (the OUTPUT for the PT-as-input arms) would mis-scale.
    let exact_in_nano = match action.direction {
        PtSwapDirection::TokenForPt => action
            .external_token
            .as_ref()
            .and_then(|t| ctx.amount_nano(t, action.exact_amount_in)),
        PtSwapDirection::PtForToken | PtSwapDirection::PtForSy => {
            Some(ctx.amount_nano_native18(action.exact_amount_in))
        }
        PtSwapDirection::SyForPt => None,
    };
    if let Some(nano) = exact_in_nano {
        m.insert("exactAmountInNano".into(), Value::from(nano));
    }
    m.insert(
        "minAmountOut".into(),
        Value::String(u256_hex(action.min_amount_out)),
    );
    m.insert("recipient".into(), Value::String(addr(&action.recipient)));
    // Market enrichment (P1c): SY/PT/YT from readTokens(), maturity from expiry().
    m.insert(
        "sy".into(),
        Value::String(addr(&action.live_inputs.sy.value)),
    );
    m.insert(
        "pt".into(),
        Value::String(addr(&action.live_inputs.pt.value)),
    );
    m.insert(
        "yt".into(),
        Value::String(addr(&action.live_inputs.yt.value)),
    );
    m.insert(
        "maturity".into(),
        Value::String(u256_hex(action.live_inputs.maturity.value)),
    );

    Ok(ctx.lowered(r#"Yield::Action::"PtSwap""#, Value::Object(m)))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use policy_state::primitives::U256;
    use policy_transition::action::yield_::{
        MarketTokensLiveInputs, PtSwapAction, PtSwapDirection, YieldAction,
    };
    use policy_transition::action::ActionBody;

    use super::super::test_support::{
        assert_conforms, live_addr, live_u256, onchain_meta, pendle_market, pendle_venue, usdc,
        user,
    };

    fn market_tokens() -> MarketTokensLiveInputs {
        MarketTokensLiveInputs {
            sy: live_addr(),
            pt: live_addr(),
            yt: live_addr(),
            maturity: live_u256(),
        }
    }

    #[test]
    fn pt_swap_token_for_pt_conforms() {
        let body = ActionBody::Yield(YieldAction::PtSwap(PtSwapAction {
            venue: pendle_venue(),
            market: pendle_market(),
            direction: PtSwapDirection::TokenForPt,
            external_token: Some(usdc()),
            exact_amount_in: U256::from(1_000_000_000u64),
            min_amount_out: U256::from(990_000_000u64),
            recipient: user(),
            live_inputs: market_tokens(),
        }));
        assert_conforms("pt_swap", &body, &onchain_meta());
    }

    #[test]
    fn pt_swap_pt_for_sy_no_external_token_conforms() {
        // SY-side direction: external_token omitted.
        let body = ActionBody::Yield(YieldAction::PtSwap(PtSwapAction {
            venue: pendle_venue(),
            market: pendle_market(),
            direction: PtSwapDirection::PtForSy,
            external_token: None,
            exact_amount_in: U256::from(500_000_000_000_000_000u64),
            min_amount_out: U256::from(490_000_000_000_000_000u64),
            recipient: user(),
            live_inputs: market_tokens(),
        }));
        assert_conforms("pt_swap", &body, &onchain_meta());
    }

    /// REGRESSION: for `PtForToken` the INPUT is PT (18-decimal); `external_token`
    /// is the OUTPUT (e.g. USDC, 6-dec). `exactAmountInNano` must scale by PT's 18
    /// decimals (native18), NOT the external token's — even though the host
    /// injects the external token's decimals. The pre-fix code paired the input
    /// amount with `external_token`, mis-scaling by 10^(18−6) and failing a cap
    /// OPEN. 1 PT (1e18) → 1e9 nano (correct); the buggy 6-dec path would yield
    /// 1e21 → clamps to i64::MAX, so this assert pins the fix.
    #[test]
    fn pt_swap_pt_for_token_scales_input_by_pt_decimals_not_external() {
        use std::collections::BTreeMap;
        use std::str::FromStr;

        use policy_state::primitives::{Address, ChainId};
        use policy_state::token::{TokenKey, TokenRef};

        use crate::lowering_v2::{lower_action_with_decimals, TokenDecimals, TxMeta};

        let usdc_addr = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
        let external = TokenRef {
            key: TokenKey::Erc20 {
                chain: ChainId::ethereum_mainnet(),
                address: Address::from_str(usdc_addr).unwrap(),
            },
        };
        let body = ActionBody::Yield(YieldAction::PtSwap(PtSwapAction {
            venue: pendle_venue(),
            market: pendle_market(),
            direction: PtSwapDirection::PtForToken,
            external_token: Some(external),
            exact_amount_in: U256::from(1_000_000_000_000_000_000u64), // 1 PT (18dp)
            min_amount_out: U256::from(990_000u64),
            recipient: user(),
            live_inputs: market_tokens(),
        }));
        let mut map = BTreeMap::new();
        map.insert(usdc_addr.to_owned(), 6u8); // OUTPUT token decimals — must be IGNORED for the input nano
        let lowered = lower_action_with_decimals(
            &body,
            &onchain_meta(),
            &TxMeta {
                from: "0x1111111111111111111111111111111111111111",
                to: "0x2222222222222222222222222222222222222222",
            },
            &TokenDecimals::new(map),
        )
        .unwrap();
        assert_eq!(
            lowered.context["exactAmountInNano"],
            serde_json::json!(1_000_000_000i64),
            "PtForToken input nano must use PT 18-decimal scaling, not external USDC 6-dec"
        );
    }
}
