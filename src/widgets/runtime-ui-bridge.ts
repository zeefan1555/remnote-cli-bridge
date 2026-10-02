import { StorageEvents, type ReactRNPlugin } from '@remnote/plugin-sdk';
import type { BridgeRuntime, BridgeRuntimeSnapshot, LogEntry } from '../bridge/runtime';
export const BRIDGE_UI_SNAPSHOT_STORAGE_KEY = 'automation-bridge-ui-snapshot';
export const BRIDGE_UI_COMMAND_STORAGE_KEY = 'automation-bridge-ui-command';
export interface SerializedBridgeRuntimeSnapshot extends Omit<BridgeRuntimeSnapshot, 'logs'> {
  logs: Array<Omit<LogEntry, 'timestamp'> & { timestamp: number }>;
}
export type BridgeUiCommand = {
  source: 'widget';
  id: string;
  kind: 'request_snapshot' | 'reconnect' | 'nudge_reconnect';
};
export function serializeBridgeRuntimeSnapshot(
  snapshot: BridgeRuntimeSnapshot
): SerializedBridgeRuntimeSnapshot {
  return {
    ...snapshot,
    logs: snapshot.logs.map((entry) => ({ ...entry, timestamp: entry.timestamp.getTime() })),
  };
}
export function deserializeBridgeRuntimeSnapshot(
  snapshot: SerializedBridgeRuntimeSnapshot
): BridgeRuntimeSnapshot {
  return {
    ...snapshot,
    logs: snapshot.logs.map((entry) => ({ ...entry, timestamp: new Date(entry.timestamp) })),
  };
}
export function isSerializedBridgeRuntimeSnapshot(
  value: unknown
): value is SerializedBridgeRuntimeSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as SerializedBridgeRuntimeSnapshot;
  return (
    ['disconnected', 'connecting', 'connected'].includes(snapshot.status) &&
    ['idle', 'burst'].includes(snapshot.retryPhase) &&
    typeof snapshot.bridgeVersion === 'string' &&
    typeof snapshot.pluginId === 'string' &&
    Number.isSafeInteger(snapshot.protocolVersion) &&
    typeof snapshot.sdkVersion === 'string' &&
    (snapshot.authorizationError === undefined ||
      typeof snapshot.authorizationError === 'string') &&
    (snapshot.knowledgeBaseId === undefined || typeof snapshot.knowledgeBaseId === 'string') &&
    (snapshot.knowledgeBaseName === undefined || typeof snapshot.knowledgeBaseName === 'string') &&
    typeof snapshot.wsUrl === 'string' &&
    Number.isSafeInteger(snapshot.requestCount) &&
    snapshot.requestCount >= 0 &&
    Array.isArray(snapshot.logs) &&
    snapshot.logs.length <= 50 &&
    snapshot.logs.every(
      (log) =>
        log &&
        typeof log.message === 'string' &&
        Number.isFinite(log.timestamp) &&
        ['info', 'warn', 'error'].includes(log.level)
    )
  );
}
export function registerBridgeRuntimeUiBridge(config: {
  plugin: Pick<ReactRNPlugin, 'event' | 'storage'>;
  runtime: BridgeRuntime;
}): () => void {
  let lastId = '';
  const publish = (snapshot: BridgeRuntimeSnapshot) => {
    void config.plugin.storage
      .setSession(BRIDGE_UI_SNAPSHOT_STORAGE_KEY, serializeBridgeRuntimeSnapshot(snapshot))
      .catch(() => {});
  };
  const unsubscribe = config.runtime.subscribe(publish);
  const listener = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const command = value as BridgeUiCommand;
    if (command.source !== 'widget' || typeof command.id !== 'string' || command.id === lastId)
      return;
    lastId = command.id;
    if (command.kind === 'request_snapshot') publish(config.runtime.getSnapshot());
    if (command.kind === 'reconnect') config.runtime.reconnect();
    if (command.kind === 'nudge_reconnect') config.runtime.nudgeReconnect();
  };
  config.plugin.event.addListener(
    StorageEvents.StorageSessionChange,
    BRIDGE_UI_COMMAND_STORAGE_KEY,
    listener
  );
  return () => {
    unsubscribe();
    config.plugin.event.removeListener(
      StorageEvents.StorageSessionChange,
      BRIDGE_UI_COMMAND_STORAGE_KEY,
      listener
    );
  };
}
