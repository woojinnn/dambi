//! Google OAuth 2.0 login.
//!
//! Two endpoints, both unauthenticated:
//! - `GET /auth/google` — redirects the browser to Google's authorize URL.
//! - `GET /auth/google/callback?code=…&state=…` — receives the code,
//!   exchanges it for an `id_token`, decodes the email, upserts the user
//!   in [`GlobalDb`], mints an access token, and 302s back to the dashboard
//!   with the access token in the URL fragment. Refresh tokens are minted only
//!   for explicit allowlisted extension redirects, not for the default web
//!   dashboard flow.
//!
//! The callback intentionally uses a URL **fragment** (`#access_token=…`)
//! rather than a query string so the token never reaches the server logs
//! of the dashboard host (browsers strip fragments from `Referer`).
//!
//! State token (CSRF): a short random nonce is stored in an `HttpOnly` cookie
//! and signed into a brief-lived JWT alongside the final redirect. Google
//! echoes the JWT back; the callback verifies both the signature and cookie
//! nonce. This avoids server-side session storage while still binding callback
//! completion to the browser that started the flow.

use std::{
    env,
    sync::{Mutex, OnceLock},
};

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use policy_db::GlobalDb;

use crate::auth::jwt::{self, TokenType};

const OAUTH_STATE_SUBJECT: &str = "oauth-state";
const OAUTH_STATE_TTL_SECS: i64 = jwt::OAUTH_STATE_TTL_SECS;
const OAUTH_STATE_COOKIE: &str = "scopeball_oauth_state";
const OAUTH_STATE_COOKIE_PATH: &str = "/auth/google";

/// Optional query for [`start_google_login`]. `redirect_uri`, when present,
/// names where the callback delivers the token fragment instead of the
/// default `DASHBOARD_URL` — used by the browser extension, which logs in via
/// `chrome.identity.launchWebAuthFlow` and needs the token bounced to its
/// `https://<id>.chromiumapp.org/` virtual redirect. It MUST exactly match an
/// entry in `OAUTH_ALLOWED_REDIRECT_URIS`; without that allowlist this would
/// be an open redirect leaking the freshly-minted JWT to any host.
#[derive(Debug, Deserialize)]
pub struct StartQuery {
    pub redirect_uri: Option<String>,
}

