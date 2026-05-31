//! `/docs` + `/openapi.yaml` — public, no-auth API browser.
//!
//! Loads the OpenAPI spec from `openapi.yaml` (embedded at compile
//! time via `include_str!`) and renders a Swagger UI page that pulls
//! the JS/CSS from the public unpkg CDN. Keeps the server zero-asset —
//! nothing to copy at deploy time, nothing to chmod.

use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

const OPENAPI_YAML: &str = include_str!("../openapi.yaml");

const SWAGGER_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Scopeball API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
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
      });
    };
  </script>
</body>
</html>"##;

/// `GET /docs` — Swagger UI HTML page.
pub async fn docs_html() -> Response {
    (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
        ],
        SWAGGER_HTML,
    )
        .into_response()
}

/// `GET /openapi.yaml` — the spec consumed by Swagger UI (and anyone
/// else that wants to codegen a client).
pub async fn openapi_yaml() -> Response {
    (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "application/yaml; charset=utf-8"),
            (CACHE_CONTROL, "public, max-age=300"),
        ],
        OPENAPI_YAML,
    )
        .into_response()
}
