//! `HyperliquidCore::HlCoreLimitOrder` lowering.
//!
//! CoreWriter action 1 carries raw HyperCore integers. The lowering exposes
//! those raw values as strings, plus the policy-relevant direction and
//! `reduceOnly` flag, without pretending to know human price/size units.

use serde_json::{Map, Number, Value};

use policy_transition::action::hyperliquid_core::HlCoreLimitOrderAction;

use super::super::dispatch::{LowerCtx, LowerError, LoweredAction};
use super::hl_venue;

#[allow(clippy::unnecessary_wraps)]
pub(crate) fn lower(
    action: &HlCoreLimitOrderAction,
    ctx: &LowerCtx<'_>,
) -> Result<LoweredAction, LowerError> {
    let mut m = Map::new();
    m.insert("meta".into(), ctx.meta());
    m.insert("venue".into(), hl_venue());
    m.insert("asset".into(), Value::Number(Number::from(action.asset)));
    m.insert("isBuy".into(), Value::Bool(action.is_buy));
    m.insert(
        "side".into(),
        Value::String(if action.is_buy { "long" } else { "short" }.into()),
    );
    m.insert("limitPx".into(), Value::String(action.limit_px.clone()));
    m.insert("sz".into(), Value::String(action.sz.clone()));
    m.insert("reduceOnly".into(), Value::Bool(action.reduce_only));
    m.insert(
        "encodedTif".into(),
        Value::Number(Number::from(action.encoded_tif)),
    );
    m.insert("cloid".into(), Value::String(action.cloid.clone()));

    Ok(ctx.lowered(
        r#"HyperliquidCore::Action::"HlCoreLimitOrder""#,
        Value::Object(m),
    ))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::doc_markdown)]
mod tests {
    use policy_transition::action::hyperliquid_core::{
        HlCoreLimitOrderAction, HyperliquidCoreAction,
    };
    use policy_transition::action::ActionBody;

    use crate::lowering_v2::perp::test_support::{assert_conforms, offchain_meta};
    use crate::lowering_v2::{lower_action, TxMeta};

    #[test]
    fn core_limit_order_lowering_conforms_to_schema() {
        let body = ActionBody::HyperliquidCore(HyperliquidCoreAction::CoreLimitOrder(
            HlCoreLimitOrderAction {
                asset: 110_076,
                is_buy: false,
                limit_px: "62653000".to_owned(),
                sz: "1000".to_owned(),
                reduce_only: false,
                encoded_tif: 2,
                cloid: "42".to_owned(),
            },
        ));

        assert_conforms("hl_core_limit_order", &body, &offchain_meta());

        let lowered = lower_action(
            &body,
            &offchain_meta(),
            &TxMeta {
                from: "0x1111111111111111111111111111111111111111",
                to: "0x0000000000000000000000000000000000000000",
            },
        )
        .unwrap();
        assert_eq!(
            lowered.action_uid,
            r#"HyperliquidCore::Action::"HlCoreLimitOrder""#
        );
        assert_eq!(lowered.context["side"], "short");
        assert_eq!(lowered.context["reduceOnly"], false);
        assert_eq!(lowered.context["limitPx"], "62653000");
        assert_eq!(lowered.context["sz"], "1000");
    }
}
