//! Shared resources for PancakeSwap StableSwap pool adapters.
//!
//! StableSwap pools are individual contracts (no central router). Each pool
//! holds an immutable `coins[N_COINS]` array (N=2 or N=3) and exposes a
//! Curve-style `exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy)`
//! function. The adapter must therefore know:
//!
//! 1. **Which pool addresses to match.** v0.1 hardcodes a small set of
//!    PancakeSwap StableSwap pools on BSC; production deployments will
//!    drive this list from the manifest's `tokenLookup`-equivalent
//!    capability.
//! 2. **How to map `(pool_address, i, j)` → `Token` metadata.** Each
//!    seeded pool ships with its `coins[]` ordering recorded here.
//!
//! Calldata does NOT carry the pool's swap fee; PancakeSwap StableSwap
//! pools charge ~1–4 bps depending on configuration. The adapter emits a
//! conservative `Some(4)` into `DexFacts::max_fee_bps` and notes
//! `fee_estimate=4bps` in trace.

use alloy_primitives::address;
use policy_engine::prelude::*;
use std::collections::HashMap;

/// Conservative upper-bound fee estimate in bps for PancakeSwap StableSwap
/// pools (calldata does not carry the real fee).
pub const STABLESWAP_FEE_ESTIMATE_BPS: u32 = 4;

/// One known StableSwap pool plus the coin metadata required to resolve
/// `(i, j)` indices into `Token` records.
#[derive(Debug, Clone)]
pub struct PoolEntry {
    /// Deployed pool contract address on BSC.
    pub address: Address,
    /// `coins[N_COINS]` from the pool, in declaration order.
    pub coins: Vec<Token>,
}

/// Hardcoded v0.1 list of PancakeSwap StableSwap pools on BSC.
///
/// **NOTE:** This list is illustrative for v0.1; production deployments
/// must replace it with a manifest-driven capability that mirrors the
/// authoritative pool registry. The on-chain decoding is unaffected — pool
/// resolution, token-by-index resolution, and `dx`/`min_dy` extraction are
/// independent of *which* pools are listed.
#[must_use]
pub fn seeded_bsc_pools() -> Vec<PoolEntry> {
    let usd_coin = Token {
        chain_id: 56,
        address: Address::from_alloy(address!("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d")),
        symbol: "USDC".into(),
        decimals: 18,
        is_native: false,
    };
    let tether = Token {
        chain_id: 56,
        address: Address::from_alloy(address!("0x55d398326f99059ff775485246999027b3197955")),
        symbol: "USDT".into(),
        decimals: 18,
        is_native: false,
    };
    let binance_usd = Token {
        chain_id: 56,
        address: Address::from_alloy(address!("0xe9e7cea3dedca5984780bafc599bd69add087d56")),
        symbol: "BUSD".into(),
        decimals: 18,
        is_native: false,
    };

    vec![
        PoolEntry {
            // PancakeSwap StableSwap USDT/USDC two-pool (illustrative v0.1
            // address; verify against manifest at integration time).
            address: Address::from_alloy(address!(
                "0x4f3126d5de26413abdcf6948943fb9d0847d9818"
            )),
            coins: vec![tether.clone(), usd_coin.clone()],
        },
        PoolEntry {
            // PancakeSwap StableSwap 3-pool USDT/BUSD/USDC (illustrative v0.1).
            address: Address::from_alloy(address!(
                "0x36842f8fb99d55477c0da638af5ceb6bbf86aa98"
            )),
            coins: vec![tether, binance_usd, usd_coin],
        },
    ]
}

/// Pool registry indexed by (`chain_id`, lowercase address).
#[derive(Debug)]
pub struct PoolRegistry {
    pools: HashMap<(ChainId, String), PoolEntry>,
}

impl PoolRegistry {
    /// Construct a registry seeded with the v0.1 BSC pool set.
    #[must_use]
    pub fn with_bsc_defaults() -> Self {
        let mut me = Self {
            pools: HashMap::new(),
        };
        for entry in seeded_bsc_pools() {
            me.pools.insert(
                (56, entry.address.as_str().to_lowercase()),
                entry,
            );
        }
        me
    }

    /// Add a pool entry. Replaces any existing entry at the same address.
    pub fn add(&mut self, entry: PoolEntry) {
        let key = (entry.coins[0].chain_id, entry.address.as_str().to_lowercase());
        self.pools.insert(key, entry);
    }

