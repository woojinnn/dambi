import Browser from 'webextension-polyfill';
import { Identifier } from '@lib/identifier';
import { decideMessage, recordTxHash } from './orchestrator';
import { installReceiptPoller } from './receipt-poller';
import type { Message, MessageResponse } from '@lib/types';

console.log('Scopeball SW alive at', new Date().toISOString());
installReceiptPoller();

Browser.runtime.onConnect.addListener((port) => {
  if (port.name !== Identifier.CONTENT_SCRIPT) return;

  port.onMessage.addListener((message: Message) => {
    void handleMessage(message, port);
  });
});

async function handleMessage(message: Message, port: Browser.Runtime.Port): Promise<void> {
  // Tx-hash reports come in over the same port from the inpage proxy.
  if (message.data.type === 'tx-hash-report') {
    void recordTxHash(message.data.requestId, message.data.txHash);
    return;
  }
  // Raw / frozen advisories: log only (Plan 5 doesn't gate, but surfaces
  // them so the user can see something happened).
  if (message.data.type === 'raw-transaction-advisory') {
    console.warn('[Scopeball] raw-tx advisory', message.data);
    return;
  }
  if (message.data.type === 'provider-frozen-warning') {
    console.error('[Scopeball] provider frozen', message.data);
    return;
  }

  const { ok } = await decideMessage(message);
  if (!message.data.bypassed) {
    const response: MessageResponse = { requestId: message.requestId, data: ok };
    try {
      port.postMessage(response);
    } catch {
      /* dApp tab gone */
    }
  }
}
