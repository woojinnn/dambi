//! WASM bridge for the policy engine.
//!
//! The bridge exposes a JSON-string boundary for TypeScript callers:
//! `install_policies_json`, `route_request_json`, `plan_policy_rpc_json`, and
//! `evaluate_policy_rpc_json`.

mod declarative_exports;
mod dto;
mod exports;

use wasm_bindgen::prelude::*;

/// Module init: forward Rust panics to the JS console.
#[wasm_bindgen(start)]
pub fn _start() {
    console_error_panic_hook::set_once();
}

pub use declarative_exports::{declarative_install_json, declarative_lookup_json};
pub use exports::{
    evaluate_policy_rpc_json, install_policies_json, plan_policy_rpc_json,
    preview_installed_schema_json, preview_schema_json, route_request_json,
};
