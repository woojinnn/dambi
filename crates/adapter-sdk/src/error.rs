//! Error types returned by adapter trait methods and host-import callbacks.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AdapterError {
    #[error("calldata too short: expected at least {expected} bytes, got {got}")]
    CalldataTooShort { expected: usize, got: usize },
    #[error("unrecognized selector: {selector}")]
    UnknownSelector { selector: String },
    #[error("decode failed: {message}")]
    DecodeFailed { message: String },
    #[error("invariant violated: {message}")]
    Invariant { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CtxError {
    #[error("lookup_adapter cycle detected for ({chain}, {address})")]
    Cycle { chain: u64, address: String },
    #[error("lookup_adapter depth limit exceeded")]
    DepthExceeded,
    #[error("no adapter registered for ({chain}, {address})")]
    NotFound { chain: u64, address: String },
    #[error("host error: {message}")]
    Host { message: String },
}

#[repr(i32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogLevel {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_error_serde_round_trip() {
        let e = AdapterError::CalldataTooShort { expected: 4, got: 2 };
        let s = serde_json::to_string(&e).unwrap();
        let back: AdapterError = serde_json::from_str(&s).unwrap();
        assert_eq!(format!("{e:?}"), format!("{back:?}"));
    }

    #[test]
    fn ctx_error_uses_snake_case_kind() {
        let e = CtxError::DepthExceeded;
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"kind\":\"depth_exceeded\""));
    }
}
