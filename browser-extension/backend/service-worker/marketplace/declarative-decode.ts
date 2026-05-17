/**
 * Phase 6 — calldata decoder for the declarative orchestrator path.
 *
 * The WASM `declarative_route_request_json` entry expects the caller to
 * deliver an already-decoded call (matching the engine's
 * `DecodedCallDto` wire shape). The static Tier B path decodes calldata
 * inside Rust via `abi-resolver`; for the declarative path we replicate
 * the same step in TypeScript using viem + the bundle's `abi_fragment.abi`.
 *
 * Why client-side decode (rather than calling a WASM helper)? — keeping
 * this in TS lets the Phase 6 wire-up land without growing the WASM
 * surface area. The bundle ABI is the source of truth either way.
 *
 * Scope:
 *   - V2 swap PoC. The fixture's ABI is a single function fragment
 *     `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)`.
 *   - Tuple-typed params (V3) flatten on the Rust side via
 *     `bridge::flatten_tuple_arg`; this TS decoder mirrors that — when the
 *     bundle's outer parameter list is a single tuple-with-components, we
 *     flatten it to one DecodedArg per component so the engine's stricter
 *     mapper layout works as-is. V2 has no tuples so this is a no-op for
 *     the immediate PoC.
 */

import type { Abi, AbiFunction, AbiParameter } from "abitype";
import { decodeFunctionData, type Hex } from "viem";
import type { AdapterFunctionBundle } from "./bundle-schema";
import type { DeclarativeRouteRequestInput } from "../wasm-bridge";

/**
 * One element of the engine's `DecodedValueDto` tagged-union wire format.
 * Mirrors `crates/policy-engine-wasm/src/dto.rs::DecodedValueDto`.
 */
export type DecodedValueDto =
  | { kind: "address"; value: string }
  | { kind: "uint"; value: string }
  | { kind: "int"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "bytes"; value: string }
  | { kind: "string"; value: string }
  | { kind: "array"; value: DecodedValueDto[] }
  | { kind: "tuple"; value: DecodedValueDto[] };

export interface DecodedArgDto {
  name: string;
  abi_type: string;
  value: DecodedValueDto;
}

export interface DecodedCallDto {
  decoder_id: string;
  function_signature: string;
  args: DecodedArgDto[];
}

