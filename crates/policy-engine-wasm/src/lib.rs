//! WASM bridge for the policy engine.
//!
//! The bridge exposes a JSON-string boundary for TypeScript callers:
//! `install_policies_json`, `plan_policy_rpc_json`,
//! `evaluate_policy_rpc_json`, and `evaluate_envelopes_json` (the latter
//! skips routing — callers supply pre-routed envelopes from the JS loader).

mod dto;
mod exports;
mod helpers;

use wasm_bindgen::prelude::*;

/// Module init: forward Rust panics to the JS console.
#[wasm_bindgen(start)]
pub fn _start() {
    console_error_panic_hook::set_once();
}

pub use exports::{
    evaluate_envelopes_json, evaluate_policy_rpc_json, install_policies_json,
    plan_policy_rpc_json, preview_installed_schema_json, preview_schema_json,
};
pub use helpers::{decode_abi_standard_json, parse_sign_request_json};
