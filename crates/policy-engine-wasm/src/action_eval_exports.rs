//! `#[wasm_bindgen]` v2 (ActionBody-model) policy-RPC exports.
//!
//! Built on the v3 `ActionBody` model (the legacy flat action
//! route/plan/evaluate exports were removed in the Phase 1 action restructure).
//! The two phases are:
//!
//! 1. [`plan_action_rpc_v2_json`] — lower the action, plan the v2 policy-RPC
//!    calls, return `{ planned: [...] }` for the host to dispatch.
//! 2. [`evaluate_action_v2_json`] — lower the action again, replay the host's
//!    raw results into each matching bundle's own `context.custom`, then
//!    evaluate every matching bundle's Cedar policy against its per-policy
//!    schema and aggregate the verdict.
//!
//! The input JSON reuses the trigger export's `{ manifests, action, tx }`
//! shape, extended with `meta: ActionMeta` (the lowering needs it) and — for
//! the evaluate phase — `bundles: [{ policy, manifest }]` and a raw
//! `results: { call_id: Value }` map.
//!
//! Fail-closed translation of [`PolicyRpcError::SystemFail`] into a synthetic
//! `Verdict::Fail` happens at THIS boundary (via
//! [`system_fail_verdict`](policy_engine::policy_rpc::system_fail_verdict)),
//! mirroring v1's `d9_branch` in `evaluate_policy_rpc_json`.
//!
//! # Boundary invariant — the planned set is derived from the bundles
//!
//! v1 tied PLAN + materialize + the installed engine to ONE manifest set via
//! `manifest_set_hash` / `schema_hash`, so a required RPC call could never be
//! evaluated by a policy that the plan phase did not enrich. v2 has no
//! installed engine to hash against — the policies arrive inline as `bundles`.
//! The equivalent invariant is therefore restored structurally:
//! [`evaluate_action_v2_json`] PLANS from the **bundles' own valid matching
//! manifests**, never from a host-supplied side list, then MATERIALIZES per
//! bundle so custom-context fields are isolated by policy schema. Every valid
//! bundle that is evaluated thus has its required (`optional == false`) calls in
//! the planned set; a missing result for any of them surfaces as
//! [`PolicyRpcError::SystemFail`] → a fail-closed `__system__` verdict. The
//! boundary cannot fail-open by the host passing inconsistent manifest lists,
//! because there is only one list.
//!
//! [`ActionBody`]: policy_transition::action::ActionBody

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use wasm_bindgen::prelude::wasm_bindgen;

use policy_engine::lowering_v2::{
    lower_action_enriched, AccountLeverage, LoweredAction, OrderEnrichment, TokenDecimals, TxMeta,
};
use policy_engine::policy::{MatchedPolicy, PolicyEngine, Severity, Verdict};
use policy_engine::policy_rpc::{
    plan_policy_rpc_v2, scope_matches_position as trigger_scope_matches_position,
    system_fail_verdict, ManifestV2, PlannedCallV2, TxView, MAX_POLICY_RPC_V2_MANIFESTS,
};
use policy_engine::schema::compose_per_policy;
use policy_transition::action::{ActionBody, ActionMeta};

use crate::dto::{EngineErrorDto, Envelope, MatchedPolicyDto, VerdictDto};
use crate::exports::check_input_size;

// ── input DTOs ────────────────────────────────────────────────────────────

/// Transaction-level routing fields. Mirrors the trigger export's `TxInput`,
/// reused for both phases. `chain_id` is the CAIP-2 string (e.g. `"eip155:1"`).
///
/// `from` / `to` are **lowercased at deserialization** (`de_lower_addr`): EVM
/// addresses are case-insensitive (EIP-55 checksum is display-only), but they
/// feed `principal.address` (`Wallet`) and `resource` (`Protocol::"<to>"`),
/// which Cedar compares byte-for-byte against `addr()`-lowercased context
/// addresses (e.g. `context.recipient`). A wallet that submits a checksummed
/// `from` would otherwise false-positive a `context.recipient != principal.address`
/// recipient-self deny on a *legitimate* self-action. Normalizing here is the
/// single boundary chokepoint shared by plan / evaluate / debug.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct TxInput {
    pub(crate) chain_id: String,
    #[serde(deserialize_with = "de_lower_addr")]
    pub(crate) from: String,
    #[serde(deserialize_with = "de_lower_addr")]
    pub(crate) to: String,
}

/// Deserialize a hex address, normalizing to ASCII lowercase so it compares
/// byte-equal against `addr()`-lowercased addresses elsewhere in the context.
/// (Deser-time normalization replaces the post-parse `TxInput::normalize()` from
/// origin/main — same effect, one chokepoint, can't be forgotten at a call site.)
fn de_lower_addr<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    Ok(s.to_ascii_lowercase())
}

fn check_manifest_count(count: usize, entry: &str) -> Result<(), EngineErrorDto> {
    if count > MAX_POLICY_RPC_V2_MANIFESTS {
        return Err(EngineErrorDto::new(
            "input_too_large",
            format!(
                "{entry} manifest/bundle count {count} exceeds {MAX_POLICY_RPC_V2_MANIFESTS} item limit"
            ),
        ));
    }
    Ok(())
}

/// Input to [`plan_action_rpc_v2_json`].
///
/// Carries the decoded [`ActionBody`], its [`ActionMeta`], the installed v2
/// manifests, and the tx routing fields. Reuses the trigger export's
/// `{ manifests, action, tx }` shape, extended with `meta` (required by
/// [`lower_action`]).
#[derive(Debug, Deserialize)]
struct PlanActionInput {
    manifests: Vec<ManifestV2>,
    action: ActionBody,
    meta: ActionMeta,
    tx: TxInput,
    /// Host-injected per-token decimals (lowercase `0x` address → decimals),
    /// used to fill each fungible amount's `amountNano` `Long` sibling. Absent
    /// ⇒ no nano fields are emitted (the lowering omits the optional sibling).
    #[serde(default)]
    token_decimals: BTreeMap<String, u8>,
    /// Host-injected per-asset venue leverage (decimal-string `asset_index` →
    /// leverage), used to fill the HL order `leverage` `Long` field from the
    /// SW's `activeAssetData` lookup. Absent ⇒ the field is omitted.
    #[serde(default)]
    account_leverage: BTreeMap<String, i64>,
    /// Host-injected order-time enrichment BEYOND bare leverage (maxLeverage /
    /// leverageType / notionalUsd / account margin health / position state),
    /// from the SW's HL `meta` + `activeAssetData` + `clearinghouseState`
    /// lookups. Absent ⇒ every enriched field is omitted. See [`OrderEnrichment`].
    #[serde(default)]
    order_enrichment: OrderEnrichment,
}

/// One installed bundle: the user's Cedar policy text paired with the manifest
/// that synthesizes its per-policy schema + custom-context.
#[derive(Debug, Deserialize)]
pub(crate) struct BundleInput {
    pub(crate) policy: String,
    pub(crate) manifest: ManifestV2,
}

/// Input to [`evaluate_action_v2_json`].
///
/// Everything [`PlanActionInput`] carries minus `manifests` (the action must be
/// re-lowered to recover the principal/action/resource uids and base context),
/// plus the installed `bundles` and the host's raw `results` keyed by
/// [`PlannedCallV2::call_id`].
///
/// There is deliberately **no** standalone `manifests` field: the planned set
/// that drives materialization (and therefore the `SystemFail` gate) is derived
/// from `bundles[].manifest`, the same manifests that produce the evaluated
/// schemas. See the module-level boundary invariant — a separate `manifests`
/// list would let the host diverge the gate from the evaluated policies and
/// silently fail-open a required RPC call.
#[derive(Debug, Deserialize)]
struct EvaluateActionInput {
    action: ActionBody,
    meta: ActionMeta,
    tx: TxInput,
    bundles: Vec<BundleInput>,
    /// Raw host results keyed by `call_id` (the unwrapped `$.result` payload).
    #[serde(default)]
    results: BTreeMap<String, Value>,
    /// Host-injected per-token decimals (see [`PlanActionInput::token_decimals`]).
    #[serde(default)]
    token_decimals: BTreeMap<String, u8>,
    /// Host-injected per-asset venue leverage (see
    /// [`PlanActionInput::account_leverage`]).
    #[serde(default)]
    account_leverage: BTreeMap<String, i64>,
    /// Host-injected order-time enrichment (see
    /// [`PlanActionInput::order_enrichment`]).
    #[serde(default)]
    order_enrichment: OrderEnrichment,
}

// ── output DTOs ──────────────────────────────────────────────────────────

/// Serializable mirror of [`PlannedCallV2`] (the engine type is not `Serialize`).
#[derive(Debug, Clone, Serialize)]
struct PlannedCallDto {
    manifest_id: String,
    call_id: String,
    method: String,
    params: Value,
    /// Output projection rules, rooted at `$.result`, as opaque JSON.
    outputs: Vec<Value>,
    optional: bool,
}

/// Success payload of [`plan_action_rpc_v2_json`].
#[derive(Debug, Clone, Serialize)]
struct PlanActionOutput {
    planned: Vec<PlannedCallDto>,
}

