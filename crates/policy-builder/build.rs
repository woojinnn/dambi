//! Build-time enum extractor.
//!
//! Walks `schema/action-schema/schema/actions/**/*.json` plus
//! `schema/action-schema/schema/common/_common.json`, resolves `$ref` to the
//! common `$defs`, and emits a Rust file that maps `(action, field_path)` →
//! the closed-set string enum declared in the JSON Schema. The generated file
//! is `include!`'d from `schemas/generated.rs` so `swap.rs` (and any future
//! action schema) can call one function instead of repeating literals that
//! the upstream JSON already declared.
//!
//! This file solves exactly one drift problem: when the action-schema authors
//! add a new enum value (e.g. extending `swapMode` with `"limit_order"`), the
//! policy-builder picks it up at the next `cargo build` with no hand-editing.
//! It does **not** auto-generate the rest of the `FieldSpec` structure
//! (cedar_type, is_custom, parent_optional, …) — that still lives in the
//! hand-written `schemas/*.rs` files because the mapping between JSON Schema
//! types and Cedar types is policy-specific.
//!
//! Cargo invariants:
//! - `cargo:rerun-if-changed` is emitted for every JSON file inspected, so a
//!   schema edit triggers a rebuild even though nothing under `src/` changed.
//! - Output lives in `$OUT_DIR/generated_action_enums.rs`. The crate source
//!   never contains a checked-in copy.

use serde_json::Value;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let schema_root = manifest_dir
        .join("..")
        .join("..")
        .join("schema")
        .join("action-schema")
        .join("schema");

    // Emit the directory itself so deletes/additions trigger a rebuild.
    println!("cargo:rerun-if-changed={}", schema_root.display());

    let common_path = schema_root.join("common").join("_common.json");
    let common_defs = load_common_defs(&common_path);
    println!("cargo:rerun-if-changed={}", common_path.display());

    let actions_dir = schema_root.join("actions");
    let mut entries: BTreeMap<String, Vec<EnumEntry>> = BTreeMap::new();
    collect_actions(&actions_dir, &mut entries, &common_defs);

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let out_path = out_dir.join("generated_action_enums.rs");
    fs::write(&out_path, render_rust(&entries))
        .unwrap_or_else(|e| panic!("write {}: {}", out_path.display(), e));
}

#[derive(Debug)]
struct EnumEntry {
    path: String,
    values: Vec<String>,
}

/// Load `_common.json` and return its `$defs` map. We only need the defs —
/// the rest of the file is metadata.
fn load_common_defs(path: &Path) -> BTreeMap<String, Value> {
    let raw = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
    let root: Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("parse {}: {}", path.display(), e));
    let defs = root
        .get("$defs")
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("missing $defs in {}", path.display()));
    defs.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// Recursively descend `actions_dir`, parsing every `*.json` and collecting
/// enum entries per action.
fn collect_actions(
    actions_dir: &Path,
    out: &mut BTreeMap<String, Vec<EnumEntry>>,
    common_defs: &BTreeMap<String, Value>,
) {
    for entry in fs::read_dir(actions_dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {}", actions_dir.display(), e))
    {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.is_dir() {
            collect_actions(&path, out, common_defs);
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());

        let action_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_owned)
            .unwrap_or_else(|| panic!("bad file name: {}", path.display()));

        let raw = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
        let root: Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("parse {}: {}", path.display(), e));

        let mut entries = Vec::new();
        if let Some(props) = root.get("properties").and_then(Value::as_object) {
            for (key, child) in props {
                walk(child, key, common_defs, &mut entries);
            }
        }
        if !entries.is_empty() {
            entries.sort_by(|a, b| a.path.cmp(&b.path));
            out.insert(action_name, entries);
        }
    }
}

/// Recursively walk a schema node, flattening composite types to dotted
/// leaf paths and recording any `enum` constraints encountered.
///
/// `$ref` is resolved against the common `$defs`. We deliberately ignore
/// JSON-Schema features the policy builder doesn't model (allOf/oneOf/if-then,
/// array `items`) — they don't carry enum constraints on scalar leaves in our
/// schemas, and treating them as opaque keeps the walker tractable.
fn walk(
    node: &Value,
    path: &str,
    common_defs: &BTreeMap<String, Value>,
    out: &mut Vec<EnumEntry>,
) {
    // Resolve $ref before doing anything else — it could short-circuit
    // straight into a composite type or a primitive.
    let resolved = resolve_ref(node, common_defs);
    let effective = resolved.as_ref().unwrap_or(node);

    if let Some(values) = effective.get("enum").and_then(Value::as_array) {
        let strings: Vec<String> = values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        if !strings.is_empty() {
            out.push(EnumEntry {
                path: path.to_string(),
                values: strings,
            });
        }
    }

    if let Some(props) = effective.get("properties").and_then(Value::as_object) {
        for (key, child) in props {
            let next_path = format!("{path}.{key}");
            walk(child, &next_path, common_defs, out);
        }
    }
}

/// If `node` is `{"$ref": "..."}`, return the referenced schema. Only
/// cross-file refs to `_common.json#/$defs/<Name>` are supported — that's
/// the shape every action-schema file uses today.
fn resolve_ref(node: &Value, common_defs: &BTreeMap<String, Value>) -> Option<Value> {
    let r = node.get("$ref").and_then(Value::as_str)?;
    // Both forms encountered:
    //   "../../common/_common.json#/$defs/Foo"  (cross-file)
    //   "#/$defs/Foo"                            (intra-file — rare here)
    let after_hash = r.split_once('#').map(|(_, t)| t).unwrap_or("");
    let name = after_hash.strip_prefix("/$defs/")?;
    common_defs.get(name).cloned()
}

/// Render the collected map as a Rust source file. The output is a single
/// `match` so lookups are zero-allocation, branch-predictor friendly, and
/// readable when someone opens `OUT_DIR/generated_action_enums.rs` while
/// debugging a drift complaint.
fn render_rust(entries: &BTreeMap<String, Vec<EnumEntry>>) -> String {
    let mut out = String::new();
    out.push_str("// @generated by build.rs from schema/action-schema/**/*.json — do not edit.\n");
    out.push_str("//\n");
    out.push_str("// Lookup the closed-set enum (if any) declared for one (action, field_path)\n");
    out.push_str("// pair in the upstream action-schema JSON. Returns the values in the order\n");
    out.push_str("// they appear in the JSON so downstream UIs render a stable dropdown.\n");
    out.push_str("pub fn action_field_enum(action: &str, path: &str) -> Option<&'static [&'static str]> {\n");
    out.push_str("    match (action, path) {\n");
    for (action, items) in entries {
        for item in items {
            out.push_str(&format!(
                "        ({:?}, {:?}) => Some(&[",
                action, item.path
            ));
            for (i, v) in item.values.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(&format!("{:?}", v));
            }
            out.push_str("]),\n");
        }
    }
    out.push_str("        _ => None,\n");
    out.push_str("    }\n");
    out.push_str("}\n");
    out
}
