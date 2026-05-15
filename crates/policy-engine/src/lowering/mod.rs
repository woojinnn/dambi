//! Lowering stages: `ActionEnvelope` -> `PolicyRequest`.

pub use dispatch::policy_request_from_envelope;

mod common;
mod dex;
mod dispatch;
