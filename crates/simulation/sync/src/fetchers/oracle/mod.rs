//! Oracle provider 별 구현.
//!
//! 지금은 Chainlink 만. Pyth / Redstone 는 후속.

pub mod chainlink;

pub use chainlink::{ChainlinkFeed, ChainlinkFeedRegistry, ChainlinkFetcher};

// pub mod pyth;
// pub mod redstone;
