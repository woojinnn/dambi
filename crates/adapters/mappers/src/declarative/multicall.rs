//! `multicall_recurse` strategy execution (spec §5.2.4, §4.4).
//!
//! The strategy recognises a multicall-shaped outer call and dispatches each
//! inner sub-call back through the host's resolver. Spec §5.1 enumerates
//! several `recurse_rule_id` values; the Phase 4 PoC implements only
//! `"self_array_bytes_last_arg"`, which covers Uniswap V3 NPM `multicall(bytes[])`
//! (selector `0xac9650d8`), SwapRouter02 multicall overloads, and Multicall3.
//! Other rule ids (`safe_multisend_packed`, Cat E aggregator executors) parse
//! through Phase 0 [`super::types`] but return [`MapperError::Internal`].
//!
//! Flow (mirrors §5.2 lines 514-525):
//!
//! 1. Match the bundle's `recurse_rule_id` against the supported set.
//! 2. Pull the last argument of `decoded` and verify it is `Array<Bytes>`
//!    (`self_array_bytes_last_arg` semantics — V3 NPM, Multicall3, SR02).
//! 3. For each inner `Bytes`:
//!    * Reject calldata shorter than 4 bytes (no selector).
//!    * Build a child `CallMatchKey { chain_id, to: ctx.to, selector }`.
//!    * Build a child `MapContext` via [`MapContext::child`], which bumps
//!      `depth` and stores the inner calldata in `parent_calldata`.
//!    * Reject when the child's depth exceeds `max_depth` (spec §5.1).
//!    * Dispatch through `ctx.resolver.resolve_child(...)` and collect the
//!      resulting envelopes.
//! 4. Flatten and return.
//!
//! `ctx.resolver` MUST be wired by the host. If it is `None`, the interpreter
//! cannot recurse — we surface a clear error so the caller knows the host
//! capability is missing rather than returning an empty vector.

use abi_resolver::{CallMatchKey, DecodedCall, DecodedValue};
use policy_engine::ActionEnvelope;

use crate::mapper::{MapContext, MapperError};

use super::types::EmitRule;

/// Recurse rule id supported by the Phase 4 PoC. Matches spec §5.1 BNF
/// (`RecurseRuleId := "self_array_bytes_last_arg" | ...`).
pub const RULE_ID_SELF_ARRAY_BYTES_LAST_ARG: &str = "self_array_bytes_last_arg";

/// Execute a `multicall_recurse` rule against the given decoded outer call.
///
/// Returns the flattened envelopes emitted by the inner steps, or an error if
/// the rule shape is unsupported, the host resolver is missing, the recursion
/// would exceed `max_depth`, or any child dispatch fails.
pub fn execute(
    ctx: &MapContext<'_>,
    decoded: &DecodedCall,
    rule: &EmitRule,
) -> Result<Vec<ActionEnvelope>, MapperError> {
    let (recurse_rule_id, max_depth) = match rule {
        EmitRule::MulticallRecurse {
            recurse_rule_id,
            max_depth,
        } => (recurse_rule_id.as_str(), *max_depth),
        other => {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "multicall::execute called with non-multicall_recurse rule: {other:?}"
            )));
        }
    };

    if recurse_rule_id != RULE_ID_SELF_ARRAY_BYTES_LAST_ARG {
        return Err(MapperError::Internal(anyhow::anyhow!(
            "multicall_recurse rule id {recurse_rule_id:?} not implemented in Phase 4 PoC \
             (only {RULE_ID_SELF_ARRAY_BYTES_LAST_ARG:?} supported)"
        )));
    }

    let resolver = ctx.resolver.ok_or_else(|| {
        MapperError::Internal(anyhow::anyhow!(
            "multicall_recurse requires ctx.resolver (host:resolver), but it is None — \
             host did not wire a ChildResolver"
        ))
    })?;

    let children = extract_self_array_bytes(decoded)?;

    let mut envelopes = Vec::new();
    for (index, child_calldata) in children.iter().enumerate() {
        if child_calldata.len() < 4 {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "multicall_recurse child #{index} has calldata shorter than 4 bytes \
                 (len={})",
                child_calldata.len()
            )));
        }
        let mut selector = [0u8; 4];
        selector.copy_from_slice(&child_calldata[..4]);

        // Child to == parent to (self_array_bytes_last_arg = self-multicall).
        let child_key = CallMatchKey {
            chain_id: ctx.chain_id,
            to: ctx.to.clone(),
            selector,
        };

        // Build a child context with depth+1 and parent_calldata = inner bytes.
        let child_ctx = ctx.child(ctx.to, child_calldata);

        // Spec §5.1: `max_depth: 1..5`. Reject when the child's depth would
        // exceed the bundle's bound. `depth` is already incremented in
        // `MapContext::child`, so a comparison against `max_depth` directly
        // reflects "how many recursion levels are still allowed".
        if u32::from(child_ctx.depth) > u32::from(max_depth) {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "multicall_recurse exceeded max_depth: child depth {} > max_depth {}",
                child_ctx.depth,
                max_depth
            )));
        }

        let child_envelopes =
            resolver.resolve_child(&child_key, &child_ctx, child_calldata)?;
        envelopes.extend(child_envelopes);
    }

    Ok(envelopes)
}

