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
    handleMessage(message, port);
  });
});

function handleMessage(message: Message, port: Browser.Runtime.Port): void {
  if (isTransaction(message)) {
    console.log('[Scopeball] tx', {
      hostname: message.data.hostname,
      chainId: message.data.chainId,
      to: message.data.transaction.to,
      data: message.data.transaction.data?.slice(0, 10),
      bypassed: Boolean(message.data.bypassed),
    });
  } else if (isTypedSignature(message)) {
    console.log('[Scopeball] typed-sig', {
      hostname: message.data.hostname,
      chainId: message.data.chainId,
      primaryType:
        message.data.typedData &&
        typeof message.data.typedData === 'object' &&
        'primaryType' in message.data.typedData
          ? message.data.typedData.primaryType
          : undefined,
      bypassed: Boolean(message.data.bypassed),
    });
  } else if (isUntypedSignature(message)) {
    console.log('[Scopeball] personal-sign', {
      hostname: message.data.hostname,
      messageLen: message.data.message.length,
      bypassed: Boolean(message.data.bypassed),
    });
  } else if (message.data.type === 'tx-hash-report') {
    console.log('[Scopeball] tx-hash', {
      hostname: message.data.hostname,
      requestId: message.data.requestId,
      txHash: message.data.txHash,
    });
  } else if (message.data.type === 'raw-transaction-advisory') {
    console.warn('[Scopeball] raw-tx advisory', {
      hostname: message.data.hostname,
      rawPreview: message.data.rawPreview,
    });
  } else if (message.data.type === 'provider-frozen-warning') {
    console.error('[Scopeball] provider frozen', {
      hostname: message.data.hostname,
      providerName: message.data.providerName,
    });
  }

  const response: MessageResponse = { requestId: message.requestId, data: true };
  port.postMessage(response);
}
