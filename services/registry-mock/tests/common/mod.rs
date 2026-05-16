use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tempfile::TempDir;

pub struct TestServer {
    pub base_url: String,
    pub _state_dir: TempDir,
    pub _handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    pub async fn start() -> Self {
        let state_dir = TempDir::new().unwrap();
        std::env::set_var("REGISTRY_STATE", state_dir.path());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();

        let app = registry_mock::build_app(state_dir.path().to_path_buf()).await;
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        Self {
            base_url: format!("http://127.0.0.1:{port}"),
            _state_dir: state_dir,
            _handle: handle,
        }
    }
}

/// Workspace root: `services/registry-mock` → `../..`.
fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .expect("workspace root")
}

fn sample_wasm_path() -> PathBuf {
    workspace_root()
        .join("target")
        .join("wasm32-unknown-unknown")
        .join("release")
        .join("adapter_sample_erc20_transfer.wasm")
}

/// Build the ERC-20 transfer sample once per test process, then return its
/// raw bytes. `OnceLock` serialises the cargo invocation so the four
/// integration tests don't race on the target directory.
pub fn sample_wasm_bytes() -> Vec<u8> {
    static BYTES: OnceLock<Vec<u8>> = OnceLock::new();
    BYTES
        .get_or_init(|| {
            let path = sample_wasm_path();
            if !path.exists() {
                let status = Command::new(env!("CARGO"))
                    .args([
                        "build",
                        "-p",
                        "adapter-sample-erc20-transfer",
                        "--target",
                        "wasm32-unknown-unknown",
                        "--release",
                    ])
                    .current_dir(workspace_root())
                    .status()
                    .expect("invoke cargo build for sample wasm");
                assert!(status.success(), "cargo build of sample wasm failed");
            }
            std::fs::read(&path)
                .unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
        })
        .clone()
}

/// Extract the JSON text of the embedded `adapter_manifest` custom section.
/// Using the embedded bytes as the multipart manifest field guarantees the
/// server's `embedded == multipart` consistency check passes by construction.
pub fn sample_manifest_json() -> String {
    let bytes = sample_wasm_bytes();
    for payload in wasmparser::Parser::new(0).parse_all(&bytes) {
        if let wasmparser::Payload::CustomSection(cs) = payload.unwrap() {
            if cs.name() == "adapter_manifest" {
                return String::from_utf8(cs.data().to_vec())
                    .expect("manifest section is utf-8 json");
            }
        }
    }
    panic!("sample WASM has no adapter_manifest section");
}
