/* tslint:disable */
/* eslint-disable */

/**
 * Module init: forward Rust panics to the JS console.
 */
export function _start(): void;

/**
 * Compile a `PolicyRule` (JSON) into Cedar policy text.
 *
 * `data` on success is `{ "cedar_text": "…" }`. On failure, `error.kind` is
 * one of `invalid_input_json`, `validation`, or `emit`.
 */
export function compile_policy_json(rule_json: string): string;

/**
 * Return the full schema for one action, augmented with operator metadata
 * per field so the UI can render dropdowns without duplicating tables.
 *
 * `data` shape:
 * ```text
 * {
 *   "action": "swap",
 *   "principalType": "Wallet",
 *   "resourceType": "Protocol",
 *   "fields": [
 *     {
 *       "path": "totalInputUsd.value",
 *       "type": "decimal",
 *       "optional": false,
 *       "parentPath": "totalInputUsd",
 *       "parentOptional": true,
 *       "label": "Total input USD",
 *       "operators": [
 *         { "id": "gt", "label": ">", "arity": "one" },
 *         …
 *       ]
 *     },
 *     …
 *   ]
 * }
 * ```
 */
export function get_action_schema_json(action: string): string;

/**
 * List all action names registered in the bundled schema registry.
 *
 * Returns an envelope whose `data` is a `Vec<String>` of action keys in
 * ascending order.
 */
export function list_actions(): string;

/**
 * Validate a rule without emitting Cedar — useful for live form feedback.
 *
 * `data` on success is `null`. On failure, `error.kind` carries the
 * validation error code.
 */
export function validate_policy_json(rule_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compile_policy_json: (a: number, b: number) => [number, number];
    readonly get_action_schema_json: (a: number, b: number) => [number, number];
    readonly list_actions: () => [number, number];
    readonly validate_policy_json: (a: number, b: number) => [number, number];
    readonly _start: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