/// Success payload of [`evaluate_action_v2_json`].
#[derive(Debug, Clone, Serialize)]
struct EvaluateActionOutput {
    verdict: VerdictDto,
}

// ── exports ──────────────────────────────────────────────────────────────

/// PLAN phase: lower the action and plan its v2 policy-RPC calls.
///
/// Parses [`PlanActionInput`], lowers via [`lower_action`], builds the
/// [`ActionView`](policy_transition::action::ActionView) + [`TxView`], calls
/// [`plan_policy_rpc_v2`], and returns the planned calls inside the standard
/// `{ ok, data }` envelope. The host dispatches each call and returns the raw
/// results keyed by `call_id` to [`evaluate_action_v2_json`].
///
/// The host **should** plan over the same manifest set it later submits as
/// `bundles[].manifest` to [`evaluate_action_v2_json`], so every required call
/// is dispatched. This is advisory only: the plan phase does not gate the
/// verdict. [`evaluate_action_v2_json`] re-plans from the bundles themselves and
/// fail-closes (`__system__`) on any required call whose result is missing, so a
/// plan/evaluate manifest mismatch can never silently fail-open — it can only
/// surface as a fail-closed verdict.
#[wasm_bindgen]
#[must_use]
pub fn plan_action_rpc_v2_json(input_json: String) -> String {
    let result = (|| -> Result<PlanActionOutput, EngineErrorDto> {
        check_input_size(&input_json, "plan_action_rpc_v2_json")?;
        let input: PlanActionInput =
            serde_json::from_str(&input_json).map_err(|error| invalid_input(&error.to_string()))?;
        check_manifest_count(input.manifests.len(), "plan_action_rpc_v2_json")?;
        let decimals = TokenDecimals::new(input.token_decimals.clone());
        let leverage = AccountLeverage::new(input.account_leverage.clone());
        let lowered = lower(
            &input.action,
            &input.meta,
            &input.tx,
            &decimals,
            &leverage,
            &input.order_enrichment,
        )?;
        let manifests = matching_valid_manifests(input.manifests.iter(), &input.action, &input.tx)?;
        let planned = plan(&manifests, &input.action, &lowered, &input.tx)?;
        Ok(PlanActionOutput {
            planned: planned.iter().map(planned_to_dto).collect(),
        })
    })();

    match result {
        Ok(output) => Envelope::ok(output).to_json(),
        Err(error) => Envelope::<()>::err(error.kind, error.message).to_json(),
    }
}

/// EVALUATE phase: replay the host's raw results into a bundle-local
/// `context.custom`, then evaluate every matching bundle and aggregate the
/// verdict.
///
/// Parses [`EvaluateActionInput`], re-lowers the action (to recover the
/// principal/action/resource uids + base context), plans the calls **from the
/// bundles' own valid matching manifests** (see the module-level boundary
/// invariant), then — for each matching bundle — replays that bundle's host
/// `results` into its own `context.custom.*`, composes its per-policy schema,
/// builds a single per-policy engine, and evaluates. The per-bundle verdicts
/// are aggregated by deny-overrides ([`Verdict::aggregate`]).
///
/// A [`PolicyRpcError::SystemFail`] during materialization is translated here
/// into the synthetic `__system__` `Verdict::Fail` (mirroring v1's `d9_branch`);
/// every other error becomes an `__engine::*` `Fail`. The verdict is always
/// returned inside an `ok` envelope, so the host reads `data.verdict.kind`.
#[wasm_bindgen]
#[must_use]
pub fn evaluate_action_v2_json(input_json: String) -> String {
    let verdict = (|| -> Result<Verdict, EngineErrorDto> {
        check_input_size(&input_json, "evaluate_action_v2_json")?;
        let input: EvaluateActionInput =
            serde_json::from_str(&input_json).map_err(|error| invalid_input(&error.to_string()))?;
        check_manifest_count(input.bundles.len(), "evaluate_action_v2_json")?;

        let decimals = TokenDecimals::new(input.token_decimals.clone());
        let leverage = AccountLeverage::new(input.account_leverage.clone());
        let lowered = lower(
            &input.action,
            &input.meta,
            &input.tx,
            &decimals,
            &leverage,
            &input.order_enrichment,
        )?;

        // Boundary invariant: PLAN over the bundles' own valid matching
        // manifests, never a host-supplied side list, and apply the same
        // scope-position + trigger gate that evaluation uses. Invalid matching
        // manifests are deliberately excluded from materialization so the
        // per-bundle quarantine path below can isolate them to a visible warn
        // instead of letting one broken bundle blanket-fail global planning.
        let manifests = matching_valid_manifests(
            input.bundles.iter().map(|bundle| &bundle.manifest),
            &input.action,
            &input.tx,
        )?;
        let planned = plan(&manifests, &input.action, &lowered, &input.tx)?;

        evaluate_matching_bundles(
            &input.bundles,
            &input.action,
            &input.tx,
            &lowered,
            &planned,
            &input.results,
        )
    })();

    let dto = match verdict {
        Ok(verdict) => verdict_to_dto(&verdict),
        Err(error) => engine_error_verdict(error),
    };
    Envelope::ok(EvaluateActionOutput { verdict: dto }).to_json()
}

/// DEBUG (diagnostic-only): lower the action and return Cedar entity uids plus a
/// best-effort materialized context — base lowering plus the host `results`
/// replayed into `context.custom.*`.
///
/// Reuses the [`evaluate_action_v2_json`] input shape, so the host can pass the
/// same `{ action, meta, tx, bundles, results }` and see the camelCase,
/// cedarschema-shaped context (e.g. `direction.amountIn`, `slippageBp`,
/// `tokenIn`) that Cedar policies read. For multiple bundles, the verdict path
/// materializes custom fields per bundle; this debug export returns a single
/// merged best-effort context only. A plan/materialize fault is swallowed so the
/// base lowered context is still returned. Has NO effect on the verdict path.
#[wasm_bindgen]
#[must_use]
pub fn debug_lowered_context_v2_json(input_json: String) -> String {
    let result = (|| -> Result<Value, EngineErrorDto> {
        check_input_size(&input_json, "debug_lowered_context_v2_json")?;
        let input: EvaluateActionInput =
            serde_json::from_str(&input_json).map_err(|error| invalid_input(&error.to_string()))?;
        check_manifest_count(input.bundles.len(), "debug_lowered_context_v2_json")?;
        let decimals = TokenDecimals::new(input.token_decimals.clone());
        let leverage = AccountLeverage::new(input.account_leverage.clone());
        let lowered = lower(
            &input.action,
            &input.meta,
            &input.tx,
            &decimals,
            &leverage,
            &input.order_enrichment,
        )?;
        let manifests = matching_valid_manifests(
            input.bundles.iter().map(|bundle| &bundle.manifest),
            &input.action,
            &input.tx,
        )?;
        let mut context = lowered.context.clone();
        // Best-effort replay so `context.custom.*` shows when enrichment is wired;
        // ignore a plan/materialize fault and surface the base lowered context.
        if let Ok(planned) = plan(&manifests, &input.action, &lowered, &input.tx) {
            let _ =
                policy_engine::policy_rpc::materialize_v2(&mut context, &planned, &input.results);
        }
        Ok(serde_json::json!({
            "principal": lowered.principal,
            "actionUid": lowered.action_uid,
            "resource": lowered.resource,
            "context": context,
        }))
    })();

    match result {
        Ok(payload) => Envelope::ok(payload).to_json(),
        Err(error) => Envelope::<()>::err(error.kind, error.message).to_json(),
    }
}

// ── shared helpers ───────────────────────────────────────────────────────

/// Lower an [`ActionBody`] + [`ActionMeta`] + tx into a [`LoweredAction`], with
/// all host-injected venue state: `decimals` (for `amountNano` siblings),
/// `leverage` (the HL order `leverage` field), and `enrichment` (the remaining
/// order-time enrichment — see [`OrderEnrichment`]).
fn lower(
    action: &ActionBody,
    meta: &ActionMeta,
    tx: &TxInput,
    decimals: &TokenDecimals,
    leverage: &AccountLeverage,
    enrichment: &OrderEnrichment,
) -> Result<LoweredAction, EngineErrorDto> {
    let tx_meta = TxMeta {
        from: &tx.from,
        to: &tx.to,
    };
    lower_action_enriched(action, meta, &tx_meta, decimals, leverage, enrichment)
        .map_err(|error| EngineErrorDto::new("unsupported_action", error.to_string()))
}

/// Plan the v2 policy-RPC calls for one lowered action.
fn plan(
    manifests: &[ManifestV2],
    action: &ActionBody,
    lowered: &LoweredAction,
    tx: &TxInput,
) -> Result<Vec<PlannedCallV2>, EngineErrorDto> {
    let view = action.view();
    let tx_view = tx_view(tx);
    plan_policy_rpc_v2(manifests, &view, &lowered.context, &tx_view)
        .map_err(|error| EngineErrorDto::new("plan_failed", error.to_string()))
}

