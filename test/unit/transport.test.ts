import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CONCURRENT_REQUESTS,
  MAX_OUTSTANDING_REQUESTS,
  MAX_QUEUED_BYTES,
  MAX_QUEUED_FRAMES,
  MAX_SLOT_WAITERS,
  WebSocketClient,
} from '../../src/bridge/websocket-client';
import { SDK_CATALOG_HASH } from '../../src/api/sdk-capabilities.generated';
import { MockWebSocket } from '../helpers/mocks';
import { authenticate } from '../helpers/connection';

let client: WebSocketClient;
const releases: Array<() => void> = [];
afterEach(() => {
  client?.disconnect();
  releases.splice(0).forEach((release) => release());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  MockWebSocket.reset();
});

function start() {
  vi.stubGlobal('WebSocket', MockWebSocket);
  client = new WebSocketClient({
    getIdentity: async () => ({
      pluginVersion: 'test-plugin',
      sdkVersion: '0.0.46',
      sdkCatalogHash: SDK_CATALOG_HASH,
      knowledgeBaseId: 'test-kb',
      knowledgeBaseName: 'Test',
    }),
  });
  client.connect();
  return MockWebSocket.instances.at(-1)!;
}

function send(ws: MockWebSocket, id: string, deadline = Date.now() + 15_000) {
  ws.simulateMessage({ id, action: 'sdk_call', payload: {}, knowledgeBaseId: 'test-kb', deadline });
}

function counts() {
  return client as unknown as {
    queuedFrames: number;
    queuedBytes: number;
    outstanding: number;
    slotWaiters: unknown[];
  };
}

describe('transport resource bounds', () => {
  it.each(['success', 'error'])('never accepts a decreasing ID after a %s', async (kind) => {
    const ws = start();
    const handler = vi.fn(async () => {
      if (kind === 'error') throw new Error('SDK failed');
      return true;
    });
    client.setMessageHandler(handler);
    await authenticate(ws);
    send(ws, '5');
    await vi.waitFor(() =>
      expect(ws.sentMessages.some((frame) => frame.includes('"id":"5"'))).toBe(true)
    );
    send(ws, '4');
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('caps 16 running and 16 waiting requests without cumulative history', async () => {
    const ws = start();
    const handler = vi.fn(async () => new Promise<void>((resolve) => releases.push(resolve)));
    client.setMessageHandler(handler);
    await authenticate(ws);
    for (let id = 1; id <= MAX_OUTSTANDING_REQUESTS; id++) send(ws, String(id));
    await vi.waitFor(() => expect(counts().outstanding).toBe(MAX_OUTSTANDING_REQUESTS));
    expect(handler).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS);
    expect(counts().slotWaiters).toHaveLength(MAX_SLOT_WAITERS);
    send(ws, String(MAX_OUTSTANDING_REQUESTS + 1));
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(counts().outstanding).toBe(0));
  });

  it('bounds queued frames and aggregate bytes before parsing', async () => {
    const ws = start();
    await authenticate(ws);
    await vi.waitFor(() => expect(counts().queuedFrames).toBe(0));
    ws.simulateMessage(' '.repeat(MAX_QUEUED_BYTES / 2 + 1));
    ws.simulateMessage(' '.repeat(MAX_QUEUED_BYTES / 2 + 1));
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(counts().queuedFrames).toBe(1);
    expect(counts().queuedBytes).toBeLessThanOrEqual(MAX_QUEUED_BYTES);
    await vi.waitFor(() => expect(counts().queuedFrames).toBe(0));
  });

  it('declares one execution window and one bounded waiting window', () => {
    expect(MAX_SLOT_WAITERS).toBe(MAX_CONCURRENT_REQUESTS);
    expect(MAX_OUTSTANDING_REQUESTS).toBe(32);
    expect(MAX_QUEUED_FRAMES).toBe(MAX_OUTSTANDING_REQUESTS);
    expect(MAX_QUEUED_BYTES).toBe(8 * 1024 * 1024);
  });
});
