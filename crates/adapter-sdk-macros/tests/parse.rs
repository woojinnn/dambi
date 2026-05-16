//! Drive the macro on a struct with `capabilities = []` so codegen emits
//! ONLY the manifest section + manifest_json export (no per-trait shims yet,
//! since Decoder/CallAdapter/SignAdapter impls are exercised in Task 13's
//! sample). Validates that argument parsing — including the brace-literal
//! `applies_to` entries — compiles cleanly.

use adapter_sdk_macros::adapter;

#[adapter(
    name = "test-adapter",
    version = "0.1.0",
    description = "trying the parser",
    capabilities = [],
    applies_to = [
        { chain: 1,   address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
        { chain: 137, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    ],
    factory_of = [
        { chain: 1, factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984" },
    ],
)]
struct _Smoke;

#[test]
fn parse_smoke_compiles() {
    let _ = _Smoke;
}
