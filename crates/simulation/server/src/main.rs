//! `simulation-server` binary entry point.
//!
//! Starts the axum HTTP service: initializes tracing, opens the cross-user
//! identity DB (`~/.scopeball/global.db`), prepares the per-user store
//! router (`~/.scopeball/users/<id>/scopeball.db`), and serves on
//! `SIMULATION_SERVER_ADDR` (default `127.0.0.1:8788`).
//!
//! Environment variables:
//! - `SIMULATION_SERVER_ADDR` — bind address (default `127.0.0.1:8788`).
//! - `SCOPEBALL_HOME` — overrides `~/.scopeball` (test / sandboxing).
//! - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
//!   `JWT_SECRET`, `DASHBOARD_URL` — auth config (see `.env.example`).

use std::path::PathBuf;

use tracing_subscriber::EnvFilter;

use simulation_db::{GlobalDb, MultiUserStore};
use simulation_server::app::{build_router, AppState};
use simulation_server::events::EventBus;

/// Default bind address. Port `8788` deliberately differs from the legacy
/// Node.js policy-rpc host (`8787`) so the two can run side-by-side during
/// the migration.
const DEFAULT_ADDR: &str = "127.0.0.1:8788";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,simulation_server=debug")),
        )
        .init();

    let home = scopeball_home();
    let global_db_path = home.join("global.db");
    let users_dir = home.join("users");
    tracing::info!(
        global_db = %global_db_path.display(),
        users_dir = %users_dir.display(),
        "opening multi-user wallet store"
    );

    let global_db = GlobalDb::open(&global_db_path)?;
    let multi_user = MultiUserStore::new(&users_dir);

    let state = AppState {
        multi_user,
        global_db,
        event_bus: EventBus::new(),
    };
    let router = build_router(state);

    let addr = std::env::var("SIMULATION_SERVER_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.to_owned());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "simulation-server listening");

    axum::serve(listener, router).await?;
    Ok(())
}

fn scopeball_home() -> PathBuf {
    if let Ok(p) = std::env::var("SCOPEBALL_HOME") {
        return PathBuf::from(p);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".scopeball")
}
