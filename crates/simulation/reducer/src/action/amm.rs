//! `AmmAction` — `Swap` / `AddLiquidity` / `RemoveLiquidity` / `CollectFees` / `IntentOrder`. Spec §5.
//!
//! Venue discriminator pattern: a single `AmmAction::Swap` variant plus an `AmmVenue` enum.
//! `run_action` then dispatches per-protocol math via a single `match venue { ... }`.

use serde::{Deserialize, Serialize};

use simulation_state::primitives::{Address, ChainId, Price, Time, U128, U256};
use simulation_state::token::{RangeSpec, TokenKey, TokenRef};
use simulation_state::LiveField;

use super::Bytes;

// ---------------------------------------------------------------------------
// Domain enum
// ---------------------------------------------------------------------------

/// Top-level AMM action: swaps, liquidity provisioning, fee collection,
/// and intent-based (off-chain signed) orders.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
#[allow(clippy::large_enum_variant)]
pub enum AmmAction {
    /// Token-for-token swap on a single pool or an aggregator route.
    Swap(SwapAction),
    /// Deposit liquidity into a pool (`Uniswap V2`/`V3`, `Curve`, `Balancer`, ...).
    AddLiquidity(AddLiquidityAction),
    /// Withdraw liquidity from a pool / burn an LP or position NFT.
    RemoveLiquidity(RemoveLiquidityAction),
    /// `Uniswap V3`-style collection of accrued, uncollected fees.
    CollectFees(CollectFeesAction),
    /// Sign an EIP-712 intent order (`UniswapX` / `CowSwap` / `1inch Fusion`, ...).
    SignIntentOrder(SignIntentOrderAction),
    /// Cancel a previously signed intent order.
    CancelIntentOrder(CancelIntentOrderAction),
}

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

/// Single-pool venue (`Uniswap V2 / V3 / V4`, `Curve`, `Balancer`, `Trader Joe LB`, `Maverick`)
/// or an aggregator router that orchestrates a multi-hop / split route.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum AmmVenue {
    /// `Uniswap V2`-style constant-product pool.
    UniswapV2 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool contract address.
        pool: Address,
        /// `Uniswap V2` factory that minted the pool.
        factory: Address,
    },
    /// `Uniswap V3` concentrated-liquidity pool.
    UniswapV3 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool contract address.
        pool: Address,
        /// Fee tier in basis points x 100 (e.g. 0.05% = 500).
        fee_tier_bp: u32,
    },
    /// `Uniswap V4` singleton pool keyed by `pool_id`.
    UniswapV4 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// `bytes32` pool id encoded as hex.
        pool_id: String,
        /// Singleton `PoolManager` contract.
        pool_manager: Address,
        /// Hooks contract attached to the pool (zero address if none).
        hooks: Address,
    },
    /// `SushiSwap V2` (a `Uniswap V2` fork).
    SushiV2 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool contract address.
        pool: Address,
    },
    /// `Curve V1` stableswap pool.
    CurveV1 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool contract address.
        pool: Address,
        /// Number of coins held by the pool.
        n_coins: u8,
        /// Whether this is a meta-pool (paired against a base LP token).
        is_meta: bool,
    },
    /// `Curve V2` cryptoswap pool.
    CurveV2 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool contract address.
        pool: Address,
    },
    /// `Balancer V2` vault-routed pool.
    BalancerV2 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// `Balancer V2` `Vault` contract.
        vault: Address,
        /// `bytes32` pool id encoded as hex.
        pool_id: String,
        /// Underlying math model.
        pool_type: BalancerPoolType,
    },
    /// `Balancer V3` pool.
    BalancerV3 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool id (hex encoded).
        pool_id: String,
        /// Underlying math model.
        pool_type: BalancerPoolType,
    },
    /// `Trader Joe` Liquidity Book bin-based pool.
    TraderJoeLB {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Liquidity Book pair contract.
        pair: Address,
        /// Bin step in basis-point units.
        bin_step: u16,
    },
    /// `Maverick V2` directional pool.
    MaverickV2 {
        /// Chain the pool lives on.
        chain: ChainId,
        /// Pool contract address.
        pool: Address,
    },
    /// Aggregator router (e.g. `1inch`, `0x`, `Paraswap`).
    /// The actual executed route is carried in `SwapLiveInputs.route`.
    AggregatorRoute {
        /// Chain the router lives on.
        chain: ChainId,
        /// Router contract the user calls.
        router: Address,
        /// 32-byte hex hash of the route calldata.
        route_hash: String,
    },
}

