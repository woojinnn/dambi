//! Cedar context-field names produced by lowering.
//!
//! Centralizing these keys catches typos in lowering at compile time
//! (`use context_keys::ADDRESS;` instead of `"address"` strewn across files).
//! Cedar policies still author the string literals — they parse keys at
//! policy-load time, so the contract is "the string literal in the .cedar
//! file matches the string value of the constant here".
//!
//! When adding a new context field: declare the constant here, use it from
//! lowering, and reference the new constant by name from any integration
//! test that asserts on the field shape.

// ── Shared sub-record fields (AssetRef / AssetRefWithAmount / PoolRef) ──
/// Token contract address field.
pub const ADDRESS: &str = "address";
/// Token symbol field.
pub const SYMBOL: &str = "symbol";
/// Token decimal precision field.
pub const DECIMALS: &str = "decimals";
/// Non-fungible token id field.
pub const TOKEN_ID: &str = "tokenId";
/// `AssetRefWithAmount.asset` sub-record field.
pub const ASSET: &str = "asset";
/// Amount sub-record field.
pub const AMOUNT: &str = "amount";
/// Pool / market identifier (bytes32) field.
pub const ID: &str = "id";
/// Human-readable pool / strategy / contract label field.
pub const LABEL: &str = "label";

// ── DEX action context fields ──
/// Assets deposited or spent by a DEX action.
pub const INPUT_TOKENS: &str = "inputTokens";
/// Assets received or withdrawn by a DEX action.
pub const OUTPUT_TOKENS: &str = "outputTokens";
/// LP token and amount constraint minted by a liquidity action.
pub const OUTPUT_LP: &str = "outputLp";
/// LP token and amount constraint burned by a liquidity action.
pub const INPUT_LP: &str = "inputLp";
/// Fungible liquidity exit mode discriminator.
pub const EXIT_MODE: &str = "exitMode";
/// Concentrated-liquidity NFT burn kind discriminator.
pub const BURN_KIND: &str = "burnKind";
/// Internal liquidity delta for NFT decrease actions.
pub const LIQUIDITY_DELTA: &str = "liquidityDelta";
/// Pool fee in basis points.
pub const FEE_BPS: &str = "feeBps";
/// Concentrated-liquidity tick range record.
pub const TICK_RANGE: &str = "tickRange";
/// Lower tick bound.
pub const LOWER: &str = "lower";
/// Upper tick bound.
pub const UPPER: &str = "upper";
/// Pool reference record.
pub const POOL: &str = "pool";
/// NFT collection reference for liquidity-position actions.
pub const NFT: &str = "nft";
/// Recipient address field.
pub const RECIPIENT: &str = "recipient";

// ── donate / initialize_pool context fields ──
/// Originating wallet for a V4 donate.
pub const FROM: &str = "from";
/// Hook contract address for a V4 pool.
pub const HOOKS: &str = "hooks";
/// Hook callback flag record decoded from `hooks` address bits.
pub const HOOK_PERMISSIONS: &str = "hookPermissions";
/// Whether the V4 pool is dynamic-fee.
pub const IS_DYNAMIC_FEE: &str = "isDynamicFee";
/// Length of the trailing V4 hook payload.
pub const HOOK_DATA_LEN: &str = "hookDataLen";
/// First four bytes of the V4 hook payload, when present.
pub const HOOK_DATA_SELECTOR: &str = "hookDataSelector";
/// Lower-address token in a pool.
pub const TOKEN0: &str = "token0";
/// Higher-address token in a pool.
pub const TOKEN1: &str = "token1";
/// V4 pool tick spacing.
pub const TICK_SPACING: &str = "tickSpacing";
/// Initial sqrt price (Q64.96) for a pool.
pub const SQRT_PRICE_X96: &str = "sqrtPriceX96";

// ── HookPermissions sub-record fields ──
/// Hook implements `beforeInitialize`.
pub const HOOK_BEFORE_INITIALIZE: &str = "beforeInitialize";
/// Hook implements `afterInitialize`.
pub const HOOK_AFTER_INITIALIZE: &str = "afterInitialize";
/// Hook implements `beforeAddLiquidity`.
pub const HOOK_BEFORE_ADD_LIQUIDITY: &str = "beforeAddLiquidity";
/// Hook implements `afterAddLiquidity`.
pub const HOOK_AFTER_ADD_LIQUIDITY: &str = "afterAddLiquidity";
/// Hook implements `beforeRemoveLiquidity`.
pub const HOOK_BEFORE_REMOVE_LIQUIDITY: &str = "beforeRemoveLiquidity";
/// Hook implements `afterRemoveLiquidity`.
pub const HOOK_AFTER_REMOVE_LIQUIDITY: &str = "afterRemoveLiquidity";
/// Hook implements `beforeSwap`.
pub const HOOK_BEFORE_SWAP: &str = "beforeSwap";
/// Hook implements `afterSwap`.
pub const HOOK_AFTER_SWAP: &str = "afterSwap";
/// Hook implements `beforeDonate`.
pub const HOOK_BEFORE_DONATE: &str = "beforeDonate";
/// Hook implements `afterDonate`.
pub const HOOK_AFTER_DONATE: &str = "afterDonate";
/// Hook implements `beforeSwapReturnDelta`.
pub const HOOK_BEFORE_SWAP_RETURN_DELTA: &str = "beforeSwapReturnDelta";
/// Hook implements `afterSwapReturnDelta`.
pub const HOOK_AFTER_SWAP_RETURN_DELTA: &str = "afterSwapReturnDelta";
/// Hook implements `afterAddLiquidityReturnDelta`.
pub const HOOK_AFTER_ADD_LIQUIDITY_RETURN_DELTA: &str = "afterAddLiquidityReturnDelta";
/// Hook implements `afterRemoveLiquidityReturnDelta`.
pub const HOOK_AFTER_REMOVE_LIQUIDITY_RETURN_DELTA: &str = "afterRemoveLiquidityReturnDelta";

// ── Derived action context fields ──
/// Validity-window delta from `block_timestamp` in seconds.
pub const VALIDITY_DELTA_SEC: &str = "validityDeltaSec";

// ── UsdValuation sub-record fields ──
/// Decimal value field.
pub const VALUE: &str = "value";
/// Oracle valuation timestamp field.
pub const AS_OF_TS: &str = "asOfTs";
/// Oracle staleness field in seconds.
pub const STALE_SEC: &str = "staleSec";
/// Oracle source list field.
pub const SOURCES: &str = "sources";

// ── Cedar `__extn` extension call shape used to embed Decimal values ──
/// Cedar extension object key.
pub const EXTN_KEY: &str = "__extn";
/// Cedar extension function name key.
pub const EXTN_FN: &str = "fn";
/// Cedar extension argument key.
pub const EXTN_ARG: &str = "arg";
/// Cedar Decimal extension function name.
pub const EXTN_DECIMAL: &str = "decimal";
