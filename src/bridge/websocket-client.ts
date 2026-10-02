import { REMNOTE_SDK_VERSION, SDK_CATALOG_HASH } from '../api/sdk-capabilities.generated';
import {
  loopbackUrl,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  signProof,
  verifyProof,
} from './protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type RetryPhase = 'idle' | 'burst';
export interface CompanionInfo {
  kind: 'cli';
  version: string;
}
export interface ReconnectMetadata {
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  nextRetryAt?: number;
  lastRetryDelayMs?: number;
  lastDisconnectReason?: string;
}
export interface BridgeRequest {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  knowledgeBaseId: string;
  deadline: number;
}
export interface BridgeIdentity {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  acceptWriteOperations: boolean;
  acceptReplaceOperation: boolean;
}
export interface WebSocketClientConfig {
  url: string;
  pluginVersion: string;
  getToken: () => Promise<string>;
  getIdentity: () => Promise<BridgeIdentity>;
  onSessionClosed?: () => void;
  onSessionReady?: () => void | Promise<void>;
  onStatusChange?: (status: ConnectionStatus) => void;
  onRetryPhaseChange?: (phase: RetryPhase) => void;
  onCompanionInfoChange?: (info: CompanionInfo | undefined) => void;
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void;
}
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;
  private status: ConnectionStatus = 'disconnected';
  private nextRetryAt?: number;
  private lastDisconnectReason?: string;
  // Native SDK calls cannot be cancelled. A new session waits for the old call to settle.
  private queue = Promise.resolve();
  private handler?: (request: BridgeRequest, assertSession: () => void) => Promise<unknown>;
  constructor(private readonly config: WebSocketClientConfig) {
    loopbackUrl(config.url);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.config.onStatusChange?.(status);
    this.config.onRetryPhaseChange?.(status === 'connected' || this.stopped ? 'idle' : 'burst');
  }

  connect(): void {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;
    this.stopped = false;
    clearTimeout(this.retry);
    this.nextRetryAt = undefined;
    this.setStatus('connecting');
    const ws = new WebSocket(loopbackUrl(this.config.url));
    this.ws = ws;
    let authenticated = false;
    let challenged = false;
    let identity: BridgeIdentity | undefined;
    const seen = new Set<string>();
    const current = () => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN || this.stopped)
        throw new Error('Session closed; do not replay writes');
    };
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.handshakeTimer = setTimeout(() => ws.close(4008, 'Authentication timeout'), 5000);
    };
    ws.onmessage = (event) => {
      this.queue = this.queue
        .then(async () => {
          current();
          if (
            typeof event.data !== 'string' ||
            new TextEncoder().encode(event.data).byteLength > MAX_MESSAGE_BYTES
          )
            throw new Error('Invalid or oversized frame');
          const message = JSON.parse(event.data);
          if (!message || typeof message !== 'object') throw new Error('Invalid frame');
          if (message.type === 'challenge' && !challenged) {
            challenged = true;
            if (
              message.protocolVersion !== PROTOCOL_VERSION ||
              typeof message.nonce !== 'string' ||
              !/^[a-f0-9]{64}$/.test(message.nonce)
            )
              throw new Error('Protocol mismatch');
            const token = await this.config.getToken();
            if (
              !/^[a-f0-9]{64}$/.test(token) ||
              !(await verifyProof(token, 'cli:' + message.nonce, message.proof))
            )
              throw new Error('CLI authentication failed');
            current();
            identity = await this.config.getIdentity();
            const hello = {
              protocolVersion: PROTOCOL_VERSION,
              pluginVersion: this.config.pluginVersion,
              sdkVersion: REMNOTE_SDK_VERSION,
              sdkCatalogHash: SDK_CATALOG_HASH,
              ...identity,
            };
            const proof = await signProof(
              token,
              'plugin:' + message.nonce + ':' + JSON.stringify(hello)
            );
            current();
            ws.send(JSON.stringify({ type: 'hello', identity: hello, proof }));
            return;
          }
          if (message.type === 'ready' && challenged && identity && !authenticated) {
            if (message.protocolVersion !== PROTOCOL_VERSION) throw new Error('Protocol mismatch');
            authenticated = true;
            clearTimeout(this.handshakeTimer);
            this.attempts = 0;
            await this.config.onSessionReady?.();
            current();
            this.setStatus('connected');
            this.config.onCompanionInfoChange?.({ kind: 'cli', version: String(message.version) });
            return;
          }
          if (!authenticated || !identity) throw new Error('Authentication required');
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          if (
            typeof message.id !== 'string' ||
            message.id.length > 128 ||
            typeof message.action !== 'string' ||
            !message.payload ||
            typeof message.payload !== 'object' ||
            Array.isArray(message.payload) ||
            !Number.isSafeInteger(message.deadline) ||
            message.deadline > Date.now() + 65_000 ||
            message.knowledgeBaseId !== identity.knowledgeBaseId ||
            seen.has(message.id) ||
            seen.size >= 20_000
          )
            throw new Error('Invalid request, KB binding or duplicate request ID');
          seen.add(message.id);
          const assertSession = () => {
            current();
            if (Date.now() >= message.deadline)
              throw new Error('Request deadline expired; verify write outcome');
          };
          try {
            assertSession();
            if (!this.handler) throw new Error('SDK gateway unavailable');
            const result = await this.handler(message, assertSession);
            assertSession();
            const response = JSON.stringify({ id: message.id, result });
            if (new TextEncoder().encode(response).byteLength > MAX_MESSAGE_BYTES)
              throw new Error('SDK response too large');
            ws.send(response);
          } catch (error) {
            if (this.ws === ws && ws.readyState === WebSocket.OPEN)
              ws.send(
                JSON.stringify({
                  id: message.id,
                  error: error instanceof Error ? error.message : String(error),
                })
              );
          }
        })
        .catch((error) => {
          this.config.onLog?.(error instanceof Error ? error.message : String(error), 'error');
          ws.close(4008, 'Protocol or authentication failure');
        });
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      clearTimeout(this.handshakeTimer);
      this.ws = null;
      this.config.onSessionClosed?.();
      this.lastDisconnectReason = event.reason || String(event.code);
      this.config.onCompanionInfoChange?.(undefined);
      this.setStatus('disconnected');
      if (!this.stopped) this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* close schedules the next bounded retry */
    };
  }

  private scheduleReconnect(): void {
    clearTimeout(this.retry);
    const delay = Math.min(250 * 2 ** Math.min(this.attempts++, 3), 1500);
    this.nextRetryAt = Date.now() + delay;
    this.retry = setTimeout(() => this.connect(), delay);
  }

  setMessageHandler(
    handler: (request: BridgeRequest, assertSession: () => void) => Promise<unknown>
  ): void {
    this.handler = handler;
  }
  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.handshakeTimer);
    this.config.onSessionClosed?.();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'Command session ended');
    this.nextRetryAt = undefined;
    this.config.onCompanionInfoChange?.(undefined);
    this.setStatus('disconnected');
  }
  reconnect(): void {
    this.disconnect();
    this.attempts = 0;
    this.connect();
  }
  nudgeReconnect(_reason: string): void {
    if (this.status === 'disconnected' && !this.stopped) this.connect();
  }
  getStatus(): ConnectionStatus {
    return this.status;
  }
  getRetryPhase(): RetryPhase {
    return this.status === 'connected' || this.stopped ? 'idle' : 'burst';
  }
  getReconnectMetadata(): ReconnectMetadata {
    return {
      reconnectAttempts: this.attempts,
      maxReconnectAttempts: 0,
      nextRetryAt: this.nextRetryAt,
      lastRetryDelayMs: this.nextRetryAt ? Math.max(0, this.nextRetryAt - Date.now()) : undefined,
      lastDisconnectReason: this.lastDisconnectReason,
    };
  }
}
