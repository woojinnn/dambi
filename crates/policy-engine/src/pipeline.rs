//! Pipeline orchestrator for v0.x.
//!
//! Request flow:
//! 1) Resolve adapter and build actions from a transaction.
//! 2) Enrich actions with USD valuations, then attach leaf metadata.
//! 3) Lower actions to leaf requests and stamp capability fields.
//! 4) Build tx-level request summary and project stats window context.
//! 5) Evaluate leaf + tx requests through Cedar.
//!
//! `evaluate_with_reservation` uses reserve-first semantics: it reserves projected
//! swap window deltas before policy evaluation and then evaluates tx context built
//! from the pre-reservation snapshot (the reservation accounts for this tx intent).
//! `evaluate` instead projects the same window stats on demand in a single call.

use crate::core::{Action, TransactionRequest};
use crate::host::stat_windows::{ReservationId, StatDelta, StatKey};
use crate::host::HostCapabilities;
use crate::lowering::{
    compute_swap_window_deltas, enrich_actions_with_usd, enrich_request_with_capabilities,
    enrich_tx_request_with_window_stats, request_for_tx, request_from_action,
};
use crate::policy::{PolicyEngine, PolicyError, PolicyRequest, RequestKind, Verdict};
use crate::registry::{AdapterRegistry, ResolverOutcome};
use serde_json::{Map, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("adapter ambiguity: {0:?}")]
    Ambiguous(Vec<crate::AdapterId>),
    #[error("adapter build failed: {0}")]
    AdapterBuild(String),
    #[error("policy evaluation failed: {0}")]
    Policy(#[from] PolicyError),
}

/// Pipeline is generic over the registry type — `R: ?Sized` lets callers
/// pass either a concrete `&MockAdapterRegistry` (monomorphized, fast) or a
/// `&dyn AdapterRegistry` trait object (dynamic dispatch, swappable at
/// runtime). Host capabilities are passed as a small borrowed bundle to avoid
/// `Pipeline::new` signature churn as capabilities expand.
pub struct Pipeline<'a, R: AdapterRegistry + ?Sized> {
    pub registry: &'a R,
    pub host: HostCapabilities<'a>,
    pub policies: &'a PolicyEngine,
}

pub struct EvaluationOutcome {
    pub verdict: Verdict,
    pub reservation: Option<ReservationId>,
}

pub(crate) struct LoweredRequests {
    pub leaves: Vec<Action>,
    pub leaf_requests: Vec<PolicyRequest>,
    pub tx_request: PolicyRequest,
}

impl<'a, R: AdapterRegistry + ?Sized> Pipeline<'a, R> {
    pub fn new(registry: &'a R, host: HostCapabilities<'a>, policies: &'a PolicyEngine) -> Self {
        Pipeline {
            registry,
            host,
            policies,
        }
    }

    fn build_requests(&self, tx: &TransactionRequest) -> Result<LoweredRequests, PipelineError> {
        let (outcome, adapter) = self.registry.resolve_with_adapter(tx);

        let (leaves, metas) = match (outcome, adapter) {
            (ResolverOutcome::Ambiguous(ids), _) => {
                return Err(PipelineError::Ambiguous(ids));
            }
            (ResolverOutcome::NoMatch, _) => {
                // No adapter matched — emit `Action::Other` and let user
                // policies decide whether to allow unrecognized calls.
                let action = Action::Other {
                    actor: tx.from.clone(),
                    target: tx.to.clone(),
                    selector: tx.selector_hex().unwrap_or_else(|| "0x".into()),
                    value_wei: tx.value_wei.clone(),
                    raw_calldata: format!("0x{}", hex::encode(&tx.data)),
                };
                (vec![action], vec![Map::new()])
            }
            (ResolverOutcome::Resolved(_), Some(adapter)) => {
                let mut leaves = adapter
                    .build_actions(tx)
                    .map_err(|e| PipelineError::AdapterBuild(e.to_string()))?;
                enrich_actions_with_usd(&mut leaves, self.host.oracle());
                let metas = adapter.leaf_metadata(tx, &leaves);
                if metas.len() != leaves.len() {
                    return Err(PipelineError::AdapterBuild(format!(
                        "leaf_metadata length {} does not match build_actions length {}",
                        metas.len(),
                        leaves.len()
                    )));
                }
                (leaves, metas)
            }
            (ResolverOutcome::Resolved(_), None) => {
                unreachable!("Resolved outcome always carries an adapter")
            }
        };

        let leaf_requests: Vec<PolicyRequest> = leaves
            .iter()
            .zip(metas)
            .map(|(action, meta)| {
                let mut req = request_from_action(action);
                enrich_request_with_capabilities(&mut req, action, &self.host);
                merge_meta_into_context(&mut req, meta);
                req
            })
            .collect();
        let tx_request = request_for_tx(tx, &leaves, &leaf_requests);

        Ok(LoweredRequests {
            leaves,
            leaf_requests,
            tx_request,
        })
    }

