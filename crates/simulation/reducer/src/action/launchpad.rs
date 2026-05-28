//! `LaunchpadAction` — `Commit`, `ClaimAllocation`, `ClaimVested`, `Refund`, `WithdrawCommit`. See spec §8.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

use simulation_state::position::{PositionId, VestSchedule};
use simulation_state::primitives::{Address, Price, ProtocolRef, Time, U256};
use simulation_state::token::TokenRef;
use simulation_state::LiveField;

/// Launchpad-related actions covering subscription, claim, refund, and withdraw flows.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum LaunchpadAction {
    /// Commits funds to a launchpad sale (subscription).
    Commit(CommitAction),
    /// Claims the allocated sale tokens after the sale concludes.
    ClaimAllocation(ClaimAllocationAction),
    /// Claims tokens that have vested from a launchpad allocation.
    ClaimVested(ClaimVestedAction),
    /// Refunds the committed payment token (e.g. oversubscription or failed sale).
    Refund(RefundAction),
    /// Cancels a prior commitment on platforms that allow pre-sale withdrawal.
    WithdrawCommit(WithdrawCommitAction),
}

/// Commits funds to a launchpad sale (subscription).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CommitAction {
    /// Launchpad platform (e.g. `CoinList`, `Buidlpad`, `Echo`, `Fjord`).
    pub platform: ProtocolRef,
    /// Identifier of the sale within the platform.
    pub sale_id: String,
    /// Token used to pay into the sale (e.g. stablecoin or native asset).
    pub pay_token: TokenRef,
    /// Amount of `pay_token` to commit.
    #[tsify(type = "string")]
    pub amount: U256,
    /// Address receiving the resulting allocation/claim rights.
    #[tsify(type = "string")]
    pub recipient: Address,
    /// Live on-chain inputs read at execution time.
    pub live_inputs: CommitLiveInputs,
}

/// Live-read inputs required to validate and execute a `CommitAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CommitLiveInputs {
    /// Current sale state (cap, window, vest schedule, totals).
    pub sale_state: LiveField<SaleState>,
    /// Per-user commit cap enforced by the platform.
    #[tsify(type = "LiveField<string>")]
    pub user_cap: LiveField<U256>,
    /// Amount already committed by the user.
    #[tsify(type = "LiveField<string>")]
    pub user_committed: LiveField<U256>,
    /// Expected sale price (if the platform exposes one) used for slippage/UI checks.
    pub expected_token_price: LiveField<Option<Price>>,
}

/// Snapshot of a launchpad sale's on-chain state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SaleState {
    /// Whether the sale is currently open for commitments.
    pub is_active: bool,
    /// Total amount committed across all participants.
    #[tsify(type = "string")]
    pub total_committed: U256,
    /// Optional hard cap; commitments above this are rejected or refunded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub hard_cap: Option<U256>,
    /// Optional soft cap; sale may fail if not reached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub soft_cap: Option<U256>,
    /// Sale open/close timestamps as `(start, end)`.
    pub sale_window: (Time, Time),
    /// Optional `VestSchedule` applied to the claimed allocation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub vest_schedule: Option<VestSchedule>,
}

/// Claims the allocated sale tokens after the sale ends.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimAllocationAction {
    /// Launchpad platform (e.g. `CoinList`, `Buidlpad`, `Echo`, `Fjord`).
    pub platform: ProtocolRef,
    /// Identifier of the sale within the platform.
    pub sale_id: String,
    /// Address receiving the claimed allocation.
    #[tsify(type = "string")]
    pub recipient: Address,
    /// Live on-chain inputs read at execution time.
    pub live_inputs: ClaimAllocationLiveInputs,
}

/// Live-read inputs required to execute a `ClaimAllocationAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimAllocationLiveInputs {
    /// Allocated `(TokenRef, amount)` granted to the user.
    #[tsify(type = "LiveField<[TokenRef, string]>")]
    pub allocated: LiveField<(TokenRef, U256)>,
    /// Refund owed due to oversubscription.
    #[tsify(type = "LiveField<string>")]
    pub refund_due: LiveField<U256>,
    /// Whether the allocation is currently claimable.
    pub is_claimable: LiveField<bool>,
}

/// Claims tokens that have vested from a launchpad allocation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimVestedAction {
    /// Position identifier — state §5 `LaunchpadAllocation` or `VestingSchedule`.
    pub position_id: PositionId,
    /// Amount to claim; `None` claims the maximum currently available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub amount: Option<U256>,
    /// Live on-chain inputs read at execution time.
    pub live_inputs: ClaimVestedLiveInputs,
}

/// Live-read inputs required to execute a `ClaimVestedAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ClaimVestedLiveInputs {
    /// Amount currently claimable from the vesting schedule.
    #[tsify(type = "LiveField<string>")]
    pub claimable_now: LiveField<U256>,
    /// Next unlock as `(timestamp, amount)`, if any remain.
    #[tsify(type = "LiveField<[Time, string] | null>")]
    pub next_unlock: LiveField<Option<(Time, U256)>>,
}

/// Refunds the committed payment token (e.g. oversubscription or failed sale).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RefundAction {
    /// Launchpad platform (e.g. `CoinList`, `Buidlpad`, `Echo`, `Fjord`).
    pub platform: ProtocolRef,
    /// Identifier of the sale within the platform.
    pub sale_id: String,
    /// Address receiving the refunded tokens.
    #[tsify(type = "string")]
    pub recipient: Address,
    /// Live on-chain inputs read at execution time.
    pub live_inputs: RefundLiveInputs,
}

/// Live-read inputs required to execute a `RefundAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RefundLiveInputs {
    /// Amount eligible to be refunded.
    #[tsify(type = "LiveField<string>")]
    pub refund_amount: LiveField<U256>,
    /// `TokenRef` of the asset being refunded.
    pub refund_token: LiveField<TokenRef>,
}

/// Cancels a prior commitment on platforms that allow pre-sale withdrawal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WithdrawCommitAction {
    /// Launchpad platform (e.g. `CoinList`, `Buidlpad`, `Echo`, `Fjord`).
    pub platform: ProtocolRef,
    /// Identifier of the sale within the platform.
    pub sale_id: String,
    /// Amount to withdraw; `None` withdraws the full committed balance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "string")]
    pub amount: Option<U256>,
    /// Live on-chain inputs read at execution time.
    pub live_inputs: WithdrawCommitLiveInputs,
}

/// Live-read inputs required to execute a `WithdrawCommitAction`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WithdrawCommitLiveInputs {
    /// Amount currently available to withdraw.
    #[tsify(type = "LiveField<string>")]
    pub withdrawable: LiveField<U256>,
    /// Current sale state used to verify withdrawal is still permitted.
    pub sale_state: LiveField<SaleState>,
}
