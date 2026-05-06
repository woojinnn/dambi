//! Portfolio capability — current on-chain balance of `(owner, token)`.
//!  
//! Lowering resolves balances via this trait at the request-construction stage
//! and snapshots the returned `AmountSpec` into context under actor balance
//! fields for deterministic policy evaluation.
//!  
//! The lookup key is a strict `(owner, token)` pair (including chain-aware
//! token identity). A missing record is an explicit error and does not block
//! evaluation; the context field is simply skipped.
//!  
//! When present, lowering also stamps `inputFractionOfBalanceBps` alongside the
//! raw balance, exposing normalized input sizing as a policy-usable ratio.

use crate::core::{Address, AmountSpec, Token};
use alloy_primitives::U256;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum PortfolioError {
    #[error("no balance record for owner {owner} on token {token}")]
    NoRecord { owner: String, token: String },
}

pub trait Portfolio: Send + Sync {
    fn balance(&self, owner: &Address, token: &Token) -> Result<AmountSpec, PortfolioError>;
}

#[derive(Debug, Clone, Default)]
pub struct MockPortfolio {
    balances: HashMap<String, AmountSpec>,
}

impl MockPortfolio {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_balance(mut self, owner: &Address, token: &Token, raw: U256) -> Self {
        let amount = AmountSpec::from_raw(token.clone(), raw);
        self.balances
            .insert(format!("{}/{}", owner.as_str(), token.key()), amount);
        self
    }
}

impl Portfolio for MockPortfolio {
    fn balance(&self, owner: &Address, token: &Token) -> Result<AmountSpec, PortfolioError> {
        let key = format!("{}/{}", owner.as_str(), token.key());
        self.balances
            .get(&key)
            .cloned()
            .ok_or_else(|| PortfolioError::NoRecord {
                owner: owner.as_str().to_string(),
                token: token.key(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor() -> Address {
        Address::new("0x1111111111111111111111111111111111111111").unwrap()
    }

    fn usdt() -> Token {
        Token {
            chain_id: 1,
            address: Address::new("0xdAC17F958D2ee523a2206206994597C13D831ec7").unwrap(),
            symbol: "USDT".into(),
            decimals: 6,
            is_native: false,
        }
    }

    fn usdt_polygon() -> Token {
        Token {
            chain_id: 137,
            address: Address::new("0xdAC17F958D2ee523a2206206994597C13D831ec7").unwrap(),
            symbol: "USDT".into(),
            decimals: 6,
            is_native: false,
        }
    }

    #[test]
    fn mock_returns_recorded_balance() {
        let p = MockPortfolio::new().with_balance(&actor(), &usdt(), U256::from(5u64));
        let got = p.balance(&actor(), &usdt()).unwrap();
        assert_eq!(got.raw, "5");
        assert_eq!(got.token, usdt());
    }

    #[test]
    fn mock_missing_balance_errors() {
        let p = MockPortfolio::new().with_balance(&actor(), &usdt(), U256::from(5u64));
        let err = p.balance(&actor(), &usdt_polygon()).unwrap_err();
        assert_eq!(
            err,
            PortfolioError::NoRecord {
                owner: actor().as_str().to_string(),
                token: usdt_polygon().key(),
            }
        );
    }

    #[test]
    fn mock_keys_are_chain_qualified() {
        let usdt_other_chain = usdt_polygon();
        let p = MockPortfolio::new().with_balance(&actor(), &usdt(), U256::from(1u64));
        assert!(p.balance(&actor(), &usdt()).is_ok());
        assert!(p.balance(&actor(), &usdt_other_chain).is_err());
        assert_eq!(
            p.balances
                .get(&format!("{}/{}", actor().as_str(), usdt().key()))
                .unwrap()
                .raw,
            "1"
        );
    }
}
