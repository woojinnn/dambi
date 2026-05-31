//! axum middleware that turns `Authorization: Bearer <jwt>` into an
//! [`AuthUser`] every protected handler can extract.
//!
//! Wire it once at the router builder (`.layer(from_fn(require_auth))`)
//! and protected handlers add `Extension(user): Extension<AuthUser>` to
//! their signature. Missing / invalid / expired tokens short-circuit with
//! `401 Unauthorized` and a small JSON body.
//!
//! The middleware does NOT touch the DB — it only validates the token.
//! Mapping `user_id → DB store` happens in the handler via the
//! `MultiUserStore` carried in `AppState`.

use axum::extract::Request;
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::auth::jwt::{self, Claims};

/// Trimmed identity carried through every authorised request.
#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: String,
    pub email: String,
}

impl From<Claims> for AuthUser {
    fn from(c: Claims) -> Self {
        Self {
            user_id: c.sub,
            email: c.email,
        }
    }
}

/// `axum::middleware::from_fn(require_auth)` — wraps a route so every
/// downstream handler can rely on `Extension<AuthUser>` being present.
pub async fn require_auth(mut req: Request, next: Next) -> Response {
    let user = match extract_user(req.headers()) {
        Ok(u) => u,
        Err(resp) => return resp,
    };
    req.extensions_mut().insert(user);
    next.run(req).await
}

/// Pulls the bearer token out of `Authorization` and verifies it. Only
/// access tokens are accepted here — refresh tokens reach the dedicated
/// `/auth/refresh` endpoint instead.
fn extract_user(headers: &HeaderMap) -> Result<AuthUser, Response> {
    let header_val = headers
        .get(header::AUTHORIZATION)
        .ok_or_else(|| reject("missing Authorization header"))?;
    let raw = header_val
        .to_str()
        .map_err(|_| reject("Authorization header is not valid UTF-8"))?;
    let token = raw
        .strip_prefix("Bearer ")
        .ok_or_else(|| reject("Authorization header must start with `Bearer `"))?;

    let claims = jwt::verify(token).map_err(|e| reject(&e.to_string()))?;
    if !claims.is_access() {
        return Err(reject("refresh token cannot be used as an access token"));
    }
    Ok(AuthUser::from(claims))
}

fn reject(reason: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized", "reason": reason })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    use crate::auth::jwt::{issue, TokenType};

    fn set_secret() {
        std::env::set_var(
            "JWT_SECRET",
            "test-secret-only-do-not-use-in-production-2026-05-31",
        );
    }

    #[test]
    fn missing_header_rejected() {
        let h = HeaderMap::new();
        let err = extract_user(&h).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn malformed_header_rejected() {
        set_secret();
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Token abc.def.ghi"),
        );
        let err = extract_user(&h).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn valid_access_token_yields_user() {
        set_secret();
        let token = issue("u_abc", "a@e.com", TokenType::Access, None).unwrap();
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        let user = extract_user(&h).unwrap();
        assert_eq!(user.user_id, "u_abc");
        assert_eq!(user.email, "a@e.com");
    }

    #[test]
    fn refresh_token_rejected_as_access() {
        set_secret();
        let token = issue("u_abc", "a@e.com", TokenType::Refresh, None).unwrap();
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        let err = extract_user(&h).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }
}
