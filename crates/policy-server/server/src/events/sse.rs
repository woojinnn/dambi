//! `GET /events/stream` — Server-Sent Events feed for the dashboard.
//! Subscribes to the [`EventBus`], filters by the authenticated `user_id`,
//! and streams matching events as SSE messages. Browser `EventSource`
//! auto-reconnects via `Last-Event-ID` (we re-emit the broadcast id as
//! the SSE id).
//! Auth: standard `Authorization: Bearer …` header. Native `EventSource`
//! cannot set custom headers, so dashboard clients must use a header-capable
//! SSE/fetch stream polyfill rather than putting bearer tokens in the URL.

use std::convert::Infallible;
use std::time::Duration;

use axum::extract::State;
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderMap, HeaderName, HeaderValue};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Extension;
use futures::stream::{self, StreamExt};
use tokio_stream::wrappers::BroadcastStream;

use crate::app::ShutdownRx;
use crate::auth::AuthUser;
use crate::events::bus::EventBus;

/// `GET /events/stream` — long-lived SSE response.
/// Emits one SSE block per matching event. The `event:` field is the
/// `Event::kind()` discriminator so the client can `addEventListener` to
/// individual types. Comments (`: keepalive`) are sent every 30s by the
/// axum `KeepAlive` layer to keep proxies from closing idle connections.
pub async fn stream(
    State(bus): State<EventBus>,
    Extension(user): Extension<AuthUser>,
    shutdown: Option<Extension<ShutdownRx>>,
) -> Response {
    let rx = bus.subscribe();
    let stream = BroadcastStream::new(rx)
        // BroadcastStream yields `Result<T, RecvError>` — drop lag errors
        // (slow subscriber); the dashboard refreshes on reconnect anyway.
        .filter_map(|r| async { r.ok() })
        .filter_map(move |(uid, event)| {
            let mine = uid == user.user_id;
            async move {
                if !mine {
                    return None;
                }
                let kind = event.kind();
                let data = serde_json::to_string(&event).ok()?;
                Some(Ok::<_, Infallible>(
                    SseEvent::default().event(kind).data(data),
                ))
            }
        });
    // Empty prelude so the client sees a 200 immediately, before any
    // event arrives — keeps `EventSource.onopen` firing.
    let prelude = stream::once(async { Ok(SseEvent::default().comment("connected")) });
    // Drain on shutdown: when the `ShutdownRx` extension flips to `true`
    // (SIGTERM), end the stream so graceful shutdown doesn't wait out the
    // 30s keepalive. Without the extension (e.g. tests) the stream stays
    // unbounded, preserving prior behavior.
    let body = prelude.chain(stream).take_until(async move {
        match shutdown {
            Some(Extension(ShutdownRx(mut rx))) => {
                let _ = rx.wait_for(|v| *v).await;
            }
            None => std::future::pending::<()>().await,
        }
    });
    let mut response = Sse::new(body)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(30)))
        .into_response();
    insert_sse_headers(response.headers_mut());
    response
}

fn insert_sse_headers(headers: &mut HeaderMap) {
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-accel-buffering"),
        HeaderValue::from_static("no"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_headers_disable_caching_and_proxy_buffering() {
        let mut headers = HeaderMap::new();

        insert_sse_headers(&mut headers);

        assert_eq!(headers.get(CACHE_CONTROL).unwrap(), "no-store");
        assert_eq!(headers.get("x-accel-buffering").unwrap(), "no");
        assert_eq!(headers.get("referrer-policy").unwrap(), "no-referrer");
        assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    }
}
