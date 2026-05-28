//! Chainlink AggregatorV3 — feed_id 는 (chain, feed contract address) pair.
//!
//! ABI: `latestRoundData()` returns
//!   (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
//!
//! decimals: `decimals()` returns uint8 (대부분 feed 는 8). 안전하게 매 호출은 안 함 —
//! feed 등록 시점에 한 번 fetch 후 cache. 여기 phase 에선 8 가정.

use std::collections::HashMap;
use std::sync::Arc;

use alloy_primitives::{Address, I256, U256};

use simulation_state::{ChainId, DataSource, Decimal};

use crate::error::SyncError;
use crate::fetchers::decoder::function_selector;
use crate::fetchers::rpc::{BlockTag, EthCallRequest, RpcRouter};

/// 한 feed 의 위치 — `OracleFeed { feed_id: "USDC/USD" }` 만으로는 어느 chain 의
/// 어느 contract 인지 알 수 없으므로 별도 등록부.
#[derive(Clone, Debug)]
pub struct ChainlinkFeed {
    pub feed_id: String,
    pub chain: ChainId,
    pub address: Address,
    /// 보통 8.
    pub decimals: u8,
}

#[derive(Default)]
pub struct ChainlinkFeedRegistry {
    by_id: HashMap<String, ChainlinkFeed>,
}

impl ChainlinkFeedRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, feed: ChainlinkFeed) {
        self.by_id.insert(feed.feed_id.clone(), feed);
    }

    pub fn lookup(&self, id: &str) -> Option<&ChainlinkFeed> {
        self.by_id.get(id)
    }

    /// 잘 알려진 mainnet feed 들 미리 등록 — 개발/테스트 편의용.
    pub fn with_mainnet_defaults() -> Self {
        use std::str::FromStr;
        let mut r = Self::new();
        let chain = ChainId::ethereum_mainnet();
        let defaults = [
            ("USDC/USD", "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"),
            ("USDT/USD", "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D"),
            ("ETH/USD", "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"),
            ("WBTC/USD", "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c"),
            ("DAI/USD", "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9"),
        ];
        for (id, addr) in defaults {
            let address = Address::from_str(addr).unwrap();
            r.register(ChainlinkFeed {
                feed_id: id.into(),
                chain: chain.clone(),
                address,
                decimals: 8,
            });
        }
        r
    }
}

/// Chainlink AggregatorV3 fetcher.
pub struct ChainlinkFetcher {
    router: Arc<RpcRouter>,
    registry: ChainlinkFeedRegistry,
}

impl ChainlinkFetcher {
    pub fn new(router: Arc<RpcRouter>) -> Self {
        Self {
            router,
            registry: ChainlinkFeedRegistry::with_mainnet_defaults(),
        }
    }

    pub fn with_registry(router: Arc<RpcRouter>, registry: ChainlinkFeedRegistry) -> Self {
        Self { router, registry }
    }

    pub fn registry_mut(&mut self) -> &mut ChainlinkFeedRegistry {
        &mut self.registry
    }

    /// DataSource::OracleFeed { provider: Chainlink, feed_id: "USDC/USD" } 처리.
    pub async fn fetch_price(&self, source: &DataSource) -> Result<Decimal, SyncError> {
        let feed_id = match source {
            DataSource::OracleFeed { feed_id, .. } => feed_id.clone(),
            _ => {
                return Err(SyncError::FetchFailed {
                    source_id: "chainlink".into(),
                    reason: "not an OracleFeed".into(),
                });
            }
        };
        let feed = self.registry.lookup(&feed_id).ok_or_else(|| {
            SyncError::FetchFailed {
                source_id: "chainlink".into(),
                reason: format!("unknown feed_id: {}", feed_id),
            }
        })?;

        // latestRoundData() selector = first 4 bytes of keccak("latestRoundData()")
        let selector = function_selector("latestRoundData()");
        let req = EthCallRequest::new(feed.address, selector.to_vec());
        let req = EthCallRequest {
            block: BlockTag::Latest,
            ..req
        };
        let data = self.router.eth_call(&feed.chain, req).await?;

        // returndata: 5 × 32 bytes — (roundId, answer, startedAt, updatedAt, answeredInRound)
        if data.len() < 160 {
            return Err(SyncError::FetchFailed {
                source_id: "chainlink".into(),
                reason: format!("latestRoundData returned {} bytes", data.len()),
            });
        }
        // answer 는 int256.
        let answer = i256_from_be_bytes(&data[32..64])?;
        Ok(scale_to_decimal(answer, feed.decimals))
    }
}

fn i256_from_be_bytes(bytes: &[u8]) -> Result<I256, SyncError> {
    let arr: [u8; 32] = bytes.try_into().map_err(|_| SyncError::FetchFailed {
        source_id: "chainlink".into(),
        reason: "i256 slice not 32 bytes".into(),
    })?;
    Ok(I256::from_be_bytes(arr))
}

/// `answer / 10^decimals` 를 decimal-문자열로. 음수면 앞에 `-`.
fn scale_to_decimal(answer: I256, decimals: u8) -> Decimal {
    let negative = answer.is_negative();
    let mag: U256 = if negative {
        // -answer (절댓값). I256::MIN 은 처리 X (현실에서 가격은 양수).
        let neg = -answer;
        neg.into_raw()
    } else {
        answer.into_raw()
    };

    let s = mag.to_string();
    let d = decimals as usize;
    let scaled = if s.len() > d {
        let split = s.len() - d;
        format!("{}.{}", &s[..split], &s[split..])
    } else {
        let pad = d - s.len();
        format!("0.{}{}", "0".repeat(pad), s)
    };
    let trimmed = trim_trailing_zeros(&scaled);
    let final_str = if negative {
        format!("-{}", trimmed)
    } else {
        trimmed.to_string()
    };
    Decimal::new(final_str)
}

fn trim_trailing_zeros(s: &str) -> &str {
    if !s.contains('.') {
        return s;
    }
    let trimmed = s.trim_end_matches('0');
    trimmed.trim_end_matches('.')
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::I256;

    #[test]
    fn scale_8_decimals_positive() {
        // 1.0001 USD with 8 decimals = 100010000
        let answer = I256::try_from(100_010_000_i64).unwrap();
        let d = scale_to_decimal(answer, 8);
        assert_eq!(d.as_str(), "1.0001");
    }

    #[test]
    fn scale_8_decimals_round_value() {
        // 3500 USD with 8 decimals = 350_000_000_000
        let answer = I256::try_from(350_000_000_000_i64).unwrap();
        let d = scale_to_decimal(answer, 8);
        assert_eq!(d.as_str(), "3500");
    }

    #[test]
    fn scale_negative() {
        // -42.5 with 8 decimals = -4_250_000_000
        let answer = I256::try_from(-4_250_000_000_i64).unwrap();
        let d = scale_to_decimal(answer, 8);
        assert_eq!(d.as_str(), "-42.5");
    }

    #[test]
    fn registry_lookup() {
        let r = ChainlinkFeedRegistry::with_mainnet_defaults();
        let feed = r.lookup("USDC/USD").unwrap();
        assert_eq!(feed.decimals, 8);
        assert_eq!(feed.chain, ChainId::ethereum_mainnet());
    }
}
