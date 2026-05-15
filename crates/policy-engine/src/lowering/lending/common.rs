//! Shared lowering helpers for lending action submodules.

use crate::action::lending::{
    AmountMode, AuthorizationScope, ContractRef, FlashLoanKind, LiquidateMode, LiquidationKind,
    MarketRef, RepayKind, RevokeKind, SignAuthorizationScope,
};
use crate::context_keys::{ADDRESS, ID, LABEL};
use serde_json::{Map, Value};

/// Serialize a [`MarketRef`] into the `Pool`-shaped JSON the Cedar schema
/// expects (`address`, optional `id`, optional `label`).
///
/// `address` is technically required by the schema, but every other lending
/// JSON shape in the workspace silently omits the field when missing
/// (mirroring [`crate::lowering::common::pool::pool_json`]).
pub(crate) fn market_json(market: &MarketRef) -> Value {
    let mut out = Map::new();
    if let Some(address) = &market.address {
        out.insert(ADDRESS.into(), Value::from(address.to_string()));
    }
    if let Some(id) = &market.id {
        out.insert(ID.into(), Value::from(id.to_string()));
    }
    if let Some(label) = &market.label {
        out.insert(LABEL.into(), Value::from(label.as_str()));
    }
    Value::Object(out)
}

/// Serialize a [`ContractRef`] into the same `Pool`-shaped JSON. The schemas
/// for `sign_authorization.market` and `revoke.target` declare them as `Pool`,
/// so the lowering must match that record shape — `ContractRef` carries no
/// `id` field, so the JSON object is `{ address?, label? }`.
pub(crate) fn contract_ref_json(contract: &ContractRef) -> Value {
    let mut out = Map::new();
    if let Some(address) = &contract.address {
        out.insert(ADDRESS.into(), Value::from(address.to_string()));
    }
    if let Some(label) = &contract.label {
        out.insert(LABEL.into(), Value::from(label.as_str()));
    }
    Value::Object(out)
}

pub(crate) const fn amount_mode_str(mode: &AmountMode) -> &'static str {
    match mode {
        AmountMode::Assets => "assets",
        AmountMode::Shares => "shares",
    }
}

pub(crate) const fn repay_kind_str(kind: &RepayKind) -> &'static str {
    match kind {
        RepayKind::DebtAsset => "debt_asset",
        RepayKind::AtokenDirect => "atoken_direct",
    }
}

pub(crate) const fn liquidation_kind_str(kind: &LiquidationKind) -> &'static str {
    match kind {
        LiquidationKind::PoolShare => "pool_share",
        LiquidationKind::ProtocolAbsorb => "protocol_absorb",
        LiquidationKind::Socializable => "socializable",
        LiquidationKind::SingleAsset => "single_asset",
    }
}

pub(crate) const fn liquidate_mode_str(mode: &LiquidateMode) -> &'static str {
    match mode {
        LiquidateMode::SingleStep => "single_step",
        LiquidateMode::Seize => "seize",
        LiquidateMode::Repay => "repay",
    }
}

pub(crate) const fn flash_loan_kind_str(kind: &FlashLoanKind) -> &'static str {
    match kind {
        FlashLoanKind::Multi => "multi",
        FlashLoanKind::Simple => "simple",
        FlashLoanKind::Morpho => "morpho",
    }
}

pub(crate) const fn authorization_scope_str(scope: &AuthorizationScope) -> &'static str {
    match scope {
        AuthorizationScope::All => "all",
        AuthorizationScope::DebtOnly => "debt_only",
        AuthorizationScope::ManagerRole => "manager_role",
        AuthorizationScope::PositionManagerRole => "position_manager_role",
    }
}

pub(crate) const fn sign_authorization_scope_str(scope: &SignAuthorizationScope) -> &'static str {
    match scope {
        SignAuthorizationScope::All => "all",
        SignAuthorizationScope::DebtOnly => "debt_only",
        SignAuthorizationScope::ManagerRole => "manager_role",
    }
}

pub(crate) const fn revoke_kind_str(kind: &RevokeKind) -> &'static str {
    match kind {
        RevokeKind::Erc20Allowance => "erc20_allowance",
        RevokeKind::CreditDelegation => "credit_delegation",
        RevokeKind::PositionManagerRole => "position_manager_role",
        RevokeKind::ManagerRole => "manager_role",
    }
}
