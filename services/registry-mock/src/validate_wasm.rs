//! Module/manifest consistency check (spec §7.3).
//!
//! `route_publish` invokes [`validate_wasm_module`] after `Manifest::validate`
//! and before persisting anything. We:
//!
//! 1. Walk the WASM module with `wasmparser::Parser::new(0).parse_all`.
//! 2. Collect every exported function name.
//! 3. Find the `adapter_manifest` custom section, parse it as a `Manifest`,
//!    and assert it equals the multipart manifest the publisher sent.
//! 4. Enforce per-capability export requirements:
//!    * `Decoder`     → `decode_call`, `manifest_json`, `alloc`, `dealloc`
//!    * `CallAdapter` → additionally `map_to_action`
//!    * `SignAdapter` → additionally `decode_sign`
//!
//! Returns a short, user-facing reason on any mismatch so the caller can
//! surface it as a 400 response.

use crate::manifest::{Capability, Manifest};
use adapter_sdk::manifest::CUSTOM_SECTION_NAME;
use std::collections::BTreeSet;
use wasmparser::{Parser, Payload};

pub fn validate_wasm_module(
    wasm: &[u8],
    expected_manifest: &Manifest,
) -> Result<(), String> {
    let mut exports: BTreeSet<String> = BTreeSet::new();
    let mut embedded_manifest: Option<Manifest> = None;

    for payload in Parser::new(0).parse_all(wasm) {
        let payload = payload.map_err(|e| format!("wasm parse failed: {e}"))?;
        match payload {
            Payload::ExportSection(reader) => {
                for export in reader {
                    let export = export.map_err(|e| format!("export decode: {e}"))?;
                    exports.insert(export.name.to_string());
                }
            }
            Payload::CustomSection(cs) if cs.name() == CUSTOM_SECTION_NAME => {
                let parsed: Manifest = serde_json::from_slice(cs.data()).map_err(|e| {
                    format!("embedded `{CUSTOM_SECTION_NAME}` is not valid JSON: {e}")
                })?;
                embedded_manifest = Some(parsed);
            }
            _ => {}
        }
    }

    let embedded = embedded_manifest.ok_or_else(|| {
        format!("wasm has no `{CUSTOM_SECTION_NAME}` custom section")
    })?;

    // Compare via the strongly-typed Manifest. We deliberately do NOT compare
    // raw JSON Values: codegen emits empty `factory_of` / `proxy_of` arrays
    // unconditionally, while `Manifest::serialize` skips them when empty —
    // so a `Value` round-trip of `expected_manifest` would not be equal to the
    // embedded bytes for the common single-`applies_to` adapter.
    if &embedded != expected_manifest {
        return Err(format!(
            "embedded manifest does not match multipart manifest (embedded.name={:?} version={:?}; multipart.name={:?} version={:?})",
            embedded.name, embedded.version,
            expected_manifest.name, expected_manifest.version,
        ));
    }

    for cap in &expected_manifest.capabilities {
        for required in required_exports(*cap) {
            if !exports.contains(*required) {
                return Err(format!(
                    "capability {cap:?} missing required export `{required}`"
                ));
            }
        }
    }

    Ok(())
}

fn required_exports(cap: Capability) -> &'static [&'static str] {
    match cap {
        Capability::Decoder => &["decode_call", "manifest_json", "alloc", "dealloc"],
        Capability::CallAdapter => &["map_to_action"],
        Capability::SignAdapter => &["decode_sign"],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{AppliesTo, Capability};
    use adapter_sdk::primitives::Address;
    use std::str::FromStr;

    fn sample_manifest() -> Manifest {
        Manifest {
            name: "demo".into(),
            version: "0.1.0".into(),
            sdk_version: 1,
            description: "demo".into(),
            author: None,
            homepage: None,
            capabilities: vec![Capability::Decoder],
            applies_to: vec![AppliesTo {
                chain: 1,
                address: Address::from_str(
                    "0x0000000000000000000000000000000000000001",
                )
                .unwrap(),
            }],
            factory_of: vec![],
            proxy_of: vec![],
        }
    }

    #[test]
    fn rejects_bare_header_without_custom_section() {
        let wasm = b"\0asm\x01\0\0\0".to_vec();
        let m = sample_manifest();
        let err = validate_wasm_module(&wasm, &m).unwrap_err();
        assert!(err.contains("custom section"), "got: {err}");
    }

    #[test]
    fn rejects_garbage_bytes() {
        let wasm = b"\0asm\x01garbage".to_vec();
        let m = sample_manifest();
        // Either wasm parse failure or missing custom section is acceptable;
        // both are errors.
        assert!(validate_wasm_module(&wasm, &m).is_err());
    }
}
