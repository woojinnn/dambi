//! Filesystem layout (spec §7.1):
//!
//!   packages/{name}/v{version}/adapter.wasm
//!   packages/{name}/v{version}/manifest.json
//!   packages/{name}/LATEST           -- contains "vX.Y.Z\n"
//!
//! The state directory is configured via REGISTRY_STATE env var
//! (default ./state, or /var/lib/registry inside the container).

use crate::manifest::Manifest;
use std::path::PathBuf;
use tokio::fs;

#[derive(Clone, Debug)]
pub struct Storage {
    root: PathBuf,
}

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn package_root(&self, name: &str) -> PathBuf {
        self.root.join("packages").join(name)
    }

    pub fn version_root(&self, name: &str, version: &str) -> PathBuf {
        self.package_root(name).join(format!("v{version}"))
    }

    pub async fn write_version(
        &self,
        manifest: &Manifest,
        wasm: &[u8],
    ) -> anyhow::Result<()> {
        let dir = self.version_root(&manifest.name, &manifest.version);
        fs::create_dir_all(&dir).await?;
        fs::write(dir.join("adapter.wasm"), wasm).await?;
        let mjson = serde_json::to_vec_pretty(manifest)?;
        fs::write(dir.join("manifest.json"), &mjson).await?;
        fs::write(
            self.package_root(&manifest.name).join("LATEST"),
            format!("v{}\n", manifest.version),
        )
        .await?;
        Ok(())
    }

    pub async fn read_wasm(&self, name: &str, version: &str) -> anyhow::Result<Vec<u8>> {
        let p = self.version_root(name, version).join("adapter.wasm");
        Ok(fs::read(p).await?)
    }

    pub async fn read_manifest(&self, name: &str, version: &str) -> anyhow::Result<Manifest> {
        let p = self.version_root(name, version).join("manifest.json");
        let bytes = fs::read(p).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub async fn latest_version(&self, name: &str) -> anyhow::Result<Option<String>> {
        let p = self.package_root(name).join("LATEST");
        match fs::read_to_string(&p).await {
            Ok(s) => {
                let trimmed = s.trim().trim_start_matches('v').to_string();
                Ok(Some(trimmed))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adapter_sdk::manifest::{AppliesTo, Capability};
    use adapter_sdk::primitives::Address;
    use std::str::FromStr;

    #[tokio::test]
    async fn write_then_read_back() {
        let tmp = tempfile::tempdir().unwrap();
        let st = Storage::new(tmp.path().to_path_buf());

        let m = Manifest {
            name: "foo".into(),
            version: "1.2.3".into(),
            sdk_version: 1,
            description: "x".into(),
            author: None,
            homepage: None,
            capabilities: vec![Capability::Decoder],
            applies_to: vec![AppliesTo {
                chain: 1,
                address: Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
            }],
            factory_of: vec![],
            proxy_of: vec![],
        };
        st.write_version(&m, b"\0asm").await.unwrap();
        let back = st.read_manifest("foo", "1.2.3").await.unwrap();
        assert_eq!(back, m);
        let latest = st.latest_version("foo").await.unwrap();
        assert_eq!(latest.as_deref(), Some("1.2.3"));
    }
}
