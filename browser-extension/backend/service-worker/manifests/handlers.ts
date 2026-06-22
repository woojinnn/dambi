// SW-side message handlers for the manifest CRUD / schema preview /
// migration surface.
//
// The dashboard SDK sends `manifest:*` or `migration:*` messages through
// the content-script bridge; `index.ts` routes them here.
//
// All handlers return the standard `{ ok, data | error }` envelope so
// the SDK can throw the error verbatim.

import {
  type AliasTableEntry,
  getAliasTable,
  installPolicies,
  previewCustomSchema,
  fieldCatalog,
  previewInstalledSchema,
} from "../wasm-bridge";
import { fetchBundledDefaultManifests } from "./dev-seed";
import {
  loadCurrentEnabledPolicySet,
  reinstallAllPolicies,
} from "../policies-loader";
import { legacyV1RpcFallbackEnabled } from "../legacy-v1-rpc";
import {
  applyEnabledIds,
  getEnabledIds,
} from "../policy-selection";
import { atomicInstall, type AtomicInstallResult } from "./atomic-install";
import {
  KEY_PENDING_MIGRATION,
  clearOriginalEnabled,
  getOriginalEnabled,
  listPending,
  rewritePolicyText,
  setPending,
} from "./migration";
import * as store from "./store";

export type ManifestRequest =
  | { type: "manifest:preview"; action: string; manifest: unknown }
  | { type: "manifest:put"; action: string; manifest: store.PolicyManifest }
  | { type: "manifest:get"; action: string }
  | { type: "manifest:get-bundled"; action: string }
  | { type: "manifest:get-method-catalog" }
  | { type: "manifest:get-enriched-schema" }
  | { type: "manifest:get-field-catalog" }
  | { type: "manifest:ping" }
  | { type: "manifest:alias-table" }
  | { type: "manifest:set-endpoint-url"; url: string | null }
  | { type: "migration:list" }
  | {
      type: "migration:rewrite";
      id: string;
      knownFields: readonly string[];
      // The SW returns only the rewritten text; the dashboard pushes it
      // through `dashboard:put-raw` and then sends `migration:ack`.
      // Splitting the two avoids a window where pending is empty but
      // storage still has v0 text.
      text: string;
    }
  | { type: "migration:ack"; id: string };

export type ManifestResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { kind: string; message: string } };

export function isManifestRequest(value: unknown): value is ManifestRequest {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  return (
    typeof t === "string" &&
    (t.startsWith("manifest:") || t.startsWith("migration:"))
  );
}

