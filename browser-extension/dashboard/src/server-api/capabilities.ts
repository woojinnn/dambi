import { request } from "./client";
import type { ChainId } from "./types";

export interface SyncChainsResp {
  chains: ChainId[];
}

export async function listSyncChains(): Promise<SyncChainsResp> {
  return request<SyncChainsResp>("/capabilities/sync-chains");
}
