import Browser from 'webextension-polyfill';
import { rpcClient } from './chains/rpc-client';
import { commitByTxHash, discardExpired, listPending } from './pending-deltas';

const ALARM = 'scopeball:receipt-poll';

export function installReceiptPoller(): void {
  Browser.alarms.create(ALARM, { periodInMinutes: 0.5 });
  Browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void poll();
  });
}

async function poll(): Promise<void> {
  await discardExpired();
  const pending = await listPending();
  for (const entry of pending) {
    if (!entry.txHash) continue;
    try {
      const client = rpcClient(entry.chainId);
      const receipt = await client.getTransactionReceipt({
        hash: entry.txHash as `0x${string}`,
      });
      if (receipt && receipt.status === 'success') {
        await commitByTxHash(entry.txHash, {
          chainId: entry.chainId,
          actor: entry.actor,
          windowEntries: entry.windowEntries,
        });
      }
      // null receipt → still mining; leave the entry in place. Expired
      // entries get swept by discardExpired on the next tick.
    } catch {
      // RPC failure: ignore; next poll retries.
    }
  }
}
