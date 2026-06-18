//! Runtime configuration for the policy server.
//! Cloud deployments should inject these values through environment
//! variables. Tests use [`ServerConfig::for_tests`] so router behavior can be
//! exercised without mutating process-wide env for every case.

use std::env;

pub const DEFAULT_HTTP_BODY_LIMIT_BYTES: usize = 1_048_576;

/// Log output format selected by `LOG_FORMAT`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogFormat {
    /// Human-readable lines (local dev default).
    Human,
    /// One JSON object per line (GKE Cloud Logging).
    Json,
}

impl LogFormat {
    fn from_env_value(v: &str) -> Self {
        if v.eq_ignore_ascii_case("json") {
            Self::Json
        } else {
            Self::Human
        }
    }
}

/// Typed runtime configuration shared by the API server and worker processes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerConfig {
    /// Socket address the API process binds to.
    pub bind_addr: String,
    /// Public dashboard origin used by OAuth redirects and default CORS.
    pub dashboard_url: String,
    /// Public API URL advertised to browser clients.
    pub public_api_url: String,
    /// Exact origins that may call authenticated HTTP APIs from a browser.
    pub cors_allowed_origins: Vec<String>,
    /// Whether to emit the private-network CORS approval header.
    pub allow_private_network: bool,
    /// Durable `PostgreSQL` database URL. Required by process startup.
    pub database_url: Option<String>,
    /// Redis URL for coordination/fanout. `None` keeps in-process dev mode.
    pub redis_url: Option<String>,
    /// Whether production startup/readiness should fail when Redis is absent.
    pub require_redis: bool,
    /// Whether readiness should fail when Google OAuth/dashboard config is absent.
    pub require_oauth_config: bool,
    /// Whether API/worker startup should apply database migrations.
    pub run_migrations_on_startup: bool,
    /// Whether a missing or invalid sync config makes readiness fail.
    pub require_sync_config: bool,
    /// TTL for distributed sync locks, in seconds.
    pub sync_lock_ttl_secs: u64,
    /// Redis pub/sub channel used for cross-replica event fanout.
    pub redis_events_channel: String,
    /// Max accepted HTTP request body size before JSON extraction.
    pub http_body_limit_bytes: usize,
    /// Max Postgres pool connections per process.
    pub db_max_connections: u32,
    /// Seconds to wait for a pool connection before erroring.
    pub db_acquire_timeout_secs: u64,
    /// Max startup DB-connect retry attempts before giving up.
    pub db_connect_max_retries: u32,
    /// Base backoff (seconds) between startup DB-connect retries.
    pub db_connect_backoff_secs: u64,
    /// Tracing output format.
    pub log_format: LogFormat,
}

impl ServerConfig {
    /// Load configuration from environment variables.
    #[must_use]
    pub fn from_env() -> Self {
        let sync_worker_tick_secs = env_u64("SYNC_WORKER_TICK_SECS", 30);
        Self {
            bind_addr: env::var("POLICY_SERVER_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:8788".to_owned()),
            dashboard_url: env::var("DASHBOARD_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:5173".to_owned()),
            public_api_url: env::var("PUBLIC_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8788".to_owned()),
            cors_allowed_origins: env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| ["http://127.0.0.1:5173", "http://localhost:5173"].join(","))
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            allow_private_network: env::var("CORS_ALLOW_PRIVATE_NETWORK")
                .map_or(false, |v| v == "1" || v.eq_ignore_ascii_case("true")),
            database_url: env::var("DATABASE_URL").ok(),
            redis_url: env::var("REDIS_URL").ok(),
            require_redis: env_bool("REQUIRE_REDIS", false),
            require_oauth_config: env_bool("REQUIRE_OAUTH_CONFIG", false),
            run_migrations_on_startup: env_bool("RUN_MIGRATIONS_ON_STARTUP", true),
            require_sync_config: env_bool("REQUIRE_SYNC_CONFIG", false),
            sync_lock_ttl_secs: env::var("SYNC_LOCK_TTL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| (sync_worker_tick_secs * 4).max(120)),
            redis_events_channel: env::var("REDIS_EVENTS_CHANNEL")
                .unwrap_or_else(|_| "policy-server:events".to_owned()),
            http_body_limit_bytes: env_usize(
                "HTTP_BODY_LIMIT_BYTES",
                DEFAULT_HTTP_BODY_LIMIT_BYTES,
            ),
            db_max_connections: env_u32("DB_MAX_CONNECTIONS", 10),
            db_acquire_timeout_secs: env_u64("DB_ACQUIRE_TIMEOUT_SECS", 10),
            db_connect_max_retries: env_u32("DB_CONNECT_MAX_RETRIES", 12),
            db_connect_backoff_secs: env_u64("DB_CONNECT_BACKOFF_SECS", 5),
            log_format: env::var("LOG_FORMAT")
                .map_or(LogFormat::Human, |v| LogFormat::from_env_value(&v)),
        }
    }

