import { FocusEvents, WindowEvents } from '@remnote/plugin-sdk';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeBridgeRuntime,
  getBridgeRuntime,
  shutdownBridgeRuntime,
} from '../../src/bridge/runtime';
import { SDK_CATALOG_HASH } from '../../src/api/sdk-capabilities.generated';
import { MockRemNotePlugin, MockWebSocket } from '../helpers/mocks';
import { authenticate, request } from '../helpers/connection';
import { ACCESS_CHECK_TTL_MS } from '../../src/bridge/access-check';

let plugin: MockRemNotePlugin;
beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  plugin = new MockRemNotePlugin();
});
afterEach(() => {
  shutdownBridgeRuntime();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  MockWebSocket.reset();
});

async function start() {
  const runtime = await initializeBridgeRuntime(plugin as never);
  const ws = MockWebSocket.instances.at(-1)!;
  await authenticate(ws);
  await vi.waitFor(() => expect(runtime.getSnapshot().status).toBe('connected'));
  return { ws, runtime };
}

describe('zero-configuration SDK runtime', () => {
  it('serves status, live catalog identity, and no business actions', async () => {
    const { ws, runtime } = await start();
    expect(await initializeBridgeRuntime(plugin as never)).toBe(runtime);
    expect(getBridgeRuntime()).toBe(runtime);
    expect(await request(ws, 'get_status')).toMatchObject({
      result: {
        connected: true,
        protocolVersion: 2,
        pluginVersion: '0.27.0',
        pluginId: 'remnote-cli-bridge',
        sdkVersion: '0.0.46',
        sdkCatalogHash: SDK_CATALOG_HASH,
        knowledgeBaseId: 'test-kb',
        knowledgeBaseName: 'Test KB',
        nativeTransactions: false,
      },
    });
    expect(runtime.getSnapshot()).toMatchObject({
      pluginId: 'remnote-cli-bridge',
      protocolVersion: 2,
      sdkVersion: '0.0.46',
      knowledgeBaseId: 'test-kb',
      wsUrl: 'ws://127.0.0.1:3002/',
    });
    expect(await request(ws, 'get_sdk_capabilities')).toMatchObject({
      result: { sdkCatalogHash: SDK_CATALOG_HASH },
    });
    expect(await request(ws, 'create_note', { title: 'Not a plugin command' })).toMatchObject({
      error: expect.stringContaining('Unknown SDK gateway action'),
    });
    expect(runtime.getSnapshot().requestCount).toBe(3);
    expect(plugin.rem.createRem).not.toHaveBeenCalled();
    expect(plugin.settings.getSetting).not.toHaveBeenCalled();
    expect(plugin.settings.registerBooleanSetting).not.toHaveBeenCalled();
    expect(plugin.settings.registerStringSetting).not.toHaveBeenCalled();
  });

  it('surfaces failed knowledge-base identity before replying ready', async () => {
    plugin.kb.getCurrentKnowledgeBaseData.mockRejectedValue(
      new Error('KnowledgeBaseInfo Read denied')
    );
    const runtime = await initializeBridgeRuntime(plugin as never);
    const ws = MockWebSocket.instances.at(-1)!;
    await vi.waitFor(() => expect(ws.readyState).toBe(MockWebSocket.OPEN));
    ws.simulateMessage({ type: 'hello', protocolVersion: 2, version: 'test-cli' });
    await vi.waitFor(() =>
      expect(runtime.getSnapshot()).toMatchObject({
        authorizationError: 'KnowledgeBaseInfo Read denied',
      })
    );
    expect(ws.sentMessages).toHaveLength(0);
    expect(plugin.rem.createRem).not.toHaveBeenCalled();
  });

  it('allows official reads and writes without bridge gates and keeps explicit destructive approval', async () => {
    const rem = plugin.addTestRem('r', 'Keep');
    const setText = vi.spyOn(rem, 'setText');
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
    ).toMatchObject({ result: { value: { $type: 'undefined' } } });
    expect(setText).toHaveBeenCalledOnce();
    expect(
      await request(ws, 'sdk_call', {
        capability: 'namespace:settings.registerBooleanSetting',
        args: [{ id: 'official-sdk-setting', title: 'Official SDK setting', defaultValue: false }],
      })
    ).toMatchObject({ result: { value: { $type: 'undefined' } } });
    expect(plugin.settings.registerBooleanSetting).toHaveBeenCalledOnce();
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

  it('stops writes after the active knowledge base changes', async () => {
    const rem = plugin.addTestRem('r', 'Keep');
    const mutate = vi.spyOn(rem, 'setText');
    const { ws } = await start();
    plugin.rem.findOne.mockImplementationOnce(async () => {
      plugin.kb.getCurrentKnowledgeBaseData.mockResolvedValue({ _id: 'other', name: 'Other' });
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + ACCESS_CHECK_TTL_MS);
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
    ).toContain('Knowledge base changed');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('keeps native transactions unavailable without blocking status or reconnection', async () => {
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

  it('nudges reconnect on native activity and unregisters listeners', async () => {
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

  it('shares one knowledge-base read across concurrent SDK calls', async () => {
    const { ws } = await start();
    plugin.addTestRem('r', 'Keep');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ACCESS_CHECK_TTL_MS + 1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    plugin.kb.getCurrentKnowledgeBaseData.mockImplementation(async () => {
      reads += 1;
      await gate;
      return { _id: 'test-kb', name: 'Test KB' };
    });
    const first = request(ws, 'sdk_call', {
      capability: 'namespace:rem.findOne',
      args: ['r'],
    });
    const second = request(ws, 'sdk_call', {
      capability: 'namespace:rem.findOne',
      args: ['r'],
    });
    await vi.waitFor(() => expect(reads).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reads).toBe(1);
    release();
    expect(await first).toMatchObject({ result: { value: { id: 'r' } } });
    expect(await second).toMatchObject({ result: { value: { id: 'r' } } });
    expect(reads).toBe(1);
  });

  it('reuses the active knowledge-base snapshot for 100ms', async () => {
    const { ws } = await start();
    plugin.addTestRem('r', 'Keep');
    let now = Date.now() + ACCESS_CHECK_TTL_MS + 1;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const read = () =>
      request(ws, 'sdk_call', { capability: 'namespace:rem.findOne', args: ['r'] });
    await read();
    const after = plugin.kb.getCurrentKnowledgeBaseData.mock.calls.length;
    await read();
    expect(plugin.kb.getCurrentKnowledgeBaseData.mock.calls.length).toBe(after);
    now += ACCESS_CHECK_TTL_MS - 1;
    await read();
    expect(plugin.kb.getCurrentKnowledgeBaseData.mock.calls.length).toBe(after);
    now += 1;
    await read();
    expect(plugin.kb.getCurrentKnowledgeBaseData.mock.calls.length).toBe(after + 1);
  });
});
