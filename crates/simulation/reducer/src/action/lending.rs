//! `LendingAction` — `Supply` / `Withdraw` / `Borrow` / `Repay`, etc. See spec §6.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::position::EModeCategory;
use simulation_state::primitives::{Address, ChainId, Decimal, Price, U256};
use simulation_state::token::{RateMode, TokenRef};
use simulation_state::LiveField;

/// User-level lending actions across supported venues.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum LendingAction {
    /// Supply (`deposit`) an asset into a lending market.
    Supply(SupplyAction),
    /// Withdraw a previously supplied asset.
    Withdraw(WithdrawAction),
    /// Borrow an asset against existing collateral.
    Borrow(BorrowAction),
    /// Repay an outstanding debt position.
    Repay(RepayAction),
    /// `Aave`-specific — switch between `Variable` and `Stable` borrow rate modes.
    SwapRateMode(SwapRateModeAction),
    /// `Aave V3` e-mode selection.
    SetEMode(SetEModeAction),
    /// Mark an asset as collateral.
    EnableCollateral(SetCollateralAction),
    /// Unmark an asset as collateral.
    DisableCollateral(SetCollateralAction),
    /// `Aave` credit delegation.
    DelegateBorrow(DelegateBorrowAction),
    /// Liquidate an unhealthy position; typically not invoked from a user wallet, included for completeness.
    Liquidate(LiquidateAction),
}

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

/// Lending venue identifier with venue-specific addressing fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum LendingVenue {
    /// `Aave V3` deployment on a given chain.
    AaveV3 {
        /// Chain hosting the pool.
        chain: ChainId,
        /// `Pool` contract address.
        #[tsify(type = "string")]
        pool: Address,
        /// Optional sub-market identifier (used by some `Aave V3` forks).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        market_id: Option<u8>,
    },
    /// `Aave V2` deployment on a given chain.
    AaveV2 {
        /// Chain hosting the pool.
        chain: ChainId,
        /// `LendingPool` contract address.
        #[tsify(type = "string")]
        pool: Address,
    },
    /// `Compound V3` (`Comet`) deployment.
    CompoundV3 {
        /// Chain hosting the `Comet` market.
        chain: ChainId,
        /// `Comet` contract address.
        #[tsify(type = "string")]
        comet: Address,
        /// Base asset of this `Comet` market.
        base_asset: TokenRef,
    },
    /// `Compound V2` deployment.
    CompoundV2 {
        /// Chain hosting the comptroller.
        chain: ChainId,
        /// `Comptroller` contract address.
        #[tsify(type = "string")]
        comptroller: Address,
    },
    /// `Morpho Blue` market — `market_id = keccak((loan, collat, oracle, irm, lltv))`.
    MorphoBlue {
        /// Chain hosting `Morpho Blue`.
        chain: ChainId,
        /// `Market` id as a hex string.
        market_id: String,
    },
    /// `Morpho Optimizer` vault on top of `Aave` / `Compound`.
    MorphoOptimizer {
        /// Chain hosting the vault.
        chain: ChainId,
        /// Vault contract address.
        #[tsify(type = "string")]
        vault: Address,
    },
    /// `Spark` lending pool (`Aave V3` fork).
    Spark {
        /// Chain hosting the pool.
        chain: ChainId,
        /// `Pool` contract address.
        #[tsify(type = "string")]
        pool: Address,
    },
    /// `Fluid` lending vault.
    Fluid {
        /// Chain hosting the vault.
        chain: ChainId,
        /// Vault contract address.
        #[tsify(type = "string")]
        vault: Address,
    },
}

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

/// Reserve-level metadata — supply/borrow caps, `LTV`, etc.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ReserveState {
    /// Total supplied amount in the reserve (asset units).
    #[tsify(type = "string")]
    pub total_supply: U256,
    /// Total borrowed amount from the reserve (asset units).
    #[tsify(type = "string")]
    pub total_borrow: U256,
    /// Current utilization in basis points.
    pub utilization_bp: u32,
    /// Optional supply cap (asset units).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub supply_cap: Option<U256>,
    /// Optional borrow cap (asset units).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub borrow_cap: Option<U256>,
    /// Loan-to-value in basis points.
    pub ltv_bp: u32,
    /// Liquidation threshold in basis points.
    pub liquidation_threshold_bp: u32,
    /// Liquidation bonus in basis points.
    pub liquidation_bonus_bp: u32,
    /// Reserve factor in basis points.
    pub reserve_factor_bp: u32,
    /// Whether the reserve is frozen (no new positions).
    pub is_frozen: bool,
    /// Whether the reserve is paused (no interactions).
    pub is_paused: bool,
}

/// Aggregated lending account state for one user — mirrors `Aave`'s `getUserAccountData`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct UserLendingState {
    /// Current health factor.
    pub health_factor: Decimal,
    /// Total collateral value in USD (scaled).
    #[tsify(type = "string")]
    pub total_collat_usd: U256,
    /// Total debt value in USD (scaled).
    #[tsify(type = "string")]
    pub total_debt_usd: U256,
    /// Remaining borrowing power in USD (scaled).
    #[tsify(type = "string")]
    pub available_borrow_usd: U256,
}

