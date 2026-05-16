use crate::manifest::extract_manifest;
use std::path::Path;

pub fn run(wasm: &Path, registry: &str) -> anyhow::Result<()> {
    let manifest = extract_manifest(wasm)?;
    manifest.validate()?;
    let wasm_bytes = std::fs::read(wasm)?;

    let client = reqwest::blocking::Client::new();
    let form = reqwest::blocking::multipart::Form::new()
        .text("manifest", serde_json::to_string(&manifest)?)
        .part(
            "wasm",
            reqwest::blocking::multipart::Part::bytes(wasm_bytes).file_name("adapter.wasm"),
        );
    let resp = client
        .post(format!("{}/publish", registry.trim_end_matches('/')))
        .multipart(form)
        .send()?;
    let status = resp.status();
    let body: serde_json::Value = resp.json()?;
    anyhow::ensure!(status.is_success(), "publish failed: {status} — {body}");
    println!("published:");
    println!("{}", serde_json::to_string_pretty(&body)?);
    Ok(())
}
