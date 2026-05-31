//! Read-only handlers — the future web UI's window into the wallet DB.
//!
//! Every handler is auth-gated (Phase 5 `require_auth` middleware) and
//! receives an [`AuthUser`] via `Extension`. The user's `user_id` selects
//! the right `SqliteWalletStore` from [`MultiUserStore`]; handlers never
//! touch the DB directly.

use std::str::FromStr;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde::Serialize;

use simulation_db::MultiUserStore;
use simulation_state::approval::ApprovalSet;
use simulation_state::primitives::{Address, BlockHeight, ChainId};
use simulation_state::token::{TokenHolding, TokenKey};
use simulation_state::{WalletId, WalletState, WalletStore};

use crate::app::AppState;
use crate::auth::AuthUser;

/// `GET /wallets` — every wallet id the authenticated user has.
pub async fn list_wallets(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Response {
    let store = match state.multi_user.for_user(&user.user_id) {
        Ok(s) => s,
        Err(e) => return open_store_error(&e.to_string()),
    };
    match store.list_wallets().await {
        Ok(ids) => Json(ids).into_response(),
        Err(e) => store_error(&e),
    }
}

/// `GET /wallets/:address/state` — the whole [`WalletState`].
pub async fn get_state(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    match load_state(&state.multi_user, &user.user_id, &address).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e,
    }
}

/// `GET /wallets/:address/holdings` — token holdings as an array.
pub async fn get_holdings(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    match load_state(&state.multi_user, &user.user_id, &address).await {
        Ok(s) => {
            #[derive(Serialize)]
            struct HoldingItem {
                key: TokenKey,
                #[serde(flatten)]
                holding: TokenHolding,
            }
            let items: Vec<HoldingItem> = s
                .tokens
                .into_iter()
                .map(|(key, holding)| HoldingItem { key, holding })
                .collect();
            Json(items).into_response()
        }
        Err(e) => e,
    }
}

/// `GET /wallets/:address/approvals` — the full [`ApprovalSet`].
pub async fn get_approvals(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    match load_state(&state.multi_user, &user.user_id, &address).await {
        Ok(s) => Json::<ApprovalSet>(s.approvals).into_response(),
        Err(e) => e,
    }
}

/// `GET /wallets/:address/block-heights` — per-chain block snapshot.
pub async fn get_block_heights(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    Path(address): Path<String>,
) -> Response {
    match load_state(&state.multi_user, &user.user_id, &address).await {
        Ok(s) => {
            #[derive(Serialize)]
            struct Item {
                chain: ChainId,
                #[serde(flatten)]
                height: BlockHeight,
            }
            let items: Vec<Item> = s
                .block_heights
                .into_iter()
                .map(|(chain, height)| Item { chain, height })
                .collect();
            Json(items).into_response()
        }
        Err(e) => e,
    }
}

/// Resolve `(user_id, address)` → load the full [`WalletState`]. Returns
/// an already-encoded HTTP error response on failure so callers can
/// pattern-match without trait noise.
async fn load_state(
    multi_user: &MultiUserStore,
    user_id: &str,
    address: &str,
) -> Result<WalletState, Response> {
    let addr = Address::from_str(address).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid address `{address}`: {e}"),
        )
            .into_response()
    })?;
    let store = multi_user
        .for_user(user_id)
        .map_err(|e| open_store_error(&e.to_string()))?;

    let known = store.list_wallets().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("list_wallets: {e}"),
        )
            .into_response()
    })?;
    let id = known
        .into_iter()
        .find(|w| w.address == addr)
        .unwrap_or_else(|| WalletId::new(addr, std::iter::empty::<ChainId>()));

    store
        .load(&id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("load: {e}")).into_response())
}

fn store_error(e: &simulation_state::store::StoreError) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("store error: {e}"),
    )
        .into_response()
}

fn open_store_error(reason: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("open user store: {reason}"),
    )
        .into_response()
}
