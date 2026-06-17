//! axum application wiring — router, shared state, and HTTP adapters.
//! `/openapi.yaml`) sit outside the auth layer; everything else sits behind
//! `require_auth` middleware so a missing / invalid JWT is rejected before
//! the handler runs.
//! State is shared as a single `AppState` carrying the per-user DB router
//! (`MultiUserStore`) plus the cross-user identity DB (`GlobalDb`).

use axum::extract::{FromRef, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::from_fn;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Extension, Json, Router};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use policy_db::{GlobalDb, MultiUserStore};
use policy_state::U256;
use policy_sync::sources::fetchers::rpc::multicall::{
    decode_aggregate3_returndata, encode_aggregate3_calldata, Call3,
};
use policy_sync::{CoinGeckoClient, EtherscanClient, Orchestrator};

use crate::auth::{require_auth, AuthUser};
use crate::config::ServerConfig;
use crate::coordination::DynCoordinator;
use crate::dashboard_handlers;
use crate::dto::EvaluateRequest;
use crate::events::{EventBus, EventPublisher};
use crate::handler::{
    evaluate, ExternalEnrichment, HandlerError, NftFloorOracle, OutboundTransfer,
    PoolLiquidityFacts, PriceBook, PriceFact, SanctionsScreen, TokenMarketData, TokenSecurityFlags,
};
use crate::market_handlers;
use crate::read_handlers;
use crate::write_handlers;

/// Shared, cheaply-cloneable application state handed to every handler.
/// `multi_user` resolves one `PostgreSQL`-backed wallet store per authenticated
/// user. `global_db` is the cross-user identity DB (email ↔ `user_id`).
#[derive(Clone)]
pub struct AppState {
    pub multi_user: MultiUserStore,
    pub global_db: GlobalDb,
    pub event_bus: EventBus,
    /// Fanout boundary for server-originated events. The local publisher writes
    /// into `event_bus`; cloud deployments can replace it with Redis pub/sub.
    pub publisher: Arc<dyn EventPublisher>,
    /// Sync orchestrator — wraps the per-protocol fetchers wired from
    /// `dambi-sync.toml`. Shared across handlers so we don't re-open
    /// HTTP connection pools on every request.
    pub orchestrator: Arc<Orchestrator>,
    /// Optional Etherscan V2 client — `None` when `ETHERSCAN_API_KEY`
    /// isn't set. `POST /wallets` uses it (when present) to discover
    /// every ERC-20 a wallet holds; absent it falls back to native-only.
    pub etherscan: Option<EtherscanClient>,
    /// `CoinGecko` metadata client — always present (free tier works
    /// keyless). `POST /wallets` calls it after discovery to backfill
    /// logo / website / description on newly-seen tokens. Lookups are
    /// best-effort; `CoinGecko` outages don't block wallet adds.
    pub coingecko: CoinGeckoClient,
    /// Cross-replica lock/idempotency boundary.
    pub coordinator: DynCoordinator,
    /// TTL used for user-scoped sync locks.
    pub sync_lock_ttl: Duration,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Orchestrator / CoinGeckoClient aren't Debug.
        f.debug_struct("AppState")
            .field("multi_user", &self.multi_user)
            .field("global_db", &self.global_db)
            .field("event_bus", &self.event_bus)
            .field("publisher", &"<EventPublisher>")
            .field("orchestrator", &"<Orchestrator>")
            .field(
                "etherscan",
                &self.etherscan.as_ref().map(|_| "<EtherscanClient>"),
            )
            .field("coingecko", &"<CoinGeckoClient>")
            .field("coordinator", &"<Coordinator>")
            .field("sync_lock_ttl", &self.sync_lock_ttl)
            .finish()
    }
}

// Sub-state extractors so handlers can ask for just the piece they need.
impl FromRef<AppState> for MultiUserStore {
    fn from_ref(s: &AppState) -> Self {
        s.multi_user.clone()
    }
}

impl FromRef<AppState> for GlobalDb {
    fn from_ref(s: &AppState) -> Self {
        s.global_db.clone()
    }
}

impl FromRef<AppState> for EventBus {
    fn from_ref(s: &AppState) -> Self {
        s.event_bus.clone()
    }
}

impl FromRef<AppState> for Arc<Orchestrator> {
    fn from_ref(s: &AppState) -> Self {
        s.orchestrator.clone()
    }
}

/// Cloneable shutdown signal injected as an axum `Extension` in `main`.
/// Long-lived handlers (SSE) end their streams when this flips to `true`
/// on SIGTERM, so graceful shutdown doesn't block on the 30s keepalive.
#[derive(Clone)]
pub struct ShutdownRx(pub tokio::sync::watch::Receiver<bool>);

/// Builds the service router.
///
/// Public (no auth):
/// - `GET  /health`                         — liveness probe.
/// - `GET  /docs`                           — Swagger UI page.
/// - `GET  /openapi.yaml`                   — `OpenAPI` 3.0 spec.
/// - `GET  /auth/google`                    — redirect to Google consent.
/// - `GET  /auth/google/callback`           — finish OAuth → JWT.
///
/// Authenticated (`Authorization: Bearer <jwt>` OR `?token=<jwt>` on
/// SSE — see `auth::middleware` for the resolution order):
/// - `GET  /auth/me`                        — current user (id + email).
/// - `POST /evaluate`                       — simulate action envelope(s).
/// - `GET  /wallets`                        — list user's wallets.
/// - `POST /wallets`                        — start tracking a new wallet.
/// - `PATCH/DELETE /wallets/:address`       — label/owned + archive.
/// - `POST /wallets/:address/sync`          — refresh via RPC/oracle.
/// - `POST /wallets/:address/permits`       — record a signed permit/permit2.
/// - `GET  /wallets/:address/state`         — full wallet state.
/// - `GET  /wallets/:address/holdings`      — token holdings.
/// - `GET  /wallets/:address/approvals`     — approval set.
/// - `GET  /wallets/:address/block-heights` — per-chain sync block.
/// - `GET  /transactions`                   — state-delta lifecycle log.
/// - `GET  /tokens`                         — token catalog + metadata.
/// - `GET  /events/stream`                  — SSE live event feed.
///
/// Policy installation, policy catalogs, verdict history, audit views, and
/// finding feeds are intentionally extension-local. The cloud API only stores
/// wallet state, token metadata, transactions, and sync lifecycle data.
///
/// CORS is allowlist-based in cloud mode. Local defaults still allow the
/// dashboard development origins configured in [`ServerConfig`].
pub fn build_router(state: AppState) -> Router {
    let config = ServerConfig::from_env();
    build_router_with_config(state, &config)
}

/// Builds the service router with explicit runtime configuration.
pub fn build_router_with_config(state: AppState, config: &ServerConfig) -> Router {
    let protected = Router::new()
        .route("/auth/me", get(auth_me_handler))
        .route("/evaluate", post(evaluate_handler))
        .route(
            "/wallets",
            get(read_handlers::list_wallets).post(write_handlers::add_wallet),
        )
        .route(
            "/wallets/:address",
            axum::routing::patch(write_handlers::patch_wallet)
                .delete(write_handlers::delete_wallet),
        )
        .route("/wallets/:address/sync", post(write_handlers::sync_wallet))
        .route(
            "/wallets/:address/permits",
            post(write_handlers::ingest_permit),
        )
        .route("/wallets/:address/state", get(read_handlers::get_state))
        .route(
            "/wallets/:address/holdings",
            get(read_handlers::get_holdings),
        )
        .route(
            "/wallets/:address/approvals",
            get(read_handlers::get_approvals),
        )
        .route(
            "/wallets/:address/positions",
            get(read_handlers::get_positions),
        )
        .route("/wallets/:address/pending", get(read_handlers::get_pending))
        .route(
            "/wallets/:address/block-heights",
            get(read_handlers::get_block_heights),
        )
        .route("/transactions", get(read_handlers::list_transactions))
        .route("/tokens", get(read_handlers::list_tokens))
        .route("/dashboard/summary", get(dashboard_handlers::get_summary))
        .route("/events/stream", get(crate::events::sse_stream))
        // ---- Marketplace ---------------------------------------------------
        .route(
            "/market/listings",
            get(market_handlers::list_listings).post(market_handlers::create_listing),
        )
        // Static path — registered before `/market/listings/:slug` so the
        // slug capture never swallows it (and it reads no per-listing slug).
        .route(
            "/market/activity-summary",
            get(market_handlers::activity_summary),
        )
        .route("/market/listings/:slug", get(market_handlers::get_listing))
        .route(
            "/market/listings/id/:id",
            delete(market_handlers::delete_listing),
        )
        .route(
            "/market/listings/id/:id/versions",
            post(market_handlers::create_version),
        )
        .route(
            "/market/listings/id/:id/versions/:ver",
            get(market_handlers::get_version),
        )
        .route(
            "/market/listings/id/:id/install",
            post(market_handlers::create_install),
        )
        .route(
            "/market/listings/id/:id/reviews",
            get(market_handlers::list_reviews).post(market_handlers::create_review),
        )
        .route(
            "/market/listings/id/:id/report",
            post(market_handlers::create_listing_report),
        )
        .route(
            "/market/reviews/:id/report",
            post(market_handlers::create_review_report),
        )
        .route(
            "/market/listings/id/:id/watch",
            post(market_handlers::watch).delete(market_handlers::unwatch),
        )
        .route(
            "/market/reviews/:id/helpful",
            post(market_handlers::vote_helpful),
        )
        .route("/market/reports", get(market_handlers::list_reports))
        .route(
            "/market/reports/mine",
            get(market_handlers::list_my_reports),
        )
        .route(
            "/market/reports/:id",
            patch(market_handlers::update_report_status),
        )
        .route("/market/watches", get(market_handlers::list_watches))
        // ---- Settings + LLM policy drafting --------------------------------
        .route(
            "/v2/settings",
            get(crate::llm_handlers::get_settings).put(crate::llm_handlers::put_settings),
        )
        .route(
            "/v2/policy/llm-draft",
            post(crate::llm_handlers::draft_policy),
        )
        // Selector decode + revoke calldata builder + Cedar sequence sim
        // all moved to the dashboard (apps/web/src/tools/* + cedar/).
        // The server holds only wallet state and sync lifecycle data.
        .layer(from_fn(require_auth));

    let public = Router::new()
        .route("/health", get(health_handler))
        .route("/readyz", get(crate::readiness::readyz_handler))
        .route("/docs", get(crate::docs::docs_html))
        .route("/openapi.yaml", get(crate::docs::openapi_yaml))
        .route("/auth/google", get(crate::auth::start_google_login))
        .route("/auth/google/callback", get(crate::auth::google_callback))
        .route("/auth/refresh", post(crate::auth::refresh_token));

    public
        .merge(protected)
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer(config))
        .with_state(state)
}

