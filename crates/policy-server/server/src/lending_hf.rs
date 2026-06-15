//! `lending.health_factor` enrichment — projected **post-action** health factor
//! of a lending position, read on-chain at request time.
//!
//! This is a **conservative closed-form estimate, NOT a transaction simulation**:
//! read the borrower's current aggregate state via `Pool.getUserAccountData`, then
//! apply the pending borrow/withdraw delta. Borrow is exact from the aggregate
//! (only debt grows, the liquidation-threshold mix is unchanged); withdraw keeps
//! the aggregate threshold fixed (exact for a single/homogeneous collateral,
//! slightly optimistic for mixed — absorbed by the policy's 1.5 buffer + warn
//! semantics + the dormancy contract below).
//!
//! **Dormancy contract (never fabricate an HF).** Any uncertainty — unsupported
//! venue/chain, a reverted/empty read, an unparseable amount — yields `None`, so
//! the `postActionHf` field is simply absent. The catalog policy's
//! `context.custom has postActionHf` guard then makes it inert (never a false
//! verdict from a guessed HF).
//!
//! **Extension = add an adapter.** [`LendingHealthAdapter`] is the per-protocol
//! seam; the shared HF math ([`post_action_hf`]), the dispatch fn
//! ([`lending_health_factor`]), and the [`OnchainView`] I/O seam are
//! protocol-agnostic. Aave-shaped forks (Spark, …) need addresses only.

use async_trait::async_trait;
use serde_json::{json, Value};

use alloy_primitives::keccak256;
use policy_state::U256;

use crate::handler::{asset_address, chain_id_to_eip155_num};

// ---------------------------------------------------------------------------
// I/O seam
// ---------------------------------------------------------------------------

/// A single `eth_call` returning raw ABI returndata bytes, or `None` on any
/// failure (RPC unconfigured / off-mainnet / revert / timeout). The production
/// impl (`RpcOnchainView`, app.rs) issues a raw JSON-RPC `eth_call`, mirroring
/// `ChainalysisSanctionsOracle`; tests inject a canned-response fake. Keeping the
/// seam protocol-agnostic (raw call) lets each adapter build its own calldata and
/// decode its own returndata, so a new protocol is "add an adapter", not "extend
/// the trait".
#[async_trait]
pub trait OnchainView: Send + Sync {
    /// `eth_call` `to` (0x-hex contract) with `data` (calldata bytes) on
    /// `chain_id`; returns the returndata bytes, or `None` (fail-open).
    async fn eth_call(&self, chain_id: i64, to: &str, data: &[u8]) -> Option<Vec<u8>>;

    /// Issue `calls` (`(to, calldata)` pairs) as ONE batched round-trip where the
    /// impl supports it. Returns one slot per input call, **in order**:
    /// `Some(returndata)` on success, `None` for a per-call revert/empty result (so
    /// one bad leg never sinks the batch — the *adapter* decides whether a given
    /// `None` is fatal). The outer `None` means a whole-batch transport failure (RPC
    /// unconfigured / off-mainnet).
    ///
    /// The default is a sequential fallback over [`Self::eth_call`] (used by the test
    /// fakes and [`NoOnchain`]); the production `RpcOnchainView` (app.rs) overrides it
    /// with a single Multicall3 `aggregate3`. That collapses an N-collateral Comet
    /// enumeration from ~`3N+2` sequential `eth_call`s (which, at ~9 mainnet
    /// collaterals × remote-RPC latency, approaches the 8 s hard timeout → dormancy)
    /// down to three batched rounds.
    async fn eth_call_batch(
        &self,
        chain_id: i64,
        calls: &[(String, Vec<u8>)],
    ) -> Option<Vec<Option<Vec<u8>>>> {
        let mut out = Vec::with_capacity(calls.len());
        for (to, data) in calls {
            out.push(self.eth_call(chain_id, to, data).await);
        }
        Some(out)
    }
}

/// An [`OnchainView`] that reads nothing (always `None`) — the safe default when
/// no RPC is configured, and the unit-test baseline. Mirrors `NoEnrichment`: the
/// optional `lending.health_factor` call fail-opens (policy stays dormant).
pub struct NoOnchain;

#[async_trait]
impl OnchainView for NoOnchain {
    async fn eth_call(&self, _chain_id: i64, _to: &str, _data: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/// Direction of the pending action — borrow grows debt, withdraw shrinks
/// collateral. Parsed from the `action_kind` param (`$.action.tag`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionKind {
    /// Borrowing `amount` of `asset` (debt increases).
    Borrow,
    /// Withdrawing `amount` of `asset` collateral (collateral decreases).
    Withdraw,
}

/// The parsed `lending.health_factor` params (manifest-wired, see
/// `_methods/lending.health_factor.md`).
#[derive(Clone, Debug)]
pub struct HfParams {
    /// EIP-155 chain id (advisory; v1 reads mainnet only).
    pub chain_id: i64,
    /// Position owner (`$.root.from`), 0x-hex lowercased.
    pub owner: String,
    /// `$.action.venue` (a `LendingVenue` JSON object).
    pub venue: Value,
    /// Borrowed/withdrawn asset address (0x-hex lowercased).
    pub asset_addr: String,
    /// Amount in the asset's smallest units; `U256::MAX` = max (withdraw-all).
    pub amount: U256,
    /// Borrow vs withdraw.
    pub kind: ActionKind,
}

impl HfParams {
    /// Parse from the enrichment `params` JSON. `None` on any missing/malformed
    /// field (→ dormancy).
    #[must_use]
    pub fn parse(params: &Value) -> Option<Self> {
        let chain_id = params.get("chain_id").map_or(1, chain_id_to_eip155_num);
        let owner = params.get("owner").and_then(asset_address)?;
        let venue = params.get("venue")?.clone();
        // `$.action.asset` lowers to a TokenRef `{ key: { standard, chain, address } }`
        // (lower_token_ref), so dig into `key.address` — NOT the flat `{ address }`
        // that `asset_address` expects.
        let asset_addr = token_ref_address(params.get("asset")?)?;
        let amount_raw = params.get("amount").and_then(Value::as_str)?;
        let amount = U256::from_str_radix(amount_raw.trim_start_matches("0x"), 16).ok()?;
        let kind = match params.get("action_kind").and_then(Value::as_str)? {
            "borrow" => ActionKind::Borrow,
            "withdraw" => ActionKind::Withdraw,
            _ => return None,
        };
        Some(Self {
            chain_id,
            owner,
            venue,
            asset_addr,
            amount,
            kind,
        })
    }
}

// ---------------------------------------------------------------------------
// Normalized position + shared HF math (protocol-agnostic)
// ---------------------------------------------------------------------------

/// Every protocol-family adapter reduces its on-chain read + the pending action
/// to this. `*_base` are in the protocol's base currency (Aave: USD, 8 decimals).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NormalizedPosition {
    /// Post-action total collateral, base currency.
    pub collateral_base: f64,
    /// Post-action total debt, base currency.
    pub debt_base: f64,
    /// Weighted liquidation threshold, basis points.
    pub liq_threshold_bps: u32,
    /// Pre-action HF (authoritative, for logging) — `None` when not meaningful.
    pub current_hf: Option<f64>,
    /// Current loan-to-value, basis points (for logging).
    pub ltv_bps: Option<u32>,
}

