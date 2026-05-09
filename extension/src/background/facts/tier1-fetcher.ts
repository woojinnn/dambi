import {
  readAllowances,
  readBalances,
  type Address,
} from "../chains/rpc-client";
import {
  buildOracleSnapshot,
  type OracleNeed,
} from "../oracle/oracle-snapshot";
import type {
  AllowanceEntry,
  BalanceEntry,
  HostSnapshot,
  OracleEntry,
  WindowEntry,
} from "../types/host-snapshot";

export interface TokenLite {
  chain_id: number;
  address: string;
  symbol: string;
  decimals: number;
  is_native: boolean;
}

export interface OracleRequirementLite {
  kind: string;
  token: TokenLite;
  raw_amount: string;
}

export type SigOracleRequirement = OracleNeed | OracleRequirementLite;

export interface Tier1Plan {
  tokens_for_oracle: TokenLite[];
  balances: { owner: string; token: TokenLite }[];
  allowances: { owner: string; token: TokenLite; spender: string }[];
  clock_required: boolean;
  sig_oracle_requirements: SigOracleRequirement[];
}

export interface Tier1FetchResult {
  oracle: OracleEntry[];
  balances: BalanceEntry[];
  allowances: AllowanceEntry[];
  now_ts: number;
}

// Keep each dimension below the former 2s outer cap while preserving siblings.
const DIM_BUDGET_MS = 1_500;
type Tier1Dimension = "oracle" | "balances" | "allowances";

type DimensionOutcome<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }
  | { status: "timed-out" };

function fallbackReason(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return String(reason);
}

function warnDimensionFallback(
  dimension: Tier1Dimension,
  reason: string,
): void {
  console.warn("[Scopeball SW] tier1 dimension fell back", {
    dimension,
    reason,
  });
}

function warnOracleEntryFallback(need: OracleNeed, reason: string): void {
  console.warn("[Scopeball SW] tier1 oracle entry fell back", {
    dimension: "oracle",
    token_key: oracleNeedTokenKey(need),
    reason,
  });
}

async function withDimensionTimeout<T>(
  dimension: Tier1Dimension,
  promise: Promise<T>,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DimensionOutcome<T>>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ status: "timed-out" }),
      DIM_BUDGET_MS,
    );
  });
  const work = promise.then(
    (value): DimensionOutcome<T> => ({ status: "fulfilled", value }),
    (reason): DimensionOutcome<T> => ({ status: "rejected", reason }),
  );

  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome.status === "fulfilled") return outcome.value;

    if (outcome.status === "timed-out") {
      onTimeout?.();
      warnDimensionFallback(dimension, "timeout");
      return fallback;
    }

    warnDimensionFallback(dimension, fallbackReason(outcome.reason));
    return fallback;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function dedupeOracleNeeds(needs: readonly OracleNeed[]): OracleNeed[] {
  const dedup = new Map<string, OracleNeed>();
  for (const need of needs) {
    const address = need.address.toLowerCase();
    dedup.set(oracleNeedTokenKey({ ...need, address }), { ...need, address });
  }
  return [...dedup.values()];
}

function oracleNeedTokenKey(need: OracleNeed): string {
  return `${need.chainId}:${need.address.toLowerCase()}`;
}

