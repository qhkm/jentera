import type { Env } from '../env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Match the browser's ten-minute idle-control window. The runner continues
// validating the live lease throughout the connection; this only reduces the
// forced session-auth renewal interruption.
export const DESKTOP_TTL_MS = 10 * 60_000;

/** Deliberately no wildcard / fleet-wide default during the desktop pilot. */
export function desktopEnabledFor(env: Env, businessId: string): boolean {
  const ids = (env.DESKTOP_VIEW_BUSINESS_IDS ?? '').split(',').map(id => id.trim());
  return env.DESKTOP_VIEW_ENABLED === 'true' && UUID.test(businessId) &&
    ids.length <= 10 && ids.every(id => UUID.test(id)) && ids.includes(businessId);
}

export async function desktopTicket(runnerKey: string, businessId: string, ownerId: string, controlId: string) {
  const issuedAt = Date.now();
  const payload = { purpose: 'jentera-desktop-v1', businessId, ownerId, controlId,
    nonce: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + DESKTOP_TTL_MS };
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(runnerKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(payload))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { ...payload, signature };
}

/** Not a secret; only selects an existing, explicitly acquired window lease.
 * No tickets or credentials in query strings, proxy headers or browser URLs. */
export function desktopControlProtocol(protocol: string | null): string | null {
  const parts = (protocol ?? '').split(',').map(value => value.trim());
  if (parts.length !== 2 || parts[0] !== 'binary' || !parts[1].startsWith('jentera-control.')) return null;
  const id = parts[1].slice('jentera-control.'.length);
  return UUID.test(id) ? id : null;
}
