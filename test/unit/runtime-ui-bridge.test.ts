import { describe, expect, it, vi } from 'vitest';
import type { BridgeRuntimeSnapshot } from '../../src/bridge/runtime';
import { MockRemNotePlugin } from '../helpers/mocks';
import {
  BRIDGE_UI_COMMAND_STORAGE_KEY,
  BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
  serializeBridgeRuntimeSnapshot,
  deserializeBridgeRuntimeSnapshot,
  isSerializedBridgeRuntimeSnapshot,
  registerBridgeRuntimeUiBridge,
} from '../../src/widgets/runtime-ui-bridge';

describe('sidebar runtime channel', () => {
  it('roundtrips snapshots, handles commands once and unregisters', async () => {
    const plugin = new MockRemNotePlugin();
    const snapshot: BridgeRuntimeSnapshot = {
      status: 'connected',
      retryPhase: 'idle',
      bridgeVersion: 'test',
      pluginId: 'remnote-cli-bridge',
      protocolVersion: 1,
      sdkVersion: '0.0.46',
      wsUrl: 'ws://127.0.0.1:3002',
      logs: [{ timestamp: new Date(), message: 'Connected', level: 'info' }],
      requestCount: 1,
      reconnectAttempts: 0,
      maxReconnectAttempts: 0,
    };
    expect(deserializeBridgeRuntimeSnapshot(serializeBridgeRuntimeSnapshot(snapshot))).toEqual(
      snapshot
    );
    expect(isSerializedBridgeRuntimeSnapshot(null)).toBe(false);
    for (const invalid of [
      { status: 'connected', logs: [null] },
      { ...snapshot, requestCount: -1 },
      { ...snapshot, logs: [{ timestamp: 1, message: {}, level: 'info' }] },
    ])
      expect(isSerializedBridgeRuntimeSnapshot(invalid)).toBe(false);
    const unsubscribe = vi.fn();
    const reconnect = vi.fn(),
      nudgeReconnect = vi.fn();
    const unregister = registerBridgeRuntimeUiBridge({
      plugin: plugin as never,
      runtime: {
        getSnapshot: () => snapshot,
        subscribe: (fn) => {
          fn(snapshot);
          return unsubscribe;
        },
        reconnect,
        nudgeReconnect,
        shutdown: vi.fn(),
      },
    });
    for (const value of [
      null,
      {},
      { id: 'one', source: 'widget', kind: 'reconnect' },
      { id: 'one', source: 'widget', kind: 'reconnect' },
      { id: 'two', source: 'widget', kind: 'nudge_reconnect' },
      { id: 'three', source: 'widget', kind: 'request_snapshot' },
    ])
      await plugin.storage.setSession(BRIDGE_UI_COMMAND_STORAGE_KEY, value);
    expect(reconnect).toHaveBeenCalledOnce();
    expect(nudgeReconnect).toHaveBeenCalledOnce();
    expect(
      isSerializedBridgeRuntimeSnapshot(
        await plugin.storage.getSession(BRIDGE_UI_SNAPSHOT_STORAGE_KEY)
      )
    ).toBe(true);
    unregister();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(plugin.event.removeListener).toHaveBeenCalled();
  });
});
