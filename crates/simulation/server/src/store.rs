//! In-memory wallet store — the DEV/TEST persistence backend.
//!
//! This is **not** the production store. The DB owner provides the SQLite-backed
//! [`WalletStore`] impl in the `simulation-db` crate; this crate wires that in
//! later. Until then, [`InMemoryWalletStore`] lets the server run end-to-end
//! against in-process maps/vectors.
//!
//! The execution-report store boundary previously lived here. Post-policy
//! execution reports now live in `chrome.storage.local` (see
//! `browser-extension/backend/service-worker/execution-report-storage.ts`),
//! so this crate no longer owns that trait or its in-memory log.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;

use simulation_state::store::StoreError;
use simulation_state::{WalletId, WalletState, WalletStore};

/// A process-local [`WalletStore`] backed by `Mutex`-protected collections.
///
/// Intended for development and tests. State lives only for the lifetime of the
/// process; restart loses everything. Swap for the DB owner's `SQLite` store in
/// production.
#[derive(Debug, Default)]
pub struct InMemoryWalletStore {
    wallets: Mutex<HashMap<WalletId, WalletState>>,
}

impl InMemoryWalletStore {
    /// Creates an empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Seeds (inserts or overwrites) a wallet's state.
    ///
    /// Test/dev helper — primes the store so a simulation runs against a known
    /// starting state instead of the empty default.
    ///
    /// # Panics
    ///
    /// Panics only if the internal mutex was poisoned by a prior panic while a
    /// lock was held — which cannot happen in normal operation.
    pub fn seed(&self, state: WalletState) {
        self.wallets
            .lock()
            .expect("InMemoryWalletStore mutex poisoned")
            .insert(state.wallet_id.clone(), state);
    }
}

#[async_trait]
impl WalletStore for InMemoryWalletStore {
    async fn list_wallets(&self) -> Result<Vec<WalletId>, StoreError> {
        Ok(self
            .wallets
            .lock()
            .expect("InMemoryWalletStore mutex poisoned")
            .keys()
            .cloned()
            .collect())
    }

    /// Returns the stored state, or — for a wallet never seen before — a fresh
    /// empty [`WalletState::new`] for that id. This "first-seen" behavior lets a
    /// brand-new wallet simulate against empty state rather than erroring.
    /// Evaluation callers must not persist their predictions; authoritative
    /// sync/reconciliation callers use [`WalletStore::save`] when they have real
    /// ledger or venue state.
    async fn load(&self, id: &WalletId) -> Result<WalletState, StoreError> {
        Ok(self
            .wallets
            .lock()
            .expect("InMemoryWalletStore mutex poisoned")
            .get(id)
            .cloned()
            .unwrap_or_else(|| WalletState::new(id.clone())))
    }

    async fn save(&self, state: &WalletState) -> Result<(), StoreError> {
        self.wallets
            .lock()
            .expect("InMemoryWalletStore mutex poisoned")
            .insert(state.wallet_id.clone(), state.clone());
        Ok(())
    }
}
