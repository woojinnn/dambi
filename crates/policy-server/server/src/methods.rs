//! Enrichment-method bodies executed server-side over a loaded `WalletState`.
//!
//! Each method is a pure `fn(state, params) -> Option<Value>`: it computes a
//! derived fact the extension materializes into the Cedar `context.custom`.
//! Returning `None` means "cannot serve" — the caller leaves the result absent
//! (fail-open for `optional` calls), never fabricating a value.

use serde_json::{json, Value};

use policy_state::pending::{AssetCommitment, PendingKind, PendingStatus};
use policy_state::primitives::U256;
use policy_state::WalletState;

/// Lowercase hex address from a param that is either a bare address string or an
/// object carrying an `address` field. Mirrors `handler::asset_address`.
fn asset_hex(v: &Value) -> Option<String> {
    let raw = match v {
        Value::String(s) => s.clone(),
        Value::Object(_) => v.get("address").and_then(Value::as_str)?.to_owned(),
        _ => return None,
    };
    Some(raw.to_lowercase())
}

/// Parse a `0x`-hex (or bare hex) `U256` amount, as the policy-rpc params carry it.
fn parse_hex_u256(v: &Value) -> Option<U256> {
    let s = v.as_str()?;
    U256::from_str_radix(s.trim_start_matches("0x"), 16).ok()
}

/// `intent.pending_cap_over_balance`: do the wallet's already-open signed orders
/// selling this token, plus the new order, commit more than the held balance?
///
/// Pure fold over the loaded `WalletState`. Sums `PermitCap.max_out` of every
/// active/partially-filled `OffchainLimitOrder` whose sell token matches the new
/// order's sell token, adds the new order's sell amount, and compares to the
/// synced balance of that token. Returns `None` (fail-open) when the params don't
/// parse or the sell token has no synced holding.
///
/// Params are exactly what the manifest projects (`{ chain_id, owner, action }`):
/// `action` is the lowered `SignIntentOrder` context, so the sell token lives at
/// `action.sell.key.address` and the amount at `action.sellAmount` (camelCase
/// `0x`-hex). A native sell (the token key carries no `address`) yields `None`,
/// the documented v1 limitation. `chain_id` is the CAIP-2 string, matching a
/// `TokenKey`'s `chain().as_str()`.
pub(crate) fn pending_cap_over_balance(state: &WalletState, params: &Value) -> Option<Value> {
    let chain = params.get("chain_id").and_then(Value::as_str)?;
    let action = params.get("action")?;
    let sell = action
        .get("sell")
        .and_then(|s| s.get("key"))
        .and_then(|k| k.get("address"))
        .and_then(asset_hex)?;
    let sell_amount = action.get("sellAmount").and_then(parse_hex_u256)?;

    let matches_sell = |k: &policy_state::token::TokenKey| -> bool {
        k.chain().as_str() == chain
            && k.contract().map(|a| format!("{a:#x}")).as_deref() == Some(sell.as_str())
    };

    let cap_sum = state
        .pending
        .iter()
        .filter_map(|p| match (&p.kind, &p.commitment, &p.lifecycle.status) {
            (
                PendingKind::OffchainLimitOrder { .. },
                AssetCommitment::PermitCap { token, max_out, .. },
                PendingStatus::Active | PendingStatus::PartiallyFilled,
            ) if matches_sell(&token.key) => Some(*max_out),
            _ => None,
        })
        .fold(U256::ZERO, U256::saturating_add);

    // First matching holding with a fungible balance (skips a non-fungible
    // holding — e.g. an ERC721 — that happens to share the contract address).
    let balance = state.tokens.values().find_map(|h| {
        matches_sell(&h.key)
            .then(|| h.balance.as_fungible())
            .flatten()
    })?;

    let over = cap_sum.saturating_add(sell_amount) > balance;
    Some(json!({ "capSumOverBalance": over }))
}

/// Lowercase hex of `action.<field>.key.address` (a lowered token ref). `None`
/// for a native/missing token (no `address`).
fn action_token_address(action: &Value, field: &str) -> Option<String> {
    action
        .get(field)
        .and_then(|t| t.get("key"))
        .and_then(|k| k.get("address"))
        .and_then(asset_hex)
}

