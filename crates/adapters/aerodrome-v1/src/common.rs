//! Shared resources for Aerodrome V1 (Solidly-fork) Router swap-function adapters.
//!
//! Aerodrome V1 deviates from Uniswap V2 in two structurally significant ways:
//!
//! 1. The `path: address[]` parameter is replaced by `Route[] routes`, where
//!    each leg carries `(from, to, stable, factory)`. The `stable` flag selects
//!    a constant-sum / constant-product hybrid curve on the per-leg pool;
//!    `factory` allows alternate factory deployments without changing the
//!    router. This adapter validates leg continuity (`routes[i].to ==
//!    routes[i+1].from`) and emits the per-leg `stable` flag into the audit
//!    trace.
//!
//! 2. Swap fees are stored on the per-leg pool, not in calldata. We emit
//!    `max_fee_bps = max(stable ? 5 : 30 across legs)` as a coarse upper
//!    bound and record `fee_bps_estimate=N` in trace. Hosts that need
//!    precise fee enforcement must introduce a fee oracle.
//!
//! The Aerodrome `Gauge` and `Voter` contracts (gauge voting, ve(3,3)
//! emissions) are NOT in scope for this adapter; only the V1 Router's swap
//! entry points are.

use alloy_primitives::{address, Address as AlloyAddress};
use policy_engine::prelude::*;
use std::collections::HashMap;

/// Aerodrome V1 Router on Base.
pub const AERODROME_V1_ROUTER_BASE: &str = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";

/// Sentinel address used to represent native ETH on Base inside our `Token`
/// model. Not the same as any deployed token contract — purely an identifier.
pub const NATIVE_ETH_SENTINEL: &str = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/// Construct a `Token` representing native ETH on Base.
#[must_use]
pub fn native_eth(chain_id: ChainId) -> Token {
    Token {
        chain_id,
        address: Address::from_alloy(address!("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")),
        symbol: "ETH".into(),
        decimals: 18,
        is_native: true,
    }
}

pub(crate) fn router_address() -> Address {
    Address::from_alloy(address!("0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43"))
}

#[allow(clippy::panic)]
pub(crate) fn static_adapter_id(raw: &str) -> AdapterId {
    match AdapterId::new(raw) {
        Ok(id) => id,
        Err(err) => panic!("invalid static adapter id {raw}: {err}"),
    }
}

/// Public-facing decoded Aerodrome route.
///
/// Mirrors the Solidity `Route { address from; address to; bool stable;
/// address factory; }` so external callers can construct one without
/// depending on alloy's internal types. The wire-level Solidity struct
/// (`SolRoute`) is declared inside each per-function module's `sol!` block,
/// since `alloy_sol_types::sol!` cannot share custom-type declarations
/// across separate invocations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    /// Input token of this leg.
    pub from: AlloyAddress,
    /// Output token of this leg.
    pub to: AlloyAddress,
    /// True if this leg uses Aerodrome's stable (constant-sum-flavoured) curve.
    pub stable: bool,
    /// Factory address that deployed the underlying pool. Allows alternate
    /// factory deployments to coexist behind the same router.
    pub factory: AlloyAddress,
}

/// Validate route-leg continuity and return `(token_in, token_out)`.
///
/// `token_in` is `routes[0].from`; `token_out` is the last leg's `to`.
/// Returns `BadCalldata` on empty routes or on a break where
/// `routes[i].to != routes[i+1].from`.
pub(crate) fn route_endpoints(
    routes: &[Route],
) -> Result<(AlloyAddress, AlloyAddress), AdapterError> {
    if routes.is_empty() {
        return Err(AdapterError::BadCalldata(
            "aerodrome-v1 routes must contain at least one leg, got 0".into(),
        ));
    }
    for window in routes.windows(2) {
        if window[0].to != window[1].from {
            return Err(AdapterError::BadCalldata(format!(
                "aerodrome-v1 route leg break: {:?} -> {:?}",
                window[0].to, window[1].from
            )));
        }
    }
    Ok((routes[0].from, routes[routes.len() - 1].to))
}

/// Coarse fee-bps estimate per leg (Aerodrome stores real fees on the
/// pool/factory, not in calldata): stable legs ≈ 5 bps, volatile ≈ 30 bps.
const fn estimate_fee_bps(stable: bool) -> u32 {
    if stable {
        5
    } else {
        30
    }
}

