//! `PerpAction` — `OpenPosition`/`ClosePosition`/`AdjustMargin`/`PlaceLimitOrder`/`PlaceStopOrder`/`CancelOrder`/`ClaimFunding`. See spec §9.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::position::{MarginMode, PerpSide, PositionId};
use simulation_state::primitives::{Address, ChainId, Decimal, MarketRef, Price, SignedI256, U256};
use simulation_state::token::TokenRef;
use simulation_state::LiveField;

// ---------------------------------------------------------------------------
// Domain enum
// ---------------------------------------------------------------------------

/// Top-level perpetuals action dispatched by the reducer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum PerpAction {
    /// Open a new perpetual position.
    OpenPosition(OpenPerpAction),
    /// Close (fully or partially) an existing position.
    ClosePosition(ClosePerpAction),
    /// Add size to an existing position.
    IncreasePosition(IncreasePerpAction),
    /// Reduce size of an existing position without fully closing it.
    DecreasePosition(DecreasePerpAction),
    /// Add or withdraw collateral from a position.
    AdjustMargin(AdjustMarginAction),
    /// Change the leverage setting for a market.
    ChangeLeverage(ChangeLeverageAction),
    /// Cross <-> Isolated margin mode switch.
    ChangeMarginMode(ChangeMarginModeAction),
    /// Place a limit order on the venue's orderbook.
    PlaceLimitOrder(PlaceLimitOrderAction),
    /// `StopMarket` | `StopLimit` | `TakeProfit` | `TakeProfitLimit`.
    PlaceStopOrder(PlaceStopOrderAction),
    /// Cancel a previously placed open order.
    CancelOrder(CancelOrderAction),
    /// Claim accrued funding payments.
    ClaimFunding(ClaimFundingAction),
}

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

/// Perpetual trading venue (protocol + chain).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum PerpVenue {
    /// `Hyperliquid` L1 (off-chain orderbook).
    Hyperliquid {
        /// Chain identifier for the `Hyperliquid` L1.
        chain: ChainId,
    },
    /// `GMX V2` perpetual venue.
    GmxV2 {
        /// Chain hosting the `GMX V2` deployment.
        chain: ChainId,
    },
    /// `dYdX V4` — runs on a Cosmos chain.
    DyDxV4 {
        /// Cosmos chain identifier for `dYdX V4`.
        chain: ChainId,
    },
    /// `Vertex` perpetual venue.
    Vertex {
        /// Chain hosting the `Vertex` deployment.
        chain: ChainId,
    },
    /// `Aevo` perpetual venue.
    Aevo {
        /// Chain hosting the `Aevo` deployment.
        chain: ChainId,
    },
    /// `Drift` — on Solana.
    Drift {
        /// Solana chain identifier for `Drift`.
        chain: ChainId,
    },
    /// `Jupiter Perps` — on Solana.
    JupiterPerps {
        /// Solana chain identifier for `Jupiter Perps`.
        chain: ChainId,
    },
    /// `Synthetix` perpetual venue.
    Synthetix {
        /// Chain hosting the `Synthetix` deployment.
        chain: ChainId,
    },
    /// Generic / unspecified perpetual contract.
    Generic {
        /// Chain on which the contract is deployed.
        chain: ChainId,
        /// Address of the perpetual contract.
        #[tsify(type = "string")]
        contract: Address,
    },
}

// ---------------------------------------------------------------------------
// Size specification
// ---------------------------------------------------------------------------

/// How the caller specifies position / order size.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SizeSpec {
    /// Base asset units (e.g. "1 ETH").
    BaseAmount {
        /// Amount denominated in the base asset.
        #[tsify(type = "string")]
        amount: U256,
    },
    /// Quote (USD) units (e.g. "$5000 worth").
    QuoteAmount {
        /// Amount denominated in USD quote units.
        #[tsify(type = "string")]
        amount_usd: U256,
    },
    /// Derived from collateral * leverage.
    LeverageImplied {
        /// Collateral committed to the position.
        #[tsify(type = "string")]
        collateral: U256,
        /// Leverage multiplier applied to `collateral`.
        leverage: Decimal,
    },
}

// ---------------------------------------------------------------------------
// Order lifecycle options
// ---------------------------------------------------------------------------