/// `HF` returned for a zero-debt position (mathematically infinite ⇒ safe). 4dp to
/// match the Cedar `decimal(...)` comparison scale.
const HF_SENTINEL: &str = "999999.0000";

/// Shared post-action HF closed form: `(collateral_base × LT) / debt_base`,
/// formatted to 4 decimals (Cedar `decimal("1.5000")` scale). Zero debt ⇒
/// the `HF_SENTINEL`. f64 scale (warn heuristic; mirrors `live/calc.rs::aave_hf`).
#[must_use]
pub fn post_action_hf(pos: &NormalizedPosition) -> String {
    if pos.debt_base <= 0.0 {
        return HF_SENTINEL.to_owned();
    }
    let lt = f64::from(pos.liq_threshold_bps) / 10_000.0;
    let hf = (pos.collateral_base * lt) / pos.debt_base;
    format!("{hf:.4}")
}

// ---------------------------------------------------------------------------
// Adapter seam
// ---------------------------------------------------------------------------

/// One per protocol-family — the extension point: **add a protocol = add an
/// impl**. `evaluate` owns its on-chain reads (via the [`OnchainView`] seam, so it
/// can chain dependent reads / enumerate collaterals as the protocol needs) and
/// returns the post-action [`NormalizedPosition`]; the shared [`post_action_hf`]
/// turns that into the HF. `None` anywhere ⇒ dormant (never a fabricated HF).
#[async_trait]
pub trait LendingHealthAdapter: Send + Sync {
    /// Does this adapter handle the action's `$.action.venue`?
    fn matches(&self, venue: &Value) -> bool;
    /// Read the borrower's on-chain state and apply the pending borrow/withdraw
    /// delta. `None` ⇒ dormant.
    async fn evaluate(&self, p: &HfParams, onchain: &dyn OnchainView)
        -> Option<NormalizedPosition>;
}

/// Aave V3 mainnet **Core** market `AaveOracle` (`getAssetPrice`). v1 is
/// mainnet-only; the Pool address comes from the action venue. Source: bgd-labs
/// aave-address-book `AaveV3Ethereum.ORACLE`.
const AAVE_ORACLE_MAINNET: &str = "0x54586be62e3c3580375ae3723c145253060ca0c2";

/// Aave V3 (and same-read-ABI forks, e.g. Spark). Reads three views — borrower
/// account data, asset price, asset decimals — and applies the borrow/withdraw
/// delta conservatively.
/// Morpho Blue singleton (Ethereum mainnet). All markets live inside this one
/// contract, keyed by a `bytes32` id. Source: morpho-org/morpho-blue.
const MORPHO_MAINNET: &str = "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb";

/// Aave V3 (and same-read-ABI forks, e.g. Spark). Reads `getUserAccountData` +
/// the asset price + decimals, then applies the borrow/withdraw delta in the
/// USD base currency.
struct AaveV3Adapter;

#[async_trait]
impl LendingHealthAdapter for AaveV3Adapter {
    fn matches(&self, venue: &Value) -> bool {
        matches!(
            venue.get("name").and_then(Value::as_str),
            Some("aave_v3" | "spark")
        )
    }

    async fn evaluate(
        &self,
        p: &HfParams,
        onchain: &dyn OnchainView,
    ) -> Option<NormalizedPosition> {
        if p.chain_id != 1 {
            return None; // v1: Ethereum mainnet only.
        }
        let pool = venue_pool(&p.venue)?;
        // All three reads are independent ⇒ one batched round.
        let batch = onchain
            .eth_call_batch(
                p.chain_id,
                &[
                    (
                        pool,
                        calldata("getUserAccountData(address)", &[address_word(&p.owner)?]),
                    ),
                    (
                        AAVE_ORACLE_MAINNET.to_owned(),
                        calldata("getAssetPrice(address)", &[address_word(&p.asset_addr)?]),
                    ),
                    (p.asset_addr.clone(), selector("decimals()").to_vec()),
                ],
            )
            .await?;
        aave_project(
            batch_at(&batch, 0)?,
            batch_at(&batch, 1)?,
            batch_at(&batch, 2)?,
            p,
        )
    }
}

/// Aave V3 post-action math: decoded `getUserAccountData` + asset price (USD 8dp
/// per whole token) + decimals ⇒ post-action triple. Borrow is exact from the
/// aggregate; withdraw keeps the aggregate threshold fixed (conservative).
fn aave_project(
    acct_b: &[u8],
    price_b: &[u8],
    dec_b: &[u8],
    p: &HfParams,
) -> Option<NormalizedPosition> {
    let acct = decode_user_account_data(acct_b)?;
    let price = decode_u256_word(price_b)?; // base (USD 8dp) per whole token
    let decimals = decode_decimals(dec_b)?;

    let delta_base = if p.kind == ActionKind::Withdraw && p.amount == U256::MAX {
        f64::INFINITY // withdraw-all ⇒ remove all collateral ⇒ HF → 0 (warn)
    } else {
        let scale = 10f64.powi(i32::try_from(decimals).ok()?);
        (u256_to_f64(p.amount)? / scale) * price
    };

    let (collateral_base, debt_base) = match p.kind {
        ActionKind::Borrow => (
            acct.total_collateral_base,
            acct.total_debt_base + delta_base,
        ),
        ActionKind::Withdraw => (
            (acct.total_collateral_base - delta_base).max(0.0),
            acct.total_debt_base,
        ),
    };

    let current_hf = {
        let h = acct.health_factor_wad / 1e18;
        (h < 1e6).then_some(h) // drop the uint256::MAX no-debt sentinel from the log field
    };

    Some(NormalizedPosition {
        collateral_base,
        debt_base,
        liq_threshold_bps: acct.liq_threshold_bps,
        current_hf,
        ltv_bps: Some(acct.ltv_bps),
    })
}

/// Morpho Blue — isolated single-collateral / single-debt markets. The market's
/// oracle is read FROM `idToMarketParams` (a dependent read), then `price()`,
/// `position`, and `market` give the borrower's state. The 1e36 oracle scale
/// absorbs token decimals, so no `decimals()` read is needed.
struct MorphoBlueAdapter;

