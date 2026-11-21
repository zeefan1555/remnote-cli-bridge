import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketClient } from '../../src/bridge/websocket-client';
import { fixedBridgeUrl, PROTOCOL_VERSION, requestSequence } from '../../src/bridge/protocol';
import { SDK_CATALOG_HASH } from '../../src/api/sdk-capabilities.generated';
import { MockWebSocket } from '../helpers/mocks';
import { authenticate, request } from '../helpers/connection';

let client: WebSocketClient;
afterEach(() => {
  client?.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockWebSocket.reset();
});

function start() {
  vi.stubGlobal('WebSocket', MockWebSocket);
  const log = vi.fn();
  client = new WebSocketClient({
    getIdentity: async () => ({
      pluginVersion: 'test-plugin',
      sdkVersion: '0.0.46',
      sdkCatalogHash: SDK_CATALOG_HASH,
      knowledgeBaseId: 'test-kb',
      knowledgeBaseName: 'Test',
    }),
    onLog: log,
  });
  client.connect();
  return { ws: MockWebSocket.instances.at(-1)!, log };
}

describe('zero-configuration command connection', () => {
  it('performs the protocol 2 handshake and serializes requests', async () => {
    const { ws } = start();
    const handler = vi.fn(async (req, assertSession) => {
      assertSession();
      return req.payload;
    });
    client.setMessageHandler(handler);
    await authenticate(ws);
    await vi.waitFor(() => expect(client.getStatus()).toBe('connected'));
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(JSON.stringify(ws.sentMessages[0])).not.toMatch(/proof|token|nonce/i);
    expect(await request(ws, 'sdk_call', { value: 1 })).toMatchObject({ result: { value: 1 } });
    ws.simulateMessage({ type: 'ping' });
    await vi.waitFor(() => expect(ws.sentMessages).toContain(JSON.stringify({ type: 'pong' })));
    handler.mockRejectedValueOnce(new Error('SDK failed'));
    expect(await request(ws, 'sdk_call')).toMatchObject({ error: 'SDK failed' });
    expect(client.getRetryPhase()).toBe('idle');
  });

  it.each(['old-challenge', 'protocol', 'request-before-ready', 'invalid-json', 'missing-version'])(
    'rejects %s before invoking the gateway',
    async (kind) => {
      const { ws, log } = start();
      const handler = vi.fn();
      client.setMessageHandler(handler);
      await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
      if (kind === 'invalid-json') ws.simulateMessage('{');
      else if (kind === 'request-before-ready')
        ws.simulateMessage({ id: '1', action: 'sdk_call', payload: {} });
      else if (kind === 'old-challenge')
        ws.simulateMessage({ type: 'challenge', protocolVersion: 2 });
      else
        ws.simulateMessage({
          type: 'hello',
          protocolVersion: kind === 'protocol' ? 1 : 2,
          ...(kind === 'missing-version' ? {} : { version: 'cli' }),
        });
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(log).toHaveBeenCalledWith('Protocol or authentication failure', 'error');
      expect(handler).not.toHaveBeenCalled();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(ws.sentMessages).toHaveLength(0);
    }
  );

  it('rejects a mismatched KB and replayed request IDs', async () => {
    const { ws } = start();
    const handler = vi.fn(async () => true);
    client.setMessageHandler(handler);
    await authenticate(ws);
    const frame = {
      id: '1',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() + 5000,
    };
    ws.simulateMessage(frame);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    ws.simulateMessage(frame);
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).toHaveBeenCalledTimes(1);

    client.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    await authenticate(next);
    next.simulateMessage({ ...frame, knowledgeBaseId: 'another-kb' });
    await vi.waitFor(() => expect(next.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not mutate after the queued request deadline or a session change', async () => {
    const { ws } = start();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutate = vi.fn();
    client.setMessageHandler(async (_, assertSession) => {
      await pending;
      assertSession();
      mutate();
    });
    await authenticate(ws);
    ws.simulateMessage({
      id: '1',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() - 1,
    });
    await vi.waitFor(() =>
      expect(ws.sentMessages.some((frame) => frame.includes('deadline expired'))).toBe(true)
    );
    ws.simulateMessage({
      id: '2',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() + 5000,
    });
    client.reconnect();
    release();
    const next = MockWebSocket.instances.at(-1)!;
    await authenticate(next);
    expect(mutate).not.toHaveBeenCalled();
    expect(next.sentMessages.some((frame) => frame.includes('"id":"2"'))).toBe(false);
  });

  it('caps retries at 1 second and cancels them on shutdown', async () => {
    vi.useFakeTimers();
    MockWebSocket.mode = 'close';
    start();
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(1001);
    expect(client.getReconnectMetadata().lastRetryDelayMs).toBeLessThanOrEqual(1000);
    const count = MockWebSocket.instances.length;
    client.nudgeReconnect('focus');
    expect(MockWebSocket.instances.length).toBeGreaterThan(count);
    client.disconnect();
    const finalCount = MockWebSocket.instances.length;
    client.nudgeReconnect('focus');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockWebSocket.instances).toHaveLength(finalCount);
    expect(client.getRetryPhase()).toBe('idle');
  });

  it('waits for in-flight native work before answering a new handshake', async () => {
    const { ws } = start();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      await pending;
      return true;
    });
    client.setMessageHandler(handler);
    await authenticate(ws);
    ws.simulateMessage({
      id: '1',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() + 5000,
    });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    client.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(next.readyState).toBe(MockWebSocket.OPEN));
    next.simulateMessage({ type: 'hello', protocolVersion: 2, version: 'next-cli' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(next.sentMessages).toHaveLength(0);
    release();
    await vi.waitFor(() =>
      expect(next.sentMessages.some((frame) => frame.includes('"type":"ready"'))).toBe(true)
    );
    expect(ws.sentMessages.some((frame) => frame.includes('"id":"1"'))).toBe(false);
  });

  it('enforces byte limits for Unicode frames before dispatch', async () => {
    const { ws } = start();
    const handler = vi.fn();
    client.setMessageHandler(handler);
    await authenticate(ws);
    ws.simulateMessage(JSON.stringify({ id: '1', payload: '\u4e2d'.repeat(3 * 1024 * 1024) }));
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).not.toHaveBeenCalled();
  });

  it('times out an incomplete handshake without hanging retries', async () => {
    vi.useFakeTimers();
    const { ws } = start();
    await vi.advanceTimersByTimeAsync(5001);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(client.getReconnectMetadata().nextRetryAt).toBeDefined();
  });

  it('accepts only the fixed loopback endpoint and canonical request IDs', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(fixedBridgeUrl()).toBe('ws://127.0.0.1:3002/');
    for (const url of [
      'wss://example.com',
      'ws://localhost:3002',
      'ws://127.0.0.1:3003',
      'ws://127.0.0.1/path',
      'ws://user@127.0.0.1:3002',
      'ws://127.0.0.1:3002/?q=1',
    ])
      expect(() => fixedBridgeUrl(url)).toThrow();
    expect(requestSequence('1')).toBe(1);
    expect(requestSequence(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    for (const id of ['', '0', '01', '+1', '-1', '1.0', '1e2', ' 1', 1, null])
      expect(() => requestSequence(id)).toThrow('Invalid request ID');
  });
});