/// Order time-in-force policy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimeInForce {
    /// Good Till Cancelled.
    Gtc,
    /// Immediate Or Cancel — cancel any unfilled portion immediately.
    Ioc,
    /// Fill Or Kill — cancel the entire order if it cannot be fully filled immediately.
    Fok,
    /// Maker-only — reject if the order would result in a taker fill.
    PostOnly,
    /// Good Till Date — only supported on some venues.
    Gtd {
        /// Expiration time of the order.
        until: simulation_state::primitives::Time,
    },
}

/// Kind of stop / take-profit order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "snake_case")]
pub enum StopOrderKind {
    /// Stop order that executes as a market order once triggered.
    StopMarket,
    /// Stop order that places a limit order once triggered.
    StopLimit,
    /// Take-profit order executed as a market order once triggered.
    TakeProfit,
    /// Take-profit order placed as a limit order once triggered.
    TakeProfitLimit,
}

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

/// Aggregate margin / collateral snapshot for a perp account.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PerpAccountState {
    /// Total collateral on the account, in USD.
    #[tsify(type = "string")]
    pub total_collateral_usd: U256,
    /// Margin currently locked by open positions / orders, in USD.
    #[tsify(type = "string")]
    pub used_margin_usd: U256,
    /// Margin available for new positions / orders, in USD.
    #[tsify(type = "string")]
    pub free_margin_usd: U256,
    /// Existing exposure per market.
    #[tsify(type = "Array<[MarketRef, string]>")]
    pub open_positions: Vec<(MarketRef, U256)>,
}

/// Live snapshot of a single perp position.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PerpPositionLive {
    /// Position size in base asset units.
    #[tsify(type = "string")]
    pub size_base: U256,
    /// Notional value of the position in USD.
    #[tsify(type = "string")]
    pub notional_usd: U256,
    /// Average entry `Price`.
    pub entry_price: Price,
    /// Current mark `Price` used for `PnL` / liquidation.
    pub mark_price: Price,
    /// Liquidation `Price` if computable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub liq_price: Option<Price>,
    /// Unrealized `PnL` as a `SignedI256` (positive = profit).
    #[tsify(type = "string")]
    pub unrealized_pnl: SignedI256,
}

// ---------------------------------------------------------------------------
// Open / Close / Increase / Decrease
// ---------------------------------------------------------------------------

/// Open a new perpetual position at market price.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct OpenPerpAction {
    /// Perpetual venue (e.g. `Hyperliquid`, `GmxV2`).
    pub venue: PerpVenue,
    /// Market symbol (e.g. `ETH-USD`).
    pub market: MarketRef,
    /// Long or short (`PerpSide`).
    pub side: PerpSide,
    /// Position size (`SizeSpec` lets caller pick base / quote / leverage-implied).
    pub size: SizeSpec,
    /// Leverage multiplier to use for this position.
    pub leverage: Decimal,
    /// Collateral token and amount posted.
    #[tsify(type = "[TokenRef, string]")]
    pub collateral: (TokenRef, U256),
    /// Cross or isolated `MarginMode`.
    pub margin_mode: MarginMode,
    /// Maximum acceptable slippage in basis points.
    pub slippage_bp: u32,
    /// If `true`, the order may only reduce existing exposure.
    pub reduce_only: bool,
    /// Live market / account inputs required by the reducer.
    pub live_inputs: OpenPerpLiveInputs,
}

/// Live inputs read at execution time for `OpenPerpAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct OpenPerpLiveInputs {
    /// Venue mark `Price` for the market.
    pub mark_price: LiveField<Price>,
    /// Oracle `Price` for the market.
    pub oracle_price: LiveField<Price>,
    /// Current funding rate (e.g. 1h or 8h).
    pub funding_rate: LiveField<Decimal>,
    /// Remaining venue/market open-interest (OI) capacity.
    #[tsify(type = "LiveField<string>")]
    pub available_oi: LiveField<U256>,
    /// Maximum leverage allowed by the venue/market.
    pub max_leverage: LiveField<Decimal>,
    /// Initial margin requirement in basis points.
    pub initial_margin_bp: LiveField<u32>,
    /// Maintenance margin requirement in basis points.
    pub maintenance_bp: LiveField<u32>,
    /// Taker fee in basis points.
    pub fee_taker_bp: LiveField<u32>,
    /// Maker fee in basis points.
    pub fee_maker_bp: LiveField<u32>,
    /// Current `PerpAccountState` for the user.
    pub user_account_state: LiveField<PerpAccountState>,
}

