//! Integration: auth surface end-to-end.
//! Doesn't drive a real Google login (external dependency); instead mints
//! tokens with the same `JWT_SECRET` the server reads and exercises the
//! middleware via real HTTP.

use std::ffi::OsString;
use std::sync::Arc;

use policy_db::{GlobalDb, MultiUserStore};
use policy_server::app::{build_router, build_router_with_config, AppState};
use policy_server::auth::jwt::{issue, issue_with_claims, verify, TokenType};
use policy_server::config::ServerConfig;
use policy_server::events::{EventBus, LocalEventPublisher};
use policy_sync::{Orchestrator, SyncConfig};
use uuid::Uuid;

const TEST_SECRET: &str = "test-secret-only-do-not-use-in-production-2026-05-31";

struct EnvVarGuard {
    name: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    fn set(name: &'static str, value: &str) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => std::env::set_var(self.name, value),
            None => std::env::remove_var(self.name),
        }
    }
}

fn ensure_jwt_secret() {
    std::env::set_var("JWT_SECRET", TEST_SECRET);
}

async fn spawn_server() -> std::net::SocketAddr {
    spawn_server_with_global_db().await.0
}

async fn spawn_server_with_global_db() -> (std::net::SocketAddr, GlobalDb) {
    ensure_jwt_secret();
    let tmp = tempfile::tempdir().unwrap();
    // Leak the tempdir into the spawned server's lifetime — these tests
    // don't outlive the runtime, and Drop on the dir while serving is fine.
    let path = tmp.keep();
    let global_db = GlobalDb::open(path.join("global.db")).unwrap();
    global_db.migrate().await.unwrap();
    let multi_user = MultiUserStore::new(path.join("users"));
    let event_bus = EventBus::new();
    let state = AppState {
        multi_user,
        global_db: global_db.clone(),
        event_bus: event_bus.clone(),
        publisher: Arc::new(LocalEventPublisher::new(event_bus)),
        orchestrator: Arc::new(Orchestrator::from_sync_config(&SyncConfig::default()).unwrap()),
        etherscan: None,
        coingecko: policy_sync::CoinGeckoClient::new(),
        coordinator: Arc::new(policy_server::coordination::NoopCoordinator),
        sync_lock_ttl: std::time::Duration::from_secs(120),
    };
    let router = build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (addr, global_db)
}

async fn spawn_server_with_cors(
    origins: Vec<&str>,
    allow_private_network: bool,
) -> std::net::SocketAddr {
    let mut config = ServerConfig::for_tests();
    config.cors_allowed_origins = origins.into_iter().map(str::to_owned).collect();
    config.allow_private_network = allow_private_network;
    spawn_server_with_config_value(config).await
}

async fn spawn_server_with_config_value(config: ServerConfig) -> std::net::SocketAddr {
    ensure_jwt_secret();
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.keep();
    let global_db = GlobalDb::open(path.join("global.db")).unwrap();
    let multi_user = MultiUserStore::new(path.join("users"));
    let event_bus = EventBus::new();
    let state = AppState {
        multi_user,
        global_db,
        event_bus: event_bus.clone(),
        publisher: Arc::new(LocalEventPublisher::new(event_bus)),
        orchestrator: Arc::new(Orchestrator::from_sync_config(&SyncConfig::default()).unwrap()),
        etherscan: None,
        coingecko: policy_sync::CoinGeckoClient::new(),
        coordinator: Arc::new(policy_server::coordination::NoopCoordinator),
        sync_lock_ttl: std::time::Duration::from_secs(120),
    };
    let router = build_router_with_config(state, &config);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    addr
}

async fn spawn_server_with_origin_allowlist(origins: Vec<&str>) -> std::net::SocketAddr {
    spawn_server_with_cors(origins, true).await
}

