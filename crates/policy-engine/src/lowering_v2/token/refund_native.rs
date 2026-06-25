//! `Token::RefundNative` lowering -> `Token::RefundNativeContext`.

use serde_json::{Map, Value};

use policy_transition::action::token::RefundNativeAction;

use super::super::common::cedar::addr;
use super::super::common::token::lower_token_ref;
use super::super::dispatch::{LowerCtx, LowerError, LoweredAction};

/// Lower a `Token::RefundNative` action into the `Token::RefundNativeContext`
/// shape.
///
/// # Errors
///
/// Infallible today (returns `Ok`); the `Result` matches the per-action `lower`
/// contract so callers stay uniform across domains.
#[allow(clippy::unnecessary_wraps)] // infallible; Result is the shared per-action contract
pub(crate) fn lower(
    action: &RefundNativeAction,
    ctx: &LowerCtx<'_>,
) -> Result<LoweredAction, LowerError> {
    let mut m = Map::new();
    m.insert("meta".into(), ctx.meta());
    m.insert("token".into(), lower_token_ref(&action.token));
    m.insert("recipient".into(), Value::String(addr(&action.recipient)));
    Ok(ctx.lowered(r#"Token::Action::"RefundNative""#, Value::Object(m)))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use policy_transition::action::token::{RefundNativeAction, TokenAction};
    use policy_transition::action::ActionBody;

    use super::super::test_support::{onchain_meta, recipient, sample_native_key};

    #[test]
    fn refund_native_lowering_conforms_to_schema() {
        let body = ActionBody::Token(TokenAction::RefundNative(RefundNativeAction {
            token: policy_state::token::TokenRef {
                key: sample_native_key(),
            },
            recipient: recipient(),
        }));
        let meta = onchain_meta();
        super::super::test_support::assert_conforms("refund_native", &body, &meta);
    }
}
