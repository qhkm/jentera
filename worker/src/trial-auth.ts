import type { Env } from './env';

export function trialCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(value) ? value : '';
}
export function trialLanding(code: string, fallback: string): string {
  return trialCode(code) ? `/access?invite=1#code=${encodeURIComponent(code)}` : fallback;
}
const encoder = new TextEncoder();
const aad = encoder.encode('jentera-trial-auth-v1');
async function key(env: Env) {
  if (!env.CREDENTIAL_KEY) throw new Error('Invitation carry-through is not configured');
  const derived = await crypto.subtle.digest('SHA-256', encoder.encode(`jentera-trial-auth-v1:${env.CREDENTIAL_KEY}`));
  return crypto.subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** Opaque, authenticated carry-through; it never grants access itself. */
export async function sealTrial(env: Env, code: unknown, binding: string): Promise<string> {
  if (!trialCode(code)) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await key(env),
    encoder.encode(JSON.stringify({ code, binding, expires: Date.now() + 15 * 60_000 }))));
  const joined = new Uint8Array(iv.length + bytes.length); joined.set(iv); joined.set(bytes, iv.length);
  return btoa(String.fromCharCode(...joined)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function openTrial(env: Env, sealed: string | null, binding: string): Promise<string> {
  if (!sealed || sealed.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(sealed)) return '';
  try {
    const bytes = Uint8Array.from(atob(sealed.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad }, await key(env), bytes.slice(12));
    const data = JSON.parse(new TextDecoder().decode(clear));
    return data.binding === binding && Number.isFinite(data.expires) && data.expires > Date.now() ? trialCode(data.code) : '';
  } catch { return ''; }
}
