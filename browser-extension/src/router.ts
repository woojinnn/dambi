import { Pipeline, type PipelineDeps, type PipelineResult } from "./adapters/pipeline";
import { Loader } from "./adapters/loader";
import { RegistryClient } from "./adapters/registry-client";
import { AdapterCache, type CacheBackend } from "./adapters/cache";
import type { ChainId } from "./adapters/types";
import type { PeWasmHelpers } from "./pe-wasm";

export interface RouterConfig {
  registryUrl: string;
  cacheBackend: CacheBackend;
  peWasm?: PeWasmHelpers;
}

export interface RouterResult extends PipelineResult {
  /**
   * Verdict from policy-engine-wasm.evaluate_envelopes_json, or null if
   * pe-wasm was not provided in config.
   */
  verdict: unknown | null;
}

/**
 * Top-level entry for the browser-extension. Owns the loader/pipeline/cache
 * stack; clients call `router.route(method, params, chainId)`.
 */
export class Router {
  private pipeline: Pipeline;
  private peWasm: PeWasmHelpers | undefined;

  constructor(cfg: RouterConfig) {
    const reg = new RegistryClient(cfg.registryUrl);
    const cache = new AdapterCache(cfg.cacheBackend, { capacity: 200, ttlMs: 5 * 60 * 1000 });
    const loader = new Loader({ registry: reg, cache });
    const deps: PipelineDeps = { loader };
    if (cfg.peWasm) {
      deps.helpers = {
        parseSignRequestJson: cfg.peWasm.parseSignRequestJson,
        decodeAbiStandardJson: cfg.peWasm.decodeAbiStandardJson,
      };
    }
    this.pipeline = new Pipeline(deps);
    this.peWasm = cfg.peWasm;
  }

  async route(method: string, params: unknown[], chainId: ChainId): Promise<RouterResult> {
    const piped = await this.pipeline.run(method, params, chainId);
    let verdict: unknown | null = null;
    if (this.peWasm) {
      try {
        const payload = { envelopes: piped.envelopes, root: {}, rpc_response: null, manifests: [] };
        verdict = JSON.parse(this.peWasm.evaluateEnvelopesJson(JSON.stringify(payload)));
      } catch (e) {
        verdict = { error: `evaluate_envelopes_json: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    return { ...piped, verdict };
  }
}
