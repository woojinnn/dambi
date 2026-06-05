//! Token-native "nano" amount projection shared across new-model lowerings.
//!
//! Cedar cannot compare U256 hex strings, so every fungible amount gets a
//! `Long` sibling `amountNano = raw × 10^(9 − decimals)` — the same Gwei-style
//! fixed point the builder / policy literals use (mirrors `NANO_SCALE` in
//! `browser-extension/.../local-method-handlers.ts::token.normalize_to_nano`).
//!
//! Decimals are NOT known to the (network-free, in-WASM) lowering, so the host
//! service-worker fetches them per token from the registry and injects them as
//! [`TokenDecimals`]. The lowering fills `amountNano` ONLY when the token's
//! decimals are present; when they are unknown the field is omitted (the
//! cedarschema sibling is optional), so a quantity-cap policy simply does not
//! fire for that token rather than mis-comparing.

use std::collections::BTreeMap;

use policy_state::primitives::U256;
use policy_state::token::TokenKey;

use super::cedar::addr;

/// Implicit Long-side exponent shared by every nano field (mirrors
/// `NANO_SCALE` in `local-method-handlers.ts`): the raw on-chain amount is
/// rescaled by `10^(9 − decimals)` so the resulting Long sits at a Gwei-style
/// unit regardless of the token's own decimals.
const NANO_SCALE: u32 = 9;

/// Host-injected per-token decimals, keyed by lowercase `0x` address (matching
/// [`addr`]). Built by the service-worker from on-demand registry lookups; an
/// empty map (the [`Default`]) means "no decimals known" — every `nano` lookup
/// then returns `None` and the lowering omits the nano field.
#[derive(Debug, Default, Clone)]
pub struct TokenDecimals(BTreeMap<String, u8>);

impl TokenDecimals {
    /// Build from a raw `address → decimals` map. Addresses are lowercased on
    /// insert so callers need not pre-normalize the keys.
    #[must_use]
    pub fn new(map: BTreeMap<String, u8>) -> Self {
        Self(
            map.into_iter()
                .map(|(k, v)| (k.to_lowercase(), v))
                .collect(),
        )
    }

    /// Decimals for a token key: the native gas asset is 18 (every EVM native
    /// is 18-decimal); ERC20 uses the injected value (`None` when absent); NFTs
    /// have no fungible decimals (`None`).
    #[must_use]
    pub fn decimals_for(&self, key: &TokenKey) -> Option<u8> {
        match key {
            TokenKey::Native { .. } => Some(18),
            TokenKey::Erc20 { address, .. } => self.0.get(&addr(address)).copied(),
            TokenKey::Erc721 { .. } | TokenKey::Erc1155 { .. } => None,
        }
    }

    /// Token-native nano for a `(key, raw amount)` pair, or `None` when the
    /// key's decimals are unknown.
    #[must_use]
    pub fn nano(&self, key: &TokenKey, raw: U256) -> Option<i64> {
        self.decimals_for(key).map(|d| nano_from_decimals(raw, d))
    }
}

