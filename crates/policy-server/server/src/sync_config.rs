//! Runtime sync-config loading shared by policy-server binaries.

use std::io::{Error as IoError, ErrorKind};
use std::path::PathBuf;

use policy_sync::SyncConfig;

use crate::config::ServerConfig;

/// Default sync config path used by local `cargo run` flows.
pub const DEFAULT_SYNC_CONFIG: &str = "./dambi-sync.toml";

/// Resolve the sync config path from environment or the local default.
#[must_use]
pub fn sync_config_path_from_env() -> PathBuf {
    std::env::var("DAMBI_SYNC_CONFIG")
        .map_or_else(|_| PathBuf::from(DEFAULT_SYNC_CONFIG), PathBuf::from)
}

/// Load the runtime sync config.
///
/// Production sets `REQUIRE_SYNC_CONFIG=true`, in which case a missing or
/// invalid config fails startup. Local/dev keeps the older auth-only behavior:
/// the server can boot with an empty sync config and sync endpoints stay dormant.
pub fn load_sync_config(config: &ServerConfig) -> Result<SyncConfig, IoError> {
    let path = sync_config_path_from_env();
    match SyncConfig::load_file(&path) {
        Ok(cfg) => {
            tracing::info!(path = %path.display(), "loaded sync config");
            Ok(cfg)
        }
        Err(e) if config.require_sync_config => Err(IoError::new(
            ErrorKind::InvalidData,
            format!(
                "sync config required but not loaded from {}: {e}",
                path.display()
            ),
        )),
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "sync config not loaded; sync endpoints will stay dormant"
            );
            Ok(SyncConfig::default())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    #[test]
    fn optional_missing_sync_config_loads_empty_config() {
        let _guard = env_lock();
        let previous = std::env::var_os("DAMBI_SYNC_CONFIG");
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("missing-optional-sync-config.toml");
        std::env::set_var("DAMBI_SYNC_CONFIG", &missing);
        let mut config = ServerConfig::for_tests();
        config.require_sync_config = false;

        load_sync_config(&config).expect("optional missing config falls back to default");

        restore_env("DAMBI_SYNC_CONFIG", previous);
    }

    #[test]
    fn required_missing_sync_config_fails_startup() {
        let _guard = env_lock();
        let previous = std::env::var_os("DAMBI_SYNC_CONFIG");
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("missing-required-sync-config.toml");
        std::env::set_var("DAMBI_SYNC_CONFIG", &missing);
        let mut config = ServerConfig::for_tests();
        config.require_sync_config = true;

        let Err(err) = load_sync_config(&config) else {
            panic!("required missing config rejects startup");
        };
        assert!(err.to_string().contains("sync config required"));

        restore_env("DAMBI_SYNC_CONFIG", previous);
    }
}
