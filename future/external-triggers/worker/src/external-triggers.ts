import type { Env } from './env';

export const TRIGGER_TASKS = ['business_summary', 'weekly_summary', 'approval_reminder'] as const;
export type TriggerTask = typeof TRIGGER_TASKS[number];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const TRIGGER_BODY_CAP = 2048;
export const MAX_ACTIVE_TRIGGERS = 3;
export const MAX_DAILY_EVENTS = 20;
export const MAX_TRIGGER_LIFETIME_MS = 30 * 24 * 3600_000;
export const triggerPath = (id: string) => '/api/webhooks/external/' + id;
export const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const text = new TextEncoder();

/** Both switches are required. No broad enablement or wildcard tenants. */
export function triggersEnabled(env: Env, businessId: string): boolean {
  return env.EXTERNAL_TRIGGERS_ENABLED === 'true'
    && (env.EXTERNAL_TRIGGERS_BUSINESSES ?? '').split(',').map(id => id.trim()).includes(businessId);
}

export function triggerTimestamp(value: string | null, now = Date.now()): string | null {
  return value && /^[1-9][0-9]{9,10}$/.test(value) && Math.abs(Number(value) * 1000 - now) <= 300_000 ? value : null;
}

/** Raw body bytes, protocol version, method, path and freshness all signed.
 * WebCrypto verifies the MAC; never compare secret-derived strings in JS. */
export async function verifyTriggerSignature(secret: string, path: string, timestamp: string, body: string, signature: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(secret) || !/^v1=[0-9a-f]{64}$/.test(signature)) return false;
  const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, part => parseInt(part, 16));
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes(signature.slice(3)), text.encode('v1\nPOST\n' + path + '\n' + timestamp + '\n' + body));
}

export class TriggerBodyError extends Error {
  constructor(public status: number) { super('Invalid or oversized request body'); }
}

/** Measure real bytes even when Content-Length lies. Bound stalled uploads;
 * cancel without awaiting a tee cancellation (Node's clone can never settle). */
export async function readTriggerBody(request: Request): Promise<string> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')
      || request.headers.has('Content-Encoding')) throw new TriggerBodyError(415);
  const reader = request.body?.getReader();
  if (!reader) throw new TriggerBodyError(400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) {
        total += next.value.byteLength;
        if (total > TRIGGER_BODY_CAP) throw new TriggerBodyError(413);
        chunks.push(next.value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  };
  try {
    const body = await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TriggerBodyError(408)), 5000);
    })]);
    completed = true;
    return body;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!completed) void reader.cancel().catch(() => {});
  }
}