/// Pull the inner `bytes[]` payload from the *last* argument of a decoded
/// outer call. Matches the structural assumption of
/// `self_array_bytes_last_arg`: the outer ABI ends in a `bytes[]` argument
/// whose elements are each calldata for the *same* contract (self-multicall).
///
/// This mirrors `abi_resolver::subdecode::recurse::extract_subcalls`, but
/// operates against `decoder::DecodedCall` (the mapper-side decoded view) so
/// the interpreter does not need to re-decode raw bytes.
fn extract_self_array_bytes(decoded: &DecodedCall) -> Result<Vec<Vec<u8>>, MapperError> {
    let last = decoded.args.last().ok_or_else(|| {
        MapperError::Internal(anyhow::anyhow!(
            "multicall_recurse expected at least 1 argument, got 0"
        ))
    })?;

    let array_items = match &last.value {
        DecodedValue::Array(items) => items,
        other => {
            return Err(MapperError::Internal(anyhow::anyhow!(
                "multicall_recurse last argument must be Array<Bytes>, got {other:?}"
            )));
        }
    };

    let mut out = Vec::with_capacity(array_items.len());
    for (index, item) in array_items.iter().enumerate() {
        match item {
            DecodedValue::Bytes(bytes) => out.push(bytes.clone()),
            other => {
                return Err(MapperError::Internal(anyhow::anyhow!(
                    "multicall_recurse child #{index} is not Bytes, got {other:?}"
                )));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::str::FromStr as _;
    use std::sync::Mutex;

    use abi_resolver::{DecodedArg, DecoderId};
    use policy_engine::action::dex::{SwapAction, SwapMode};
    use policy_engine::action::{
        Action, ActionEnvelope, Address, AmountConstraint, AmountKind, AssetKind, AssetRef,
        AssetRefWithAmountConstraint, Category, DecimalString,
    };

    use crate::mapper::{ChildResolver, MapContext, MapperError};
    use crate::token_registry::EmptyTokenRegistry;

    use super::*;

    /// Captures every child the resolver is asked about and returns a
    /// pre-configured envelope per call. `inner_response` controls whether a
    /// given call returns envelopes or surfaces an error.
    struct RecordingResolver {
        calls: Mutex<Vec<RecordedCall>>,
        responses: Mutex<Vec<Result<Vec<ActionEnvelope>, MapperError>>>,
    }

    struct RecordedCall {
        key: CallMatchKey,
        calldata: Vec<u8>,
        depth: u8,
        had_parent: bool,
    }

    impl RecordingResolver {
        fn new(responses: Vec<Result<Vec<ActionEnvelope>, MapperError>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responses: Mutex::new(responses),
            }
        }

        fn calls(&self) -> std::sync::MutexGuard<'_, Vec<RecordedCall>> {
            self.calls.lock().unwrap()
        }
    }

    impl ChildResolver for RecordingResolver {
        fn resolve_child(
            &self,
            child: &CallMatchKey,
            ctx: &MapContext<'_>,
            child_calldata: &[u8],
        ) -> Result<Vec<ActionEnvelope>, MapperError> {
            self.calls.lock().unwrap().push(RecordedCall {
                key: child.clone(),
                calldata: child_calldata.to_vec(),
                depth: ctx.depth,
                had_parent: ctx.parent_calldata.is_some(),
            });
            let mut responses = self.responses.lock().unwrap();
            responses
                .pop()
                .unwrap_or_else(|| {
                    Err(MapperError::Internal(anyhow::anyhow!(
                        "RecordingResolver exhausted"
                    )))
                })
        }
    }

    fn fake_envelope(amount: &str) -> ActionEnvelope {
        ActionEnvelope {
            category: Category::Dex,
            action: Action::Swap(SwapAction {
                swap_mode: SwapMode::ExactIn,
                input_token: AssetRefWithAmountConstraint {
                    asset: AssetRef {
                        kind: AssetKind::Erc20,
                        address: Some(Address::from_str("0x1111111111111111111111111111111111111111").unwrap()),
                        token_id: None,
                        symbol: None,
                        decimals: None,
                    },
                    amount: AmountConstraint {
                        kind: AmountKind::Exact,
                        value: Some(DecimalString::from_str(amount).unwrap()),
                    },
                },
                output_token: AssetRefWithAmountConstraint {
                    asset: AssetRef {
                        kind: AssetKind::Erc20,
                        address: Some(Address::from_str("0x2222222222222222222222222222222222222222").unwrap()),
                        token_id: None,
                        symbol: None,
                        decimals: None,
                    },
                    amount: AmountConstraint {
                        kind: AmountKind::Min,
                        value: Some(DecimalString::from_str("0").unwrap()),
                    },
                },
                recipient: Address::from_str("0x3333333333333333333333333333333333333333").unwrap(),
                validity: None,
                fee_bps: None,
            }),
        }
    }

    fn multicall_decoded(items: Vec<DecodedValue>) -> DecodedCall {
        DecodedCall {
            decoder_id: DecoderId::new("declarative.uniswap-v3/nfpm-multicall"),
            function_signature: "multicall(bytes[])".into(),
            args: vec![DecodedArg {
                name: "data".into(),
                abi_type: "bytes[]".into(),
                value: DecodedValue::Array(items),
            }],
            nested: vec![],
        }
    }

    fn rule(depth: u8) -> EmitRule {
        EmitRule::MulticallRecurse {
            recurse_rule_id: RULE_ID_SELF_ARRAY_BYTES_LAST_ARG.into(),
            max_depth: depth,
        }
    }

    fn ctx_with_resolver<'a>(
        resolver: &'a dyn ChildResolver,
        registry: &'a EmptyTokenRegistry,
        from: &'a Address,
        to: &'a Address,
        value: &'a DecimalString,
        depth: u8,
    ) -> MapContext<'a> {
        MapContext {
            chain_id: 1,
            from,
            to,
            value_wei: value,
            block_timestamp: Some(1_700_000_000),
            token_registry: registry,
            parent_calldata: None,
            depth,
            resolver: Some(resolver),
        }
    }

    #[test]
    fn two_inner_calls_dispatch_to_resolver_and_flatten() {
        // Two inner bytes, each = 4-byte selector + 4 padding bytes.
        let inner_a: Vec<u8> = vec![0x12, 0x34, 0x56, 0x78, 0xaa, 0xaa, 0xaa, 0xaa];
        let inner_b: Vec<u8> = vec![0xde, 0xad, 0xbe, 0xef, 0xbb, 0xbb, 0xbb, 0xbb];
        let decoded = multicall_decoded(vec![
            DecodedValue::Bytes(inner_a.clone()),
            DecodedValue::Bytes(inner_b.clone()),
        ]);

        // responses are popped from the back — so the first child consumes
        // the LAST response. Stack two envelopes in reverse order.
        let resolver = RecordingResolver::new(vec![
            Ok(vec![fake_envelope("200")]),
            Ok(vec![fake_envelope("100")]),
        ]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 0);

        let envelopes = execute(&ctx, &decoded, &rule(3)).unwrap();
        assert_eq!(envelopes.len(), 2);

        let calls = resolver.calls();
        assert_eq!(calls.len(), 2);
        // Both child keys share the parent's chain_id + to address and a
        // selector pulled from the first 4 bytes of the inner calldata.
        assert_eq!(calls[0].key.chain_id, 1);
        assert_eq!(calls[0].key.to, to);
        assert_eq!(calls[0].key.selector, [0x12, 0x34, 0x56, 0x78]);
        assert_eq!(calls[0].calldata, inner_a);
        assert_eq!(calls[0].depth, 1, "child depth must be parent depth + 1");
        assert!(calls[0].had_parent, "child must have parent_calldata set");

        assert_eq!(calls[1].key.selector, [0xde, 0xad, 0xbe, 0xef]);
        assert_eq!(calls[1].calldata, inner_b);
        assert_eq!(calls[1].depth, 1);
    }

    #[test]
    fn missing_resolver_errors() {
        let decoded = multicall_decoded(vec![DecodedValue::Bytes(vec![
            0x12, 0x34, 0x56, 0x78, 0xaa, 0xaa, 0xaa, 0xaa,
        ])]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = MapContext {
            chain_id: 1,
            from: &from,
            to: &to,
            value_wei: &value,
            block_timestamp: Some(1_700_000_000),
            token_registry: &registry,
            parent_calldata: None,
            depth: 0,
            resolver: None,
        };

        let err = execute(&ctx, &decoded, &rule(3)).unwrap_err();
        assert!(err.to_string().contains("requires ctx.resolver"));
    }

    #[test]
    fn unsupported_rule_id_errors() {
        let decoded = multicall_decoded(vec![]);
        let resolver = RecordingResolver::new(vec![]);
        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 0);
        let bad_rule = EmitRule::MulticallRecurse {
            recurse_rule_id: "safe_multisend_packed".into(),
            max_depth: 3,
        };

        let err = execute(&ctx, &decoded, &bad_rule).unwrap_err();
        assert!(err.to_string().contains("not implemented in Phase 4"));
    }

    #[test]
    fn depth_check_blocks_recursion_at_max_depth() {
        // ctx.depth = 3, max_depth = 3 → child depth would be 4 → reject.
        let decoded = multicall_decoded(vec![DecodedValue::Bytes(vec![
            0x12, 0x34, 0x56, 0x78, 0xaa, 0xaa, 0xaa, 0xaa,
        ])]);
        let resolver = RecordingResolver::new(vec![Ok(vec![fake_envelope("1")])]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 3);

        let err = execute(&ctx, &decoded, &rule(3)).unwrap_err();
        assert!(err.to_string().contains("exceeded max_depth"));
        // The resolver must not be invoked when the depth gate trips first.
        assert!(resolver.calls().is_empty());
    }

    #[test]
    fn depth_check_allows_recursion_below_max_depth() {
        // ctx.depth = 2, max_depth = 3 → child depth 3 ≤ 3 → allow.
        let decoded = multicall_decoded(vec![DecodedValue::Bytes(vec![
            0x12, 0x34, 0x56, 0x78, 0xaa, 0xaa, 0xaa, 0xaa,
        ])]);
        let resolver = RecordingResolver::new(vec![Ok(vec![fake_envelope("1")])]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 2);

        let envelopes = execute(&ctx, &decoded, &rule(3)).unwrap();
        assert_eq!(envelopes.len(), 1);
        assert_eq!(resolver.calls()[0].depth, 3);
    }

    #[test]
    fn calldata_shorter_than_four_bytes_errors() {
        let decoded = multicall_decoded(vec![DecodedValue::Bytes(vec![0x12, 0x34])]);
        let resolver = RecordingResolver::new(vec![]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 0);

        let err = execute(&ctx, &decoded, &rule(3)).unwrap_err();
        assert!(err.to_string().contains("shorter than 4 bytes"));
    }

    #[test]
    fn non_array_last_arg_errors() {
        let decoded = DecodedCall {
            decoder_id: DecoderId::new("declarative.uniswap-v3/nfpm-multicall"),
            function_signature: "multicall(uint256)".into(),
            args: vec![DecodedArg {
                name: "x".into(),
                abi_type: "uint256".into(),
                value: DecodedValue::Uint(alloy_primitives::U256::from(1u8)),
            }],
            nested: vec![],
        };
        let resolver = RecordingResolver::new(vec![]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 0);

        let err = execute(&ctx, &decoded, &rule(3)).unwrap_err();
        assert!(err.to_string().contains("must be Array<Bytes>"));
    }

    #[test]
    fn empty_array_returns_empty_envelopes() {
        let decoded = multicall_decoded(vec![]);
        let resolver = RecordingResolver::new(vec![]);

        let registry = EmptyTokenRegistry;
        let from = Address::from_str("0x000000000000000000000000000000000000aaaa").unwrap();
        let to = Address::from_str("0xC36442b4a4522E871399CD717aBDD847Ab11FE88").unwrap();
        let value = DecimalString::from_str("0").unwrap();
        let ctx = ctx_with_resolver(&resolver, &registry, &from, &to, &value, 0);

        let envelopes = execute(&ctx, &decoded, &rule(3)).unwrap();
        assert!(envelopes.is_empty());
        assert!(resolver.calls().is_empty());
    }

    /// Stub to silence the unused-import lint when `RefCell` isn't needed in
    /// this module — leftover from an earlier iteration.
    #[allow(dead_code)]
    fn _refcell_marker() {
        let _ = RefCell::new(0);
    }
}
