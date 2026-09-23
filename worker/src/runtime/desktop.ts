import type { Env } from '../env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Match the browser's ten-minute idle-control window. The runner continues
// validating the live lease throughout the connection; this only reduces the
// forced session-auth renewal interruption.
export const DESKTOP_TTL_MS = 10 * 60_000;
export const LEGACY_DESKTOP_TTL_MS = 60_000;

/** Deliberately no wildcard / fleet-wide default during the desktop pilot. */
export function desktopEnabledFor(env: Env, businessId: string): boolean {
  const ids = (env.DESKTOP_VIEW_BUSINESS_IDS ?? '').split(',').map(id => id.trim());
  return env.DESKTOP_VIEW_ENABLED === 'true' && UUID.test(businessId) &&
    ids.length <= 10 && ids.every(id => UUID.test(id)) && ids.includes(businessId);
}

async function sign<T extends object>(runnerKey: string, payload: T) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(runnerKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(payload))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { ...payload, signature };
}

export async function desktopTicket(runnerKey: string, businessId: string, ownerId: string, controlId: string,
  ttlMs: typeof DESKTOP_TTL_MS | typeof LEGACY_DESKTOP_TTL_MS = DESKTOP_TTL_MS) {
  if (ttlMs !== DESKTOP_TTL_MS && ttlMs !== LEGACY_DESKTOP_TTL_MS) throw new Error('Invalid desktop ticket lifetime');
  const issuedAt = Date.now();
  return sign(runnerKey, { purpose: 'jentera-desktop-v1', businessId, ownerId, controlId,
    nonce: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + ttlMs });
}

/** Watching the agent work. A different purpose, inside the signed payload,
 * so the runner's two validators can refuse each other's tickets. It names the
 * run being watched and deliberately carries no control lease: an observer
 * commands nothing, and the runner refuses a ticket that claims otherwise. */
export async function desktopObserveTicket(runnerKey: string, businessId: string, ownerId: string, runId: string,
  ttlMs: typeof DESKTOP_TTL_MS = DESKTOP_TTL_MS) {
  if (ttlMs !== DESKTOP_TTL_MS) throw new Error('Invalid desktop ticket lifetime');
  const issuedAt = Date.now();
  return sign(runnerKey, { purpose: 'jentera-desktop-observe-v1', businessId, ownerId, runId,
    nonce: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + ttlMs });
}

/** Not a secret; only selects an existing, explicitly acquired window lease.
 * No tickets or credentials in query strings, proxy headers or browser URLs. */
function subprotocol(protocol: string | null, prefix: string): string | null {
  const parts = (protocol ?? '').split(',').map(value => value.trim());
  if (parts.length !== 2 || parts[0] !== 'binary' || !parts[1].startsWith(prefix)) return null;
  const id = parts[1].slice(prefix.length);
  return UUID.test(id) ? id : null;
}

export function desktopControlProtocol(protocol: string | null): string | null {
  return subprotocol(protocol, 'jentera-control.');
}

/** The prefixes are exclusive, so a watching socket cannot be opened by
 * relabelling a control request, nor the reverse. */
export function desktopObserveProtocol(protocol: string | null): string | null {
  return subprotocol(protocol, 'jentera-observe.');
}

/** Releases are `YYYY.MM.DD-N`. Comparing them as strings works until the
 * counter reaches ten, where "2026.09.23-10" sorts before "2026.09.23-2", so
 * the date and the counter are compared separately. An unparseable release is
 * older than everything, which fails closed. */
export function releaseAtLeast(observed: string | null | undefined, minimum: string): boolean {
  const parse = (value: string) => {
    const match = /^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
  };
  const left = observed ? parse(observed) : null;
  const right = parse(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

/** Either kind. The bridge only reads `expiresAt` and forwards the whole
 * signed payload, so it does not care which — but the two shapes stay
 * distinct so nothing can pass one where the other is required. */
export type DesktopTicket =
  | Awaited<ReturnType<typeof desktopTicket>>
  | Awaited<ReturnType<typeof desktopObserveTicket>>;
