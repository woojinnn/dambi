use crate::action::lending::SupplyAction;
use crate::context_keys::{
    AMOUNT, AMOUNT_MODE, ASSET, FROM, MARKET, RECIPIENT, VALIDITY_DELTA_SEC,
};
use crate::policy::PolicyRequest;
use serde_json::{Map, Value};

use crate::lowering::common::amount::amount_constraint_json;
use crate::lowering::common::asset::asset_ref_json;
use crate::lowering::common::validity::{validity_delta_sec, validity_json};
use crate::lowering::dispatch::{Lower, LoweringCtx};
use crate::lowering::lending::common::{amount_mode_str, market_json};

const ACTION_ID: &str = "supply";
const VALIDITY: &str = "validity";

impl Lower for SupplyAction {
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
        context.insert(RECIPIENT.into(), Value::from(self.recipient.to_string()));
        if let Some(from) = &self.from {
            context.insert(FROM.into(), Value::from(from.to_string()));
        }
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
    use crate::action::lending::{AmountMode, SupplyAction};
    use crate::action::{Action, AmountKind};
    use serde_json::Value;

    use crate::lowering::lending::test_support::{
        address, amount, envelope, erc20, market, policy_request, validity, BLOCK_TIMESTAMP,
    };

    fn supply(recipient: crate::action::Address) -> SupplyAction {
        SupplyAction {
            market: None,
            asset: erc20("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC", 6),
            amount: amount(AmountKind::Exact, "1000000000"),
            amount_mode: None,
            recipient,
            from: None,
            validity: None,
        }
    }

    #[test]
    fn supply_action_lowers_minimal_context() {
        let from = address("0x1111111111111111111111111111111111111111");
        let request = policy_request(&envelope(Action::Supply(supply(from.clone()))), &from);

        assert_eq!(
            request.principal,
            r#"Wallet::"0x1111111111111111111111111111111111111111""#
        );
        assert!(request.action.contains("supply"));
        assert_eq!(
            request.resource,
            r#"Protocol::"0x2222222222222222222222222222222222222222""#
        );
        assert_eq!(
            request
                .context
                .get("asset")
                .and_then(|asset| asset.get("symbol"))
                .and_then(Value::as_str),
            Some("USDC")
        );
        assert_eq!(
            request.context.get("recipient").and_then(Value::as_str),
            Some("0x1111111111111111111111111111111111111111")
        );
        assert!(request.context.get("market").is_none());
        assert!(request.context.get("amountMode").is_none());
        assert!(request.context.get("from").is_none());
        assert!(request.context.get("validity").is_none());
    }

    #[test]
    fn supply_action_lowers_full_context() {
        let from = address("0x1111111111111111111111111111111111111111");
        let funder = address("0x3333333333333333333333333333333333333333");
        let mut action = supply(from.clone());
        action.market = Some(market());
        action.amount_mode = Some(AmountMode::Shares);
        action.from = Some(funder.clone());
        action.validity = Some(validity(BLOCK_TIMESTAMP + 600));

        let request = policy_request(&envelope(Action::Supply(action)), &from);

        assert_eq!(
            request
                .context
                .get("market")
                .and_then(|market| market.get("label"))
                .and_then(Value::as_str),
            Some("Aave V3 USDC")
        );
        assert_eq!(
            request.context.get("amountMode").and_then(Value::as_str),
            Some("shares")
        );
        assert_eq!(
            request.context.get("from").and_then(Value::as_str),
            Some(funder.to_string().as_str())
        );
        assert!(request.context.get("validity").is_some());
        assert_eq!(
            request
                .context
                .get("validityDeltaSec")
                .and_then(Value::as_i64),
            Some(600)
        );
    }
}
