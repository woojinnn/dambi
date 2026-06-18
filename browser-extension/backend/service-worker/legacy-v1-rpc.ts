/**
 * The unauthenticated `/v1/rpc` sidecar was retired from the active production
 * policy-server path. Keep it behind an explicit build-time flag for local
 * experiments only.
 */
export function legacyV1RpcFallbackEnabled(
  env:
    | {
        readonly [key: string]: string | undefined;
        readonly POLICY_RPC_ENABLE_LEGACY_V1_RPC?: string;
      }
    | undefined = typeof process !== "undefined" ? process.env : undefined,
): boolean {
  const value = env?.POLICY_RPC_ENABLE_LEGACY_V1_RPC;
  return value === "1" || value?.toLowerCase() === "true";
}