/// Math model for a `Balancer V2` / `V3` pool.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BalancerPoolType {
    /// Weighted pool (e.g. 80/20 BAL/WETH).
    Weighted,
    /// Classic stable pool.
    Stable,
    /// Composable stable pool (LP token as a pool asset).
    ComposableStable,
    /// `MetaStable` pool (with price-rate providers).
    MetaStable,
    /// Liquidity Bootstrapping Pool (LBP) with shifting weights.
    LiquidityBootstrapping,
    /// Linear pool (wraps a yield-bearing token at a target rate).
    Linear,
}

// ---------------------------------------------------------------------------
// PoolState — per-venue pool snapshot
// ---------------------------------------------------------------------------

/// Venue-specific pool snapshot consumed by reducer math at simulation time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PoolState {
    /// `Uniswap V2` / Sushi / fork — `x * y = k`.
    XyConstant {
        /// Reserve of the input token.
        reserve_in: U256,
        /// Reserve of the output token.
        reserve_out: U256,
        /// Pool fee in basis points.
        fee_bp: u32,
    },

    /// `Uniswap V3` / `V4` — concentrated liquidity.
    Concentrated {
        /// `sqrtPriceX96` (`Uniswap V3` convention).
        sqrt_price_x96: U256,
        /// Current active tick.
        tick: i32,
        /// Active in-range liquidity (uint128).
        liquidity: U128,
        /// Neighboring tick snapshots needed for slippage calculation.
        ticks: Vec<TickSnapshot>,
    },

    /// `Curve V1` stableswap.
    StableV1 {
        /// Per-coin balances (length = `n_coins`).
        balances: Vec<U256>,
        /// Amplification coefficient `A`.
        a: u32,
        /// Pool fee in basis points.
        fee_bp: u32,
    },

    /// `Curve V2` cryptoswap.
    Cryptoswap {
        /// Per-coin balances.
        balances: Vec<U256>,
        /// Per-coin price scale.
        price_scale: Vec<U256>,
        /// `(A, gamma)` packed into a single `U256`.
        a_gamma: U256,
        /// Pool fee in basis points.
        fee_bp: u32,
    },

    /// `Balancer` Weighted pool (e.g. 80/20).
    Weighted {
        /// Per-token balances.
        balances: Vec<U256>,
        /// Per-token weights (scaled).
        weights: Vec<u64>,
        /// Pool fee in basis points.
        fee_bp: u32,
    },

    /// `Balancer` Stable / Composable Stable pool.
    Stable {
        /// Per-token balances.
        balances: Vec<U256>,
        /// Amplification coefficient.
        amp: u32,
        /// Pool fee in basis points.
        fee_bp: u32,
    },

    /// `Trader Joe` Liquidity Book pool.
    LiquidityBook {
        /// Currently active bin id.
        active_bin_id: u32,
        /// Adjacent bin snapshots needed for swap simulation.
        bins: Vec<BinState>,
        /// Variable fee component in basis points.
        variable_fee_bp: u32,
    },

    /// `Maverick` directional pool — per-mode payload added in prototyping.
    Maverick {
        /// Known mode identifier (`"mode_left"`, `"mode_right"`, `"mode_both"`, `"mode_dynamic"`).
        mode: String,
        /// Per-mode raw payload (to be decomposed into typed fields in Phase 2).
        raw: serde_json::Value,
    },

    /// Escape hatch (Phase 1) for protocols not yet modelled above.
    Custom {
        /// Protocol identifier.
        protocol: String,
        /// Raw protocol-specific payload.
        raw: serde_json::Value,
    },
}

/// Snapshot of a single `Uniswap V3` / `V4` tick used for slippage math.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TickSnapshot {
    /// Tick index.
    pub tick: i32,
    /// Signed `liquidity_net` (can be negative; `Uniswap V3` uses `int128`).
    pub liquidity_net: String,
}

