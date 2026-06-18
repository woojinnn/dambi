//! Runtime storage backend wiring.
//! The policy server now has one durable backend: `PostgreSQL`. State remains
//! primitive-first in `wallet_states.state_json`; mutable wallet metadata and
//! sync cursors live in adjacent tables under the same user namespace.

use std::sync::Arc;
use std::time::Duration;

use policy_db::stores::postgres::{connect_pool, PostgresMigrationStatus};
use policy_db::{GlobalDb, MultiUserStore};
use policy_state::WalletStore;

use crate::config::ServerConfig;

/// Storage handles selected at process startup.
#[derive(Clone, Debug)]
pub struct StorageBackend {
    global_db: GlobalDb,
    multi_user: MultiUserStore,
}

/// Capped exponential backoff for the Nth (1-based) retry attempt.
fn backoff_delay(attempt: u32, base: Duration, cap: Duration) -> Duration {
    let factor = 2u32.saturating_pow(attempt.saturating_sub(1).min(16));
    base.saturating_mul(factor).min(cap)
}

fn schema_not_ready_message(status: &PostgresMigrationStatus) -> Option<String> {
    if status.is_ready() {
        return None;
    }

    Some(format!(
        "PostgreSQL schema is not ready for this binary: expected_latest={:?} \
         applied_latest={:?} pending={:?} dirty={:?} checksum_mismatch={:?} \
         unknown_applied={:?}",
        status.expected_latest_version,
        status.applied_latest_version,
        status.pending_versions,
        status.dirty_versions,
        status.checksum_mismatch_versions,
        status.unknown_applied_versions
    ))
}

impl StorageBackend {
    /// Connect to `PostgreSQL` and either apply or verify schema migrations.
    pub async fn open(config: &ServerConfig) -> Result<Self, Box<dyn std::error::Error>> {
        Self::open_with_options(config, config.run_migrations_on_startup).await
    }

    /// Connect to `PostgreSQL`, optionally applying schema migrations.
    ///
    /// When migrations are disabled, startup still fails unless the database
    /// has already applied the current binary's migration set. This keeps API
    /// and worker processes aligned with the pre-upgrade migration job contract.
    pub async fn open_with_options(
        config: &ServerConfig,
        migrate: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let database_url = config.database_url.as_deref().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "DATABASE_URL is required; local-file storage has been removed",
            )
        })?;
        if !(database_url.starts_with("postgres://") || database_url.starts_with("postgresql://")) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "DATABASE_URL must use postgres:// or postgresql://",
            )
            .into());
        }

        let pool = {
            let mut attempt: u32 = 0;
            loop {
                match connect_pool(
                    database_url,
                    config.db_max_connections,
                    Duration::from_secs(config.db_acquire_timeout_secs),
                )
                .await
                {
                    Ok(pool) => break pool,
                    Err(e) => {
                        attempt += 1;
                        if attempt > config.db_connect_max_retries {
                            return Err(e.into());
                        }
                        let delay = backoff_delay(
                            attempt,
                            Duration::from_secs(config.db_connect_backoff_secs),
                            Duration::from_secs(30),
                        );
                        tracing::warn!(attempt, ?delay, error = %e, "db connect failed; retrying");
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        };
        let global_db = GlobalDb::new(pool.clone());
        if migrate {
            global_db.migrate().await?;
        } else if let Some(message) = schema_not_ready_message(&global_db.migration_status().await?)
        {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, message).into());
        }
        let multi_user = MultiUserStore::new(pool);
        Ok(Self {
            global_db,
            multi_user,
        })
    }

    /// Cross-user identity DB handle.
    #[must_use]
    pub fn global_db(&self) -> GlobalDb {
        self.global_db.clone()
    }

    /// Per-user wallet store router.
    #[must_use]
    pub fn multi_user(&self) -> MultiUserStore {
        self.multi_user.clone()
    }

    /// User ids visible to background workers.
    ///
    /// Only users with at least one non-archived wallet need scheduler work.
    /// OAuth-only users and users who archived every wallet are intentionally
    /// skipped; they re-enter the worker set when `POST /wallets` creates or
    /// reactivates a wallet row.
    pub async fn list_user_ids(&self) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        Ok(self.global_db.list_user_ids_with_active_wallets().await?)
    }

    /// Open the wallet store for one authenticated user's namespace.
    pub fn wallet_store_for_user(
        &self,
        user_id: &str,
    ) -> Result<Arc<dyn WalletStore>, Box<dyn std::error::Error>> {
        Ok(self.multi_user.for_user(user_id)?)
    }
}

#[cfg(test)]
mod tests {
    use super::{backoff_delay, schema_not_ready_message};
    use crate::config::ServerConfig;
    use policy_db::stores::postgres::PostgresMigrationStatus;
    use std::time::Duration;

    #[test]
    fn backoff_grows_then_caps() {
        let base = Duration::from_secs(5);
        let cap = Duration::from_secs(30);
        assert_eq!(backoff_delay(1, base, cap), Duration::from_secs(5));
        assert_eq!(backoff_delay(2, base, cap), Duration::from_secs(10));
        assert_eq!(backoff_delay(3, base, cap), Duration::from_secs(20));
        assert_eq!(backoff_delay(4, base, cap), cap);
        assert_eq!(backoff_delay(99, base, cap), cap);
    }

    #[test]
    fn ready_schema_status_allows_startup_without_migration() {
        let status = PostgresMigrationStatus {
            expected_latest_version: Some(7),
            applied_latest_version: Some(7),
            pending_versions: Vec::new(),
            dirty_versions: Vec::new(),
            checksum_mismatch_versions: Vec::new(),
            unknown_applied_versions: Vec::new(),
        };

        assert!(schema_not_ready_message(&status).is_none());
    }

    #[test]
    fn stale_schema_status_blocks_startup_without_migration() {
        let status = PostgresMigrationStatus {
            expected_latest_version: Some(7),
            applied_latest_version: Some(6),
            pending_versions: vec![7],
            dirty_versions: Vec::new(),
            checksum_mismatch_versions: Vec::new(),
            unknown_applied_versions: Vec::new(),
        };

        let message = schema_not_ready_message(&status).expect("stale schema rejected");
        assert!(message.contains("PostgreSQL schema is not ready"));
        assert!(message.contains("pending=[7]"));
    }

    #[tokio::test]
    async fn open_without_migration_accepts_current_schema() {
        let Ok(database_url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipping DB-backed storage startup test; TEST_DATABASE_URL not set");
            return;
        };
        let mut config = ServerConfig::for_tests();
        config.database_url = Some(database_url);
        config.db_max_connections = 2;

        super::StorageBackend::open_with_options(&config, true)
            .await
            .expect("initial migration succeeds");
        let storage = super::StorageBackend::open_with_options(&config, false)
            .await
            .expect("current schema is accepted when startup migrations are disabled");
        storage.global_db().ping().await.unwrap();
    }
}
