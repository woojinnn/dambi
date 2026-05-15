use crate::action::dex::{BurnKind, BurnLiquidityNftAction};
use crate::context_keys::{BURN_KIND, NFT, OUTPUT_TOKENS, RECIPIENT};
use crate::lowering::dex::asset_with_amounts_json;
use crate::lowering::LoweringError;
use crate::policy::PolicyRequest;
use serde_json::{Map, Value};

use crate::lowering::common::asset::asset_ref_json;
use crate::lowering::common::validity::validity_json;
use crate::lowering::dispatch::{Lower, LoweringCtx};

const ACTION_ID: &str = "burn_liquidity_nft";
const VALIDITY: &str = "validity";

impl Lower for BurnLiquidityNftAction {
    fn build(&self, ctx: &LoweringCtx<'_>) -> Result<PolicyRequest, LoweringError> {
        let mut context = Map::new();
        context.insert(NFT.into(), asset_ref_json(&self.nft)?);
        context.insert(
            BURN_KIND.into(),
            Value::from(burn_kind_str(&self.burn_kind)),
        );
        if let Some(outputs) = &self.outputs {
            context.insert(OUTPUT_TOKENS.into(), asset_with_amounts_json(outputs)?);
        }
        if let Some(recipient) = &self.recipient {
            context.insert(RECIPIENT.into(), Value::from(recipient.to_string()));
        }
        if let Some(validity) = &self.validity {
            context.insert(VALIDITY.into(), validity_json(validity));
        }

        Ok(ctx.request(ACTION_ID, Value::Object(context)))
    }
}

const fn burn_kind_str(kind: &BurnKind) -> &'static str {
    match kind {
        BurnKind::EmptyOnly => "empty_only",
        BurnKind::AutoDecrease => "auto_decrease",
    }
}

#[cfg(test)]
mod tests {
    use crate::action::dex::{BurnKind, BurnLiquidityNftAction};
    use crate::action::{Action, AmountKind};

    use crate::lowering::dex::test_support::{
        address, asset_amount_pair, envelope, nft, policy_request, validity, BLOCK_TIMESTAMP,
    };

    #[test]
    fn burn_liquidity_nft_lowers_required_context_fields() {
        let from = address("0x1111111111111111111111111111111111111111");
        let request = policy_request(
            &envelope(Action::BurnLiquidityNft(BurnLiquidityNftAction {
                nft: nft("42"),
                burn_kind: BurnKind::AutoDecrease,
                outputs: Some(asset_amount_pair(AmountKind::Min, AmountKind::Min)),
                recipient: Some(from.clone()),
                validity: Some(validity(BLOCK_TIMESTAMP + 600)),
            })),
            &from,
        );

        assert!(request.action.contains("burn_liquidity_nft"));
        assert!(request.context.get("nft").is_some());
        assert!(request.context.get("burnKind").is_some());
        assert!(request.context.get("outputTokens").is_some());
        assert!(request.context.get("recipient").is_some());
        assert!(request.context.get("validity").is_some());
    }
}
