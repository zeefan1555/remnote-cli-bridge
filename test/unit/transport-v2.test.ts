import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestSequence } from '../../src/bridge/protocol';
import {
  MAX_CONCURRENT_REQUESTS,
  MAX_OUTSTANDING_REQUESTS,
  MAX_QUEUED_BYTES,
  MAX_QUEUED_FRAMES,
  MAX_SLOT_WAITERS,
  WebSocketClient,
} from '../../src/bridge/websocket-client';
import { MockWebSocket } from '../helpers/mocks';
import { authenticate, NONCE, sign, TEST_TOKEN } from '../helpers/connection';

let client: WebSocketClient;
const releases: Array<() => void> = [];
afterEach(() => {
  client?.disconnect();
  releases.splice(0).forEach((release) => release());
  vi.unstubAllGlobals();
  MockWebSocket.reset();
});
function start() {
  vi.stubGlobal('WebSocket', MockWebSocket);
  const getToken = vi.fn(async () => TEST_TOKEN);
  const log = vi.fn();
  client = new WebSocketClient({
    url: 'ws://127.0.0.1:3002',
    pluginVersion: 'synthetic',
    getToken,
    getIdentity: async () => ({
      knowledgeBaseId: 'test-kb',
      knowledgeBaseName: 'Synthetic',
      acceptWriteOperations: false,
      acceptReplaceOperation: false,
    }),
    onLog: log,
  });
  client.connect();
  return { ws: MockWebSocket.instances.at(-1)!, getToken, log };
}
function send(ws: MockWebSocket, id: unknown, deadline = Date.now() + 15_000) {
  ws.simulateMessage({ id, action: 'sdk_call', payload: {}, knowledgeBaseId: 'test-kb', deadline });
}
function counts() {
  return client as unknown as {
    inFlight: number;
    outstanding: number;
    queuedFrames: number;
    queuedBytes: number;
    slotWaiters: unknown[];
  };
}
describe('protocol 2 request identity and independent resource bounds', () => {
  it('resets IDs only in a new authenticated session after old work settles', async () => {
    const { ws } = start();
    let finishOld!: () => void;
    const handler = vi.fn(async () => {
      if (handler.mock.calls.length === 1)
        await new Promise<void>((r) => {
          finishOld = r;
          releases.push(r);
        });
      return true;
    });
    client.setMessageHandler(handler);
    await authenticate(ws);
    send(ws, '9007199254740991');
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    client.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(next.readyState).toBe(MockWebSocket.OPEN));
    next.simulateMessage({
      type: 'challenge',
      protocolVersion: 2,
      nonce: NONCE,
      proof: sign(TEST_TOKEN, 'cli:' + NONCE),
    });
    send(ws, '1'); // A late event on the closed socket is ignored, not reassigned.
    await new Promise((r) => setTimeout(r, 20));
    expect(next.sentMessages).toHaveLength(0);
    expect(handler).toHaveBeenCalledOnce();
    finishOld();
    await vi.waitFor(() => expect(next.sentMessages).toHaveLength(1));
    next.simulateMessage({ type: 'ready', protocolVersion: 2, version: 'synthetic' });
    send(next, '1');
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(next.sentMessages.some((s) => s.includes('"id":"1"'))).toBe(true)
    );
    expect(ws.sentMessages.some((s) => s.includes('"id"'))).toBe(false);
  });

  it('does not log private malformed frame text', async () => {
    const { ws, log } = start();
    const handler = vi.fn();
    client.setMessageHandler(handler);
    await authenticate(ws);
    ws.simulateMessage('{"secret":"' + TEST_TOKEN);
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(TEST_TOKEN);
    expect(log).toHaveBeenCalledWith('Protocol or authentication failure', 'error');
  });

  it.each(['', '0', '01', '+1', '-1', '1.0', '1e2', ' 1', '1\n', '9007199254740992', 1, null])(
    'rejects noncanonical or unsafe ID %j before dispatch',
    async (id) => {
      expect(() => requestSequence(id)).toThrow('Invalid request ID');
      const { ws } = start();
      const handler = vi.fn();
      client.setMessageHandler(handler);
      await authenticate(ws);
      send(ws, id);
      await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it.each(['success', 'sdk-error', 'expired'])(
    'never reuses an ID consumed by %s',
    async (kind) => {
      const { ws } = start();
      const handler = vi.fn(async () => {
        if (kind === 'sdk-error') throw new Error('Synthetic SDK error');
        return true;
      });
      client.setMessageHandler(handler);
      await authenticate(ws);
      send(ws, '7', kind === 'expired' ? Date.now() - 1 : Date.now() + 15_000);
      await vi.waitFor(() =>
        expect(ws.sentMessages.some((s) => s.includes('"id":"7"'))).toBe(true)
      );
      send(ws, '7');
      await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
      expect(handler).toHaveBeenCalledTimes(kind === 'expired' ? 0 : 1);
    }
  );

  it.each(['6', '9007199254740991'])('rejects decreasing or repeated maximum ID %s', async (id) => {
    const { ws } = start();
    const handler = vi.fn(async () => true);
    client.setMessageHandler(handler);
    await authenticate(ws);
    expect(requestSequence('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    send(ws, '9007199254740991');
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    send(ws, id);
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('rejects protocol 1 before token/identity access or handler dispatch', async () => {
    const { ws, getToken, log } = start();
    const handler = vi.fn();
    client.setMessageHandler(handler);
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
    ws.simulateMessage({
      type: 'challenge',
      protocolVersion: 1,
      nonce: NONCE,
      proof: sign(TEST_TOKEN, 'cli:' + NONCE),
    });
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(getToken).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(TEST_TOKEN);
  });

  it('caps outstanding work at 32 and slot waiters at 16; overload never dispatches', async () => {
    const { ws } = start();
    const handler = vi.fn(async () => new Promise<void>((r) => releases.push(r)));
    client.setMessageHandler(handler);
    await authenticate(ws);
    for (let id = 1; id <= MAX_CONCURRENT_REQUESTS; id++) send(ws, String(id));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS));
    for (let id = MAX_CONCURRENT_REQUESTS + 1; id <= MAX_OUTSTANDING_REQUESTS; id++)
      send(ws, String(id));
    await vi.waitFor(() => expect(counts().slotWaiters).toHaveLength(MAX_SLOT_WAITERS));
    expect(counts().outstanding).toBe(MAX_OUTSTANDING_REQUESTS);
    send(ws, String(MAX_OUTSTANDING_REQUESTS + 1));
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).toHaveBeenCalledTimes(MAX_CONCURRENT_REQUESTS);
    expect(counts().slotWaiters).toHaveLength(0);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(counts().outstanding).toBe(0));
    expect(counts().inFlight).toBe(0);
  });

  it('bounds queued frames while prior native work cannot settle', async () => {
    const { ws } = start();
    const handler = vi.fn(async () => new Promise<void>((r) => releases.push(r)));
    client.setMessageHandler(handler);
    await authenticate(ws);
    send(ws, '1');
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    client.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(next.readyState).toBe(MockWebSocket.OPEN));
    for (let id = 1; id <= MAX_QUEUED_FRAMES; id++) send(next, String(id));
    expect(counts().queuedFrames).toBe(MAX_QUEUED_FRAMES);
    send(next, '33');
    expect(next.readyState).toBe(MockWebSocket.CLOSED);
    expect(counts().queuedFrames).toBe(MAX_QUEUED_FRAMES);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(counts().queuedFrames).toBe(0));
    expect(counts().queuedBytes).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('bounds aggregate queued bytes, not only individual frame sizes', async () => {
    const { ws } = start();
    const handler = vi.fn();
    client.setMessageHandler(handler);
    await authenticate(ws);
    await vi.waitFor(() => expect(counts().queuedFrames).toBe(0));
    ws.simulateMessage(' '.repeat(MAX_QUEUED_BYTES / 2 + 1));
    ws.simulateMessage(' '.repeat(MAX_QUEUED_BYTES / 2 + 1));
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(counts().queuedFrames).toBe(1);
    expect(counts().queuedBytes).toBeLessThanOrEqual(MAX_QUEUED_BYTES);
    await vi.waitFor(() => expect(counts().queuedFrames).toBe(0));
    expect(handler).not.toHaveBeenCalled();
  });
});