/// Snapshot of a single `Trader Joe` Liquidity Book bin.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinState {
    /// Bin id.
    pub id: u32,
    /// Bin's reserve of the input token.
    pub reserve_in: U256,
    /// Bin's reserve of the output token.
    pub reserve_out: U256,
}

// ---------------------------------------------------------------------------
// Swap + Route
// ---------------------------------------------------------------------------

/// A token-for-token swap on a single pool or aggregator route.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SwapAction {
    /// Entry contract the user calls (router / pool / aggregator).
    pub venue: AmmVenue,
    /// Deterministic user-signed intent.
    pub params: SwapParams,
    /// Inputs fetched at simulation time.
    pub live_inputs: SwapLiveInputs,
}

/// User-signed swap intent (amounts, slippage, recipient — but not the path).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SwapParams {
    /// Token the user is selling.
    pub token_in: TokenRef,
    /// Token the user is buying.
    pub token_out: TokenRef,
    /// Exact-in / exact-out direction and limits.
    pub direction: SwapDirection,
    /// Recipient of the output tokens.
    pub recipient: Address,
    /// Slippage tolerance in basis points, applied across the whole route.
    pub slippage_bp: u32,
}

/// User intent is just amount-in/out plus a limit — the actual *route* lives in `SwapLiveInputs.route`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SwapDirection {
    /// Sell an exact `amount_in`, requiring at least `min_amount_out`.
    ExactInput {
        /// Exact amount of `token_in` the user sells.
        amount_in: U256,
        /// Minimum acceptable amount of `token_out`.
        min_amount_out: U256,
    },
    /// Buy an exact `amount_out`, spending at most `max_amount_in`.
    ExactOutput {
        /// Maximum amount of `token_in` the user is willing to spend.
        max_amount_in: U256,
        /// Exact amount of `token_out` to receive.
        amount_out: U256,
    },
}

/// Simulation-time inputs for a swap: actual route, expected output, price impact, gas.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SwapLiveInputs {
    /// Concrete executed route. Single-pool / single-hop has `paths.len() == 1 && hops.len() == 1`.
    /// Aggregator / multi-hop cases express split and cross-protocol routes here.
    pub route: LiveField<SwapRoute>,
    /// Estimated `token_out` summed across all paths.
    pub expected_amount_out: LiveField<U256>,
    /// Estimated price impact in basis points.
    pub price_impact_bp: LiveField<u32>,
    /// Estimated gas cost of the swap.
    pub gas_estimate: LiveField<U256>,
}

/// Concrete execution route for a swap — unified split + multi-hop + cross-protocol representation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SwapRoute {
    /// Parallel paths. `Σ paths[i].share_bp == 10000`.
    pub paths: Vec<RoutePath>,
    /// Aggregator metadata; `None` for single-pool venues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aggregator: Option<AggregatorMeta>,
}

/// One parallel branch of a `SwapRoute` — a serial sequence of hops carrying a share of the input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutePath {
    /// This path's share of the swap input in basis points. `10000` for a single path.
    pub share_bp: u32,
    /// Serial sequence of hops along this path.
    pub hops: Vec<RouteHop>,
    /// Estimated output produced by this path.
    pub estimated_out: U256,
}

/// One hop in a `RoutePath` — a single-pool venue swapping `token_in` -> `token_out`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteHop {
    /// Hop input token.
    pub token_in: TokenRef,
    /// Hop output token.
    pub token_out: TokenRef,
    /// Single-pool venue executing this hop.
    pub venue: AmmVenue,
    /// Pool snapshot used by reducer math.
    pub pool_state: PoolState,
    /// Effective pool fee in basis points for this hop.
    pub effective_fee_bp: u32,
    /// Estimated output of this hop.
    pub estimated_out: U256,
}

/// Aggregator-specific metadata attached to a `SwapRoute`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AggregatorMeta {
    /// Aggregator product / version.
    pub aggregator: AggregatorKind,
    /// Router contract the user directly calls.
    pub router: Address,
    /// Separated executor (e.g. `1inch v6` splits router and executor) — critical for policy evaluation
    /// since policies typically whitelist known-safe executors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor: Option<Address>,
    /// 32-byte hex hash of raw calldata, for audit / replay verification.
    pub raw_calldata_hash: String,
    /// Whether a `Permit2` (or similar) approval is bundled with the swap.
    pub permit_bundled: bool,
    /// Optional referrer address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referrer: Option<Address>,
    /// Referrer fee in basis points.
    pub referrer_fee_bp: u32,
}

