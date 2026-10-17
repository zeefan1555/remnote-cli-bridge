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
export const MAX_CONCURRENT_REQUESTS = 16;

class SessionSuperseded extends Error {
  constructor() {
    super('Session closed; do not replay writes');
    this.name = 'SessionSuperseded';
  }
}

interface SlotWaiter {
  grant: () => void;
  cancel: () => void;
}

export interface WebSocketClientConfig {
  url: string;
  pluginVersion: string;
  getToken: () => Promise<string>;
  getIdentity: () => Promise<BridgeIdentity>;
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
  // Ordered frames stay on this chain. Native SDK calls cannot be cancelled, so a
  // new session waits until the previous socket's calls settle.
  private queue = Promise.resolve();
  private inFlight = 0;
  private readonly slotWaiters: SlotWaiter[] = [];
  private readonly sessionWork = new Map<WebSocket, Set<Promise<void>>>();
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
    const session = {
      authenticated: false,
      challenged: false,
      identity: undefined as BridgeIdentity | undefined,
      seen: new Set<string>(),
    };
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
        .then(() => this.handleFrame(ws, event, session, current))
        .catch((error) => {
          this.config.onLog?.(error instanceof Error ? error.message : String(error), 'error');
          ws.close(4008, 'Protocol or authentication failure');
        });
    };
    ws.onclose = (event) => {
      // A late close from the previous socket must not cancel the new session's queue.
      if (this.ws === ws) this.cancelQueued();
      if (this.ws !== ws) return;
      clearTimeout(this.handshakeTimer);
      this.ws = null;
      this.lastDisconnectReason = event.reason || String(event.code);
      this.config.onCompanionInfoChange?.(undefined);
      this.setStatus('disconnected');
      if (!this.stopped) this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* close schedules the next bounded retry */
    };
  }

  private async handleFrame(
    ws: WebSocket,
    event: MessageEvent,
    session: {
      authenticated: boolean;
      challenged: boolean;
      identity?: BridgeIdentity;
      seen: Set<string>;
    },
    current: () => void
  ): Promise<void> {
    await this.waitForOtherSessions(ws);
    current();
    if (
      typeof event.data !== 'string' ||
      new TextEncoder().encode(event.data).byteLength > MAX_MESSAGE_BYTES
    )
      throw new Error('Invalid or oversized frame');
    const message = JSON.parse(event.data);
    if (!message || typeof message !== 'object') throw new Error('Invalid frame');
    if (message.type === 'challenge' && !session.challenged) {
      session.challenged = true;
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
      session.identity = await this.config.getIdentity();
      const hello = {
        protocolVersion: PROTOCOL_VERSION,
        pluginVersion: this.config.pluginVersion,
        sdkVersion: REMNOTE_SDK_VERSION,
        sdkCatalogHash: SDK_CATALOG_HASH,
        ...session.identity,
      };
      const proof = await signProof(token, 'plugin:' + message.nonce + ':' + JSON.stringify(hello));
      current();
      ws.send(JSON.stringify({ type: 'hello', identity: hello, proof }));
      return;
    }
    if (
      message.type === 'ready' &&
      session.challenged &&
      session.identity &&
      !session.authenticated
    ) {
      if (message.protocolVersion !== PROTOCOL_VERSION) throw new Error('Protocol mismatch');
      session.authenticated = true;
      clearTimeout(this.handshakeTimer);
      this.attempts = 0;
      current();
      this.setStatus('connected');
      this.config.onCompanionInfoChange?.({ kind: 'cli', version: String(message.version) });
      return;
    }
    if (!session.authenticated || !session.identity) throw new Error('Authentication required');
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
      message.knowledgeBaseId !== session.identity.knowledgeBaseId ||
      session.seen.has(message.id) ||
      session.seen.size >= 20_000
    )
      throw new Error('Invalid request, KB binding or duplicate request ID');
    session.seen.add(message.id);
    const assertSession = () => {
      current();
      if (Date.now() >= message.deadline)
        throw new Error('Request deadline expired; verify write outcome');
    };
    this.dispatchRequest(ws, message as BridgeRequest, assertSession);
  }

  private canSend(ws: WebSocket): boolean {
    return this.ws === ws && ws.readyState === WebSocket.OPEN && !this.stopped;
  }

  private async waitForOtherSessions(ws: WebSocket): Promise<void> {
    for (;;) {
      const pending = [...this.sessionWork.entries()]
        .filter(([socket]) => socket !== ws)
        .flatMap(([, jobs]) => [...jobs]);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  private dispatchRequest(ws: WebSocket, message: BridgeRequest, assertSession: () => void): void {
    const work = this.runRequest(ws, message, assertSession);
    let jobs = this.sessionWork.get(ws);
    if (!jobs) {
      jobs = new Set();
      this.sessionWork.set(ws, jobs);
    }
    jobs.add(work);
    void work.finally(() => {
      jobs.delete(work);
      if (jobs.size === 0 && this.sessionWork.get(ws) === jobs) this.sessionWork.delete(ws);
    });
  }

  private acquireSlot(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT_REQUESTS && this.slotWaiters.length === 0) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.slotWaiters.push({
        grant: () => {
          this.inFlight += 1;
          resolve();
        },
        cancel: () => reject(new SessionSuperseded()),
      });
    });
  }

  private releaseSlot(): void {
    this.inFlight -= 1;
    const next = this.slotWaiters.shift();
    if (next) next.grant();
  }

  private cancelQueued(): void {
    const waiting = this.slotWaiters.splice(0);
    for (const waiter of waiting) waiter.cancel();
  }

  private async runRequest(
    ws: WebSocket,
    message: BridgeRequest,
    assertSession: () => void
  ): Promise<void> {
    let acquired = false;
    try {
      await this.acquireSlot();
      acquired = true;
      if (!this.canSend(ws)) return;
      assertSession();
      if (!this.handler) throw new Error('SDK gateway unavailable');
      const result = await this.handler(message, assertSession);
      assertSession();
      const response = JSON.stringify({ id: message.id, result });
      if (new TextEncoder().encode(response).byteLength > MAX_MESSAGE_BYTES)
        throw new Error('SDK response too large');
      if (!this.canSend(ws)) return;
      ws.send(response);
    } catch (error) {
      if (error instanceof SessionSuperseded || !this.canSend(ws)) return;
      try {
        ws.send(
          JSON.stringify({
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      } catch {
        // One failed error frame must not close the socket for other requests.
      }
    } finally {
      if (acquired) this.releaseSlot();
    }
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
    const ws = this.ws;
    this.ws = null;
    this.cancelQueued();
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
