export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const TRANSACTION_TIMEOUT_MS = 10_000;

export async function signProof(token: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

export async function verifyProof(
  token: string,
  message: string,
  proof: unknown
): Promise<boolean> {
  if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signature = Uint8Array.from(proof.match(/../g)!, (byte) => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(message));
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
