export const PROTOCOL_VERSION = 2;
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const BRIDGE_WEBSOCKET_URL = 'ws://127.0.0.1:3002/';

/** Canonical positive safe integers let one high-water mark identify replay. */
export function requestSequence(id: unknown): number {
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,15}$/.test(id))
    throw new Error('Invalid request ID');
  const sequence = Number(id);
  if (!Number.isSafeInteger(sequence)) throw new Error('Invalid request ID');
  return sequence;
}

export function loopbackUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Bridge URL must be ws://127.0.0.1:<port>');
  }
  return url.toString();
}

export function fixedBridgeUrl(value = BRIDGE_WEBSOCKET_URL): string {
  const normalized = loopbackUrl(value);
  if (normalized !== BRIDGE_WEBSOCKET_URL) {
    throw new Error(`Bridge URL must be ${BRIDGE_WEBSOCKET_URL}`);
  }
  return normalized;
}