    pub fn evaluate_with_reservation(
        &self,
        tx: &TransactionRequest,
    ) -> Result<EvaluationOutcome, PipelineError> {
        let LoweredRequests {
            leaves,
            leaf_requests,
            tx_request,
        } = self.build_requests(tx)?;
        let deltas = compute_swap_window_deltas(&leaves);
        let mut reservation = self.host.stats().and_then(|stats| {
            if deltas.is_empty() {
                None
            } else {
                Some(stats.reserve(&tx.from, deltas.clone()))
            }
        });
        let verdict =
            match self.evaluate_with_window_stats(&tx.from, &leaf_requests, tx_request, &[]) {
                Ok(verdict) => verdict,
                Err(error) => {
                    self.release_reservation(reservation.take());
                    return Err(PipelineError::Policy(error));
                }
            };

        let reservation = if matches!(verdict, Verdict::Fail(_)) {
            self.release_reservation(reservation.take());
            None
        } else {
            reservation
        };

        Ok(EvaluationOutcome {
            verdict,
            reservation,
        })
    }

    pub fn evaluate(&self, tx: &TransactionRequest) -> Result<Verdict, PipelineError> {
        let LoweredRequests {
            leaves,
            leaf_requests,
            tx_request,
        } = self.build_requests(tx)?;
        let deltas = compute_swap_window_deltas(&leaves);

        Ok(self.evaluate_with_window_stats(&tx.from, &leaf_requests, tx_request, &deltas)?)
    }

    fn evaluate_with_window_stats(
        &self,
        actor: &crate::core::Address,
        leaf_requests: &[PolicyRequest],
        mut tx_request: PolicyRequest,
        pending_deltas: &[StatDelta],
    ) -> Result<Verdict, PolicyError> {
        let swap_window_keys = [StatKey::SWAP_VOLUME_USD_24H, StatKey::SWAP_COUNT_24H];

        enrich_tx_request_with_window_stats(
            &mut tx_request,
            actor,
            &swap_window_keys,
            pending_deltas,
            &self.host,
        );

        let mut tagged_requests = Vec::with_capacity(leaf_requests.len() + 1);
        for (idx, request) in leaf_requests.iter().enumerate() {
            tagged_requests.push((request.clone(), RequestKind::Leaf { index: idx }));
        }
        tagged_requests.push((tx_request, RequestKind::Tx));

        self.policies
            .evaluate_requests(tagged_requests.iter().map(|(req, kind)| (req, *kind)))
    }

    fn release_reservation(&self, reservation: Option<ReservationId>) {
        if let (Some(id), Some(stats)) = (reservation, self.host.stats()) {
            stats.release(id);
        }
    }
}

fn merge_meta_into_context(request: &mut PolicyRequest, meta: Map<String, Value>) {
    // `PolicyRequest.context` is constructed as a JSON object at this boundary,
    // and should remain object-shaped for all lowering paths.
    let Some(context) = request.context.as_object_mut() else {
        return;
    };
    context.extend(meta);
}
