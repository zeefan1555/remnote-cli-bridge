import { FocusEvents, WindowEvents } from '@remnote/plugin-sdk';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeBridgeRuntime,
  getBridgeRuntime,
  shutdownBridgeRuntime,
} from '../../src/bridge/runtime';
import { SDK_CATALOG_HASH } from '../../src/api/sdk-capabilities.generated';
import { MockRemNotePlugin, MockWebSocket } from '../helpers/mocks';
import { authenticate, request, TEST_TOKEN, NONCE, sign } from '../helpers/connection';
import {
  SETTING_PAIRING_TOKEN,
  SETTING_ACCEPT_WRITE_OPERATIONS,
  SETTING_ACCEPT_REPLACE_OPERATION,
} from '../../src/settings';

let plugin: MockRemNotePlugin;
beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  plugin = new MockRemNotePlugin();
  plugin.setTestSetting(SETTING_PAIRING_TOKEN, TEST_TOKEN);
});
afterEach(() => {
  shutdownBridgeRuntime();
  vi.unstubAllGlobals();
  MockWebSocket.reset();
});
async function start() {
  const runtime = await initializeBridgeRuntime(plugin as never);
  const ws = MockWebSocket.instances.at(-1)!;
  await authenticate(ws);
  await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe('connected'));
  return { ws, runtime };
}
describe('SDK-only runtime', () => {
  it('serves status and the generated catalog without the sidebar or business handlers', async () => {
    const { ws, runtime } = await start();
    expect(await initializeBridgeRuntime(plugin as never)).toBe(runtime);
    expect(getBridgeRuntime()).toBe(runtime);
    expect(await request(ws, 'get_status')).toMatchObject({
      result: {
        connected: true,
        protocolVersion: 1,
        pluginId: 'zeefan-remnote-sdk-bridge',
        sdkVersion: '0.0.46',
        knowledgeBaseId: 'test-kb',
        acceptWriteOperations: false,
      },
    });
    expect(runtime.getSnapshot()).toMatchObject({
      pluginId: 'zeefan-remnote-sdk-bridge',
      protocolVersion: 1,
      sdkVersion: '0.0.46',
      knowledgeBaseId: 'test-kb',
    });
    expect(await request(ws, 'get_sdk_capabilities')).toMatchObject({
      result: { sdkCatalogHash: SDK_CATALOG_HASH },
    });
    expect(await request(ws, 'create_note', { title: 'Not a plugin command' })).toMatchObject({
      error: expect.stringContaining('Unknown SDK gateway action'),
    });
    expect(runtime.getSnapshot().requestCount).toBe(3);
    expect(plugin.rem.createRem).not.toHaveBeenCalled();
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);
    unsubscribe();
    const count = listener.mock.calls.length;
    runtime.reconnect();
    expect(listener).toHaveBeenCalledTimes(count);
    shutdownBridgeRuntime();
    expect(getBridgeRuntime()).toBeNull();
    expect(plugin.event.removeListener).toHaveBeenCalled();
  });

  it('surfaces failed native authorization without exposing the pairing secret', async () => {
    plugin.kb.getCurrentKnowledgeBaseData.mockRejectedValue(
      new Error('KnowledgeBaseInfo Read denied')
    );
    const runtime = await initializeBridgeRuntime(plugin as never);
    const ws = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
    ws.simulateMessage({
      type: 'challenge',
      protocolVersion: 1,
      nonce: NONCE,
      proof: sign(TEST_TOKEN, 'cli:' + NONCE),
    });
    await vi.waitFor(() =>
      expect(runtime.getSnapshot()).toMatchObject({
        authorizationError: 'KnowledgeBaseInfo Read denied',
      })
    );
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain(TEST_TOKEN);
    expect(ws.sentMessages).toHaveLength(0);
    expect(plugin.rem.createRem).not.toHaveBeenCalled();
  });

  it('allows reads while writes are disabled and requires both destructive gates', async () => {
    const rem = plugin.addTestRem('r', 'Keep');
    const remove = vi.spyOn(rem, 'remove');
    const { ws } = await start();
    expect(
      await request(ws, 'sdk_call', { capability: 'namespace:rem.findOne', args: ['r'] })
    ).toMatchObject({ result: { value: { id: 'r' } } });
    expect(
      await request(ws, 'sdk_call', {
        capability: 'rem:setText',
        targetId: 'r',
        args: [['Changed']],
      })
    ).toMatchObject({ error: expect.stringContaining('Write operations are disabled') });
    plugin.setTestSetting(SETTING_ACCEPT_WRITE_OPERATIONS, true);
    expect(
      await request(ws, 'sdk_call', {
        capability: 'rem:remove',
        targetId: 'r',
        allowDestructive: true,
      })
    ).toMatchObject({ error: expect.stringContaining('Destructive operations are disabled') });
    plugin.setTestSetting(SETTING_ACCEPT_REPLACE_OPERATION, true);
    expect(
      await request(ws, 'sdk_call', { capability: 'rem:remove', targetId: 'r' })
    ).toMatchObject({ error: expect.stringContaining('allowDestructive=true') });
    expect(remove).not.toHaveBeenCalled();
    expect(
      await request(ws, 'sdk_call', {
        capability: 'rem:remove',
        targetId: 'r',
        allowDestructive: true,
      })
    ).toMatchObject({ result: { value: { $type: 'undefined' } } });
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each(['write', 'kb', 'pairing'])(
    'rechecks %s after awaited target resolution',
    async (change) => {
      plugin.setTestSetting(SETTING_ACCEPT_WRITE_OPERATIONS, true);
      const rem = plugin.addTestRem('r', 'Keep');
      const mutate = vi.spyOn(rem, 'setText');
      const { ws } = await start();
      plugin.rem.findOne.mockImplementationOnce(async () => {
        if (change === 'write') plugin.setTestSetting(SETTING_ACCEPT_WRITE_OPERATIONS, false);
        if (change === 'kb')
          plugin.kb.getCurrentKnowledgeBaseData.mockResolvedValue({ _id: 'other', name: 'Other' });
        if (change === 'pairing') plugin.setTestSetting(SETTING_PAIRING_TOKEN, 'c'.repeat(64));
        return rem;
      });
      expect(
        (
          await request(ws, 'sdk_call', {
            capability: 'rem:setText',
            targetId: 'r',
            args: [['Changed']],
          })
        ).error
      ).toBeDefined();
      expect(mutate).not.toHaveBeenCalled();
    }
  );

  it('rejects unsafe native scopes without blocking status or reconnection', async () => {
    plugin.setTestSetting(SETTING_ACCEPT_WRITE_OPERATIONS, true);
    const { ws, runtime } = await start();
    for (const action of ['transaction_begin', 'transaction_end']) {
      expect(await request(ws, action, { commit: false })).toMatchObject({
        error: expect.stringContaining('Native transactions are unavailable'),
      });
    }
    expect(plugin.app.transaction).not.toHaveBeenCalled();
    expect(await request(ws, 'get_status')).toMatchObject({
      result: { connected: true, nativeTransactions: false },
    });
    runtime.reconnect();
    const next = MockWebSocket.instances.at(-1)!;
    await authenticate(next);
    expect(await request(next, 'get_status')).toMatchObject({ result: { connected: true } });
    runtime.shutdown();
    runtime.reconnect();
    runtime.nudgeReconnect();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('nudges reconnect on native activity and unregisters all listeners', async () => {
    const { ws, runtime } = await start();
    ws.close(1000, 'Idle');
    plugin.emitEvent(FocusEvents.FocusedRemChange, {});
    expect(MockWebSocket.instances).toHaveLength(2);
    plugin.emitEvent(WindowEvents.FocusedPaneChange, {});
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    runtime.shutdown();
    expect(plugin.event.removeListener).toHaveBeenCalledWith(
      FocusEvents.FocusedRemChange,
      undefined,
      expect.any(Function)
    );
  });
});
