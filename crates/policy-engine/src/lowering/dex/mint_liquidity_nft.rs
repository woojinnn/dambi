use crate::action::dex::{MintLiquidityNftAction, TickRange};
use crate::context_keys::{FEE_BPS, INPUT_TOKENS, LOWER, POOL, RECIPIENT, TICK_RANGE, UPPER};
use crate::lowering::dex::asset_with_amounts_json;
use crate::lowering::LoweringError;
use crate::policy::PolicyRequest;
use serde_json::{Map, Value};

use crate::lowering::common::cedar::cedar_long_u64;
use crate::lowering::common::pool::pool_json;
use crate::lowering::common::validity::validity_json;
use crate::lowering::dispatch::{Lower, LoweringCtx};

const ACTION_ID: &str = "mint_liquidity_nft";
const VALIDITY: &str = "validity";

impl Lower for MintLiquidityNftAction {
    fn build(&self, ctx: &LoweringCtx<'_>) -> Result<PolicyRequest, LoweringError> {
        let mut context = Map::new();
        context.insert(POOL.into(), pool_json(&self.pool));
        context.insert(FEE_BPS.into(), cedar_long_u64(u64::from(self.fee_tier_bps)));
        context.insert(TICK_RANGE.into(), tick_range_json(&self.tick_range));
        context.insert(INPUT_TOKENS.into(), asset_with_amounts_json(&self.inputs)?);
        context.insert(RECIPIENT.into(), Value::from(self.recipient.to_string()));
        if let Some(validity) = &self.validity {
            context.insert(VALIDITY.into(), validity_json(validity));
        }

        Ok(ctx.request(ACTION_ID, Value::Object(context)))
    }
}

fn tick_range_json(tick_range: &TickRange) -> Value {
    let mut out = Map::new();
    out.insert(LOWER.into(), Value::from(i64::from(tick_range.lower)));
    out.insert(UPPER.into(), Value::from(i64::from(tick_range.upper)));
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use crate::action::dex::MintLiquidityNftAction;
    use crate::action::{Action, AmountKind};

    use crate::lowering::dex::test_support::{
        address, asset_amount_pair, envelope, policy_request, pool, tick_range, validity,
        BLOCK_TIMESTAMP,
    };

    #[test]
    fn mint_liquidity_nft_lowers_required_context_fields() {
        let from = address("0x1111111111111111111111111111111111111111");
        let request = policy_request(
            &envelope(Action::MintLiquidityNft(MintLiquidityNftAction {
                pool: pool(),
                fee_tier_bps: 5,
                tick_range: tick_range(),
                inputs: asset_amount_pair(AmountKind::Max, AmountKind::Max),
                recipient: from.clone(),
                validity: Some(validity(BLOCK_TIMESTAMP + 600)),
            })),
            &from,
        );

        assert!(request.action.contains("mint_liquidity_nft"));
        assert!(request.context.get("pool").is_some());
        assert!(request.context.get("feeBps").is_some());
        assert!(request.context.get("tickRange").is_some());
        assert!(request.context.get("inputTokens").is_some());
        assert!(request.context.get("recipient").is_some());
        assert!(request.context.get("validity").is_some());
    }
}
