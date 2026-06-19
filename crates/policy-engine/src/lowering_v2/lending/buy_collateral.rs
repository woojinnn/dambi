//! `Lending::BuyCollateral` lowering → `Lending::BuyCollateralContext`.

use serde_json::{Map, Value};

use policy_transition::action::lending::BuyCollateralAction;

use super::super::common::cedar::{addr, u256_hex};
use super::super::common::token::lower_token_ref;
use super::super::dispatch::{LowerCtx, LowerError, LoweredAction};
use super::lower_lending_venue;

/// Lower a `Lending::BuyCollateral` action into the Cedar context shape.
///
/// # Errors
///
/// Infallible today (returns `Ok`); the `Result` matches the per-action
/// lowering contract.
#[allow(clippy::unnecessary_wraps)]
pub(crate) fn lower(
    action: &BuyCollateralAction,
    ctx: &LowerCtx<'_>,
) -> Result<LoweredAction, LowerError> {
    let mut m = Map::new();
    m.insert("meta".into(), ctx.meta());
    m.insert("venue".into(), lower_lending_venue(&action.venue));
    m.insert(
        "collateralAsset".into(),
        lower_token_ref(&action.collateral_asset),
    );
    m.insert("baseAsset".into(), lower_token_ref(&action.base_asset));
    m.insert(
        "minCollateralAmount".into(),
        Value::String(u256_hex(action.min_collateral_amount)),
    );
    if let Some(nano) = ctx.amount_nano(&action.collateral_asset, action.min_collateral_amount) {
        m.insert("minCollateralAmountNano".into(), Value::from(nano));
    }
    m.insert(
        "baseAmount".into(),
        Value::String(u256_hex(action.base_amount)),
    );
    if let Some(nano) = ctx.amount_nano(&action.base_asset, action.base_amount) {
        m.insert("baseAmountNano".into(), Value::from(nano));
    }
    m.insert("recipient".into(), Value::String(addr(&action.recipient)));

    Ok(ctx.lowered(r#"Lending::Action::"BuyCollateral""#, Value::Object(m)))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use policy_state::primitives::U256;
    use policy_transition::action::lending::{BuyCollateralAction, LendingAction};
    use policy_transition::action::ActionBody;

    use super::super::test_support::{
        assert_conforms, onchain_meta, other, usdc, venue_compound_v3, weth,
    };

    #[test]
    fn buy_collateral_lowering_conforms_to_schema() {
        let body = ActionBody::Lending(LendingAction::BuyCollateral(BuyCollateralAction {
            venue: venue_compound_v3(),
            collateral_asset: weth(),
            base_asset: usdc(),
            min_collateral_amount: U256::from(300_000_000_000_000_000u64),
            base_amount: U256::from(1_000_000_000u64),
            recipient: other(),
        }));

        assert_conforms("buy_collateral", &body, &onchain_meta());
    }
}