fn cors_layer(config: &ServerConfig) -> CorsLayer {
    let origins: Vec<HeaderValue> = config
        .cors_allowed_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .allow_private_network(config.allow_private_network)
}

/// `GET /health` — liveness probe.
async fn health_handler() -> &'static str {
    "ok"
}

/// `GET /auth/me` — echo the authenticated user. Used by the dashboard
/// to validate a stored JWT on page load and render the profile chip.
async fn auth_me_handler(Extension(user): Extension<AuthUser>) -> Response {
    Json(serde_json::json!({
        "user_id": user.user_id,
        "email": user.email,
    }))
    .into_response()
}

/// Maps [`HandlerError::Reducer`] to `422 Unprocessable Entity` (the action is
/// invalid for the state) and [`HandlerError::Store`] to `500 Internal Server
/// Error` (persistence failed).
/// Adapts the global DB's market-wide price lookup to the handler's
/// [`PriceBook`] so `oracle.usd_value` can value a swap from the synced price of
/// ANY wallet holding that token — not just the requesting (possibly
/// unregistered) wallet. A lookup error degrades to "unknown price" (the call
/// then fail-closes upstream), never a 500.
struct DbPriceBook {
    global_db: GlobalDb,
}

#[async_trait::async_trait]
impl PriceBook for DbPriceBook {
    async fn price(&self, chain: &str, address: &str) -> Option<PriceFact> {
        match self.global_db.latest_token_price(chain, address).await {
            Ok(Some(fact)) => Some(PriceFact {
                price_usd: fact.price_usd,
                decimals: fact.decimals,
            }),
            Ok(None) => None,
            Err(err) => {
                tracing::warn!(%chain, %address, error = %err, "global price lookup failed");
                None
            }
        }
    }

    async fn decimals(&self, chain: &str, address: &str) -> Option<u8> {
        match self.global_db.latest_token_decimals(chain, address).await {
            Ok(decimals) => decimals,
            Err(err) => {
                tracing::warn!(%chain, %address, error = %err, "global decimals lookup failed");
                None
            }
        }
    }
}

// ── F-ENRICH-1 fix: on-demand Chainlink price fallback ──────────────────────
//
// Root cause: `oracle.usd_value` resolves a price ONLY from a SYNCED wallet
// holding's `price_usd` (own wallet, else the cross-wallet `latest_token_price`
// DB scan — `DbPriceBook`). The Chainlink feed is exercised only as a side
// effect of `POST /wallets` sync, so a canonical token held by NO synced wallet
// (e.g. mainnet USDC) had no priced row and a USD-cap policy silently
// fail-opened — even though the feed exists. This decouples price coverage from
// holdings: on a DB miss `LayeredPriceBook` reads the canonical Chainlink USD
// feed directly, bounded + fail-open, mirroring `ChainalysisSanctionsOracle` /
// `AlchemyFloorOracle` (live eth_call at evaluate time for an OPTIONAL fact).

/// Chainlink `AggregatorV3Interface::latestRoundData()` selector.
const LATEST_ROUND_DATA_SELECTOR: &str = "0xfeaf968c";

/// A canonical `(chain, token)` → Chainlink USD aggregator binding.
#[derive(Clone, Copy)]
struct UsdFeedSpec {
    /// USD aggregator contract (the `latestRoundData()` target).
    aggregator: &'static str,
    /// Aggregator answer decimals — 8 for every Chainlink USD feed below.
    feed_decimals: u8,
    /// The ERC-20 token's OWN decimals (what `oracle.usd_value` divides by).
    token_decimals: u8,
}

/// Resolve a canonical ERC-20 `(chain, token)` to its Chainlink USD feed. `token`
/// must be a lowercase `0x` address. `None` for any token without a wired feed
/// (the fallback then stays inert — fail-open, never a fabricated price).
///
/// Aggregator addresses are sourced in-repo so there is one provenance:
/// mainnet from `policy_sync …::chainlink::ChainlinkFeedRegistry::with_mainnet_defaults`,
/// arb/base from `deploy/helm/policy-server/values-m3.yaml` (the prod sync feeds).
/// Token addresses are the canonical mainnet / L2 deployments. Wrapper tokens
/// share the underlying feed (WETH → ETH/USD), mirroring `chainlink_feed_for`.
fn canonical_usd_feed(chain: &str, token_lower: &str) -> Option<UsdFeedSpec> {
    let spec = |aggregator, token_decimals| UsdFeedSpec {
        aggregator,
        feed_decimals: 8,
        token_decimals,
    };
    match (chain, token_lower) {
        // ── Ethereum mainnet (eip155:1) ──
        // USDC
        ("eip155:1", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") => {
            Some(spec("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", 6))
        }
        // USDT
        ("eip155:1", "0xdac17f958d2ee523a2206206994597c13d831ec7") => {
            Some(spec("0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", 6))
        }
        // WETH → ETH/USD
        ("eip155:1", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") => {
            Some(spec("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", 18))
        }
        // WBTC
        ("eip155:1", "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599") => {
            Some(spec("0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", 8))
        }
        // DAI
        ("eip155:1", "0x6b175474e89094c44da98b954eedeac495271d0f") => {
            Some(spec("0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", 18))
        }
        // ── Arbitrum One (eip155:42161) ──
        // USDC
        ("eip155:42161", "0xaf88d065e77c8cc2239327c5edb3a432268e5831") => {
            Some(spec("0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3", 6))
        }
        // WETH → ETH/USD
        ("eip155:42161", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1") => {
            Some(spec("0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", 18))
        }
        // ── Base (eip155:8453) ──
        // USDC
        ("eip155:8453", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") => {
            Some(spec("0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", 6))
        }
        // WETH → ETH/USD
        ("eip155:8453", "0x4200000000000000000000000000000000000006") => {
            Some(spec("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", 18))
        }
        _ => None,
    }
}

/// Decode a Chainlink `latestRoundData()` `eth_call` result into a USD price
/// decimal string: the 2nd ABI word (`int256 answer`) scaled by `feed_decimals`.
/// `None` on malformed data or a NEGATIVE answer (USD feeds are non-negative; a
/// set sign bit means a bad feed, never a price — fail-open, never fabricate).
fn decode_chainlink_usd_answer(result_hex: &str, feed_decimals: u8) -> Option<String> {
    let body = result_hex.strip_prefix("0x").unwrap_or(result_hex);
    // Need at least 2 ABI words: roundId (word 0) + answer (word 1).
    let answer_hex = body.get(64..128)?;
    // int256 sign bit (top bit of the leading byte) set ⇒ negative ⇒ reject.
    if u8::from_str_radix(answer_hex.get(0..2)?, 16).ok()? & 0x80 != 0 {
        return None;
    }
    let answer = U256::from_str_radix(answer_hex, 16).ok()?;
    Some(scale_u256(&answer, feed_decimals))
}

