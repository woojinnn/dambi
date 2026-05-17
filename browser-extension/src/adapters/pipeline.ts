import type { Loader } from "./loader";
import type {
  ActionEnvelope,
  AdapterResult,
  ChainId,
  Hex,
} from "./types";

export interface PipelineDeps {
  loader: Loader;
  /**
   * Optional helpers from policy-engine-wasm (Plan 3). Wire these in when the
   * pe-wasm bundle is available. Pipeline gracefully degrades if a helper is
   * absent — registry hits still work, sign parsing falls back to raw payload.
   */
  helpers?: {
    parseSignRequestJson?: (method: string, paramsJson: string, chainId: number) => string;
    decodeAbiStandardJson?: (calldataHex: string) => string;
  };
}

export interface PipelineDiagnostics {
  registry_miss?: boolean;
  decode_err?: unknown;
  map_err?: unknown;
  sign_parse_error?: string;
}

export interface PipelineResult {
  envelopes: ActionEnvelope[];
  diagnostics?: PipelineDiagnostics;
}

const SIGN_METHODS = new Set([
  "eth_signTypedData_v4",
  "personal_sign",
  "eth_sign",
  "eth_signTransaction",
  "eth_sendUserOperation",
  "wallet_grantPermissions",
]);

export class Pipeline {
  constructor(private deps: PipelineDeps) {}

  async run(method: string, params: unknown[], chainId: ChainId): Promise<PipelineResult> {
    if (SIGN_METHODS.has(method)) {
      return this.runSign(method, params, chainId);
    }
    return this.runWrite(params, chainId);
  }

  private async runSign(method: string, params: unknown[], chainId: ChainId): Promise<PipelineResult> {
    const parseFn = this.deps.helpers?.parseSignRequestJson;
    if (!parseFn) {
      return {
        envelopes: [otherEnvelope(chainId, ZERO_ADDR)],
        diagnostics: { sign_parse_error: "parseSignRequestJson helper not wired" },
      };
    }
    const raw = parseFn(method, JSON.stringify(params), chainId);
    const parsed = JSON.parse(raw) as
      | { kind: "ok"; method: string; signer: string; chain_id: number; payload: unknown }
      | { kind: "err"; message: string };

    if (parsed.kind === "err") {
      return {
        envelopes: [otherEnvelope(chainId, ZERO_ADDR)],
        diagnostics: { sign_parse_error: parsed.message },
      };
    }

    // Only typed-data has a verifyingContract we can route to. Other sign
    // methods (personal_sign, eth_sign, ...) emit Action::Other.
    if (parsed.method !== "ethsigntypeddatav4") {
      return {
        envelopes: [otherEnvelope(parsed.chain_id, ZERO_ADDR)],
      };
    }

    // TODO(plan-3): confirm the exact shape returned by
    // parse_sign_request_json — the outer/inner `payload` access pattern
    // below is load-bearing on Plan 3's return contract.
    const typedData = ((parsed.payload as { payload?: unknown })?.payload ?? parsed.payload) as
      | { domain?: { verifyingContract?: string }; primaryType?: string }
      | undefined;
    const verifyingContract = typedData?.domain?.verifyingContract as Hex | undefined;
    const primaryType = typedData?.primaryType;
    if (!verifyingContract || !primaryType) {
      return { envelopes: [otherEnvelope(parsed.chain_id, ZERO_ADDR)] };
    }

    const bridge = await this.deps.loader.load(parsed.chain_id, verifyingContract);
    if (!bridge) {
      return { envelopes: [otherEnvelope(parsed.chain_id, verifyingContract)] };
    }
    const result = bridge.decodeSign(
      { chain_id: parsed.chain_id, verifying_contract: verifyingContract, primary_type: primaryType },
      parsed.payload
    );
    return envelopesFromResult(result, parsed.chain_id, verifyingContract);
  }

  private async runWrite(params: unknown[], chainId: ChainId): Promise<PipelineResult> {
    const tx = (params[0] ?? {}) as Record<string, unknown>;
    const to = (tx["to"] as Hex) ?? null;
    if (!to) return { envelopes: [] };
    const calldataHex = ((tx["data"] ?? tx["input"]) as string) ?? "0x";
    const calldata = hexToBytes(calldataHex);

    const bridge = await this.deps.loader.load(chainId, to);
    if (!bridge) {
      const diag: PipelineDiagnostics = { registry_miss: true };
      const decodeAbi = this.deps.helpers?.decodeAbiStandardJson;
      if (decodeAbi) {
        (diag as PipelineDiagnostics & { decode_abi?: unknown }).decode_abi = JSON.parse(decodeAbi(calldataHex));
      }
      return {
        envelopes: [otherEnvelope(chainId, to)],
        diagnostics: diag,
      };
    }
    const selectorHex = ("0x" + calldataHex.slice(2, 10).padEnd(8, "0")) as Hex;
    const decoded = bridge.decodeCall(
      { chain_id: chainId, target: to, selector: selectorHex },
      calldata
    );
    if ("Err" in decoded) {
      return {
        envelopes: [otherEnvelope(chainId, to)],
        diagnostics: { decode_err: decoded.Err },
      };
    }
    const mapped = bridge.mapToAction(
      { chain_id: chainId, target: to, selector: selectorHex },
      decoded.Ok
    );
    if ("Err" in mapped) {
      return {
        envelopes: [otherEnvelope(chainId, to)],
        diagnostics: { map_err: mapped.Err },
      };
    }
    return { envelopes: mapped.Ok };
  }
}

const ZERO_ADDR: Hex = "0x0000000000000000000000000000000000000000";

function otherEnvelope(chainId: ChainId, target: Hex): ActionEnvelope {
  return { action: { kind: "other", chain_id: chainId, target } };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function envelopesFromResult(
  r: AdapterResult<ActionEnvelope[]>,
  chainId: ChainId,
  target: Hex
): PipelineResult {
  if ("Err" in r) {
    return { envelopes: [otherEnvelope(chainId, target)], diagnostics: { decode_err: r.Err } };
  }
  return { envelopes: r.Ok };
}
