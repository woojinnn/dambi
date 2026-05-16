mod common;

use common::{sample_manifest_json, sample_wasm_bytes};

const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

#[tokio::test]
async fn publish_creates_files() {
    let server = common::TestServer::start().await;

    let res = reqwest::Client::new()
        .post(format!("{}/publish", server.base_url))
        .multipart(
            reqwest::multipart::Form::new()
                .text("manifest", sample_manifest_json())
                .part(
                    "wasm",
                    reqwest::multipart::Part::bytes(sample_wasm_bytes()),
                ),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);

    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["name"], "erc20-transfer");
    assert_eq!(body["version"], "0.1.0");
}

#[tokio::test]
async fn fetches_published_wasm() {
    let server = common::TestServer::start().await;

    let wasm = sample_wasm_bytes();
    reqwest::Client::new()
        .post(format!("{}/publish", server.base_url))
        .multipart(
            reqwest::multipart::Form::new()
                .text("manifest", sample_manifest_json())
                .part("wasm", reqwest::multipart::Part::bytes(wasm.clone())),
        )
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let got = reqwest::get(format!(
        "{}/packages/erc20-transfer/v0.1.0/adapter.wasm",
        server.base_url
    ))
    .await
    .unwrap();
    assert_eq!(got.status(), 200);
    assert_eq!(
        got.headers().get("cache-control").unwrap(),
        "public, max-age=31536000, immutable"
    );
    let body = got.bytes().await.unwrap().to_vec();
    assert_eq!(body, wasm);

    let mj = reqwest::get(format!(
        "{}/packages/erc20-transfer/v0.1.0/manifest.json",
        server.base_url
    ))
    .await
    .unwrap();
    assert_eq!(mj.status(), 200);
    let parsed: serde_json::Value = mj.json().await.unwrap();
    assert_eq!(parsed["name"], "erc20-transfer");
}

#[tokio::test]
async fn chain_endpoint_resolves_explicit_address() {
    let server = common::TestServer::start().await;

    reqwest::Client::new()
        .post(format!("{}/publish", server.base_url))
        .multipart(
            reqwest::multipart::Form::new()
                .text("manifest", sample_manifest_json())
                .part(
                    "wasm",
                    reqwest::multipart::Part::bytes(sample_wasm_bytes()),
                ),
        )
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();

    let r = reqwest::get(format!("{}/chains/1/{USDC}", server.base_url))
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let v: serde_json::Value = r.json().await.unwrap();
    assert_eq!(v["version"], "0.1.0");
    assert_eq!(
        v["wasm_url"],
        "/packages/erc20-transfer/v0.1.0/adapter.wasm"
    );
}

#[tokio::test]
async fn chain_endpoint_returns_404_for_unknown() {
    let server = common::TestServer::start().await;
    let r = reqwest::get(format!(
        "{}/chains/1/0x0000000000000000000000000000000000000abc",
        server.base_url
    ))
    .await
    .unwrap();
    assert_eq!(r.status(), 404);
}

/// A WASM payload that passes the `\0asm` header check but lacks the
/// `adapter_manifest` custom section must be rejected with 400.
#[tokio::test]
async fn publish_rejects_wasm_with_wrong_manifest() {
    let server = common::TestServer::start().await;

    let manifest = serde_json::json!({
        "name": "evil",
        "version": "0.0.1",
        "sdk_version": 1,
        "description": "test",
        "capabilities": ["decoder"],
        "applies_to": [
            {"chain": 1, "address": "0x0000000000000000000000000000000000000001"}
        ],
        "factory_of": [],
        "proxy_of": []
    });
    // Bare WASM header — parses as an empty module, has no custom section.
    let wasm = b"\0asm\x01\0\0\0".to_vec();

    let res = reqwest::Client::new()
        .post(format!("{}/publish", server.base_url))
        .multipart(
            reqwest::multipart::Form::new()
                .text("manifest", manifest.to_string())
                .part("wasm", reqwest::multipart::Part::bytes(wasm)),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
}

/// A manifest carrying a `../etc`-style name must be rejected *before* any
/// filesystem write. This is the path-traversal regression test.
#[tokio::test]
async fn publish_rejects_path_traversal_in_name() {
    let server = common::TestServer::start().await;

    let manifest = serde_json::json!({
        "name": "../etc",
        "version": "0.0.1",
        "sdk_version": 1,
        "description": "test",
        "capabilities": ["decoder"],
        "applies_to": [
            {"chain": 1, "address": "0x0000000000000000000000000000000000000001"}
        ],
        "factory_of": [],
        "proxy_of": []
    });
    let wasm = b"\0asm\x01\0\0\0".to_vec();

    let res = reqwest::Client::new()
        .post(format!("{}/publish", server.base_url))
        .multipart(
            reqwest::multipart::Form::new()
                .text("manifest", manifest.to_string())
                .part("wasm", reqwest::multipart::Part::bytes(wasm)),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
}