/// `intent.near_duplicate_pending`: is the new signed order a near-duplicate of an
/// already-open one — same venue + sell token + buy token? Re-signing a "did it go
/// through?" order is common and double-fills. Returns `{ "duplicate": bool }`.
///
/// Params are the manifest's `{ chain_id, owner, action }`. Reads the venue name
/// (`action.venue.name`) and the sell/buy token addresses (`action.<>.key.address`)
/// and tests membership against the live `OffchainLimitOrder` set. Matches tokens
/// by `(chain_id, address)` — a native sell OR buy (no `address`) yields `None` →
/// fail-open (the native-leg limitation is wider than just the sell side). Both
/// legs are matched against the single top-level `chain_id`; correct for today's
/// same-chain `IntentVenue`s (a per-leg cross-chain match is a follow-up).
///
/// The live set is `Active | PartiallyFilled | Unknown`. `Unknown` ("venue did not
/// respond / reconciliation failed") is INCLUDED — unlike the cap method, where it
/// is excluded to avoid double-counting a possibly-failed order: for duplicate
/// detection the risk polarity is reversed, and an `Unknown` order is exactly the
/// "did it go through?" state where re-signing the same order is most likely.
pub(crate) fn near_duplicate_pending(state: &WalletState, params: &Value) -> Option<Value> {
    let chain = params.get("chain_id").and_then(Value::as_str)?;
    let action = params.get("action")?;
    let venue = action
        .get("venue")
        .and_then(|v| v.get("name"))
        .and_then(Value::as_str)?;
    let sell = action_token_address(action, "sell")?;
    let buy = action_token_address(action, "buy")?;

    let token_matches = |t: &policy_state::token::TokenRef, addr: &str| -> bool {
        t.key.chain().as_str() == chain
            && t.key.contract().map(|a| format!("{a:#x}")).as_deref() == Some(addr)
    };

    let duplicate = state.pending.iter().any(|p| {
        matches!(
            p.lifecycle.status,
            PendingStatus::Active | PendingStatus::PartiallyFilled | PendingStatus::Unknown
        ) && match &p.kind {
            PendingKind::OffchainLimitOrder {
                venue: pv,
                sell: psell,
                buy: pbuy,
                ..
            } => pv.name == venue && token_matches(psell, &sell) && token_matches(pbuy, &buy),
            _ => false,
        }
    });
    Some(json!({ "duplicate": duplicate }))
}

/// `intent.validity_horizon_sec`: seconds from now until the order's `validUntil`
/// deadline — a long horizon means a long-lived off-chain signature (blind-sign /
/// stale-fill risk). Params: `valid_until` (unix-seconds `Long`); an optional `now`
/// (unix seconds) overrides the wall clock for deterministic tests. Returns
/// `{ "horizonSec": Long }`, clamped to ≥ 0. State is unused (pure on params).
pub(crate) fn validity_horizon_sec(_state: &WalletState, params: &Value) -> Option<Value> {
    let valid_until = params.get("valid_until").and_then(Value::as_i64)?;
    let now = params
        .get("now")
        .and_then(Value::as_i64)
        .unwrap_or_else(unix_now);
    let horizon = (valid_until - now).max(0);
    Some(json!({ "horizonSec": horizon }))
}

/// Current unix time in seconds (wall clock).
fn unix_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_secs()).ok())
        .unwrap_or(0)
}

// ===========================================================================
// Tier A — bundled, pure, no external network call. These serve the
// compliance/reputation/token-verification policies that previously failed
// open. Each returns `Some(..)` whenever it can answer affirmatively; only
// unparseable params yield `None` (fail-open).
// ===========================================================================

/// `address.sanctions`: is the target address on the OFAC SDN crypto-address
/// list? Params: `{ address }` (a bare hex string or an object with `address`).
/// Returns `{ "sanctioned": bool }`. Case-insensitive on `params.address`. No
/// wallet state is consulted.
///
/// Backed by [`OFAC_SDN_ADDRESSES`], a STATIC v1 seed of the canonical,
/// publicly-known OFAC-sanctioned Ethereum addresses (the Tornado Cash pool /
/// router set plus a handful of well-known designations). This list is meant
/// to be expanded from the official U.S. Treasury SDN feed
/// (`sanctionssearch.ofac.treas.gov` / the `SDN_ENHANCED` data set); a periodic
/// sync job should replace this constant with the live feed.
pub(crate) fn address_sanctions(_state: &WalletState, params: &Value) -> Option<Value> {
    let addr = asset_hex(params.get("address")?)?;
    let sanctioned = OFAC_SDN_ADDRESSES.contains(&addr.as_str());
    Some(json!({ "sanctioned": sanctioned }))
}

/// `address.reputation`: is the target address a known malicious / scam /
/// drainer address? Params: `{ chain_id, address }`. Returns
/// `{ "flagged": bool }`. `flagged == true` iff the (lowercased) address is in
/// [`MALICIOUS_ADDRESSES`]; any other well-formed address returns
/// `{ "flagged": false }` (so the policy's `flagged == true` guard lets unknown
/// addresses pass). No wallet state is consulted.
///
/// [`MALICIOUS_ADDRESSES`] is a STATIC v1 seed of well-known drainer / scam
/// contract addresses, to be expanded from threat-intel feeds (e.g.
/// `ScamSniffer` / `Chainabuse` / community drainer denylists).
pub(crate) fn address_reputation(_state: &WalletState, params: &Value) -> Option<Value> {
    // `chain_id` is accepted for forward-compat (per-chain denylists) but the
    // v1 seed is mainnet-EVM and keyed on address alone.
    let addr = asset_hex(params.get("address")?)?;
    let flagged = MALICIOUS_ADDRESSES.contains(&addr.as_str());
    Some(json!({ "flagged": flagged }))
}

