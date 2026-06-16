//! Compile + consistency gate for the Uniswap protocol-unit policy preset.
//!
//! Scans `presets/uniswap/**` (repo root) for every policy SET (a directory
//! holding BOTH `manifest.json` and `policy.cedar`) and asserts, for each, the
//! SAME guarantees the shipped-default gate (`default_policies_v2.rs`) and the
//! Lido / Seaport preset gates enforce:
//!
//!   1. the manifest parses + `validate()`s (schema_version == 2, unique
//!      policy_rpc ids, every custom_context field fed by an output);
//!   2. its `policy.cedar` compiles against the schema its own manifest
//!      synthesizes via `compose_per_policy` (`build_from_per_policy`);
//!   3. every `context.custom.<field>` the cedar references is declared in the
//!      manifest (`lint_custom_field_refs`);
//!   4. no `@severity("deny")` policy hinges SOLELY on an optional / non-required
//!      enrichment field (the N5 fail-open ship-gate).
//!
//! Only the NEW Uniswap-specific SETs live physically under `presets/uniswap/`
//! (the packages reuse existing dex/token SETs by id, which are NOT counted
//! here). Mirrors `seaport_preset_compile_gate.rs`. If the presets directory is
//! absent (a clone without the preset lab branch), the gate skips rather than
//! failing.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use policy_engine::policy::PolicyEngine;
use policy_engine::policy_rpc::ManifestV2;
use policy_engine::schema::{compose_per_policy, lint_custom_field_refs};

/// Number of NEW SETs physically authored under `presets/uniswap/`. Bump when a
/// gap SET (see `_AUTHORING_GROUNDING.md` §4) is added.
const EXPECTED_SETS: usize = 2;

fn presets_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/crates/policy-engine → repo root is ../../.
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../presets/uniswap")
}

/// Recursively collect every directory that contains BOTH `manifest.json` and
/// `policy.cedar` (one policy SET). Ignores docs (`*.md`), `package.json`, etc.
fn collect_set_dirs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut has_manifest = false;
    let mut has_cedar = false;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_set_dirs(&path, out);
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            match name {
                "manifest.json" => has_manifest = true,
                "policy.cedar" => has_cedar = true,
                _ => {}
            }
        }
    }
    if has_manifest && has_cedar {
        out.push(dir.to_path_buf());
    }
}

/// Custom fields a deny policy must not hinge on (every feeder is optional or the
/// output is not `required`) AND referenced by a `@severity("deny")` policy.
/// Mirrors `default_policies_v2.rs::deny_optional_violations`.
fn deny_optional_violations(manifest: &ManifestV2, policy: &str) -> Vec<String> {
    let mut all_fed: BTreeSet<String> = BTreeSet::new();
    let mut guaranteed: BTreeSet<String> = BTreeSet::new();
    for spec in &manifest.policy_rpc {
        for out in &spec.outputs {
            all_fed.insert(out.field.clone());
            if out.required && !spec.optional {
                guaranteed.insert(out.field.clone());
            }
        }
    }
    if !policy.contains("@severity(\"deny\")") {
        return Vec::new();
    }
    all_fed
        .difference(&guaranteed)
        .filter(|f| {
            policy.contains(&format!("context.custom.{f}"))
                || policy.contains(&format!("context.custom has {f}"))
        })
        .cloned()
        .collect()
}

#[test]
fn uniswap_presets_compile_and_are_consistent() {
    let root = presets_root();
    if !root.is_dir() {
        eprintln!("uniswap preset gate: {root:?} absent — skipping (preset tree not present)");
        return;
    }

    let mut set_dirs = Vec::new();
    collect_set_dirs(&root, &mut set_dirs);
    set_dirs.sort();

    let mut checked = 0;
    for dir in &set_dirs {
        let rel = dir.strip_prefix(&root).unwrap_or(dir).display().to_string();

        let manifest_json = fs::read_to_string(dir.join("manifest.json"))
            .unwrap_or_else(|e| panic!("read {rel}/manifest.json: {e}"));
        let policy = fs::read_to_string(dir.join("policy.cedar"))
            .unwrap_or_else(|e| panic!("read {rel}/policy.cedar: {e}"));

        let manifest: ManifestV2 = serde_json::from_str(&manifest_json)
            .unwrap_or_else(|e| panic!("parse {rel}/manifest.json: {e}"));

        // 1. manifest id == set directory name.
        let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        assert_eq!(
            manifest.id, dir_name,
            "{rel}: manifest id `{}` must match its directory name `{dir_name}`",
            manifest.id
        );

        // 2. structural invariants.
        manifest
            .validate()
            .unwrap_or_else(|e| panic!("{rel}: manifest invalid: {e}"));

        // 3. cedar compiles against the synthesized schema.
        let schema = compose_per_policy(&manifest)
            .unwrap_or_else(|e| panic!("{rel}: compose_per_policy failed: {e}"));
        PolicyEngine::build_from_per_policy(&[(policy.clone(), schema)])
            .unwrap_or_else(|e| panic!("{rel}: policy.cedar does not compile: {e}"));

        // 4. every referenced custom field is declared.
        lint_custom_field_refs(&policy, &manifest)
            .unwrap_or_else(|e| panic!("{rel}: custom-field lint failed: {e}"));

        // 5. N5: no deny hinges solely on optional/non-required enrichment.
        let violations = deny_optional_violations(&manifest, &policy);
        assert!(
            violations.is_empty(),
            "{rel}: deny policy hinges on optional/non-required enrichment field(s) \
             {violations:?} — would fail-open. Make it warn, or required+non-optional."
        );

        checked += 1;
    }

    assert_eq!(
        checked, EXPECTED_SETS,
        "expected exactly {EXPECTED_SETS} Uniswap preset SETs, found {checked}: {set_dirs:#?}"
    );
}
