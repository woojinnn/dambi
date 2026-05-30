/**
 * Phase 4C — EIP-712 typed-data signature router (SW side).
 *
 * Maps an `eth_signTypedData{,_v3,_v4}` request onto a minimal v3
 * `Action` skeleton the orchestrator can hand downstream (audit /
 * future verdict path). The matching surface mirrors the registry-v2
 * `match.typed_data` block:
 *
 *   {
 *     "match": {
 *       "typed_data": {
 *         "domain_name":        "Permit2",
 *         "verifying_contract": "0x000000000022d473030f116ddee9f6b43ac78ba3",
 *         "primary_type":       "PermitSingle",
 *         "types": { ... }
 *       }
 *     }
 *   }
 *
 * Routing key = `(verifyingContract, domain.name, primaryType)`. All
 * comparisons are case-insensitive on the address, exact on the
 * structural strings.
 *
 * Phase 4C scope (intentionally narrow — auto-mode decision):
 *   - **Permit2 `PermitSingle`** — the most common typed-data flow in
 *     the Uniswap UR pipeline; manifest exists at
 *     `registryV2/manifests/uniswap/permit2/permitSingle@1.0.0.json`.
 *   - Other typed-data flows (EIP-2612 `Permit`, UniswapX
 *     `PermitWitnessTransferFrom`, `ExclusiveDutchOrder`, etc.) fall
 *     through with `null` so the orchestrator preserves the current
 *     observability-only audit row.
 *
 * Deferred to Phase 4D / 4D.5 (full WASM-side decode pipeline):
 *   - manifest lookup against the registry-v2 typed_data index
 *   - emit.body `$args.*` substitution → typed `ActionBody`
 *   - sig-deadline + nonce LiveField wiring
 *
 * Today this module emits a structurally complete v3 `Action` (meta +
 * `Permit2SignAllowance` body) sourced directly from the typed-data
 * payload — no WASM hop, no manifest lookup. Once Phase 4D wires
 * registry-v2 manifest decode for typed_data, this path collapses to a
 * thin lookup + body-substitution wrapper and the per-case hard-coding
 * here goes away.
 */

import type { TypedSignaturePayload } from "@lib/types";

// ───────────────────────────────────────────────────────────────────────────
// EIP-712 typed-data shape
// ───────────────────────────────────────────────────────────────────────────

/**
 * Minimal EIP-712 typed-data shape we consume. We DO NOT validate the
 * full `types` table here — the registry-v2 manifest does that at
 * install time and Phase 4D will reuse that match. The router only
 * needs the domain triple (`name`, `verifyingContract`) and the
 * `primaryType` discriminator to pick a manifest.
 *
 * `message` is `unknown` because each case (Permit2 / EIP-2612 /
 * UniswapX) carries a different payload shape — the case handler
 * narrows it. We deliberately keep `EIP712TypedData` portable across
 * wallet libraries (viem / ethers / metamask) where field nesting is
 * stable but the value types vary (string vs bigint for `uint256`).
 */
export interface EIP712TypedData {
  domain: {
    name?: string;
    version?: string;
    chainId?: number | string;
    verifyingContract?: string;
    salt?: string;
  };
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: unknown;
}

/** Permit2 contract address — CREATE2-deterministic; same on every chain. */
const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

// ───────────────────────────────────────────────────────────────────────────
// v3 Action skeleton (subset matching `simulation_reducer::action`)
// ───────────────────────────────────────────────────────────────────────────

/**
 * v3 `ActionMeta.nature.OffchainSig` payload. Mirrors the Rust enum
 * variant tagged with `"kind": "offchain_sig"`. We keep
 * `verifying_contract` as the canonical lowercase form so the audit
 * surface and Cedar policies don't have to case-fold.
 */
export interface OffchainSigNature {
  kind: "offchain_sig";
  domain: {
    name: string;
    version?: string;
    chain_id?: number;
    verifying_contract?: string;
    salt?: string;
  };
  deadline: number; // unix seconds — `sigDeadline` for Permit2
  nonce_key?: {
    kind: "permit2_nonce_bitmap";
    word: string; // base-10 decimal U256
    bit: number;
  };
}

