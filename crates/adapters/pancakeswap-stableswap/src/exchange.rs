//! PancakeSwap StableSwap pool `exchange(uint256 i, uint256 j, uint256 dx,
//! uint256 min_dy) external payable nonReentrant`.
//!
//! Identical signature to Curve's `exchange`, but PancakeSwap's pool variants
//! use `uint256` for the `i` and `j` token indices (Curve's reference
//! implementation uses `int128`). The adapter resolves `(pool_address, i, j)`
//! to concrete `Token` metadata via the in-process `PoolRegistry`.

#[cfg(test)]
use crate::common::seeded_bsc_pools;
use crate::common::{
    resolve_tokens, static_adapter_id, DecodeError, PoolRegistry, STABLESWAP_FEE_ESTIMATE_BPS,
};
use alloy_primitives::U256;
use alloy_sol_types::{sol, SolCall};
use policy_engine::prelude::*;

sol! {
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external payable;
}

/// Selector for `exchange(uint256,uint256,uint256,uint256)`.
pub const SELECTOR: [u8; 4] = exchangeCall::SELECTOR;

/// Decoded `exchange` parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Index of the input coin in the pool's `coins[]` array.
    pub i: U256,
    /// Index of the output coin in the pool's `coins[]` array.
    pub j: U256,
    /// Raw input token amount.
    pub dx: U256,
    /// Minimum acceptable output token amount.
    pub min_dy: U256,
}

/// ABI-encode `exchange` calldata.
#[must_use]
pub fn encode(p: &Params) -> Vec<u8> {
    exchangeCall {
        i: p.i,
        j: p.j,
        dx: p.dx,
        min_dy: p.min_dy,
    }
    .abi_encode()
}

/// Decode `exchange` calldata.
///
/// # Errors
///
/// Returns an error when calldata is too short, has the wrong selector, fails
/// ABI decoding, or contains `i == j`.
pub fn decode(calldata: &[u8]) -> Result<Params, DecodeError> {
    const NEED: usize = 4 + 4 * 32;
    if calldata.len() < 4 {
        return Err(DecodeError::TooShort {
            need: NEED,
            got: calldata.len(),
        });
    }
    let selector: [u8; 4] = [calldata[0], calldata[1], calldata[2], calldata[3]];
    if selector != SELECTOR {
        return Err(DecodeError::BadSelector {
            got: hex::encode(selector),
            want: hex::encode(SELECTOR),
        });
    }
    if calldata.len() < NEED {
        return Err(DecodeError::TooShort {
            need: NEED,
            got: calldata.len(),
        });
    }
    let call = exchangeCall::abi_decode(calldata, true)
        .map_err(|e| DecodeError::AbiDecode(e.to_string()))?;
    if call.i == call.j {
        // The pool would revert on this; we surface it earlier so policy
        // evaluation does not see a structurally invalid trade as if it
        // were a real swap.
        let same = u64::try_from(call.i).unwrap_or(u64::MAX);
        return Err(DecodeError::SameIndex(same));
    }
    Ok(Params {
        i: call.i,
        j: call.j,
        dx: call.dx,
        min_dy: call.min_dy,
    })
}

/// Adapter for PancakeSwap StableSwap `exchange`.
///
/// The adapter matches against every pool address registered in its
/// `PoolRegistry`; when a `TransactionRequest` reaches it, the same
/// registry resolves `(pool, i, j)` to the concrete coin metadata.
#[derive(Debug)]
pub struct Adapter_ {
    pools: PoolRegistry,
}

impl Adapter_ {
    /// Construct an adapter with the v0.1 BSC pool set.
    #[must_use]
    pub fn new() -> Self {
        Self {
            pools: PoolRegistry::with_bsc_defaults(),
        }
    }

    /// Returns this adapter after adding `entry` to its pool registry.
    #[must_use]
    pub fn with_pool(mut self, entry: crate::common::PoolEntry) -> Self {
        self.pools.add(entry);
        self
    }
}

impl Default for Adapter_ {
    fn default() -> Self {
        Self::new()
    }
}

impl Adapter for Adapter_ {
    fn id(&self) -> AdapterId {
        static_adapter_id("pancakeswap-stableswap/exchange@0.1.0")
    }

    fn match_keys(&self) -> Vec<MatchKey> {
        self.pools
            .targets()
            .into_iter()
            .map(|(chain, target)| MatchKey::exact(chain, target, SELECTOR))
            .collect()
    }

