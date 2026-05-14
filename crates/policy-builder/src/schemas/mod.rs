//! Action schema registry.
//!
//! Each module under this path defines one [`ActionSchema`]. The
//! [`registry`] function returns them all by action name; extending support
//! to a new action means adding a module and one entry here.
//!
//! [`ActionSchema`]: crate::types::ActionSchema

pub mod swap;

use crate::types::ActionSchema;
use std::collections::BTreeMap;

/// Build the registry of all known action schemas.
///
/// Returned fresh each call so callers can mutate / extend per-instance
/// without sharing state. Cost is small (a handful of `BTreeMap` inserts).
#[must_use]
pub fn registry() -> BTreeMap<String, ActionSchema> {
    let mut out = BTreeMap::new();
    // The loop is intentionally over an array that will gain more entries
    // as new actions are registered (approve, transfer, …).
    #[allow(clippy::single_element_loop)]
    for schema in [swap::schema()] {
        out.insert(schema.action.clone(), schema);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_swap() {
        let r = registry();
        assert!(r.contains_key("swap"));
    }
}
