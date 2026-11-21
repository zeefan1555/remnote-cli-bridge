import { expect, vi } from 'vitest';
import { MockWebSocket } from './mocks';

export async function authenticate(ws: MockWebSocket, version = 'test-cli'): Promise<void> {
  await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
  ws.simulateMessage({ type: 'hello', protocolVersion: 2, version });
  await vi.waitFor(() => expect(ws.sentMessages.length).toBeGreaterThan(0));
  const ready = JSON.parse(ws.sentMessages[0]);
  expect(ready).toMatchObject({
    type: 'ready',
    protocolVersion: 2,
    identity: {
      pluginVersion: expect.any(String),
      sdkVersion: '0.0.46',
      sdkCatalogHash: expect.any(String),
      knowledgeBaseId: 'test-kb',
      knowledgeBaseName: expect.any(String),
    },
  });
  expect(ready.identity.pluginId).toBeUndefined();
  expect(ready.identity.acceptWriteOperations).toBeUndefined();
  expect(ready.identity.acceptReplaceOperation).toBeUndefined();
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
