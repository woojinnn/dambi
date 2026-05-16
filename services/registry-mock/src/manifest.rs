//! Server-side manifest = SDK manifest. Importing the SDK is fine here
//! because registry-mock is not built to wasm.

pub use adapter_sdk::manifest::{
    AppliesTo, Capability, FactoryOf, Manifest, ManifestError, ProxyOf,
};
