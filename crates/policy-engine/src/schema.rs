//! Cedar policy schema composition.

const CORE_SCHEMA: &str = include_str!("../../../policy-schema/core.cedarschema");
const DEX_SCHEMA: &str = include_str!("../../../policy-schema/actions/dex.cedarschema");
const OTHER_SCHEMA: &str = include_str!("../../../policy-schema/actions/other.cedarschema");

#[derive(Debug, Default, Clone)]
pub struct PolicySchemaComposer;

impl PolicySchemaComposer {
    pub fn new() -> Self {
        Self
    }

    pub fn compose(&self) -> String {
        [CORE_SCHEMA, DEX_SCHEMA, OTHER_SCHEMA].join("\n")
    }
}