/// `token.metadata`: is the asset a verified/known token? Params:
/// `{ chain_id, asset }` (`asset` is an `AssetRef`: a hex string or an object
/// carrying `address`). Returns `{ "isVerified": bool }`. The policy fires when
/// `isVerified == false`, so an allowlist *miss* deliberately yields
/// `Some(false)` — unknown tokens are treated as unverified. `None` only when
/// `asset` is unparseable.
///
/// Resolution order:
/// 1. If the synced `WalletState` already holds this `(chain, contract)` token
///    AND its primitives came from a trusted, non-user provenance (an on-chain
///    view or the token registry — i.e. NOT `UserSupplied`), treat it as
///    verified. The state model carries no dedicated `verified` flag today, so
///    provenance is the best available trust signal on the holding.
/// 2. Otherwise fall back to [`VERIFIED_TOKENS`], a bundled allowlist of major
///    mainnet tokens (USDC/USDT/DAI/WETH/WBTC/...).
/// 3. Otherwise `Some(false)` (allowlist miss → unverified, the intended fire).
pub(crate) fn token_metadata(state: &WalletState, params: &Value) -> Option<Value> {
    let asset = asset_hex(params.get("asset")?)?;

    // (1) Trust a synced holding whose primitives are NOT user-supplied.
    let synced_verified = state.tokens.values().any(|h| {
        h.key.contract().map(|a| format!("{a:#x}")).as_deref() == Some(asset.as_str())
            && !matches!(h.primitives_source, policy_state::DataSource::UserSupplied)
    });

    // (2) Bundled allowlist fallback.
    let is_verified = synced_verified || VERIFIED_TOKENS.contains(&asset.as_str());
    Some(json!({ "isVerified": is_verified }))
}

// ===========================================================================
// Tier B — facts that require data NOT present in the synced `WalletState`.
// Each is a documented stub that returns `None` (fail-open) so its policy stays
// dormant rather than fabricating a value. The doc comment records the exact
// data source + integration point needed to implement it for real.
// ===========================================================================

/// `lending.health_factor` (STUB → `None`, fail-open). Params:
/// `{ chain_id, owner, venue, asset, amount }` → `{ "postActionHf": Decimal }`.
/// Serves: borrow-/withdraw-/disable-collateral-low-health-factor.
///
/// HOW TO IMPLEMENT: a correct post-action HF needs, for the owner's position
/// in `venue`, `HF = Σ(collateral_i_usd × liqThreshold_i) / Σ(debt_j_usd)`
/// recomputed after applying the action's delta to the relevant leg. The synced
/// `WalletState` carries `PositionKind::LendingAccount` with `collaterals`,
/// `debts`, and an *account-level* `health_factor`/`liquidation_threshold` — but
/// NOT the per-collateral liquidation thresholds NOR USD prices for the
/// collateral/debt legs (collateral aTokens are typically unpriced in `tokens`).
/// Without per-asset liq thresholds + prices the post-action HF cannot be
/// derived from state alone. To serve it either:
///
/// (a) extend `LendingAccount` to carry per-collateral `(token, amount,
/// liqThreshold, priceUsd)` rows (sync them via the venue's reserve data), then
/// compute HF here from `state.positions`; OR
///
/// (b) have the manifest pass the action's carried `userStateBefore` /
/// `reserveState` (Aave's `getUserAccountData` + per-reserve config) as params,
/// and compute the post-action HF purely from those params.
///
/// Until then this returns `None` (the policy stays fail-open / dormant).
pub(crate) fn lending_health_factor(_state: &WalletState, _params: &Value) -> Option<Value> {
    // Intentional fail-open: per-collateral liquidation thresholds + USD prices
    // for the lending legs are not present in WalletState. See doc comment.
    None
}

/// `address.activity` (STUB → `None`, fail-open). Params:
/// `{ chain_id, address }` → `{ "txCount": Long, "firstSeenTs": Long }`.
/// Serves: transfer-new-recipient-cooldown.
///
/// HOW TO IMPLEMENT: needs a chain indexer / archive RPC, not wallet state.
///
/// - `txCount` = `eth_getTransactionCount(address, "latest")` (outbound nonce)
///   — or, for total inbound+outbound activity, a tx count from a chain indexer
///   (`Etherscan` / a subgraph / `Dune`).
/// - `firstSeenTs` = block timestamp of the address's earliest transaction
///   (indexer "first-seen" / earliest-tx lookup).
///
/// Wire a chain-RPC + indexer fetcher into `policy-sync` and serve from there;
/// `WalletState` does not (and should not) track arbitrary counterparties' nonces.
pub(crate) fn address_activity(_state: &WalletState, _params: &Value) -> Option<Value> {
    // Intentional fail-open: recipient tx-count / first-seen require an external
    // indexer or archive RPC. See doc comment.
    None
}

