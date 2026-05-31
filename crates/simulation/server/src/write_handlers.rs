//! Mutating endpoints — add wallets + trigger sync refresh.
//!
//! These are the counterpart to `read_handlers`. They take an
//! authenticated user, mutate that user's per-user SQLite, and (where
//! applicable) trigger the sync orchestrator to fetch live data over
//! RPC/oracles defined in `scopeball-sync.toml`.
//!
//! Sync completion fires a `wallet_synced` event on the per-user SSE
//! stream so a dashboard or extension subscribed to the activity feed
//! sees the refresh in real time.

use std::str::FromStr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::{Deserialize, Serialize};

use simulation_state::primitives::{Address, ChainId, Time};
use simulation_state::{WalletId, WalletState, WalletStore};
use simulation_sync::Orchestrator;

use crate::app::AppState;
use crate::auth::AuthUser;
use crate::events::types::{Event, WalletSync};

/// `POST /wallets` body.
#[derive(Debug, Deserialize)]
pub struct AddWalletReq {
    /// 0x address (case-insensitive — we store lower-cased internally).
    pub address: String,
    /// CAIP-2 chain ids (e.g. `["eip155:1", "eip155:42161"]`).
    pub chains: Vec<String>,
    /// Optional human-friendly label.
    #[serde(default)]
    pub label: Option<String>,
}

/// `POST /wallets` response.
#[derive(Debug, Serialize)]
pub struct AddWalletResp {
    pub wallet_id: WalletId,
    /// True when the auto-sync after add succeeded; false if it was
    /// skipped (no orchestrator) or errored (logged in `error`).
    pub synced: bool,
    /// Non-fatal sync error message — caller can retry with /sync.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `POST /wallets` — start tracking a new wallet for the authenticated
/// user. Creates an empty `WalletState` row and immediately triggers a
/// best-effort sync so the dashboard sees real data within one tick.
pub async fn add_wallet(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Json(req): Json<AddWalletReq>,
) -> Response {
    let id = match build_wallet_id(&req) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };

    // Seed an empty WalletState if the wallet isn't already known.
    let existing = match store.load(&id).await {
        Ok(s) => s,
        Err(e) => return internal(&format!("load: {e}")),
    };
    if existing == WalletState::new(id.clone()) {
        // Truly new — persist the empty shell so future loads are O(1).
        if let Err(e) = store.save(&existing).await {
            return internal(&format!("save: {e}"));
        }
    }

    // Best-effort sync. Failures here aren't fatal — the caller can
    // POST /sync later, and stale state is better than no wallet row.
    let (synced, sync_err) = match run_sync(&*store, &id, &state.orchestrator).await {
        Ok(()) => {
            state.event_bus.publish(
                user.user_id.clone(),
                Event::WalletSynced(WalletSync {
                    wallet: format!("{:#x}", id.address),
                    fields_updated: 0, // populated by /sync, not the seed path
                    fields_failed: 0,
                    synced_at: unix_now(),
                }),
            );
            (true, None)
        }
        Err(e) => (false, Some(e)),
    };

    Json(AddWalletResp {
        wallet_id: id,
        synced,
        error: sync_err,
    })
    .into_response()
}

/// `POST /wallets/:address/sync` — force a refresh against live RPC/oracle
/// sources. Caller blocks until the orchestrator finishes (or errors).
pub async fn sync_wallet(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    let addr = match Address::from_str(&address) {
        Ok(a) => a,
        Err(e) => return bad_request(&format!("invalid address `{address}`: {e}")),
    };

    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return internal(&format!("open user store: {e}")),
    };

    // Find the wallet's chain set from the stored row.
    let known = match store.list_wallets().await {
        Ok(w) => w,
        Err(e) => return internal(&format!("list_wallets: {e}")),
    };
    let Some(id) = known.into_iter().find(|w| w.address == addr) else {
        return not_found("wallet not tracked for this user");
    };

    if let Err(e) = run_sync(&*store, &id, &state.orchestrator).await {
        return internal(&e);
    }
    // Re-load to count what changed — the orchestrator's RefreshReport
    // would be richer but we don't have it surfaced from `run_sync` yet.
    let _state = match store.load(&id).await {
        Ok(s) => s,
        Err(e) => return internal(&format!("post-sync load: {e}")),
    };
    state.event_bus.publish(
        user.user_id.clone(),
        Event::WalletSynced(WalletSync {
            wallet: format!("{:#x}", id.address),
            fields_updated: 0,
            fields_failed: 0,
            synced_at: unix_now(),
        }),
    );
    StatusCode::NO_CONTENT.into_response()
}

// ---------- internals ----------

/// Load the wallet state, refresh it through the orchestrator (which
/// hits RPC/oracle endpoints), and save it back.
async fn run_sync(
    store: &dyn WalletStore,
    id: &WalletId,
    orchestrator: &Arc<Orchestrator>,
) -> Result<(), String> {
    let mut state = store
        .load(id)
        .await
        .map_err(|e| format!("load before sync: {e}"))?;
    orchestrator
        .refresh(&mut state, Time::from_unix(unix_now_u64()))
        .await
        .map_err(|e| format!("orchestrator.refresh: {e}"))?;
    store
        .save(&state)
        .await
        .map_err(|e| format!("save after sync: {e}"))
}

fn build_wallet_id(req: &AddWalletReq) -> Result<WalletId, Response> {
    let address = Address::from_str(&req.address)
        .map_err(|e| bad_request(&format!("invalid address `{}`: {e}", req.address)))?;
    if req.chains.is_empty() {
        return Err(bad_request("at least one chain required"));
    }
    let chains: Vec<ChainId> = req.chains.iter().cloned().map(ChainId::new).collect();
    Ok(WalletId::new(address, chains))
}

fn bad_request(reason: &str) -> Response {
    (StatusCode::BAD_REQUEST, reason.to_owned()).into_response()
}

fn not_found(reason: &str) -> Response {
    (StatusCode::NOT_FOUND, reason.to_owned()).into_response()
}

fn internal(reason: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, reason.to_owned()).into_response()
}

fn unix_now() -> i64 {
    i64::try_from(unix_now_u64()).unwrap_or(0)
}

fn unix_now_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
