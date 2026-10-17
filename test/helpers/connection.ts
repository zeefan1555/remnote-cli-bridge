import { createHmac } from 'node:crypto';
import { expect, vi } from 'vitest';
import { MockWebSocket } from './mocks';

export const TEST_TOKEN = 'a'.repeat(64);
export const NONCE = 'b'.repeat(64);
export const sign = (token: string, value: string) =>
  createHmac('sha256', token).update(value).digest('hex');
export async function authenticate(ws: MockWebSocket, token = TEST_TOKEN): Promise<void> {
  await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
  ws.simulateMessage({
    type: 'challenge',
    protocolVersion: 1,
    nonce: NONCE,
    proof: sign(token, 'cli:' + NONCE),
  });
  await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(0));
  const hello = JSON.parse(ws.sentMessages[0]);
  expect(hello.type).toBe('hello');
  expect(hello.identity.pluginId).toBeUndefined();
  expect(hello.proof).toBe(sign(token, 'plugin:' + NONCE + ':' + JSON.stringify(hello.identity)));
  expect(JSON.stringify(hello)).not.toContain(token);
  ws.simulateMessage({ type: 'ready', protocolVersion: 1, version: 'arbitrary-cli-version' });
}
let requestId = 0;
export async function request(
  ws: MockWebSocket,
  action: string,
  payload: Record<string, unknown> = {}
) {
  const id = String(++requestId);
  ws.simulateMessage({
    id,
    action,
    payload,
    knowledgeBaseId: 'test-kb',
    deadline: Date.now() + 15_000,
  });
  let response: { id: string; result?: unknown; error?: string } | undefined;
  await vi.waitFor(() => {
    response = ws.sentMessages.map((s) => JSON.parse(s)).find((r) => r.id === id);
    expect(response).toBeDefined();
  });
  return response!;
}
