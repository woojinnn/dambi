//! Host-provided capability bag passed into adapters and the Pipeline.
//!
//! Today this only holds an `Oracle` reference, but it's the seam where
//! future capabilities (StatWindows, Portfolio, Approvals) will be added
//! without further breaking changes to `Pipeline::new` or the `Adapter`
//! trait.

use crate::oracle::Oracle;

/// Bag of host-provided capabilities the engine consults during
/// evaluation. Construct once per evaluation pass, freeze, pass by
/// reference into adapters and the pipeline.
#[derive(Clone, Copy)]
// TODO: when a second capability arrives, switch this to a builder pattern with
// optional fields (`Option<&dyn X>`) to avoid constructor churn.
pub struct HostCapabilities<'a> {
    oracle: &'a dyn Oracle,
}

impl<'a> HostCapabilities<'a> {
    pub fn new(oracle: &'a dyn Oracle) -> Self {
        Self { oracle }
    }

    pub fn oracle(&self) -> &dyn Oracle {
        self.oracle
    }
}
