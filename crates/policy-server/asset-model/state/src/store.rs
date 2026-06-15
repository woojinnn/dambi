//! Wallet-state persistence boundary.
//!
//! Callers (the policy server, the sync scheduler, and tests) operate against
//! `&dyn WalletStore` so the actual backend — in-memory for narrow tests,
//! `PostgreSQL` for production — is interchangeable. The trait lives here in
//! `policy-state` (not in `policy-sync` or `policy-db`) so both
//! the DB impl and the consumers (sync, server) can depend on it without
//! forming a dependency cycle.

use async_trait::async_trait;

use crate::wallet::{WalletId, WalletState};

/// Errors surfaced by [`WalletStore`] implementations.
///
/// Intentionally narrow: backends translate their own errors (`DbError`,
/// `io::Error`, …) into one of these variants so callers can pattern-match
/// generically.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The requested wallet does not exist. Most callers treat this as
    /// "load an empty `WalletState`" rather than a hard error, so the
    /// canonical `WalletStore::load` contract is "return empty on miss";
    /// this variant exists for backends that want to surface a true 404.
    #[error("wallet not found: {0:?}")]
    NotFound(WalletId),

    /// The backend (DB, filesystem, network) failed. The string is
    /// implementation-defined; format it for logs, do not parse it.
    #[error("backend error: {0}")]
    Backend(String),
}

/// Persistence boundary for `WalletState`.
///
/// Three operations, all async because production persistence uses networked
/// database IO. Implementations must be `Send + Sync` so they can sit behind an
/// `Arc` in a multi-threaded axum server.
/// Contract:
/// - `load` for an unseen wallet returns an empty [`WalletState::new`]
///   rather than [`StoreError::NotFound`] — this lets a brand-new wallet
///   simulate against empty state without a special case in the caller.
/// - `save` is an upsert: it must create or replace the wallet's row(s)
///   atomically.
/// - `list_wallets` returns all wallets the store currently knows about,
///   in implementation-defined order.
#[async_trait]
pub trait WalletStore: Send + Sync {
    /// Returns every wallet id the store currently holds.
    async fn list_wallets(&self) -> Result<Vec<WalletId>, StoreError>;

    /// Returns wallets eligible for background sync, ordered after the supplied
    /// cursor when the backend supports cursor-aware selection. The default keeps
    /// existing stores source-compatible by rotating the full wallet list in
    /// memory; durable stores can override this to apply `next_due_at` and `LIMIT`
    /// in the backend.
    async fn list_wallets_for_sync(
        &self,
        _source: &str,
        _now_unix: u64,
        _limit: usize,
        cursor_after: Option<String>,
    ) -> Result<Vec<WalletId>, StoreError> {
        let wallets = self.list_wallets().await?;
        Ok(rotate_wallets_after_cursor(wallets, cursor_after))
    }

    /// Loads the wallet state for `id`. Returns an empty
    /// [`WalletState::new`] for a wallet the store has never
    /// seen, rather than [`StoreError::NotFound`].
    async fn load(&self, id: &WalletId) -> Result<WalletState, StoreError>;

    /// Persists `state` as an upsert (create or replace).
    async fn save(&self, state: &WalletState) -> Result<(), StoreError>;

    /// Records the next time a wallet should be considered for background sync.
    /// The default is a no-op so lightweight stores and tests do not need cursor
    /// tables; production stores can persist this for DB-side due filtering.
    async fn mark_wallet_sync_due_at(
        &self,
        _id: &WalletId,
        _source: &str,
        _next_due_at: u64,
    ) -> Result<(), StoreError> {
        Ok(())
    }
}

fn rotate_wallets_after_cursor(
    mut wallets: Vec<WalletId>,
    cursor_after: Option<String>,
) -> Vec<WalletId> {
    wallets.sort_by_key(wallet_sync_order_key);
    let Some(cursor_after) = cursor_after else {
        return wallets;
    };
    let split = wallets
        .iter()
        .position(|wid| wallet_sync_order_key(wid) > cursor_after)
        .unwrap_or(0);
    wallets.rotate_left(split);
    wallets
}

fn wallet_sync_order_key(wid: &WalletId) -> String {
    format!("{:#x}", wid.address)
}