async function fetchOracleSnapshotPartial(
  needs: readonly OracleNeed[],
  fetchImpl: typeof fetch,
  nowMs: number,
  budgetMs: number,
  onTimeout?: () => void,
): Promise<OracleEntry[]> {
  const uniqueNeeds = dedupeOracleNeeds(needs);
  if (uniqueNeeds.length === 0) return [];

  const collected: OracleEntry[] = [];
  const fetches = uniqueNeeds.map(async (need) => {
    try {
      const entries = await buildOracleSnapshot([need], fetchImpl, nowMs);
      const tokenKey = oracleNeedTokenKey(need);
      collected.push(
        ...entries.filter((entry) => entry.token_key.toLowerCase() === tokenKey),
      );
    } catch (reason) {
      warnOracleEntryFallback(need, fallbackReason(reason));
    }
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed-out">((resolve) => {
    timeoutId = setTimeout(() => resolve("timed-out"), budgetMs);
  });

  try {
    const outcome = await Promise.race([Promise.allSettled(fetches), timeout]);
    if (outcome === "timed-out") {
      onTimeout?.();
      warnDimensionFallback("oracle", "timeout");
    }
    return collected.slice();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function oracleNeedFromToken(token: TokenLite): OracleNeed {
  return {
    chainId: token.chain_id,
    address: token.address,
    isNative: token.is_native,
  };
}

function oracleNeedFromRequirement(
  requirement: SigOracleRequirement,
): OracleNeed {
  if ("token" in requirement) return oracleNeedFromToken(requirement.token);
  return requirement;
}

async function fetchBalances(plan: Tier1Plan): Promise<(bigint | undefined)[]> {
  const out: (bigint | undefined)[] = new Array(plan.balances.length).fill(
    undefined,
  );
  const groups = new Map<
    string,
    { chainId: number; owner: string; indexes: number[]; tokens: Address[] }
  >();

  plan.balances.forEach((fact, index) => {
    const key = `${fact.token.chain_id}:${fact.owner.toLowerCase()}`;
    const group = groups.get(key) ?? {
      chainId: fact.token.chain_id,
      owner: fact.owner,
      indexes: [],
      tokens: [],
    };
    group.indexes.push(index);
    group.tokens.push(fact.token.address as Address);
    groups.set(key, group);
  });

  await Promise.all(
    [...groups.values()].map(async (group) => {
      try {
        const values = await readBalances(
          group.chainId,
          group.owner as Address,
          group.tokens,
        );
        values.forEach((value, offset) => {
          out[group.indexes[offset]] = value;
        });
      } catch {
        // Leave this group undefined.
      }
    }),
  );
  return out;
}

async function fetchAllowances(
  plan: Tier1Plan,
): Promise<(bigint | undefined)[]> {
  const out: (bigint | undefined)[] = new Array(plan.allowances.length).fill(
    undefined,
  );
  const groups = new Map<
    string,
    {
      chainId: number;
      owner: string;
      indexes: number[];
      tokens: Address[];
      spenders: Address[];
    }
  >();

  plan.allowances.forEach((fact, index) => {
    const key = `${fact.token.chain_id}:${fact.owner.toLowerCase()}`;
    const group = groups.get(key) ?? {
      chainId: fact.token.chain_id,
      owner: fact.owner,
      indexes: [],
      tokens: [],
      spenders: [],
    };
    group.indexes.push(index);
    group.tokens.push(fact.token.address as Address);
    group.spenders.push(fact.spender as Address);
    groups.set(key, group);
  });

  await Promise.all(
    [...groups.values()].map(async (group) => {
      try {
        const values = await readAllowances(
          group.chainId,
          group.owner as Address,
          group.tokens,
          group.spenders,
        );
        values.forEach((value, offset) => {
          out[group.indexes[offset]] = value;
        });
      } catch {
        // Leave this group undefined.
      }
    }),
  );
  return out;
}

async function fetchTier1Work(
  plan: Tier1Plan,
  fetchImpl: typeof fetch,
  nowMs: number,
  signal: AbortSignal,
): Promise<Tier1FetchResult> {
  const oracleController = new AbortController();
  const abortOracle = () => oracleController.abort();
  if (signal.aborted) abortOracle();
  else signal.addEventListener("abort", abortOracle, { once: true });

  const guardedFetch: typeof fetch = (input, init) =>
    fetchImpl(input, { ...init, signal: oracleController.signal });

  const oracleNeeds = [
    ...plan.tokens_for_oracle.map(oracleNeedFromToken),
    ...plan.sig_oracle_requirements.map(oracleNeedFromRequirement),
  ];

  const [oracle, balances, allowances] = await Promise.all([
    fetchOracleSnapshotPartial(
      oracleNeeds,
      guardedFetch,
      nowMs,
      DIM_BUDGET_MS,
      abortOracle,
    ),
    withDimensionTimeout("balances", fetchBalances(plan), []),
    withDimensionTimeout("allowances", fetchAllowances(plan), []),
  ]);

  signal.removeEventListener("abort", abortOracle);

  const balanceEntries: BalanceEntry[] = [];
  plan.balances.forEach((fact, index) => {
    const value = balances[index];
    if (value === undefined) return;
    balanceEntries.push({
      owner: fact.owner.toLowerCase(),
      token_key: `${fact.token.chain_id}:${fact.token.address.toLowerCase()}`,
      balance: value.toString(),
    });
  });

  const allowanceEntries: AllowanceEntry[] = [];
  plan.allowances.forEach((fact, index) => {
    const value = allowances[index];
    if (value === undefined) return;
    allowanceEntries.push({
      owner: fact.owner.toLowerCase(),
      token_key: `${fact.token.chain_id}:${fact.token.address.toLowerCase()}`,
      spender: fact.spender.toLowerCase(),
      allowance: value.toString(),
    });
  });

  return {
    oracle,
    balances: balanceEntries,
    allowances: allowanceEntries,
    now_ts: Math.floor(nowMs / 1000),
  };
}

export async function fetchTier1(
  plan: Tier1Plan,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<Tier1FetchResult> {
  return fetchTier1Work(plan, fetchImpl, nowMs, new AbortController().signal);
}

export function intoHostSnapshot(
  tier1: Tier1FetchResult,
  windows: WindowEntry[] = [],
): HostSnapshot {
  return {
    oracle: tier1.oracle,
    balances: tier1.balances,
    allowances: tier1.allowances,
    now_ts: tier1.now_ts,
    windows,
  };
}