/// `GET /auth/google` — bounce the user to Google's consent screen.
/// All config (`GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`) read at request
/// time so a missing env var surfaces as a clear 500 rather than a
/// startup-time panic.
pub async fn start_google_login(Query(q): Query<StartQuery>) -> Response {
    let Ok(client_id) = env::var("GOOGLE_CLIENT_ID") else {
        return env_missing("GOOGLE_CLIENT_ID");
    };
    let Ok(redirect_uri) = env::var("GOOGLE_REDIRECT_URI") else {
        return env_missing("GOOGLE_REDIRECT_URI");
    };

    // Where the callback should finally deliver the token. Empty == "use the
    // default DASHBOARD_URL flow". A non-empty value MUST be allowlisted
    // (exact match) — reject early with a diagnostic so a slash/ID mismatch
    // is obvious instead of a generic failure.
    let final_redirect = q.redirect_uri.unwrap_or_default();
    if !final_redirect.is_empty() && !redirect_allowed(&final_redirect, &allowed_redirects()) {
        return user_error(&format!("redirect_uri not allowed: {final_redirect}"));
    }

    let nonce = Uuid::new_v4().to_string();
    // Carry the validated redirect plus CSRF nonce inside the signed state JWT.
    // The nonce is also stored in a short-lived HttpOnly cookie and compared on
    // callback, so a state token minted for one browser flow cannot complete a
    // different browser's login.
    let state = match issue_oauth_state(&final_redirect, &nonce) {
        Ok(s) => s,
        Err(e) => return server_error(&format!("state token: {e}")),
    };

    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?response_type=code\
         &client_id={client_id}\
         &redirect_uri={redirect_uri}\
         &scope=openid+email\
         &state={state}\
         &access_type=online\
         &prompt=select_account",
        client_id = urlencoding::encode(&client_id),
        redirect_uri = urlencoding::encode(&redirect_uri),
        state = urlencoding::encode(&state),
    );
    let mut response = Redirect::to(&url).into_response();
    match HeaderValue::from_str(&oauth_state_cookie(&nonce, &redirect_uri)) {
        Ok(value) => {
            response.headers_mut().insert(header::SET_COOKIE, value);
            response
        }
        Err(e) => server_error(&format!("state cookie: {e}")),
    }
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResp {
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// `GET /auth/google/callback?code=…&state=…` — finish the OAuth dance.
pub async fn google_callback(
    State(global): State<GlobalDb>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Response {
    if let Some(err) = q.error {
        return user_error(&format!("Google denied login: {err}"));
    }
    let Some(code) = q.code else {
        return user_error("missing `code` parameter");
    };
    let Some(state) = q.state else {
        return user_error("missing `state` parameter");
    };
    // Verify CSRF state and bind it to the browser flow that initiated login.
    let oauth_state = match verify_oauth_state(&state) {
        Ok(state) => state,
        Err(_) => return user_error("invalid or expired `state`"),
    };
    let Some(cookie_nonce) = oauth_state_nonce_from_headers(&headers) else {
        return user_error("missing OAuth state cookie");
    };
    if cookie_nonce != oauth_state.nonce {
        return user_error("OAuth state mismatch");
    }

    let id_token = match exchange_code_for_id_token(&code).await {
        Ok(t) => t,
        Err(e) => return server_error(&format!("token exchange failed: {e}")),
    };
    let identity = match verify_identity_from_google_id_token(&id_token).await {
        Ok(identity) => identity,
        Err(e) => return server_error(&format!("id_token verify: {e}")),
    };

    let user_id = match global
        .upsert_oauth_user(&identity.email, "google", &identity.subject)
        .await
    {
        Ok(id) => id,
        Err(e) => return server_error(&format!("upsert_oauth_user: {e}")),
    };
    let current_user = match global.get_user_by_id(&user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return server_error("load oauth user: missing after upsert"),
        Err(e) => return server_error(&format!("load oauth user: {e}")),
    };

    let access = match jwt::issue(&user_id, &current_user.email, TokenType::Access, None) {
        Ok(t) => t,
        Err(e) => return server_error(&format!("issue access: {e}")),
    };
    let allowlist = allowed_redirects();
    let refresh = if should_deliver_refresh_token(&oauth_state.redirect_uri, &allowlist) {
        let (refresh, refresh_claims) =
            match jwt::issue_with_claims(&user_id, &current_user.email, TokenType::Refresh, None) {
                Ok(pair) => pair,
                Err(e) => return server_error(&format!("issue refresh: {e}")),
            };
        let Some(refresh_jti) = refresh_claims.token_id() else {
            return server_error("issue refresh: missing token id");
        };
        if let Err(e) = global
            .create_refresh_session(
                &user_id,
                refresh_jti,
                refresh_claims.iat,
                refresh_claims.exp,
            )
            .await
        {
            return server_error(&format!("create refresh session: {e}"));
        }
        Some(refresh)
    } else {
        None
    };

    // Deliver the token: to the signed+allowlisted redirect the client asked
    // for (the extension's chromiumapp.org virtual URL), else the default
    // dashboard flow. DASHBOARD_URL stays configurable for dev/prod. The
    // default web-dashboard target is access-only so a long-lived refresh token
    // never lands in a normal web origin's URL fragment/localStorage.
    let dashboard = env::var("DASHBOARD_URL").unwrap_or_else(|_| "http://127.0.0.1:5173".into());
    let target = build_redirect_target(
        &oauth_state.redirect_uri,
        &allowlist,
        &dashboard,
        &access,
        refresh.as_deref(),
    );
    let mut response = Redirect::to(&target).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "scopeball_oauth_state=; Max-Age=0; Path=/auth/google; HttpOnly; SameSite=Lax",
        ),
    );
    response
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// `POST /auth/refresh` — rotate a server-tracked refresh session and mint a
/// new access token. Reusing the old refresh token after rotation is rejected.
pub async fn refresh_token(
    State(global): State<GlobalDb>,
    Json(req): Json<RefreshRequest>,
) -> Response {
    let claims = match jwt::verify(&req.refresh_token) {
        Ok(c) if c.is_refresh() => c,
        Ok(_) => return user_error("access token cannot refresh a session"),
        Err(e) => return user_error(&format!("invalid refresh token: {e}")),
    };
    let Some(old_jti) = claims.token_id() else {
        return user_error("invalid refresh token");
    };
    let user = match global.get_user_by_id(&claims.sub).await {
        Ok(Some(user)) => user,
        Ok(None) => return user_error("invalid refresh token"),
        Err(e) => return server_error(&format!("load refresh user: {e}")),
    };

    let access = match jwt::issue(&claims.sub, &user.email, TokenType::Access, None) {
        Ok(t) => t,
        Err(e) => return server_error(&format!("issue access: {e}")),
    };
    let (refresh, refresh_claims) =
        match jwt::issue_with_claims(&claims.sub, &user.email, TokenType::Refresh, None) {
            Ok(pair) => pair,
            Err(e) => return server_error(&format!("issue refresh: {e}")),
        };
    let Some(new_jti) = refresh_claims.token_id() else {
        return server_error("issue refresh: missing token id");
    };

    match global
        .rotate_refresh_session(
            &claims.sub,
            old_jti,
            new_jti,
            refresh_claims.iat,
            refresh_claims.exp,
        )
        .await
    {
        Ok(true) => {}
        Ok(false) => return user_error("invalid or replayed refresh token"),
        Err(e) => return server_error(&format!("rotate refresh session: {e}")),
    }

    Json(json!({
        "access_token": access,
        "refresh_token": refresh,
    }))
    .into_response()
}

// ---------- redirect allowlist ----------

/// Read the comma-separated redirect allowlist from the environment. Unset →
/// empty → nothing extra allowed (fail-closed); the default `DASHBOARD_URL` path
/// doesn't pass through the allowlist.
fn allowed_redirects() -> String {
    env::var("OAUTH_ALLOWED_REDIRECT_URIS").unwrap_or_default()
}

/// Exact-match `uri` against a comma-separated `allowlist`. Exact (not prefix)
/// on purpose: a prefix match on `https://evil.com` would accept
/// `https://evil.com.attacker.net`.
fn redirect_allowed(uri: &str, allowlist: &str) -> bool {
    allowlist
        .split(',')
        .map(str::trim)
        .any(|a| !a.is_empty() && a == uri)
}

/// Build the final 302 target carrying the token fragment. A non-empty,
/// allowlisted `carried` redirect wins; anything else (empty, or — defensively
/// — not allowlisted) falls back to the trusted `DASHBOARD_URL` flow so the
/// default login never errors.
fn build_redirect_target(
    carried: &str,
    allowlist: &str,
    dashboard_url: &str,
    access: &str,
    refresh: Option<&str>,
) -> String {
    let mut frag = format!("#access_token={}", urlencoding::encode(access));
    if let Some(refresh) = refresh {
        frag.push_str("&refresh_token=");
        frag.push_str(&urlencoding::encode(refresh));
    }
    if !carried.is_empty() && redirect_allowed(carried, allowlist) {
        format!("{carried}{frag}")
    } else {
        format!("{dashboard_url}/auth/callback{frag}")
    }
}

fn should_deliver_refresh_token(carried: &str, allowlist: &str) -> bool {
    !carried.is_empty() && redirect_allowed(carried, allowlist)
}

#[derive(Debug, Deserialize, Serialize)]
struct OAuthState {
    nonce: String,
    redirect_uri: String,
}

fn issue_oauth_state(redirect_uri: &str, nonce: &str) -> Result<String, jwt::AuthError> {
    let state = OAuthState {
        nonce: nonce.to_owned(),
        redirect_uri: redirect_uri.to_owned(),
    };
    let encoded = serde_json::to_string(&state)
        .map_err(|e| jwt::AuthError::Invalid(format!("oauth state encode: {e}")))?;
    jwt::issue(
        OAUTH_STATE_SUBJECT,
        &encoded,
        TokenType::OAuthState,
        Some(OAUTH_STATE_TTL_SECS),
    )
}

fn verify_oauth_state(token: &str) -> Result<OAuthState, String> {
    let claims = jwt::verify(token).map_err(|e| e.to_string())?;
    if claims.sub != OAUTH_STATE_SUBJECT {
        return Err("invalid OAuth state subject".to_owned());
    }
    if !claims.is_oauth_state() {
        return Err("invalid OAuth state token type".to_owned());
    }
    let state: OAuthState =
        serde_json::from_str(&claims.email).map_err(|e| format!("OAuth state decode: {e}"))?;
    if state.nonce.trim().is_empty() {
        return Err("OAuth state nonce missing".to_owned());
    }
    Ok(state)
}

fn oauth_state_cookie(nonce: &str, redirect_uri: &str) -> String {
    let mut cookie = format!(
        "{OAUTH_STATE_COOKIE}={nonce}; Max-Age={OAUTH_STATE_TTL_SECS}; Path={OAUTH_STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax"
    );
    if oauth_state_cookie_secure(redirect_uri) {
        cookie.push_str("; Secure");
    }
    cookie
}

fn oauth_state_cookie_secure(redirect_uri: &str) -> bool {
    redirect_uri
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
}

fn oauth_state_nonce_from_headers(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let trimmed = part.trim();
        if let Some(value) = trimmed.strip_prefix(&format!("{OAUTH_STATE_COOKIE}=")) {
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

// ---------- internals ----------

/// POST `code` to Google's token endpoint, extract the `id_token`.
async fn exchange_code_for_id_token(code: &str) -> Result<String, String> {
    let client_id =
        env::var("GOOGLE_CLIENT_ID").map_err(|_| "GOOGLE_CLIENT_ID unset".to_string())?;
    let client_secret =
        env::var("GOOGLE_CLIENT_SECRET").map_err(|_| "GOOGLE_CLIENT_SECRET unset".to_string())?;
    let redirect_uri =
        env::var("GOOGLE_REDIRECT_URI").map_err(|_| "GOOGLE_REDIRECT_URI unset".to_string())?;

    let body = [
        ("code", code),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("redirect_uri", &redirect_uri),
        ("grant_type", "authorization_code"),
    ];

    let resp: TokenResp = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("JSON decode: {e}"))?;
    if let Some(err) = resp.error {
        return Err(format!(
            "{err}: {}",
            resp.error_description.unwrap_or_default()
        ));
    }
    resp.id_token.ok_or_else(|| "id_token missing".into())
}

#[derive(Debug, Deserialize)]
struct GoogleIdTokenClaims {
    iss: String,
    sub: String,
    aud: GoogleAudience,
    azp: Option<String>,
    exp: i64,
    email: String,
    email_verified: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VerifiedGoogleIdentity {
    subject: String,
    email: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum GoogleAudience {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Deserialize, Clone)]
struct GoogleJwkSet {
    keys: Vec<GoogleJwk>,
}

#[derive(Debug, Deserialize, Clone)]
struct GoogleJwk {
    kid: String,
    kty: String,
    alg: Option<String>,
    #[serde(rename = "use")]
    key_use: Option<String>,
    n: String,
    e: String,
}

#[derive(Debug, Clone)]
struct CachedGoogleJwks {
    fetched_at: i64,
    jwks: GoogleJwkSet,
}

const GOOGLE_JWKS_CACHE_TTL_SECS: i64 = 6 * 60 * 60;
static GOOGLE_JWKS_CACHE: OnceLock<Mutex<Option<CachedGoogleJwks>>> = OnceLock::new();

impl GoogleAudience {
    fn contains(&self, client_id: &str) -> bool {
        match self {
            GoogleAudience::One(aud) => aud == client_id,
            GoogleAudience::Many(audiences) => audiences.iter().any(|aud| aud == client_id),
        }
    }

    fn is_multi_valued(&self) -> bool {
        matches!(self, GoogleAudience::Many(audiences) if audiences.len() > 1)
    }
}

/// Pull the verified stable subject and email fields out of a Google
/// `id_token` (a JWT signed by Google). The token is verified against Google's
/// JWKS and then checked for issuer, audience, authorized party, expiry,
/// subject, and verified email before a local session can be minted.
async fn verify_identity_from_google_id_token(
    id_token: &str,
) -> Result<VerifiedGoogleIdentity, String> {
    let client_id =
        env::var("GOOGLE_CLIENT_ID").map_err(|_| "GOOGLE_CLIENT_ID unset".to_string())?;
    let now = now_secs();
    let jwks = fetch_google_jwks_cached(now).await?;
    verify_identity_from_id_token_with_jwks(id_token, &client_id, now, &jwks)
}

async fn fetch_google_jwks() -> Result<GoogleJwkSet, String> {
    reqwest::Client::new()
        .get("https://www.googleapis.com/oauth2/v3/certs")
        .send()
        .await
        .map_err(|e| format!("jwks HTTP error: {e}"))?
        .error_for_status()
        .map_err(|e| format!("jwks HTTP status: {e}"))?
        .json::<GoogleJwkSet>()
        .await
        .map_err(|e| format!("jwks JSON decode: {e}"))
}

async fn fetch_google_jwks_cached(now: i64) -> Result<GoogleJwkSet, String> {
    if let Some(cached) = cached_google_jwks(now) {
        return Ok(cached);
    }
    let jwks = fetch_google_jwks().await?;
    store_google_jwks(now, jwks.clone());
    Ok(jwks)
}

fn google_jwks_cache() -> &'static Mutex<Option<CachedGoogleJwks>> {
    GOOGLE_JWKS_CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_google_jwks(now: i64) -> Option<GoogleJwkSet> {
    let guard = google_jwks_cache().lock().ok()?;
    let cached = guard.as_ref()?;
    if google_jwks_cache_is_fresh(cached.fetched_at, now) {
        Some(cached.jwks.clone())
    } else {
        None
    }
}

fn store_google_jwks(now: i64, jwks: GoogleJwkSet) {
    if let Ok(mut guard) = google_jwks_cache().lock() {
        *guard = Some(CachedGoogleJwks {
            fetched_at: now,
            jwks,
        });
    }
}

fn google_jwks_cache_is_fresh(fetched_at: i64, now: i64) -> bool {
    now.saturating_sub(fetched_at) < GOOGLE_JWKS_CACHE_TTL_SECS
}

fn verify_identity_from_id_token_with_jwks(
    id_token: &str,
    client_id: &str,
    now: i64,
    jwks: &GoogleJwkSet,
) -> Result<VerifiedGoogleIdentity, String> {
    let header = jsonwebtoken::decode_header(id_token).map_err(|e| format!("jwt header: {e}"))?;
    if header.alg != jsonwebtoken::Algorithm::RS256 {
        return Err("id_token alg is not RS256".into());
    }
    let kid = header
        .kid
        .as_deref()
        .ok_or_else(|| "id_token kid missing".to_string())?;
    let jwk = jwks
        .keys
        .iter()
        .find(|key| {
            key.kid == kid
                && key.kty == "RSA"
                && key.alg.as_deref().is_none_or(|alg| alg == "RS256")
                && key.key_use.as_deref().is_none_or(|use_| use_ == "sig")
        })
        .ok_or_else(|| "id_token signing key not found in Google JWKS".to_string())?;
    let key = jsonwebtoken::DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
        .map_err(|e| format!("jwk rsa key: {e}"))?;
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.validate_aud = false;
    validation.validate_exp = false;
    let data = jsonwebtoken::decode::<GoogleIdTokenClaims>(id_token, &key, &validation)
        .map_err(|e| format!("jwt signature: {e}"))?;
    validate_google_id_token_claims(data.claims, client_id, now)
}

#[cfg(test)]
fn decode_identity_claims_from_id_token(
    id_token: &str,
    client_id: &str,
    now: i64,
) -> Result<VerifiedGoogleIdentity, String> {
    use base64::Engine;
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return Err("id_token is not 3 segments".into());
    }
    let payload_b64 = parts[1];
    let payload_json = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    let claims: GoogleIdTokenClaims =
        serde_json::from_slice(&payload_json).map_err(|e| format!("json decode: {e}"))?;
    validate_google_id_token_claims(claims, client_id, now)
}

#[cfg(test)]
fn decode_email_claims_from_id_token(
    id_token: &str,
    client_id: &str,
    now: i64,
) -> Result<String, String> {
    decode_identity_claims_from_id_token(id_token, client_id, now).map(|identity| identity.email)
}

fn validate_google_id_token_claims(
    claims: GoogleIdTokenClaims,
    client_id: &str,
    now: i64,
) -> Result<VerifiedGoogleIdentity, String> {
    if claims.iss != "https://accounts.google.com" && claims.iss != "accounts.google.com" {
        return Err("id_token issuer is not Google".into());
    }
    if !claims.aud.contains(client_id) {
        return Err("id_token audience mismatch".into());
    }
    if claims.azp.as_deref().is_some_and(|azp| azp != client_id) {
        return Err("id_token authorized party mismatch".into());
    }
    if claims.aud.is_multi_valued() && claims.azp.as_deref() != Some(client_id) {
        return Err("id_token authorized party required for multiple audiences".into());
    }
    if claims.exp + 5 < now {
        return Err("id_token expired".into());
    }
    if claims.sub.trim().is_empty() {
        return Err("sub missing from id_token".into());
    }
    if claims.email.trim().is_empty() {
        return Err("email missing from id_token".into());
    }
    if !claims.email_verified {
        return Err("email is not verified by Google".into());
    }
    Ok(VerifiedGoogleIdentity {
        subject: claims.sub,
        email: claims.email,
    })
}

fn now_secs() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

// ---------- error helpers ----------

fn env_missing(var: &str) -> Response {
    server_error(&format!("server misconfigured: env {var} not set"))
}

fn server_error(reason: &str) -> Response {
    eprintln!("oauth server_error: {reason}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "server_error", "reason": "Internal server error" })),
    )
        .into_response()
}

fn user_error(reason: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "bad_request", "reason": reason })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn set_jwt_secret() {
        std::env::set_var(
            "JWT_SECRET",
            "test-secret-only-do-not-use-in-production-2026-05-31",
        );
    }

    fn encode_id_token(payload: &serde_json::Value) -> String {
        let header = "eyJhbGciOiJSUzI1NiJ9"; // {"alg":"RS256"} — not validated by us
        let payload_b64 =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        format!("{header}.{payload_b64}.signature-not-verified")
    }

    fn valid_claims() -> serde_json::Value {
        json!({
            "iss": "https://accounts.google.com",
            "sub": "1234567890",
            "aud": "test-client-id",
            "exp": now_secs() + 300,
            "email": "alice@example.com",
            "email_verified": true
        })
    }

    #[test]
    fn decode_email_happy_path() {
        let tok = encode_id_token(&valid_claims());
        let email = decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap();
        assert_eq!(email, "alice@example.com");
    }

    #[test]
    fn decode_identity_preserves_google_subject() {
        let tok = encode_id_token(&valid_claims());
        let identity =
            decode_identity_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap();
        assert_eq!(identity.subject, "1234567890");
        assert_eq!(identity.email, "alice@example.com");
    }

    #[test]
    fn decode_email_missing_field_errors() {
        let mut claims = valid_claims();
        claims.as_object_mut().unwrap().remove("email");
        let tok = encode_id_token(&claims);
        let err =
            decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap_err();
        assert!(err.contains("email"), "got: {err}");
    }

    #[test]
    fn decode_email_malformed_token_errors() {
        let err =
            decode_email_claims_from_id_token("not.a.jwt.token", "test-client-id", now_secs())
                .unwrap_err();
        assert!(err.contains("not 3 segments"), "got: {err}");
    }

    #[test]
    fn decode_email_rejects_wrong_audience() {
        let mut claims = valid_claims();
        claims["aud"] = json!("other-client-id");
        let tok = encode_id_token(&claims);
        let err =
            decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap_err();
        assert!(err.contains("audience mismatch"), "got: {err}");
    }

    #[test]
    fn decode_email_accepts_multiple_audiences_with_matching_azp() {
        let mut claims = valid_claims();
        claims["aud"] = json!(["test-client-id", "other-client-id"]);
        claims["azp"] = json!("test-client-id");
        let tok = encode_id_token(&claims);

        let email = decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap();

        assert_eq!(email, "alice@example.com");
    }

    #[test]
    fn decode_email_rejects_multiple_audiences_without_azp() {
        let mut claims = valid_claims();
        claims["aud"] = json!(["test-client-id", "other-client-id"]);
        let tok = encode_id_token(&claims);

        let err =
            decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap_err();

        assert!(err.contains("authorized party required"), "got: {err}");
    }

    #[test]
    fn decode_email_rejects_authorized_party_mismatch() {
        let mut claims = valid_claims();
        claims["azp"] = json!("other-client-id");
        let tok = encode_id_token(&claims);

        let err =
            decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap_err();

        assert!(err.contains("authorized party mismatch"), "got: {err}");
    }

    #[test]
    fn decode_email_rejects_unverified_email() {
        let mut claims = valid_claims();
        claims["email_verified"] = json!(false);
        let tok = encode_id_token(&claims);
        let err =
            decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap_err();
        assert!(err.contains("not verified"), "got: {err}");
    }

    #[test]
    fn decode_email_rejects_expired_token() {
        let mut claims = valid_claims();
        claims["exp"] = json!(now_secs() - 30);
        let tok = encode_id_token(&claims);
        let err =
            decode_email_claims_from_id_token(&tok, "test-client-id", now_secs()).unwrap_err();
        assert!(err.contains("expired"), "got: {err}");
    }

    #[test]
    fn verify_email_rejects_unsigned_payload_decode_token() {
        let tok = encode_id_token(&valid_claims());
        let jwks = GoogleJwkSet { keys: vec![] };
        let err =
            verify_identity_from_id_token_with_jwks(&tok, "test-client-id", now_secs(), &jwks)
                .unwrap_err();
        assert!(err.contains("kid missing"), "got: {err}");
    }

    #[test]
    fn google_jwks_cache_reuses_fresh_value_and_expires() {
        if let Ok(mut guard) = google_jwks_cache().lock() {
            *guard = None;
        }

        let jwks = GoogleJwkSet {
            keys: vec![GoogleJwk {
                kid: "kid-1".to_owned(),
                kty: "RSA".to_owned(),
                alg: Some("RS256".to_owned()),
                key_use: Some("sig".to_owned()),
                n: "n".to_owned(),
                e: "AQAB".to_owned(),
            }],
        };
        store_google_jwks(100, jwks);

        assert_eq!(cached_google_jwks(100).unwrap().keys[0].kid, "kid-1");
        assert!(cached_google_jwks(100 + GOOGLE_JWKS_CACHE_TTL_SECS - 1).is_some());
        assert!(cached_google_jwks(100 + GOOGLE_JWKS_CACHE_TTL_SECS).is_none());

        if let Ok(mut guard) = google_jwks_cache().lock() {
            *guard = None;
        }
    }

    #[tokio::test]
    async fn server_error_does_not_echo_internal_reason() {
        let response = server_error("upstream-secret=do-not-echo");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(!text.contains("upstream-secret"), "body leaked: {text}");
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(json["error"], "server_error");
        assert_eq!(json["reason"], "Internal server error");
    }

    #[test]
    fn oauth_state_round_trips_redirect_and_nonce() {
        set_jwt_secret();
        let token =
            issue_oauth_state("https://abc.chromiumapp.org/", "nonce-123").expect("issue state");
        let state = verify_oauth_state(&token).expect("verify state");
        assert_eq!(state.redirect_uri, "https://abc.chromiumapp.org/");
        assert_eq!(state.nonce, "nonce-123");
    }

    #[test]
    fn oauth_state_rejects_regular_access_token() {
        set_jwt_secret();
        let token = jwt::issue(
            "u_regular",
            "alice@example.com",
            TokenType::Access,
            Some(OAUTH_STATE_TTL_SECS),
        )
        .expect("issue regular token");

        let err = verify_oauth_state(&token).unwrap_err();
        assert!(err.contains("invalid OAuth state subject"), "got: {err}");
    }

    #[test]
    fn oauth_state_rejects_access_token_with_state_subject() {
        set_jwt_secret();
        let token = jwt::issue(
            OAUTH_STATE_SUBJECT,
            r#"{"nonce":"nonce-123","redirect_uri":"https://abc.chromiumapp.org/"}"#,
            TokenType::Access,
            Some(OAUTH_STATE_TTL_SECS),
        )
        .expect("issue wrong-type state token");

        let err = verify_oauth_state(&token).unwrap_err();
        assert!(err.contains("invalid OAuth state token type"), "got: {err}");
    }

    #[test]
    fn oauth_state_cookie_is_scoped_and_secure_for_https_redirects() {
        let https_cookie = oauth_state_cookie("nonce-123", "https://api.example/auth/callback");
        assert!(https_cookie.contains("HttpOnly"));
        assert!(https_cookie.contains("SameSite=Lax"));
        assert!(https_cookie.contains("Path=/auth/google"));
        assert!(https_cookie.contains("Secure"));

        let local_cookie = oauth_state_cookie("nonce-123", "http://127.0.0.1:8788/auth/callback");
        assert!(!local_cookie.contains("Secure"));
    }

    #[test]
    fn oauth_state_cookie_parser_ignores_unrelated_cookies() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("other=value; scopeball_oauth_state=nonce-123"),
        );
        assert_eq!(
            oauth_state_nonce_from_headers(&headers).as_deref(),
            Some("nonce-123")
        );
    }

    #[test]
    fn redirect_allowlist_is_exact_match() {
        let allow = "https://abc.chromiumapp.org/, http://localhost:5173/auth/callback";
        assert!(redirect_allowed("https://abc.chromiumapp.org/", allow));
        assert!(redirect_allowed(
            "http://localhost:5173/auth/callback",
            allow
        ));
        // trailing slash / substring / sibling host must NOT match
        assert!(!redirect_allowed("https://abc.chromiumapp.org", allow));
        assert!(!redirect_allowed("https://abc.chromiumapp.org/evil", allow));
        assert!(!redirect_allowed("https://evil.com/", allow));
        // empty allowlist allows nothing (fail-closed)
        assert!(!redirect_allowed("https://abc.chromiumapp.org/", ""));
    }

    #[test]
    fn target_defaults_to_dashboard_when_no_redirect() {
        // Empty carried → DASHBOARD_URL/auth/callback, never a 400 / allowlist.
        // Default web-dashboard flow is access-only: no long-lived refresh token
        // in a normal web origin's URL fragment/localStorage.
        let t = build_redirect_target(
            "",
            "https://abc.chromiumapp.org/",
            "https://dash.example",
            "AT",
            None,
        );
        assert_eq!(t, "https://dash.example/auth/callback#access_token=AT");
    }

    #[test]
    fn target_uses_allowlisted_redirect_with_refresh() {
        let t = build_redirect_target(
            "https://abc.chromiumapp.org/",
            "https://abc.chromiumapp.org/",
            "https://dash.example",
            "AT",
            Some("RT"),
        );
        assert_eq!(
            t,
            "https://abc.chromiumapp.org/#access_token=AT&refresh_token=RT"
        );
    }

    #[test]
    fn target_falls_back_when_carried_not_allowlisted() {
        // Defensive: a carried value that isn't allowlisted falls back to the
        // trusted DASHBOARD_URL rather than honoring it.
        let t = build_redirect_target(
            "https://evil.com/",
            "https://abc.chromiumapp.org/",
            "https://dash.example",
            "AT",
            None,
        );
        assert_eq!(t, "https://dash.example/auth/callback#access_token=AT");
    }

    #[test]
    fn refresh_delivery_is_extension_redirect_only() {
        let allow = "https://abc.chromiumapp.org/";
        assert!(!should_deliver_refresh_token("", allow));
        assert!(!should_deliver_refresh_token("https://evil.com/", allow));
        assert!(should_deliver_refresh_token(
            "https://abc.chromiumapp.org/",
            allow
        ));
    }
}
