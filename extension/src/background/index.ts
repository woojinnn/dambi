import Browser from 'webextension-polyfill';
import { Identifier } from '@lib/identifier';
import {
  isTransaction,
  isTypedSignature,
  isUntypedSignature,
  type Message,
  type MessageResponse,
} from '@lib/types';

console.log('Scopeball SW alive at', new Date().toISOString());

Browser.runtime.onConnect.addListener((port) => {
  if (port.name !== Identifier.CONTENT_SCRIPT) return;
  port.onMessage.addListener((message: Message) => {
    void handleMessage(message, port);
  });
});

async function handleMessage(message: Message, port: Browser.Runtime.Port): Promise<void> {
  // Plan 3 skeleton: log + auto-allow. Plan 5 replaces with real
  // engine-driven verdict resolution.
  const bypassed = 'bypassed' in message.data && !!message.data.bypassed;

  if (isTransaction(message)) {
    console.log('[Scopeball] tx', {
      hostname: message.data.hostname,
      chainId: message.data.chainId,
      to: message.data.transaction.to,
      data: String(message.data.transaction.data ?? '').slice(0, 10),
      bypassed,
    });
  } else if (isTypedSignature(message)) {
    console.log('[Scopeball] typed-sig', {
      hostname: message.data.hostname,
      chainId: message.data.chainId,
      primaryType: (message.data.typedData as any)?.primaryType,
      bypassed,
    });
  } else if (isUntypedSignature(message)) {
    console.log('[Scopeball] personal-sign', {
      hostname: message.data.hostname,
      messageLen: message.data.message.length,
      bypassed,
    });
  }
  if (!bypassed) {
    const response: MessageResponse = { requestId: message.requestId, data: true };
    try {
      port.postMessage(response);
    } catch {
      /* dApp tab gone */
    }
  }
}
