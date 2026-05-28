/**
 * Protocol resolver registry — `<protocol>:<scope>` → resolver function.
 *
 * Each protocol file (e.g. `aave_v3.ts`) exports its resolver(s) and is
 * imported here to register entries in `PROTOCOL_SOURCE_RESOLVERS`.
 *
 * Add a new protocol:
 *  1. Add the source kind literal to the `ProtocolSourceKind` union in
 *     both `types.ts` (resolver-side) and `build-index.ts` (validator-side).
 *  2. Implement the resolver under `scripts/resolvers/<protocol>.ts`.
 *  3. Register it in the map below.
 *  4. Document it in `registryV2/docs/PROTOCOL_SOURCE_CATALOG.md`.
 */

import {
  atokensResolver,
  variableDebtsResolver,
  stableDebtsResolver,
} from "./aave_v3.ts";
import type { ProtocolResolver, ProtocolSourceKind } from "./types.ts";

export { rpcClient } from "./rpc.ts";
export type { ProtocolResolver, ProtocolSourceKind, ResolverOpts, Hex, CacheEntry, RpcClient } from "./types.ts";

/** Exhaustive map from source kind → resolver. Compile-time `Record` ensures coverage. */
export const PROTOCOL_SOURCE_RESOLVERS: Record<ProtocolSourceKind, ProtocolResolver> = {
  "aave_v3:atokens": atokensResolver,
  "aave_v3:variable_debts": variableDebtsResolver,
  "aave_v3:stable_debts": stableDebtsResolver,
};