/// Close (fully or partially) an existing perpetual position.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClosePerpAction {
    /// Perpetual venue hosting the position.
    pub venue: PerpVenue,
    /// Identifier of the position to close (`PositionId`).
    pub position_id: PositionId,
    /// None = full close.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub size: Option<SizeSpec>,
    /// Maximum acceptable slippage in basis points.
    pub slippage_bp: u32,
    /// Live market / position inputs.
    pub live_inputs: ClosePerpLiveInputs,
}

/// Live inputs read at execution time for `ClosePerpAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClosePerpLiveInputs {
    /// Current mark `Price` for the market.
    pub mark_price: LiveField<Price>,
    /// Unrealized `PnL` on the position at execution time.
    #[tsify(type = "LiveField<string>")]
    pub unrealized_pnl_now: LiveField<SignedI256>,
    /// Funding accrued on the position so far.
    #[tsify(type = "LiveField<string>")]
    pub funding_accrued: LiveField<SignedI256>,
    /// Fee in basis points to apply on close.
    pub fee_bp: LiveField<u32>,
}

/// Increase size of an existing perpetual position.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct IncreasePerpAction {
    /// Perpetual venue hosting the position.
    pub venue: PerpVenue,
    /// Identifier of the position to increase (`PositionId`).
    pub position_id: PositionId,
    /// Additional size to add (`SizeSpec`).
    pub size: SizeSpec,
    /// Optional extra collateral token and amount to post.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "[TokenRef, string]")]
    pub add_collateral: Option<(TokenRef, U256)>,
    /// Maximum acceptable slippage in basis points.
    pub slippage_bp: u32,
    /// Same `OpenPerpLiveInputs` as for opening a position.
    pub live_inputs: OpenPerpLiveInputs,
}

/// Decrease size of an existing perpetual position without closing it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct DecreasePerpAction {
    /// Perpetual venue hosting the position.
    pub venue: PerpVenue,
    /// Identifier of the position to decrease (`PositionId`).
    pub position_id: PositionId,
    /// Size to remove (`SizeSpec`).
    pub size: SizeSpec,
    /// Maximum acceptable slippage in basis points.
    pub slippage_bp: u32,
    /// Live market / position inputs (shared with close).
    pub live_inputs: ClosePerpLiveInputs,
}

// ---------------------------------------------------------------------------
// AdjustMargin / ChangeLeverage / ChangeMarginMode
// ---------------------------------------------------------------------------

/// Add or withdraw collateral from an existing position.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AdjustMarginAction {
    /// Perpetual venue hosting the position.
    pub venue: PerpVenue,
    /// Identifier of the position being adjusted (`PositionId`).
    pub position_id: PositionId,
    /// Positive = deposit, negative = withdraw.
    #[tsify(type = "string")]
    pub delta: SignedI256,
    /// Live position / margin inputs.
    pub live_inputs: AdjustMarginLiveInputs,
}

/// Live inputs read at execution time for `AdjustMarginAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AdjustMarginLiveInputs {
    /// Current `PerpPositionLive` state.
    pub position_state: LiveField<PerpPositionLive>,
    /// Free margin remaining after the adjustment is applied.
    #[tsify(type = "LiveField<string>")]
    pub free_margin_after: LiveField<U256>,
}

/// Change the leverage setting for a market.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ChangeLeverageAction {
    /// Perpetual venue on which leverage is being changed.
    pub venue: PerpVenue,
    /// Market the new leverage applies to.
    pub market: MarketRef,
    /// New leverage multiplier.
    pub new_leverage: Decimal,
    /// Live venue / position inputs.
    pub live_inputs: ChangeLeverageLiveInputs,
}

/// Live inputs read at execution time for `ChangeLeverageAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ChangeLeverageLiveInputs {
    /// Maximum leverage allowed by the venue/market.
    pub max_leverage: LiveField<Decimal>,
    /// Positions affected by the leverage change.
    pub affected_positions: LiveField<Vec<PositionId>>,
    /// New liquidation `Price` for each affected position.
    pub new_liq_prices: LiveField<Vec<(PositionId, Option<Price>)>>,
}

