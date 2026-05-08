import type { WindowPostMessageStream } from '@metamask/post-message-stream';
import objectHash from 'object-hash';
import type Browser from 'webextension-polyfill';
import { RequestType } from './types';
import type { AwaitingUserMessage, MessageData, StreamResponse } from './types';

const PHASE1_MS = 3_000;
const PHASE2_MS = 5 * 60_000;

type Duplex<Incoming, Outgoing> = WindowPostMessageStream & {
  on(event: 'data', callback: (data: Incoming) => void): void;
  removeListener(event: 'data', callback: (data: Incoming) => void): void;
  write(data: Outgoing): boolean;
};

const isAwaitingUser = (response: StreamResponse): response is AwaitingUserMessage =>
  'kind' in response && response.kind === 'awaiting-user';

export function generateRequestId(data: MessageData): string {
  switch (data.type) {
    case RequestType.TRANSACTION:
      return objectHash(data.transaction);
    case RequestType.TYPED_SIGNATURE:
      return objectHash(data.typedData as object);
    case RequestType.UNTYPED_SIGNATURE:
      return objectHash({ message: data.message });
    case 'raw-transaction-advisory':
      return objectHash({ hostname: data.hostname, rawPreview: data.rawPreview });
    case 'provider-frozen-warning':
      return objectHash({ hostname: data.hostname, providerName: data.providerName });
    case 'tx-hash-report':
      return objectHash({ requestId: data.requestId, txHash: data.txHash });
  }
}

export function sendToStreamAndAwaitResponse(
  stream: WindowPostMessageStream,
  data: MessageData,
): Promise<boolean> {
  const requestId = generateRequestId(data);
  const messageStream = stream as Duplex<StreamResponse, { requestId: string; data: MessageData }>;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      messageStream.removeListener('data', onData);
      resolve(value);
    };

    const armTimer = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(false), ms);
    };

    const onData = (response: StreamResponse) => {
      if (response.requestId !== requestId) return;
      if (isAwaitingUser(response)) {
        armTimer(PHASE2_MS);
        return;
      }
      finish(response.data);
    };

    messageStream.on('data', onData);
    armTimer(PHASE1_MS);
    messageStream.write({ requestId, data });
  });
}

export function sendToPortAndAwaitResponse(
  port: Browser.Runtime.Port,
  data: MessageData,
): Promise<boolean> {
  const requestId = generateRequestId(data);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      resolve(value);
    };

    const armTimer = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(false), ms);
    };

    const onMessage = (response: StreamResponse) => {
      if (response.requestId !== requestId) return;
      if (isAwaitingUser(response)) {
        armTimer(PHASE2_MS);
        return;
      }
      finish(response.data);
    };

    port.onMessage.addListener(onMessage);
    armTimer(PHASE1_MS);
    port.postMessage({ requestId, data });
  });
}

export function sendToPortAndDisregard(port: Browser.Runtime.Port, data: MessageData): void {
  const requestId = generateRequestId(data);
  port.postMessage({ requestId, data });
}
