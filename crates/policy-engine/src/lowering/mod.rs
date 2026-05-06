//! Action lowering and enrichment.
//!
//! - `decimal` contains helper utilities for fixed-width decimal math.
//! - `request` builds Cedar `PolicyRequest` objects from resolved actions.
//! - `enrich` performs oracle and host capability enrichment on actions and
//!   request payloads.

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
