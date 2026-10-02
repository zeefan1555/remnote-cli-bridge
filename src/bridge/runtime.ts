declare const __PLUGIN_VERSION__: string;
import { FocusEvents, WindowEvents, type ReactRNPlugin } from '@remnote/plugin-sdk';
import manifest from '../../public/manifest.json';
import { REMNOTE_SDK_VERSION, SDK_CATALOG_HASH } from '../api/sdk-capabilities.generated';
import { executeSdkCall, getSdkCapabilities, type SdkCallParams } from '../api/sdk-executor';
import { readAutomationBridgeSettings, type AutomationBridgeSettings } from '../settings';
import {
  WebSocketClient,
  type ConnectionStatus,
  type RetryPhase,
  type CompanionInfo,
} from './websocket-client';
import { PROTOCOL_VERSION } from './protocol';
import { TransactionScope } from './transaction';
import { registerBridgeRuntimeUiBridge } from '../widgets/runtime-ui-bridge';

export interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error';
}
export interface BridgeRuntimeSnapshot {
  status: ConnectionStatus;
  retryPhase: RetryPhase;
  bridgeVersion: string;
  pluginId: string;
  protocolVersion: number;
  sdkVersion: string;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  authorizationError?: string;
  wsUrl: string;
  logs: LogEntry[];
  companion?: CompanionInfo;
  requestCount: number;
  lastConnectedAt?: number;
  lastDisconnectReason?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  nextRetryAt?: number;
  lastRetryDelayMs?: number;
}
export interface BridgeRuntime {
  getSnapshot(): BridgeRuntimeSnapshot;
  subscribe(listener: (snapshot: BridgeRuntimeSnapshot) => void): () => void;
  reconnect(reason?: string): void;
  nudgeReconnect(reason?: string): void;
  shutdown(): void;
}
export const MAX_LOGS = 50;

class BridgeRuntimeController implements BridgeRuntime {
  private client!: WebSocketClient;
  private transaction: TransactionScope;
  private sessionToken = '';
  private companion?: CompanionInfo;
  private lastConnectedAt?: number;
  private logs: LogEntry[] = [];
  private requestCount = 0;
  private knowledgeBase?: { _id: string; name: string };
  private authorizationError?: string;
  private readonly listeners = new Set<(snapshot: BridgeRuntimeSnapshot) => void>();
  private readonly cleanup: Array<() => void> = [];
  private stopped = false;

