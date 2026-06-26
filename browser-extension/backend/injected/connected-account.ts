export interface InpageEthProvider {
  request?: (args: { method: string }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  providers?: unknown;
}

export type ConnectedAccountResolution =
  | {
      account: string;
      reason: "single";
      accounts: string[];
      providerCount: number;
    }
  | {
      account: null;
      reason: "none" | "multiple";
      accounts: string[];
      providerCount: number;
    };

export interface EthereumProviderDiscovery {
  providers(): InpageEthProvider[];
  dispose(): void;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const KNOWN_PROVIDER_KEYS = [
  "ethereum",
  "coinbaseWalletExtension",
  "eth",
  "rsk",
  "bsc",
  "polygon",
  "arbitrum",
  "fuse",
  "avalanche",
  "optimism",
] as const;

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && ADDRESS_RE.test(value)
    ? value.toLowerCase()
    : null;
}

function asProvider(value: unknown): InpageEthProvider | null {
  if (!value || typeof value !== "object") return null;
  const provider = value as InpageEthProvider;
  return typeof provider.request === "function" ||
    Array.isArray(provider.providers)
    ? provider
    : null;
}

function firstConnectedAccount(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    const address = normalizeAddress(candidate);
    if (address) return address;
  }
  return null;
}

async function requestAccounts(
  provider: InpageEthProvider,
  timeoutMs: number,
): Promise<string | null> {
  const request = provider.request;
  if (typeof request !== "function") return null;
  try {
    const result = await Promise.race([
      Reflect.apply(request, provider, [
        { method: "eth_accounts" },
      ]) as Promise<unknown>,
      new Promise<never>((_, reject) => {
        globalThis.setTimeout(
          () => reject(new Error("Dambi: accounts timeout")),
          timeoutMs,
        );
      }),
    ]);
    return firstConnectedAccount(result);
  } catch {
    return null;
  }
}

export function createEthereumProviderDiscovery(
  target: Window,
  onChanged: () => void = () => undefined,
): EthereumProviderDiscovery {
  const providers: InpageEthProvider[] = [];
  const seen = new WeakSet<object>();
  const listening = new WeakSet<object>();
  const source = target as Window & Record<string, unknown>;

  const addProviderTree = (value: unknown): boolean => {
    const provider = asProvider(value);
    if (!provider) return false;
    let changed = false;
    if (typeof provider.request === "function" && !seen.has(provider)) {
      seen.add(provider);
      providers.push(provider);
      changed = true;
    }
    if (typeof provider.on === "function" && !listening.has(provider)) {
      try {
        provider.on("accountsChanged", () => {
          onChanged();
        });
        listening.add(provider);
      } catch {
        // Some provider shims expose `on` but reject unknown listeners.
      }
    }
    if (Array.isArray(provider.providers)) {
      for (const child of provider.providers) {
        changed = addProviderTree(child) || changed;
      }
    }
    return changed;
  };

  const refresh = (): void => {
    let changed = false;
    for (const key of KNOWN_PROVIDER_KEYS) {
      changed = addProviderTree(source[key]) || changed;
    }
    if (changed) onChanged();
  };

  const announceListener = (event: Event): void => {
    const detail = (event as CustomEvent<{ provider?: unknown }>).detail;
    if (addProviderTree(detail?.provider)) onChanged();
  };

  target.addEventListener("eip6963:announceProvider", announceListener);
  refresh();
  try {
    target.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch {
    // Event dispatch is best-effort; static window sources are still checked.
  }

  return {
    providers: () => {
      refresh();
      return [...providers];
    },
    dispose: () => {
      target.removeEventListener("eip6963:announceProvider", announceListener);
    },
  };
}

export async function resolveUniqueConnectedAccount(
  providers: readonly InpageEthProvider[],
  timeoutMs = 1_500,
): Promise<ConnectedAccountResolution> {
  const accounts = new Set<string>();
  await Promise.all(
    providers.map(async (provider) => {
      const account = await requestAccounts(provider, timeoutMs);
      if (account) accounts.add(account);
    }),
  );
  const resolved = [...accounts].sort();
  if (resolved.length === 1) {
    return {
      account: resolved[0],
      reason: "single",
      accounts: resolved,
      providerCount: providers.length,
    };
  }
  return {
    account: null,
    reason: resolved.length > 1 ? "multiple" : "none",
    accounts: resolved,
    providerCount: providers.length,
  };
}