/// Switch margin mode (`Cross` <-> `Isolated`) for a market.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ChangeMarginModeAction {
    /// Perpetual venue on which margin mode is being changed.
    pub venue: PerpVenue,
    /// Market the new mode applies to.
    pub market: MarketRef,
    /// New `MarginMode` (cross or isolated).
    pub new_mode: MarginMode,
    /// Live venue / position inputs.
    pub live_inputs: ChangeMarginModeLiveInputs,
}

/// Live inputs read at execution time for `ChangeMarginModeAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ChangeMarginModeLiveInputs {
    /// Positions affected by the margin-mode switch.
    pub affected_positions: LiveField<Vec<PositionId>>,
    /// Resulting margin reallocation per affected position.
    #[tsify(type = "LiveField<Array<[PositionId, string]>>")]
    pub margin_reallocation: LiveField<Vec<(PositionId, U256)>>,
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/// Place a limit order on the venue's orderbook.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PlaceLimitOrderAction {
    /// Perpetual venue receiving the order.
    pub venue: PerpVenue,
    /// Market symbol the order is placed on.
    pub market: MarketRef,
    /// Long or short (`PerpSide`).
    pub side: PerpSide,
    /// Order size (`SizeSpec`).
    pub size: SizeSpec,
    /// Limit `Price`.
    pub price: Price,
    /// Time-in-force policy (`TimeInForce`).
    pub time_in_force: TimeInForce,
    /// If `true`, the order may only reduce existing exposure.
    pub reduce_only: bool,
    /// Live market / account inputs.
    pub live_inputs: PlaceLimitLiveInputs,
}

/// Live inputs read at execution time for `PlaceLimitOrderAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PlaceLimitLiveInputs {
    /// Current mark `Price` for the market.
    pub mark_price: LiveField<Price>,
    /// Best bid / ask `Price` pair used for spread validation.
    pub best_bid_ask: LiveField<(Price, Price)>,
    /// Number of open orders — used to check venue per-user limits.
    pub open_orders_count: LiveField<u32>,
    /// Current `PerpAccountState` for the user.
    pub user_account_state: LiveField<PerpAccountState>,
}

/// Place a stop / take-profit order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PlaceStopOrderAction {
    /// Perpetual venue receiving the order.
    pub venue: PerpVenue,
    /// Market symbol the order is placed on.
    pub market: MarketRef,
    /// Long or short (`PerpSide`).
    pub side: PerpSide,
    /// Order size (`SizeSpec`).
    pub size: SizeSpec,
    /// Trigger `Price` at which the stop fires.
    pub trigger_price: Price,
    /// Kind of stop order (`StopOrderKind`).
    pub order_kind: StopOrderKind,
    /// Required only for `StopLimit` / `TakeProfitLimit`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub limit_price: Option<Price>,
    /// If `true`, the order may only reduce existing exposure.
    pub reduce_only: bool,
    /// Live market / account inputs.
    pub live_inputs: PlaceStopLiveInputs,
}

/// Live inputs read at execution time for `PlaceStopOrderAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PlaceStopLiveInputs {
    /// Current mark `Price` for the market.
    pub mark_price: LiveField<Price>,
    /// Current `PerpAccountState` for the user.
    pub user_account_state: LiveField<PerpAccountState>,
}

/// Cancel a previously placed open order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CancelOrderAction {
    /// Perpetual venue holding the order.
    pub venue: PerpVenue,
    /// Venue-assigned order identifier.
    pub order_id: String,
}

/// Claim accrued funding payments from one or all markets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimFundingAction {
    /// Perpetual venue to claim funding from.
    pub venue: PerpVenue,
    /// None = all markets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub market: Option<MarketRef>,
    /// Live claimable-funding inputs.
    pub live_inputs: ClaimFundingLiveInputs,
}

/// Live inputs read at execution time for `ClaimFundingAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimFundingLiveInputs {
    /// Claimable funding amounts grouped by `TokenRef`.
    #[tsify(type = "LiveField<Array<[TokenRef, string]>>")]
    pub claimable: LiveField<Vec<(TokenRef, U256)>>,
}
