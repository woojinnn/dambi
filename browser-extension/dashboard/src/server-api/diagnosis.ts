import { sendToExtension } from "./extension-bridge";

/** One probe sent to the WASM diagnosis runner. */
export interface ProbeDto {
  /** Structural node path, doubles as the probe @id. */
  id: string;
  /** EST of `permit(...) when { <subtree> }` produced by blocksToEst. */
  est: unknown;
}

export interface DiagnosisRequestDto {
  action: unknown;
  meta: unknown;
  tx: { chain_id: string; from: string; to: string };
  bundles: { policy: string; manifest: unknown }[];
  results: Record<string, unknown>;
  probes: ProbeDto[];
}

export interface DiagnosisResultDto {
  true_ids: string[];
  error_ids: string[];
}

/** Calls the SW `run-diagnosis-probes` op; returns the truth map id sets. */
export async function runDiagnosisProbes(
  input: DiagnosisRequestDto,
): Promise<DiagnosisResultDto> {
  const raw = await sendToExtension<string>({
    type: "run-diagnosis-probes",
    input_json: JSON.stringify(input),
  });
  const envelope = JSON.parse(raw) as
    | { ok: true; data: DiagnosisResultDto }
    | { ok: false; error: { kind: string; message: string } };
  if (!envelope.ok) {
    throw new Error(envelope.error.message);
  }
  return envelope.data;
}
