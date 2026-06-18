use policy_server::config::ServerConfig;
use policy_server::storage::StorageBackend;
use policy_state::primitives::{Address, ChainId};
use policy_state::{WalletId, WalletState, WalletStore};
use std::str::FromStr;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn storage_backend_lists_users_and_wallet_stores_for_worker() {
    let config = ServerConfig::for_tests();
    let storage = StorageBackend::open(&config).await.unwrap();
    let suffix = Uuid::new_v4();
    let zero_wallet_user_id = storage
        .global_db()
        .upsert_user(&format!("worker-zero-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let archived_user_id = storage
        .global_db()
        .upsert_user(&format!("worker-archived-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let user_id = storage
        .global_db()
        .upsert_user(&format!("worker-active-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let store = storage.wallet_store_for_user(&user_id).unwrap();
    let wallet_id = WalletId::new(
        Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        [ChainId::ethereum_mainnet()],
    );
    store
        .save(&WalletState::new(wallet_id.clone()))
        .await
        .unwrap();
    let archived_store = storage.multi_user().for_user(&archived_user_id).unwrap();
    let archived_wallet_id = WalletId::new(
        Address::from_str("0x0000000000000000000000000000000000000002").unwrap(),
        [ChainId::ethereum_mainnet()],
    );
    archived_store
        .save(&WalletState::new(archived_wallet_id))
        .await
        .unwrap();
    archived_store
        .archive_wallet("0x0000000000000000000000000000000000000002", 1_700_000_000)
        .await
        .unwrap();

    // Membership, not exact-global: this single integration Postgres is shared
    // across every test in the `--ignored` run (read/write/server_with_postgres
    // all seed their own users into `users` before this test runs), and it is
    // not reset between binaries. Asserting `list_user_ids() == vec![user_id]`
    // was order-dependent flakiness — it only held if this test happened to run
    // first on a fresh DB. Assert this worker's active-wallet user is PRESENT
    // instead. Login-only and archived-only users are intentionally absent so the
    // background worker does not spend one lock/scheduler/empty wallet scan on
    // every OAuth user every tick.
    let worker_user_ids = storage.list_user_ids().await.unwrap();
    assert!(
        worker_user_ids.contains(&user_id),
        "worker user must be listed for the sync worker to pick it up"
    );
    assert!(
        !worker_user_ids.contains(&zero_wallet_user_id),
        "login-only users should not be scheduled for wallet sync"
    );
    assert!(
        !worker_user_ids.contains(&archived_user_id),
        "users with only archived wallets should not be scheduled for wallet sync"
    );
    assert_eq!(store.list_wallets().await.unwrap(), vec![wallet_id]);
}