    /// Deterministic defaults for integration tests.
    #[must_use]
    pub fn for_tests() -> Self {
        Self {
            bind_addr: "127.0.0.1:0".to_owned(),
            dashboard_url: "http://127.0.0.1:5173".to_owned(),
            public_api_url: "http://127.0.0.1:8788".to_owned(),
            cors_allowed_origins: vec!["http://127.0.0.1:5173".to_owned()],
            allow_private_network: true,
            database_url: env::var("TEST_DATABASE_URL")
                .ok()
                .or_else(|| Some("postgres://dambi:dambi@127.0.0.1:5432/dambi_test".to_owned())),
            redis_url: None,
            require_redis: false,
            require_oauth_config: false,
            run_migrations_on_startup: true,
            require_sync_config: false,
            sync_lock_ttl_secs: 120,
            redis_events_channel: "policy-server:test-events".to_owned(),
            http_body_limit_bytes: DEFAULT_HTTP_BODY_LIMIT_BYTES,
            db_max_connections: 5,
            db_acquire_timeout_secs: 10,
            db_connect_max_retries: 1,
            db_connect_backoff_secs: 1,
            log_format: LogFormat::Human,
        }
    }
}

fn env_bool(name: &str, default: bool) -> bool {
    env::var(name).map_or(default, |v| {
        v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes")
    })
}

fn env_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_u32(name: &str, default: u32) -> u32 {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::{env_u32, LogFormat, ServerConfig, DEFAULT_HTTP_BODY_LIMIT_BYTES};
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
    fn env_u32_parses_and_defaults() {
        std::env::remove_var("POLICY_TEST_DB_MAX_CONN");
        assert_eq!(env_u32("POLICY_TEST_DB_MAX_CONN", 10), 10);
        std::env::set_var("POLICY_TEST_DB_MAX_CONN", "25");
        assert_eq!(env_u32("POLICY_TEST_DB_MAX_CONN", 10), 25);
        std::env::remove_var("POLICY_TEST_DB_MAX_CONN");
    }

    #[test]
    fn for_tests_has_pool_defaults() {
        let c = ServerConfig::for_tests();
        assert_eq!(c.http_body_limit_bytes, DEFAULT_HTTP_BODY_LIMIT_BYTES);
        assert_eq!(c.db_max_connections, 5);
        assert_eq!(c.db_connect_max_retries, 1);
        assert_eq!(c.log_format, LogFormat::Human);
    }

    #[test]
    fn from_env_denies_private_network_by_default() {
        let _guard = env_lock();
        let previous = std::env::var_os("CORS_ALLOW_PRIVATE_NETWORK");
        std::env::remove_var("CORS_ALLOW_PRIVATE_NETWORK");

        let c = ServerConfig::from_env();
        assert!(
            !c.allow_private_network,
            "private-network CORS must be an explicit opt-in"
        );

        restore_env("CORS_ALLOW_PRIVATE_NETWORK", previous);
    }

    #[test]
    fn from_env_sets_http_body_limit_with_safe_default() {
        let _guard = env_lock();
        let previous = std::env::var_os("HTTP_BODY_LIMIT_BYTES");

        std::env::remove_var("HTTP_BODY_LIMIT_BYTES");
        assert_eq!(
            ServerConfig::from_env().http_body_limit_bytes,
            DEFAULT_HTTP_BODY_LIMIT_BYTES
        );

        std::env::set_var("HTTP_BODY_LIMIT_BYTES", "2048");
        assert_eq!(ServerConfig::from_env().http_body_limit_bytes, 2048);

        std::env::set_var("HTTP_BODY_LIMIT_BYTES", "not-a-number");
        assert_eq!(
            ServerConfig::from_env().http_body_limit_bytes,
            DEFAULT_HTTP_BODY_LIMIT_BYTES
        );

        restore_env("HTTP_BODY_LIMIT_BYTES", previous);
    }

    #[test]
    fn from_env_requires_redis_only_when_explicit() {
        let _guard = env_lock();
        let previous = std::env::var_os("REQUIRE_REDIS");

        std::env::remove_var("REQUIRE_REDIS");
        assert!(!ServerConfig::from_env().require_redis);

        std::env::set_var("REQUIRE_REDIS", "true");
        assert!(ServerConfig::from_env().require_redis);

        std::env::set_var("REQUIRE_REDIS", "false");
        assert!(!ServerConfig::from_env().require_redis);

        restore_env("REQUIRE_REDIS", previous);
    }

    #[test]
    fn from_env_requires_oauth_config_only_when_explicit() {
        let _guard = env_lock();
        let previous = std::env::var_os("REQUIRE_OAUTH_CONFIG");

        std::env::remove_var("REQUIRE_OAUTH_CONFIG");
        assert!(!ServerConfig::from_env().require_oauth_config);

        std::env::set_var("REQUIRE_OAUTH_CONFIG", "true");
        assert!(ServerConfig::from_env().require_oauth_config);

        std::env::set_var("REQUIRE_OAUTH_CONFIG", "false");
        assert!(!ServerConfig::from_env().require_oauth_config);

        restore_env("REQUIRE_OAUTH_CONFIG", previous);
    }

    #[test]
    fn from_env_allows_private_network_only_when_explicit() {
        let _guard = env_lock();
        let previous = std::env::var_os("CORS_ALLOW_PRIVATE_NETWORK");

        std::env::set_var("CORS_ALLOW_PRIVATE_NETWORK", "true");
        assert!(ServerConfig::from_env().allow_private_network);

        std::env::set_var("CORS_ALLOW_PRIVATE_NETWORK", "1");
        assert!(ServerConfig::from_env().allow_private_network);

        std::env::set_var("CORS_ALLOW_PRIVATE_NETWORK", "false");
        assert!(!ServerConfig::from_env().allow_private_network);

        restore_env("CORS_ALLOW_PRIVATE_NETWORK", previous);
    }
}