    /// Returns this registry after adding `entry`.
    #[must_use]
    pub fn with(mut self, entry: PoolEntry) -> Self {
        self.add(entry);
        self
    }

    /// Look up a pool by `(chain_id, address)`.
    #[must_use]
    pub fn get(&self, chain_id: ChainId, addr: &Address) -> Option<&PoolEntry> {
        self.pools
            .get(&(chain_id, addr.as_str().to_lowercase()))
    }

    /// Distinct `(chain_id, pool_address)` targets the registry knows.
    #[must_use]
    pub fn targets(&self) -> Vec<(ChainId, Address)> {
        self.pools
            .iter()
            .map(|((chain_id, _), entry)| (*chain_id, entry.address.clone()))
            .collect()
    }
}

impl Default for PoolRegistry {
    fn default() -> Self {
        Self::with_bsc_defaults()
    }
}

/// Resolve the input/output token for `(pool, i, j)` from a registered pool.
///
/// Returns synthetic `UNKNOWN` `Token` records when the pool is unknown or
/// the indices are out of range (so the adapter can still emit a structurally
/// valid `Action::Dex` for audit, even if the host hasn't seeded this pool).
#[must_use]
pub fn resolve_tokens(
    registry: &PoolRegistry,
    chain_id: ChainId,
    pool: &Address,
    i: u64,
    j: u64,
) -> (Token, Token) {
    let unknown = |idx: u64| Token {
        chain_id,
        address: pool.clone(),
        symbol: format!("UNKNOWN[{idx}]"),
        decimals: 18,
        is_native: false,
    };
    let Some(entry) = registry.get(chain_id, pool) else {
        return (unknown(i), unknown(j));
    };
    let i_token = usize::try_from(i)
        .ok()
        .and_then(|idx| entry.coins.get(idx).cloned())
        .unwrap_or_else(|| unknown(i));
    let j_token = usize::try_from(j)
        .ok()
        .and_then(|idx| entry.coins.get(idx).cloned())
        .unwrap_or_else(|| unknown(j));
    (i_token, j_token)
}

#[allow(clippy::panic)]
pub(crate) fn static_adapter_id(raw: &str) -> AdapterId {
    match AdapterId::new(raw) {
        Ok(id) => id,
        Err(err) => panic!("invalid static adapter id {raw}: {err}"),
    }
}

/// Errors returned by PancakeSwap StableSwap calldata decoders.
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
    /// `i == j` is invalid for `exchange`.
    #[error("input and output indices must differ, got i=j={0}")]
    SameIndex(u64),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_pools_have_at_least_two_coins() {
        let pools = seeded_bsc_pools();
        assert!(!pools.is_empty());
        for pool in pools {
            assert!(pool.coins.len() >= 2);
        }
    }

    #[test]
    fn registry_resolves_tokens_for_known_pool() {
        let reg = PoolRegistry::with_bsc_defaults();
        let pools = seeded_bsc_pools();
        let two_pool_addr = pools[0].address.clone();
        let (i_tok, j_tok) = resolve_tokens(&reg, 56, &two_pool_addr, 0, 1);
        assert_eq!(i_tok.symbol, "USDT");
        assert_eq!(j_tok.symbol, "USDC");
    }

    #[test]
    fn registry_returns_unknown_for_missing_pool() {
        let reg = PoolRegistry::with_bsc_defaults();
        let unknown_pool = Address::new("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        let (i_tok, j_tok) = resolve_tokens(&reg, 56, &unknown_pool, 0, 1);
        assert_eq!(i_tok.symbol, "UNKNOWN[0]");
        assert_eq!(j_tok.symbol, "UNKNOWN[1]");
    }

    #[test]
    fn registry_returns_unknown_for_out_of_range_index() {
        let reg = PoolRegistry::with_bsc_defaults();
        let pools = seeded_bsc_pools();
        let two_pool_addr = pools[0].address.clone();
        let (i_tok, j_tok) = resolve_tokens(&reg, 56, &two_pool_addr, 0, 9);
        assert_eq!(i_tok.symbol, "USDT");
        assert_eq!(j_tok.symbol, "UNKNOWN[9]");
    }

    #[test]
    fn registry_targets_lists_all_seeded_pools() {
        let reg = PoolRegistry::with_bsc_defaults();
        assert_eq!(reg.targets().len(), seeded_bsc_pools().len());
    }
}
