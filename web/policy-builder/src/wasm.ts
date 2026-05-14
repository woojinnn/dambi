// Typed wrappers around the policy-builder WASM bridge.
//
// `init()` must complete before any other function is called. The wrappers
// parse the JSON envelope each call returns and throw a structured
// `WasmCallError` on `ok: false` so callers can branch on the error kind
// rather than string-matching.

import init, * as wasmExports from "./wasm/policy_builder_wasm";
import type {
  ActionSchema,
  CompileSuccess,
  Envelope,
  EnvelopeError,
  PolicyRule,
} from "./types";

let ready: Promise<void> | null = null;

/** Initialize the WASM module. Idempotent; safe to call from multiple entry points. */
export function initWasm(): Promise<void> {
  if (!ready) {
    // Vite serves /src/wasm/*.wasm via the import.meta.url path baked into
    // the generated glue; passing the explicit URL keeps it working both
    // during dev (served from src/) and production (rewritten by vite).
    const wasmUrl = new URL(
      "./wasm/policy_builder_wasm_bg.wasm",
      import.meta.url,
    );
    ready = init(wasmUrl).then(() => undefined);
  }
  return ready;
}

export class WasmCallError extends Error {
  readonly kind: string;
  readonly predicateIndex?: number;

  constructor(error: EnvelopeError) {
    super(error.message);
    this.name = "WasmCallError";
    this.kind = error.kind;
    if (typeof error.predicate_index === "number") {
      this.predicateIndex = error.predicate_index;
    }
  }
}

function unwrap<T>(json: string): T {
  const env = JSON.parse(json) as Envelope<T>;
  if (env.ok && env.data !== undefined) return env.data;
  if (env.ok) return undefined as T;
  throw new WasmCallError(
    env.error ?? { kind: "unknown", message: "wasm returned ok=false without an error body" },
  );
}

export async function listActions(): Promise<string[]> {
  await initWasm();
  return unwrap<string[]>(wasmExports.list_actions());
}

export async function getActionSchema(action: string): Promise<ActionSchema> {
  await initWasm();
  return unwrap<ActionSchema>(wasmExports.get_action_schema_json(action));
}

export async function compilePolicy(rule: PolicyRule): Promise<string> {
  await initWasm();
  const { cedar_text } = unwrap<CompileSuccess>(
    wasmExports.compile_policy_json(JSON.stringify(rule)),
  );
  return cedar_text;
}
