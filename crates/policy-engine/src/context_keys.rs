//! Cedar context-field names produced by lowering.
//!
//! Centralizing these keys in one module catches typos in lowering
//! sites at compile time (`use context_keys::CHAIN_ID;` instead of
//! `"chainId"` strewn across files). Cedar policies still author the
//! string literals — they parse keys at policy-load time, so the
//! contract is "the string literal in the .cedar file matches the
//! string value of the constant here".
//!
//! When adding a new context field: declare the constant here, use
//! it from lowering, document it in the relevant policy authoring
//! reference, and reference the new constant by name from any
//! integration test that asserts on the field shape.

// Common transaction/action fields stamped by request lowering.
pub const CHAIN_ID: &str = "chainId";
pub const FROM: &str = "from";
pub const TO: &str = "to";
pub const VALUE_WEI: &str = "valueWei";
pub const SELECTOR: &str = "selector";
pub const RAW_CALLDATA: &str = "rawCalldata";
pub const TARGET: &str = "target";

// Dex action context fields stamped by `lowering::request_from_action`.
pub const PROTOCOL_IDS: &str = "protocolIds";
pub const INPUT_TOKENS: &str = "inputTokens";
pub const OUTPUT_TOKENS: &str = "outputTokens";
pub const TOTAL_INPUT_USD: &str = "totalInputUsd";
pub const TOTAL_MIN_OUTPUT_USD: &str = "totalMinOutputUsd";
pub const MAX_FEE_BPS: &str = "maxFeeBps";
pub const HAS_ZERO_MIN_OUTPUT: &str = "hasZeroMinOutput";
pub const HAS_EXTERNAL_RECIPIENT: &str = "hasExternalRecipient";
pub const TOTAL_INPUT_FRACTION_OF_PORTFOLIO_BPS: &str = "totalInputFractionOfPortfolioBps";
pub const ALLOWANCES_COVER_INPUTS: &str = "allowancesCoverInputs";
pub const WINDOW_STATS: &str = "windowStats";

// AmountSpec sub-record fields.
pub const ADDRESS: &str = "address";
pub const SYMBOL: &str = "symbol";
pub const DECIMALS: &str = "decimals";
pub const IS_NATIVE: &str = "isNative";
pub const RAW: &str = "raw";
pub const HUMAN: &str = "human";
pub const USD: &str = "usd";
pub const VALUE: &str = "value";
pub const AS_OF_TS: &str = "asOfTs";
pub const STALE_SEC: &str = "staleSec";
pub const SOURCES: &str = "sources";

// Cedar `__extn` extension call shape used to embed Decimal values.
pub const EXTN_KEY: &str = "__extn";
pub const EXTN_FN: &str = "fn";
pub const EXTN_ARG: &str = "arg";
pub const EXTN_DECIMAL: &str = "decimal";

// Stat-window keys consumed by lowering and stamped onto `windowStats`.
pub const SWAP_VOLUME_USD_24H: &str = "swapVolumeUsd24h";
pub const SWAP_COUNT_24H: &str = "swapCount24h";
