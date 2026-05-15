use crate::action::lending::RepayAction;
use crate::context_keys::{
    AMOUNT, AMOUNT_MODE, ASSET, MARKET, ON_BEHALF, REPAY_KIND, VALIDITY_DELTA_SEC,
};
use crate::policy::PolicyRequest;
use serde_json::{Map, Value};

use crate::lowering::common::amount::amount_constraint_json;
use crate::lowering::common::asset::asset_ref_json;
use crate::lowering::common::validity::{validity_delta_sec, validity_json};
use crate::lowering::dispatch::{Lower, LoweringCtx};
use crate::lowering::lending::common::{amount_mode_str, market_json, repay_kind_str};

const ACTION_ID: &str = "repay";
const VALIDITY: &str = "validity";

impl Lower for RepayAction {
    fn build(&self, ctx: &LoweringCtx<'_>) -> PolicyRequest {
        let mut context = Map::new();
        if let Some(market) = &self.market {
            context.insert(MARKET.into(), market_json(market));
        }
        context.insert(ASSET.into(), asset_ref_json(&self.asset));
        context.insert(AMOUNT.into(), amount_constraint_json(&self.amount));
        if let Some(mode) = &self.amount_mode {
            context.insert(AMOUNT_MODE.into(), Value::from(amount_mode_str(mode)));
        }
        context.insert(ON_BEHALF.into(), Value::from(self.on_behalf.to_string()));
        context.insert(
            REPAY_KIND.into(),
            Value::from(repay_kind_str(&self.repay_kind)),
        );
        if let Some(validity) = &self.validity {
            context.insert(VALIDITY.into(), validity_json(validity));
            if let Some(delta_sec) = validity_delta_sec(validity, ctx.block_timestamp) {
                context.insert(VALIDITY_DELTA_SEC.into(), Value::from(delta_sec));
            }
        }

        ctx.request(ACTION_ID, Value::Object(context))
    }
}

#[cfg(test)]
mod tests {
    use crate::action::lending::{AmountMode, RepayAction, RepayKind};
    use crate::action::{Action, AmountKind};
    use serde_json::Value;

    use crate::lowering::lending::test_support::{
        address, amount, envelope, erc20, market, policy_request, validity, BLOCK_TIMESTAMP,
    };

    fn repay(on_behalf: crate::action::Address) -> RepayAction {
        RepayAction {
            market: None,
            asset: erc20("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC", 6),
            amount: amount(AmountKind::Exact, "1000000000"),
            amount_mode: None,
            on_behalf,
            repay_kind: RepayKind::DebtAsset,
            validity: None,
        }
    }

    #[test]
    fn repay_action_lowers_minimal_context() {
        let from = address("0x1111111111111111111111111111111111111111");
        let request = policy_request(&envelope(Action::Repay(repay(from.clone()))), &from);

        assert!(request.action.contains("repay"));
        assert_eq!(
            request.context.get("onBehalf").and_then(Value::as_str),
            Some(from.to_string().as_str())
        );
        assert_eq!(
            request.context.get("repayKind").and_then(Value::as_str),
            Some("debt_asset")
        );
        assert!(request.context.get("market").is_none());
        assert!(request.context.get("amountMode").is_none());
        assert!(request.context.get("validity").is_none());
    }

    #[test]
    fn repay_action_lowers_full_context() {
        let from = address("0x1111111111111111111111111111111111111111");
        let position_owner = address("0x3333333333333333333333333333333333333333");
        let mut action = repay(position_owner.clone());
        action.market = Some(market());
        action.amount_mode = Some(AmountMode::Shares);
        action.repay_kind = RepayKind::AtokenDirect;
        action.validity = Some(validity(BLOCK_TIMESTAMP + 60));

        let request = policy_request(&envelope(Action::Repay(action)), &from);

        assert_eq!(
            request.context.get("amountMode").and_then(Value::as_str),
            Some("shares")
        );
        assert_eq!(
            request.context.get("repayKind").and_then(Value::as_str),
            Some("atoken_direct")
        );
        assert_eq!(
            request.context.get("onBehalf").and_then(Value::as_str),
            Some(position_owner.to_string().as_str())
        );
        assert!(request.context.get("market").is_some());
        assert!(request.context.get("validity").is_some());
        assert_eq!(
            request
                .context
                .get("validityDeltaSec")
                .and_then(Value::as_i64),
            Some(60)
        );
    }
}