/// Runtime materialization only uses matching manifests that are structurally
/// valid. Matching invalid manifests are still evaluated later and quarantined
/// per bundle; filtering them here prevents one broken policy bundle from
/// turning the whole action into a global `__engine::plan_failed` verdict before
/// the quarantine boundary runs.
fn matching_valid_manifests<'a, I>(
    manifests: I,
    action: &ActionBody,
    tx: &TxInput,
) -> Result<Vec<ManifestV2>, EngineErrorDto>
where
    I: IntoIterator<Item = &'a ManifestV2>,
{
    let view = action.view();
    let tx_view = tx_view(tx);
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for manifest in manifests {
        if !trigger_scope_matches_position(manifest.trigger.scope, &view)
            || !policy_engine::policy_rpc::evaluate_trigger(&manifest.trigger, &view, &tx_view)
            || manifest.validate().is_err()
        {
            continue;
        }
        if !seen.insert(manifest.id.as_str()) {
            return Err(EngineErrorDto::new(
                "duplicate_manifest_id",
                format!(
                    "matching policy-rpc manifest id `{}` appears more than once",
                    manifest.id
                ),
            ));
        }
        out.push(manifest.clone());
    }
    Ok(out)
}

/// Rebuild a diagnostic materialized context: lower the action, plan from the
/// bundles' valid matching manifests, replay `results` into `context.custom.*`.
/// This mirrors the verdict path for single-bundle probes; for multi-bundle
/// inputs, verdict evaluation materializes custom fields per bundle while this
/// helper returns one merged best-effort context.
#[allow(clippy::too_many_arguments)]
pub(crate) fn materialized_context(
    action: &ActionBody,
    meta: &ActionMeta,
    tx: &TxInput,
    bundles: &[BundleInput],
    results: &BTreeMap<String, Value>,
    decimals: &TokenDecimals,
    leverage: &AccountLeverage,
    enrichment: &OrderEnrichment,
) -> Result<(LoweredAction, Value), EngineErrorDto> {
    let lowered = lower(action, meta, tx, decimals, leverage, enrichment)?;
    let manifests = matching_valid_manifests(bundles.iter().map(|b| &b.manifest), action, tx)?;
    let planned = plan(&manifests, action, &lowered, tx)?;
    let mut context = lowered.context.clone();
    if let Err(error) = policy_engine::policy_rpc::materialize_v2(&mut context, &planned, results) {
        if system_fail_verdict(&error).is_some() {
            return Err(EngineErrorDto::new("system_fail", error.to_string()));
        }
        return Err(EngineErrorDto::new("projection_failed", error.to_string()));
    }
    Ok((lowered, context))
}

/// Entity slice for Cedar's `Entities::from_json_value` (engine.rs:227).
///
/// Cedar evaluates `principal.<attr>` accesses by looking the principal up in
/// this slice and reading its attrs object. We synthesize the same two entities
/// everywhere the ActionBody v2 path runs Cedar:
/// - `Wallet::"<tx.from>"` with `attrs.address = tx.from`
/// - `Protocol::"<tx.to>"` attribute-less (`Core::Protocol` declares none)
///
/// The lowering layer formats `lowered.principal` as `Wallet::"<from>"` and
/// `lowered.resource` as `Protocol::"<to>"`, so the request uids resolve cleanly
/// against this slice in both verdict evaluation and denial diagnosis.
pub(crate) fn entities_for_tx(tx: &TxInput) -> Value {
    serde_json::json!([
        {
            "uid": { "type": "Wallet", "id": tx.from.as_str() },
            "attrs": { "address": tx.from.as_str() },
            "parents": [],
        },
        {
            "uid": { "type": "Protocol", "id": tx.to.as_str() },
            "attrs": {},
            "parents": [],
        }
    ])
}

/// Evaluate every bundle whose trigger matches the action and aggregate the
/// per-bundle verdicts (deny-overrides via [`Verdict::aggregate`]).
///
/// A bundle whose [`Trigger`](policy_engine::policy_rpc::Trigger) does not match
/// the action is skipped (it neither contributes a verdict nor an error). With
/// no matching bundles the aggregate of an empty list is `Pass` — the
/// no-manifest baseline.
fn evaluate_matching_bundles(
    bundles: &[BundleInput],
    action: &ActionBody,
    tx: &TxInput,
    lowered: &LoweredAction,
    planned: &[PlannedCallV2],
    results: &BTreeMap<String, Value>,
) -> Result<Verdict, EngineErrorDto> {
    let view = action.view();
    let tx_view = tx_view(tx);

    let entities = entities_for_tx(tx);

    // Scope×position gate (mirrors `trigger_exports::manifest_matches`). The SW
    // dispatches the outer multicall AND each inner child as its own evaluate
    // envelope (see `orchestrator.ts::evaluateBodyTree`), so a bundle must fire
    // at exactly one position:
    //   - `Outer`-scoped policy → applies to a BATCH only; skip on a leaf.
    //   - `Inner`-scoped policy (default) → applies PER-CHILD; skip on the
    //     multicall itself (it fires when the SW re-enters with each child).
    // This closes the per-child-detail gap (an Inner slippage/recipient policy
    // never seeing a UR-wrapped swap) without double-firing the same policy on
    // both the batch and its children.
    let mut verdicts: Vec<Verdict> = Vec::new();
    for bundle in bundles {
        // Per-bundle install-quarantine. A single broken bundle — invalid
        // manifest, un-composable schema, un-installable / un-evaluable Cedar
        // policy — must NOT blanket-deny the whole action tag. Pre-fix, the first
        // `?` short-circuited the ENTIRE function to one `__engine::<kind>` Fail,
        // discarding every already-collected healthy verdict AND skipping every
        // later bundle (this is the F-SCHEMA-1 / F-REQRPC amplification: one
        // policy typo → tag-wide outage / false denials). Now each bundle is
        // evaluated in isolation: a bundle-local fault becomes a warn-closed
        // `__engine::quarantine::<kind>` verdict (auditable, surfaced, but not a
        // hard block), and the healthy bundles still evaluate and drive the
        // aggregate — deny-overrides is preserved, so a healthy deny still Fails
        // the action. Global lower/plan faults are handled ABOVE this loop and
        // remain fail-closed via `?`; missing required bundle RPC results still
        // become `__system__` Fail verdicts below.
        let outcome: Result<Option<Verdict>, EngineErrorDto> = (|| {
            if !trigger_scope_matches_position(bundle.manifest.trigger.scope, &view) {
                return Ok(None);
            }
            if !policy_engine::policy_rpc::evaluate_trigger(
                &bundle.manifest.trigger,
                &view,
                &tx_view,
            ) {
                return Ok(None);
            }
            bundle
                .manifest
                .validate()
                .map_err(|error| EngineErrorDto::new("invalid_manifest", error.to_string()))?;

            // Materialize `context.custom` per bundle. The schema is per-policy,
            // so two healthy bundles may reuse the same custom field name without
            // colliding; required RPC misses still fail closed as `__system__`.
            let bundle_planned: Vec<PlannedCallV2> = planned
                .iter()
                .filter(|call| call.manifest_id == bundle.manifest.id)
                .cloned()
                .collect();
            let mut context = lowered.context.clone();
            if let Err(error) =
                policy_engine::policy_rpc::materialize_v2(&mut context, &bundle_planned, results)
            {
                if let Some(verdict) = system_fail_verdict(&error) {
                    return Ok(Some(verdict));
                }
                return Err(EngineErrorDto::new("projection_failed", error.to_string()));
            }

            let schema = compose_per_policy(&bundle.manifest)
                .map_err(|error| EngineErrorDto::new("schema_failed", error.to_string()))?;
            let engine = PolicyEngine::build_from_per_policy(&[(bundle.policy.clone(), schema)])
                .map_err(|error| EngineErrorDto::new("install_failed", error.to_string()))?;
            let verdict = engine
                .evaluate(
                    &lowered.principal,
                    &lowered.action_uid,
                    &lowered.resource,
                    &entities,
                    &context,
                )
                .map_err(|error| EngineErrorDto::new("policy", error.to_string()))?;
            Ok(Some(verdict))
        })();

        match outcome {
            Ok(Some(verdict)) => verdicts.push(verdict),
            // Scope / trigger non-match: not an error, contributes no verdict.
            Ok(None) => {}
            // Broken bundle: quarantine to a warn-closed verdict, keep going.
            Err(error) => verdicts.push(quarantine_verdict(&error)),
        }
    }

    Ok(Verdict::aggregate(verdicts))
}

/// Isolate a single broken bundle's fault to a warn-closed [`Verdict`] so it
/// cannot blanket-deny the whole action tag (install-quarantine). Carries a
/// `__engine::quarantine::<kind>` matched policy at `Warn` severity, so the
/// fault is auditable and surfaced to the user without hard-blocking every
/// action that matched the broken policy; the healthy bundles still drive the
/// aggregate (deny-overrides). This is deliberately DISTINCT from
/// [`engine_error_verdict`] (whole-engine fault → `Fail`): that path is for
/// lower / plan / materialize faults, which genuinely cannot produce ANY verdict
/// for the action, whereas a broken individual bundle is one policy among many
/// that did evaluate. (A broken policy cannot enforce its intent regardless of
/// severity; warn-closing it trades an availability DoS for a visible warning.
/// Preventing broken policies from being installed is the separate publish-time
/// gate — F1.2.)
fn quarantine_verdict(error: &EngineErrorDto) -> Verdict {
    let policy_id = format!("__engine::quarantine::{}", error.kind);
    let reason = if error.message.is_empty() {
        policy_id.clone()
    } else {
        error.message.clone()
    };
    Verdict::Warn(vec![MatchedPolicy {
        policy_id,
        reason: Some(reason),
        severity: Severity::Warn,
        origin: policy_engine::PolicyRequestOrigin::Action,
    }])
}