/// Render a `U256` magnitude as a fixed-point decimal string with `decimals`
/// fractional digits, trailing zeros trimmed (mirrors the sync crate's
/// `scale_to_decimal`). `oracle.usd_value` parses the result as a Cedar decimal.
fn scale_u256(v: &U256, decimals: u8) -> String {
    let s = v.to_string();
    let d = decimals as usize;
    let out = if s.len() > d {
        let split = s.len() - d;
        format!("{}.{}", &s[..split], &s[split..])
    } else {
        format!("0.{}{}", "0".repeat(d - s.len()), s)
    };
    let trimmed = out.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() {
        "0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// On-demand Chainlink price source for [`PriceBook`]: reads a canonical
/// `(chain, token)`'s USD feed via a bounded `eth_call`. Used only as the
/// `LayeredPriceBook` fallback (DB miss), so the hot path stays a pure DB read;
/// this fires only for a canonical token that no synced wallet holds. Bounded
/// (1.5 s) + fail-open (`None`) exactly like [`ChainalysisSanctionsOracle`].
struct OnchainChainlinkPriceBook {
    client: reqwest::Client,
    /// CAIP-2 chain → JSON-RPC URL. Empty ⇒ the fallback is inert (always
    /// `None`), so `LayeredPriceBook` collapses to `DbPriceBook` (pre-fix).
    rpc_urls: HashMap<String, String>,
}

#[async_trait::async_trait]
impl PriceBook for OnchainChainlinkPriceBook {
    async fn price(&self, chain: &str, address: &str) -> Option<PriceFact> {
        let spec = canonical_usd_feed(chain, &address.to_ascii_lowercase())?;
        let rpc_url = self.rpc_urls.get(chain)?;
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{ "to": spec.aggregator, "data": LATEST_ROUND_DATA_SELECTOR }, "latest"],
        });
        let resp = self
            .client
            .post(rpc_url)
            .json(&req)
            .timeout(Duration::from_millis(1500))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()?;
        let result = resp.get("result")?.as_str()?;
        let price_usd = decode_chainlink_usd_answer(result, spec.feed_decimals)?;
        Some(PriceFact {
            price_usd,
            decimals: spec.token_decimals,
        })
    }

    async fn decimals(&self, chain: &str, address: &str) -> Option<u8> {
        canonical_usd_feed(chain, &address.to_ascii_lowercase()).map(|s| s.token_decimals)
    }
}

/// Compose the wallet-derived [`DbPriceBook`] (primary) with the on-demand
/// [`OnchainChainlinkPriceBook`] (fallback). `price` / `decimals` try the DB
/// first (fast, covers every synced token) and fall back to the canonical
/// Chainlink feed only on a miss — the F-ENRICH-1 fix that lets a USD-cap policy
/// value a canonical token NO wallet currently holds.
struct LayeredPriceBook {
    db: DbPriceBook,
    onchain: OnchainChainlinkPriceBook,
}

#[async_trait::async_trait]
impl PriceBook for LayeredPriceBook {
    async fn price(&self, chain: &str, address: &str) -> Option<PriceFact> {
        if let Some(fact) = self.db.price(chain, address).await {
            return Some(fact);
        }
        self.onchain.price(chain, address).await
    }

    async fn decimals(&self, chain: &str, address: &str) -> Option<u8> {
        if let Some(decimals) = self.db.decimals(chain, address).await {
            return Some(decimals);
        }
        self.onchain.decimals(chain, address).await
    }
}

/// Per-chain JSON-RPC URLs for the on-demand Chainlink price fallback. Defaults
/// to the keyless public RPCs `values-m3.yaml` already uses for the sync worker,
/// so the fix works without new config. Override per chain with
/// `POLICY_PRICE_RPC_URL_<numeric-chain-id>` (empty disables that chain), or
/// disable the whole fallback with `POLICY_PRICE_ONCHAIN_FALLBACK=0` (the price
/// book then collapses to the wallet-derived DB source, pre-fix behavior).
fn price_rpc_urls() -> HashMap<String, String> {
    let mut urls = HashMap::new();
    if std::env::var("POLICY_PRICE_ONCHAIN_FALLBACK").is_ok_and(|v| v == "0") {
        return urls;
    }
    for (caip, id, default_url) in [
        ("eip155:1", "1", "https://ethereum-rpc.publicnode.com"),
        (
            "eip155:42161",
            "42161",
            "https://arbitrum-one-rpc.publicnode.com",
        ),
        ("eip155:8453", "8453", "https://base-rpc.publicnode.com"),
    ] {
        let url = std::env::var(format!("POLICY_PRICE_RPC_URL_{id}"))
            .unwrap_or_else(|_| default_url.to_owned());
        if !url.is_empty() {
            urls.insert(caip.to_owned(), url);
        }
    }
    urls
}

/// Chainalysis sanctions-list address `0x40C5…c8fb` is the canonical on-chain
/// oracle on Ethereum mainnet (verified contract; `name()` = "Chainalysis
/// sanctions oracle"). v1 is mainnet-only — the `EigenLayer` delegation chain.
const CHAINALYSIS_ORACLE_MAINNET: &str = "0x40c57923924b5c5c5455c48d93317139addac8fb";

/// On-chain sanctions screen for [`SanctionsScreen`], backed by the Chainalysis
/// oracle (`isSanctioned(address)`). Reads the Ethereum-mainnet JSON-RPC URL from
/// `POLICY_SANCTIONS_RPC_URL`; when unset the screen returns `None` (screen
/// unavailable → the optional `address.sanctions` call fail-opens, so a
/// deployment without an RPC stays dormancy-safe). The `eth_call` is hard-bounded
/// (1.5 s) so a slow/dead RPC degrades to `None`, never blocking the verdict.
/// Honest limit: the oracle is bool-only (no list/label/timestamp) and lags OFAC
/// designations — a `true` is high-signal, a `false` is NOT an authoritative
/// "clean".
struct ChainalysisSanctionsOracle {
    client: reqwest::Client,
    rpc_url: Option<String>,
}

#[async_trait::async_trait]
impl SanctionsScreen for ChainalysisSanctionsOracle {
    async fn is_sanctioned(&self, chain_id: i64, address: &str) -> Option<bool> {
        if chain_id != 1 {
            return None; // v1: Ethereum mainnet only (the EigenLayer chain).
        }
        let rpc_url = self.rpc_url.as_deref()?;
        let data = crate::handler::sanctions_calldata(address)?;
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{ "to": CHAINALYSIS_ORACLE_MAINNET, "data": data }, "latest"],
        });
        let resp = self
            .client
            .post(rpc_url)
            .json(&body)
            .timeout(std::time::Duration::from_millis(1500))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()?;
        // A revert / error surfaces as a JSON-RPC `error` with no `result` → None.
        let result = resp.get("result")?.as_str()?;
        crate::handler::decode_sanctioned(result)
    }
}

/// On-chain reader for `lending.health_factor` — a raw JSON-RPC `eth_call`
/// returning the ABI returndata bytes. Mirrors [`ChainalysisSanctionsOracle`]:
/// reads the Ethereum-mainnet RPC URL from `POLICY_LENDING_RPC_URL` (falling back
/// to the general `ALCHEMY_RPC_URL`); when unset the read returns `None`, so the
/// optional health-factor call fail-opens (the borrow/withdraw HF policies stay
/// dormant) rather than fabricating a value. Each `eth_call` is hard-bounded
/// (1.5 s) and mainnet-only (v1).
struct RpcOnchainView {
    client: reqwest::Client,
    rpc_url: Option<String>,
}

/// Multicall3 — the same deterministic address on every EVM chain (CREATE2 deploy).
/// Used to fold a Comet collateral enumeration into one round-trip via `aggregate3`.
const MULTICALL3: &str = "0xcA11bde05977b3631167028862bE2a173976CA11";

impl RpcOnchainView {
    /// One raw JSON-RPC `eth_call` to `to` with `data`, returning the returndata
    /// bytes (1.5 s bound). `None` on any transport error or a JSON-RPC `error`
    /// (revert / no `result`). Shared by `eth_call` and the Multicall3 batch.
    async fn raw_eth_call(&self, to: &str, data: &[u8]) -> Option<Vec<u8>> {
        let rpc_url = self.rpc_url.as_deref()?;
        let data_hex = format!("0x{}", hex::encode(data));
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{ "to": to, "data": data_hex }, "latest"],
        });
        let resp = self
            .client
            .post(rpc_url)
            .json(&body)
            .timeout(std::time::Duration::from_millis(1500))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()?;
        // A revert surfaces as a JSON-RPC `error` with no `result` → None.
        let result = resp.get("result")?.as_str()?;
        hex::decode(result.trim_start_matches("0x")).ok()
    }
}

