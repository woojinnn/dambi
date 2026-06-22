//! `Staking::Redeem` lowering → `Staking::RedeemContext`.

use serde_json::{Map, Value};

use policy_transition::action::staking::{RedeemAction, RedeemAmountDenomination};

use super::super::common::cedar::{addr, u256_hex};
use super::super::common::token::lower_token_ref;
use super::super::dispatch::{LowerCtx, LowerError, LoweredAction};
use super::lower_stake_venue;

/// Lower a `Staking::Redeem` action (Aave safety-module `redeem(to, amount)`).
/// No live inputs. `recipient` is omitted ⇒ submitter.
///
/// # Errors
///
/// Infallible today (returns `Ok`); the `Result` matches the per-action `lower`
/// contract so callers stay uniform across the fan-out.
#[allow(clippy::unnecessary_wraps)]
pub(crate) fn lower(
    action: &RedeemAction,
    ctx: &LowerCtx<'_>,
) -> Result<LoweredAction, LowerError> {
    let mut m = Map::new();
    m.insert("meta".into(), ctx.meta());
    m.insert("venue".into(), lower_stake_venue(&action.venue));
    if let Some(asset) = &action.asset {
        m.insert("asset".into(), lower_token_ref(asset));
    }
    m.insert("amount".into(), Value::String(u256_hex(action.amount)));
    if let Some(amount_denomination) = &action.amount_denomination {
        let value = match amount_denomination {
            RedeemAmountDenomination::Shares => "shares",
            RedeemAmountDenomination::Assets => "assets",
        };
        m.insert("amountDenomination".into(), Value::String(value.into()));
    }
    if let Some(owner) = &action.owner {
        m.insert("owner".into(), Value::String(addr(owner)));
    }
    if let Some(recipient) = &action.recipient {
        m.insert("recipient".into(), Value::String(addr(recipient)));
    }

    Ok(ctx.lowered(r#"Staking::Action::"Redeem""#, Value::Object(m)))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use policy_state::primitives::U256;
    use policy_transition::action::staking::{
        RedeemAction, RedeemAmountDenomination, StakingAction,
    };
    use policy_transition::action::ActionBody;

    use super::super::test_support::{
        aave_safety_module_venue, assert_conforms, crv, onchain_meta, other,
    };

    #[test]
    fn redeem_to_recipient_conforms() {
        let body = ActionBody::Staking(StakingAction::Redeem(RedeemAction {
            venue: aave_safety_module_venue(),
            asset: None,
            amount: U256::from(2_000_000_000_000_000_000u64),
            amount_denomination: None,
            owner: None,
            recipient: Some(other()),
        }));
        assert_conforms("redeem", &body, &onchain_meta());
    }

    #[test]
    fn redeem_with_erc4626_owner_asset_and_denomination_conforms() {
        let body = ActionBody::Staking(StakingAction::Redeem(RedeemAction {
            venue: aave_safety_module_venue(),
            asset: Some(crv()),
            amount: U256::from(1_000_000_000_000_000_000u64),
            amount_denomination: Some(RedeemAmountDenomination::Assets),
            owner: Some(other()),
            recipient: Some(other()),
        }));
        assert_conforms("redeem", &body, &onchain_meta());
    }
}