#[tokio::test]
async fn http_body_limit_rejects_oversized_public_post_before_handler() {
    let mut config = ServerConfig::for_tests();
    config.http_body_limit_bytes = 32;
    let addr = spawn_server_with_config_value(config).await;
    let body = format!(r#"{{"refresh_token":"{}"}}"#, "x".repeat(128));

    let resp = reqwest::Client::new()
        .post(format!("http://{addr}/auth/refresh"))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn no_token_yields_401_with_json_error() {
    let addr = spawn_server().await;
    let resp = reqwest::get(format!("http://{addr}/wallets"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["error"], "unauthorized");
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn malformed_authorization_yields_401() {
    let addr = spawn_server().await;
    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/wallets"))
        .header("Authorization", "Token foo.bar.baz")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn expired_token_yields_401() {
    ensure_jwt_secret();
    let addr = spawn_server().await;
    let expired = issue("u_x", "x@e.com", TokenType::Access, Some(-10)).unwrap();
    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/wallets"))
        .bearer_auth(&expired)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn refresh_token_cannot_access_protected_routes() {
    ensure_jwt_secret();
    let addr = spawn_server().await;
    let refresh = issue("u_x", "x@e.com", TokenType::Refresh, None).unwrap();
    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/wallets"))
        .bearer_auth(&refresh)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn market_report_admin_routes_reject_non_admin_email() {
    if std::env::var("TEST_DATABASE_URL").is_err() {
        return;
    }
    let _guard = EnvVarGuard::set("MARKET_ADMIN_EMAILS", "admin@example.com");
    ensure_jwt_secret();
    let (addr, global_db) = spawn_server_with_global_db().await;
    let suffix = Uuid::new_v4();
    let email = format!("member-{suffix}@example.com");
    let user_id = global_db.upsert_user(&email, "test").await.unwrap();
    let token = issue(&user_id, &email, TokenType::Access, None).unwrap();
    let client = reqwest::Client::new();

    let list_resp = client
        .get(format!("http://{addr}/market/reports"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), reqwest::StatusCode::FORBIDDEN);

    let patch_resp = client
        .patch(format!(
            "http://{addr}/market/reports/00000000-0000-0000-0000-000000000001"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "status": "resolved" }))
        .send()
        .await
        .unwrap();
    assert_eq!(patch_resp.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn market_report_admin_routes_use_current_db_email_not_stale_token_claim() {
    if std::env::var("TEST_DATABASE_URL").is_err() {
        return;
    }
    let _guard = EnvVarGuard::set("MARKET_ADMIN_EMAILS", "admin@example.com");
    ensure_jwt_secret();
    let (addr, global_db) = spawn_server_with_global_db().await;
    let suffix = Uuid::new_v4();
    let original_email = "admin@example.com";
    let renamed_email = format!("admin-renamed-{suffix}@example.com");
    let subject = format!("admin-report-test-subject-{suffix}");
    let user_id = global_db
        .upsert_oauth_user(original_email, "google", &subject)
        .await
        .unwrap();
    let stale_admin_token = issue(&user_id, original_email, TokenType::Access, None).unwrap();
    assert_eq!(
        global_db
            .upsert_oauth_user(&renamed_email, "google", &subject)
            .await
            .unwrap(),
        user_id,
        "setup should simulate an admin email losing its allowlisted address"
    );

    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/market/reports"))
        .bearer_auth(&stale_admin_token)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn auth_me_uses_current_db_email_not_stale_token_claim() {
    if std::env::var("TEST_DATABASE_URL").is_err() {
        return;
    }
    ensure_jwt_secret();
    let (addr, global_db) = spawn_server_with_global_db().await;
    let suffix = Uuid::new_v4();
    let original_email = format!("me-original-{suffix}@example.com");
    let renamed_email = format!("me-renamed-{suffix}@example.com");
    let subject = format!("me-test-subject-{suffix}");
    let user_id = global_db
        .upsert_oauth_user(&original_email, "google", &subject)
        .await
        .unwrap();
    let stale_access_token = issue(&user_id, &original_email, TokenType::Access, None).unwrap();
    assert_eq!(
        global_db
            .upsert_oauth_user(&renamed_email, "google", &subject)
            .await
            .unwrap(),
        user_id,
        "setup should simulate a Google email change for the same subject"
    );

    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/auth/me"))
        .bearer_auth(&stale_access_token)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["user_id"], user_id);
    assert_eq!(
        body["email"], renamed_email,
        "/auth/me must render the current DB email, not stale JWT email"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn refresh_token_rotates_and_rejects_replay() {
    if std::env::var("TEST_DATABASE_URL").is_err() {
        return;
    }
    ensure_jwt_secret();
    let (addr, global_db) = spawn_server_with_global_db().await;
    let suffix = Uuid::new_v4();
    let original_email = format!("refresh-{suffix}@example.com");
    let renamed_email = format!("refresh-renamed-{suffix}@example.com");
    let subject = format!("refresh-test-subject-{suffix}");
    let user_id = global_db
        .upsert_user(&original_email, "google")
        .await
        .unwrap();
    let (refresh, refresh_claims) =
        issue_with_claims(&user_id, &original_email, TokenType::Refresh, None).unwrap();
    global_db
        .create_refresh_session(
            &user_id,
            refresh_claims.token_id().unwrap(),
            refresh_claims.iat,
            refresh_claims.exp,
        )
        .await
        .unwrap();
    assert_eq!(
        global_db
            .upsert_oauth_user(&original_email, "google", &subject)
            .await
            .unwrap(),
        user_id,
        "setup should link the legacy row to the Google subject"
    );
    assert_eq!(
        global_db
            .upsert_oauth_user(&renamed_email, "google", &subject)
            .await
            .unwrap(),
        user_id,
        "setup should simulate a Google email change for the same subject"
    );

    let res = reqwest::Client::new()
        .post(format!("http://{addr}/auth/refresh"))
        .json(&serde_json::json!({ "refresh_token": &refresh }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let json: serde_json::Value = res.json().await.unwrap();
    let access = json["access_token"].as_str().unwrap();
    let claims = verify(access).unwrap();
    assert_eq!(claims.sub, user_id);
    assert_eq!(
        claims.email, renamed_email,
        "refresh must mint access tokens with the current DB email, not stale refresh-token email"
    );
    assert!(claims.is_access());
    let rotated_refresh = json["refresh_token"].as_str().unwrap();
    let rotated_claims = verify(rotated_refresh).unwrap();
    assert_eq!(rotated_claims.email, renamed_email);
    assert!(rotated_claims.is_refresh());

    let replay = reqwest::Client::new()
        .post(format!("http://{addr}/auth/refresh"))
        .json(&serde_json::json!({ "refresh_token": refresh }))
        .send()
        .await
        .unwrap();

    assert_eq!(replay.status(), 400);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn valid_access_token_reaches_handler() {
    ensure_jwt_secret();
    let addr = spawn_server().await;
    let token = issue("u_x", "x@e.com", TokenType::Access, None).unwrap();
    let resp = reqwest::Client::new()
        .get(format!("http://{addr}/wallets"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn health_is_public_without_token() {
    let addr = spawn_server().await;
    let resp = reqwest::get(format!("http://{addr}/health")).await.unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn google_redirect_when_env_configured() {
    ensure_jwt_secret();
    std::env::set_var("GOOGLE_CLIENT_ID", "test-client-id");
    std::env::set_var(
        "GOOGLE_REDIRECT_URI",
        "http://127.0.0.1:8788/auth/google/callback",
    );
    let addr = spawn_server().await;
    let resp = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(format!("http://{addr}/auth/google"))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_redirection(),
        "expected redirect, got {}",
        resp.status()
    );
    let location = resp.headers().get("location").unwrap().to_str().unwrap();
    assert!(location.contains("accounts.google.com"), "loc={location}");
    assert!(location.contains("client_id=test-client-id"));
    let set_cookie = resp.headers().get("set-cookie").unwrap().to_str().unwrap();
    assert!(
        set_cookie.contains("scopeball_oauth_state="),
        "cookie={set_cookie}"
    );
    assert!(set_cookie.contains("HttpOnly"), "cookie={set_cookie}");
    assert!(set_cookie.contains("SameSite=Lax"), "cookie={set_cookie}");
    assert!(
        set_cookie.contains("Path=/auth/google"),
        "cookie={set_cookie}"
    );
    assert!(
        !set_cookie.contains("Secure"),
        "local HTTP callback must keep dev cookie sendable: {set_cookie}"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn cors_rejects_unconfigured_origin() {
    let addr = spawn_server_with_origin_allowlist(vec!["https://dambi-policy.duckdns.org"]).await;
    let res = reqwest::Client::new()
        .request(reqwest::Method::OPTIONS, format!("http://{addr}/auth/me"))
        .header("origin", "https://evil.example")
        .header("access-control-request-method", "GET")
        .send()
        .await
        .unwrap();

    assert!(
        res.headers().get("access-control-allow-origin").is_none(),
        "unconfigured origins must not receive CORS approval"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn cors_allows_configured_dashboard_origin() {
    let addr = spawn_server_with_origin_allowlist(vec!["https://dambi-policy.duckdns.org"]).await;
    let res = reqwest::Client::new()
        .request(reqwest::Method::OPTIONS, format!("http://{addr}/auth/me"))
        .header("origin", "https://dambi-policy.duckdns.org")
        .header("access-control-request-method", "GET")
        .send()
        .await
        .unwrap();

    assert_eq!(
        res.headers()
            .get("access-control-allow-origin")
            .unwrap()
            .to_str()
            .unwrap(),
        "https://dambi-policy.duckdns.org"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn cors_omits_private_network_approval_when_disabled() {
    let addr = spawn_server_with_cors(vec!["https://dambi-policy.duckdns.org"], false).await;
    let res = reqwest::Client::new()
        .request(reqwest::Method::OPTIONS, format!("http://{addr}/auth/me"))
        .header("origin", "https://dambi-policy.duckdns.org")
        .header("access-control-request-method", "GET")
        .header("access-control-request-private-network", "true")
        .send()
        .await
        .unwrap();

    assert!(
        res.headers()
            .get("access-control-allow-private-network")
            .is_none(),
        "private-network approval must require explicit opt-in"
    );
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL PostgreSQL integration database"]
async fn cors_emits_private_network_approval_when_enabled() {
    let addr = spawn_server_with_cors(vec!["https://dambi-policy.duckdns.org"], true).await;
    let res = reqwest::Client::new()
        .request(reqwest::Method::OPTIONS, format!("http://{addr}/auth/me"))
        .header("origin", "https://dambi-policy.duckdns.org")
        .header("access-control-request-method", "GET")
        .header("access-control-request-private-network", "true")
        .send()
        .await
        .unwrap();

    assert_eq!(
        res.headers()
            .get("access-control-allow-private-network")
            .unwrap()
            .to_str()
            .unwrap(),
        "true"
    );
}
