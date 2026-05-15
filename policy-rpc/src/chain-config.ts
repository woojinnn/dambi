import { RpcMethodError } from "./types.js";

const coinGeckoPlatforms = new Map<number, string>([
  [1, "ethereum"],
  [10, "optimistic-ethereum"],
  [56, "binance-smart-chain"],
  [137, "polygon-pos"],
  [8453, "base"],
  [42161, "arbitrum-one"],
]);

const wrappedNativeAddresses = new Map<number, string>([
  [1, "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"],
  [10, "0x4200000000000000000000000000000000000006"],
  [56, "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"],
  [137, "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"],
  [8453, "0x4200000000000000000000000000000000000006"],
  [42161, "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"],
]);

/**
 * Default public RPC endpoints for each supported chain. Override per-chain
 * via env vars `RPC_URL_<chainId>` (e.g. `RPC_URL_1=https://...`).
 *
 * publicnode.com endpoints are used because they require no API key and are
 * publicly maintained. Production deployments should override with private
 * RPC providers.
 */
export const RPC_URL_BY_CHAIN: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
};

export function coinGeckoPlatformForChain(chainId: number): string {
  const platform = coinGeckoPlatforms.get(chainId);

  if (!platform) {
    throw new RpcMethodError("unsupported_chain", `Unsupported chain_id ${chainId}`);
  }

  return platform;
}

export function wrappedNativeAddressForChain(chainId: number): string {
  const address = wrappedNativeAddresses.get(chainId);

  if (!address) {
    throw new RpcMethodError(
      "unsupported_chain",
      `Unsupported native asset chain_id ${chainId}`,
    );
  }

  return address;
}

/**
 * Resolve the RPC URL for a given chain. Honors the `RPC_URL_<chainId>` env
 * var first, then falls back to the public default. Returns `undefined` for
 * unsupported chains so the caller can throw a tailored error.
 */
export function rpcUrlForChain(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const override = env[`RPC_URL_${chainId}`];

  if (typeof override === "string" && override.trim() !== "") {
    return override.trim();
  }

  return RPC_URL_BY_CHAIN[chainId];
}