/// Maximum fee-bps estimate across the route. Used as the leg-wise upper
/// bound in `DexFacts.max_fee_bps`.
pub(crate) fn max_fee_bps_across(routes: &[Route]) -> Option<u32> {
    routes
        .iter()
        .map(|r| estimate_fee_bps(r.stable))
        .max()
}

/// Format the route summary used in `DexTrace::steps`. Records each leg's
/// `stable` flag for audit; the `DexFacts::max_fee_bps` is a coarse summary
/// derived from these flags.
pub(crate) fn trace_routes(routes: &[Route]) -> String {
    use std::fmt::Write as _;
    let mut s = String::from("routes=[");
    for (i, r) in routes.iter().enumerate() {
        if i > 0 {
            s.push_str(", ");
        }
        let _ = write!(s, "{}->{} stable={}", r.from, r.to, r.stable);
    }
    s.push(']');
    s
}

/// Build a DEX swap action from decoded Aerodrome V1 router parameters.
#[allow(clippy::too_many_arguments)]
pub(crate) fn dex_swap_action(
    tx: &TransactionRequest,
    protocol_id: &str,
    input_token: Token,
    output_token: Token,
    input_raw: String,
    min_output_raw: Option<String>,
    recipient: &Address,
    routes: &[Route],
    trace_step_prefix: &str,
) -> Action {
    let mut oracle_requirements = vec![OracleRequirement {
        kind: OracleRequirementKind::Input,
        token: input_token.clone(),
        raw_amount: input_raw,
    }];
    let has_zero_min_output = min_output_raw.as_deref() == Some("0");
    if let Some(raw_amount) = min_output_raw {
        oracle_requirements.push(OracleRequirement {
            kind: OracleRequirementKind::MinOutput,
            token: output_token.clone(),
            raw_amount,
        });
    }

    let max_fee_bps = max_fee_bps_across(routes);
    let fee_estimate = max_fee_bps.map_or_else(|| "none".to_string(), |bps| bps.to_string());
    let trace_step = format!(
        "{trace_step_prefix} {} (fee_bps_estimate={fee_estimate})",
        trace_routes(routes),
    );

    Action::Dex(DexAction {
        actor: tx.from.clone(),
        target: tx.to.clone(),
        value_wei: tx.value_wei.clone(),
        facts: DexFacts {
            protocol_ids: vec![protocol_id.into()],
            input_tokens: vec![input_token],
            output_tokens: vec![output_token],
            max_fee_bps,
            has_zero_min_output,
            has_external_recipient: recipient != &tx.from,
            ..DexFacts::default()
        },
        oracle_requirements,
        trace: DexTrace {
            steps: vec![trace_step],
        },
    })
}

/// Token metadata lookup for Aerodrome V1 swap adapters.
#[derive(Debug)]
pub struct TokenLookup {
    tokens: HashMap<(ChainId, String), Token>,
}

impl TokenLookup {
    /// Builds a lookup pre-populated with the canonical Base assets:
    /// USDC, WETH, and AERO.
    #[must_use]
    pub fn with_base_defaults() -> Self {
        let mut me = Self {
            tokens: HashMap::new(),
        };
        // USDC on Base (Circle's native, 6 decimals)
        me.add(Token {
            chain_id: 8453,
            address: Address::from_alloy(address!("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")),
            symbol: "USDC".into(),
            decimals: 6,
            is_native: false,
        });
        // WETH on Base
        me.add(Token {
            chain_id: 8453,
            address: Address::from_alloy(address!("0x4200000000000000000000000000000000000006")),
            symbol: "WETH".into(),
            decimals: 18,
            is_native: false,
        });
        // AERO (Aerodrome governance/fee token)
        me.add(Token {
            chain_id: 8453,
            address: Address::from_alloy(address!("0x940181a94a35a4569e4529a3cdfb74e38fd98631")),
            symbol: "AERO".into(),
            decimals: 18,
            is_native: false,
        });
        me
    }

    /// Adds or replaces one token by chain and address.
    pub fn add(&mut self, token: Token) {
        self.tokens.insert(
            (token.chain_id, token.address.as_str().to_lowercase()),
            token,
        );
    }

    /// Returns this lookup after adding `token`.
    #[must_use]
    pub fn with(mut self, token: Token) -> Self {
        self.add(token);
        self
    }

    /// Returns known metadata or an `UNKNOWN` token placeholder.
    #[must_use]
    pub fn get(&self, chain_id: ChainId, addr: &Address) -> Token {
        self.tokens
            .get(&(chain_id, addr.as_str().to_lowercase()))
            .cloned()
            .unwrap_or_else(|| Token {
                chain_id,
                address: addr.clone(),
                symbol: "UNKNOWN".into(),
                decimals: 18,
                is_native: false,
            })
    }
}