/// Identity of an aggregator product (used inside `AggregatorMeta`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AggregatorKind {
    /// `1inch` Aggregation Router v5.
    OneInchV5,
    /// `1inch` Aggregation Router v6 (router / executor split).
    OneInchV6,
    /// `0x` Settler.
    ZeroExV2,
    /// `Paraswap` v5.
    ParaswapV5,
    /// `Paraswap` v6.
    ParaswapV6,
    /// `Kyberswap` aggregator v2.
    KyberswapV2,
    /// `Odos` router.
    Odos,
    /// `OKX` DEX aggregator.
    OkxAggregator,
    /// `Uniswap` `UniversalRouter` (can mix `V2`/`V3`/`V4`).
    UniswapUniversalRouter,
    /// `CoW Swap` direct solver settlement.
    CowSwapSolver,
    /// Unknown aggregator — `name` is a protocol identifier.
    Custom {
        /// Free-form aggregator name.
        name: String,
    },
}

// ---------------------------------------------------------------------------
// AddLiquidity / RemoveLiquidity
// ---------------------------------------------------------------------------

/// Deposit liquidity into a pool — pooled deposit, V3 mint, or V3 increase.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddLiquidityAction {
    /// Pool venue receiving the deposit.
    pub venue: AmmVenue,
    /// User-signed deposit parameters.
    pub params: AddLiquidityParams,
    /// Simulation-time inputs (pool snapshot, current price).
    pub live_inputs: AddLiquidityLiveInputs,
}

/// Variant of an add-liquidity operation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AddLiquidityParams {
    /// `Uniswap V2` / `Curve` / `Balancer`-style proportional deposit.
    Pooled {
        /// Tokens deposited; for weighted pools length must match the pool's token count.
        tokens: Vec<(TokenRef, U256)>,
        /// Minimum LP tokens out.
        min_lp_out: U256,
        /// Recipient of the LP tokens.
        recipient: Address,
    },

    /// `Uniswap V3` — mint a new position NFT.
    ConcentratedMint {
        /// Token pair of the pool.
        pool_pair: (TokenRef, TokenRef),
        /// Desired amounts for each token in the pair.
        amount_desired: (U256, U256),
        /// Minimum acceptable amounts (slippage floor) for each token.
        amount_min: (U256, U256),
        /// Tick range for the new position.
        range: RangeSpec,
        /// Recipient of the position NFT.
        recipient: Address,
    },

    /// `Uniswap V3` — add liquidity to an existing position NFT.
    ConcentratedIncrease {
        /// NFT position key.
        nft_key: TokenKey,
        /// Desired amounts for each token in the pair.
        amount_desired: (U256, U256),
        /// Minimum acceptable amounts (slippage floor) for each token.
        amount_min: (U256, U256),
    },
}

/// Simulation-time inputs for an add-liquidity action.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AddLiquidityLiveInputs {
    /// Current pool snapshot.
    pub pool_state: LiveField<PoolState>,
    /// Current pool price — used to validate the chosen range.
    pub current_price: LiveField<Price>,
}

/// Withdraw liquidity from a pool — pooled burn, V3 decrease, or V3 burn.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoveLiquidityAction {
    /// Pool venue being withdrawn from.
    pub venue: AmmVenue,
    /// User-signed withdrawal parameters.
    pub params: RemoveLiquidityParams,
    /// Simulation-time inputs (pool snapshot, fees owed).
    pub live_inputs: RemoveLiquidityLiveInputs,
}

/// Variant of a remove-liquidity operation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RemoveLiquidityParams {
    /// `Uniswap V2` / `Curve` / `Balancer`-style proportional burn of an LP token.
    PooledBurn {
        /// LP token being burned.
        lp_token: TokenRef,
        /// Amount of LP token to burn.
        lp_amount: U256,
        /// Minimum acceptable output per underlying token.
        min_out: Vec<(TokenRef, U256)>,
        /// Recipient of withdrawn tokens.
        recipient: Address,
    },
    /// `Uniswap V3` — decrease liquidity on an existing position NFT.
    ConcentratedDecrease {
        /// NFT position key.
        nft_key: TokenKey,
        /// Amount of `V3` liquidity to burn (uint128).
        liquidity_burn: U128,
        /// Minimum acceptable amounts (slippage floor) for each token.
        amount_min: (U256, U256),
    },
    /// `Uniswap V3` — burn an empty position NFT (must `liquidity == 0` first).
    ConcentratedBurn {
        /// NFT position key.
        nft_key: TokenKey,
    },
}