export class DeclarativeDecodeError extends Error {
  constructor(
    readonly code:
      | "missing_calldata"
      | "decode_failed"
      | "abi_fragment_invalid"
      | "unsupported_value",
    message: string,
    cause?: unknown,
  ) {
    super(`declarative-decode[${code}] ${message}`);
    this.name = "DeclarativeDecodeError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Decode raw `0x`-prefixed calldata against the bundle's outer ABI fragment.
 *
 * Returns a `DecodedCallDto` ready for `declarative_route_request_json`. The
 * `decoder_id` field is left as a placeholder — the WASM route entry
 * overwrites it with the bridge-resolved declarative id, so the value the
 * caller picks here is irrelevant to the routing decision.
 */
export function decodeBundleCalldata(
  bundle: AdapterFunctionBundle,
  calldataHex: string,
): DecodedCallDto {
  if (!calldataHex || calldataHex === "0x") {
    throw new DeclarativeDecodeError(
      "missing_calldata",
      "transaction has no calldata to decode",
    );
  }
  if (!calldataHex.startsWith("0x")) {
    throw new DeclarativeDecodeError(
      "missing_calldata",
      `calldata must start with "0x", got ${calldataHex.slice(0, 4)}…`,
    );
  }

  const abiFunction = extractAbiFunction(bundle);
  const abi: Abi = [abiFunction];

  let decoded: { functionName: string; args: readonly unknown[] | undefined };
  try {
    decoded = decodeFunctionData({ abi, data: calldataHex as Hex });
  } catch (err) {
    throw new DeclarativeDecodeError(
      "decode_failed",
      err instanceof Error ? err.message : String(err),
      err,
    );
  }

  if (decoded.functionName !== abiFunction.name) {
    throw new DeclarativeDecodeError(
      "decode_failed",
      `decoded function ${decoded.functionName} does not match bundle's ${abiFunction.name}`,
    );
  }

  const inputs = abiFunction.inputs ?? [];
  const args = decoded.args ?? [];
  if (args.length !== inputs.length) {
    throw new DeclarativeDecodeError(
      "decode_failed",
      `arg count mismatch: abi=${inputs.length} decoded=${args.length}`,
    );
  }

  // Tuple flattening (mirrors `crates/adapters/abi-resolver/src/bridge.rs::
  // flatten_tuple_arg`): if the function takes a single struct param (one
  // tuple with components), we expose each component as a top-level arg
  // because the declarative mapper layouts were written against that shape.
  let argDtos: DecodedArgDto[];
  const firstInputComponents = readComponents(inputs[0]);
  if (
    inputs.length === 1 &&
    inputs[0].type === "tuple" &&
    firstInputComponents !== null &&
    firstInputComponents.length > 0
  ) {
    const param = inputs[0];
    const tupleValue = args[0];
    if (!Array.isArray(tupleValue)) {
      throw new DeclarativeDecodeError(
        "decode_failed",
        `expected tuple value for ${param.name ?? "<unnamed>"}, got ${typeof tupleValue}`,
      );
    }
    if (tupleValue.length !== firstInputComponents.length) {
      throw new DeclarativeDecodeError(
        "decode_failed",
        `tuple length mismatch: abi=${firstInputComponents.length} decoded=${tupleValue.length}`,
      );
    }
    argDtos = firstInputComponents.map((component, idx) => ({
      name: component.name && component.name.length > 0 ? component.name : `arg${idx}`,
      abi_type: component.type,
      value: encodeValue(component, tupleValue[idx]),
    }));
  } else {
    argDtos = inputs.map((param, idx) => ({
      name: param.name && param.name.length > 0 ? param.name : `arg${idx}`,
      abi_type: param.type,
      value: encodeValue(param, args[idx]),
    }));
  }

  return {
    // Placeholder — the WASM route entry overwrites this with the
    // bridge-resolved declarative id before invoking
    // `DeclarativeMapper::accepts`.
    decoder_id: `declarative.${stripVersion(bundle.id)}`,
    function_signature: formatFunctionSignature(abiFunction),
    args: argDtos,
  };
}

/**
 * Build the `DeclarativeRouteRequestInput` envelope the WASM route entry
 * consumes. Caller supplies the tx tuple (`from`, `to`, `value_wei`,
 * `block_timestamp`) and the already-decoded call.
 */
export function buildRouteInput(args: {
  chainId: number;
  to: string;
  selector: string;
  from: string;
  valueWei?: string;
  blockTimestamp?: number;
  decoded: DecodedCallDto;
}): DeclarativeRouteRequestInput {
  return {
    chain_id: args.chainId,
    to: args.to,
    selector: args.selector,
    ctx: {
      chain_id: args.chainId,
      from: args.from,
      to: args.to,
      value_wei: args.valueWei ?? "0",
      ...(args.blockTimestamp !== undefined
        ? { block_timestamp: args.blockTimestamp }
        : {}),
    },
    decoded: args.decoded,
  };
}

/**
 * Extract the 4-byte selector from raw calldata as `"0x" + 8 hex`.
 * Returns `null` for empty / short calldata.
 */
export function extractSelector(calldataHex: string | undefined): string | null {
  if (!calldataHex || !calldataHex.startsWith("0x")) return null;
  // 2 ("0x") + 8 = 10 chars minimum
  if (calldataHex.length < 10) return null;
  return ("0x" + calldataHex.slice(2, 10)).toLowerCase();
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

function extractAbiFunction(bundle: AdapterFunctionBundle): AbiFunction {
  const raw = bundle.abi_fragment.abi;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeclarativeDecodeError(
      "abi_fragment_invalid",
      "abi_fragment.abi must be a single ABI function object",
    );
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type !== "function") {
    throw new DeclarativeDecodeError(
      "abi_fragment_invalid",
      `abi_fragment.abi.type must be "function", got ${JSON.stringify(obj.type)}`,
    );
  }
  if (typeof obj.name !== "string") {
    throw new DeclarativeDecodeError(
      "abi_fragment_invalid",
      "abi_fragment.abi.name must be a string",
    );
  }
  if (!Array.isArray(obj.inputs)) {
    throw new DeclarativeDecodeError(
      "abi_fragment_invalid",
      "abi_fragment.abi.inputs must be an array",
    );
  }
  // Cast through unknown — we shape-checked the critical fields above.
  return raw as unknown as AbiFunction;
}

function formatFunctionSignature(fn: AbiFunction): string {
  const types = (fn.inputs ?? []).map((input) => formatAbiType(input));
  return `${fn.name}(${types.join(",")})`;
}

function formatAbiType(param: AbiParameter): string {
  if (param.type === "tuple" || param.type.startsWith("tuple")) {
    const components = readComponents(param) ?? [];
    const inner = components.map(formatAbiType).join(",");
    // Preserve array suffix for tuple[] / tuple[N].
    const arrayPart = param.type.slice("tuple".length);
    return `(${inner})${arrayPart}`;
  }
  return param.type;
}

/**
 * abitype's `AbiParameter` union for tuple params declares
 * `components: readonly AbiParameter[]`. Casting through `unknown` here
 * lets the rest of the module treat tuple components as a mutable array
 * without `as` clutter at every read site. The downstream code does NOT
 * mutate the array — the cast is purely a type relaxation.
 */
function readComponents(param: AbiParameter | undefined): AbiParameter[] | null {
  if (!param) return null;
  const candidate = (param as { components?: readonly AbiParameter[] }).components;
  if (!Array.isArray(candidate)) return null;
  return candidate as unknown as AbiParameter[];
}

/**
 * Encode a viem-decoded value into the engine's `DecodedValueDto` tagged
 * wire format. The viem decoder hands back BigInt for uint/int, `0x…` Hex
 * strings for address/bytes/bytes32/etc, booleans for bool, and nested
 * arrays for array/tuple types.
 */
function encodeValue(param: AbiParameter, value: unknown): DecodedValueDto {
  const type = param.type;

  // Array: `address[]`, `uint256[]`, `bytes[]`, `tuple[]`, etc.
  if (type.endsWith("]")) {
    if (!Array.isArray(value)) {
      throw new DeclarativeDecodeError(
        "unsupported_value",
        `expected array for ${type}, got ${typeof value}`,
      );
    }
    // Strip ONE trailing `[]` or `[N]` to get the element type.
    const lastOpen = type.lastIndexOf("[");
    const elementType = type.slice(0, lastOpen);
    // Build an element AbiParameter we can recurse on. Tuple element keeps
    // the components from the array param.
    const elementParam: AbiParameter = {
      ...param,
      type: elementType,
    };
    return {
      kind: "array",
      value: value.map((v) => encodeValue(elementParam, v)),
    };
  }

  if (type === "tuple") {
    if (!Array.isArray(value)) {
      throw new DeclarativeDecodeError(
        "unsupported_value",
        `expected tuple value, got ${typeof value}`,
      );
    }
    const components = readComponents(param) ?? [];
    return {
      kind: "tuple",
      value: components.map((c, idx) => encodeValue(c, value[idx])),
    };
  }

  if (type === "address") {
    if (typeof value !== "string") {
      throw new DeclarativeDecodeError(
        "unsupported_value",
        `expected string for address, got ${typeof value}`,
      );
    }
    return { kind: "address", value: value.toLowerCase() };
  }

  if (type === "bool") {
    if (typeof value !== "boolean") {
      throw new DeclarativeDecodeError(
        "unsupported_value",
        `expected boolean for bool, got ${typeof value}`,
      );
    }
    return { kind: "bool", value };
  }

  if (type === "string") {
    if (typeof value !== "string") {
      throw new DeclarativeDecodeError(
        "unsupported_value",
        `expected string for string, got ${typeof value}`,
      );
    }
    return { kind: "string", value };
  }

  if (type === "bytes" || type.startsWith("bytes")) {
    // bytes, bytes1..bytes32 — viem hands these back as `0x…` Hex strings.
    if (typeof value !== "string") {
      throw new DeclarativeDecodeError(
        "unsupported_value",
        `expected hex string for ${type}, got ${typeof value}`,
      );
    }
    return { kind: "bytes", value };
  }

  if (type.startsWith("uint")) {
    return { kind: "uint", value: toDecimalString(value, type) };
  }
  if (type.startsWith("int")) {
    return { kind: "int", value: toDecimalString(value, type) };
  }

  throw new DeclarativeDecodeError(
    "unsupported_value",
    `unsupported ABI type ${type}`,
  );
}

function toDecimalString(value: unknown, type: string): string {
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString(10);
  }
  if (typeof value === "string") {
    // Already a decimal string is fine; reject hex to surface bugs early.
    if (/^-?\d+$/.test(value)) return value;
  }
  throw new DeclarativeDecodeError(
    "unsupported_value",
    `expected bigint/number/decimal-string for ${type}, got ${typeof value}`,
  );
}

function stripVersion(bundleId: string): string {
  const at = bundleId.indexOf("@");
  return at >= 0 ? bundleId.slice(0, at) : bundleId;
}
