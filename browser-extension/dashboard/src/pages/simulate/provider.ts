/**
 * The /simulate wizard's data seam. The controller ({@link useSimController})
 * reads ALL its source data through a {@link SimProvider} so the views never
 * touch the backend directly. The live implementation is {@link realProvider}
 * (server + ps2 store + sim-bridge WASM).
 *
 * `initial()` is a SYNCHRONOUS seed for the first render (empty shells for the
 * real provider); `load()` is the async fetch; `run()` performs the simulation.
 */

import type {
  PackageView,
  PolicyView,
  RunResult,
  TxRow,
  WalletStateView,
  WalletView,
} from "./types";

/** Stable key for a binding (one policy inside one package, per wallet). The
 *  same def in two packages is two independent bindings → two distinct keys. */
export const bindingKey = (packageId: string, defId: string): string => `${packageId}::${defId}`;

/** Everything the wizard needs to seed its steps, sourced from a provider. */
export interface SimData {
  wallets: WalletView[];
  /** s0 snapshot per wallet (lowercase address → state). */
  statesByAddr: Record<string, WalletStateView>;
  policies: PolicyView[];
  /** Packages PER WALLET (lowercase address → that wallet's packages). Each
   *  wallet only shows the packages it actually has. */
  packagesByWallet: Record<string, PackageView[]>;
  /** Checkbox state — per wallet, the binding keys (`pkgId::defId`) whose policy
   *  checkbox is ON (mirrors `binding.enabled`). Independent of the package gate. */
  policyEnabledByWallet: Record<string, string[]>;
  /** Package toggle (gate) state — per wallet, the package ids whose toggle is ON
   *  (mirrors `w.packageEnabled`, default on). A policy is effective only when its
   *  package gate is on AND its checkbox is on. */
  packageEnabledByWallet: Record<string, string[]>;
  /** Seed tx-queue rows. */
  txRows: TxRow[];
}

/** Inputs the wizard collects across steps 1–3, handed to {@link SimProvider.run}. */
export interface RunInput {
  /** Selected wallet addresses (lowercase), in selection order. */
  selected: string[];
  /** CAIP-2 chain filter chosen in step 1. */
  chain: string;
  /** Enabled policy-ids per wallet (lowercase address → ids). */
  enabledByWallet: Record<string, string[]>;
  /** The tx queue (step 3). */
  txRows: TxRow[];
  /** s0 state per wallet (so the provider can render histories from it). */
  statesByAddr: Record<string, WalletStateView>;
}

export interface SimProvider {
  /** Synchronous seed for the first render (empty shells; `load()` fills them). */
  initial(): SimData;
  /** Async refresh — fetches wallets/state/policies from the backend. */
  load(): Promise<SimData>;
  /** Run the simulation: tx queue + enabled policies → per-step verdicts + diffs. */
  run(input: RunInput): Promise<RunResult>;
}
