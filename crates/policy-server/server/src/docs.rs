//! `/docs` + `/openapi.yaml` — public, no-auth API browser.
//! Loads the `OpenAPI` spec from `openapi.yaml` (embedded at compile
//! time via `include_str!`) and renders a Swagger UI page that pulls
//! the JS/CSS from the public unpkg CDN. Keeps the server zero-asset —
//! nothing to copy at deploy time, nothing to chmod.

use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;

const OPENAPI_YAML: &str = include_str!("../openapi.yaml");

const SWAGGER_HTML_TEMPLATE: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dambi API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style nonce="__CSP_NONCE__">
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script nonce="__CSP_NONCE__">
    // Pick up a JWT passed as a URL fragment (#token=...). Hash beats
    // query because tokens in query strings end up in access logs.
    function readTokenFromHash() {
      const h = window.location.hash || "";
      const m = h.match(/(?:^|[#&])token=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    // Falls back to localStorage (same-origin only — won't see the
    // dashboard's token, but lets a user paste once and have it stick).
    function readTokenFromStorage() {
      try { return window.localStorage.getItem("dambi_docs_jwt"); }
      catch { return null; }
    }
    function persistToken(t) {
      try { window.localStorage.setItem("dambi_docs_jwt", t); }
      catch { /* private mode */ }
    }
    window.onload = () => {
      const token = readTokenFromHash() || readTokenFromStorage();
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        persistAuthorization: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset,
        ],
        layout: "BaseLayout",
        onComplete: () => {
          if (token) {
            window.ui.preauthorizeApiKey("bearerAuth", token);
            persistToken(token);
            // Clear the hash so the token doesn't sit in the URL bar /
            // browser history.
            if (window.location.hash.includes("token=")) {
              history.replaceState(null, "", window.location.pathname);
            }
          }
        },
      });
    };
  </script>
</body>
</html>"##;

/// `GET /docs` — Swagger UI HTML page.
pub async fn docs_html() -> Response {
    let nonce = csp_nonce();
    let csp = swagger_csp(&nonce);
    let html = SWAGGER_HTML_TEMPLATE.replace("__CSP_NONCE__", &nonce);
    let mut response = (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
        ],
        html,
    )
        .into_response();
    insert_security_headers(response.headers_mut());
    response.headers_mut().insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_str(&csp).expect("static CSP plus base64 nonce is valid"),
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

fn csp_nonce() -> String {
    base64::engine::general_purpose::STANDARD.encode(uuid::Uuid::new_v4().as_bytes())
}

fn swagger_csp(nonce: &str) -> String {
    format!(
        "default-src 'none'; \
         base-uri 'none'; \
         object-src 'none'; \
         frame-ancestors 'none'; \
         form-action 'none'; \
         img-src 'self' data: https:; \
         font-src https://unpkg.com data:; \
         style-src 'self' 'unsafe-inline' https://unpkg.com; \
         script-src 'self' 'nonce-{nonce}' https://unpkg.com; \
         connect-src 'self'"
    )
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
        assert!(csp.contains("script-src 'self' 'nonce-"), "csp={csp}");
        let script_src = csp
            .split(';')
            .find(|part| part.trim_start().starts_with("script-src "))
            .unwrap();
        assert!(!script_src.contains("'unsafe-inline'"), "csp={csp}");

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("nonce=\""), "html={html}");
        assert!(!html.contains("__CSP_NONCE__"), "nonce placeholder leaked");
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
}
