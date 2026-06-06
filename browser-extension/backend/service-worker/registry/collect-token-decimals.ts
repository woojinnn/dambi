/**
 * Token-decimals collection for the `amountNano` lowering enrichment.
 *
 * The (network-free, in-WASM) lowering cannot fetch ERC20 decimals, so the
 * service-worker resolves them here and injects a `token_decimals` map into the
 * v2 plan/evaluate inputs. The WASM lowering then fills each fungible amount's
 * `amountNano` `Long` sibling (`raw × 10^(9 − decimals)`), enabling
 * quantity-cap policies (`context.…amountNano >= N`).
 *
 * It deep-walks the decoded `ActionBody` JSON (a snake_case-tagged tree, which
 * may be a `Multicall` with nested children) for every ERC20 `TokenKey` —
 * `{ standard: "erc20", chain, address }` — and resolves each address's
 * decimals from the registry via {@link defaultTokenRegistryClient} (on-demand,
 * cached, inflight-deduped). The result is keyed by lowercase `0x` address, the
 * exact key the Rust `TokenDecimals` lookup uses.
 *
 * Native gas tokens need no entry — the lowering hardcodes 18 for them. NFT
 * keys carry no fungible decimals and are ignored.
 *
 * NON-FATAL by design: a registry miss / fetch error / timeout simply omits
 * that token (its `amountNano` stays absent ⇒ a quantity-cap policy for it does
 * not fire — the base hex `amount` is still present for exact-match policies).
 * The function never throws; a hard failure yields `{}`.
 */
import { defaultTokenRegistryClient } from "./token-client";

/**
 * Plausible ERC20 decimals window. The WASM side deserializes each value as a
 * `u8`, so anything outside this range is dropped rather than risking a parse
 * failure of the whole input (real ERC20 decimals are 0–18; the slack tolerates
 * a few exotic tokens without admitting garbage).
 */
const MIN_DECIMALS = 0;
const MAX_DECIMALS = 36;

/** CAIP-2 `eip155:<n>` → numeric chain id (the shape `TokenKey.chain` serializes to). */
const EIP155_RE = /^eip155:(\d+)$/;

/**
 * Resolve `{ lowercaseAddress: decimals }` for every ERC20 token reachable in
 * `body`. `chainIdHint` (the tx's numeric chain id) is the fallback chain for
 * any token whose own `chain` field is missing/unparseable.
 */
export async function collectTokenDecimals(
  body: unknown,
  chainIdHint: number,
): Promise<Record<string, number>> {
  try {
    // addrLower → chain number (first occurrence wins; a single EVM tx is
    // single-chain, so the address alone keys decimals unambiguously).
    const wanted = new Map<string, number>();
    collectErc20(body, chainIdHint, wanted);
    if (wanted.size === 0) return {};

    const client = defaultTokenRegistryClient();
    const out: Record<string, number> = {};
    await Promise.all(
      [...wanted].map(async ([address, chainNum]) => {
        try {
          const meta = await client.lookup(chainNum, address);
          if (
            meta &&
            Number.isInteger(meta.decimals) &&
            meta.decimals >= MIN_DECIMALS &&
            meta.decimals <= MAX_DECIMALS
          ) {
            out[address] = meta.decimals;
          }
        } catch {
          // Per-token failure → skip it; the lowering omits that nano field.
        }
      }),
    );
    return out;
  } catch {
    // Never let decimals collection break the verdict path.
    return {};
  }
}

/**
 * Recursively gather ERC20 token addresses (lowercased) → chain number from an
 * arbitrary decoded-body subtree. The ERC20 key shape
 * (`{ standard: "erc20", chain, address }`, the serde form of
 * `policy_state::token::TokenKey::Erc20`) may be nested arbitrarily deep
 * (multicall children, swap params, intent legs, …), so every object/array is
 * visited.
 */
function collectErc20(
  node: unknown,
  chainIdHint: number,
  out: Map<string, number>,
): void {
  if (Array.isArray(node)) {
    for (const el of node) collectErc20(el, chainIdHint, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const o = node as Record<string, unknown>;

  if (o.standard === "erc20" && typeof o.address === "string") {
    const address = o.address.toLowerCase();
    let chainNum = chainIdHint;
    if (typeof o.chain === "string") {
      const m = EIP155_RE.exec(o.chain);
      if (m) chainNum = Number(m[1]);
    }
    if (!out.has(address)) out.set(address, chainNum);
  }

  for (const value of Object.values(o)) {
    collectErc20(value, chainIdHint, out);
  }
}