    fn build(&self, tx: &TransactionRequest) -> Result<Action, AdapterError> {
        let p = decode(&tx.data).map_err(|e| AdapterError::BadCalldata(e.to_string()))?;

        // Narrow indices to u64 for token lookup. Real pools have N_COINS
        // <= 8, so a u64 narrow is safe; we still surface a defensive error
        // if the index doesn't fit.
        let i_u64 = u64::try_from(p.i)
            .map_err(|_| AdapterError::BadCalldata(format!("i={} too large for u64", p.i)))?;
        let j_u64 = u64::try_from(p.j)
            .map_err(|_| AdapterError::BadCalldata(format!("j={} too large for u64", p.j)))?;

        let (input_token, output_token) = resolve_tokens(&self.pools, tx.chain_id, &tx.to, i_u64, j_u64);

        // exchange has no recipient parameter; the swap output goes to
        // msg.sender. has_external_recipient is therefore always false.
        let has_zero_min_output = p.min_dy == U256::ZERO;

        let trace_step = format!(
            "exchange pool={} i={} j={} dx={} min_dy={} (fee_estimate={}bps)",
            tx.to.as_str(),
            i_u64,
            j_u64,
            p.dx,
            p.min_dy,
            STABLESWAP_FEE_ESTIMATE_BPS
        );

        let mut oracle_requirements = vec![OracleRequirement {
            kind: OracleRequirementKind::Input,
            token: input_token.clone(),
            raw_amount: p.dx.to_string(),
        }];
        oracle_requirements.push(OracleRequirement {
            kind: OracleRequirementKind::MinOutput,
            token: output_token.clone(),
            raw_amount: p.min_dy.to_string(),
        });

        Ok(Action::Dex(DexAction {
            actor: tx.from.clone(),
            target: tx.to.clone(),
            value_wei: tx.value_wei.clone(),
            facts: DexFacts {
                protocol_ids: vec!["pancakeswap-stableswap".into()],
                input_tokens: vec![input_token],
                output_tokens: vec![output_token],
                max_fee_bps: Some(STABLESWAP_FEE_ESTIMATE_BPS),
                has_zero_min_output,
                has_external_recipient: false,
                ..DexFacts::default()
            },
            oracle_requirements,
            trace: DexTrace {
                steps: vec![trace_step],
            },
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_params() -> Params {
        Params {
            i: U256::from(0u64),
            j: U256::from(1u64),
            dx: U256::from(100_000_000_000_000_000_000_u128), // 100 USDT (18 dec on BSC)
            min_dy: U256::from(99_000_000_000_000_000_000_u128),
        }
    }

    #[test]
    fn round_trip() {
        let p = sample_params();
        assert_eq!(decode(&encode(&p)).unwrap(), p);
    }

    #[test]
    fn selector_pin() {
        // keccak256("exchange(uint256,uint256,uint256,uint256)")[..4]
        // = 0x5b41b908. (Note: this differs from Curve's
        // `exchange(int128,int128,uint256,uint256)` selector 0x3df02124 —
        // PancakeSwap's pool variants use uint256 indices.)
        assert_eq!(SELECTOR, [0x5b, 0x41, 0xb9, 0x08]);
    }

    #[test]
    fn same_index_rejected() {
        let mut p = sample_params();
        p.j = p.i;
        assert!(matches!(
            decode(&encode(&p)).unwrap_err(),
            DecodeError::SameIndex(0)
        ));
    }

    #[test]
    fn build_emits_pancakeswap_stableswap_with_4bp_estimate() {
        let adapter = Adapter_::new();
        let pool = seeded_bsc_pools().into_iter().next().unwrap().address;
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: pool,
            value_wei: "0".into(),
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.protocol_ids, vec!["pancakeswap-stableswap"]);
                assert_eq!(d.facts.input_tokens[0].symbol, "USDT");
                assert_eq!(d.facts.output_tokens[0].symbol, "USDC");
                assert_eq!(d.facts.max_fee_bps, Some(4));
                assert!(!d.facts.has_zero_min_output);
                assert!(!d.facts.has_external_recipient);
                let trace = &d.trace.steps[0];
                assert!(trace.contains("exchange"));
                assert!(trace.contains("i=0"));
                assert!(trace.contains("j=1"));
                assert!(trace.contains("fee_estimate=4bps"));
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }

    #[test]
    fn build_with_unknown_pool_returns_unknown_token_metadata() {
        let adapter = Adapter_::new();
        let unknown_pool = Address::new("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: unknown_pool,
            value_wei: "0".into(),
            data: encode(&sample_params()),
            gas: None,
            nonce: None,
        };
        // Even with an unknown pool, the adapter returns a structurally
        // valid Action::Dex with UNKNOWN token symbols — policies that
        // care about tokens (e.g. allowlists) can still inspect them.
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => {
                assert_eq!(d.facts.input_tokens[0].symbol, "UNKNOWN[0]");
                assert_eq!(d.facts.output_tokens[0].symbol, "UNKNOWN[1]");
            }
            other => panic!("expected dex, got {other:?}"),
        }
    }

    #[test]
    fn build_zero_min_dy_flips_has_zero_min_output() {
        let mut p = sample_params();
        p.min_dy = U256::ZERO;
        let adapter = Adapter_::new();
        let pool = seeded_bsc_pools().into_iter().next().unwrap().address;
        let tx = TransactionRequest {
            chain_id: 56,
            from: Address::new("0x0000000000000000000000000000000000000001").unwrap(),
            to: pool,
            value_wei: "0".into(),
            data: encode(&p),
            gas: None,
            nonce: None,
        };
        match adapter.build(&tx).unwrap() {
            Action::Dex(d) => assert!(d.facts.has_zero_min_output),
            other => panic!("expected dex, got {other:?}"),
        }
    }
}