function fail<T = unknown>(kind: string, message: string): ManifestResponse<T> {
  return { ok: false, error: { kind, message } };
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function normalizeLegacyEndpointUrl(raw: string | null): ManifestResponse<string | null> {
  const trimmed = typeof raw === "string" ? raw.trim() : null;
  if (trimmed === null || trimmed === "") {
    return { ok: true, data: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fail(
      "invalid_endpoint_url",
      `endpoint URL must be an http(s) origin, got: ${trimmed.slice(0, 40)}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(
      "invalid_endpoint_url",
      `endpoint URL must use http:// or https://, got: ${trimmed.slice(0, 40)}`,
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return fail(
      "invalid_endpoint_url",
      "endpoint URL must be an origin only, without credentials, path, query, or hash",
    );
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    return fail(
      "invalid_endpoint_url",
      "plain-http legacy endpoints are limited to loopback hosts",
    );
  }

  return { ok: true, data: parsed.origin };
}

function classify(err: unknown): { kind: string; message: string } {
  if (err && typeof err === "object") {
    const e = err as { kind?: unknown; message?: unknown; name?: unknown };
    const kind =
      typeof e.kind === "string"
        ? e.kind
        : typeof e.name === "string"
        ? (e.name as string)
        : "manifest_failed";
    const message =
      typeof e.message === "string" ? (e.message as string) : String(err);
    return { kind, message };
  }
  return { kind: "manifest_failed", message: String(err) };
}

async function callWasmInstallMap(
  manifests: Record<string, store.PolicyManifest>,
): Promise<
  | { enrichedSchemaHash: string; addedCustomFields: Record<string, unknown[]> }
  | null
> {
  // `install_policies_json` replaces all engine state, so always forward
  // the currently-enabled policy set to avoid wiping installed Cedar policies.
  const policySet = await loadCurrentEnabledPolicySet();
  return installPolicies({
    schema_text: "",
    policy_set: policySet,
    manifests,
  });
}

async function installWith(
  next: Record<string, store.PolicyManifest>,
): Promise<AtomicInstallResult> {
  return atomicInstall(next, { wasmInstall: callWasmInstallMap });
}

/**
 * Method catalog discovery for the manifest editor.
 *
 * Reads the bundled `method-catalog.json`. The old unauthenticated sidecar
 * catalog (`GET /v1/methods`) is retired in production and stays disabled unless
 * a local build explicitly sets `POLICY_RPC_ENABLE_LEGACY_V1_RPC=true`.
 *
 * Returns `{ methods: {} }` on total failure (bundle missing AND
 * optional sidecar unreachable) so the manifest editor degrades to free-text
 * mode instead of crashing.
 */
async function fetchHybridMethodCatalog(): Promise<{
  methods: Record<string, unknown>;
}> {
  const Browser = (await import("webextension-polyfill")).default;
  let bundled: { methods: Record<string, unknown> } = { methods: {} };

  // 1) Bundled catalog from extension assets.
  try {
    const url = Browser.runtime.getURL("method-catalog.json");
    const response = await fetch(url);
    if (response.ok) {
      const raw = (await response.json()) as { methods?: Record<string, unknown> };
      if (raw && raw.methods && typeof raw.methods === "object") {
        bundled = { methods: raw.methods };
      }
    }
  } catch {
    // No bundled catalog (release build skipped copy, dev forgot to run
    // copy-method-catalog.js, etc.) — proceed with empty so the daemon
    // catalog can still seed the UI.
  }

  // 2) Optional dynamic catalog from the retired local sidecar.
  let dynamic: { methods: Record<string, unknown> } = { methods: {} };
  const endpointUrl = await store.getEndpointUrl();
  if (endpointUrl && legacyV1RpcFallbackEnabled()) {
    try {
      const url = `${endpointUrl.replace(/\/+$/, "")}/v1/methods`;
      const response = await fetch(url);
      if (response.ok) {
        const raw = (await response.json()) as {
          catalog?: { methods?: Record<string, unknown> };
          methods?: Record<string, unknown> | string[];
        };
        // Preferred shape: `{ catalog: { methods: {...} } }`.
        // Fallback shape: `{ methods: {...} }` (plain object, not array).
        if (raw.catalog && raw.catalog.methods && typeof raw.catalog.methods === "object") {
          dynamic = { methods: raw.catalog.methods };
        } else if (
          raw.methods &&
          typeof raw.methods === "object" &&
          !Array.isArray(raw.methods)
        ) {
          dynamic = { methods: raw.methods };
        }
      }
    } catch {
      // Daemon down / network error — silent, dashboard already exposes
      // a separate "endpoint health" indicator (manifest:ping).
    }
  }

  return { methods: { ...bundled.methods, ...dynamic.methods } };
}

async function pingEndpoint(): Promise<ManifestResponse> {
  const url = await store.getEndpointUrl();
  if (!url) {
    return { ok: true, data: { reachable: false, url: null } };
  }
  if (!legacyV1RpcFallbackEnabled()) {
    return {
      ok: true,
      data: {
        reachable: false,
        url,
        disabled: true,
        reason: "legacy_v1_rpc_disabled",
      },
    };
  }
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/v1/healthz`, {
      method: "GET",
    });
    return {
      ok: true,
      data: { reachable: response.ok, url, status: response.status },
    };
  } catch (err) {
    return {
      ok: true,
      data: {
        reachable: false,
        url,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function handleManifestRequest(
  req: ManifestRequest,
): Promise<ManifestResponse> {
  try {
    switch (req.type) {
      case "manifest:preview": {
        const out = await previewCustomSchema({
          action: req.action,
          manifest: req.manifest,
        });
        return { ok: true, data: out };
      }

      case "manifest:put": {
        if (typeof req.action !== "string" || !req.manifest) {
          return fail("invalid_request", "action and manifest required");
        }
        const next = {
          ...(await store.getAllManifests()),
          [req.action]: req.manifest,
        };
        return await installWith(next);
      }

      case "manifest:get": {
        return {
          ok: true,
          data: { manifest: await store.getManifest(req.action) },
        };
      }

      case "manifest:get-bundled": {
        // Reads from the static asset bundle, not chrome.storage — the
        // bundled set is the starter pack shipped with the extension binary,
        // not user state. Returns `{}` when no bundle was copied.
        const bundled = await fetchBundledDefaultManifests();
        return {
          ok: true,
          data: { manifest: bundled[req.action] ?? null },
        };
      }

      case "manifest:get-method-catalog": {
        const catalog = await fetchHybridMethodCatalog();
        return { ok: true, data: catalog };
      }

      case "manifest:get-enriched-schema": {
        return { ok: true, data: await previewInstalledSchema() };
      }

      case "manifest:get-field-catalog": {
        return { ok: true, data: await fieldCatalog() };
      }

      case "manifest:ping": {
        return await pingEndpoint();
      }

      case "manifest:alias-table": {
        return {
          ok: true,
          data: (await getAliasTable()) as { entries: AliasTableEntry[] },
        };
      }

      case "manifest:set-endpoint-url": {
        // Validate and canonicalize server-side. This value is later used as a
        // fetch base for the retired legacy sidecar, so only an origin may land
        // in storage. HTTP is loopback-only for local experiments.
        const normalized = normalizeLegacyEndpointUrl(req.url);
        if (!normalized.ok) return normalized;
        await store.setEndpointUrl(normalized.data);
        return { ok: true, data: { url: await store.getEndpointUrl() } };
      }

      case "migration:list": {
        return { ok: true, data: { ids: await listPending() } };
      }

      case "migration:rewrite": {
        if (typeof req.id !== "string" || typeof req.text !== "string") {
          return fail("invalid_request", "id and text required");
        }
        const rewritten = rewritePolicyText(req.text, req.knownFields ?? []);
        // `rewritten === req.text` means there was nothing to rewrite.
        // Auto-ack in that case since there's no follow-up put-raw to
        // wait for — the policy is already on the v1 layout.
        if (rewritten === req.text) {
          const pending = await listPending();
          await setPending(pending.filter((p) => p !== req.id));
          return { ok: true, data: { id: req.id, rewritten, applied: false } };
        }
        // `applied: true` only signals the rewrite produced a different
        // string. The id stays on the pending set until the dashboard
        // confirms with `migration:ack` after `dashboard:put-raw`
        // succeeds. Splitting the two avoids a window where pending is
        // empty but the managed-policy entry still has v0 text.
        return { ok: true, data: { id: req.id, rewritten, applied: true } };
      }

      case "migration:ack": {
        if (typeof req.id !== "string") {
          return fail("invalid_request", "id required");
        }
        // The rewrite flow is: `migration:rewrite` → `dashboard:put-raw`
        // → `migration:ack`. `put-raw` always re-adds the id to
        // `enabled-ids`. For users whose original preference was DISABLED,
        // strip it again here and reinstall via the apply-queue so both
        // `enabled-ids` and `applied-ids` move in lockstep and serialize
        // against any concurrent popup toggle. If the original preference
        // was ENABLED, `put-raw`'s add is correct and we leave it alone.
        const original = await getOriginalEnabled();
        const wasEnabled = original[req.id];
        if (wasEnabled === false) {
          const current = await getEnabledIds();
          if (current.includes(req.id)) {
            const next = current.filter((x) => x !== req.id);
            const result = await applyEnabledIds(next, reinstallAllPolicies);
            if (!result.ok) {
              // Surface the apply-queue failure verbatim. Leaving the
              // snapshot + pending entry in place lets the next ack
              // retry pick up where we stopped.
              return { ok: false, error: result.error };
            }
          }
        }
        await clearOriginalEnabled(req.id);
        const pending = await listPending();
        await setPending(pending.filter((p) => p !== req.id));
        return { ok: true, data: { id: req.id, remaining: await listPending() } };
      }

      default: {
        const _exhaustive: never = req;
        void _exhaustive;
        return fail("unknown_request", `unrecognized manifest request`);
      }
    }
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

// Re-exported so `index.ts` can route raw `Browser.runtime.onMessage`
// payloads here without re-importing the pending key.
export { KEY_PENDING_MIGRATION };
