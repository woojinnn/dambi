//! 테이블별 CRUD repository.
//!
//! 각 모듈은 한 테이블 (또는 같은 family 묶음) 의 insert/update/select/delete.
//! 외부 호출 패턴:
//! ```ignore
//! pool.with_tx(|tx| {
//!     repositories::profile::upsert(tx, &profile)?;
//!     let wallet_id = repositories::wallets::insert(tx, &wallet)?;
//!     repositories::tokens::upsert(tx, &token_key, Some("USDC"), Some(6))?;
//!     repositories::holdings::upsert(tx, wallet_id, &holding)?;
//!     Ok(())
//! })?;
//! ```

pub mod approvals;
pub mod block_heights;
pub mod deltas;
pub mod holdings;
pub mod positions;
pub mod profile;
pub mod tokens;
pub mod user_policies;
pub mod wallets;
// `execution_reports`, `pending_txs`, and `verdicts` repositories were
// removed: those tables migrated to `chrome.storage.local` in the browser
// extension. Migration 010 drops the underlying tables.

pub use deltas::{DeltaInsert, DeltaRow, DeltaSource, DeltaStatus};
pub use profile::UserProfile;
pub use wallets::{Wallet, WalletInsert};
