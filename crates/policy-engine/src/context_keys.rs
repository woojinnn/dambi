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

// Tx-level top-level fields stamped by `lowering::request_for_tx`.
pub const CHAIN_ID: &str = "chainId";
pub const FROM: &str = "from";
pub const TO: &str = "to";
pub const VALUE_WEI: &str = "valueWei";
pub const SELECTOR: &str = "selector";
pub const CHILD_COUNT: &str = "childCount";
pub const KINDS: &str = "kinds";
pub const PROTOCOLS_USED: &str = "protocolsUsed";
pub const HAS_APPROVE: &str = "hasApprove";
pub const HAS_UNKNOWN: &str = "hasUnknown";
pub const DISTINCT_RECIPIENTS: &str = "distinctRecipients";
pub const ALLOW_REVERT_COUNT: &str = "allowRevertCount";
pub const TOTAL_INPUT_USD: &str = "totalInputUsd";
pub const WINDOW_STATS: &str = "windowStats";
// Leaf action context keys that are part of swap-specific lowering.
pub const CHILD_KINDS: &str = "childKinds";
pub const ALLOW_REVERT: &str = "allowRevert";

// Leaf-swap context fields stamped by `lowering::request_from_action`.
pub const INPUT_AMOUNT: &str = "inputAmount";
pub const MIN_OUTPUT_AMOUNT: &str = "minOutputAmount";
pub const FEE_BIPS: &str = "feeBips";
pub const TARGET: &str = "target";
pub const RECIPIENT: &str = "recipient";
pub const PROTOCOL_ID: &str = "protocolId";

// Capability-stamped fields (Portfolio / Approvals).
pub const ACTOR_BALANCE_INPUT_TOKEN: &str = "actorBalanceInputToken";
pub const INPUT_FRACTION_OF_BALANCE_BPS: &str = "inputFractionOfBalanceBps";
pub const CURRENT_ALLOWANCE: &str = "currentAllowance";
pub const ALLOWANCE_COVERS_INPUT: &str = "allowanceCoversInput";

// AmountSpec sub-record fields.
pub const TOKEN_SYMBOL: &str = "tokenSymbol";
pub const RAW: &str = "raw";
pub const HUMAN: &str = "human";
pub const USD: &str = "usd";
pub const VALUE: &str = "value";
pub const STALE_SEC: &str = "staleSec";

// Cedar `__extn` extension call shape used to embed Decimal values.
pub const EXTN_KEY: &str = "__extn";
pub const EXTN_FN: &str = "fn";
pub const EXTN_ARG: &str = "arg";
pub const EXTN_DECIMAL: &str = "decimal";

// Stat-window keys consumed by lowering and stamped onto `windowStats`.
pub const SWAP_VOLUME_USD_24H: &str = "swap_volume_usd_24h";
pub const SWAP_COUNT_24H: &str = "swap_count_24h";

// Universal Router metadata keys stamped by `Adapter::leaf_metadata`.
pub mod ur {
    pub const ROUTER: &str = "router";
    pub const ROUTER_COMMAND_INDEX: &str = "routerCommandIndex";
    pub const ROUTER_COMMAND: &str = "routerCommand";
    pub const ALLOW_REVERT: &str = "allowRevert";
    pub const ANALYSIS_DEPTH: &str = "analysisDepth";
    pub const SUBPLAN_DEPTH: &str = "subplanDepth";
    pub const HOOK_DATA_PRESENT: &str = "hookDataPresent";
    pub const V4_ACTION: &str = "v4Action";
}