#[async_trait::async_trait]
impl crate::lending_hf::OnchainView for RpcOnchainView {
    async fn eth_call(&self, chain_id: i64, to: &str, data: &[u8]) -> Option<Vec<u8>> {
        if chain_id != 1 {
            return None; // v1: Ethereum mainnet only.
        }
        self.raw_eth_call(to, data).await
    }

    /// Batch via a single Multicall3 `aggregate3` (`allowFailure = true` per leg, so a
    /// reverting feed yields just that slot's `None` rather than sinking the batch).
    /// One round-trip replaces N sequential `eth_call`s — the Comet enumeration's
    /// 8 s-timeout risk. Reuses policy-sync's tested ABI codec
    /// (`encode_aggregate3_calldata` / `decode_aggregate3_returndata`).
    async fn eth_call_batch(
        &self,
        chain_id: i64,
        calls: &[(String, Vec<u8>)],
    ) -> Option<Vec<Option<Vec<u8>>>> {
        if chain_id != 1 {
            return None; // v1: Ethereum mainnet only.
        }
        if calls.is_empty() {
            return Some(Vec::new());
        }
        let mut mc_calls = Vec::with_capacity(calls.len());
        for (to, data) in calls {
            let raw = hex::decode(to.trim_start_matches("0x")).ok()?;
            if raw.len() != 20 {
                return None; // malformed target ⇒ dormant (never a fabricated batch)
            }
            mc_calls.push(Call3 {
                target: alloy_primitives::Address::from_slice(&raw),
                allow_failure: true,
                call_data: data.clone(),
            });
        }
        let calldata = encode_aggregate3_calldata(&mc_calls);
        let ret = self.raw_eth_call(MULTICALL3, &calldata).await?;
        let results = decode_aggregate3_returndata(&ret).ok()?;
        if results.len() != calls.len() {
            return None; // arity mismatch ⇒ can't trust the mapping
        }
        // A leg that reverted (success=false) or returned empty maps to None — the
        // adapter decides whether that slot's absence is fatal.
        Some(
            results
                .into_iter()
                .map(|r| (r.success && !r.return_data.is_empty()).then_some(r.return_data))
                .collect(),
        )
    }
}

/// Max age for a marketplace floor quote to be trusted. Alchemy background-
/// refreshes live marketplaces every ~15 min, so a quote older than this is from a
/// marketplace Alchemy no longer maintains (e.g. `LooksRare`, observed 17 months
/// stale) — dropping it stops a dead market's price from dragging the floor down (a
/// stale-LOW quote would undervalue the floor and miss a real dust drain) or
/// inflating it. Tunable.
const MAX_FLOOR_AGE: time::Duration = time::Duration::days(1);

/// Pick the floor (ETH) from an Alchemy `getFloorPrice` response: the LOWEST floor
/// among marketplaces whose quote is FRESH (`retrievedAt` within [`MAX_FLOOR_AGE`]
/// of `now`) AND valid (positive `floorPrice`, null `error`). Stale quotes are
/// dropped FIRST, so "lowest across marketplaces" is the cheapest CURRENT listing,
/// never the cheapest including months-old garbage. `None` when no marketplace has
/// a fresh, valid floor.
fn pick_fresh_floor_eth(body: &serde_json::Value, now: time::OffsetDateTime) -> Option<f64> {
    use time::format_description::well_known::Rfc3339;
    ["openSea", "looksRare"]
        .iter()
        .filter_map(|mkt| {
            let m = &body[*mkt];
            if m.get("error").is_some_and(|e| !e.is_null()) {
                return None; // marketplace reported an error
            }
            let price = m["floorPrice"].as_f64()?;
            if !(price.is_finite() && price > 0.0) {
                return None;
            }
            let retrieved =
                time::OffsetDateTime::parse(m["retrievedAt"].as_str()?, &Rfc3339).ok()?;
            if now - retrieved > MAX_FLOOR_AGE {
                return None; // stale quote
            }
            Some(price)
        })
        .reduce(f64::min)
}

/// NFT floor source for [`NftFloorOracle`], backed by Alchemy's `getFloorPrice`
/// NFT API. (Reservoir's hosted API was sunset 2025-10-15; Alchemy is its
/// recommended migration.) `getFloorPrice` reports the floor **in ETH** per
/// marketplace (`OpenSea` + `LooksRare`), **Ethereum mainnet only** — so v1 returns
/// `None` off `eip155:1`. We take the LOWEST floor among FRESH quotes
/// ([`pick_fresh_floor_eth`] drops stale ones first); the consuming method converts
/// ETH→USD via the WETH price. Reads
/// `ALCHEMY_NFT_API_URL` — the full NFT-API base incl. key, e.g.
/// `https://eth-mainnet.g.alchemy.com/nft/v3/<API_KEY>`; when unset the oracle
/// returns `None` (→ the optional `marketplace.sign_order_proceeds_floor` call
/// fail-opens, the below-floor policy stays dormant), never a fabricated floor.
/// Any network / non-200 / parse failure → `None`. The request is hard-bounded
/// (1.5 s) so a slow/dead API degrades to `None`, never blocking the verdict.
struct AlchemyFloorOracle {
    client: reqwest::Client,
    base_url: Option<String>,
}

#[async_trait::async_trait]
impl NftFloorOracle for AlchemyFloorOracle {
    async fn floor_eth(&self, chain: &str, collection: &str) -> Option<f64> {
        if chain != "eip155:1" {
            return None; // getFloorPrice is Ethereum-mainnet-only
        }
        let base = self.base_url.as_deref()?;
        let url = format!("{base}/getFloorPrice?contractAddress={collection}");
        let resp = self
            .client
            .get(&url)
            .header("accept", "application/json")
            .timeout(std::time::Duration::from_millis(1500))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body = resp.json::<serde_json::Value>().await.ok()?;
        // Response: `{ "openSea": { "floorPrice": <f64>, "priceCurrency": "ETH",
        // "retrievedAt": <rfc3339>, "error": null }, "looksRare": { … } }`. Drop
        // stale quotes, then take the lowest fresh floor.
        pick_fresh_floor_eth(&body, time::OffsetDateTime::now_utc())
    }
}

/// `GoPlus` result flags that, when `"1"`, mark a spender malicious. Any one set
/// flips `address.reputation` to `flagged=true`. (`GoPlus` returns ~30 fields; this
/// is the high-signal subset relevant to an approve-spender risk.)
const GOPLUS_MALICIOUS_FLAGS: &[&str] = &[
    "phishing_activities",
    "blacklist_doubt",
    "stealing_attack",
    "honeypot_related_address",
    "cybercrime",
    "money_laundering",
    "financial_crime",
    "darkweb_transactions",
    "sanctioned",
    "fake_token",
    "malicious_mining_activities",
    "blackmail_activities",
];

/// EIP-155 chain ids where `GoPlus` `token_security` is supported AND `ScopeBall`
/// collects token enrichment. Outside this set `token.security_flags` stays dormant
/// rather than calling and mis-keying on an unsupported chain. Widen by adding ids.
const TOKEN_SECURITY_CHAINS: &[i64] = &[1, 10, 8453, 42161];

