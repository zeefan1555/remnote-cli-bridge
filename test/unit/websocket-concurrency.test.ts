import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONCURRENT_REQUESTS, WebSocketClient } from '../../src/bridge/websocket-client';
import { MockWebSocket } from '../helpers/mocks';
import { authenticate, TEST_TOKEN } from '../helpers/connection';

let client: WebSocketClient;
afterEach(() => {
  client?.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockWebSocket.reset();
});

function start() {
  vi.stubGlobal('WebSocket', MockWebSocket);
  client = new WebSocketClient({
    url: 'ws://127.0.0.1:3002',
    pluginVersion: 'different-plugin-version',
    getToken: async () => TEST_TOKEN,
    getIdentity: async () => ({
      knowledgeBaseId: 'test-kb',
      knowledgeBaseName: 'Test',
      acceptWriteOperations: true,
      acceptReplaceOperation: false,
    }),
  });
  client.connect();
  return MockWebSocket.instances.at(-1)!;
}

function send(ws: MockWebSocket, id: string) {
  ws.simulateMessage({
    id,
    action: 'sdk_call',
    payload: {},
    knowledgeBaseId: 'test-kb',
    deadline: Date.now() + 15_000,
  });
}

describe('concurrent bridge requests', () => {
  it('caps in-flight handlers at 16 and admits the next request in FIFO order', async () => {
    const ws = start();
    const started: string[] = [];
    const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    client.setMessageHandler(async (req) => {
      started.push(req.id);
      await new Promise<void>((resolve, reject) => {
        gates.set(req.id, { resolve, reject });
      });
      return { id: req.id };
    });
    await authenticate(ws);
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS + 4; i++) send(ws, `r${i}`);
    await vi.waitFor(() => expect(started).toHaveLength(MAX_CONCURRENT_REQUESTS));
    expect(started).toEqual(Array.from({ length: MAX_CONCURRENT_REQUESTS }, (_, i) => `r${i}`));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toHaveLength(MAX_CONCURRENT_REQUESTS);
    gates.get('r0')!.reject(new Error('r0 failed'));
    await vi.waitFor(() => expect(started).toContain('r16'));
    expect(started[MAX_CONCURRENT_REQUESTS]).toBe('r16');
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    await vi.waitFor(() =>
      expect(ws.sentMessages.filter((frame) => frame.includes('"id":"r0"'))).toEqual([
        JSON.stringify({ id: 'r0', error: 'r0 failed' }),
      ])
    );
    await vi.waitFor(() => {
      for (const gate of gates.values()) gate.resolve();
      expect(started).toHaveLength(MAX_CONCURRENT_REQUESTS + 4);
    });
  });

  it('matches out-of-order responses by id and isolates handler errors', async () => {
    const ws = start();
    const gates = new Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    client.setMessageHandler(
      (req) =>
        new Promise((resolve, reject) => {
          gates.set(req.id, { resolve, reject });
        })
    );
    await authenticate(ws);
    for (const id of ['a', 'b', 'c']) send(ws, id);
    await vi.waitFor(() => expect(gates.size).toBe(3));
    gates.get('c')!.resolve({ n: 3 });
    gates.get('a')!.reject(new Error('a failed'));
    gates.get('b')!.resolve({ n: 2 });
    await vi.waitFor(() => {
      const ids = ws.sentMessages
        .map((frame) => JSON.parse(frame) as { id?: string })
        .filter((frame) => frame.id)
        .map((frame) => frame.id);
      expect(ids).toEqual(['c', 'a', 'b']);
    });
    const responses = ws.sentMessages
      .map((frame) => JSON.parse(frame) as { id?: string; result?: unknown; error?: string })
      .filter((frame) => frame.id);
    expect(responses).toEqual([
      { id: 'c', result: { n: 3 } },
      { id: 'a', error: 'a failed' },
      { id: 'b', result: { n: 2 } },
    ]);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });

  it('does not run or answer queued requests after the socket closes', async () => {
    const ws = start();
    const releases: Array<() => void> = [];
    const handler = vi.fn(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return true;
    });
    client.setMessageHandler(handler);
    await authenticate(ws);
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS + 1; i++) send(ws, `q${i}`);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS));
    client.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    while (releases.length > 0) releases.shift()!();
    await authenticate(next);
    expect(handler).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS);
    const frames = [...ws.sentMessages, ...next.sentMessages].map(
      (frame) => JSON.parse(frame) as { id?: string }
    );
    expect(frames.some((frame) => frame.id?.startsWith('q'))).toBe(false);
  });
});
