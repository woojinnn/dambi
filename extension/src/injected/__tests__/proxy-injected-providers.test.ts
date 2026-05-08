import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamState = vi.hoisted(() => ({
  instances: [] as MockStream[],
}));

class MockStream {
  listeners: Array<(message: { requestId: string; data: boolean }) => void> = [];
  writes: Array<{ requestId: string; data: unknown }> = [];

  on(event: 'data', callback: (message: { requestId: string; data: boolean }) => void): void {
    if (event === 'data') this.listeners.push(callback);
  }

  removeListener(
    event: 'data',
    callback: (message: { requestId: string; data: boolean }) => void,
  ): void {
    if (event !== 'data') return;
    this.listeners = this.listeners.filter((listener) => listener !== callback);
  }

  write(message: { requestId: string; data: unknown }): boolean {
    this.writes.push(message);
    queueMicrotask(() => {
      for (const listener of this.listeners) listener({ requestId: message.requestId, data: true });
    });
    return true;
  }
}

vi.mock('@metamask/post-message-stream', () => ({
  WindowPostMessageStream: class extends MockStream {
    constructor() {
      super();
      streamState.instances.push(this);
    }
  },
}));

describe('inpage provider proxy', () => {
  beforeEach(() => {
    vi.resetModules();
    streamState.instances.length = 0;
    vi.stubGlobal('location', { hostname: 'app.example' });
    delete (window as any).ethereum;
  });

  it('gates payload-only send(payload) transaction calls before forwarding', async () => {
    const originalSend = vi.fn(() => 'sent');
    const provider = {
      request: vi.fn(async (request: { method: string }) => {
        if (request.method === 'eth_chainId') return '0x1';
        return 'request-result';
      }),
      send: originalSend,
    };
    (window as any).ethereum = provider;

    await import('../proxy-injected-providers');

    const tx = {
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      value: '0x0',
      data: '0x',
    };
    const result = (window as any).ethereum.send({
      method: 'eth_sendTransaction',
      params: [tx],
    });

    expect(originalSend).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('sent');
    expect(streamState.instances[0].writes).toHaveLength(1);
    expect(originalSend).toHaveBeenCalledTimes(1);
  });
});
