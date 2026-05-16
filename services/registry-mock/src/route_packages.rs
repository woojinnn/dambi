use crate::AppState;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

const IMMUTABLE_CACHE: &str = "public, max-age=31536000, immutable";

pub async fn wasm(
    Path((name, version)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let ver = version.strip_prefix('v').unwrap_or(&version);
    match state.storage.read_wasm(&name, ver).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, HeaderValue::from_static("application/wasm")),
                (header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE_CACHE)),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn manifest(
    Path((name, version)): Path<(String, String)>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let ver = version.strip_prefix('v').unwrap_or(&version);
    match state.storage.read_manifest(&name, ver).await {
        Ok(m) => (
            [
                (header::CONTENT_TYPE, HeaderValue::from_static("application/json")),
                (header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE_CACHE)),
            ],
            serde_json::to_vec(&m).unwrap(),
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