#[async_trait]
impl LendingHealthAdapter for MorphoBlueAdapter {
    fn matches(&self, venue: &Value) -> bool {
        venue.get("name").and_then(Value::as_str) == Some("morpho_blue")
    }

    async fn evaluate(
        &self,
        p: &HfParams,
        onchain: &dyn OnchainView,
    ) -> Option<NormalizedPosition> {
        if p.chain_id != 1 {
            return None; // v1: Ethereum mainnet only.
        }
        let mid = bytes32_word(p.venue.get("marketIdStr")?.as_str()?)?;
        let owner = address_word(&p.owner)?;

        // idToMarketParams FIRST (a dependent read) — it carries the per-market oracle
        // address that the price() read in the next round needs, plus the collateral
        // token + lltv.
        let mp = onchain
            .eth_call(
                p.chain_id,
                MORPHO_MAINNET,
                &calldata("idToMarketParams(bytes32)", &[mid]),
            )
            .await?;
        let collat_token = word_addr(&mp, 1)?; // (loanToken, collateralToken, oracle, irm, lltv)
        let oracle = word_addr(&mp, 2)?;
        // lltv is WAD (1e18 = 100%); to bps = lltv / 1e14.
        let lltv_bps = u256_to_u32(word_u256(&mp, 4)? / U256::from(100_000_000_000_000_u128))?;

        // position / market / oracle.price() are now all resolvable ⇒ one batched round.
        let batch = onchain
            .eth_call_batch(
                p.chain_id,
                &[
                    (
                        MORPHO_MAINNET.to_owned(),
                        calldata("position(bytes32,address)", &[mid, owner]),
                    ),
                    (
                        MORPHO_MAINNET.to_owned(),
                        calldata("market(bytes32)", &[mid]),
                    ),
                    (oracle, selector("price()").to_vec()),
                ],
            )
            .await?;
        let price = u256_to_f64(word_u256(batch_at(&batch, 2)?, 0)?)?;

        morpho_project(
            batch_at(&batch, 0)?,
            batch_at(&batch, 1)?,
            &collat_token,
            price,
            lltv_bps,
            p,
        )
    }
}

/// Morpho Blue post-action math. `position` = (supplyShares, borrowShares,
/// collateral); `market` words [2]/[3] = total borrow assets/shares. Everything is
/// in loan-token raw units once collateral is scaled by `price/1e36`.
fn morpho_project(
    pos: &[u8],
    mkt: &[u8],
    collat_token: &str,
    oracle_price: f64,
    lltv_bps: u32,
    p: &HfParams,
) -> Option<NormalizedPosition> {
    let borrow_shares = u256_to_f64(word_u256(pos, 1)?)?;
    let collateral = u256_to_f64(word_u256(pos, 2)?)?;
    let tot_borrow_assets = u256_to_f64(word_u256(mkt, 2)?)?;
    let tot_borrow_shares = u256_to_f64(word_u256(mkt, 3)?)?;
    // SharesMathLib.toAssetsUp: shares*(totalAssets+1)/(totalShares+VIRTUAL_SHARES).
    let debt = if tot_borrow_shares <= 0.0 {
        0.0
    } else {
        (borrow_shares * (tot_borrow_assets + 1.0)) / (tot_borrow_shares + 1e6)
    };
    let collat_value = collateral * oracle_price / 1e36; // loan-token units

    let (collateral_base, debt_base) = match p.kind {
        ActionKind::Borrow => {
            let amt = if p.amount == U256::MAX {
                f64::INFINITY
            } else {
                u256_to_f64(p.amount)?
            };
            (collat_value, debt + amt)
        }
        ActionKind::Withdraw => {
            // Only a COLLATERAL withdraw is a borrower action; a loan-token withdraw is
            // a lender supply-redeem (HF irrelevant) ⇒ dormant.
            if p.asset_addr != collat_token {
                return None;
            }
            let amt = if p.amount == U256::MAX {
                collateral
            } else {
                u256_to_f64(p.amount)?
            };
            ((collateral - amt).max(0.0) * oracle_price / 1e36, debt)
        }
    };

    let current_hf = (debt > 0.0)
        .then(|| collat_value * f64::from(lltv_bps) / 1e4 / debt)
        .filter(|h| *h < 1e6);

    Some(NormalizedPosition {
        collateral_base,
        debt_base,
        liq_threshold_bps: lltv_bps,
        current_hf,
        ltv_bps: None,
    })
}

/// Compound III (Comet) — one market per base asset. No aggregate health view, so
/// the borrower's collateral is **enumerated** (`numAssets` → `getAssetInfo(i)` +
/// `collateralBalanceOf` + `getPrice`). The per-collateral `liquidateCollateralFactor`
/// is folded into a risk-adjusted collateral sum (so `liq_threshold_bps = 10000`).
/// Note: a Comet *base-asset* withdraw is economically a **borrow** (debt up);
/// a *collateral* withdraw reduces that leg.
struct CompoundV3Adapter;

#[async_trait]
impl LendingHealthAdapter for CompoundV3Adapter {
    fn matches(&self, venue: &Value) -> bool {
        venue.get("name").and_then(Value::as_str) == Some("compound_v3")
    }

