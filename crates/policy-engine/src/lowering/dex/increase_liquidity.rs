use crate::action::dex::IncreaseLiquidityAction;
use crate::context_keys::{INPUT_TOKENS, NFT};
use crate::lowering::dex::asset_with_amounts_json;
use crate::lowering::LoweringError;
use crate::policy::PolicyRequest;
use serde_json::{Map, Value};

use crate::lowering::common::asset::asset_ref_json;
use crate::lowering::common::validity::validity_json;
use crate::lowering::dispatch::{Lower, LoweringCtx};

const ACTION_ID: &str = "increase_liquidity";
const VALIDITY: &str = "validity";

impl Lower for IncreaseLiquidityAction {
    fn build(&self, ctx: &LoweringCtx<'_>) -> Result<PolicyRequest, LoweringError> {
        let mut context = Map::new();
        context.insert(NFT.into(), asset_ref_json(&self.nft)?);
        context.insert(INPUT_TOKENS.into(), asset_with_amounts_json(&self.inputs)?);
        if let Some(validity) = &self.validity {
            context.insert(VALIDITY.into(), validity_json(validity));
        }

        Ok(ctx.request(ACTION_ID, Value::Object(context)))
    }
}

#[cfg(test)]
mod tests {
    use crate::action::dex::IncreaseLiquidityAction;
    use crate::action::{Action, AmountKind};

    use crate::lowering::dex::test_support::{
        address, asset_amount_pair, envelope, nft, policy_request, validity, BLOCK_TIMESTAMP,
    };

    #[test]
    fn increase_liquidity_lowers_required_context_fields() {
        let from = address("0x1111111111111111111111111111111111111111");
        let request = policy_request(
            &envelope(Action::IncreaseLiquidity(IncreaseLiquidityAction {
                nft: nft("42"),
                inputs: asset_amount_pair(AmountKind::Max, AmountKind::Max),
                validity: Some(validity(BLOCK_TIMESTAMP + 600)),
            })),
            &from,
        );

        assert!(request.action.contains("increase_liquidity"));
        assert!(request.context.get("nft").is_some());
        assert!(request.context.get("inputTokens").is_some());
        assert!(request.context.get("validity").is_some());
    }
}