/// `raw × 10^(9 − decimals)`, clamped into the `Long` range. Scale-UP saturates
/// to `i64::MAX`, so a quantity-cap (`amountNano >= N`) policy fails CLOSED on an
/// amount too large to represent (e.g. an `U256::MAX` "unlimited" approval still
/// trips a cap). Scale-DOWN truncates toward zero; an absurd `decimals` (≥ 87,
/// whose divisor `10^(decimals−9)` would exceed `U256::MAX`) yields `0` — the
/// mathematically correct result (such a token's human-scale units are
/// negligible) and, critically, never a wrapped garbage divisor (ruint `pow`
/// wraps silently). Production decimals come from the registry and the SW clamps
/// them to ≤ 36, so the guard is a robustness backstop for any unbounded caller.
#[must_use]
pub(crate) fn nano_from_decimals(raw: U256, decimals: u8) -> i64 {
    let decimals = u32::from(decimals);
    let nano: U256 = if decimals >= NANO_SCALE {
        // Scale DOWN: integer division truncates. `10^78 > U256::MAX`, so an
        // exponent ≥ 78 means the divisor exceeds every possible `raw` ⇒ 0.
        // Guard before `pow` (which WRAPS in ruint) so it never yields a small
        // garbage divisor (which would UNDER-count and fail a cap OPEN).
        let exp = decimals - NANO_SCALE;
        if exp > 77 {
            U256::ZERO
        } else {
            raw / U256::from(10u64).pow(U256::from(exp))
        }
    } else {
        // Scale UP: exponent ≤ 9 (never overflows `pow`); saturate the product at
        // U256::MAX so the i64 clamp below stays monotonic for absurd inputs.
        raw.saturating_mul(U256::from(10u64).pow(U256::from(NANO_SCALE - decimals)))
    };
    // U256 → i64, saturating. Go via u64 (ruint guarantees that conversion),
    // then clamp into the positive i64 range — amounts are non-negative.
    let as_u64 = u64::try_from(nano).unwrap_or(u64::MAX);
    i64::try_from(as_u64).unwrap_or(i64::MAX)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    use std::str::FromStr;

    use policy_state::primitives::{Address, ChainId};

    fn erc20(addr_hex: &str) -> TokenKey {
        TokenKey::Erc20 {
            chain: ChainId::ethereum_mainnet(),
            address: Address::from_str(addr_hex).unwrap(),
        }
    }

    /// 6-decimal USDC: 1000 USDC raw = 1_000_000_000 → nano = raw × 10^3.
    #[test]
    fn nano_six_decimals_scales_up() {
        // 1000 USDC = 1000 * 10^6 = 1_000_000_000 raw.
        let nano = nano_from_decimals(U256::from(1_000_000_000u64), 6);
        assert_eq!(nano, 1_000_000_000_000); // 1000 * 10^9
    }

    /// 18-decimal WETH: 1 WETH raw = 10^18 → nano = raw / 10^9 = 10^9.
    #[test]
    fn nano_eighteen_decimals_scales_down() {
        let one_weth = U256::from(1_000_000_000_000_000_000u64);
        assert_eq!(nano_from_decimals(one_weth, 18), 1_000_000_000); // 1 token = 1e9 nano
    }

    /// decimals == 9 is the identity exponent.
    #[test]
    fn nano_nine_decimals_identity() {
        assert_eq!(nano_from_decimals(U256::from(12_345u64), 9), 12_345);
    }

    /// Zero decimals scales up by 10^9.
    #[test]
    fn nano_zero_decimals() {
        assert_eq!(nano_from_decimals(U256::from(5u64), 0), 5_000_000_000);
    }

    /// An absurd amount (U256::MAX, e.g. an "unlimited" approval) saturates to
    /// i64::MAX rather than wrapping — a cap policy still fires.
    #[test]
    fn nano_saturates_to_i64_max() {
        assert_eq!(nano_from_decimals(U256::MAX, 18), i64::MAX);
        assert_eq!(nano_from_decimals(U256::MAX, 6), i64::MAX);
    }

    /// A token claiming an absurd number of decimals must NOT wrap the scale-down
    /// divisor (ruint `pow` wraps): the nano truncates to 0 (negligible human
    /// units), never a garbage small value that could under-count a cap.
    #[test]
    fn nano_absurd_decimals_truncate_to_zero_not_wrap() {
        assert_eq!(nano_from_decimals(U256::MAX, 87), 0);
        assert_eq!(nano_from_decimals(U256::MAX, 90), 0);
        assert_eq!(nano_from_decimals(U256::MAX, 255), 0);
    }

    /// Native key resolves to 18 decimals without any injected map.
    #[test]
    fn native_key_is_eighteen_decimals() {
        let td = TokenDecimals::default();
        let native = TokenKey::Native {
            chain: ChainId::ethereum_mainnet(),
        };
        assert_eq!(td.decimals_for(&native), Some(18));
        // 1 ETH raw = 10^18 → nano 10^9.
        assert_eq!(
            td.nano(&native, U256::from(1_000_000_000_000_000_000u64)),
            Some(1_000_000_000)
        );
    }

    /// ERC20 decimals come from the injected map, case-insensitively, and are
    /// `None` when absent.
    #[test]
    fn erc20_decimals_from_injected_map_case_insensitive() {
        let addr_lc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
        let mut map = BTreeMap::new();
        // Insert with checksum/upper casing to prove `new` lowercases.
        map.insert(addr_lc.to_uppercase(), 6u8);
        let td = TokenDecimals::new(map);

        let key = erc20(addr_lc);
        assert_eq!(td.decimals_for(&key), Some(6));

        let unknown = erc20("0x1111111111111111111111111111111111111111");
        assert_eq!(td.decimals_for(&unknown), None);
        assert_eq!(td.nano(&unknown, U256::from(1u64)), None);
    }

    /// NFT keys have no fungible decimals.
    #[test]
    fn nft_keys_have_no_decimals() {
        let td = TokenDecimals::default();
        let erc721 = TokenKey::Erc721 {
            chain: ChainId::ethereum_mainnet(),
            contract: Address::from_str("0x2222222222222222222222222222222222222222").unwrap(),
            token_id: U256::from(1u64),
        };
        assert_eq!(td.decimals_for(&erc721), None);
    }
}