/// Every EVM chain `GeckoTerminal` indexes, as eip155 `chain_id` → network SLUG
/// (its on-chain API keys pools by slug, not chainId). Generated by joining
/// `CoinGecko` `asset_platforms` (`chain_identifier` = the eip155 id) with
/// `GeckoTerminal` `GET /networks` (`coingecko_asset_platform_id`) — every pair is
/// verified against both APIs, not guessed. Non-EVM `GeckoTerminal` networks
/// (Solana, Sui, …) have no eip155 id and are intentionally absent.
const GECKOTERMINAL_NETWORKS: &[(i64, &str)] = &[
    (1, "eth"),
    (9, "quai-network"),
    (10, "optimism"),
    (14, "flare"),
    (20, "ela"),
    (24, "kai"),
    (25, "cro"),
    (30, "rootstock"),
    (40, "tlos"),
    (42, "lukso"),
    (50, "xdc"),
    (56, "bsc"),
    (61, "ethereum_classic"),
    (82, "mtr"),
    (88, "tomochain"),
    (96, "bitkub_chain"),
    (100, "xdai"),
    (106, "velas"),
    (108, "thundercore"),
    (122, "fuse"),
    (130, "unichain"),
    (137, "polygon_pos"),
    (143, "monad"),
    (146, "sonic"),
    (148, "shimmerevm"),
    (151, "redbelly-network"),
    (169, "manta-pacific"),
    (173, "eni"),
    (177, "hashkey"),
    (196, "x-layer"),
    (199, "bttc"),
    (204, "opbnb"),
    (239, "tac"),
    (248, "oasys"),
    (250, "ftm"),
    (252, "fraxtal"),
    (288, "boba"),
    (295, "hedera-hashgraph"),
    (311, "omax-chain"),
    (314, "filecoin"),
    (321, "kcc"),
    (324, "zksync"),
    (336, "sdn"),
    (360, "shape"),
    (369, "pulsechain"),
    (388, "cronos-zkevm"),
    (416, "sxn"),
    (463, "areon-network"),
    (480, "world-chain"),
    (570, "rollux"),
    (592, "astr"),
    (614, "graphlinq-chain"),
    (648, "endurance"),
    (690, "redstone"),
    (747, "flow-evm"),
    (766, "ql1"),
    (841, "taraxa"),
    (888, "wan"),
    (999, "hyperevm"),
    (1_030, "cfx"),
    (1_088, "metis"),
    (1_101, "polygon-zkevm"),
    (1_110, "grx-chain"),
    (1_111, "wemix"),
    (1_116, "core"),
    (1_130, "defimetachain"),
    (1_135, "lisk"),
    (1_231, "ultron"),
    (1_234, "step-network"),
    (1_284, "glmr"),
    (1_285, "movr"),
    (1_300, "glue"),
    (1_329, "sei-evm"),
    (1_339, "elysium"),
    (1_480, "vana"),
    (1_514, "story"),
    (1_559, "tenet"),
    (1_625, "gravity-alpha"),
    (1_776, "injective"),
    (1_868, "soneium"),
    (1_890, "lightlink-phoenix"),
    (1_923, "swellchain"),
    (1_983, "krown-network"),
    (1_996, "sanko-mainnet"),
    (2_000, "dogechain"),
    (2_020, "ronin"),
    (2_040, "vanarchain"),
    (2_222, "kava"),
    (2_345, "goat"),
    (2_372, "besc-hyperchain"),
    (2_525, "inevm"),
    (2_741, "abstract"),
    (2_818, "morph-l2"),
    (3_338, "peaq"),
    (3_637, "botanix"),
    (3_721, "xone"),
    (4_061, "nahmii"),
    (4_114, "citrea"),
    (4_200, "merlin-chain"),
    (4_326, "megaeth"),
    (4_337, "beam"),
    (4_352, "memecore"),
    (4_488, "hydra-chain"),
    (4_689, "iotx"),
    (5_000, "mantle"),
    (5_031, "somnia"),
    (5_112, "ham"),
    (5_165, "bahamut-mainnet"),
    (5_234, "humanode"),
    (5_330, "superseed"),
    (5_464, "saga"),
    (5_545, "duckchain"),
    (5_888, "mantra-evm"),
    (6_001, "bouncebit"),
    (7_000, "zetachain"),
    (7_560, "cyber"),
    (7_700, "canto"),
    (8_217, "kaia"),
    (8_453, "base"),
    (8_668, "hela"),
    (8_822, "iota-evm"),
    (8_899, "jib-chain"),
    (9_001, "evmos"),
    (9_008, "shido-network"),
    (9_745, "plasma"),
    (9_898, "larissa-mainnet"),
    (10_000, "bch"),
    (11_235, "haqq-network"),
    (11_501, "bevm"),
    (12_553, "rss3-vsl-mainnet"),
    (13_371, "immutable-zkevm"),
    (16_116, "defiverse"),
    (16_661, "0g"),
    (16_718, "airdao"),
    (17_777, "eos-evm"),
    (18_686, "mxc-zkevm"),
    (22_776, "map-protocol"),
    (23_294, "oasis-sapphire"),
    (25_363, "fluent"),
    (31_612, "mezo"),
    (32_520, "bitgert"),
    (33_139, "apechain"),
    (33_979, "funki"),
    (34_443, "mode"),
    (35_441, "q-mainnet"),
    (38_833, "igra"),
    (39_797, "nrg"),
    (41_923, "educhain"),
    (42_161, "arbitrum"),
    (42_170, "arbitrum_nova"),
    (42_220, "celo"),
    (42_793, "etherlink"),
    (43_111, "hemi"),
    (43_114, "avax"),
    (48_900, "zircuit"),
    (50_104, "sophon"),
    (52_014, "electroneum"),
    (53_935, "dfk"),
    (56_288, "boba-bnb"),
    (57_073, "ink"),
    (59_144, "linea"),
    (62_621, "multivac"),
    (80_094, "berachain"),
    (81_457, "blast"),
    (83_872, "zedxion-smart-chain"),
    (88_811, "units-network"),
    (88_888, "chiliz-chain"),
    (98_866, "plume-network"),
    (167_000, "taiko"),
    (200_901, "bitlayer"),
    (201_022, "fonchain"),
    (202_555, "kasplex"),
    (210_425, "platon_network"),
    (322_202, "parex"),
    (534_352, "scroll"),
    (660_279, "xai"),
    (685_689, "gensyn"),
    (747_474, "katana"),
    (800_001, "octaspace"),
    (810_180, "zklink-nova"),
    (2_632_500, "coti"),
    (7_777_777, "zora-network"),
    (10_241_024, "alienx"),
    (21_000_000, "corn"),
    (245_022_934, "neon-evm"),
    (666_666_666, "degenchain"),
    (888_888_888, "ancient8"),
    (1_313_161_554, "aurora"),
    (1_380_012_617, "rari"),
    (1_666_600_000, "one"),
    (2_046_399_126, "skale-europa"),
];

/// Resolve a `GeckoTerminal` network slug from an eip155 `chain_id`. `None` for an
/// unmapped chain → the `pool.liquidity` call stays dormant on that chain (never
/// mis-routed to a wrong network).
fn geckoterminal_network_slug(chain_id: i64) -> Option<&'static str> {
    GECKOTERMINAL_NETWORKS
        .iter()
        .find(|(id, _)| *id == chain_id)
        .map(|&(_, slug)| slug)
}

/// Live external enrichment for the token policies: `GoPlus` malicious-address
/// reputation (`address.reputation`) and the owner's transfer history
/// (`stat_window.snapshot` / `address.similarity`, Phase 2 via Alchemy
/// `getAssetTransfers`). Each leg is independently fail-open: any network/parse
/// error → `None`, so the optional policy stays dormant. `GoPlus` is keyless and
/// free, so reputation defaults ON (override the base with `GOPLUS_API_URL`, or
/// set it empty to disable).
struct LiveEnrichment {
    client: reqwest::Client,
    /// `GoPlus` address-security API base. `None` → built-in default; empty → off.
    goplus_base: Option<String>,
    /// Alchemy JSON-RPC base incl. key (for `getAssetTransfers`); `None` → the
    /// transfer-history methods stay dormant.
    alchemy_rpc: Option<String>,
    /// `GeckoTerminal` on-chain DEX API base for `pool.liquidity` (24h pool volume).
    /// `None` → built-in public default (`https://api.geckoterminal.com/api/v2`,
    /// keyless & free); empty → off. Defaults ON, like `goplus_base`.
    geckoterminal_base: Option<String>,
}

#[async_trait::async_trait]
impl ExternalEnrichment for LiveEnrichment {
    async fn reputation_flagged(&self, chain_id: i64, address: &str) -> Option<bool> {
        // Validate 0x-hex (20 bytes) before building the URL.
        let addr = address.trim_start_matches("0x").to_lowercase();
        if addr.len() != 40 || !addr.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let base = self
            .goplus_base
            .as_deref()
            .unwrap_or("https://api.gopluslabs.io/api/v1");
        if base.is_empty() {
            return None; // explicitly disabled
        }
        let url = format!("{base}/address_security/0x{addr}?chain_id={chain_id}");
        let resp = self
            .client
            .get(&url)
            .header("accept", "application/json")
            .timeout(Duration::from_millis(1500))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body = resp.json::<serde_json::Value>().await.ok()?;
        // `GoPlus` envelope: `{ code, message, result }`; `code == 1` = success.
        if body.get("code").and_then(serde_json::Value::as_i64) != Some(1) {
            return None;
        }
        let result = body.get("result")?;
        let flagged = GOPLUS_MALICIOUS_FLAGS
            .iter()
            .any(|k| result.get(*k).and_then(serde_json::Value::as_str) == Some("1"));
        Some(flagged)
    }

    async fn recent_outbound(
        &self,
        chain_id: i64,
        owner: &str,
        since_unix: i64,
    ) -> Option<Vec<OutboundTransfer>> {
        self.alchemy_outbound(chain_id, owner, since_unix).await
    }