/**
 * Permit2-shaped `TokenAction::Permit2SignAllowance`. Mirrors the Rust
 * variant tagged `"action": "permit2_sign_allowance"`. The body is
 * intentionally flat (no LiveField on `nonce`) for Phase 4C — Phase 4D
 * upgrades `nonce` to a LiveField pair `(word, bit)` once the Sync
 * orchestrator is wired.
 */
export interface Permit2SignAllowanceBody {
  domain: "token";
  token: {
    action: "permit2_sign_allowance";
    permit2_sign_allowance: {
      token: { key: { standard: "erc20"; chain: string; address: string } };
      spender: string;
      amount: string;
      expires_at: number;
      sig_deadline: number;
      nonce: string;
    };
  };
}

export interface SigRouterAction {
  meta: {
    submitted_at: number;
    submitter: string;
    nature: OffchainSigNature;
  };
  body: Permit2SignAllowanceBody;
  // Decoder id — manifest the router matched on. Empty when no
  // manifest matched (caller treats as a miss).
  decoder_id: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Public entry
// ───────────────────────────────────────────────────────────────────────────

export interface RouteTypedDataArgs {
  typedData: EIP712TypedData;
  submitter: string;
  submittedAt?: number;
}

/**
 * Phase 4C — typed-data router entry. Returns a v3 `Action` skeleton
 * when the request matches a known typed-data manifest, or `null` for
 * a miss (orchestrator falls through to the legacy typed-sig path).
 *
 * Match priority is deliberately strict — no fuzzy fallback. A
 * dApp-supplied `domain.name` with subtle typo (e.g. `"PermitTwo"`)
 * misses on purpose; we do not want to mis-route a benign signature
 * onto a high-trust manifest body.
 */
export function routeTypedData(args: RouteTypedDataArgs): SigRouterAction | null {
  const { typedData, submitter, submittedAt } = args;
  const verifyingContract = typedData.domain.verifyingContract?.toLowerCase();
  const domainName = typedData.domain.name;
  const primaryType = typedData.primaryType;
  if (!verifyingContract || !domainName || !primaryType) {
    return null;
  }

  // ── Permit2 / PermitSingle ────────────────────────────────────────
  // Manifest: registryV2/manifests/uniswap/permit2/permitSingle@1.0.0.json
  if (
    domainName === "Permit2" &&
    verifyingContract === PERMIT2_ADDRESS &&
    primaryType === "PermitSingle"
  ) {
    return routePermit2PermitSingle({
      typedData,
      submitter,
      submittedAt: submittedAt ?? Math.floor(Date.now() / 1000),
    });
  }

  // ── EIP-2612 token Permit (deferred — Phase 4D follow-up) ─────────
  // EIP-2612 uses domain.name = <token name>, primaryType = "Permit".
  // We can't match against a fixed `domain.name`; we need a typed-data
  // index keyed by `(verifyingContract, primaryType)` from registry.
  // Deferred until the manifest index lookup wires through WASM.
  //
  // ── UniswapX (deferred — Phase 4D follow-up) ──────────────────────
  // UniswapX uses domain.name = "UniswapX", primaryType =
  // "ExclusiveDutchOrder" | "PermitWitnessTransferFrom" | ... The
  // existing schema has SignIntentOrderAction; full routing arrives
  // alongside the registry-v2 manifest for UniswapX reactors.
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Case handlers
// ───────────────────────────────────────────────────────────────────────────

interface Permit2PermitDetails {
  token?: string;
  amount?: string | number | bigint;
  expiration?: string | number;
  nonce?: string | number | bigint;
}

interface Permit2PermitSingleMessage {
  details?: Permit2PermitDetails;
  spender?: string;
  sigDeadline?: string | number | bigint;
}

/**
 * Map Permit2 PermitSingle typed data → v3
 * `TokenAction::Permit2SignAllowance` body.
 *
 * Field map (typedData.message → ActionBody):
 *   details.token      → permit2_sign_allowance.token.key.address
 *   details.amount     → permit2_sign_allowance.amount
 *   details.expiration → permit2_sign_allowance.expires_at
 *   details.nonce      → permit2_sign_allowance.nonce
 *   spender            → permit2_sign_allowance.spender
 *   sigDeadline        → permit2_sign_allowance.sig_deadline +
 *                        meta.nature.deadline
 *
 * Phase 4C keeps `nonce` as a flat decimal string. Phase 4D upgrades
 * to a LiveField pair `(word, bit)` against
 * `Permit2.nonceBitmap(owner, word)`.
 */
function routePermit2PermitSingle(args: {
  typedData: EIP712TypedData;
  submitter: string;
  submittedAt: number;
}): SigRouterAction | null {
  const msg = args.typedData.message as Permit2PermitSingleMessage | undefined;
  const details = msg?.details;
  if (!details?.token || !msg?.spender || msg.sigDeadline === undefined) {
    return null;
  }
  const chainId = parseDomainChainId(args.typedData.domain.chainId);
  if (chainId === null) {
    return null;
  }
  const sigDeadline = toUnixSeconds(msg.sigDeadline);
  const expiration =
    details.expiration !== undefined ? toUnixSeconds(details.expiration) : 0;
  const amount = toDecimalString(details.amount ?? "0");
  const nonce = toDecimalString(details.nonce ?? "0");

  return {
    meta: {
      submitted_at: args.submittedAt,
      submitter: args.submitter,
      nature: {
        kind: "offchain_sig",
        domain: {
          name: "Permit2",
          chain_id: chainId,
          verifying_contract: PERMIT2_ADDRESS,
        },
        deadline: sigDeadline,
      },
    },
    body: {
      domain: "token",
      token: {
        action: "permit2_sign_allowance",
        permit2_sign_allowance: {
          token: {
            key: {
              standard: "erc20",
              chain: `eip155:${chainId}`,
              address: details.token.toLowerCase(),
            },
          },
          spender: msg.spender.toLowerCase(),
          amount,
          expires_at: expiration,
          sig_deadline: sigDeadline,
          nonce,
        },
      },
    },
    decoder_id: "uniswap/permit2/permitSingle@1.0.0",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wallets sometimes serialise `domain.chainId` as the EIP-712 raw
 * (hex string or decimal string); viem keeps it as a number. Normalise
 * to a plain `number`. Returns `null` for shapes we can't safely
 * interpret — caller misses.
 */
function parseDomainChainId(raw: number | string | undefined): number | null {
  if (raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
      try {
        const n = Number.parseInt(raw, 16);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coerce a wallet-supplied numeric ("decimal" / "0x..." / bigint / number)
 * into a base-10 decimal string. Used for `amount` / `nonce` where the
 * downstream WASM expects `DecimalString` U256.
 */
function toDecimalString(raw: string | number | bigint): string {
  if (typeof raw === "bigint") return raw.toString(10);
  if (typeof raw === "number") return Math.trunc(raw).toString(10);
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    try {
      return BigInt(raw).toString(10);
    } catch {
      return "0";
    }
  }
  return raw;
}

/**
 * Coerce a timestamp-like field (`expiration` / `sigDeadline`) into a
 * unix-seconds number. EIP-712 typed-data carries them as uint48 /
 * uint256 hex strings or decimals.
 */
function toUnixSeconds(raw: string | number | bigint): number {
  if (typeof raw === "number") return Math.trunc(raw);
  if (typeof raw === "bigint") {
    // Clamp to JS-safe range — Permit2 expirations are uint48 so we
    // never overflow in practice, but guard against malformed input.
    return raw > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(raw);
  }
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    try {
      const n = BigInt(raw);
      return n > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(n);
    } catch {
      return 0;
    }
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Convenience adapter — TypedSignaturePayload → routeTypedData()
// ───────────────────────────────────────────────────────────────────────────

/**
 * Phase 4C orchestrator-facing helper. Pulls the typed-data payload out
 * of the SW `Message` envelope and forwards to `routeTypedData`. Lives
 * here so the orchestrator stays agnostic of the EIP-712 shape.
 */
export function routeTypedSignaturePayload(args: {
  payload: TypedSignaturePayload;
  submittedAt?: number;
}): SigRouterAction | null {
  const td = args.payload.typedData as EIP712TypedData | undefined;
  if (!td || typeof td !== "object") return null;
  // EIP-712 typed-data carries `domain`/`primaryType`/`types`/`message`;
  // anything missing → caller misses.
  if (!td.domain || !td.primaryType || !td.types) return null;
  return routeTypedData({
    typedData: td,
    submitter: args.payload.address,
    ...(args.submittedAt !== undefined ? { submittedAt: args.submittedAt } : {}),
  });
}
