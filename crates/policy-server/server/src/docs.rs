//! `/docs` + `/openapi.yaml` — public, no-auth API documentation.
//! The `OpenAPI` spec is embedded at compile time. The HTML page intentionally
//! avoids third-party JavaScript so a token-bearing docs URL cannot expose a JWT
//! to a CDN-hosted Swagger bundle.

use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};

const OPENAPI_YAML: &str = include_str!("../openapi.yaml");

const DOCS_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dambi API</title>
  <style>
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
      padding: 64px 24px;
    }
    h1 {
      font-size: 32px;
      line-height: 1.2;
      margin: 0 0 12px;
    }
    p {
      color: #475569;
      line-height: 1.6;
      margin: 0 0 20px;
    }
    a {
      color: #0f766e;
      font-weight: 700;
    }
    code {
      background: #e2e8f0;
      border-radius: 6px;
      padding: 2px 6px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Dambi API</h1>
    <p>The OpenAPI specification is available as a static YAML document.</p>
    <p><a href="/openapi.yaml">Open <code>/openapi.yaml</code></a></p>
  </main>
</body>
</html>"#;

/// `GET /docs` — Swagger UI HTML page.
pub async fn docs_html() -> Response {
    let mut response = (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
        ],
        DOCS_HTML,
    )
        .into_response();
    insert_security_headers(response.headers_mut());
    response.headers_mut().insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(
            "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; style-src 'unsafe-inline'; connect-src 'self'",
        ),
    );
    response
}

/// `GET /openapi.yaml` — the spec consumed by Swagger UI (and anyone
/// else that wants to codegen a client).
pub async fn openapi_yaml() -> Response {
    let mut response = (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "application/yaml; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
        ],
        OPENAPI_YAML,
    )
        .into_response();
    insert_security_headers(response.headers_mut());
    response
}

fn insert_security_headers(headers: &mut axum::http::HeaderMap) {
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("geolocation=(), microphone=(), camera=()"),
    );
    headers.insert(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=31536000; includeSubDomains"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn docs_html_sets_security_headers_and_nonce_csp() {
        let response = docs_html().await;
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers().clone();
        assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
        assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
        assert_eq!(headers.get("referrer-policy").unwrap(), "no-referrer");
        let csp = headers
            .get("content-security-policy")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("frame-ancestors 'none'"), "csp={csp}");
        assert!(!csp.contains("script-src"), "csp={csp}");
        assert!(!csp.contains("unpkg.com"), "csp={csp}");

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("/openapi.yaml"), "html={html}");
        assert!(!html.contains("SwaggerUIBundle"), "html={html}");
        assert!(!html.contains("unpkg.com"), "html={html}");
        assert!(!html.contains("localStorage"), "html={html}");
        assert!(!html.contains("token="), "html={html}");
    }

    #[tokio::test]
    async fn openapi_yaml_sets_non_html_security_headers() {
        let response = openapi_yaml().await;
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
        assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
        assert_eq!(
            headers.get("strict-transport-security").unwrap(),
            "max-age=31536000; includeSubDomains"
        );
        assert!(headers.get("content-security-policy").is_none());
    }

    #[test]
    fn openapi_tracks_router_paths_and_omits_removed_spenders_api() {
        for path in [
            "  /readyz:",
            "  /auth/refresh:",
            "  /capabilities/sync-chains:",
            "  /wallets/{address}/permits:",
            "  /wallets/{address}/positions:",
            "  /wallets/{address}/pending:",
            "  /market/listings:",
            "  /market/activity-summary:",
            "  /market/listings/{slug}:",
            "  /market/listings/id/{id}:",
            "  /market/listings/id/{id}/versions:",
            "  /market/listings/id/{id}/versions/{ver}:",
            "  /market/listings/id/{id}/install:",
            "  /market/listings/id/{id}/reviews:",
            "  /market/listings/id/{id}/watch:",
            "  /market/watches:",
            "  /market/reviews/{id}/helpful:",
        ] {
            assert!(OPENAPI_YAML.contains(path), "missing OpenAPI path {path}");
        }
        assert!(
            !OPENAPI_YAML.contains("/spenders/"),
            "stale spender API leaked into spec"
        );
        assert!(
            !OPENAPI_YAML.contains("reporter_id"),
            "OpenAPI must not document raw internal marketplace reporter ids"
        );
    }
}