    async fn pool_liquidity(
        &self,
        chain_id: i64,
        venue: &serde_json::Value,
    ) -> Option<PoolLiquidityFacts> {
        // Resolve the pool key from the internally-tagged `AmmVenue`
        // (`.pool` / `.pool_id` / `.pair`); non-pool / unknown venue → dormant.
        let pool_key = crate::handler::amm_venue_pool_key(venue)?.to_lowercase();
        if !pool_key.starts_with("0x") || pool_key.len() < 4 {
            return None;
        }
        // `GeckoTerminal` keys pools by its own network SLUG, not eip155 chainId.
        let network = geckoterminal_network_slug(chain_id)?;
        let base = self
            .geckoterminal_base
            .as_deref()
            .unwrap_or("https://api.geckoterminal.com/api/v2");
        if base.is_empty() {
            return None; // explicitly disabled
        }
        // `GeckoTerminal` (CoinGecko on-chain) public API — keyless, free. The pool
        // object's `attributes.volume_usd.h24` is a TRUE rolling-24h USD figure
        // (a string). A 404 (pool not indexed) or parse miss → `None` (dormant),
        // never a fabricated 0.
        let url = format!("{base}/networks/{network}/pools/{pool_key}");
        let resp = self
            .client
            .get(&url)
            .header("accept", "application/json")
            .timeout(Duration::from_millis(2500))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body = resp.json::<serde_json::Value>().await.ok()?;
        let attrs = body.get("data")?.get("attributes")?;
        // `volume_usd` is an object keyed by window; `reserve_in_usd` is a flat
        // string. Parse each independently — a brand-new pool may have one but not
        // the other. Emit iff at least one is present, else dormant (never a 0).
        let vol_24h_usd = attrs
            .get("volume_usd")
            .and_then(|v| v.get("h24"))
            .and_then(serde_json::Value::as_str)
            .and_then(|s| s.parse::<f64>().ok());
        let reserve_usd = attrs
            .get("reserve_in_usd")
            .and_then(serde_json::Value::as_str)
            .and_then(|s| s.parse::<f64>().ok());
        if vol_24h_usd.is_none() && reserve_usd.is_none() {
            return None;
        }
        Some(PoolLiquidityFacts {
            vol_24h_usd,
            reserve_usd,
        })
    }

    /// `token.market_data` — FDV + total cross-pool liquidity for a swap's output
    /// (buy) token, via the keyless `GeckoTerminal` token endpoint
    /// (`/networks/{net}/tokens/{addr}`). A 404 (token not indexed) or parse miss →
    /// `None` (dormant), never a fabricated 0.
    async fn token_market_data(&self, chain_id: i64, token: &str) -> Option<TokenMarketData> {
        let addr = token.trim_start_matches("0x").to_lowercase();
        if addr.len() != 40 || !addr.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let network = geckoterminal_network_slug(chain_id)?;
        let base = self
            .geckoterminal_base
            .as_deref()
            .unwrap_or("https://api.geckoterminal.com/api/v2");
        if base.is_empty() {
            return None; // explicitly disabled
        }
        let url = format!("{base}/networks/{network}/tokens/0x{addr}");
        let resp = self
            .client
            .get(&url)
            .header("accept", "application/json")
            .timeout(Duration::from_millis(2500))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body = resp.json::<serde_json::Value>().await.ok()?;
        let attrs = body.get("data")?.get("attributes")?;
        let fdv_usd = attrs
            .get("fdv_usd")
            .and_then(serde_json::Value::as_str)
            .and_then(|s| s.parse::<f64>().ok());
        let total_reserve_usd = attrs
            .get("total_reserve_in_usd")
            .and_then(serde_json::Value::as_str)
            .and_then(|s| s.parse::<f64>().ok());
        if fdv_usd.is_none() && total_reserve_usd.is_none() {
            return None;
        }
        Some(TokenMarketData {
            fdv_usd,
            total_reserve_usd,
        })
    }

    #[allow(clippy::cast_possible_truncation)] // tax clamped to [0, 1e7] before the cast
    async fn token_security_flags(&self, chain_id: i64, token: &str) -> Option<TokenSecurityFlags> {
        // Validate 0x-hex (20 bytes) before building the URL.
        let addr = token.trim_start_matches("0x").to_lowercase();
        if addr.len() != 40 || !addr.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        // `token_security`'s supported-chain set differs from `address_security`'s;
        // skip (dormant) outside it rather than mis-keying on an unsupported chain.
        if !TOKEN_SECURITY_CHAINS.contains(&chain_id) {
            return None;
        }
        let base = self
            .goplus_base
            .as_deref()
            .unwrap_or("https://api.gopluslabs.io/api/v1");
        if base.is_empty() {
            return None; // explicitly disabled
        }
        let url = format!("{base}/token_security/{chain_id}?contract_addresses=0x{addr}");
        let resp = self
            .client
            .get(&url)
            .header("accept", "application/json")
            .timeout(Duration::from_millis(1500))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body = resp.json::<serde_json::Value>().await.ok()?;
        // `GoPlus` envelope: `{ code, message, result }`; `code == 1` = success.
        if body.get("code").and_then(serde_json::Value::as_i64) != Some(1) {
            return None;
        }
        // `result` is an OBJECT keyed by the (lowercased) contract address. Look it
        // up case-insensitively; an absent/empty entry = unanalyzed → UNKNOWN (None),
        // never a fabricated "clean".
        let result = body.get("result")?.as_object()?;
        let key = format!("0x{addr}");
        let entry = result
            .get(&key)
            .or_else(|| {
                result
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(&key))
                    .map(|(_, v)| v)
            })?
            .as_object()?;
        if entry.is_empty() {
            return None;
        }
        let flag = |k: &str| entry.get(k).and_then(serde_json::Value::as_str) == Some("1");
        // Tax is a decimal-FRACTION string ("0.04" = 4%, "1" = 100%); empty/absent =
        // unknown (NOT 0). bps = round(fraction * 10000). (Confirmed against the live
        // GoPlus response: SAITAMA buy_tax "0.04" = 4%, USDC/USDT "0".)
        let tax_bps = |k: &str| -> Option<i64> {
            let s = entry.get(k).and_then(serde_json::Value::as_str)?;
            if s.is_empty() {
                return None;
            }
            let frac: f64 = s.parse().ok()?;
            // Clamp to a sane band (0%–100000%) so the `as i64` cannot wrap.
            Some((frac * 10_000.0).round().clamp(0.0, 1e7) as i64)
        };
        // A `GoPlus`-vetted famous token (trust_list == "1") → report all-clear. This
        // kills blue-chip false-positives: USDT carries owner_change_balance / is_
        // blacklisted / is_mintable / transfer_pausable == "1" but trust_list == "1".
        if flag("trust_list") {
            return Some(TokenSecurityFlags::default());
        }
        let sell_tax_bps = tax_bps("sell_tax");
        // Honeypot is deny-grade ONLY when GoPlus could actually analyze the contract
        // (open-source — a closed-source contract yields no honeypot verdict anyway).
        let is_honeypot =
            (flag("is_honeypot") || flag("cannot_sell_all")) && flag("is_open_source");
        // Counterfeit: `is_true_token` == "0" (string). NOTE `token_security`'s
        // `fake_token` is an OBJECT here (unlike `address_security`'s string flag).
        let counterfeit = entry
            .get("is_true_token")
            .and_then(serde_json::Value::as_str)
            == Some("0");
        let unsellable_tax = sell_tax_bps.is_some_and(|b| b >= 10_000);
        let is_malicious = is_honeypot
            || flag("hidden_owner")
            || flag("selfdestruct")
            || flag("is_airdrop_scam")
            || counterfeit
            || unsellable_tax;
        Some(TokenSecurityFlags {
            is_honeypot,
            is_malicious,
            sell_tax_bps,
            buy_tax_bps: tax_bps("buy_tax"),
        })
    }
}

/// Parse an RFC-3339 timestamp (Alchemy `metadata.blockTimestamp`) to unix
/// seconds; `None` if it doesn't parse.
fn parse_rfc3339_unix(s: &str) -> Option<i64> {
    time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(time::OffsetDateTime::unix_timestamp)
}