/// Build a borrowed [`TxView`] from the parsed `tx` input.
fn tx_view(tx: &TxInput) -> TxView<'_> {
    TxView {
        chain_id: &tx.chain_id,
        from: &tx.from,
        to: &tx.to,
    }
}

fn planned_to_dto(call: &PlannedCallV2) -> PlannedCallDto {
    PlannedCallDto {
        manifest_id: call.manifest_id.clone(),
        call_id: call.call_id.clone(),
        method: call.method.clone(),
        params: call.params.clone(),
        outputs: call
            .outputs
            .iter()
            .map(|output| serde_json::to_value(output).unwrap_or(Value::Null))
            .collect(),
        optional: call.optional,
    }
}

fn invalid_input(message: &str) -> EngineErrorDto {
    EngineErrorDto::new(
        "invalid_input_json",
        format!("invalid input json: {message}"),
    )
}

// ── verdict → DTO mapping (local mirror of `exports.rs`) ──────────────────

fn verdict_to_dto(verdict: &Verdict) -> VerdictDto {
    match verdict {
        Verdict::Pass => VerdictDto::Pass,
        Verdict::Warn(matched) => VerdictDto::Warn {
            matched: matched.iter().map(matched_to_dto).collect(),
        },
        Verdict::Fail(matched) => VerdictDto::Fail {
            matched: matched.iter().map(matched_to_dto).collect(),
        },
    }
}

fn matched_to_dto(matched: &MatchedPolicy) -> MatchedPolicyDto {
    MatchedPolicyDto {
        policy_id: matched.policy_id.clone(),
        reason: matched.reason.clone(),
        severity: match matched.severity {
            Severity::Deny => "deny".to_owned(),
            Severity::Warn => "warn".to_owned(),
        },
        origin: match matched.origin {
            policy_engine::PolicyRequestOrigin::Action => "action".to_owned(),
            policy_engine::PolicyRequestOrigin::Tx => "tx".to_owned(),
        },
    }
}