// ---------------------------------------------------------------------------
// Supply
// ---------------------------------------------------------------------------

/// Supply (`deposit`) an asset into a lending market.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SupplyAction {
    /// Lending venue (e.g. `AaveV3` on Optimism).
    pub venue: LendingVenue,
    /// Asset being supplied.
    pub asset: TokenRef,
    /// Amount to supply (asset units).
    #[tsify(type = "string")]
    pub amount: U256,
    /// Beneficiary; defaults to `submitter` when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub on_behalf_of: Option<Address>,
    /// Live inputs fetched at simulation time.
    pub live_inputs: SupplyLiveInputs,
}

/// Live-fetched inputs for a `SupplyAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SupplyLiveInputs {
    /// Reserve state at simulation time.
    pub reserve_state: LiveField<ReserveState>,
    /// Current supply APY for the asset.
    pub supply_apy: LiveField<Decimal>,
    /// `aToken` price in USD.
    pub a_token_price_usd: LiveField<Price>,
    /// Whether the supplied asset can be used as collateral.
    pub eligible_as_collat: LiveField<bool>,
    /// User account state before the action.
    pub user_state_before: LiveField<UserLendingState>,
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------

/// Withdraw a previously supplied asset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WithdrawAction {
    /// Lending venue.
    pub venue: LendingVenue,
    /// Asset being withdrawn.
    pub asset: TokenRef,
    /// Amount to withdraw; `U256::MAX` = max-withdraw.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Address receiving the withdrawn funds.
    #[tsify(type = "string")]
    pub recipient: Address,
    /// Live inputs fetched at simulation time.
    pub live_inputs: WithdrawLiveInputs,
}

/// Live-fetched inputs for a `WithdrawAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WithdrawLiveInputs {
    /// Reserve state at simulation time.
    pub reserve_state: LiveField<ReserveState>,
    /// Maximum amount the user can withdraw right now.
    #[tsify(type = "LiveField<string>")]
    pub available_to_withdraw: LiveField<U256>,
    /// User account state before the action.
    pub user_state_before: LiveField<UserLendingState>,
}

// ---------------------------------------------------------------------------
// Borrow
// ---------------------------------------------------------------------------

/// Borrow an asset against existing collateral.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct BorrowAction {
    /// Lending venue.
    pub venue: LendingVenue,
    /// Asset being borrowed.
    pub asset: TokenRef,
    /// Amount to borrow (asset units).
    #[tsify(type = "string")]
    pub amount: U256,
    /// Borrow rate mode (`Variable` or `Stable`).
    pub rate_mode: RateMode,
    /// Borrower of record; defaults to `submitter` when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub on_behalf_of: Option<Address>,
    /// Live inputs fetched at simulation time.
    pub live_inputs: BorrowLiveInputs,
}

/// Live-fetched inputs for a `BorrowAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct BorrowLiveInputs {
    /// Reserve state at simulation time.
    pub reserve_state: LiveField<ReserveState>,
    /// User account state before the action.
    pub user_state_before: LiveField<UserLendingState>,
    /// Borrow asset price in USD.
    pub asset_price_usd: LiveField<Price>,
    /// Current borrow rate for the chosen `RateMode`.
    pub current_borrow_rate: LiveField<Decimal>,
    /// Liquidity available in the reserve for borrowing.
    #[tsify(type = "LiveField<string>")]
    pub available_liquidity: LiveField<U256>,
}

// ---------------------------------------------------------------------------
// Repay
// ---------------------------------------------------------------------------

/// Repay an outstanding debt position.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RepayAction {
    /// Lending venue.
    pub venue: LendingVenue,
    /// Asset being repaid.
    pub asset: TokenRef,
    /// Amount to repay; `U256::MAX` = full repay.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Rate mode of the debt being repaid.
    pub rate_mode: RateMode,
    /// Debtor of record; defaults to `submitter` when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub on_behalf_of: Option<Address>,
    /// `Aave V3` flag — repay directly using `aToken` balance.
    pub use_a_tokens: bool,
    /// Live inputs fetched at simulation time.
    pub live_inputs: RepayLiveInputs,
}

/// Live-fetched inputs for a `RepayAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RepayLiveInputs {
    /// Reserve state at simulation time.
    pub reserve_state: LiveField<ReserveState>,
    /// Current outstanding debt for the chosen `RateMode`.
    #[tsify(type = "LiveField<string>")]
    pub current_debt: LiveField<U256>,
    /// User account state before the action.
    pub user_state_before: LiveField<UserLendingState>,
}

// ---------------------------------------------------------------------------
// SwapRateMode (Aave)
// ---------------------------------------------------------------------------

