//! Bridge a completed sync tick to real-time `wallet_synced` events.
//!
//! The on-demand `POST /wallets/:addr/sync` path already emits a `wallet_synced`
//! event when it finishes. The background `sync_worker` runs in a separate
//! process and used to stay silent, so dashboards never saw its refreshes live.
//! This helper turns the wallets a tick refreshed into one event each, published
//! through the same `EventPublisher` boundary (Redis in cloud) so connected
//! dashboards update as the worker runs.

use policy_state::WalletId;

use crate::events::{Event, EventPublisher, WalletSync};

/// Publish one `wallet_synced` event per wallet that a sync tick refreshed.
///
/// `synced_at` is a Unix timestamp in seconds, passed in so the caller owns the
/// clock and tests stay deterministic. Per-wallet field counts mirror the
/// on-demand sync path, which reports zero until a richer refresh summary is
/// surfaced.
pub async fn publish_tick_events(
    publisher: &dyn EventPublisher,
    user_id: &str,
    synced_wallets: &[WalletId],
    synced_at: i64,
) {
    for wallet in synced_wallets {
        publisher
            .publish(
                user_id.to_owned(),
                Event::WalletSynced(WalletSync {
                    wallet: format!("{:#x}", wallet.address),
                    fields_updated: 0,
                    fields_failed: 0,
                    synced_at,
                }),
            )
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use policy_state::{Address, ChainId};

    #[derive(Default)]
    struct RecordingPublisher {
        published: Mutex<Vec<(String, Event)>>,
    }

    #[async_trait]
    impl EventPublisher for RecordingPublisher {
        async fn publish(&self, user_id: String, event: Event) {
            self.published.lock().unwrap().push((user_id, event));
        }
    }

    fn wallet(addr: Address) -> WalletId {
        WalletId::new(addr, [ChainId::ethereum_mainnet()])
    }

    #[tokio::test]
    async fn publishes_one_wallet_synced_event_per_wallet() {
        let publisher = RecordingPublisher::default();
        let wallets = [wallet(Address::ZERO)];

        publish_tick_events(&publisher, "u_alice", &wallets, 1_700_000_000).await;

        let recorded = publisher.published.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        let (user_id, event) = &recorded[0];
        assert_eq!(user_id, "u_alice");
        match event {
            Event::WalletSynced(sync) => {
                assert_eq!(sync.wallet, format!("{:#x}", Address::ZERO));
                assert_eq!(sync.synced_at, 1_700_000_000);
            }
            other => panic!("expected WalletSynced, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn no_wallets_publishes_nothing() {
        let publisher = RecordingPublisher::default();
        publish_tick_events(&publisher, "u_alice", &[], 1).await;
        assert!(publisher.published.lock().unwrap().is_empty());
    }
}