    async fn evaluate(
        &self,
        p: &HfParams,
        onchain: &dyn OnchainView,
    ) -> Option<NormalizedPosition> {
        if p.chain_id != 1 {
            return None; // v1: Ethereum mainnet only.
        }
        let comet = p.venue.get("comet")?.as_str()?.to_lowercase();
        let base_asset = token_ref_address(p.venue.get("baseAsset")?)?;
        let owner_w = address_word(&p.owner)?;
        let c = p.chain_id;

        // ── Round A: the four base-market views, all independent. ────────────────
        let round_a = onchain
            .eth_call_batch(
                c,
                &[
                    (comet.clone(), selector("numAssets()").to_vec()),
                    (comet.clone(), selector("decimals()").to_vec()),
                    (
                        comet.clone(),
                        calldata("borrowBalanceOf(address)", &[owner_w]),
                    ),
                    (comet.clone(), selector("baseTokenPriceFeed()").to_vec()),
                ],
            )
            .await?;
        let num = u256_to_u32(word_u256(batch_at(&round_a, 0)?, 0)?)?;
        // Comet.decimals() == the base token's decimals.
        let base_decimals = u256_to_u32(word_u256(batch_at(&round_a, 1)?, 0)?)?;
        let base_scale = 10f64.powi(i32::try_from(base_decimals).ok()?);
        let borrow_base = u256_to_f64(word_u256(batch_at(&round_a, 2)?, 0)?)?;
        let base_feed = word_addr(batch_at(&round_a, 3)?, 0)?;

        // ── Round B: base price + every getAssetInfo(i) (all keyed off Round A). ──
        let mut b_calls: Vec<(String, Vec<u8>)> = Vec::with_capacity(1 + num as usize);
        b_calls.push((
            comet.clone(),
            calldata("getPrice(address)", &[address_word(&base_feed)?]),
        ));
        for i in 0..num {
            b_calls.push((
                comet.clone(),
                calldata("getAssetInfo(uint8)", &[u64_word(u64::from(i))]),
            ));
        }
        let round_b = onchain.eth_call_batch(c, &b_calls).await?;
        let base_price = u256_to_f64(word_u256(batch_at(&round_b, 0)?, 0)?)?;
        let mut debt_usd = borrow_base / base_scale * base_price / 1e8;

        // AssetInfo: (offset, asset, priceFeed, scale, borrowCF, liquidateCF, …).
        let mut infos: Vec<(String, String, f64, f64)> = Vec::with_capacity(num as usize);
        for i in 0..num as usize {
            let info = batch_at(&round_b, 1 + i)?;
            infos.push((
                word_addr(info, 1)?,               // asset
                word_addr(info, 2)?,               // priceFeed
                u256_to_f64(word_u256(info, 3)?)?, // scale
                u256_to_f64(word_u256(info, 5)?)?, // liquidateCF
            ));
        }

        // ── Round C: per-collateral balance + its feed price (keyed off Round B). ─
        let mut c_calls: Vec<(String, Vec<u8>)> = Vec::with_capacity(infos.len() * 2);
        for (asset, price_feed, _, _) in &infos {
            c_calls.push((
                comet.clone(),
                calldata(
                    "collateralBalanceOf(address,address)",
                    &[owner_w, address_word(asset)?],
                ),
            ));
            c_calls.push((
                comet.clone(),
                calldata("getPrice(address)", &[address_word(price_feed)?]),
            ));
        }
        let round_c = onchain.eth_call_batch(c, &c_calls).await?;

        // Enumerate collaterals → risk-adjusted USD (price 8dp, factor 1e18).
        let mut risk_collateral_usd = 0.0_f64;
        let mut wd_collateral_delta = 0.0_f64;
        for (idx, (asset, _, scale, liq_cf)) in infos.iter().enumerate() {
            let bal = u256_to_f64(word_u256(batch_at(&round_c, idx * 2)?, 0)?)?;
            if bal <= 0.0 {
                continue; // zero-balance ⇒ its price slot is irrelevant (never fatal)
            }
            // bal > 0 ⇒ a missing price IS fatal (dormant), matching the sequential path.
            let price = u256_to_f64(word_u256(batch_at(&round_c, idx * 2 + 1)?, 0)?)?;
            let value_usd = bal / scale * price / 1e8;
            risk_collateral_usd += value_usd * liq_cf / 1e18;
            if p.kind == ActionKind::Withdraw && *asset == p.asset_addr {
                let wd_amt = if p.amount == U256::MAX {
                    bal
                } else {
                    u256_to_f64(p.amount)?
                };
                wd_collateral_delta = (wd_amt / scale * price / 1e8) * liq_cf / 1e18;
            }
        }

        // Post-action delta.
        let base_amount_usd = || -> Option<f64> {
            if p.amount == U256::MAX {
                Some(f64::INFINITY)
            } else {
                Some(u256_to_f64(p.amount)? / base_scale * base_price / 1e8)
            }
        };
        match p.kind {
            // A Comet base-asset withdraw IS a borrow; an explicit borrow likewise grows debt.
            ActionKind::Borrow => debt_usd += base_amount_usd()?,
            ActionKind::Withdraw if p.asset_addr == base_asset => debt_usd += base_amount_usd()?,
            ActionKind::Withdraw => {
                risk_collateral_usd = (risk_collateral_usd - wd_collateral_delta).max(0.0);
            }
        }

        let current_hf = (debt_usd > 0.0)
            .then(|| risk_collateral_usd / debt_usd)
            .filter(|h| *h < 1e6);
        Some(NormalizedPosition {
            collateral_base: risk_collateral_usd,
            debt_base: debt_usd,
            liq_threshold_bps: 10_000, // liquidation factor already folded into the collateral sum
            current_hf,
            ltv_bps: None,
        })
    }
}

/// The registered adapters. Add a protocol = add a `Box::new(...)` here.
/// (Aave V3 + Spark via one impl; Morpho Blue; Compound III / Comet.)
fn resolve_adapter(venue: &Value) -> Option<Box<dyn LendingHealthAdapter>> {
    let adapters: [Box<dyn LendingHealthAdapter>; 3] = [
        Box::new(AaveV3Adapter),
        Box::new(MorphoBlueAdapter),
        Box::new(CompoundV3Adapter),
    ];
    adapters.into_iter().find(|a| a.matches(venue))
}

/// `LendingVenue::AaveV3 { pool }` carries the Pool address inline.
fn venue_pool(venue: &Value) -> Option<String> {
    Some(venue.get("pool")?.as_str()?.to_lowercase())
}

/// Extract the 0x-hex address from a lowered `$.action.asset`. Production lowers a
/// `TokenRef` to `{ key: { standard, chain, address } }` (`lower_token_ref`); we
/// also accept a flat `{ address }` object or a bare string for robustness.
fn token_ref_address(v: &Value) -> Option<String> {
    if let Some(addr) = v
        .get("key")
        .and_then(|k| k.get("address"))
        .and_then(Value::as_str)
    {
        return Some(addr.to_lowercase());
    }
    if let Some(addr) = v.get("address").and_then(Value::as_str) {
        return Some(addr.to_lowercase());
    }
    v.as_str().map(str::to_lowercase)
}

// ---------------------------------------------------------------------------
// Dispatch fn (called from the `execute_call_specs` match arm)
// ---------------------------------------------------------------------------

/// Serve `lending.health_factor`: parse params → resolve the venue's adapter →
/// run its planned reads through `onchain` → project + compute HF. Returns
/// `{ postActionHf, currentHf?, ltv? }`; the manifest projects the `postActionHf`
/// leaf. `None` anywhere ⇒ the field is omitted (dormancy).
pub async fn lending_health_factor(params: &Value, onchain: &dyn OnchainView) -> Option<Value> {
    let p = HfParams::parse(params)?;
    let pos = resolve_adapter(&p.venue)?.evaluate(&p, onchain).await?;
    Some(json!({
        "postActionHf": post_action_hf(&pos),
        "currentHf": pos.current_hf.map(|h| format!("{h:.4}")),
        "ltv": pos.ltv_bps,
    }))
}