  constructor(
    private readonly plugin: ReactRNPlugin,
    private settings: AutomationBridgeSettings
  ) {
    this.transaction = new TransactionScope(plugin);
    this.client = new WebSocketClient({
      url: settings.wsUrl,
      pluginVersion: __PLUGIN_VERSION__,
      getToken: async () => {
        this.sessionToken = (await readAutomationBridgeSettings(plugin)).pairingToken;
        return this.sessionToken;
      },
      getIdentity: () => this.identity(),
      onSessionClosed: () => this.transaction.abort(),
      onSessionReady: async () => {
        await this.transaction.close();
        this.transaction = new TransactionScope(plugin);
      },
      onStatusChange: (status) => {
        if (status === 'connected') this.lastConnectedAt = Date.now();
        this.emit();
      },
      onCompanionInfoChange: (info) => {
        this.companion = info;
        this.emit();
      },
      onLog: (message, level) => {
        this.logs = [
          ...this.logs,
          {
            timestamp: new Date(),
            message: message.replace(/[a-f0-9]{64}/gi, '[redacted]'),
            level,
          },
        ].slice(-MAX_LOGS);
        this.emit();
      },
    });
    this.client.setMessageHandler(async (request, assertSession) => {
      const authorize = async (mode: 'read' | 'write' | 'interactive' | 'destructive') => {
        assertSession();
        this.transaction.assertUsable();
        const [settings, kb] = await Promise.all([
          readAutomationBridgeSettings(plugin),
          this.readKnowledgeBase(),
        ]);
        assertSession();
        this.transaction.assertUsable();
        if (settings.pairingToken !== this.sessionToken)
          throw new Error('Pairing changed; start a new session');
        if (kb?._id !== request.knowledgeBaseId)
          throw new Error('Knowledge base changed; writes stopped');
        if (mode !== 'read' && !settings.acceptWriteOperations)
          throw new Error('Write operations are disabled');
        if (mode === 'destructive' && !settings.acceptReplaceOperation)
          throw new Error('Destructive operations are disabled');
      };
      await authorize('read');
      this.requestCount++;
      this.emit();
      switch (request.action) {
        case 'get_status':
          return {
            connected: true,
            protocolVersion: PROTOCOL_VERSION,
            pluginVersion: __PLUGIN_VERSION__,
            pluginId: manifest.id,
            sdkVersion: REMNOTE_SDK_VERSION,
            sdkCatalogHash: SDK_CATALOG_HASH,
            ...(await this.identity()),
          };
        case 'get_sdk_capabilities':
          return getSdkCapabilities();
        case 'sdk_call':
          return executeSdkCall(plugin, authorize, request.payload as unknown as SdkCallParams);
        case 'transaction_begin':
          await authorize('write');
          await this.transaction.begin();
          return { started: true };
        case 'transaction_end':
          if (typeof request.payload.commit !== 'boolean')
            throw new Error('Transaction commit must be boolean');
          await authorize(request.payload.commit ? 'write' : 'read');
          await this.transaction.end(request.payload.commit);
          return { committed: request.payload.commit };
        default:
          throw new Error('Unknown SDK gateway action: ' + request.action);
      }
    });
  }
  private async readKnowledgeBase() {
    try {
      const kb = await this.plugin.kb.getCurrentKnowledgeBaseData();
      if (!kb?._id) throw new Error('KnowledgeBaseInfo Read permission is required');
      this.knowledgeBase = kb;
      this.authorizationError = undefined;
      this.emit();
      return kb;
    } catch (error) {
      this.knowledgeBase = undefined;
      this.authorizationError = (error instanceof Error ? error.message : String(error)).replace(
        /[a-f0-9]{64}/gi,
        '[redacted]'
      );
      this.emit();
      throw error;
    }
  }
  private async identity() {
    const [settings, kb] = await Promise.all([
      readAutomationBridgeSettings(this.plugin),
      this.readKnowledgeBase(),
    ]);
    return {
      knowledgeBaseId: kb._id,
      knowledgeBaseName: kb.name,
      acceptWriteOperations: settings.acceptWriteOperations,
      acceptReplaceOperation: settings.acceptReplaceOperation,
    };
  }
  start(): void {
    this.cleanup.push(registerBridgeRuntimeUiBridge({ plugin: this.plugin, runtime: this }));
    for (const event of [FocusEvents.FocusedRemChange, WindowEvents.FocusedPaneChange]) {
      const callback = () => this.nudgeReconnect('activity');
      this.plugin.event.addListener(event, undefined, callback);
      this.cleanup.push(() => this.plugin.event.removeListener(event, undefined, callback));
    }
    if (typeof window !== 'undefined') {
      const wake = () => this.nudgeReconnect('focus');
      window.addEventListener('focus', wake);
      window.addEventListener('online', wake);
      document.addEventListener('visibilitychange', wake);
      this.cleanup.push(() => {
        window.removeEventListener('focus', wake);
        window.removeEventListener('online', wake);
        document.removeEventListener('visibilitychange', wake);
      });
    }
    this.client.connect();
  }
  getSnapshot(): BridgeRuntimeSnapshot {
    return {
      status: this.client?.getStatus() ?? 'disconnected',
      retryPhase: this.client?.getRetryPhase() ?? 'idle',
      bridgeVersion: __PLUGIN_VERSION__,
      pluginId: manifest.id,
      protocolVersion: PROTOCOL_VERSION,
      sdkVersion: REMNOTE_SDK_VERSION,
      knowledgeBaseId: this.knowledgeBase?._id,
      knowledgeBaseName: this.knowledgeBase?.name,
      authorizationError: this.authorizationError,
      wsUrl: this.settings.wsUrl,
      logs: [...this.logs],
      companion: this.companion,
      requestCount: this.requestCount,
      lastConnectedAt: this.lastConnectedAt,
      ...this.client.getReconnectMetadata(),
    };
  }
  subscribe(listener: (snapshot: BridgeRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    if (this.client) this.listeners.forEach((listener) => listener(this.getSnapshot()));
  }
  reconnect(_reason?: string): void {
    if (!this.stopped) this.client.reconnect();
  }
  nudgeReconnect(reason = 'activity'): void {
    if (!this.stopped) this.client.nudgeReconnect(reason);
  }
  shutdown(): void {
    this.stopped = true;
    this.transaction.abort();
    this.client.disconnect();
    this.cleanup.forEach((f) => f());
    this.listeners.clear();
  }
}
let runtime: BridgeRuntimeController | null = null;
export async function initializeBridgeRuntime(plugin: ReactRNPlugin): Promise<BridgeRuntime> {
  if (!runtime) {
    runtime = new BridgeRuntimeController(plugin, await readAutomationBridgeSettings(plugin));
    runtime.start();
  }
  return runtime;
}
export function getBridgeRuntime(): BridgeRuntime | null {
  return runtime;
}
export function shutdownBridgeRuntime(): void {
  runtime?.shutdown();
  runtime = null;
}
