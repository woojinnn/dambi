//! Kubernetes readiness checks.
//!
//! `/health` remains a cheap liveness probe. `/readyz` verifies that this
//! process can serve real traffic: durable storage is reachable, required
//! secrets are present, sync config policy is satisfied, and Redis responds
//! when configured.

use std::collections::BTreeMap;
use std::fmt;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use policy_sync::SyncConfig;

use crate::app::AppState;
use crate::auth::jwt;
use crate::config::ServerConfig;
use crate::sync_config::sync_config_path_from_env;

/// JSON body returned by `/readyz`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReadinessReport {
    pub status: &'static str,
    pub checks: BTreeMap<&'static str, String>,
}

/// `GET /readyz` — readiness probe for Kubernetes traffic routing.
pub async fn readyz_handler(State(state): State<AppState>) -> Response {
    let config = ServerConfig::from_env();
    let mut checks = BTreeMap::new();

    checks.insert(
        "required_env",
        required_env_status(&["DATABASE_URL", "JWT_SECRET"]),
    );
    checks.insert("jwt_secret", jwt_secret_status());
    checks.insert("oauth_config", oauth_config_status(&config));
    checks.insert("postgres", postgres_status(&state).await);
    checks.insert("postgres_schema", postgres_schema_status(&state).await);
    checks.insert("sync_config", sync_config_status(&config));
    checks.insert(
        "redis",
        redis_status(config.redis_url.as_deref(), config.require_redis).await,
    );

    let ready = checks
        .values()
        .all(|status| status == "ok" || status == "skipped");
    let report = ReadinessReport {
        status: if ready { "ready" } else { "not_ready" },
        checks,
    };
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(report)).into_response()
}

fn jwt_secret_status() -> String {
    jwt::validate_configured_secret()
        .map_or_else(|e| readiness_error("jwt_secret", e), |()| "ok".to_owned())
}

fn required_env_status(names: &[&str]) -> String {
    let missing: Vec<&str> = names
        .iter()
        .copied()
        .filter(|name| std::env::var(name).map_or(true, |v| v.trim().is_empty()))
        .collect();
    if missing.is_empty() {
        "ok".to_owned()
    } else {
        tracing::warn!(missing = %missing.join(","), "readiness required env check failed");
        "missing".to_owned()
    }
}

fn oauth_config_status(config: &ServerConfig) -> String {
    if !config.require_oauth_config {
        return "skipped".to_owned();
    }
    let required = required_env_status(&[
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
        "DASHBOARD_URL",
    ]);
    if required != "ok" {
        return required;
    }
    let https = required_https_env_status(&["GOOGLE_REDIRECT_URI", "DASHBOARD_URL"]);
    if https != "ok" {
        return https;
    }
    optional_https_csv_env_status("OAUTH_ALLOWED_REDIRECT_URIS")
}

fn required_https_env_status(names: &[&str]) -> String {
    let invalid: Vec<&str> = names
        .iter()
        .copied()
        .filter(|name| std::env::var(name).map_or(true, |value| !is_https_url(value.trim())))
        .collect();
    if invalid.is_empty() {
        "ok".to_owned()
    } else {
        tracing::warn!(invalid = %invalid.join(","), "readiness HTTPS URL check failed");
        "error".to_owned()
    }
}

fn optional_https_csv_env_status(name: &str) -> String {
    let Ok(value) = std::env::var(name) else {
        return "ok".to_owned();
    };
    let invalid = value
        .split(',')
        .map(str::trim)
        .any(|url| !url.is_empty() && !is_https_url(url));
    if invalid {
        tracing::warn!(
            name,
            "readiness OAuth redirect allowlist HTTPS check failed"
        );
        "error".to_owned()
    } else {
        "ok".to_owned()
    }
}

fn is_https_url(value: &str) -> bool {
    value
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
}

async fn postgres_status(state: &AppState) -> String {
    state
        .global_db
        .ping()
        .await
        .map_or_else(|e| readiness_error("postgres", e), |()| "ok".to_owned())
}

async fn postgres_schema_status(state: &AppState) -> String {
    match state.global_db.migration_status().await {
        Ok(status) if status.is_ready() => "ok".to_owned(),
        Ok(status) => {
            tracing::warn!(
                expected_latest = ?status.expected_latest_version,
                applied_latest = ?status.applied_latest_version,
                pending = ?status.pending_versions,
                dirty = ?status.dirty_versions,
                checksum_mismatch = ?status.checksum_mismatch_versions,
                unknown_applied = ?status.unknown_applied_versions,
                "readiness migration status check failed"
            );
            "error".to_owned()
        }
        Err(e) => readiness_error("postgres_schema", e),
    }
}

fn sync_config_status(config: &ServerConfig) -> String {
    let path = sync_config_path_from_env();
    match SyncConfig::load_file(&path) {
        Ok(_) => "ok".to_owned(),
        Err(e) if config.require_sync_config => readiness_error("sync_config", e),
        Err(_) => "skipped".to_owned(),
    }
}

async fn redis_status(redis_url: Option<&str>, required: bool) -> String {
    let Some(url) = redis_url.filter(|url| !url.trim().is_empty()) else {
        if required {
            tracing::warn!("readiness Redis check failed: REDIS_URL is required");
            return "missing".to_owned();
        }
        return "skipped".to_owned();
    };
    let client = match redis::Client::open(url) {
        Ok(client) => client,
        Err(e) => return readiness_error("redis", e),
    };
    let mut conn = match client.get_connection_manager().await {
        Ok(conn) => conn,
        Err(e) => return readiness_error("redis", e),
    };
    redis::cmd("PING")
        .query_async::<String>(&mut conn)
        .await
        .map_or_else(|e| readiness_error("redis", e), |_| "ok".to_owned())
}

