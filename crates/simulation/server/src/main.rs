//! `simulation-server` binary entry point.
//!
//! Starts the axum HTTP service: initializes tracing, wires an
//! [`InMemoryWalletStore`] into [`AppState`], builds the router, and serves on
//! `SIMULATION_SERVER_ADDR` (default `127.0.0.1:8788`).

use std::sync::Arc;

use tracing_subscriber::EnvFilter;

use simulation_server::app::{build_router, AppState};
use simulation_server::store::InMemoryWalletStore;

/// Default bind address. Port `8788` deliberately differs from the legacy
/// Node.js policy-rpc host (`8787`) so the two can run side-by-side during the
/// migration.
const DEFAULT_ADDR: &str = "127.0.0.1:8788";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,simulation_server=debug")),
        )
        .init();

    // TODO(prep): swap `InMemoryWalletStore` for the DB owner's SQLite-backed
    // `WalletStore` impl from the `simulation-db` crate. This crate stays
    // db-agnostic — it depends only on the `simulation_sync::WalletStore` trait.
    let store: Arc<dyn simulation_sync::WalletStore> = Arc::new(InMemoryWalletStore::new());
    let state = AppState { store };
    let router = build_router(state);

    let addr = std::env::var("SIMULATION_SERVER_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.to_owned());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "simulation-server listening");

    axum::serve(listener, router).await?;
    Ok(())
}
