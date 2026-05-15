//! SwapRouter02 `exactInput` (packed-path) mapper.

use abi_resolver::ids::SR02_EXACT_INPUT_DECODER_ID;
use abi_resolver::{DecodedCall, DecoderId};
use policy_engine::action::dex::{SwapAction, SwapMode};
use policy_engine::action::{ActionEnvelope, AmountKind};

use crate::mapper::{MapContext, Mapper, MapperError, MapperId};

use super::common::{
    address_arg, amount_constraint, asset_ref, asset_with_amount, bytes_arg, parse_path,
    swap_envelope, uint_arg,
};

#[derive(Debug, Clone, Copy, Default)]
pub struct Sr02ExactInputMapper;

impl Sr02ExactInputMapper {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Mapper for Sr02ExactInputMapper {
    fn id(&self) -> MapperId {
        MapperId::new(SR02_EXACT_INPUT_DECODER_ID)
    }

    fn accepts(&self, decoded: &DecodedCall) -> bool {
        decoded.decoder_id == DecoderId::new(SR02_EXACT_INPUT_DECODER_ID)
    }

    fn map(
        &self,
        ctx: &MapContext<'_>,
        decoded: &DecodedCall,
    ) -> Result<Vec<ActionEnvelope>, MapperError> {
        let path = bytes_arg(decoded, "path")?;
        let recipient = address_arg(decoded, "recipient")?;
        let amount_in = uint_arg(decoded, "amountIn")?;
        let amount_out_minimum = uint_arg(decoded, "amountOutMinimum")?;
        let parsed = parse_path(path)?;

        Ok(vec![swap_envelope(SwapAction {
            swap_mode: SwapMode::ExactIn,
            input_token: asset_with_amount(
                asset_ref(ctx, &parsed.token_in),
                amount_constraint(AmountKind::Exact, amount_in)?,
            ),
            output_token: asset_with_amount(
                asset_ref(ctx, &parsed.token_out),
                amount_constraint(AmountKind::Min, amount_out_minimum)?,
            ),
            recipient,
            validity: None,
            fee_bps: Some(parsed.first_fee / 100),
        })])
    }
}
