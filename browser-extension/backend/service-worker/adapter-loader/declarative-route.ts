/**
 * v3 declarative routing orchestrator entry.
 *
 * Pipeline (one tx in → Action[] out, or a miss for no-match):
 *
 *   1. Extract the 4-byte selector from `(chain_id, to, calldata)`.
 *   2. JIT install via `installDeclarativeBundleV3` — registry-api-v3 fetch +
 *      WASM `declarative_install_v3_json`. A registry miss surfaces as a clean
 *      `miss`; the orchestrator treats misses/faults as fail-closed warnings.
 *   3. Hand `(chain_id, to, selector, calldata, meta)` to the WASM route entry
 *      `declarative_route_request_v3_json`. The engine decodes the raw
 *      calldata using the bridge-resolved bundle's `abi_fragment.abi` and
 *      emits the PDF FSM `policy_transition::action::Action` tree.
 *   4. Return `{ actions, decoderId }`. The caller (orchestrator in
 *      `service-worker/orchestrator.ts`) plugs these into the audit trail.
 */

import {
  EngineError,
  declarativeRouteRequestV3,
  type DeclarativeRouteRequestV3Result,
} from "../wasm-bridge";
import type { V3Bundle } from "./bundle-schema";
import { extractSelector } from "./declarative-decode";
import {
  installDeclarativeBundleV3,
  InstallDeclarativeV3Error,
} from "./declarative-adapter-loader";

/**
 * v3 outcome shape. The hit payload carries decoded `Action[]` values
 * (PDF FSM `Vec<Action>`) and the registry-v2 manifest decoder id.
 */
export interface DeclarativeRouteV3Hit {
  actions: Record<string, unknown>[];
  decoderId: string;
}

export type DeclarativeRouteV3Outcome =
  | { kind: "hit"; value: DeclarativeRouteV3Hit }
  | {
      kind: "miss";
      reason: "no_selector" | "bundle_not_installed";
    }
  | {
      kind: "fault";
      reason: "engine_error" | "install_failed" | "unexpected";
      cause: unknown;
    };

function isHexCalldata(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("0x") &&
    value.length >= 10 &&
    value.length % 2 === 0
  );
}

function readAbiWord(calldataHex: string, byteOffset: number): string | null {
  const start = 2 + byteOffset * 2;
  const end = start + 64;
  if (start < 2 || end > calldataHex.length) return null;
  return calldataHex.slice(start, end);
}

