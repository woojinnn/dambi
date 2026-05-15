use crate::action::dex::InitializePoolAction;
use crate::context_keys::{
    FEE_BPS, HOOKS, HOOK_PERMISSIONS, IS_DYNAMIC_FEE, POOL, SQRT_PRICE_X96, TICK_SPACING, TOKEN0,
    TOKEN1,
};
use crate::lowering::common::asset::asset_ref_json;
use crate::lowering::common::cedar::cedar_long_u64;
use crate::lowering::common::pool::pool_json;
use crate::lowering::dex::hooks::hook_permissions_json;
use crate::lowering::dispatch::{Lower, LoweringCtx};
use crate::lowering::LoweringError;
use crate::policy::PolicyRequest;
use serde_json::{Map, Value};

const ACTION_ID: &str = "initialize_pool";

impl Lower for InitializePoolAction {
    fn build(&self, ctx: &LoweringCtx<'_>) -> Result<PolicyRequest, LoweringError> {
        let mut context = Map::new();
        context.insert(POOL.into(), pool_json(&self.pool));
        context.insert(TOKEN0.into(), asset_ref_json(&self.token0)?);
        context.insert(TOKEN1.into(), asset_ref_json(&self.token1)?);
        context.insert(FEE_BPS.into(), cedar_long_u64(u64::from(self.fee_bps)));
        if let Some(tick_spacing) = self.tick_spacing {
            context.insert(TICK_SPACING.into(), Value::from(i64::from(tick_spacing)));
        }
        if let Some(sqrt_price) = &self.sqrt_price_x96 {
            context.insert(SQRT_PRICE_X96.into(), Value::from(sqrt_price.to_string()));
        }
        if let Some(hooks) = &self.hooks {
            context.insert(HOOKS.into(), Value::from(hooks.to_string()));
        }
        if let Some(is_dynamic_fee) = self.is_dynamic_fee {
            context.insert(IS_DYNAMIC_FEE.into(), Value::Bool(is_dynamic_fee));
        }
        if let Some(permissions) = &self.hook_permissions {
            context.insert(HOOK_PERMISSIONS.into(), hook_permissions_json(permissions));
        }

        Ok(ctx.request(ACTION_ID, Value::Object(context)))
    }
}

#[cfg(test)]
mod tests {
    use crate::action::dex::InitializePoolAction;
    use crate::action::Action;

    use crate::lowering::dex::test_support::{address, envelope, erc20, policy_request, pool};

    #[test]
    fn initialize_pool_lowers_required_context_fields() {
        let from = address("0x1111111111111111111111111111111111111111");
        let request = policy_request(
            &envelope(Action::InitializePool(InitializePoolAction {
                pool: pool(),
                token0: erc20("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "WETH", 18),
                token1: erc20("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC", 6),
                fee_bps: 500,
                tick_spacing: None,
                sqrt_price_x96: None,
                hooks: None,
                is_dynamic_fee: None,
                hook_permissions: None,
            })),
            &from,
        );

        assert!(request.action.contains("initialize_pool"));
        assert!(request.context.get("pool").is_some());
        assert!(request.context.get("token0").is_some());
        assert!(request.context.get("token1").is_some());
        assert!(request.context.get("feeBps").is_some());
    }
}
