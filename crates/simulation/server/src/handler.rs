//! The core simulation handler — load → simulate → save.
//!
//! Given an [`EvaluateRequest`], this loads the wallet's `state_before` via the
//! [`WalletStore`] boundary, folds each request `envelope` through
//! [`simulation_reducer::apply`] + `apply_delta` to produce one delta per
//! action and a final `state_after`, persists the result, and returns the
//! [`EvaluateResponse`] the extension's Cedar layer consumes.

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt;

use simulation_reducer::apply;
use simulation_reducer::error::ReducerError;
use simulation_reducer::helpers::delta::apply_delta;
use simulation_state::store::StoreError;
use simulation_state::WalletStore;

use crate::dto::{Diagnostic, EvaluateRequest, EvaluateResponse, PolicyRequest};

/// Error surfaced by [`evaluate`].
///
/// `Reducer` is a *client* error (the action could not be applied to the given
/// state — map to `422 Unprocessable Entity`); `Store` is a *server* error (the
/// persistence layer failed — map to `500 Internal Server Error`).
#[derive(Debug)]
pub enum HandlerError {
    /// A reducer rejected an action (invalid for the current state).
    Reducer(ReducerError),
    /// The wallet store failed to load or save state.
    Store(StoreError),
}

impl fmt::Display for HandlerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Reducer(e) => write!(f, "reducer error: {e}"),
            Self::Store(e) => write!(f, "store error: {e}"),
        }
    }
}

impl Error for HandlerError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Reducer(e) => Some(e),
            Self::Store(e) => Some(e),
        }
    }
}

impl From<ReducerError> for HandlerError {
    fn from(e: ReducerError) -> Self {
        Self::Reducer(e)
    }
}

impl From<StoreError> for HandlerError {
    fn from(e: StoreError) -> Self {
        Self::Store(e)
    }
}

/// Simulates the request's action envelopes over the wallet's stored state.
///
/// Loads `state_before` from `store`, applies each envelope in order through
/// the reducer (one [`simulation_state::StateDelta`] per action), persists the
/// resulting `state_after`, and returns the [`EvaluateResponse`].
///
/// # Errors
///
/// Returns [`HandlerError::Store`] if loading or saving the wallet state fails,
/// or [`HandlerError::Reducer`] if any action cannot be applied to the
/// (running) state.
pub async fn evaluate(
    store: &dyn WalletStore,
    req: EvaluateRequest,
) -> Result<EvaluateResponse, HandlerError> {
    // TODO(prep): production `WalletStore`. This handler is db-agnostic — it
    // takes `&dyn WalletStore`. In production that trait object is the db
    // owner's SQLite impl from `simulation-db`; today `main` wires the dev/test
    // `InMemoryWalletStore`.
    let state_before = store.load(&req.wallet_id).await?;

    // Running state, folded forward one envelope at a time.
    let mut state = state_before.clone();
    let mut deltas = Vec::with_capacity(req.envelopes.len());

    for (i, action) in req.envelopes.iter().enumerate() {
        // The reducer is pure: it reads only `(state, action, ctx)`. The
        // per-envelope index lets the reducer disambiguate intra-batch effects.
        let ctx = req.eval_context.clone().with_envelope_index(i);

        // TODO(prep): live-input refresh. Once the sync orchestrator + RPC
        // config are wired, run
        //   `simulation_sync::Orchestrator::refresh_action(&mut action, &state, now)`
        // HERE — BEFORE `reducer::apply` — so each action's `live_inputs`
        // (prices/oracle values) are fetched against the *current* running
        // `state` and clock. That step does network IO, so it stays out until
        // the orchestrator + RpcConfig are injected into `AppState`. For now the
        // action's `live_inputs` are used as-supplied by the caller.

        let delta = apply(&state, action, &ctx)?;
        state = apply_delta(&state, &delta)?;
        deltas.push(delta);
    }

    store.save(&state).await?;

    // TODO(prep): enrichment-call execution. `req.call_specs` (the manifest's
    // planned enrichment calls) must be dispatched here to populate
    // `PolicyRequest::results` keyed by `CallSpec::call_id` — the Rust
    // equivalent of the Node.js policy-rpc host-capabilities / method-dispatch
    // layer. That executor (method registry + per-method enrichment) does not
    // exist in Rust yet, so `results` is empty for now and `optional` call
    // failures are not yet surfaced as diagnostics.
    let results = BTreeMap::new();

    let note = if req.envelopes.is_empty() {
        "simulated 0 envelopes (state echoed)".to_owned()
    } else {
        format!("simulated {} envelope(s)", req.envelopes.len())
    };

    Ok(EvaluateResponse {
        policy_request: PolicyRequest {
            actions: req.envelopes,
            state_before,
            deltas,
            state_after: state,
            results,
        },
        diagnostics: vec![Diagnostic {
            level: "info".to_owned(),
            message: note,
            call_id: None,
        }],
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    use std::str::FromStr;

    use simulation_state::primitives::{Address, BlockHeight, ChainId, Time};
    use simulation_state::{RequestKind, WalletId, WalletState};

    use crate::dto::EvaluateRequest;
    use crate::store::InMemoryWalletStore;

    fn sample_wallet_id() -> WalletId {
        WalletId::new(
            Address::from_str("0x000000000000000000000000000000000000a01c").unwrap(),
            [ChainId::ethereum_mainnet()],
        )
    }

    /// A `WalletState` that is *not* bit-identical to the empty default — so the
    /// load→echo→save round-trip is observable.
    fn non_trivial_state() -> WalletState {
        let mut state = WalletState::new(sample_wallet_id());
        state.block_heights.insert(
            ChainId::ethereum_mainnet(),
            BlockHeight {
                number: 19_000_000,
                time: 1_700_000_000,
            },
        );
        state
    }

    fn empty_envelope_request() -> EvaluateRequest {
        EvaluateRequest {
            wallet_id: sample_wallet_id(),
            envelopes: Vec::new(),
            eval_context: simulation_state::EvalContext::new(
                ChainId::ethereum_mainnet(),
                Time::from_unix(1_700_000_000),
                RequestKind::Transaction,
            ),
            call_specs: Vec::new(),
        }
    }

    /// load → echo → save plumbing: a seeded wallet with empty `envelopes`
    /// returns its state unchanged, with no deltas and no results.
    #[tokio::test]
    async fn empty_envelopes_echo_seeded_state() {
        let store = InMemoryWalletStore::new();
        let seeded = non_trivial_state();
        store.seed(seeded.clone());

        let resp = evaluate(&store, empty_envelope_request()).await.unwrap();

        assert_eq!(resp.policy_request.state_before, seeded);
        assert_eq!(resp.policy_request.state_after, seeded);
        assert!(resp.policy_request.deltas.is_empty());
        assert!(resp.policy_request.results.is_empty());

        // The save path persisted the (unchanged) state.
        assert_eq!(store.load(&sample_wallet_id()).await.unwrap(), seeded);
    }

    /// First-seen behavior: an unseeded wallet loads as an empty `WalletState`
    /// rather than erroring.
    #[tokio::test]
    async fn unseeded_wallet_loads_empty_state() {
        let store = InMemoryWalletStore::new();
        let id = sample_wallet_id();

        let loaded = store.load(&id).await.unwrap();
        assert_eq!(loaded, WalletState::new(id.clone()));

        // And the handler echoes that empty state for an empty request.
        let resp = evaluate(&store, empty_envelope_request()).await.unwrap();
        assert_eq!(resp.policy_request.state_before, WalletState::new(id));
        assert!(resp.policy_request.deltas.is_empty());
    }
}
