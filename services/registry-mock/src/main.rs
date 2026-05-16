//! Mock registry server. Mirrors the production registry's HTTP surface
//! (spec §7.3) over a filesystem-backed store.

mod manifest;
mod storage;

use axum::{routing::get, Router};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
struct AppState {
    storage: storage::Storage,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let state_dir: PathBuf = std::env::var("REGISTRY_STATE")
        .unwrap_or_else(|_| "./state".into())
        .into();
    tokio::fs::create_dir_all(&state_dir).await?;
    let state = AppState {
        storage: storage::Storage::new(state_dir),
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .with_state(Arc::new(state));

    let addr: SocketAddr = std::env::var("REGISTRY_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()?;
    tracing::info!(%addr, "registry-mock listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}