/// Switch the rate mode of an existing `Aave` debt position.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SwapRateModeAction {
    /// Lending venue (`Aave V2` / `Aave V3`).
    pub venue: LendingVenue,
    /// Asset whose debt rate mode is being switched.
    pub asset: TokenRef,
    /// Target rate mode after the swap.
    pub new_mode: RateMode,
    /// Live inputs fetched at simulation time.
    pub live_inputs: SwapRateModeLiveInputs,
}

/// Live-fetched inputs for a `SwapRateModeAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SwapRateModeLiveInputs {
    /// Current `(variable, stable)` debt balances.
    #[tsify(type = "LiveField<[string, string]>")]
    pub current_debts: LiveField<(U256, U256)>,
    /// Current `(variable, stable)` borrow rates.
    pub rates: LiveField<(Decimal, Decimal)>,
}

// ---------------------------------------------------------------------------
// SetEMode (Aave V3)
// ---------------------------------------------------------------------------

/// Select an `Aave V3` e-mode category for the user.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SetEModeAction {
    /// Lending venue (`Aave V3`).
    pub venue: LendingVenue,
    /// Target category id; `0` = disable e-mode.
    pub category_id: u8,
    /// Live inputs fetched at simulation time.
    pub live_inputs: SetEModeLiveInputs,
}

/// Live-fetched inputs for a `SetEModeAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SetEModeLiveInputs {
    /// Configuration of the target e-mode category.
    pub category_config: LiveField<EModeConfig>,
    /// User account state before the action.
    pub user_state_before: LiveField<UserLendingState>,
}

/// E-mode category configuration.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct EModeConfig {
    /// Loan-to-value within the category, in basis points.
    pub ltv_bp: u32,
    /// Liquidation threshold within the category, in basis points.
    pub liquidation_threshold_bp: u32,
    /// Liquidation bonus within the category, in basis points.
    pub liquidation_bonus_bp: u32,
    /// Optional category-specific price source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub price_source: Option<Address>,
    /// Assets eligible under this category.
    pub assets_in_category: Vec<TokenRef>,
    /// `EModeCategory` id from the state crate (reuses `Aave`'s category labels).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub category: Option<EModeCategory>,
}

// ---------------------------------------------------------------------------
// Enable/DisableCollateral
// ---------------------------------------------------------------------------

/// Enable or disable an asset's use as collateral.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SetCollateralAction {
    /// Lending venue.
    pub venue: LendingVenue,
    /// Asset whose collateral flag is being toggled.
    pub asset: TokenRef,
    /// Live inputs fetched at simulation time.
    pub live_inputs: SetCollateralLiveInputs,
}

/// Live-fetched inputs for a `SetCollateralAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SetCollateralLiveInputs {
    /// Reserve state at simulation time.
    pub reserve_state: LiveField<ReserveState>,
    /// User account state before the action.
    pub user_state_before: LiveField<UserLendingState>,
}

// ---------------------------------------------------------------------------
// DelegateBorrow
// ---------------------------------------------------------------------------

/// `Aave` credit-delegation: authorize another address to borrow on behalf of the submitter.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct DelegateBorrowAction {
    /// Lending venue (`Aave V2` / `Aave V3`).
    pub venue: LendingVenue,
    /// Asset whose borrow allowance is being delegated.
    pub asset: TokenRef,
    /// Address being granted the borrow allowance.
    #[tsify(type = "string")]
    pub delegatee: Address,
    /// Allowance amount (asset units).
    #[tsify(type = "string")]
    pub amount: U256,
    /// Rate mode covered by the delegation.
    pub rate_mode: RateMode,
}

// ---------------------------------------------------------------------------
// Liquidate
// ---------------------------------------------------------------------------

/// Liquidate an unhealthy borrower; typically not invoked from a user wallet, included for completeness.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct LiquidateAction {
    /// Lending venue.
    pub venue: LendingVenue,
    /// Borrower being liquidated.
    #[tsify(type = "string")]
    pub victim: Address,
    /// Debt asset being repaid by the liquidator.
    pub debt_asset: TokenRef,
    /// Collateral asset being seized.
    pub collat_asset: TokenRef,
    /// Debt amount the liquidator covers.
    #[tsify(type = "string")]
    pub debt_to_cover: U256,
    /// `Aave V3` option — receive seized collateral as `aToken` instead of underlying.
    pub receive_a_token: bool,
    /// Live inputs fetched at simulation time.
    pub live_inputs: LiquidateLiveInputs,
}

/// Live-fetched inputs for a `LiquidateAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct LiquidateLiveInputs {
    /// Account state of the borrower being liquidated.
    pub victim_state: LiveField<UserLendingState>,
    /// Liquidation bonus, in basis points.
    pub liquidation_bonus: LiveField<u32>,
    /// Debt asset price in USD.
    pub debt_asset_price: LiveField<Price>,
    /// Collateral asset price in USD.
    pub collat_asset_price: LiveField<Price>,
}