/// Simulation-time inputs for a remove-liquidity action.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoveLiquidityLiveInputs {
    /// Current pool snapshot.
    pub pool_state: LiveField<PoolState>,
    /// Fees owed to the position at simulation time.
    pub fees_owed: LiveField<Vec<(TokenRef, U256)>>,
}

// ---------------------------------------------------------------------------
// CollectFees / Intent Orders
// ---------------------------------------------------------------------------

/// Collect accrued, uncollected fees from a `Uniswap V3` / `V4` position NFT.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectFeesAction {
    /// Pool venue holding the position.
    pub venue: AmmVenue,
    /// NFT position key.
    pub nft_key: TokenKey,
    /// Recipient of the collected fees.
    pub recipient: Address,
    /// Simulation-time fee accrual snapshot.
    pub live_inputs: CollectFeesLiveInputs,
}

/// Simulation-time inputs for a `CollectFees` action.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectFeesLiveInputs {
    /// Fees owed to the position at simulation time.
    pub fees_owed: LiveField<Vec<(TokenRef, U256)>>,
}

/// Sign an EIP-712 intent order (`UniswapX` Dutch, `CowSwap` limit, `1inch Fusion` RFQ, ...).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignIntentOrderAction {
    /// Intent venue receiving the signed order.
    pub venue: IntentVenue,
    /// Token being sold.
    pub sell: TokenRef,
    /// Token being bought.
    pub buy: TokenRef,
    /// Amount of `sell` token offered.
    pub sell_amount: U256,
    /// Minimum acceptable amount of `buy` token.
    pub buy_min: U256,
    /// Order semantics (Dutch / Limit / RFQ).
    pub order_kind: IntentOrderKind,
    /// Recipient of the buy token when the order fills.
    pub recipient: Address,
    /// Order expiry timestamp.
    pub valid_until: Time,
    /// Simulation-time inputs (expected fill price, competing-order count).
    pub live_inputs: SignIntentOrderLiveInputs,
}

/// Off-chain intent-order venue (EIP-712 signed limit / Dutch / RFQ orders).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum IntentVenue {
    /// `UniswapX` reactor-based Dutch / limit orders.
    UniswapX {
        /// Chain the reactor lives on.
        chain: ChainId,
        /// `UniswapX` reactor contract.
        reactor: Address,
    },
    /// `CoW Swap` batch settlement.
    CowSwap {
        /// Chain the settlement contract lives on.
        chain: ChainId,
        /// `CoW Swap` `GPv2Settlement` contract.
        settlement: Address,
    },
    /// `1inch Fusion` resolver-based orders.
    OneInchFusion {
        /// Chain the Fusion order is bound to.
        chain: ChainId,
    },
    /// `Bebop` RFQ orders.
    Bebop {
        /// Chain the Bebop order is bound to.
        chain: ChainId,
    },
}

/// Semantics of an intent order's price discovery.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntentOrderKind {
    /// Dutch auction (price decays over time).
    Dutch,
    /// Fixed limit order.
    Limit,
    /// Request-for-quote (solver-/maker-quoted) order.
    Rfq,
}

/// Simulation-time inputs for a `SignIntentOrder` action.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignIntentOrderLiveInputs {
    /// Expected fill price at simulation time.
    pub expected_fill_price: LiveField<Price>,
    /// Number of active competing orders on the same pair.
    pub competing_orders: LiveField<u32>,
}

/// Cancel a previously signed intent order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelIntentOrderAction {
    /// Intent venue the order was signed against.
    pub venue: IntentVenue,
    /// 32-byte hex order hash being cancelled.
    pub order_hash: String,
    /// Some venues use an EIP-712 signature to authorize the cancellation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<Bytes>,
}