// ---------------------------------------------------------------------------
// ABI helpers + decoders
// ---------------------------------------------------------------------------

/// `Pool.getUserAccountData` return, decoded to the fields the HF math needs.
#[derive(Clone, Copy, Debug, PartialEq)]
struct AaveAccountData {
    total_collateral_base: f64,
    total_debt_base: f64,
    liq_threshold_bps: u32,
    ltv_bps: u32,
    health_factor_wad: f64,
}

/// 4-byte selector = `keccak256(signature)[..4]`.
fn selector(sig: &str) -> [u8; 4] {
    let h = keccak256(sig.as_bytes());
    [h[0], h[1], h[2], h[3]]
}

/// 32-byte left-padded address word; `None` if malformed (non-20-byte / non-hex).
fn address_word(addr_0x: &str) -> Option<[u8; 32]> {
    let a = addr_0x.trim_start_matches("0x").to_lowercase();
    if a.len() != 40 || !a.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let bytes = hex::decode(&a).ok()?; // 20 bytes
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(&bytes);
    Some(w)
}

/// 32-byte word from a `bytes32` hex (e.g. a Morpho market id); `None` if malformed.
fn bytes32_word(hex32: &str) -> Option<[u8; 32]> {
    let h = hex32.trim_start_matches("0x");
    if h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let bytes = hex::decode(h).ok()?;
    let mut w = [0u8; 32];
    w.copy_from_slice(&bytes);
    Some(w)
}

/// 32-byte big-endian word for a small integer arg (e.g. `getAssetInfo(uint8)`).
fn u64_word(n: u64) -> [u8; 32] {
    U256::from(n).to_be_bytes::<32>()
}

/// `selector(sig) ++ words` calldata.
fn calldata(sig: &str, words: &[[u8; 32]]) -> Vec<u8> {
    let mut data = selector(sig).to_vec();
    for w in words {
        data.extend_from_slice(w);
    }
    data
}

/// The i-th slot of an [`OnchainView::eth_call_batch`] result as `&[u8]`. `None`
/// (⇒ dormancy at the caller's `?`) when the slot is absent or its per-call read
/// failed/reverted.
fn batch_at(batch: &[Option<Vec<u8>>], i: usize) -> Option<&[u8]> {
    batch.get(i)?.as_deref()
}

/// The i-th 32-byte returndata word as `U256`.
fn word_u256(data: &[u8], i: usize) -> Option<U256> {
    data.get(i * 32..i * 32 + 32).map(U256::from_be_slice)
}

/// The i-th returndata word's low 20 bytes as a lowercase 0x address.
fn word_addr(data: &[u8], i: usize) -> Option<String> {
    let w = data.get(i * 32..i * 32 + 32)?;
    Some(format!("0x{}", hex::encode(&w[12..32])))
}

/// Decode `getUserAccountData`'s 6×uint256 (mirrors sync `decode_aave_user_data`):
/// totalCollateralBase, totalDebtBase, availableBorrowsBase,
/// currentLiquidationThreshold, ltv, healthFactor.
fn decode_user_account_data(data: &[u8]) -> Option<AaveAccountData> {
    if data.len() < 192 {
        return None;
    }
    let word = |i: usize| U256::from_be_slice(&data[i * 32..i * 32 + 32]);
    Some(AaveAccountData {
        total_collateral_base: u256_to_f64(word(0))?,
        total_debt_base: u256_to_f64(word(1))?,
        liq_threshold_bps: u256_to_u32(word(3))?,
        ltv_bps: u256_to_u32(word(4))?,
        health_factor_wad: u256_to_f64(word(5))?,
    })
}

/// Decode a single `uint256` returndata word to f64 (e.g. `getAssetPrice`).
fn decode_u256_word(data: &[u8]) -> Option<f64> {
    if data.len() < 32 {
        return None;
    }
    u256_to_f64(U256::from_be_slice(&data[0..32]))
}

/// Decode an ERC-20 `decimals()` `uint8` (returned in a 32-byte word).
fn decode_decimals(data: &[u8]) -> Option<u32> {
    if data.len() < 32 {
        return None;
    }
    u256_to_u32(U256::from_be_slice(&data[0..32]))
}

/// `U256` → f64 via its decimal string (always parseable; f64 saturates for huge
/// values — fine for a warn-band heuristic).
fn u256_to_f64(x: U256) -> Option<f64> {
    x.to_string().parse::<f64>().ok()
}

