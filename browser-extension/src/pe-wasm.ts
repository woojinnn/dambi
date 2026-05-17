//! Typed wrapper around the narrowed `policy-engine-wasm` exports.
//!
//! The wasm-pack-built package exposes a handful of `_json` functions that
//! take and return JSON strings. This wrapper provides typed Promise-y
//! versions and is the single point JS code in this extension calls into
//! the policy engine. The expectation is that the wasm-pack output lands
//! at `browser-extension/src/wasm/policy_engine_wasm` after `yarn prepare:wasm`.

// The exact import path depends on the wasm-pack output dir; the existing
// `prepare:wasm` script places the pkg under some path we re-export here.
// Until Plan 3 is merged and the pkg surface stabilises, we declare the
// helpers we expect; consumers wire them in via PipelineDeps.helpers.

export interface PeWasmHelpers {
  parseSignRequestJson(method: string, paramsJson: string, chainId: number): string;
  decodeAbiStandardJson(calldataHex: string): string;
  installPoliciesJson(json: string): string;
  evaluatePolicyRpcJson(json: string): string;
  evaluateEnvelopesJson(json: string): string;
  planPolicyRpcJson(json: string): string;
  previewSchemaJson(input: string): string;
  previewInstalledSchemaJson(): string;
}

/**
 * Load the wasm-pack bundle once and return a typed handle.
 * The import path is intentionally dynamic so consumers can swap in a
 * test double in vitest without touching this file.
 */
export async function loadPeWasm(loader: () => Promise<unknown>): Promise<PeWasmHelpers> {
  const mod = (await loader()) as Record<string, unknown>;
  const get = <T>(name: string): T => {
    const fn = mod[name];
    if (typeof fn !== "function") {
      throw new Error(`policy-engine-wasm missing export: ${name}`);
    }
    return fn as T;
  };
  return {
    parseSignRequestJson: get("parse_sign_request_json"),
    decodeAbiStandardJson: get("decode_abi_standard_json"),
    installPoliciesJson: get("install_policies_json"),
    evaluatePolicyRpcJson: get("evaluate_policy_rpc_json"),
    evaluateEnvelopesJson: get("evaluate_envelopes_json"),
    planPolicyRpcJson: get("plan_policy_rpc_json"),
    previewSchemaJson: get("preview_schema_json"),
    previewInstalledSchemaJson: get("preview_installed_schema_json"),
  };
}
