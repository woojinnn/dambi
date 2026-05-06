//! Lowering stages run in the pipeline sequence:
//! 1. actions are built and USD-enriched (`enrich`),
//! 2. each action is lowered to a leaf `PolicyRequest` (`request`),
//! 3. per-leaf capability fields are attached (`enrich`),
//! 4. tx-level summary request is assembled for policy-level checks (`request`).
//!
//! `request_for_tx` is the only caller for tx-summary shape, while leaf
//! request conversion stays in `request_from_action`.

pub mod decimal;
pub mod enrich;
pub mod request;

pub(crate) use decimal::add_decimal_strings;
pub use enrich::{
    compute_swap_window_deltas, enrich_actions_with_usd, enrich_request_with_capabilities,
    enrich_tx_request_with_window_stats, enrich_with_usd,
};
pub use request::{
    request_for_tx, request_from_action, requests_from_action, requests_from_actions,
};
