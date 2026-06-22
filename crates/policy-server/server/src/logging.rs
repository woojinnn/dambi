//! Tracing initialization shared by the server and worker binaries.

use std::fmt::Display;

use tracing_subscriber::EnvFilter;

use crate::config::LogFormat;

const DEFAULT_LOG_FILTER: &str = "info";

/// Initialize the global tracing subscriber in the selected format.
/// `LOG_FORMAT=json` emits one JSON object per line for GKE Cloud Logging;
/// anything else stays human-readable for local dev.
pub fn init_tracing(format: LogFormat) {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_log_filter()));
    match format {
        LogFormat::Json => tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .init(),
        LogFormat::Human => tracing_subscriber::fmt().with_env_filter(filter).init(),
    }
}

fn default_log_filter() -> &'static str {
    DEFAULT_LOG_FILTER
}

/// Redact common secret-bearing key/value fragments before putting internal
/// error strings into structured logs.
pub fn redact_sensitive_log_text(value: impl Display) -> String {
    let input = value.to_string();
    let mut redact_next = false;
    let mut out = Vec::new();

    for part in input.split_whitespace() {
        let lower = part
            .trim_matches(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .to_ascii_lowercase();
        let sensitive = is_sensitive_log_fragment(&lower);
        let has_inline_value =
            sensitive && (part.contains('=') || (part.contains(':') && !part.ends_with(':')));
        let key_only = sensitive && part.ends_with(':');
        let is_bearer_marker = lower == "bearer";
        let has_url_userinfo = contains_url_userinfo(part);

        if redact_next || has_inline_value || key_only || has_url_userinfo {
            out.push("[REDACTED]".to_owned());
        } else {
            out.push(part.to_owned());
        }
        redact_next = key_only || is_bearer_marker;
    }

    out.join(" ")
}

fn is_sensitive_log_fragment(fragment: &str) -> bool {
    fragment.contains("secret")
        || fragment.contains("token")
        || fragment.contains("password")
        || fragment.contains("api_key")
        || fragment.contains("api-key")
        || fragment.contains("authorization")
}

fn contains_url_userinfo(value: &str) -> bool {
    let Some((_, rest)) = value.split_once("://") else {
        return false;
    };
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == ')' || c == ']');
    authority.contains('@')
}

#[cfg(test)]
mod tests {
    use super::{default_log_filter, redact_sensitive_log_text};

    #[test]
    fn default_log_filter_is_not_debug_verbose() {
        assert_eq!(default_log_filter(), "info");
        assert!(!default_log_filter().contains("debug"));
    }

    #[test]
    fn redacts_inline_secret_key_values() {
        let out = redact_sensitive_log_text("open user store password=super-secret");
        assert!(!out.contains("password"));
        assert!(!out.contains("super-secret"));
        assert!(out.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_sensitive_hyphenated_keys() {
        let out = redact_sensitive_log_text("upstream failed: secret-token=do-not-echo");
        assert!(!out.contains("secret-token"));
        assert!(!out.contains("do-not-echo"));
        assert!(out.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_split_authorization_values() {
        let out = redact_sensitive_log_text("Authorization: Bearer abc.def.ghi");
        assert!(!out.contains("Authorization"));
        assert!(!out.contains("abc.def.ghi"));
        assert!(out.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_url_userinfo_credentials() {
        let out = redact_sensitive_log_text("db connect failed postgres://alice:pw@db.example/app");
        assert!(!out.contains("alice"));
        assert!(!out.contains("pw@"));
        assert!(!out.contains("db.example"));
        assert!(out.contains("[REDACTED]"));
    }
}