/// `address.similarity` (STUB → `None`, fail-open). Params:
/// `{ chain_id, candidate }` → `{ "poisonCollision": bool }`.
/// Serves: transfer-address-poisoning.
///
/// Address-poisoning detection: the `candidate` recipient is visually similar
/// (shared first-4 + last-4 hex chars) to one of the wallet's KNOWN
/// counterparties, but is a *different* full address — the classic dust/
/// look-alike attack. The comparison itself is trivial; the missing input is the
/// set of known counterparties.
///
/// HOW TO IMPLEMENT: `WalletState` has no counterparty / contacts / prior-
/// recipient set today (no field tracks "addresses this wallet has sent to").
/// Add a `counterparties: Set<Address>` (or `contacts`) to `WalletState`,
/// populated from the wallet's outbound-transfer history during sync, then
/// implement here: for each known counterparty `k`, flag a collision when
/// `prefix4(candidate)==prefix4(k) && suffix4(candidate)==suffix4(k) &&
/// candidate != k`. Until that set exists this returns `None`.
pub(crate) fn address_similarity(_state: &WalletState, _params: &Value) -> Option<Value> {
    // Intentional fail-open: no known-counterparty set in WalletState to compare
    // the candidate against. See doc comment.
    None
}

/// `pool.liquidity` (STUB → `None`, fail-open). Params: `{ chain_id, venue }`
/// → `{ "vol24hUsd": Decimal }`. Serves: addliquidity-low-liquidity.
///
/// HOW TO IMPLEMENT: needs pool TVL / 24h-volume data, which is external market
/// data not in wallet state. Source from a DEX subgraph (Uniswap/Sushi
/// `poolDayDatas.volumeUSD`) or by reading the pool's on-chain reserves +
/// pricing them via the oracle. Wire that fetcher into `policy-sync` /
/// `policy-rpc` and serve from there. Until then this returns `None`.
pub(crate) fn pool_liquidity(_state: &WalletState, _params: &Value) -> Option<Value> {
    // Intentional fail-open: pool TVL / 24h volume is external market data, not
    // in WalletState. See doc comment.
    None
}

// ---------------------------------------------------------------------------
// Bundled seed data (v1). All addresses are lowercase hex, `0x`-prefixed, so
// they compare directly against `asset_hex(..)` output.
// ---------------------------------------------------------------------------

/// STATIC v1 seed of OFAC SDN-listed Ethereum addresses. Dominated by the
/// August-2022 Tornado Cash designation (mixer pools + router/proxy contracts)
/// plus a few other well-known designations. NOT exhaustive — expand from the
/// official U.S. Treasury SDN feed.
const OFAC_SDN_ADDRESSES: &[&str] = &[
    // --- Tornado Cash core: router / proxy ---
    "0x8589427373d6d84e98730d7795d8f6f8731fda16", // Tornado.Cash: Router (proxy)
    "0x722122df12d4e14e13ac3b6895a86e84145b6967", // Tornado.Cash: Proxy
    "0xd96f2b1c14db8458374d9aca76e26c3d18364307", // Tornado.Cash: deposit/withdraw helper
    // --- Tornado Cash ETH pools ---
    "0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc", // TC 0.1 ETH
    "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936", // TC 1 ETH
    "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf", // TC 10 ETH
    "0xa160cdab225685da1d56aa342ad8841c3b53f291", // TC 100 ETH
    // --- Tornado Cash stablecoin / token pools ---
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d", // TC 100 DAI
    "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3", // TC 100 DAI variant
    "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144", // TC 1000 DAI
    "0xf60dd140cff0b1b41a5d762971aef85a18a72e87", // TC 100000 DAI
    "0x22aaa7720ddd5388a3c0a3333430953c68f1849b", // TC cUSDC pool
    "0xba214c1c1928a32bffe790263e38b4af9bfcd659", // TC 100 cDAI
    "0xb1c8094b234dce6e03f10a5b673c1d8c69739a00", // TC USDC variant
    "0x2717c5e28cf931547b621a5dddb772ab6a35b701", // TC 1000 USDT
    "0x03893a7c7463ae47d46bc7f091665f1893656003", // TC USDC 5000 pool
    "0xca0840578f57fe71599d29375e16783424023357", // TC pool
    // --- other well-known OFAC designations ---
    "0x098b716b8aaf21512996dc57eb0615e2383e2f96", // Lazarus Group (Ronin bridge hacker)
    "0xa7e5d5a720f06526557c513402f2e6b5fa20b008", // Lazarus Group associated
    "0x35fb6f6db4fb05e6a4ce86f2c93691425626d4b1", // sanctioned address
    "0x7f367cc41522ce07553e823bf3be79a889debe1b", // Lazarus Group associated
    "0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a", // Blender.io-related
    "0x07687e702b410fa43f4cb4af7fa097918ffd2730", // Lazarus Group associated
    "0x9f4cda013e354b8fc285bf4b9a60460cee7f7ea9", // Lazarus Group associated
    "0xb6f5ec1a0a9cd1526536d3f0426c429529471f40", // sanctioned mixer-adjacent
    "0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c", // sanctioned address
];

