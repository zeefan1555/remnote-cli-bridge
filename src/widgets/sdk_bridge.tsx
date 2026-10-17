import { renderWidget, StorageEvents, usePlugin } from '@remnote/plugin-sdk';
import React, { useEffect, useState } from 'react';
import {
  BRIDGE_UI_COMMAND_STORAGE_KEY,
  BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
  isSerializedBridgeRuntimeSnapshot,
  type SerializedBridgeRuntimeSnapshot,
} from './runtime-ui-bridge';

export function AutomationBridgeWidget() {
  const plugin = usePlugin();
  const [snapshot, setSnapshot] = useState<SerializedBridgeRuntimeSnapshot>();
  const command = (kind: 'request_snapshot' | 'reconnect') =>
    plugin.storage.setSession(BRIDGE_UI_COMMAND_STORAGE_KEY, {
      source: 'widget',
      id: crypto.randomUUID(),
      kind,
    });
  useEffect(() => {
    const receive = (value: unknown) => {
      if (isSerializedBridgeRuntimeSnapshot(value)) setSnapshot(value);
    };
    plugin.event.addListener(
      StorageEvents.StorageSessionChange,
      BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
      receive
    );
    void plugin.storage.getSession(BRIDGE_UI_SNAPSHOT_STORAGE_KEY).then(receive);
    void command('request_snapshot');
    return () =>
      plugin.event.removeListener(
        StorageEvents.StorageSessionChange,
        BRIDGE_UI_SNAPSHOT_STORAGE_KEY,
        receive
      );
  }, [plugin]);
  return (
    <main style={{ padding: 12, fontFamily: 'system-ui', fontSize: 13, overflowWrap: 'anywhere' }}>
      <h3 style={{ fontSize: 16, margin: '0 0 12px' }}>RemNote CLI Bridge</h3>
      <p role="status">{snapshot?.status === 'connected' ? 'CLI connected' : 'Waiting for CLI'}</p>
      <dl>
        <dt>Plugin ID</dt>
        <dd>{snapshot?.pluginId}</dd>
        <dt>Plugin</dt>
        <dd>{snapshot?.bridgeVersion}</dd>
        <dt>Protocol / SDK</dt>
        <dd>{snapshot ? `${snapshot.protocolVersion} / ${snapshot.sdkVersion}` : 'Not checked'}</dd>
        <dt>Knowledge base</dt>
        <dd>
          {snapshot?.knowledgeBaseId
            ? `${snapshot.knowledgeBaseName} (${snapshot.knowledgeBaseId})`
            : 'Not checked'}
        </dd>
        <dt>Endpoint</dt>
        <dd>{snapshot?.wsUrl}</dd>
        <dt>SDK calls</dt>
        <dd>{snapshot?.requestCount ?? 0}</dd>
      </dl>
      {snapshot?.authorizationError && <p role="alert">{snapshot.authorizationError}</p>}
      <button onClick={() => void command('reconnect')}>Reconnect</button>
      <ul
        aria-label="Connection log"
        style={{ paddingLeft: 18, maxHeight: 240, overflowY: 'auto' }}
      >
        {snapshot?.logs
          .slice(-10)
          .reverse()
          .map((log, index) => (
            <li key={index} style={{ color: log.level === 'error' ? '#bd2222' : 'inherit' }}>
              {log.message}
            </li>
          ))}
      </ul>
    </main>
  );
}
renderWidget(AutomationBridgeWidget);