impl LiveEnrichment {
    /// The owner's recent OUTBOUND transfers via Alchemy `alchemy_getAssetTransfers`
    /// (native + ERC20, newest first). `None` (fail-open) when `alchemy_rpc` is
    /// unset, off mainnet, or the request/parse fails. Each transfer carries the
    /// recipient, the ERC20 contract (`None` = native), the token-unit amount, and
    /// the block timestamp — the consuming method values + windows them.
    async fn alchemy_outbound(
        &self,
        chain_id: i64,
        owner: &str,
        _since_unix: i64,
    ) -> Option<Vec<OutboundTransfer>> {
        let base = self.alchemy_rpc.as_deref()?;
        if base.is_empty() || chain_id != 1 {
            return None; // v1: Ethereum mainnet only
        }
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_getAssetTransfers",
            "params": [{
                "fromAddress": owner,
                "category": ["external", "erc20"],
                "withMetadata": true,
                "excludeZeroValue": true,
                "order": "desc",
                "maxCount": "0x3e8"
            }],
        });
        let resp = self
            .client
            .post(base)
            .json(&body)
            .timeout(Duration::from_millis(2500))
            .send()
            .await
            .ok()?
            .json::<serde_json::Value>()
            .await
            .ok()?;
        let transfers = resp.get("result")?.get("transfers")?.as_array()?;
        let mut out = Vec::with_capacity(transfers.len());
        for t in transfers {
            let Some(to) = t
                .get("to")
                .and_then(serde_json::Value::as_str)
                .map(str::to_lowercase)
            else {
                continue; // contract-creation / null recipient
            };
            let amount = t
                .get("value")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            let asset = t
                .get("rawContract")
                .and_then(|c| c.get("address"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_lowercase);
            let ts_unix = t
                .get("metadata")
                .and_then(|m| m.get("blockTimestamp"))
                .and_then(serde_json::Value::as_str)
                .and_then(parse_rfc3339_unix)
                .unwrap_or(0);
            out.push(OutboundTransfer {
                to,
                asset,
                amount,
                ts_unix,
            });
        }
        Some(out)
    }
}

