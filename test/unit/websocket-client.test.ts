import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketClient } from '../../src/bridge/websocket-client';
import { loopbackUrl, verifyProof } from '../../src/bridge/protocol';
import { MockWebSocket } from '../helpers/mocks';
import { authenticate, NONCE, request, sign, TEST_TOKEN } from '../helpers/connection';

let client: WebSocketClient;
afterEach(() => {
  client?.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  MockWebSocket.reset();
});
function start() {
  vi.stubGlobal('WebSocket', MockWebSocket);
  const closed = vi.fn();
  const log = vi.fn();
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
    onSessionClosed: closed,
    onLog: log,
  });
  client.connect();
  return { ws: MockWebSocket.instances.at(-1)!, closed, log };
}
describe('authenticated command connection', () => {
  it('authenticates both peers, serializes requests and replies on the same socket', async () => {
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
    expect(await request(ws, 'sdk_call', { value: 1 })).toMatchObject({ result: { value: 1 } });
    ws.simulateMessage({ type: 'ping' });
    await vi.waitFor(() => expect(ws.sentMessages).toContain(JSON.stringify({ type: 'pong' })));
    handler.mockRejectedValueOnce(new Error('SDK failed'));
    expect(await request(ws, 'sdk_call')).toMatchObject({ error: 'SDK failed' });
    expect(client.getRetryPhase()).toBe('idle');
  });

  it.each(['wrong-proof', 'protocol', 'request-before-auth', 'invalid-json'])(
    'rejects %s before invoking the gateway',
    async (kind) => {
      const { ws, log } = start();
      const handler = vi.fn();
      client.setMessageHandler(handler);
      await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
      if (kind === 'invalid-json') ws.simulateMessage('{');
      else if (kind === 'request-before-auth')
        ws.simulateMessage({ id: 'bad', action: 'sdk_call', payload: {} });
      else
        ws.simulateMessage({
          type: 'challenge',
          protocolVersion: kind === 'protocol' ? 2 : 1,
          nonce: NONCE,
          proof: '0'.repeat(64),
        });
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      expect(handler).not.toHaveBeenCalled();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(ws.sentMessages).toHaveLength(0);
    }
  );

  it('rejects a mismatched KB and repeated request IDs', async () => {
    const { ws } = start();
    const handler = vi.fn(async () => true);
    client.setMessageHandler(handler);
    await authenticate(ws);
    const frame = {
      id: 'one',
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
      id: 'expired',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() - 1,
    });
    await vi.waitFor(() =>
      expect(ws.sentMessages.some((s) => s.includes('deadline expired'))).toBe(true)
    );
    ws.simulateMessage({
      id: 'pending',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() + 5000,
    });
    client.reconnect();
    release();
    await authenticate(MockWebSocket.instances.at(-1)!);
    expect(mutate).not.toHaveBeenCalled();
    expect(
      MockWebSocket.instances.at(-1)!.sentMessages.some((s) => s.includes('"id":"pending"'))
    ).toBe(false);
  });

  it('caps retries at 1.5 seconds, supports wakeup and cancels on shutdown', async () => {
    vi.useFakeTimers();
    MockWebSocket.mode = 'close';
    const { closed } = start();
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(1501);
    expect(client.getReconnectMetadata().lastRetryDelayMs).toBeLessThanOrEqual(1500);
    expect(closed).toHaveBeenCalled();
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

  it('waits for in-flight native work before accepting another session', async () => {
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
      id: 'slow',
      action: 'sdk_call',
      payload: {},
      knowledgeBaseId: 'test-kb',
      deadline: Date.now() + 5000,
    });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    client.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(next.readyState).toBe(MockWebSocket.OPEN));
    next.simulateMessage({
      type: 'challenge',
      protocolVersion: 1,
      nonce: NONCE,
      proof: sign(TEST_TOKEN, 'cli:' + NONCE),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(next.sentMessages).toHaveLength(0);
    release();
    await vi.waitFor(() =>
      expect(next.sentMessages.some((s) => s.includes('"type":"hello"'))).toBe(true)
    );
    expect(ws.sentMessages.some((s) => s.includes('"id":"slow"'))).toBe(false);
  });

  it('enforces byte limits for Unicode frames before dispatch', async () => {
    const { ws } = start();
    const handler = vi.fn();
    client.setMessageHandler(handler);
    await authenticate(ws);
    ws.simulateMessage(JSON.stringify({ id: 'large', payload: '\u4e2d'.repeat(3 * 1024 * 1024) }));
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.CLOSED));
    expect(handler).not.toHaveBeenCalled();
  });

  it('times out incomplete authentication without hanging retries', async () => {
    vi.useFakeTimers();
    const { ws } = start();
    await vi.advanceTimersByTimeAsync(5001);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(client.getReconnectMetadata().nextRetryAt).toBeDefined();
  });

  it('accepts only a loopback endpoint and valid HMACs', async () => {
    expect(loopbackUrl('ws://127.0.0.1:3002')).toBe('ws://127.0.0.1:3002/');
    for (const url of [
      'wss://example.com',
      'ws://localhost:3002',
      'ws://127.0.0.1/path',
      'ws://user@127.0.0.1:3002',
      'ws://127.0.0.1/?q=1',
    ])
      expect(() => loopbackUrl(url)).toThrow();
    expect(await verifyProof(TEST_TOKEN, 'test', sign(TEST_TOKEN, 'test'))).toBe(true);
    expect(await verifyProof(TEST_TOKEN, 'test', 'bad')).toBe(false);
    expect(await verifyProof(TEST_TOKEN, 'different', sign(TEST_TOKEN, 'test'))).toBe(false);
  });
});