function readAbiWordNumber(
  calldataHex: string,
  byteOffset: number,
): number | null {
  const word = readAbiWord(calldataHex, byteOffset);
  if (!word) return null;
  const value = BigInt(`0x${word}`);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function bytesArrayArgIndex(bundle: V3Bundle): number | null {
  const abi = bundle.abi_fragment.abi as
    | { inputs?: Array<{ type?: unknown }> }
    | null
    | undefined;
  const inputs = abi?.inputs;
  if (!Array.isArray(inputs)) return null;

  const indices = inputs.flatMap((input, index) =>
    input.type === "bytes[]" ? [index] : [],
  );
  return indices.length === 1 ? indices[0] : null;
}

function decodeBytesArrayArg(calldataHex: string, argIndex: number): string[] {
  if (!isHexCalldata(calldataHex)) return [];

  const argsStart = 4;
  const arrayRelativeOffset = readAbiWordNumber(
    calldataHex,
    argsStart + argIndex * 32,
  );
  if (arrayRelativeOffset === null) return [];

  const arrayStart = argsStart + arrayRelativeOffset;
  const childCount = readAbiWordNumber(calldataHex, arrayStart);
  if (childCount === null || childCount > 64) return [];

  const offsetsStart = arrayStart + 32;
  const children: string[] = [];
  for (let i = 0; i < childCount; i += 1) {
    const childRelativeOffset = readAbiWordNumber(
      calldataHex,
      offsetsStart + i * 32,
    );
    if (childRelativeOffset === null) return [];

    const childStart = offsetsStart + childRelativeOffset;
    const childLength = readAbiWordNumber(calldataHex, childStart);
    if (childLength === null) return [];

    const childDataStart = childStart + 32;
    const childDataEnd = childDataStart + childLength;
    if (childDataEnd * 2 + 2 > calldataHex.length) return [];
    children.push(
      `0x${calldataHex.slice(2 + childDataStart * 2, 2 + childDataEnd * 2)}`,
    );
  }

  return children;
}

function multicallChildSelectors(
  bundle: V3Bundle,
  calldataHex: string | undefined,
): string[] {
  const emit = bundle.emit as
    | { strategy?: unknown; recurse_rule_id?: unknown }
    | null
    | undefined;
  if (
    emit?.strategy !== "multicall_recurse" ||
    emit.recurse_rule_id !== "self_array_bytes_last_arg" ||
    !calldataHex?.startsWith("0x")
  ) {
    return [];
  }

  const argIndex = bytesArrayArgIndex(bundle);
  if (argIndex === null) {
    return [];
  }

  const childCalls = decodeBytesArrayArg(calldataHex, argIndex);

  const selectors = new Set<string>();
  for (const child of childCalls) {
    const selector = extractSelector(child);
    if (selector) selectors.add(selector);
  }
  return [...selectors];
}

/** Index of the single `tuple[]` argument — the `Call[]` bundle of a
 * `multicall_call_array` (Bundler3) manifest. */
function callArrayArgIndex(bundle: V3Bundle): number | null {
  const abi = bundle.abi_fragment.abi as
    | { inputs?: Array<{ type?: unknown }> }
    | null
    | undefined;
  const inputs = abi?.inputs;
  if (!Array.isArray(inputs)) return null;
  const indices = inputs.flatMap((input, index) =>
    input.type === "tuple[]" ? [index] : [],
  );
  return indices.length === 1 ? indices[0] : null;
}

/** One decoded `Call` tuple leg: its target, 4-byte selector, and full data
 * (`0x`-hex) — the data is kept so a Morpho `reenter(Call[])` callback nested in
 * it can be recursed (D-C). */
type DecodedCallLeg = { to: string; selector: string; dataHex: string };

/** Decode the `Call[]` tuples beginning at byte `arrayStart` (the `count` word)
 * of `hex`. `Call = (address to, bytes data, uint256 value, bool skipRevert,
 * bytes32 callbackHash)`; each element is dynamic (carries `bytes data`). Shared
 * by the top-level `multicall(Call[])` and the nested `reenter(Call[])` decode. */
function decodeCallTuplesAt(hex: string, arrayStart: number): DecodedCallLeg[] {
  const count = readAbiWordNumber(hex, arrayStart);
  if (count === null || count > 64) return [];

  const offsetsStart = arrayStart + 32;
  const legs: DecodedCallLeg[] = [];
  for (let i = 0; i < count; i += 1) {
    const elemRelativeOffset = readAbiWordNumber(hex, offsetsStart + i * 32);
    if (elemRelativeOffset === null) return [];
    const elemStart = offsetsStart + elemRelativeOffset;

    // tuple words: 0=to, 1=data offset (rel to elemStart), 2=value, 3=skipRevert, 4=callbackHash
    const toWord = readAbiWord(hex, elemStart);
    if (!toWord) return [];
    const to = `0x${toWord.slice(24)}`;

    const dataRelativeOffset = readAbiWordNumber(hex, elemStart + 32);
    if (dataRelativeOffset === null) return [];
    const dataStart = elemStart + dataRelativeOffset;
    const dataLength = readAbiWordNumber(hex, dataStart);
    if (dataLength === null) return [];
    if (dataLength < 4) continue; // bare value-transfer leg — no selector to route

    const contentStart = 2 + (dataStart + 32) * 2;
    const dataBody = hex.slice(contentStart, contentStart + dataLength * 2);
    if (dataBody.length !== dataLength * 2) return [];
    legs.push({
      to,
      selector: `0x${dataBody.slice(0, 8)}`,
      dataHex: `0x${dataBody}`,
    });
  }
  return legs;
}

/** Decode the top-level `Call[]` arg (`argIndex`) of a `multicall(Call[])`. */
function decodeCallArrayArg(
  calldataHex: string,
  argIndex: number,
): DecodedCallLeg[] {
  if (!isHexCalldata(calldataHex)) return [];
  const argsStart = 4;
  const arrayRelativeOffset = readAbiWordNumber(
    calldataHex,
    argsStart + argIndex * 32,
  );
  if (arrayRelativeOffset === null) return [];
  return decodeCallTuplesAt(calldataHex, argsStart + arrayRelativeOffset);
}

/** Head-word index of the trailing `bytes data` (the `reenter(Call[])` callback)
 * for each GeneralAdapter1 Morpho call that carries one. `marketParams` is a
 * static 5-word tuple, so `data` is the only dynamic param. Mirrors the engine's
 * `extract_morpho_reenter_legs` (verified vs github morpho-org/bundler3). */
const MORPHO_REENTER_DATA_WORD: Record<string, number> = {
  "0x5b866db6": 9, // morphoSupply(market[5],assets,shares,sharePrice,onBehalf,data)
  "0x4d5fcf68": 9, // morphoRepay(market[5],assets,shares,sharePrice,onBehalf,data)
  "0xca463673": 7, // morphoSupplyCollateral(market[5],assets,onBehalf,data)
  "0xe2975912": 2, // morphoFlashLoan(token,assets,data)
};

/** If `leg` is a Morpho call carrying a `reenter(Call[])` callback, extract the
 * callback's raw `abi.encode(Call[])` bytes (NO selector prefix). */
function morphoReenterData(leg: DecodedCallLeg): string | null {
  const wordIndex = MORPHO_REENTER_DATA_WORD[leg.selector.toLowerCase()];
  if (wordIndex === undefined) return null;
  const dataRelOffset = readAbiWordNumber(leg.dataHex, 4 + wordIndex * 32);
  if (dataRelOffset === null) return null;
  const dataStart = 4 + dataRelOffset;
  const dataLength = readAbiWordNumber(leg.dataHex, dataStart);
  if (dataLength === null || dataLength === 0) return null;
  const contentStart = 2 + (dataStart + 32) * 2;
  const body = leg.dataHex.slice(contentStart, contentStart + dataLength * 2);
  if (body.length !== dataLength * 2) return null;
  return `0x${body}`;
}

/** Collect the (`to`, `selector`) of every leg in a `multicall(Call[])` tree —
 * the top-level legs PLUS the legs nested in any Morpho `reenter(Call[])` callback
 * (D-C: a flashLoan/leverage callback's legs target GeneralAdapter1 too and must
 * be pre-installed or the engine's callback re-route would miss them). Deduped;
 * recursion bounded by `MAX_REENTER_DEPTH`. */
function collectCallTreeChildren(
  calldataHex: string,
  argIndex: number,
): Array<{ to: string; selector: string }> {
  const MAX_REENTER_DEPTH = 4;
  const out: Array<{ to: string; selector: string }> = [];
  const seen = new Set<string>();
  const visit = (legs: DecodedCallLeg[], depth: number): void => {
    for (const leg of legs) {
      const key = `${leg.to}:${leg.selector}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ to: leg.to, selector: leg.selector });
      }
      if (depth >= MAX_REENTER_DEPTH) continue;
      const reenter = morphoReenterData(leg);
      if (reenter === null) continue;
      // `reenter` == abi.encode(Call[]): the array `count` sits at the offset in
      // word 0 (a single dynamic param is [offset][array data]).
      const arrayStart = readAbiWordNumber(reenter, 0);
      if (arrayStart === null) continue;
      visit(decodeCallTuplesAt(reenter, arrayStart), depth + 1);
    }
  };
  visit(decodeCallArrayArg(calldataHex, argIndex), 0);
  return out;
}

async function preinstallMulticallChildren(args: {
  chainId: number;
  to: string;
  calldataHex: string | undefined;
  installedBundle: V3Bundle;
}): Promise<void> {
  const emit = args.installedBundle.emit as
    | { strategy?: unknown }
    | null
    | undefined;

  // PER-LEG-TO (Bundler3 `multicall(Call[])`): each leg targets its OWN `to`
  // (e.g. GeneralAdapter1, Permit2). Pre-install at each leg's address so the
  // engine's `multicall_call_array` re-route finds the child mapper instead of
  // skipping it (no_declarative_v3_mapper) and dropping the leg.
  if (emit?.strategy === "multicall_call_array") {
    const argIndex = callArrayArgIndex(args.installedBundle);
    if (argIndex === null || !args.calldataHex) return;
    // Pre-install the WHOLE call tree: top-level legs PLUS any legs nested in a
    // Morpho `reenter(Call[])` callback (D-C), so the engine's recursive re-route
    // finds every child mapper instead of dropping callback legs.
    const legs = collectCallTreeChildren(args.calldataHex, argIndex);
    await Promise.all(
      legs.map((leg) =>
        installDeclarativeBundleV3({
          chainId: args.chainId,
          to: leg.to,
          selector: leg.selector,
        }),
      ),
    );
    return;
  }

  // SAME-TO (`multicall_recurse`, `multicall(bytes[])`): children share the outer `to`.
  const selectors = multicallChildSelectors(
    args.installedBundle,
    args.calldataHex,
  );
  await Promise.all(
    selectors.map((selector) =>
      installDeclarativeBundleV3({
        chainId: args.chainId,
        to: args.to,
        selector,
      }),
    ),
  );
}

/**
 * Phase M4 — v3 route entry. Pipeline:
 *   1. extract 4-byte selector,
 *   2. JIT install (registry-api-v3 fetch + WASM `declarative_install_v3_json`)
 *      via `installDeclarativeBundleV3` — same callkey ((chainId, to, selector))
 *      gets `null` on registry miss (returns `miss/bundle_not_installed`),
 *   3. forward meta fields (value / gas_limit / gas_price / submitter /
 *      submitted_at / nonce) to WASM `declarative_route_request_v3_json`,
 *   4. unwrap the WASM result into a TS-friendly outcome.
 *
 * Bundle hydration lives in `declarative-adapter-loader.ts`; the active
 * verdict path no longer has a legacy v1/static fallback.
 */
export async function tryDeclarativeRouteV3(args: {
  chainId: number;
  from: string;
  to: string;
  valueWei?: string;
  gasLimit?: string;
  gasPrice?: string;
  nonce?: number;
  submittedAt?: number;
  blockTimestamp?: number;
  calldataHex: string | undefined;
}): Promise<DeclarativeRouteV3Outcome> {
  const selector = extractSelector(args.calldataHex);
  if (!selector) {
    return { kind: "miss", reason: "no_selector" };
  }
  const submittedAt = args.submittedAt ?? Math.floor(Date.now() / 1000);

  // JIT install via registry-api-v3. If the callkey has no
  // matching v3 manifest (404 / `matched: false`), `installDeclarativeBundleV3`
  // returns `null`; we surface that as a clean miss so the orchestrator can
  // produce the fail-closed verdict/audit row.
  try {
    const installed = await installDeclarativeBundleV3({
      chainId: args.chainId,
      to: args.to,
      selector,
    });
    if (installed === null) {
      return { kind: "miss", reason: "bundle_not_installed" };
    }
    await preinstallMulticallChildren({
      chainId: args.chainId,
      to: args.to,
      calldataHex: args.calldataHex,
      installedBundle: installed.bundle,
    });
  } catch (err) {
    if (err instanceof InstallDeclarativeV3Error) {
      return { kind: "fault", reason: "install_failed", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  let result: DeclarativeRouteRequestV3Result;
  try {
    result = await declarativeRouteRequestV3({
      chain_id: args.chainId,
      to: args.to,
      selector,
      calldata: args.calldataHex!,
      ...(args.valueWei !== undefined ? { value: args.valueWei } : {}),
      ...(args.gasLimit !== undefined ? { gas_limit: args.gasLimit } : {}),
      ...(args.gasPrice !== undefined ? { gas_price: args.gasPrice } : {}),
      submitter: args.from,
      submitted_at: submittedAt,
      ...(args.nonce !== undefined ? { nonce: args.nonce } : {}),
      ...(args.blockTimestamp !== undefined
        ? { block_timestamp: args.blockTimestamp }
        : {}),
    });
  } catch (err) {
    // Promote WASM EngineError to `engine_error` so the caller can audit it.
    // Other throws bucket into `unexpected`.
    if (err instanceof EngineError) {
      return { kind: "fault", reason: "engine_error", cause: err };
    }
    return { kind: "fault", reason: "unexpected", cause: err };
  }

  return {
    kind: "hit",
    value: {
      actions: result.actions,
      decoderId: result.decoder_id,
    },
  };
}
