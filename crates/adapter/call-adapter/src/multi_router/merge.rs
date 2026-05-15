//! Collapse plumbing envelopes into adjacent Swap envelopes.
//!
//! After [`super::commands::expand_commands`] fans out a UR command stream
//! into one envelope per opcode, two patterns are common:
//!
//! - `[WRAP_ETH, SWAP(WETH → X)]` — user intent is "swap ETH for X".
//!   The `WRAP_ETH` step is just plumbing because V3/V2 routers only accept
//!   ERC-20 inputs.
//! - `[SWAP(X → WETH), UNWRAP_WETH]` — user intent is "swap X for ETH".
//!   The `UNWRAP_WETH` step delivers the native asset to the user.
//!
//! Without merging, both surface as two envelopes per swap, and the wallet
//! UI shows duplicate intent. We collapse them in a single forward pass:
//! the wrapped-asset address on the Wrap/Unwrap step must equal the
//! corresponding side of the adjacent Swap.
//!
//! Anything we don't recognise (e.g. `[SWAP, SWAP]` to different pairs, or
//! `[WRAP_ETH, V2_SWAP(USDT → DAI)]` where the wrap doesn't feed the swap)
//! falls through unchanged — better fan-out than wrong merge.

use policy_engine::action::{Action, ActionEnvelope, AssetRef};

/// Apply a single forward pass over the envelope list, collapsing
/// recognised plumbing patterns into the adjacent Swap.
pub(super) fn merge(envelopes: Vec<ActionEnvelope>) -> Vec<ActionEnvelope> {
    let mut out: Vec<ActionEnvelope> = Vec::with_capacity(envelopes.len());

    for env in envelopes {
        if let Some(last) = out.last_mut() {
            match (&mut last.action, &env.action) {
                // Pattern 1: WRAP_ETH then SWAP(WETH → X) →
                //   rewrite swap.token_in = ETH, drop the wrap envelope.
                (Action::Wrap(wrap), Action::Swap(swap))
                    if asset_eq(&wrap.wrapped_asset, &swap.token_in) =>
                {
                    let mut merged = swap.clone();
                    merged.token_in = wrap.native_asset.clone();
                    *last = ActionEnvelope {
                        category: env.category,
                        action: Action::Swap(merged),
                    };
                    continue;
                }
                // Pattern 2: SWAP(X → WETH) then UNWRAP_WETH →
                //   rewrite swap.token_out = ETH, drop the unwrap envelope.
                (Action::Swap(swap), Action::Unwrap(unwrap))
                    if asset_eq(&swap.token_out, &unwrap.wrapped_asset) =>
                {
                    swap.token_out = unwrap.native_asset.clone();
                    swap.recipient = unwrap.recipient.clone();
                    continue;
                }
                _ => {}
            }
        }
        out.push(env);
    }

    out
}

/// Two `AssetRef`s refer to the same on-chain token iff their `(chain_id,
/// address)` match. Native assets carry `address: None` and never compare
/// equal to wrapped (Erc20) assets, which is the desired behaviour here.
fn asset_eq(a: &AssetRef, b: &AssetRef) -> bool {
    a.chain_id == b.chain_id && a.address.is_some() && a.address == b.address
}

#[cfg(test)]
mod tests {
    use std::str::FromStr as _;

    use policy_engine::action::dex::{SwapAction, SwapEnrichment, SwapMode};
    use policy_engine::action::misc::{UnwrapAction, WrapAction};
    use policy_engine::action::{
        Address, AmountConstraint, AmountKind, AssetKind, Category, DecimalString,
    };

    use super::*;

    const WETH: &str = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

    fn addr(s: &str) -> Address {
        Address::from_str(s).unwrap()
    }
    fn dec(s: &str) -> DecimalString {
        DecimalString::from_str(s).unwrap()
    }
    fn native() -> AssetRef {
        AssetRef {
            kind: AssetKind::Native,
            chain_id: 1,
            address: None,
            symbol: Some("ETH".into()),
            decimals: Some(18),
        }
    }
    fn erc20(addr_hex: &str) -> AssetRef {
        AssetRef {
            kind: AssetKind::Erc20,
            chain_id: 1,
            address: Some(addr(addr_hex)),
            symbol: None,
            decimals: None,
        }
    }
    fn amt(kind: AmountKind, n: &str) -> AmountConstraint {
        AmountConstraint {
            kind,
            value: Some(dec(n)),
        }
    }
    fn user() -> Address {
        addr("0x1111111111111111111111111111111111111111")
    }

