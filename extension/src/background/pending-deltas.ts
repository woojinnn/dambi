import Browser from 'webextension-polyfill';

const KEY = 'windows:pending-deltas';
const COMMITTED_KEY = 'windows:committed';
const TTL_MS = 5 * 60_000;

export interface PendingDelta {
  requestId: string;
  /** EVM chain id of the underlying request — required so the receipt
   *  poller queries the correct RPC. */
  chainId: number;
  actor: string;
  windowEntries: { name: string; value: string }[];
  enqueuedAtMs: number;
  txHash?: string;
}

async function load(): Promise<PendingDelta[]> {
  const v = ((await Browser.storage.local.get(KEY)) as Record<string, unknown>)[KEY] as
    | PendingDelta[]
    | undefined;
  return v ?? [];
}
async function save(list: PendingDelta[]): Promise<void> {
  await Browser.storage.local.set({ [KEY]: list });
}

export async function reservePending(req: PendingDelta): Promise<void> {
  const list = await load();
  list.push(req);
  await save(list);
}

export async function setTxHash(requestId: string, txHash: string): Promise<void> {
  const list = await load();
  for (const d of list) if (d.requestId === requestId) d.txHash = txHash;
  await save(list);
}

export async function commitByTxHash(
  txHash: string,
  entry: { chainId: number; actor: string; windowEntries: { name: string; value: string }[] },
): Promise<void> {
  const list = await load();
  await save(list.filter((d) => d.txHash !== txHash));

  const committed =
    (((await Browser.storage.local.get(COMMITTED_KEY)) as Record<string, unknown>)[
      COMMITTED_KEY
    ] as Record<string, Record<string, string>> | undefined) ?? {};
  const actor = entry.actor.toLowerCase();
  committed[actor] = committed[actor] ?? {};
  for (const w of entry.windowEntries) {
    const prev = BigInt(committed[actor][w.name] ?? '0');
    committed[actor][w.name] = (prev + BigInt(w.value)).toString();
  }
  await Browser.storage.local.set({ [COMMITTED_KEY]: committed });
}

export async function discardExpired(nowMs: number = Date.now()): Promise<void> {
  const list = await load();
  await save(list.filter((d) => nowMs - d.enqueuedAtMs < TTL_MS));
}

export async function pendingForActor(
  actor: string,
): Promise<{ name: string; value: string }[]> {
  const list = await load();
  const sums = new Map<string, bigint>();
  for (const d of list) {
    if (d.actor.toLowerCase() !== actor.toLowerCase()) continue;
    for (const e of d.windowEntries) {
      sums.set(e.name, (sums.get(e.name) ?? 0n) + BigInt(e.value));
    }
  }
  return [...sums.entries()].map(([name, value]) => ({ name, value: value.toString() }));
}

export async function committedForActor(
  actor: string,
): Promise<{ name: string; value: string }[]> {
  const committed =
    (((await Browser.storage.local.get(COMMITTED_KEY)) as Record<string, unknown>)[
      COMMITTED_KEY
    ] as Record<string, Record<string, string>> | undefined) ?? {};
  const entries = committed[actor.toLowerCase()] ?? {};
  return Object.entries(entries).map(([name, value]) => ({ name, value }));
}

export async function listPending(): Promise<PendingDelta[]> {
  return load();
}