fn readiness_error(component: &'static str, error: impl fmt::Display) -> String {
    let safe_error = crate::logging::redact_sensitive_log_text(error);
    tracing::warn!(component, error = %safe_error, "readiness check failed");
    "error".to_owned()
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
    fn required_env_reports_missing_without_names() {
        let _guard = env_lock();
        let previous = std::env::var_os("POLICY_SERVER_TEST_REQUIRED_ENV");
        std::env::remove_var("POLICY_SERVER_TEST_REQUIRED_ENV");
        let status = required_env_status(&["POLICY_SERVER_TEST_REQUIRED_ENV"]);
        assert_eq!(status, "missing");
        restore_env("POLICY_SERVER_TEST_REQUIRED_ENV", previous);
    }

    #[test]
    fn jwt_secret_status_rejects_weak_secret_without_public_detail() {
        let _guard = env_lock();
        let previous = std::env::var_os("JWT_SECRET");
        std::env::set_var("JWT_SECRET", "short");
        let status = jwt_secret_status();
        assert_eq!(status, "error");
        restore_env("JWT_SECRET", previous);
    }

    #[test]
    fn required_sync_config_error_is_sanitized() {
        let _guard = env_lock();
        let previous = std::env::var_os("DAMBI_SYNC_CONFIG");
        std::env::set_var(
            "DAMBI_SYNC_CONFIG",
            "/tmp/scopeball-readiness-missing-sync-config.toml",
        );
        let mut config = ServerConfig::for_tests();
        config.require_sync_config = true;

        assert_eq!(sync_config_status(&config), "error");
        restore_env("DAMBI_SYNC_CONFIG", previous);
    }

    #[test]
    fn oauth_config_missing_required_is_sanitized() {
        let _guard = env_lock();
        let vars = [
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "GOOGLE_REDIRECT_URI",
            "DASHBOARD_URL",
            "OAUTH_ALLOWED_REDIRECT_URIS",
        ];
        let previous: Vec<_> = vars
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect();
        for name in vars {
            std::env::remove_var(name);
        }

        let mut config = ServerConfig::for_tests();
        config.require_oauth_config = true;
        assert_eq!(oauth_config_status(&config), "missing");

        config.require_oauth_config = false;
        assert_eq!(oauth_config_status(&config), "skipped");

        for (name, value) in previous {
            restore_env(name, value);
        }
    }

    #[test]
    fn oauth_config_required_rejects_non_https_redirect_targets() {
        let _guard = env_lock();
        let vars = [
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "GOOGLE_REDIRECT_URI",
            "DASHBOARD_URL",
            "OAUTH_ALLOWED_REDIRECT_URIS",
        ];
        let previous: Vec<_> = vars
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect();

        std::env::set_var("GOOGLE_CLIENT_ID", "client-id");
        std::env::set_var("GOOGLE_CLIENT_SECRET", "client-secret");
        std::env::set_var(
            "GOOGLE_REDIRECT_URI",
            "http://api.example/auth/google/callback",
        );
        std::env::set_var("DASHBOARD_URL", "https://dashboard.example");
        std::env::remove_var("OAUTH_ALLOWED_REDIRECT_URIS");

        let mut config = ServerConfig::for_tests();
        config.require_oauth_config = true;
        assert_eq!(oauth_config_status(&config), "error");

        std::env::set_var(
            "GOOGLE_REDIRECT_URI",
            "https://api.example/auth/google/callback",
        );
        std::env::set_var("DASHBOARD_URL", "http://dashboard.example");
        assert_eq!(oauth_config_status(&config), "error");

        std::env::set_var("DASHBOARD_URL", "https://dashboard.example");
        std::env::set_var(
            "OAUTH_ALLOWED_REDIRECT_URIS",
            "https://abc.chromiumapp.org/,http://127.0.0.1:5173/auth/callback",
        );
        assert_eq!(oauth_config_status(&config), "error");

        std::env::set_var(
            "OAUTH_ALLOWED_REDIRECT_URIS",
            "https://abc.chromiumapp.org/",
        );
        assert_eq!(oauth_config_status(&config), "ok");

        for (name, value) in previous {
            restore_env(name, value);
        }
    }

    #[tokio::test]
    async fn redis_error_is_sanitized() {
        assert_eq!(redis_status(Some("not a redis url"), true).await, "error");
    }

    #[tokio::test]
    async fn redis_missing_required_is_sanitized() {
        assert_eq!(redis_status(None, true).await, "missing");
        assert_eq!(redis_status(Some(""), true).await, "missing");
        assert_eq!(redis_status(None, false).await, "skipped");
    }

    #[test]
    fn migration_status_error_is_sanitized() {
        let status = policy_db::stores::postgres::PostgresMigrationStatus {
            expected_latest_version: Some(7),
            applied_latest_version: Some(6),
            pending_versions: vec![7],
            dirty_versions: Vec::new(),
            checksum_mismatch_versions: Vec::new(),
            unknown_applied_versions: Vec::new(),
        };
        assert!(!status.is_ready());
    }
}
