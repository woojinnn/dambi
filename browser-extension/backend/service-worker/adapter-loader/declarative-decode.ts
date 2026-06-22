/**
 * Declarative pipeline utilities — selector extraction.
 *
 * Calldata decoding happens inside WASM (`declarative_route_request_v3_json`
 * decodes internally using the bridge-resolved bundle's `abi_fragment.abi`).
 * This module provides:
 *   - `extractSelector` — pull the 4-byte selector from raw calldata.
 */

/**
 * Extract the 4-byte selector from raw calldata as `"0x" + 8 hex`.
 * Returns `null` for empty / short calldata.
 */
export function extractSelector(calldataHex: string | undefined): string | null {
  if (!calldataHex || !calldataHex.startsWith("0x")) return null;
  // 2 ("0x") + 8 = 10 chars minimum
  if (calldataHex.length < 10) return null;
  const selector = "0x" + calldataHex.slice(2, 10);
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) return null;
  return selector.toLowerCase();
}