impl Default for TokenLookup {
    fn default() -> Self {
        Self::with_base_defaults()
    }
}

/// Errors returned by Aerodrome V1 calldata decoders.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DecodeError {
    /// Calldata is shorter than the minimum required length.
    #[error("calldata too short: need at least {need} bytes, got {got}")]
    TooShort {
        /// Required byte length.
        need: usize,
        /// Actual byte length.
        got: usize,
    },
    /// The four-byte selector does not match the expected function.
    #[error("unexpected selector: got 0x{got}, expected 0x{want}")]
    BadSelector {
        /// Observed selector hex.
        got: String,
        /// Expected selector hex.
        want: String,
    },
    /// ABI decoding failed.
    #[error("ABI decode failed: {0}")]
    AbiDecode(String),
    /// Routes array did not contain at least one leg.
    #[error("routes array must contain at least one leg, got {0}")]
    EmptyRoutes(usize),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn addr(s: &str) -> AlloyAddress {
        AlloyAddress::from_str(s).unwrap()
    }

    #[test]
    fn token_lookup_returns_known_base_tokens() {
        let lookup = TokenLookup::with_base_defaults();
        let usdc = Address::new("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").unwrap();
        assert_eq!(lookup.get(8453, &usdc).symbol, "USDC");
        let aero = Address::new("0x940181a94A35A4569E4529A3CDfB74e38FD98631").unwrap();
        assert_eq!(lookup.get(8453, &aero).symbol, "AERO");
    }

    #[test]
    fn route_endpoints_single_leg() {
        let routes = vec![Route {
            from: addr("0x0000000000000000000000000000000000000001"),
            to: addr("0x0000000000000000000000000000000000000002"),
            stable: false,
            factory: addr("0x0000000000000000000000000000000000000003"),
        }];
        let (a, b) = route_endpoints(&routes).unwrap();
        assert_eq!(a, routes[0].from);
        assert_eq!(b, routes[0].to);
    }

    #[test]
    fn route_endpoints_multi_leg_continuity_required() {
        let mid = addr("0x0000000000000000000000000000000000000005");
        let routes = vec![
            Route {
                from: addr("0x0000000000000000000000000000000000000001"),
                to: mid,
                stable: false,
                factory: addr("0x0000000000000000000000000000000000000003"),
            },
            Route {
                from: mid,
                to: addr("0x0000000000000000000000000000000000000007"),
                stable: true,
                factory: addr("0x0000000000000000000000000000000000000003"),
            },
        ];
        let (a, b) = route_endpoints(&routes).unwrap();
        assert_eq!(a, routes[0].from);
        assert_eq!(b, routes[1].to);
    }

    #[test]
    fn route_endpoints_rejects_break_in_continuity() {
        let routes = vec![
            Route {
                from: addr("0x0000000000000000000000000000000000000001"),
                to: addr("0x0000000000000000000000000000000000000002"),
                stable: false,
                factory: addr("0x0000000000000000000000000000000000000003"),
            },
            Route {
                from: addr("0x0000000000000000000000000000000000000099"),
                to: addr("0x0000000000000000000000000000000000000007"),
                stable: true,
                factory: addr("0x0000000000000000000000000000000000000003"),
            },
        ];
        assert!(route_endpoints(&routes).is_err());
    }

    #[test]
    fn route_endpoints_rejects_empty() {
        assert!(route_endpoints(&[]).is_err());
    }

    #[test]
    fn estimate_fee_bps_stable_vs_volatile() {
        assert_eq!(estimate_fee_bps(true), 5);
        assert_eq!(estimate_fee_bps(false), 30);
    }

    #[test]
    fn max_fee_bps_across_takes_max() {
        let routes = vec![
            Route {
                from: addr("0x0000000000000000000000000000000000000001"),
                to: addr("0x0000000000000000000000000000000000000002"),
                stable: true,
                factory: addr("0x0000000000000000000000000000000000000003"),
            },
            Route {
                from: addr("0x0000000000000000000000000000000000000002"),
                to: addr("0x0000000000000000000000000000000000000007"),
                stable: false,
                factory: addr("0x0000000000000000000000000000000000000003"),
            },
        ];
        // max(5, 30) = 30
        assert_eq!(max_fee_bps_across(&routes), Some(30));
    }
}