async fn evaluate_handler(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<EvaluateRequest>,
) -> Response {
    tracing::debug!(
        user_id = %user.user_id,
        wallet_address = %format!("{:#x}", req.wallet_id.address),
        wallet_chains = ?req.wallet_id.chains,
        n_envelopes = req.envelopes.len(),
        n_call_specs = req.call_specs.len(),
        "evaluate request: wallet + enrichment call count"
    );
    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("open user store: {e}"),
            )
                .into_response();
        }
    };
    // F-ENRICH-1 fix: DB-derived price (primary) + on-demand Chainlink fallback
    // (DB miss) so a USD-cap can value a canonical token NO synced wallet holds.
    let price_book = LayeredPriceBook {
        db: DbPriceBook {
            global_db: state.global_db.clone(),
        },
        onchain: OnchainChainlinkPriceBook {
            client: reqwest::Client::new(),
            rpc_urls: price_rpc_urls(),
        },
    };
    let sanctions = ChainalysisSanctionsOracle {
        client: reqwest::Client::new(),
        rpc_url: std::env::var("POLICY_SANCTIONS_RPC_URL").ok(),
    };
    let floor = AlchemyFloorOracle {
        client: reqwest::Client::new(),
        base_url: std::env::var("ALCHEMY_NFT_API_URL").ok(),
    };
    let external = LiveEnrichment {
        client: reqwest::Client::new(),
        goplus_base: std::env::var("GOPLUS_API_URL").ok(),
        alchemy_rpc: std::env::var("ALCHEMY_RPC_URL").ok(),
        geckoterminal_base: std::env::var("GECKOTERMINAL_API_URL").ok(),
    };
    let onchain = RpcOnchainView {
        client: reqwest::Client::new(),
        rpc_url: std::env::var("POLICY_LENDING_RPC_URL")
            .ok()
            .or_else(|| std::env::var("ALCHEMY_RPC_URL").ok()),
    };
    match evaluate(
        &*store,
        &price_book,
        &sanctions,
        &floor,
        &external,
        &onchain,
        req,
    )
    .await
    {
        Ok(resp) => Json(resp).into_response(),
        Err(err @ HandlerError::Reducer(_)) => {
            (StatusCode::UNPROCESSABLE_ENTITY, err.to_string()).into_response()
        }
        Err(err @ HandlerError::Store(_)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use time::format_description::well_known::Rfc3339;
    use time::OffsetDateTime;

    fn at(ts: &str) -> OffsetDateTime {
        OffsetDateTime::parse(ts, &Rfc3339).unwrap()
    }

    #[test]
    fn geckoterminal_slug_maps_known_chains_and_misses_unknown() {
        use super::geckoterminal_network_slug as slug;
        // The original seven.
        assert_eq!(slug(1), Some("eth"));
        assert_eq!(slug(8453), Some("base"));
        assert_eq!(slug(42161), Some("arbitrum"));
        // Chains added by the full GeckoTerminal-EVM expansion (verified eip155↔slug
        // via CoinGecko `chain_identifier` ⋈ GeckoTerminal `coingecko_asset_platform_id`).
        assert_eq!(slug(56), Some("bsc"));
        assert_eq!(slug(100), Some("xdai")); // Gnosis
        assert_eq!(slug(130), Some("unichain"));
        assert_eq!(slug(324), Some("zksync"));
        assert_eq!(slug(59_144), Some("linea"));
        assert_eq!(slug(534_352), Some("scroll"));
        assert_eq!(slug(80_094), Some("berachain"));
        assert_eq!(slug(999), Some("hyperevm")); // HyperEVM
        assert_eq!(slug(33_139), Some("apechain"));
        // Unknown / non-EVM chain → None → pool.liquidity dormant on that chain.
        assert_eq!(slug(999_999), None);
        // The table is comprehensive (every GeckoTerminal EVM network), not a token set.
        assert!(
            super::GECKOTERMINAL_NETWORKS.len() >= 150,
            "expected the full GeckoTerminal EVM network table, got {}",
            super::GECKOTERMINAL_NETWORKS.len()
        );
    }

    // ── F-ENRICH-1: on-demand Chainlink price fallback ──────────────────────

    /// The canonical `(chain, token)` → feed table resolves the audit's flagged
    /// tokens and rejects unknowns. Input must be lowercase (the caller lowercases).
    #[test]
    fn canonical_feed_table_resolves_and_rejects() {
        // mainnet USDC — the token the audit found dormant (no wallet held it).
        let usdc =
            super::canonical_usd_feed("eip155:1", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")
                .expect("mainnet USDC feed");
        assert_eq!(usdc.token_decimals, 6);
        assert_eq!(usdc.feed_decimals, 8);
        // mainnet WETH shares the ETH/USD feed, 18 decimals.
        assert_eq!(
            super::canonical_usd_feed("eip155:1", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
                .unwrap()
                .token_decimals,
            18
        );
        // base USDC is wired too.
        assert!(super::canonical_usd_feed(
            "eip155:8453",
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        )
        .is_some());
        // unknown token / unknown chain → no feed (fallback stays inert).
        assert!(super::canonical_usd_feed(
            "eip155:1",
            "0x000000000000000000000000000000000000dead"
        )
        .is_none());
        assert!(super::canonical_usd_feed(
            "eip155:999",
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        )
        .is_none());
    }

    /// `latestRoundData()` result decoding: 2nd ABI word (answer) scaled by 8.
    #[test]
    fn decode_chainlink_answer_scales_and_rejects_negative() {
        // 5-word return: roundId | answer | startedAt | updatedAt | answeredInRound.
        let ret =
            |answer_hex: &str| format!("0x{}{answer_hex}{}", "0".repeat(64), "0".repeat(64 * 3));
        // 1718.53051744 × 1e8 = 171_853_051_744
        let eth = ret(&format!("{:064x}", 171_853_051_744_u128));
        assert_eq!(
            super::decode_chainlink_usd_answer(&eth, 8).as_deref(),
            Some("1718.53051744")
        );
        // 0.99970974 × 1e8 = 99_970_974 (sub-dollar → "0." prefix)
        let usdc = ret(&format!("{:064x}", 99_970_974_u128));
        assert_eq!(
            super::decode_chainlink_usd_answer(&usdc, 8).as_deref(),
            Some("0.99970974")
        );
        // sign bit set ⇒ negative answer ⇒ rejected (no fabricated price).
        let neg = ret(&"f".repeat(64));
        assert!(super::decode_chainlink_usd_answer(&neg, 8).is_none());
        // truncated payload ⇒ None.
        assert!(super::decode_chainlink_usd_answer("0x1234", 8).is_none());
    }

    /// LIVE e2e (run with `--ignored`): the REAL on-demand fallback prices
    /// mainnet USDC from publicnode end-to-end — the exact F-ENRICH-1 case (a
    /// token the test wallets never held). Off by default (network dependent).
    #[tokio::test]
    #[ignore = "hits live publicnode RPC"]
    async fn live_onchain_usdc_price() {
        use crate::handler::PriceBook;
        let pb = super::OnchainChainlinkPriceBook {
            client: reqwest::Client::new(),
            rpc_urls: super::price_rpc_urls(),
        };
        let fact = pb
            .price("eip155:1", "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48")
            .await;
        assert!(
            matches!(&fact, Some(f) if f.decimals == 6 && f.price_usd.parse::<f64>().is_ok_and(|p| p > 0.5 && p < 2.0)),
            "live mainnet USDC should price near $1 with 6 decimals, got {fact:?}"
        );
    }

    /// Both quotes fresh → the LOWEST is the floor (cheapest current listing).
    #[test]
    fn both_fresh_takes_min() {
        let now = at("2026-06-10T05:00:00Z");
        let body = json!({
            "openSea":   { "floorPrice": 9.0, "retrievedAt": "2026-06-10T04:55:00Z", "error": null },
            "looksRare": { "floorPrice": 8.0, "retrievedAt": "2026-06-10T04:50:00Z", "error": null },
        });
        assert_eq!(super::pick_fresh_floor_eth(&body, now), Some(8.0));
    }

    /// A stale-HIGH quote is dropped; the fresh one wins (the real BAYC case:
    /// `OpenSea` 9.1 fresh vs `LooksRare` 69 stale 17 months).
    #[test]
    fn stale_high_dropped_fresh_wins() {
        let now = at("2026-06-10T05:00:00Z");
        let body = json!({
            "openSea":   { "floorPrice": 9.09999, "retrievedAt": "2026-06-10T04:51:00Z", "error": null },
            "looksRare": { "floorPrice": 69.0,    "retrievedAt": "2025-01-13T03:42:00Z", "error": null },
        });
        assert_eq!(super::pick_fresh_floor_eth(&body, now), Some(9.09999));
    }

    /// THE fix: a stale-LOW quote must NOT drag the floor down via min. The old
    /// raw-min(9.0, 3.0)=3.0 would undervalue the floor and MISS a real dust drain;
    /// dropping the stale source first yields the correct fresh 9.0.
    #[test]
    fn stale_low_dropped_not_min() {
        let now = at("2026-06-10T05:00:00Z");
        let body = json!({
            "openSea":   { "floorPrice": 9.0, "retrievedAt": "2026-06-10T04:55:00Z", "error": null },
            "looksRare": { "floorPrice": 3.0, "retrievedAt": "2024-06-10T00:00:00Z", "error": null },
        });
        assert_eq!(super::pick_fresh_floor_eth(&body, now), Some(9.0));
    }

    /// Both stale → no trustworthy floor → None (policy dormant, fail-open).
    #[test]
    fn both_stale_is_none() {
        let now = at("2026-06-10T05:00:00Z");
        let body = json!({
            "openSea":   { "floorPrice": 9.0, "retrievedAt": "2024-01-01T00:00:00Z", "error": null },
            "looksRare": { "floorPrice": 8.0, "retrievedAt": "2024-01-01T00:00:00Z", "error": null },
        });
        assert_eq!(super::pick_fresh_floor_eth(&body, now), None);
    }

    /// A marketplace that returned an error (non-null `error`) is skipped; the
    /// other fresh one wins.
    #[test]
    fn error_marketplace_skipped() {
        let now = at("2026-06-10T05:00:00Z");
        let body = json!({
            "openSea":   { "floorPrice": null, "retrievedAt": "2026-06-10T04:55:00Z", "error": "no floor" },
            "looksRare": { "floorPrice": 8.0,  "retrievedAt": "2026-06-10T04:50:00Z", "error": null },
        });
        assert_eq!(super::pick_fresh_floor_eth(&body, now), Some(8.0));
    }

    /// LIVE e2e (run with `--ignored` + `ALCHEMY_NFT_API_URL` set): the REAL
    /// `AlchemyFloorOracle` (reqwest fetch + `pick_fresh_floor_eth` stale filter)
    /// resolves BAYC's floor from live Alchemy to a sane positive ETH value —
    /// exercising the actual production code path end-to-end against the live API,
    /// not a stub. Ignored by default (network + key dependent).
    #[tokio::test]
    #[ignore = "hits live Alchemy; requires ALCHEMY_NFT_API_URL"]
    async fn live_alchemy_floor_bayc() {
        use crate::handler::NftFloorOracle;
        // Live + key-dependent: CI's `--ignored` run has no key, so SKIP (return
        // ok) instead of panicking when `ALCHEMY_NFT_API_URL` is unset. Runs the
        // real fetch only when a key is provided (local / a keyed CI run).
        let Ok(base) = std::env::var("ALCHEMY_NFT_API_URL") else {
            eprintln!("skipping live_alchemy_floor_bayc: ALCHEMY_NFT_API_URL not set");
            return;
        };
        let oracle = super::AlchemyFloorOracle {
            client: reqwest::Client::new(),
            base_url: Some(base),
        };
        let floor = oracle
            .floor_eth("eip155:1", "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d")
            .await;
        assert!(
            matches!(floor, Some(p) if p.is_finite() && p > 0.0 && p < 100_000.0),
            "live BAYC floor should be a sane positive ETH value, got {floor:?}"
        );
    }

    /// Live e2e for `pool.liquidity`: the production `LiveEnrichment` `GeckoTerminal`
    /// fetch against the real Uniswap V3 WETH/USDC 0.05% pool. Exercises the
    /// venue→pool-key resolution, the chain→network slug, and the
    /// `attributes.volume_usd.h24` parse end-to-end. Keyless public API, so it runs
    /// whenever network egress is available (no env / key needed).
    #[tokio::test]
    #[ignore = "hits live GeckoTerminal public API"]
    async fn live_pool_liquidity_geckoterminal() {
        use crate::handler::ExternalEnrichment;
        let ext = super::LiveEnrichment {
            client: reqwest::Client::new(),
            goplus_base: None,
            alchemy_rpc: None,
            geckoterminal_base: None, // built-in keyless public default
        };
        let venue = json!({
            "name": "uniswap_v3",
            "pool": "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640" // WETH/USDC 0.05%
        });
        let facts = ext.pool_liquidity(1, &venue).await;
        let vol = facts.and_then(|f| f.vol_24h_usd);
        eprintln!("pool.liquidity live vol24hUsd = {vol:?}");
        assert!(
            matches!(vol, Some(v) if v.is_finite() && v > 0.0),
            "live WETH/USDC pool should report a positive 24h volume, got {vol:?}"
        );
    }

    /// Live e2e for `lending.health_factor` THROUGH the production Multicall3 path
    /// (`RpcOnchainView::eth_call_batch` → one `aggregate3` `eth_call`). Proves the
    /// aggregate3 encode/decode round-trips on real mainnet and that Aave V3's
    /// `getUserAccountData` + `getAssetPrice` + `decimals` reads decode into a real
    /// post-action HF. The borrower (must currently hold an Aave V3 debt position) is
    /// overridable via `LENDING_E2E_BORROWER`. Requires a mainnet RPC
    /// (`POLICY_LENDING_RPC_URL` / `ALCHEMY_RPC_URL`); SKIPS (ok) when unset so a
    /// keyless CI `--ignored` run doesn't fail.
    #[tokio::test]
    #[ignore = "hits live mainnet RPC via Multicall3; needs POLICY_LENDING_RPC_URL/ALCHEMY_RPC_URL"]
    async fn live_lending_health_factor_aave_multicall3() {
        let Some(rpc) = std::env::var("POLICY_LENDING_RPC_URL")
            .ok()
            .or_else(|| std::env::var("ALCHEMY_RPC_URL").ok())
        else {
            eprintln!("skipping live_lending_health_factor_aave_multicall3: no RPC env");
            return;
        };
        let onchain = super::RpcOnchainView {
            client: reqwest::Client::new(),
            rpc_url: Some(rpc),
        };
        let borrower = std::env::var("LENDING_E2E_BORROWER")
            .unwrap_or_else(|_| "0xf0ffc2a63bdfe3eaf8fbe77174c5d314bf4358e9".to_owned());
        // Borrowing 100 USDC of a live Aave V3 position — the whole read goes out as
        // ONE Multicall3 aggregate3 (getUserAccountData + getAssetPrice + decimals).
        let params = json!({
            "chain_id": "eip155:1",
            "owner": borrower,
            "venue": { "name": "aave_v3", "chain": "eip155:1",
                       "pool": "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2" },
            "asset": { "key": { "standard": "erc20", "chain": "eip155:1",
                       "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" } }, // USDC
            "amount": "0x5f5e100", // 100 USDC (100e6)
            "action_kind": "borrow",
        });
        let out = crate::lending_hf::lending_health_factor(&params, &onchain).await;
        eprintln!("lending.health_factor live result = {out:?}");
        let out = out.expect("live HF should resolve (Multicall3 aggregate3 + Aave decode)");
        let hf: f64 = out["postActionHf"].as_str().unwrap().parse().unwrap();
        // A live borrower with debt ⇒ a finite, positive, NON-sentinel HF (999999
        // sentinel = zero debt ⇒ the position closed; set LENDING_E2E_BORROWER).
        assert!(
            hf.is_finite() && hf > 0.0 && hf < 100_000.0,
            "post-action HF for a live Aave borrower should be sane positive, got {hf}"
        );
    }
}