/// Translate an engine-level error into a fail-closed `Verdict::Fail` carrying a
/// synthetic `__engine::<kind>` matched policy. Mirrors `exports::engine_error_verdict`.
fn engine_error_verdict(error: EngineErrorDto) -> VerdictDto {
    let policy_id = format!("__engine::{}", error.kind);
    let reason = if error.message.is_empty() {
        policy_id.clone()
    } else {
        error.message
    };
    VerdictDto::Fail {
        matched: vec![MatchedPolicyDto {
            policy_id,
            reason: Some(reason),
            severity: "deny".to_owned(),
            // Match v1's `exports::engine_error_verdict` contract: the synthetic
            // `__engine::*` Fail carries origin "engine_error", not "action".
            origin: "engine_error".to_owned(),
        }],
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
pub(crate) mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::str::FromStr;

    use policy_state::live_field::{DataSource, OracleProvider};
    use policy_state::primitives::{Address, ChainId, Duration, Time, U128, U256};
    use policy_state::token::{TokenKey, TokenRef};
    use policy_state::LiveField;
    use policy_transition::action::amm::{
        AmmAction, AmmVenue, PoolState, RouteHop, RoutePath, SwapAction, SwapDirection,
        SwapLiveInputs, SwapParams, SwapRoute,
    };
    use policy_transition::action::hyperliquid_core::{HlUnknownAction, HyperliquidCoreAction};
    use policy_transition::action::{ActionMeta, ActionNature};

    const FROM: &str = "0x1111111111111111111111111111111111111111";
    const TO: &str = "0x2222222222222222222222222222222222222222";

    /// A faithful UniswapV3 swap `ActionBody` + `ActionMeta` (mirrors the
    /// `materialize_v2` reference fixture).
    fn swap_sample() -> (ActionBody, ActionMeta) {
        let now = Time::from_unix(1_738_000_000);
        let user = Address::from_str("0x000000000000000000000000000000000000a01c").unwrap();
        let chain = ChainId::arbitrum();
        let usdc = TokenRef {
            key: TokenKey::Erc20 {
                chain: chain.clone(),
                address: Address::from_str("0xaf88d065e77c8cc2239327c5edb3a432268e5831").unwrap(),
            },
        };
        let weth = TokenRef {
            key: TokenKey::Erc20 {
                chain: chain.clone(),
                address: Address::from_str("0x82af49447d8a07e3bd95bd0d56f35241523fbab1").unwrap(),
            },
        };
        let pool = Address::from_str("0xc6962004f452be9203591991d15f6b388e09e8d0").unwrap();
        let v3 = AmmVenue::UniswapV3 {
            chain: chain.clone(),
            pool,
            fee_tier_bp: 500,
        };
        let pool_state = PoolState::Concentrated {
            sqrt_price_x96: U256::from(1u64),
            tick: 0,
            liquidity: U128::from(0u64),
            ticks: vec![],
        };
        let pool_source = DataSource::OnchainView {
            chain: chain.clone(),
            contract: pool,
            function: "slot0()".into(),
            decoder_id: "uniswap_v3_slot0".into(),
        };
        let route = SwapRoute {
            paths: vec![RoutePath {
                share_bp: 10000,
                hops: vec![RouteHop {
                    token_in: usdc.clone(),
                    token_out: weth.clone(),
                    venue: v3.clone(),
                    pool_state,
                    effective_fee_bp: 5,
                    estimated_out: U256::from(305_000_000_000_000_000u64),
                }],
                estimated_out: U256::from(305_000_000_000_000_000u64),
            }],
            aggregator: None,
        };
        let swap = AmmAction::Swap(SwapAction {
            venue: v3,
            params: SwapParams {
                token_in: usdc,
                token_out: Some(weth),
                direction: SwapDirection::ExactInput {
                    amount_in: U256::from(1_000_000_000u64),
                    min_amount_out: U256::from(300_000_000_000_000_000u64),
                },
                recipient: user,
                slippage_bp: 50,
            },
            live_inputs: SwapLiveInputs {
                route: LiveField::new(route, pool_source.clone(), now)
                    .with_ttl(Duration::from_secs(12)),
                expected_amount_out: LiveField::new(
                    U256::from(305_000_000_000_000_000u64),
                    pool_source.clone(),
                    now,
                ),
                price_impact_bp: LiveField::new(12u32, pool_source, now),
                gas_estimate: LiveField::new(
                    U256::from(180_000u64),
                    DataSource::OracleFeed {
                        provider: OracleProvider::Pyth,
                        feed_id: "gas/arbitrum".into(),
                    },
                    now,
                ),
            },
        });
        let meta = ActionMeta {
            submitted_at: now,
            submitter: user,
            nature: ActionNature::OnchainTx {
                chain,
                nonce: 42,
                gas_limit: U256::from(200_000u64),
                gas_price: LiveField::new(
                    U256::from(100_000_000u64),
                    DataSource::OracleFeed {
                        provider: OracleProvider::Pyth,
                        feed_id: "ETH/USD".into(),
                    },
                    now,
                ),
                value: U256::ZERO,
            },
        };
        (ActionBody::Amm(swap), meta)
    }

    /// A swap manifest: trigger matches `swap`, one policy_rpc call writing
    /// `context.custom.totalInputUsd` (decimal), declared in `custom_context`.
    fn swap_manifest() -> Value {
        json!({
            "id": "large-swap-usd-warning",
            "schema_version": 2,
            "trigger": { "where": { "action.tag": { "eq": "swap" } } },
            "policy_rpc": [{
                "id": "total-input-usd",
                "method": "oracle.usd_value",
                "params": {
                    "chain_id": "$.root.chain_id",
                    "recipient": "$.action.recipient"
                },
                "outputs": [{
                    "kind": "context",
                    "field": "totalInputUsd",
                    "type": "Decimal",
                    "from": "$.result.usd"
                }]
            }],
            "custom_context": { "fields": { "totalInputUsd": "decimal" } }
        })
    }

    fn swap_manifest_with_id(id: &str) -> Value {
        let mut manifest = swap_manifest();
        manifest["id"] = json!(id);
        manifest
    }

    /// A Cedar policy that warns when `context.custom.totalInputUsd` exceeds
    /// 1000. `custom` is optional and `totalInputUsd` is a `decimal` extension
    /// value, so the guard must `has`-check the path and use `greaterThan`.
    fn warn_policy() -> &'static str {
        "@id(\"large-input\")\n@severity(\"warn\")\n\
         @reason(\"large USD input\")\n\
         forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
         when { context has custom && context.custom has totalInputUsd \
         && context.custom.totalInputUsd.greaterThan(decimal(\"1000.0000\")) };\n"
    }

    fn tx() -> Value {
        json!({ "chain_id": "eip155:42161", "from": FROM, "to": TO })
    }

    #[test]
    fn plan_action_rpc_v2_returns_oracle_call() {
        let (body, meta) = swap_sample();
        let input = json!({
            "manifests": [swap_manifest()],
            "action": body,
            "meta": meta,
            "tx": tx(),
        });
        let out = plan_action_rpc_v2_json(input.to_string());
        let parsed: Value = serde_json::from_str(&out).unwrap();

        assert_eq!(parsed["ok"], true, "{parsed}");
        let planned = parsed["data"]["planned"].as_array().expect("planned array");
        assert_eq!(planned.len(), 1, "{parsed}");
        assert_eq!(
            planned[0]["call_id"],
            "large-swap-usd-warning::total-input-usd"
        );
        assert_eq!(planned[0]["method"], "oracle.usd_value");
        assert_eq!(planned[0]["params"]["chain_id"], "eip155:42161");
    }

    /// End-to-end: plan → simulate an oracle result → evaluate → Warn.
    #[test]
    fn evaluate_action_v2_warns_on_large_input() {
        let (body, meta) = swap_sample();

        // 1. PLAN — recover the call_id the host must key its result under.
        let plan_out = plan_action_rpc_v2_json(
            json!({
                "manifests": [swap_manifest()],
                "action": body,
                "meta": meta,
                "tx": tx(),
            })
            .to_string(),
        );
        let plan_parsed: Value = serde_json::from_str(&plan_out).unwrap();
        let call_id = plan_parsed["data"]["planned"][0]["call_id"]
            .as_str()
            .expect("call_id")
            .to_owned();
        assert_eq!(call_id, "large-swap-usd-warning::total-input-usd");

        // 2. EVALUATE — the host returns a $3500 oracle valuation, which the
        //    warn policy (threshold 1000) trips. The evaluate phase plans from
        //    the bundle's own manifest, so the planned call_id matches the one
        //    the plan phase produced and the host keyed its result under.
        let eval_out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": tx(),
                "bundles": [{ "policy": warn_policy(), "manifest": swap_manifest() }],
                "results": { call_id: { "usd": "3500.1200" } }
            })
            .to_string(),
        );
        let eval_parsed: Value = serde_json::from_str(&eval_out).unwrap();
        assert_eq!(eval_parsed["ok"], true, "{eval_parsed}");
        assert_eq!(
            eval_parsed["data"]["verdict"]["kind"], "warn",
            "{eval_parsed}"
        );
        assert_eq!(
            eval_parsed["data"]["verdict"]["matched"][0]["policy_id"], "large-input",
            "{eval_parsed}"
        );
    }

    /// No bundles installed → the aggregate of zero verdicts is `Pass`.
    #[test]
    fn evaluate_action_v2_no_bundle_baseline_passes() {
        let (body, meta) = swap_sample();
        let eval_out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": tx(),
                "bundles": [],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&eval_out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "pass", "{parsed}");
    }

    /// 호스트(dapp)가 checksum 케이스 `tx.from`을 줘도 `principal.address` 비교가
    /// 오탐하지 않는다 — 엔진 내부 주소는 전부 소문자라 입구에서 정규화해야 한다
    /// (UNI-01 `swap-recipient-not-self-deny` 거짓 양성 회귀).
    #[test]
    fn evaluate_action_v2_normalizes_checksummed_tx_from() {
        let (body, meta) = swap_sample();
        // swap_sample의 recipient = 0x…a01c (소문자). tx.from은 같은 주소의
        // checksum 케이스 — 정규화 없으면 `recipient != principal.address`가 발화.
        let policy = "@id(\"swap-recipient-not-self-deny\")\n@severity(\"deny\")\n\
             @reason(\"recipient is not your wallet\")\n\
             forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
             when { context.recipient != principal.address };\n";
        let manifest = json!({
            "id": "swap-recipient-not-self-deny",
            "schema_version": 2,
            "trigger": { "where": { "action.tag": { "eq": "swap" } } }
        });
        let eval_out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": {
                    "chain_id": "eip155:42161",
                    "from": "0x000000000000000000000000000000000000A01C",
                    "to": TO
                },
                "bundles": [{ "policy": policy, "manifest": manifest }],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&eval_out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "pass", "{parsed}");
    }

    /// A required call with no host result fails closed: `materialize_v2`
    /// returns `SystemFail`, which this boundary maps to a `__system__`
    /// `Verdict::Fail` (mirrors v1's D9 branch).
    #[test]
    fn evaluate_action_v2_missing_required_result_system_fails() {
        let (body, meta) = swap_sample();
        let eval_out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": tx(),
                "bundles": [{ "policy": warn_policy(), "manifest": swap_manifest() }],
                // No result for the required call → SystemFail.
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&eval_out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "fail", "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["matched"][0]["policy_id"], "__system__",
            "{parsed}"
        );
    }

    /// Regression for the divergent-manifest fail-open (Task #7 review,
    /// high). Before the fix, `evaluate_action_v2_json` drove the SystemFail
    /// gate off a standalone `manifests` list while evaluating a SEPARATE
    /// `bundles[].manifest`. A bundle whose required RPC manifest was *absent*
    /// from `manifests` was never planned, never materialized, never
    /// SystemFailed — and the has-guarded forbid reading the absent custom
    /// field short-circuited to Pass (fail-open).
    ///
    /// The fix derives the planned set from `bundles[].manifest`, so there is
    /// no second list to diverge: a bundle requiring an RPC call whose result
    /// the host never returns now ALWAYS SystemFails to a `__system__` Fail.
    /// Here we reproduce the historical attack shape — a (now-ignored)
    /// `manifests` side list that does NOT contain the bundle's manifest, with
    /// empty `results` — and assert it fails closed.
    #[test]
    fn evaluate_action_v2_divergent_manifest_fails_closed_not_open() {
        let (body, meta) = swap_sample();
        let eval_out = evaluate_action_v2_json(
            json!({
                // Historical fail-open vector: a side list that does NOT carry
                // the bundle's manifest. It is now ignored entirely — the
                // planned set comes from `bundles[].manifest`.
                "manifests": [],
                "action": body,
                "meta": meta,
                "tx": tx(),
                "bundles": [{ "policy": warn_policy(), "manifest": swap_manifest() }],
                // Host returned nothing for the bundle's required call.
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&eval_out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["kind"], "fail",
            "divergent manifest must fail closed, not Pass: {parsed}"
        );
        assert_eq!(
            parsed["data"]["verdict"]["matched"][0]["policy_id"], "__system__",
            "{parsed}"
        );
    }

    // ── Per-bundle install-quarantine (F-SCHEMA-1 / F-REQRPC amplification fix) ──
    //
    // A broken bundle must be isolated to a warn-closed `__engine::quarantine::*`
    // verdict instead of short-circuiting the whole `evaluate_matching_bundles`
    // loop to a blanket `__engine` Fail. The broken policy below is the literal
    // F-SCHEMA-1 shape: a forbid reading the UNDECLARED `context.protocol.name`
    // (the declared field is `context.venue.name`), which fails Cedar
    // install/validation → a broken bundle.

    /// A bundle that fails to install (references undeclared `context.protocol.*`).
    fn broken_schema_policy() -> &'static str {
        "@id(\"bridge-protocol-not-allowlisted-warn\")\n@severity(\"warn\")\n\
         @reason(\"protocol not allowlisted\")\n\
         forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
         when { context.protocol.name == \"evil\" };\n"
    }

    /// A single broken bundle quarantines to `warn` (NOT a blanket `__engine` deny).
    #[test]
    fn evaluate_action_v2_broken_bundle_quarantined_to_warn() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": broken_schema_policy(), "manifest": dashboard_manifest("broken") }],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["kind"], "warn",
            "a broken bundle must quarantine to warn, not blanket-deny the tag: {parsed}"
        );
        let pid = parsed["data"]["verdict"]["matched"][0]["policy_id"]
            .as_str()
            .unwrap_or_default();
        assert!(
            pid.starts_with("__engine::quarantine"),
            "quarantine verdict must carry __engine::quarantine::*, got {pid}: {parsed}"
        );
    }

    /// A malformed bundle whose trigger does not match this action must not
    /// poison the position during planning. Broken matching bundles quarantine,
    /// but non-matching ones should be invisible to the verdict.
    #[test]
    fn evaluate_action_v2_invalid_non_matching_bundle_is_skipped() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{
                    "policy": broken_schema_policy(),
                    "manifest": {
                        "id": "invalid-lending-only",
                        "schema_version": 999,
                        "trigger": { "where": { "action.domain": { "eq": "lending" } } }
                    }
                }],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "pass",
            "invalid non-matching bundle must not fail or warn an unrelated swap: {out}"
        );
    }

    /// An invalid bundle whose trigger DOES match the action must still be
    /// isolated by the per-bundle quarantine path. Global planning must not
    /// fail the entire verdict before `evaluate_matching_bundles` can quarantine
    /// the broken bundle.
    #[test]
    fn evaluate_action_v2_invalid_matching_manifest_quarantined_to_warn() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{
                    "policy": "permit(principal, action, resource);",
                    "manifest": {
                        "id": "invalid-matching-duplicate-rpc",
                        "schema_version": 2,
                        "trigger": { "where": { "action.tag": { "eq": "swap" } } },
                        "policy_rpc": [
                            { "id": "dup", "method": "oracle.usd_value", "outputs": [] },
                            { "id": "dup", "method": "oracle.usd_value", "outputs": [] }
                        ]
                    }
                }],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["kind"], "warn",
            "invalid matching manifest must quarantine to warn, not blanket fail planning: {parsed}"
        );
        let pid = parsed["data"]["verdict"]["matched"][0]["policy_id"]
            .as_str()
            .unwrap_or_default();
        assert_eq!(
            pid, "__engine::quarantine::invalid_manifest",
            "invalid matching manifest must surface as per-bundle quarantine: {parsed}"
        );
    }

    /// The extension calls PLAN before EVALUATE. Runtime planning must therefore
    /// skip invalid matching manifests instead of throwing, while still planning
    /// required RPC calls from healthy siblings.
    #[test]
    fn plan_action_rpc_v2_skips_invalid_matching_manifest_preserves_healthy_sibling() {
        let (body, meta) = swap_sample();
        let out = plan_action_rpc_v2_json(
            json!({
                "manifests": [
                    {
                        "id": "invalid-matching-duplicate-rpc",
                        "schema_version": 2,
                        "trigger": { "where": { "action.tag": { "eq": "swap" } } },
                        "policy_rpc": [
                            { "id": "dup", "method": "oracle.usd_value", "outputs": [] },
                            { "id": "dup", "method": "oracle.usd_value", "outputs": [] }
                        ]
                    },
                    swap_manifest()
                ],
                "action": body,
                "meta": meta,
                "tx": tx()
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        let planned = parsed["data"]["planned"].as_array().unwrap();
        assert_eq!(
            planned.len(),
            1,
            "invalid matching manifest must not block healthy sibling planning: {parsed}"
        );
        assert_eq!(
            planned[0]["call_id"], "large-swap-usd-warning::total-input-usd",
            "{parsed}"
        );
    }

    /// `call_id` is `<manifest_id>::<spec_id>`, so matching valid manifests must
    /// have unique ids before host dispatch builds the result map.
    #[test]
    fn plan_action_rpc_v2_rejects_duplicate_matching_manifest_ids() {
        let (body, meta) = swap_sample();
        let out = plan_action_rpc_v2_json(
            json!({
                "manifests": [swap_manifest(), swap_manifest()],
                "action": body,
                "meta": meta,
                "tx": tx()
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "duplicate_manifest_id", "{parsed}");
    }

    #[test]
    fn evaluate_action_v2_duplicate_matching_manifest_ids_fail_closed() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [
                    { "policy": warn_policy(), "manifest": swap_manifest() },
                    { "policy": "permit(principal, action, resource);", "manifest": swap_manifest() }
                ],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "fail", "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["matched"][0]["policy_id"], "__engine::duplicate_manifest_id",
            "{parsed}"
        );
    }

    /// `context.custom` is a per-policy schema extension. Two healthy matching
    /// bundles may legitimately use the same custom field name; materialization
    /// must isolate them per bundle instead of treating the shared field as a
    /// global overwrite fault.
    #[test]
    fn evaluate_action_v2_custom_context_field_collision_is_per_bundle() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [
                    { "policy": warn_policy(), "manifest": swap_manifest() },
                    {
                        "policy": "permit(principal, action, resource);",
                        "manifest": swap_manifest_with_id("large-swap-usd-warning-copy")
                    }
                ],
                "results": {
                    "large-swap-usd-warning::total-input-usd": { "usd": "1500.0000" },
                    "large-swap-usd-warning-copy::total-input-usd": { "usd": "1.0000" }
                }
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["kind"], "warn",
            "shared custom field names across healthy bundles must not blanket-fail projection: {parsed}"
        );
        let ids: Vec<&str> = parsed["data"]["verdict"]["matched"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|matched| matched["policy_id"].as_str())
            .collect();
        assert!(ids.contains(&"large-input"), "{parsed}");
    }

    /// A broken bundle must NOT poison a sibling HEALTHY policy that passes. The
    /// `only-usdt` forbid does not fire on the WETH sample (Pass), so with the
    /// broken bundle quarantined the aggregate is `warn` — pre-fix the broken
    /// bundle's `?` short-circuited the whole function to a blanket `__engine` Fail.
    #[test]
    fn evaluate_action_v2_broken_bundle_does_not_poison_healthy_pass() {
        let (body, meta) = swap_sample();
        let healthy_pass = format!(
            "@id(\"only-usdt\")\n@severity(\"deny\")\n\
             forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
             when {{ context has tokenOut && context.tokenOut.key has address \
             && context.tokenOut.key.address == \"{USDT}\" }};\n"
        );
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [
                    { "policy": broken_schema_policy(), "manifest": dashboard_manifest("broken") },
                    { "policy": healthy_pass, "manifest": dashboard_manifest("only-usdt") }
                ],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["kind"], "warn",
            "a healthy pass must not be flipped to a deny by a sibling broken bundle: {parsed}"
        );
    }

    /// A healthy DENY still fires even when a SIBLING bundle is broken and listed
    /// FIRST: pre-fix the broken bundle's `?` exited before the deny was ever
    /// evaluated (blanket `__engine` fail, real deny absent). Post-fix the broken
    /// bundle is quarantined and `block-non-usdt` is evaluated and present in the
    /// matched set (deny-overrides → Fail).
    #[test]
    fn evaluate_action_v2_healthy_deny_survives_broken_bundle() {
        let (body, meta) = swap_sample();
        let healthy_deny = format!(
            "@id(\"block-non-usdt\")\n@severity(\"deny\")\n@reason(\"output token is not USDT\")\n\
             forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
             when {{ context has tokenOut \
             && !(context.tokenOut.key has address && context.tokenOut.key.address == \"{USDT}\") }};\n"
        );
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [
                    { "policy": broken_schema_policy(), "manifest": dashboard_manifest("broken") },
                    { "policy": healthy_deny, "manifest": dashboard_manifest("block-non-usdt") }
                ],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "fail", "{parsed}");
        let matched = parsed["data"]["verdict"]["matched"].as_array().unwrap();
        let ids: Vec<&str> = matched
            .iter()
            .filter_map(|m| m["policy_id"].as_str())
            .collect();
        assert!(
            ids.contains(&"block-non-usdt"),
            "the healthy deny must be evaluated despite a broken sibling listed first, got {ids:?}: {parsed}"
        );
    }

    #[test]
    fn invalid_input_returns_error_envelope() {
        let out = plan_action_rpc_v2_json("not json".to_owned());
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "invalid_input_json", "{parsed}");
    }

    #[test]
    fn plan_action_rpc_v2_rejects_too_many_manifests() {
        let (body, meta) = swap_sample();
        let manifests: Vec<Value> = (0..=MAX_POLICY_RPC_V2_MANIFESTS)
            .map(|i| dashboard_manifest(&format!("m{i}")))
            .collect();

        let out = plan_action_rpc_v2_json(
            json!({
                "manifests": manifests,
                "action": body,
                "meta": meta,
                "tx": tx(),
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();

        assert_eq!(parsed["ok"], false, "{parsed}");
        assert_eq!(parsed["error"]["kind"], "input_too_large", "{parsed}");
        assert!(
            parsed["error"]["message"]
                .as_str()
                .unwrap()
                .contains("manifest/bundle count"),
            "{parsed}"
        );
    }

    #[test]
    fn evaluate_action_v2_too_many_bundles_fails_closed() {
        let (body, meta) = swap_sample();
        let bundles: Vec<Value> = (0..=MAX_POLICY_RPC_V2_MANIFESTS)
            .map(|i| {
                json!({
                    "policy": "permit(principal, action, resource);",
                    "manifest": dashboard_manifest(&format!("m{i}"))
                })
            })
            .collect();

        let out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": tx(),
                "bundles": bundles,
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();

        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "fail", "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["matched"][0]["policy_id"], "__engine::input_too_large",
            "{parsed}"
        );
    }

    // ── Dashboard policy (Option B) — synthesized minimal manifest ──────────
    //
    // `policies-loader-v2.ts` projects each user-authored dashboard policy to a
    // bundle whose manifest is the MINIMAL `{ id, schema_version: 2 }`: empty
    // trigger (matches every action), no `policy_rpc`, no `custom_context`. The
    // next two tests pin that exact shape through the real Cedar engine — a
    // base-context `forbid` reading `context.tokenOut.key.address` compiles
    // against the full base schema and evaluates conditionally on the token.

    const USDT: &str = "0xdac17f958d2ee523a2206206994597c13d831ec7";

    /// The minimal manifest `policies-loader-v2` synthesizes for a dashboard
    /// policy id. Empty trigger ⇒ the Cedar head is the sole filter.
    fn dashboard_manifest(id: &str) -> Value {
        json!({ "id": id, "schema_version": 2 })
    }

    /// Run `evaluate_action_v2_json` for the WETH-output `swap_sample` with one
    /// dashboard bundle (synthesized manifest) and return the parsed envelope.
    fn eval_dashboard(policy: &str, id: &str) -> Value {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": tx(),
                "bundles": [{ "policy": policy, "manifest": dashboard_manifest(id) }],
                "results": {}
            })
            .to_string(),
        );
        serde_json::from_str(&out).unwrap()
    }

    #[test]
    fn evaluate_action_v2_unknown_domain_trigger_matches_hl_unknown_alias() {
        let now = Time::from_unix(1_738_000_000);
        let user = Address::from_str(FROM).unwrap();
        let body = ActionBody::HyperliquidCore(HyperliquidCoreAction::Unknown(HlUnknownAction {
            action_type: "unrecognizedCoreWriterAction".to_owned(),
        }));
        let meta = ActionMeta {
            submitted_at: now,
            submitter: user,
            nature: ActionNature::OnchainTx {
                chain: ChainId::new("eip155:999"),
                nonce: 1,
                gas_limit: U256::from(100_000u64),
                gas_price: LiveField::new(
                    U256::from(1u64),
                    DataSource::OracleFeed {
                        provider: OracleProvider::Pyth,
                        feed_id: "gas/hyperevm".into(),
                    },
                    now,
                ),
                value: U256::ZERO,
            },
        };
        let policy = "@id(\"unknown-blind-sign-warning\")\n@severity(\"warn\")\n\
             @reason(\"Unrecognized action\")\n\
             forbid(principal, action == Core::Action::\"Unknown\", resource)\n\
             when { context has actionType && context.actionType == \"unrecognizedCoreWriterAction\" };\n";
        let out = evaluate_action_v2_json(
            json!({
                "action": body,
                "meta": meta,
                "tx": { "chain_id": "eip155:999", "from": FROM, "to": TO },
                "bundles": [{
                    "policy": policy,
                    "manifest": {
                        "id": "unknown-blind-sign-warning",
                        "schema_version": 2,
                        "trigger": { "where": { "action.domain": { "eq": "unknown" } } }
                    }
                }],
                "results": {}
            })
            .to_string(),
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "warn", "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["matched"][0]["policy_id"], "unknown-blind-sign-warning",
            "{parsed}"
        );
    }

    /// HOLYMOLY shape: block a swap whose output token is NOT USDT. The sample
    /// outputs WETH, so the `!= USDT` forbid fires → Fail (deny).
    #[test]
    fn evaluate_action_v2_dashboard_minimal_manifest_blocks_non_usdt_swap() {
        let policy = format!(
            "@id(\"block-non-usdt\")\n@severity(\"deny\")\n\
             @reason(\"output token is not USDT\")\n\
             forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
             when {{ context has tokenOut \
             && !(context.tokenOut.key has address \
             && context.tokenOut.key.address == \"{USDT}\") }};\n"
        );
        let parsed = eval_dashboard(&policy, "dashboard::block-non-usdt");
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "fail", "{parsed}");
        assert_eq!(
            parsed["data"]["verdict"]["matched"][0]["policy_id"], "block-non-usdt",
            "{parsed}"
        );
    }

    /// Control (inverted guard): forbid when output IS USDT. The WETH sample is
    /// not USDT, so the `has address && == USDT` guard is false → forbid does
    /// not fire → Pass. Proves the guard actually reads the token address rather
    /// than firing unconditionally.
    #[test]
    fn evaluate_action_v2_dashboard_minimal_manifest_passes_when_guard_false() {
        let policy = format!(
            "@id(\"only-usdt\")\n@severity(\"deny\")\n\
             forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
             when {{ context has tokenOut \
             && context.tokenOut.key has address \
             && context.tokenOut.key.address == \"{USDT}\" }};\n"
        );
        let parsed = eval_dashboard(&policy, "dashboard::only-usdt");
        assert_eq!(parsed["ok"], true, "{parsed}");
        assert_eq!(parsed["data"]["verdict"]["kind"], "pass", "{parsed}");
    }

    // ── A1 scope×position gate (multicall per-child fan-out) ─────────────────
    //
    // `evaluate_matching_bundles` decides, from the action's own shape, whether
    // a bundle fires at THIS position: `Inner` (default) policies fire on a leaf
    // and are SKIPPED on the multicall (they fire when the SW re-dispatches each
    // child — `orchestrator.ts::evaluateBodyTree`); `Outer` policies fire on the
    // multicall batch and are SKIPPED on a leaf. The four cases below form two
    // controlled pairs that differ ONLY in manifest `scope`, with EMPTY triggers
    // so trigger-matching is neutral and the scope gate alone decides — each skip
    // case would fire were the gate absent (its sibling proves the policy fires).

    /// Wrap the reference swap in a one-child `Multicall` (reusing its meta), so
    /// one fixture drives both the leaf and the batch position.
    fn multicall_of_swap() -> (ActionBody, ActionMeta) {
        let (swap_body, meta) = swap_sample();
        (
            ActionBody::Multicall {
                actions: vec![swap_body],
            },
            meta,
        )
    }

    /// Empty-trigger manifest, default (`Inner`) scope — matches every position.
    fn always_inner_manifest() -> Value {
        json!({ "id": "always-inner", "schema_version": 2 })
    }

    /// Empty-trigger manifest, default (`Inner`) scope, with one required RPC.
    /// On a multicall outer/batch position this bundle is skipped by scope, so
    /// the required RPC must not be materialized there.
    fn always_inner_required_rpc_manifest() -> Value {
        json!({
            "id": "always-inner-required-rpc",
            "schema_version": 2,
            "policy_rpc": [{
                "id": "must-not-run-on-batch",
                "method": "oracle.usd_value",
                "params": { "chain_id": "$.root.chain_id" },
                "outputs": []
            }]
        })
    }

    /// Empty-trigger manifest, `Outer` scope — matches every position.
    fn always_outer_manifest() -> Value {
        json!({ "id": "always-outer", "schema_version": 2, "trigger": { "scope": "outer" } })
    }

    /// `forbid` on the swap leaf (`slippageBp > 10`; the fixture's 50 trips it).
    fn swap_forbid_policy() -> &'static str {
        "@id(\"swap-guard\")\n@severity(\"warn\")\n@reason(\"swap leaf\")\n\
         forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
         when { context.slippageBp > 10 };\n"
    }

    /// `forbid` on the multicall batch (`childCount >= 1`; the fixture has 1).
    fn multicall_forbid_policy() -> &'static str {
        "@id(\"batch-guard\")\n@severity(\"warn\")\n@reason(\"batch\")\n\
         forbid(principal, action == Core::Action::\"Multicall\", resource)\n\
         when { context.childCount >= 1 };\n"
    }

    fn verdict_kind(eval_out: &str) -> Value {
        let parsed: Value = serde_json::from_str(eval_out).unwrap();
        assert_eq!(parsed["ok"], true, "{parsed}");
        parsed["data"]["verdict"]["kind"].clone()
    }

    /// Inner policy + leaf swap → FIRES (the per-child position).
    #[test]
    fn scope_inner_fires_on_leaf_swap() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": swap_forbid_policy(), "manifest": always_inner_manifest() }],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "warn",
            "inner policy must fire on a leaf swap: {out}"
        );
    }

    /// Inner policy + multicall → SKIPPED by the gate (it fires per-child).
    /// Same policy + same multicall fires under `Outer` scope
    /// (`scope_outer_fires_on_multicall`), so a `pass` here is the gate, not a
    /// trigger/schema miss.
    #[test]
    fn scope_inner_skipped_on_multicall() {
        let (body, meta) = multicall_of_swap();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": multicall_forbid_policy(), "manifest": always_inner_manifest() }],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "pass",
            "inner policy must be skipped on the multicall batch: {out}"
        );
    }

    /// Inner-scope also has to gate policy-RPC planning/materialization. A broad
    /// Inner policy may require host facts for every child action, but the
    /// multicall batch position itself is skipped; missing results for that
    /// skipped position must not become a synthetic `__system__` Fail.
    #[test]
    fn scope_inner_required_rpc_skipped_on_multicall_batch_position() {
        let (body, meta) = multicall_of_swap();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{
                    "policy": multicall_forbid_policy(),
                    "manifest": always_inner_required_rpc_manifest()
                }],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "pass",
            "inner required RPC must be skipped on the multicall batch before materialization: {out}"
        );
    }

    /// Outer policy + multicall → FIRES (the batch position).
    #[test]
    fn scope_outer_fires_on_multicall() {
        let (body, meta) = multicall_of_swap();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": multicall_forbid_policy(), "manifest": always_outer_manifest() }],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "warn",
            "outer policy must fire on the multicall batch: {out}"
        );
    }

    /// Outer policy + leaf swap → SKIPPED by the gate (batch-only policy).
    /// Same policy + same swap fires under `Inner` scope
    /// (`scope_inner_fires_on_leaf_swap`), so a `pass` here is the gate.
    #[test]
    fn scope_outer_skipped_on_leaf_swap() {
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": swap_forbid_policy(), "manifest": always_outer_manifest() }],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "pass",
            "outer policy must be skipped on a standalone leaf swap: {out}"
        );
    }

    /// The per-child example set must stay structurally valid: every manifest
    /// passes `ManifestV2::validate` and every Cedar policy COMPILES against its
    /// synthesized per-policy schema (catching a base-field / action-uid typo,
    /// an orphan custom-context field, or a bad enrichment projection).
    ///
    /// The bundles are embedded INLINE (not `include_str!`) — the human-facing
    /// copy lives at the gitignored build-output path
    /// `browser-extension/public/default-policies/examples/per-child-multicall.example.json`
    /// (alongside the equally-gitignored shipped `policy-set-v2.json`), so a
    /// clone / CI would not have it. Keep this mirror in sync with that file.
    /// Demonstrates each scope: three Inner bundles (swap-slippage,
    /// transfer-allowlist, swap-usd-cap) + one Outer bundle (large-batch).
    #[test]
    fn per_child_example_bundles_compile() {
        let raw: &str = r##"[
  { "id": "swap-slippage-guard",
    "policy": "@id(\"swap-slippage-guard\")\n@severity(\"warn\")\n@reason(\"Swap slippage tolerance above 1% (100 bp)\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen { context.slippageBp > 100 };\n",
    "manifest": { "id": "swap-slippage-guard", "schema_version": 2,
      "trigger": { "where": { "action.tag": { "eq": "swap" } } } } },
  { "id": "transfer-recipient-allowlist",
    "policy": "@id(\"transfer-recipient-allowlist\")\n@severity(\"deny\")\n@reason(\"ERC-20 transfer recipient is not on the allow-list\")\nforbid(principal, action == Token::Action::\"Erc20Transfer\", resource)\nwhen {\n  !([\n    \"0xd8da6bf26964af9d7eed9e03e53415d37aa96045\",\n    \"0xae2fc483527b8ef99eb5d9b44875f005ba1fae13\"\n  ].contains(context.recipient))\n};\n",
    "manifest": { "id": "transfer-recipient-allowlist", "schema_version": 2,
      "trigger": { "where": { "action.tag": { "eq": "erc20_transfer" } } } } },
  { "id": "large-batch-warn",
    "policy": "@id(\"large-batch-warn\")\n@severity(\"warn\")\n@reason(\"Batch bundles more than 8 actions\")\nforbid(principal, action == Core::Action::\"Multicall\", resource)\nwhen { context.childCount > 8 };\n",
    "manifest": { "id": "large-batch-warn", "schema_version": 2,
      "trigger": { "scope": "outer", "where": { "action.domain": { "eq": "multicall" } } } } },
  { "id": "swap-usd-cap",
    "policy": "@id(\"swap-usd-cap\")\n@severity(\"warn\")\n@reason(\"Swap input value exceeds $5,000\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen {\n  context has custom &&\n  context.custom has inputUsd &&\n  context.custom.inputUsd.greaterThan(decimal(\"5000.0000\"))\n};\n",
    "manifest": { "id": "swap-usd-cap", "schema_version": 2,
      "trigger": { "where": { "action.tag": { "eq": "swap" } } },
      "policy_rpc": [ { "id": "input-usd", "method": "oracle.usd_value",
        "params": { "chain_id": "$.root.chain_id", "asset": "$.action.inputToken.asset", "amount": "$.action.inputToken.amount.value" },
        "outputs": [ { "kind": "context", "field": "inputUsd", "type": "Decimal", "from": "$.result.usd" } ] } ],
      "custom_context": { "fields": { "inputUsd": "decimal" } } } }
]"##;
        let bundles: Vec<Value> =
            serde_json::from_str(raw).expect("example bundles are a valid JSON array");
        assert_eq!(bundles.len(), 4, "example set has 4 bundles");

        for bundle in &bundles {
            let id = bundle["id"].as_str().expect("bundle id");
            let policy = bundle["policy"].as_str().expect("bundle policy text");
            let manifest: ManifestV2 = serde_json::from_value(bundle["manifest"].clone())
                .unwrap_or_else(|e| panic!("bundle `{id}` manifest parses as ManifestV2: {e}"));
            manifest
                .validate()
                .unwrap_or_else(|e| panic!("bundle `{id}` manifest is valid: {e}"));
            let schema = compose_per_policy(&manifest)
                .unwrap_or_else(|e| panic!("bundle `{id}` composes a per-policy schema: {e}"));
            PolicyEngine::build_from_per_policy(&[(policy.to_owned(), schema)]).unwrap_or_else(
                |e| panic!("bundle `{id}` Cedar must compile against its schema: {e}"),
            );
        }
    }

    /// The SHIPPED default `high-slippage-warning` bundle (verbatim from
    /// `browser-extension/public/default-policies/policy-set-v2.json`): an
    /// Inner-scoped (no `trigger.scope` → default Inner) `forbid` on
    /// `Amm::Action::"Swap"` when `slippageBp > 100`.
    pub(crate) fn shipped_high_slippage_bundle() -> Value {
        json!({
            "policy": "@id(\"high-slippage-warning\")\n@severity(\"warn\")\nforbid(principal, action == Amm::Action::\"Swap\", resource)\nwhen { context.slippageBp > 100 };\n",
            "manifest": { "id": "high-slippage-warning", "schema_version": 2,
                "trigger": { "where": { "action.tag": { "eq": "swap" } } } }
        })
    }

    /// `swap_sample` but with a caller-chosen `slippage_bp` so the shipped
    /// `slippageBp > 100` guard can be made to trip (150) or not (50).
    pub(crate) fn swap_sample_with_slippage(bp: u32) -> (ActionBody, ActionMeta) {
        let (body, meta) = swap_sample();
        let ActionBody::Amm(AmmAction::Swap(mut swap)) = body else {
            unreachable!("swap_sample yields an amm swap")
        };
        swap.params.slippage_bp = bp;
        (ActionBody::Amm(AmmAction::Swap(swap)), meta)
    }

    /// END-TO-END (question stage c): the REAL shipped `high-slippage-warning`
    /// Inner-scoped swap policy FIRES on a UR-style child swap (slippage 150 >
    /// 100 → warn). This is the per-child position `evaluateBodyTree` re-enters
    /// with: lower → trigger-match (`action.tag == "swap"`) → Cedar eval → warn.
    #[test]
    fn shipped_swap_policy_fires_on_child_swap_position() {
        let (body, meta) = swap_sample_with_slippage(150);
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [ shipped_high_slippage_bundle() ],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "warn",
            "shipped high-slippage policy must WARN on the child swap (slippage 150 > 100): {out}"
        );
    }

    /// END-TO-END control: same shipped Inner policy + the SAME swap wrapped in a
    /// `Multicall` (the batch/Outer position) → SKIPPED by the scope gate (so it
    /// PASSes here). Proves the Inner policy is routed to the child, NOT the
    /// batch — `evaluateBodyTree` re-enters with the child where it fires (above).
    #[test]
    fn shipped_swap_policy_skipped_on_multicall_batch_position() {
        let (swap, meta) = swap_sample_with_slippage(150);
        let batch = ActionBody::Multicall {
            actions: vec![swap],
        };
        let out = evaluate_action_v2_json(
            json!({
                "action": batch, "meta": meta, "tx": tx(),
                "bundles": [ shipped_high_slippage_bundle() ],
                "results": {}
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "pass",
            "Inner swap policy must be SKIPPED on the multicall batch (fires per-child): {out}"
        );
    }

    // ── token_decimals → amountNano quantity-cap (the nano feature) ──────────
    //
    // With host-injected `token_decimals`, the lowering fills the base
    // `direction.amountInNano` Long sibling, so a quantity-cap Cedar policy
    // (`amountInNano >= N`) fires. Without decimals the field is omitted, so the
    // `has`-guarded cap short-circuits to Pass (dormant) — proving the cap is
    // driven by the injected decimals, not firing unconditionally.

    /// The `swap_sample` sells 1_000_000_000 raw USDC (6dp) → nano 1e12. A cap
    /// at 1e12 fires WITH decimals and is dormant WITHOUT them.
    #[test]
    fn evaluate_action_v2_amount_in_nano_cap_driven_by_token_decimals() {
        // `swap_sample`'s tokenIn is Arbitrum USDC (6 decimals).
        let usdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
        let policy = "@id(\"in-cap\")\n@severity(\"warn\")\n@reason(\"input amount cap\")\n\
             forbid(principal, action == Amm::Action::\"Swap\", resource)\n\
             when { context.direction has amountInNano \
             && context.direction.amountInNano >= 1000000000000 };\n";
        let manifest = json!({
            "id": "in-cap", "schema_version": 2,
            "trigger": { "where": { "action.tag": { "eq": "swap" } } }
        });

        // WITH decimals → amountInNano = 1e12 → cap (>= 1e12) → warn.
        let (body, meta) = swap_sample();
        let mut decimals = serde_json::Map::new();
        decimals.insert(usdc.to_owned(), json!(6));
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": policy, "manifest": manifest }],
                "results": {},
                "token_decimals": Value::Object(decimals),
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "warn",
            "amountInNano cap must fire when token_decimals are injected: {out}"
        );

        // WITHOUT decimals → amountInNano omitted → has-guard false → pass.
        let (body, meta) = swap_sample();
        let out = evaluate_action_v2_json(
            json!({
                "action": body, "meta": meta, "tx": tx(),
                "bundles": [{ "policy": policy, "manifest": manifest }],
                "results": {},
            })
            .to_string(),
        );
        assert_eq!(
            verdict_kind(&out),
            "pass",
            "nano cap must be dormant without token_decimals: {out}"
        );
    }
}
