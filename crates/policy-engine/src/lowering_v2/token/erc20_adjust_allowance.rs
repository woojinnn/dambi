//! `Token::Erc20AdjustAllowance` lowering → `Token::Erc20AdjustAllowanceContext`.

use serde_json::{Map, Value};

use simulation_reducer::action::token::{Erc20AdjustAllowanceAction, Erc20AllowanceAdjustment};

use super::super::common::cedar::{addr, u256_hex};
use super::super::common::token::lower_token_ref;
use super::super::dispatch::{LowerCtx, LowerError, LoweredAction};

/// Lower an `ERC20` allowance delta into Cedar context shape.
///
/// # Errors
///
/// Infallible today (returns `Ok`); the `Result` matches the per-action `lower`
/// contract so callers stay uniform across the fan-out.
#[allow(clippy::unnecessary_wraps)] // infallible; Result is the shared per-action contract
pub(crate) fn lower(
    action: &Erc20AdjustAllowanceAction,
    ctx: &LowerCtx<'_>,
) -> Result<LoweredAction, LowerError> {
    let mut m = Map::new();
    m.insert("meta".into(), ctx.meta());
    m.insert("token".into(), lower_token_ref(&action.token));
    m.insert("spender".into(), Value::String(addr(&action.spender)));
    m.insert(
        "direction".into(),
        Value::String(
            match action.direction {
                Erc20AllowanceAdjustment::Increase => "increase",
                Erc20AllowanceAdjustment::Decrease => "decrease",
            }
            .into(),
        ),
    );
    m.insert(
        "amountDelta".into(),
        Value::String(u256_hex(action.amount_delta)),
    );
    // `amountDeltaNano` / `amountDeltaUsd` / `custom` are host-populated.

    Ok(ctx.lowered(r#"Token::Action::"Erc20AdjustAllowance""#, Value::Object(m)))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::doc_markdown
)]
mod tests {
    use simulation_reducer::action::token::{
        Erc20AdjustAllowanceAction, Erc20AllowanceAdjustment, TokenAction,
    };
    use simulation_reducer::action::ActionBody;
    use simulation_state::primitives::U256;

    use super::super::test_support::{onchain_meta, sample_erc20_token, spender};

    #[test]
    fn erc20_adjust_allowance_lowering_conforms_to_schema() {
        let body = ActionBody::Token(TokenAction::Erc20AdjustAllowance(
            Erc20AdjustAllowanceAction {
                token: sample_erc20_token(),
                spender: spender(),
                amount_delta: U256::from(100u64),
                direction: Erc20AllowanceAdjustment::Increase,
            },
        ));
        let meta = onchain_meta();
        super::super::test_support::assert_conforms("erc20_adjust_allowance", &body, &meta);
    }
}