    fn wrap_env() -> ActionEnvelope {
        ActionEnvelope {
            category: Category::Misc,
            action: Action::Wrap(WrapAction {
                native_asset: native(),
                wrapped_asset: erc20(WETH),
                amount: amt(AmountKind::Min, "1000"),
                recipient: user(),
            }),
        }
    }

    fn unwrap_env() -> ActionEnvelope {
        ActionEnvelope {
            category: Category::Misc,
            action: Action::Unwrap(UnwrapAction {
                wrapped_asset: erc20(WETH),
                native_asset: native(),
                amount: amt(AmountKind::Min, "1000"),
                recipient: user(),
            }),
        }
    }

    fn swap_env(token_in: AssetRef, token_out: AssetRef) -> ActionEnvelope {
        ActionEnvelope {
            category: Category::Dex,
            action: Action::Swap(SwapAction {
                mode: SwapMode::ExactIn,
                token_in,
                token_out,
                amount_in: amt(AmountKind::Exact, "1000"),
                amount_out: amt(AmountKind::Min, "500"),
                recipient: user(),
                validity: None,
                fee_bps: Some(30),
                enrichment: SwapEnrichment::default(),
            }),
        }
    }

    #[test]
    fn wrap_then_swap_collapses_to_eth_in_swap() {
        let merged = merge(vec![wrap_env(), swap_env(erc20(WETH), erc20(USDC))]);
        assert_eq!(merged.len(), 1);
        let Action::Swap(s) = &merged[0].action else {
            panic!("expected Swap")
        };
        assert!(matches!(s.token_in.kind, AssetKind::Native));
        assert!(s.token_in.address.is_none());
        assert_eq!(s.token_out.address, Some(addr(USDC)));
    }

    #[test]
    fn swap_then_unwrap_collapses_to_eth_out_swap() {
        let merged = merge(vec![swap_env(erc20(USDC), erc20(WETH)), unwrap_env()]);
        assert_eq!(merged.len(), 1);
        let Action::Swap(s) = &merged[0].action else {
            panic!("expected Swap")
        };
        assert_eq!(s.token_in.address, Some(addr(USDC)));
        assert!(matches!(s.token_out.kind, AssetKind::Native));
        assert!(s.token_out.address.is_none());
    }

    #[test]
    fn unrelated_wrap_and_swap_stay_split() {
        // WRAP feeds WETH but the swap's token_in is USDC — should NOT merge.
        let merged = merge(vec![wrap_env(), swap_env(erc20(USDC), erc20(WETH))]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn two_independent_swaps_stay_split() {
        let merged = merge(vec![
            swap_env(erc20(WETH), erc20(USDC)),
            swap_env(erc20(WETH), erc20(USDC)),
        ]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn empty_in_empty_out() {
        assert!(merge(vec![]).is_empty());
    }

    #[test]
    fn full_round_trip_eth_to_eth() {
        // [WRAP, SWAP(WETH→USDC), SWAP(USDC→WETH), UNWRAP]
        // First two collapse to Swap(ETH→USDC). Then Swap(USDC→WETH) is
        // NOT mergeable with the previous (already-collapsed) swap.
        // Final unwrap collapses with that second swap → Swap(USDC→ETH).
        let merged = merge(vec![
            wrap_env(),
            swap_env(erc20(WETH), erc20(USDC)),
            swap_env(erc20(USDC), erc20(WETH)),
            unwrap_env(),
        ]);
        assert_eq!(merged.len(), 2);
        let Action::Swap(first) = &merged[0].action else {
            panic!("first should be swap")
        };
        let Action::Swap(second) = &merged[1].action else {
            panic!("second should be swap")
        };
        assert!(matches!(first.token_in.kind, AssetKind::Native));
        assert_eq!(first.token_out.address, Some(addr(USDC)));
        assert_eq!(second.token_in.address, Some(addr(USDC)));
        assert!(matches!(second.token_out.kind, AssetKind::Native));
    }
}