/// STATIC v1 seed of known-malicious / scam / drainer Ethereum addresses.
/// Expand from threat-intel feeds (`ScamSniffer`, `Chainabuse`, drainer denylists).
const MALICIOUS_ADDRESSES: &[&str] = &[
    "0x0000000000000000000000000000000000000bad", // sentinel test entry
    "0x000000000000000000000000000000000000dead", // burn-as-drainer sentinel
    "0x6b75d8af000000e20b7a7ddf000ba900b4009a80", // Inferno Drainer-linked (example)
    "0x412f10aad96fd78da6736387e2c84931ac20313f", // known phishing drainer (example)
    "0x098b716b8aaf21512996dc57eb0615e2383e2f96", // overlaps sanctioned/Lazarus
];

/// STATIC v1 allowlist of verified major Ethereum-mainnet tokens. Expand from a
/// curated token list (e.g. `Uniswap` default list / `CoinGecko` verified set).
const VERIFIED_TOKENS: &[&str] = &[
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
    "0x514910771af9ca656af840dff83e8264ecf986ca", // LINK
    "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", // UNI
    "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // AAVE
    "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", // SHIB
    "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH (Lido)
    "0x4fabb145d64652a948d72533023f6e7a623c7c53", // BUSD
    "0x6982508145454ce325ddbe47a25d4ec3d2311933", // PEPE
];

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use serde_json::Value;

    use policy_state::pending::{
        AssetCommitment, OrderKind, PendingKind, PendingLifecycle, PendingStatus, PendingTx,
    };
    use policy_state::primitives::{Address, ChainId, Time, VenueRef, U256};
    use policy_state::token::{Balance, BaseCategory, TokenHolding, TokenKey, TokenKind, TokenRef};
    use policy_state::{DataSource, StateDelta, WalletId, WalletState};

    const SELL: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC
    const OTHER: &str = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"; // WETH

    fn key(addr: &str) -> TokenKey {
        TokenKey::Erc20 {
            chain: ChainId::ethereum_mainnet(),
            address: Address::from_str(addr).unwrap(),
        }
    }

    fn holding(addr: &str, balance: u64) -> TokenHolding {
        TokenHolding {
            key: key(addr),
            kind: TokenKind::Base {
                category: BaseCategory::Stable,
                peg_to: None,
            },
            symbol: "T".into(),
            decimals: 6,
            balance: Balance::fungible(U256::from(balance)),
            committed: Balance::zero_fungible(),
            approved_to: None,
            price_usd: None,
            metadata: None,
            value_usd: None,
            last_synced_at: Time::from_unix(0),
            primitives_source: DataSource::UserSupplied,
        }
    }

    /// An `OffchainLimitOrder` selling `sell_addr` with a `PermitCap` of `cap`.
    fn intent_pending(id: &str, sell_addr: &str, cap: u64, status: PendingStatus) -> PendingTx {
        let token = TokenRef {
            key: key(sell_addr),
        };
        PendingTx {
            id: id.into(),
            kind: PendingKind::OffchainLimitOrder {
                venue: VenueRef::new("one_inch_fusion"),
                sell: token.clone(),
                buy: TokenRef { key: key(OTHER) },
                sell_max: U256::from(cap),
                buy_min: U256::from(1u64),
                order_kind: OrderKind::Dutch,
            },
            commitment: AssetCommitment::PermitCap {
                token,
                spender: Address::ZERO,
                max_out: U256::from(cap),
            },
            fill_effect: Box::new(StateDelta::new()),
            lifecycle: PendingLifecycle {
                status,
                valid_until: None,
                nonce: None,
                on_chain_tx: None,
                raw_status: None,
            },
            sync: DataSource::UserSupplied,
            signed_at: Time::from_unix(0),
            signature_payload: Vec::new(),
        }
    }

    fn state(holdings: Vec<TokenHolding>, pendings: Vec<PendingTx>) -> WalletState {
        let mut s = WalletState::new(WalletId::new(Address::ZERO, [ChainId::ethereum_mainnet()]));
        for h in holdings {
            s.tokens.insert(h.key.clone(), h);
        }
        s.pending = pendings;
        s
    }

    /// The exact shape the manifest + lowering produce: `{chain_id, owner,
    /// action}` where `action` is the lowered `SignIntentOrder` (sell token nested
    /// at `action.sell.key.address`, amount at camelCase `action.sellAmount`).
    /// Mirrors `lower_token_ref`/`sign_intent_order::lower` in policy-engine.
    fn params(sell: &str, amount: u64) -> Value {
        serde_json::json!({
            "chain_id": "eip155:1",
            "owner": "0x0000000000000000000000000000000000000000",
            "action": {
                "sell": { "key": { "standard": "erc20", "chain": "eip155:1", "address": sell } },
                "sellAmount": format!("0x{amount:x}"),
            }
        })
    }

    fn over(state: &WalletState, p: &Value) -> Option<bool> {
        super::pending_cap_over_balance(state, p).map(|v| v["capSumOverBalance"].as_bool().unwrap())
    }

    #[test]
    fn under_balance_is_false() {
        let st = state(
            vec![holding(SELL, 100)],
            vec![intent_pending("a", SELL, 30, PendingStatus::Active)],
        );
        assert_eq!(over(&st, &params(SELL, 20)), Some(false));
    }

    #[test]
    fn cap_sum_plus_new_over_balance_is_true() {
        let st = state(
            vec![holding(SELL, 100)],
            vec![
                intent_pending("a", SELL, 80, PendingStatus::Active),
                intent_pending("b", SELL, 30, PendingStatus::PartiallyFilled),
            ],
        );
        assert_eq!(over(&st, &params(SELL, 5)), Some(true));
    }

    #[test]
    fn caps_on_other_sell_token_excluded() {
        let st = state(
            vec![holding(SELL, 100), holding(OTHER, 100)],
            vec![
                intent_pending("a", SELL, 10, PendingStatus::Active),
                intent_pending("b", OTHER, 90, PendingStatus::Active),
            ],
        );
        assert_eq!(over(&st, &params(SELL, 10)), Some(false));
    }

    #[test]
    fn terminal_and_non_intent_pendings_excluded() {
        let st = state(
            vec![holding(SELL, 100)],
            vec![intent_pending("a", SELL, 90, PendingStatus::Filled)],
        );
        assert_eq!(over(&st, &params(SELL, 20)), Some(false));
    }

    #[test]
    fn unknown_balance_is_none() {
        let st = state(vec![holding(OTHER, 100)], vec![]);
        assert_eq!(over(&st, &params(SELL, 20)), None);
    }

    #[test]
    fn unparseable_params_is_none() {
        let st = state(vec![holding(SELL, 100)], vec![]);
        // No `action` → cannot find the sell token/amount → fail-open.
        let bad = serde_json::json!({ "chain_id": "eip155:1" });
        assert!(super::pending_cap_over_balance(&st, &bad).is_none());
    }

    #[test]
    fn native_sell_token_is_none() {
        // A native sell (key has no `address`, only `standard:"native"`) cannot be
        // matched by (chain, contract) → None (documented v1 limitation).
        let st = state(vec![holding(SELL, 100)], vec![]);
        let native = serde_json::json!({
            "chain_id": "eip155:1",
            "action": {
                "sell": { "key": { "standard": "native", "chain": "eip155:1" } },
                "sellAmount": "0x14",
            }
        });
        assert!(super::pending_cap_over_balance(&st, &native).is_none());
    }

    #[test]
    fn saturating_add_does_not_panic_on_overflow() {
        let mut p = intent_pending("a", SELL, 0, PendingStatus::Active);
        if let AssetCommitment::PermitCap { max_out, .. } = &mut p.commitment {
            *max_out = U256::MAX;
        }
        let st = state(vec![holding(SELL, 100)], vec![p]);
        assert_eq!(over(&st, &params(SELL, 5)), Some(true));
    }

    // --- intent.near_duplicate_pending ---

    /// An active `OffchainLimitOrder` with a chosen venue / sell / buy.
    fn dup_pending(
        id: &str,
        venue_name: &str,
        sell: &str,
        buy: &str,
        status: PendingStatus,
    ) -> PendingTx {
        let mut p = intent_pending(id, sell, 1, status);
        if let PendingKind::OffchainLimitOrder {
            venue, buy: pbuy, ..
        } = &mut p.kind
        {
            *venue = VenueRef::new(venue_name);
            *pbuy = TokenRef { key: key(buy) };
        }
        p
    }

    /// Manifest-shaped params for the new order: `action.{venue.name, sell, buy}`.
    fn dup_params(venue: &str, sell: &str, buy: &str) -> Value {
        serde_json::json!({
            "chain_id": "eip155:1",
            "owner": "0x0000000000000000000000000000000000000000",
            "action": {
                "venue": { "name": venue },
                "sell": { "key": { "standard": "erc20", "chain": "eip155:1", "address": sell } },
                "buy": { "key": { "standard": "erc20", "chain": "eip155:1", "address": buy } },
                "sellAmount": "0x1",
                "validUntil": 2_000_000_000_i64,
            }
        })
    }

    fn dup(state: &WalletState, p: &Value) -> Option<bool> {
        super::near_duplicate_pending(state, p).map(|v| v["duplicate"].as_bool().unwrap())
    }

    #[test]
    fn same_venue_sell_buy_is_duplicate() {
        let st = state(
            vec![],
            vec![dup_pending(
                "a",
                "one_inch_fusion",
                SELL,
                OTHER,
                PendingStatus::Active,
            )],
        );
        assert_eq!(
            dup(&st, &dup_params("one_inch_fusion", SELL, OTHER)),
            Some(true)
        );
    }

    #[test]
    fn different_venue_is_not_duplicate() {
        let st = state(
            vec![],
            vec![dup_pending(
                "a",
                "cow_swap",
                SELL,
                OTHER,
                PendingStatus::Active,
            )],
        );
        assert_eq!(
            dup(&st, &dup_params("one_inch_fusion", SELL, OTHER)),
            Some(false)
        );
    }

    #[test]
    fn different_buy_is_not_duplicate() {
        let st = state(
            vec![],
            vec![dup_pending(
                "a",
                "one_inch_fusion",
                SELL,
                SELL,
                PendingStatus::Active,
            )],
        );
        assert_eq!(
            dup(&st, &dup_params("one_inch_fusion", SELL, OTHER)),
            Some(false)
        );
    }

    #[test]
    fn terminal_pending_is_not_duplicate() {
        let st = state(
            vec![],
            vec![dup_pending(
                "a",
                "one_inch_fusion",
                SELL,
                OTHER,
                PendingStatus::Filled,
            )],
        );
        assert_eq!(
            dup(&st, &dup_params("one_inch_fusion", SELL, OTHER)),
            Some(false)
        );
    }

    #[test]
    fn unknown_status_pending_is_duplicate() {
        // Unknown ("did it go through?" reconciliation failure) is the prime
        // re-sign candidate → must be in the live set for duplicate detection.
        let st = state(
            vec![],
            vec![dup_pending(
                "a",
                "one_inch_fusion",
                SELL,
                OTHER,
                PendingStatus::Unknown,
            )],
        );
        assert_eq!(
            dup(&st, &dup_params("one_inch_fusion", SELL, OTHER)),
            Some(true)
        );
    }

    #[test]
    fn no_open_orders_is_not_duplicate() {
        let st = state(vec![], vec![]);
        assert_eq!(
            dup(&st, &dup_params("one_inch_fusion", SELL, OTHER)),
            Some(false)
        );
    }

    #[test]
    fn near_duplicate_unparseable_action_is_none() {
        let st = state(vec![], vec![]);
        assert!(
            super::near_duplicate_pending(&st, &serde_json::json!({ "chain_id": "eip155:1" }))
                .is_none()
        );
    }

    // --- intent.validity_horizon_sec ---

    fn horizon(valid_until: i64, now: i64) -> Option<i64> {
        let st = state(vec![], vec![]);
        let p = serde_json::json!({ "valid_until": valid_until, "now": now });
        super::validity_horizon_sec(&st, &p).map(|v| v["horizonSec"].as_i64().unwrap())
    }

    #[test]
    fn horizon_is_valid_until_minus_now() {
        assert_eq!(horizon(5000, 1000), Some(4000));
    }

    #[test]
    fn horizon_clamped_to_zero_when_already_past() {
        assert_eq!(horizon(1000, 5000), Some(0));
    }

    #[test]
    fn horizon_missing_valid_until_is_none() {
        let st = state(vec![], vec![]);
        assert!(super::validity_horizon_sec(&st, &serde_json::json!({ "now": 1000 })).is_none());
    }

    // --- address.sanctions (Tier A) ---

    fn sanctioned(addr: &str) -> Option<bool> {
        let st = state(vec![], vec![]);
        super::address_sanctions(&st, &serde_json::json!({ "address": addr }))
            .map(|v| v["sanctioned"].as_bool().unwrap())
    }

    #[test]
    fn sanctions_hit_for_tornado_cash_pool() {
        // TC 100 ETH pool — on the OFAC SDN seed.
        assert_eq!(
            sanctioned("0xa160cdab225685da1d56aa342ad8841c3b53f291"),
            Some(true)
        );
    }

    #[test]
    fn sanctions_hit_is_case_insensitive() {
        assert_eq!(
            sanctioned("0xA160CDAB225685DA1D56AA342AD8841C3B53F291"),
            Some(true)
        );
    }

    #[test]
    fn sanctions_miss_for_clean_address() {
        assert_eq!(sanctioned(SELL), Some(false)); // USDC contract — not sanctioned
    }

    #[test]
    fn sanctions_accepts_object_address_param() {
        // The manifest may project an AssetRef-shaped object carrying `address`.
        let st = state(vec![], vec![]);
        let p = serde_json::json!({
            "address": { "address": "0xa160cdab225685da1d56aa342ad8841c3b53f291" }
        });
        assert_eq!(
            super::address_sanctions(&st, &p).map(|v| v["sanctioned"].as_bool().unwrap()),
            Some(true)
        );
    }

    #[test]
    fn sanctions_missing_address_is_none() {
        let st = state(vec![], vec![]);
        assert!(super::address_sanctions(&st, &serde_json::json!({})).is_none());
    }

    // --- address.reputation (Tier A) ---

    fn flagged(addr: &str) -> Option<bool> {
        let st = state(vec![], vec![]);
        super::address_reputation(
            &st,
            &serde_json::json!({ "chain_id": 1, "address": addr }),
        )
        .map(|v| v["flagged"].as_bool().unwrap())
    }

    #[test]
    fn reputation_hit_for_known_drainer() {
        assert_eq!(
            flagged("0x412f10aad96fd78da6736387e2c84931ac20313f"),
            Some(true)
        );
    }

    #[test]
    fn reputation_miss_returns_some_false() {
        // Unknown but well-formed address → Some(false) so the policy's
        // `flagged == true` guard lets it pass.
        assert_eq!(flagged(SELL), Some(false));
    }

    #[test]
    fn reputation_missing_address_is_none() {
        let st = state(vec![], vec![]);
        assert!(super::address_reputation(&st, &serde_json::json!({ "chain_id": 1 })).is_none());
    }

    // --- token.metadata (Tier A) ---

    fn verified_via_allowlist(asset: &str) -> Option<bool> {
        let st = state(vec![], vec![]);
        super::token_metadata(
            &st,
            &serde_json::json!({ "chain_id": 1, "asset": asset }),
        )
        .map(|v| v["isVerified"].as_bool().unwrap())
    }

    #[test]
    fn token_metadata_allowlisted_is_verified() {
        // USDC is on the bundled verified-token allowlist.
        assert_eq!(verified_via_allowlist(SELL), Some(true));
    }

    #[test]
    fn token_metadata_unknown_token_is_unverified() {
        // An unknown contract: allowlist miss + no synced holding → Some(false),
        // which is the intended firing condition for the unverified-token policy.
        assert_eq!(
            verified_via_allowlist("0x000000000000000000000000000000000000c0de"),
            Some(false)
        );
    }

    #[test]
    fn token_metadata_trusts_synced_onchain_holding() {
        // A holding whose primitives are NOT user-supplied is treated as verified
        // even when its contract isn't on the bundled allowlist.
        let unknown = "0x000000000000000000000000000000000000c0de";
        let mut h = holding(unknown, 1);
        h.primitives_source = policy_state::DataSource::OnchainView {
            chain: policy_state::ChainId::ethereum_mainnet(),
            contract: policy_state::Address::from_str(unknown).unwrap(),
            function: "balanceOf(address)".into(),
            decoder_id: "erc20_balance".into(),
        };
        let st = state(vec![h], vec![]);
        let out = super::token_metadata(
            &st,
            &serde_json::json!({ "chain_id": 1, "asset": unknown }),
        );
        assert_eq!(out.map(|v| v["isVerified"].as_bool().unwrap()), Some(true));
    }

    #[test]
    fn token_metadata_user_supplied_holding_falls_back_to_allowlist() {
        // The default `holding(..)` helper uses `DataSource::UserSupplied`, which
        // is NOT trusted; an unknown user-supplied token stays unverified.
        let unknown = "0x000000000000000000000000000000000000c0de";
        let st = state(vec![holding(unknown, 1)], vec![]);
        let out = super::token_metadata(
            &st,
            &serde_json::json!({ "chain_id": 1, "asset": unknown }),
        );
        assert_eq!(out.map(|v| v["isVerified"].as_bool().unwrap()), Some(false));
    }

    #[test]
    fn token_metadata_unparseable_asset_is_none() {
        let st = state(vec![], vec![]);
        // `asset` is a number, not a string/object → cannot resolve → None.
        assert!(super::token_metadata(&st, &serde_json::json!({ "asset": 42 })).is_none());
    }

    // --- Tier B stubs are fail-open: they must return `None` ---

    #[test]
    fn tier_b_stubs_fail_open() {
        let st = state(vec![], vec![]);
        let p = serde_json::json!({ "chain_id": 1, "address": SELL, "candidate": SELL });
        assert!(super::lending_health_factor(&st, &p).is_none());
        assert!(super::address_activity(&st, &p).is_none());
        assert!(super::address_similarity(&st, &p).is_none());
        assert!(super::pool_liquidity(&st, &p).is_none());
    }
}
