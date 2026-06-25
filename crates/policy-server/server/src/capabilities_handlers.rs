//! Runtime capability endpoints for dashboard clients.

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::app::AppState;

#[derive(Debug, Serialize)]
pub struct SyncChainsResp {
    pub chains: Vec<String>,
}

/// `GET /capabilities/sync-chains` — chains with configured RPC providers.
pub async fn sync_chains(State(state): State<AppState>) -> Response {
    let chains = state
        .orchestrator
        .router_arc()
        .map(|router| router.chains().map(ToString::to_string).collect())
        .unwrap_or_default();
    Json(SyncChainsResp { chains }).into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body;
    use policy_db::{GlobalDb, MultiUserStore};
    use policy_sync::{Orchestrator, SyncConfig};
    use serde_json::Value;

    use super::*;
    use crate::events::{EventBus, LocalEventPublisher};

    fn app_state(sync_config: &str) -> (AppState, tempfile::TempDir) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let global_db = GlobalDb::open(tmp.path().join("global.db")).expect("global db");
        let event_bus = EventBus::new();
        let sync_config = SyncConfig::load_str(sync_config).expect("sync config");
        let orchestrator = Orchestrator::from_sync_config(&sync_config).expect("orchestrator");
        (
            AppState {
                multi_user: MultiUserStore::new(tmp.path().join("users")),
                global_db,
                event_bus: event_bus.clone(),
                publisher: Arc::new(LocalEventPublisher::new(event_bus)),
                orchestrator: Arc::new(orchestrator),
                etherscan: None,
                coingecko: policy_sync::CoinGeckoClient::new(),
                coordinator: Arc::new(crate::coordination::NoopCoordinator),
                sync_lock_ttl: std::time::Duration::from_mins(2),
            },
            tmp,
        )
    }

    #[tokio::test]
    async fn sync_chains_returns_rpc_configured_chains() {
        let (state, _tmp) = app_state(
            r#"
[rpc.chains."eip155:1"]
[[rpc.chains."eip155:1".providers]]
name = "mainnet"
kind = "public"
url = "https://example.invalid/mainnet"
priority = 1

[rpc.chains."eip155:42161"]
[[rpc.chains."eip155:42161".providers]]
name = "arbitrum"
kind = "public"
url = "https://example.invalid/arbitrum"
priority = 1
"#,
        );

        let response = sync_chains(State(state)).await;
        let bytes = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body bytes");
        let body: Value = serde_json::from_slice(&bytes).expect("json body");

        assert_eq!(
            body["chains"],
            serde_json::json!(["eip155:1", "eip155:42161"])
        );
    }
}
