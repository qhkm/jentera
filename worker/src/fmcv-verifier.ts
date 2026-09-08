/* ============================================================
   Jentera model-credential verification and the per-rider model
   budget, enforced inside this Worker.

   The token contract was originally prototyped as a host-side
   verifier (gateway/fmcv-verifier on the LiteLLM host). That design
   required coordinating a deploy on the gateway host, so enforcement
   now lives here, beside the model proxy (routes/model.ts). The
   process is provider-neutral: AISAR_MODEL_BASE names the upstream
   gateway, FMCV_UPSTREAM_KEY its credential, and switching upstreams
   is configuration, never a code change. AISAR_MODEL_KEY is the
   control secret that signs the runtime-facing credentials.

   Credential format (unchanged from the prototype, context renamed):
     sk-jentera-v1.<payload>.<sig>
   payload = base64url(JSON { v: 1, rid, limitUsd: 5, limitReset: 'monthly' })
   sig     = base64url(HMAC-SHA256(controlSecret, "<context>:<payload>"))
   The payload discloses only the already-pseudonymous runtime name and
   the limit claims; signature verification is stateless with just the
   control secret. There is no tenant/business identifier in the token.
   ============================================================ */

import type { Env } from './env';
import { connect } from './db';

/** Signature context for runtime-facing model credentials. Renamed so the
    token family is provider-neutral; the old prototype value
    `jentera-fmcv-runtime-key:v1` is intentionally NOT accepted. */
export const RUNTIME_KEY_CONTEXT = 'jentera-runtime-key:v1';

/** Path on this Worker that proxies model calls to the upstream gateway. */
export const RUNTIME_PROXY_PATH = '/v1/model';

/** The only reviewed per-rider ceiling, embedded in every v1 token. */
export const RUNTIME_MODEL_CEILING_LIMIT_USD = 5;

const TOKEN_PREFIX = 'sk-jentera-v1';
const RUNTIME_NAME = /^aisar-b-[0-9a-f]{20}$/;
const MAX_PAYLOAD_BYTES = 512;

export interface JenteraKeyClaims {
  v: 1;
  rid: string;
  limitUsd: number;
  limitReset: 'monthly';
}

export class JenteraKeyError extends Error {}
/** Bigger than a bad token: the deployment is misconfigured (no/weak
    control secret). Routes must answer 503, never 401, for this. */
export class JenteraKeyUnavailableError extends JenteraKeyError {}

/** UTC month bucket shared by token claims, the ledger, and admission. */
export function riderMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Verify a runtime-facing model credential. Throws JenteraKeyError on any
 * tamper/malformation and JenteraKeyUnavailableError when the deployment is
 * missing the control secret.
 */
export async function verifyJenteraKey(
  token: string,
  controlSecret: string,
): Promise<JenteraKeyClaims> {
  if (!controlSecret || controlSecret.length < 32) {
    throw new JenteraKeyUnavailableError('model control secret is not configured');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !parts[1] || !parts[2]) {
    throw new JenteraKeyError('model credential is malformed');
  }
  const [prefix, payload, signature] = parts as [string, string, string];

  const decoded = base64UrlDecode(payload);
  if (decoded.length === 0 || decoded.length > MAX_PAYLOAD_BYTES) {
    throw new JenteraKeyError('model credential payload is invalid');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    throw new JenteraKeyError('model credential payload is invalid');
  }
  const claims = raw as Partial<JenteraKeyClaims>;
  if (!claims || typeof claims !== 'object' || claims.v !== 1 ||
      typeof claims.rid !== 'string' || !RUNTIME_NAME.test(claims.rid) ||
      claims.limitUsd !== RUNTIME_MODEL_CEILING_LIMIT_USD ||
      claims.limitReset !== 'monthly') {
    throw new JenteraKeyError('model credential claims are invalid');
  }

  const expected = await hmacSha256Base64Url(controlSecret, `${RUNTIME_KEY_CONTEXT}:${payload}`);
  if (!timingSafeEqual(expected, signature)) {
    throw new JenteraKeyError('model credential signature is invalid');
  }

  void prefix;
  return claims as JenteraKeyClaims;
}

/** Spend ledger lookups are deliberately NOT tenant-scoped: the table holds
    only a pseudonymous rider id and a dollar figure, so there is no tenant
    data to isolate and no business_id to derive (the runtime name is a
    one-way hash of it). The RLS policy on fmcv_rider_spend documents that. */

export interface RiderBudgetStatus {
  month: string;
  /** Micro-USD (1e-6 USD), the unit modelCostMicrousd produces; exact per request. */
  spendMicrousd: number;
  limitMicrousd: number;
  allowed: boolean;
}

const MICROUSD_PER_USD = 1_000_000;

export async function riderBudgetStatus(
  env: Env,
  riderId: string,
  now = new Date(),
): Promise<RiderBudgetStatus> {
  const month = riderMonthKey(now);
  const limitMicrousd = RUNTIME_MODEL_CEILING_LIMIT_USD * MICROUSD_PER_USD;
  const spendMicrousd = await riderMonthSpend(env, riderId, month);
  return { month, spendMicrousd, limitMicrousd, allowed: spendMicrousd < limitMicrousd };
}

export async function riderMonthSpend(env: Env, riderId: string, month: string): Promise<number> {
  const sql = connect(env);
  try {
    /* bigint arrives as a string from postgres.js; the ceiling is far
       inside safe-integer range, so Number() is exact here. */
    const [row] = await sql<{ spend_microusd: string | number }[]>`
      select spend_microusd from fmcv_rider_spend
       where rider_id = ${riderId} and month = ${month}`;
    return row ? Number(row.spend_microusd) : 0;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Idempotent-ish accumulation: an upsert increments by the delta. The
    admission read and this write are not one transaction, so a burst of
    concurrent completions can overshoot the ceiling by the cost of the
    in-flight requests — bounded and acceptable for a backstop meter. */
export async function recordRiderSpend(
  env: Env,
  riderId: string,
  microusd: number,
  month: string,
): Promise<void> {
  if (!Number.isSafeInteger(microusd) || microusd <= 0) return;
  const sql = connect(env);
  try {
    await sql`
      insert into fmcv_rider_spend (rider_id, month, spend_microusd, updated_at)
      values (${riderId}, ${month}, ${microusd}, now())
      on conflict (rider_id, month)
      do update set
        spend_microusd = fmcv_rider_spend.spend_microusd + excluded.spend_microusd,
        updated_at = now()`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(message),
  ));
  return base64Url(signature);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict base64url decoder: rejects anything outside the alphabet so a
    malformed payload cannot be smuggled past length/parse checks. */
function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return new Uint8Array(0);
  let binary = '';
  for (const char of value) {
    if (char === '-') binary += '+';
    else if (char === '_') binary += '/';
    else binary += char;
  }
  const padded = binary + '='.repeat((4 - (binary.length % 4)) % 4);
  try {
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}

/** Length-preserving compare; avoids leaking the expected signature
    character-by-character to a timing side channel. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
