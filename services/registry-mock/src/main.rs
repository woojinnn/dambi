//! Mock registry server. Mirrors the production registry's HTTP surface
//! (spec §7.3) over a filesystem-backed store. Intended for local dev,
//! integration tests, and CI.

use axum::{routing::get, Router};
use std::net::SocketAddr;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let app = Router::new().route("/healthz", get(healthz));

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