/// `U256` → u32 (bps / decimals fit). `None` if it overflows u32.
fn u256_to_u32(x: U256) -> Option<u32> {
    x.to_string()
        .parse::<u64>()
        .ok()
        .and_then(|v| u32::try_from(v).ok())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const POOL: &str = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
    const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const OWNER: &str = "0x1111111111111111111111111111111111111111";
    /// Aave base-currency scale (USD, 8 decimals) — also the `getAssetPrice` scale.
    const E8: u128 = 100_000_000;

    fn word(x: u128) -> [u8; 32] {
        U256::from(x).to_be_bytes::<32>()
    }

    /// 6×uint256 `getUserAccountData` returndata.
    fn acct_bytes(collat: u128, debt: u128, liq_bps: u128, ltv_bps: u128, hf_wad: u128) -> Vec<u8> {
        let mut v = Vec::new();
        for w in [collat, debt, 0, liq_bps, ltv_bps, hf_wad] {
            v.extend_from_slice(&word(w));
        }
        v
    }

    /// A fake [`OnchainView`]. `with` keys by `(to, selector)` (one call per
    /// selector); `with_call` keys by `(to, full calldata)` for same-selector /
    /// different-arg calls (e.g. Comet's `getPrice` on two feeds). An exact-calldata
    /// match wins over a selector match.
    struct FakeOnchain {
        by_sel: HashMap<(String, [u8; 4]), Vec<u8>>,
        by_call: HashMap<(String, Vec<u8>), Vec<u8>>,
    }
    impl FakeOnchain {
        fn new() -> Self {
            Self {
                by_sel: HashMap::new(),
                by_call: HashMap::new(),
            }
        }
        fn with(mut self, to: &str, sig: &str, ret: Vec<u8>) -> Self {
            self.by_sel.insert((to.to_lowercase(), selector(sig)), ret);
            self
        }
        fn with_call(mut self, to: &str, calldata: Vec<u8>, ret: Vec<u8>) -> Self {
            self.by_call.insert((to.to_lowercase(), calldata), ret);
            self
        }
    }
    #[async_trait]
    impl OnchainView for FakeOnchain {
        async fn eth_call(&self, _chain_id: i64, to: &str, data: &[u8]) -> Option<Vec<u8>> {
            if let Some(r) = self.by_call.get(&(to.to_lowercase(), data.to_vec())) {
                return Some(r.clone());
            }
            let sel = [data[0], data[1], data[2], data[3]];
            self.by_sel.get(&(to.to_lowercase(), sel)).cloned()
        }
    }

    /// Params shaped exactly as the v2 planner resolves them: `chain_id` is CAIP-2
    /// (`$.root.chain_id`), `venue` is the lowered `{name,chain,pool}`, `asset` is a
    /// lowered `TokenRef` `{key:{standard,chain,address}}`, `amount` is a hex string,
    /// and `action_kind` is the manifest's literal constant.
    fn params(kind: &str, amount_hex: &str) -> Value {
        json!({
            "chain_id": "eip155:1",
            "owner": OWNER,
            "venue": { "name": "aave_v3", "chain": "eip155:1", "pool": POOL },
            "asset": { "key": { "standard": "erc20", "chain": "eip155:1", "address": USDC } },
            "amount": amount_hex,
            "action_kind": kind,
        })
    }

    #[test]
    fn selector_matches_known_erc20_decimals() {
        // 0x313ce567 is the canonical ERC-20 `decimals()` selector — validates the
        // keccak path; the other selectors compute through the same fn.
        assert_eq!(selector("decimals()"), [0x31, 0x3c, 0xe5, 0x67]);
    }

    #[test]
    fn post_action_hf_borrow_exact_and_low_and_zero_debt() {
        // 200 collateral, 100 debt, 80% LT → 1.6
        let healthy = NormalizedPosition {
            collateral_base: 200.0,
            debt_base: 100.0,
            liq_threshold_bps: 8000,
            current_hf: None,
            ltv_bps: None,
        };
        assert_eq!(post_action_hf(&healthy), "1.6000");
        // 120 collateral, 100 debt, 80% → 0.96 (< 1.5 ⇒ policy warns)
        let risky = NormalizedPosition {
            debt_base: 100.0,
            collateral_base: 120.0,
            ..healthy
        };
        assert_eq!(post_action_hf(&risky), "0.9600");
        // zero debt ⇒ sentinel
        let nodebt = NormalizedPosition {
            debt_base: 0.0,
            ..healthy
        };
        assert_eq!(post_action_hf(&nodebt), HF_SENTINEL);
    }

    #[test]
    fn decode_user_account_data_reads_six_words() {
        let bytes = acct_bytes(200, 100, 8000, 7500, 2_000_000_000_000_000_000);
        let a = decode_user_account_data(&bytes).unwrap();
        assert_eq!(a.total_collateral_base, 200.0);
        assert_eq!(a.total_debt_base, 100.0);
        assert_eq!(a.liq_threshold_bps, 8000);
        assert_eq!(a.ltv_bps, 7500);
        assert_eq!(a.health_factor_wad, 2e18);
        // short input ⇒ None (dormant, never a fabricated zero)
        assert!(decode_user_account_data(&[0u8; 100]).is_none());
    }

    #[test]
    fn params_parse_rejects_missing_and_bad_kind() {
        assert!(HfParams::parse(&params("borrow", "0x64")).is_some());
        let mut bad = params("borrow", "0x64");
        bad.as_object_mut().unwrap().remove("venue");
        assert!(HfParams::parse(&bad).is_none());
        assert!(HfParams::parse(&params("liquidate", "0x64")).is_none());
    }

    #[test]
    fn project_borrow_is_exact_from_aggregate() {
        // collateral 300e8, debt 100e8, LT 80%, price 1e8 (USDC=$1), decimals 6.
        // borrow 100 USDC (100e6) ⇒ +100e8 debt ⇒ debt 200e8 ⇒ HF=(300e8*0.8)/200e8=1.2
        let decoded = [
            acct_bytes(300 * E8, 100 * E8, 8000, 7500, 1_200_000_000_000_000_000),
            word(E8).to_vec(), // price $1 @ 8dp
            word(6).to_vec(),  // decimals
        ];
        let p = HfParams::parse(&params("borrow", "0x5f5e100")).unwrap(); // 100_000_000 = 100e6
        let pos = aave_project(&decoded[0], &decoded[1], &decoded[2], &p).unwrap();
        assert_eq!(post_action_hf(&pos), "1.2000");
    }

    #[test]
    fn project_withdraw_all_drops_collateral_to_zero() {
        let decoded = [
            acct_bytes(300 * E8, 100 * E8, 8000, 7500, 3_000_000_000_000_000_000),
            word(E8).to_vec(),
            word(6).to_vec(),
        ];
        // U256::MAX as hex
        let max_hex = format!("0x{}", "f".repeat(64));
        let p = HfParams::parse(&params("withdraw", &max_hex)).unwrap();
        let pos = aave_project(&decoded[0], &decoded[1], &decoded[2], &p).unwrap();
        assert_eq!(pos.collateral_base, 0.0);
        assert_eq!(post_action_hf(&pos), "0.0000");
    }

    #[test]
    fn adapter_matches_aave_and_spark_not_compound() {
        assert!(AaveV3Adapter.matches(&json!({ "name": "aave_v3", "pool": POOL })));
        assert!(AaveV3Adapter.matches(&json!({ "name": "spark", "pool": POOL })));
        assert!(!AaveV3Adapter.matches(&json!({ "name": "compound_v3" })));
    }

    #[tokio::test]
    async fn lending_health_factor_full_path_and_dormancy() {
        let onchain = FakeOnchain::new()
            .with(
                POOL,
                "getUserAccountData(address)",
                acct_bytes(300 * E8, 100 * E8, 8000, 7500, 1_200_000_000_000_000_000),
            )
            .with(
                AAVE_ORACLE_MAINNET,
                "getAssetPrice(address)",
                word(E8).to_vec(),
            )
            .with(USDC, "decimals()", word(6).to_vec());

        // borrow 100 USDC ⇒ HF 1.2
        let out = lending_health_factor(&params("borrow", "0x5f5e100"), &onchain)
            .await
            .unwrap();
        assert_eq!(out.get("postActionHf").unwrap().as_str().unwrap(), "1.2000");
        assert_eq!(out.get("ltv").unwrap().as_u64().unwrap(), 7500);

        // No RPC ⇒ dormant (field omitted, never fabricated).
        assert!(
            lending_health_factor(&params("borrow", "0x5f5e100"), &NoOnchain)
                .await
                .is_none()
        );

        // Unsupported venue ⇒ dormant.
        let mut comp = params("borrow", "0x5f5e100");
        comp["venue"] = json!({ "name": "compound_v3" });
        assert!(lending_health_factor(&comp, &onchain).await.is_none());
    }

    // ── Morpho Blue ─────────────────────────────────────────────────────────

    /// Concatenate 32-byte words into returndata.
    fn mwords(ws: &[[u8; 32]]) -> Vec<u8> {
        ws.iter().flat_map(|w| w.iter().copied()).collect()
    }

    fn morpho_params(kind: &str, asset: &str, market_id: &str, amount_hex: &str) -> Value {
        json!({
            "chain_id": "eip155:1",
            "owner": OWNER,
            "venue": { "name": "morpho_blue", "chain": "eip155:1", "marketIdStr": market_id },
            "asset": { "key": { "standard": "erc20", "chain": "eip155:1", "address": asset } },
            "amount": amount_hex,
            "action_kind": kind,
        })
    }

    #[tokio::test]
    async fn morpho_full_path_borrow_withdraw_collateral_and_lender_dormant() {
        const ORACLE: &str = "0x2222222222222222222222222222222222222222";
        const COLLAT: &str = "0x3333333333333333333333333333333333333333";
        const LOAN: &str = "0x4444444444444444444444444444444444444444";
        let mid = format!("0x{}", "ab".repeat(32)); // 32-byte market id

        let lltv: u128 = 86 * 10u128.pow(16); // 0.86e18 (86% → 8600 bps)
        let price: u128 = 10u128.pow(36); // 1e36 ⇒ collat_value == collateral
                                          // idToMarketParams: (loanToken, collateralToken, oracle, irm, lltv)
        let id_params = mwords(&[
            address_word(LOAN).unwrap(),
            address_word(COLLAT).unwrap(),
            address_word(ORACLE).unwrap(),
            word(0),
            word(lltv),
        ]);
        // position: (supplyShares, borrowShares=1e8, collateral=200)
        let position = mwords(&[word(0), word(100_000_000), word(200)]);
        // market: …, totalBorrowAssets=1000, totalBorrowShares=1e9 ⇒ toAssetsUp(1e8)=100 debt
        let market = mwords(&[
            word(0),
            word(0),
            word(1000),
            word(1_000_000_000),
            word(0),
            word(0),
        ]);

        let onchain = FakeOnchain::new()
            .with(MORPHO_MAINNET, "idToMarketParams(bytes32)", id_params)
            .with(MORPHO_MAINNET, "position(bytes32,address)", position)
            .with(MORPHO_MAINNET, "market(bytes32)", market)
            .with(ORACLE, "price()", word(price).to_vec());

        // borrow 50 (asset = loan) ⇒ debt 150 ⇒ HF = 200*0.86/150 = 1.1467
        let out = lending_health_factor(&morpho_params("borrow", LOAN, &mid, "0x32"), &onchain)
            .await
            .unwrap();
        assert_eq!(out["postActionHf"].as_str().unwrap(), "1.1467");

        // withdraw 100 collateral (asset = collateral) ⇒ collat 100 ⇒ HF = 100*0.86/100 = 0.8600
        let out2 =
            lending_health_factor(&morpho_params("withdraw", COLLAT, &mid, "0x64"), &onchain)
                .await
                .unwrap();
        assert_eq!(out2["postActionHf"].as_str().unwrap(), "0.8600");

        // lender supply-withdraw (asset = LOAN, kind=withdraw) ⇒ dormant (not a borrower action).
        assert!(
            lending_health_factor(&morpho_params("withdraw", LOAN, &mid, "0x64"), &onchain)
                .await
                .is_none()
        );

        // morpho_blue resolves to its adapter (not Aave).
        assert!(MorphoBlueAdapter.matches(&json!({ "name": "morpho_blue" })));
        assert!(!MorphoBlueAdapter.matches(&json!({ "name": "aave_v3" })));
    }

    // ── Compound III (Comet) ────────────────────────────────────────────────

    #[tokio::test]
    async fn comet_full_path_base_withdraw_is_borrow_and_collateral_withdraw() {
        const COMET: &str = "0xc3d688b66703497daa19211eedff47f25384cdc3";
        const WETH: &str = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
        const WETHFEED: &str = "0x5555555555555555555555555555555555555555";
        const BASEFEED: &str = "0x6666666666666666666666666666666666666666";

        // getAssetInfo(0): (offset, asset, priceFeed, scale, borrowCF, liquidateCF, …)
        let info0 = mwords(&[
            word(0),
            address_word(WETH).unwrap(),
            address_word(WETHFEED).unwrap(),
            word(10u128.pow(18)), // scale 1e18
            word(0),
            word(85 * 10u128.pow(16)), // liquidateCF 0.85e18
            word(0),
            word(0),
        ]);
        let onchain = FakeOnchain::new()
            .with(COMET, "numAssets()", word(1).to_vec())
            .with(COMET, "decimals()", word(6).to_vec()) // base (USDC) = 6dp
            .with(
                COMET,
                "borrowBalanceOf(address)",
                word(1_000_000_000).to_vec(),
            ) // 1000 USDC
            .with(
                COMET,
                "baseTokenPriceFeed()",
                mwords(&[address_word(BASEFEED).unwrap()]),
            )
            .with(COMET, "getAssetInfo(uint8)", info0) // only i=0
            .with(
                COMET,
                "collateralBalanceOf(address,address)",
                word(10u128.pow(18)).to_vec(),
            ) // 1 WETH
            // getPrice on two feeds shares a selector → distinguish by full calldata.
            .with_call(
                COMET,
                calldata("getPrice(address)", &[address_word(BASEFEED).unwrap()]),
                word(E8).to_vec(),
            ) // $1
            .with_call(
                COMET,
                calldata("getPrice(address)", &[address_word(WETHFEED).unwrap()]),
                word(2000 * E8).to_vec(),
            ); // $2000

        let venue = json!({
            "name": "compound_v3", "chain": "eip155:1", "comet": COMET,
            "baseAsset": { "key": { "standard": "erc20", "chain": "eip155:1", "address": USDC } }
        });
        let cparams = |asset: &str, amt: &str| {
            json!({
                "chain_id": "eip155:1", "owner": OWNER, "venue": venue.clone(),
                "asset": { "key": { "standard": "erc20", "chain": "eip155:1", "address": asset } },
                "amount": amt, "action_kind": "withdraw",
            })
        };

        // Current: risk collat = 1 WETH × $2000 × 0.85 = 1700; debt = 1000 ⇒ HF 1.7.
        // Base-asset withdraw 500 USDC = a BORROW ⇒ debt 1500 ⇒ HF 1700/1500 = 1.1333.
        let out = lending_health_factor(&cparams(USDC, "0x1dcd6500"), &onchain) // 500e6
            .await
            .unwrap();
        assert_eq!(out["postActionHf"].as_str().unwrap(), "1.1333");

        // Collateral withdraw-all WETH ⇒ risk collat 0 ⇒ HF 0/1000 = 0.0000.
        let max_hex = format!("0x{}", "f".repeat(64));
        let out2 = lending_health_factor(&cparams(WETH, &max_hex), &onchain)
            .await
            .unwrap();
        assert_eq!(out2["postActionHf"].as_str().unwrap(), "0.0000");

        assert!(CompoundV3Adapter.matches(&json!({ "name": "compound_v3" })));
        assert!(!CompoundV3Adapter.matches(&json!({ "name": "aave_v3" })));
    }

    /// An [`OnchainView`] wrapping [`FakeOnchain`] that RECORDS how reads are issued:
    /// the size of each `eth_call_batch` round, and any un-batched `eth_call`s. Each
    /// batch leg resolves through the inner fake's `eth_call` WITHOUT counting as an
    /// un-batched single — emulating the production Multicall3 round-trip.
    struct RecordingFake {
        inner: FakeOnchain,
        batch_rounds: std::sync::Mutex<Vec<usize>>,
        singles: std::sync::Mutex<usize>,
    }
    #[async_trait]
    impl OnchainView for RecordingFake {
        async fn eth_call(&self, chain_id: i64, to: &str, data: &[u8]) -> Option<Vec<u8>> {
            *self.singles.lock().unwrap() += 1;
            self.inner.eth_call(chain_id, to, data).await
        }
        async fn eth_call_batch(
            &self,
            chain_id: i64,
            calls: &[(String, Vec<u8>)],
        ) -> Option<Vec<Option<Vec<u8>>>> {
            self.batch_rounds.lock().unwrap().push(calls.len());
            let mut out = Vec::with_capacity(calls.len());
            for (to, data) in calls {
                out.push(self.inner.eth_call(chain_id, to, data).await);
            }
            Some(out)
        }
    }

    /// The whole point of the Multicall3 work: a Comet position with N collaterals is
    /// read in exactly THREE batched rounds (sizes `[4, 1+N, 2N]`), NOT `~3N+2`
    /// sequential `eth_call`s — so latency stays flat as N grows instead of marching
    /// toward the 8 s hard timeout. Uses N=2 with the 2nd collateral zero-balance to
    /// also prove a zero-balance leg's absent price does NOT trip dormancy, and that
    /// the HF is numerically identical to the un-batched path.
    #[tokio::test]
    async fn comet_reads_in_three_batched_rounds_independent_of_collateral_count() {
        const COMET: &str = "0xc3d688b66703497daa19211eedff47f25384cdc3";
        const WETH: &str = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
        const WBTC: &str = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
        const WETHFEED: &str = "0x5555555555555555555555555555555555555555";
        const WBTCFEED: &str = "0x7777777777777777777777777777777777777777";
        const BASEFEED: &str = "0x6666666666666666666666666666666666666666";

        let asset_info = |asset: &str, feed: &str, scale: u128, liq_cf: u128| {
            mwords(&[
                word(0),
                address_word(asset).unwrap(),
                address_word(feed).unwrap(),
                word(scale),
                word(0),
                word(liq_cf),
                word(0),
                word(0),
            ])
        };

        let fake = FakeOnchain::new()
            .with(COMET, "numAssets()", word(2).to_vec()) // ← two collaterals
            .with(COMET, "decimals()", word(6).to_vec())
            .with(
                COMET,
                "borrowBalanceOf(address)",
                word(1_000_000_000).to_vec(),
            ) // 1000 USDC
            .with(
                COMET,
                "baseTokenPriceFeed()",
                mwords(&[address_word(BASEFEED).unwrap()]),
            )
            // getAssetInfo(0)=WETH, getAssetInfo(1)=WBTC — same selector, distinct arg.
            .with_call(
                COMET,
                calldata("getAssetInfo(uint8)", &[u64_word(0)]),
                asset_info(WETH, WETHFEED, 10u128.pow(18), 85 * 10u128.pow(16)),
            )
            .with_call(
                COMET,
                calldata("getAssetInfo(uint8)", &[u64_word(1)]),
                asset_info(WBTC, WBTCFEED, 10u128.pow(8), 80 * 10u128.pow(16)),
            )
            // WETH balance 1e18 (1 WETH); WBTC balance 0 (held none).
            .with_call(
                COMET,
                calldata(
                    "collateralBalanceOf(address,address)",
                    &[address_word(OWNER).unwrap(), address_word(WETH).unwrap()],
                ),
                word(10u128.pow(18)).to_vec(),
            )
            .with_call(
                COMET,
                calldata(
                    "collateralBalanceOf(address,address)",
                    &[address_word(OWNER).unwrap(), address_word(WBTC).unwrap()],
                ),
                word(0).to_vec(),
            )
            .with_call(
                COMET,
                calldata("getPrice(address)", &[address_word(BASEFEED).unwrap()]),
                word(E8).to_vec(),
            )
            .with_call(
                COMET,
                calldata("getPrice(address)", &[address_word(WETHFEED).unwrap()]),
                word(2000 * E8).to_vec(),
            );
        // NOTE: getPrice(WBTCFEED) is deliberately ABSENT — round C still requests it
        // (we batch all legs), but WBTC's zero balance means its None price is skipped,
        // not treated as a missing required read.

        let rec = RecordingFake {
            inner: fake,
            batch_rounds: std::sync::Mutex::new(Vec::new()),
            singles: std::sync::Mutex::new(0),
        };

        let venue = json!({
            "name": "compound_v3", "chain": "eip155:1", "comet": COMET,
            "baseAsset": { "key": { "standard": "erc20", "chain": "eip155:1", "address": USDC } }
        });
        // Base-asset withdraw 500 USDC = a borrow ⇒ debt 1500; risk collat = 1 WETH ×
        // $2000 × 0.85 = 1700 (WBTC contributes 0) ⇒ HF = 1700/1500 = 1.1333 — exactly
        // the un-batched single-collateral result.
        let params = json!({
            "chain_id": "eip155:1", "owner": OWNER, "venue": venue,
            "asset": { "key": { "standard": "erc20", "chain": "eip155:1", "address": USDC } },
            "amount": "0x1dcd6500", "action_kind": "withdraw",
        });
        let out = lending_health_factor(&params, &rec).await.unwrap();
        assert_eq!(out["postActionHf"].as_str().unwrap(), "1.1333");

        // EXACTLY three batched rounds, sized [4, 1+N, 2N] for N=2 ⇒ [4, 3, 4].
        assert_eq!(*rec.batch_rounds.lock().unwrap(), vec![4, 3, 4]);
        // Comet issues ZERO un-batched single eth_calls — every read goes through the
        // batch seam (so production folds them into 3 Multicall3 round-trips).
        assert_eq!(*rec.singles.lock().unwrap(), 0);
    }
}
