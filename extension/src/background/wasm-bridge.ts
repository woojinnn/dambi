import Browser from 'webextension-polyfill';
import init, * as wasmExports from '../wasm/policy_engine_wasm';

interface WasmExports {
  install_policies_json(input: string): string;
  build_action_json(request_json: string): string;
  tier1_fact_plan_json(action_json: string): string;
  tier2_window_keys_json(action_json: string, oracle_snapshot_json: string): string;
  evaluate_json(request_json: string, host_snapshot_json: string): string;
}

interface OkEnvelope<T> {
  ok: true;
  data: T;
}
interface ErrEnvelope {
  ok: false;
  error: { kind: string; message: string };
}
type Envelope<T> = OkEnvelope<T> | ErrEnvelope;

export class EngineError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(`${kind}: ${message}`);
    this.name = 'EngineError';
  }
}

let cachedExports: WasmExports | null = null;
let inflightLoad: Promise<WasmExports> | null = null;

const WASM_BG_URL = Browser.runtime.getURL('wasm/policy_engine_wasm_bg.wasm');

async function load(): Promise<WasmExports> {
  if (cachedExports) return cachedExports;
  if (inflightLoad) return inflightLoad;
  inflightLoad = (async () => {
    await init({ module_or_path: WASM_BG_URL });
    cachedExports = wasmExports as unknown as WasmExports;
    return cachedExports;
  })();
  return inflightLoad;
}

function unwrap<T>(json: string): T {
  const parsed = JSON.parse(json) as Envelope<T>;
  if (parsed.ok === true) return parsed.data;
  throw new EngineError(parsed.error.kind, parsed.error.message);
}

export async function installPolicies(input: { schema_text: string; policy_set: { id: string; text: string }[] }): Promise<void> {
  const exports = await load();
  unwrap<unknown>(exports.install_policies_json(JSON.stringify(input)));
}

export async function buildAction(request: unknown): Promise<unknown> {
  const exports = await load();
  return unwrap<unknown>(exports.build_action_json(JSON.stringify(request)));
}

export async function tier1FactPlan(action: unknown): Promise<unknown> {
  const exports = await load();
  return unwrap<unknown>(exports.tier1_fact_plan_json(JSON.stringify(action)));
}

export async function tier2WindowKeys(
  action: unknown,
  oracleEntries: unknown,
): Promise<{ keys: { actor: string; name: string }[] }> {
  const exports = await load();
  return unwrap<{ keys: { actor: string; name: string }[] }>(
    exports.tier2_window_keys_json(JSON.stringify(action), JSON.stringify(oracleEntries)),
  );
}

export interface VerdictDto {
  kind: 'pass' | 'warn' | 'fail';
  matched?: { policy_id: string; reason?: string; severity: string; origin: string }[];
}

export async function evaluate(request: unknown, snapshot: unknown): Promise<VerdictDto> {
  const exports = await load();
  return unwrap<VerdictDto>(
    exports.evaluate_json(JSON.stringify(request), JSON.stringify(snapshot)),
  );
}
