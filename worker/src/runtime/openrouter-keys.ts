import type { Env } from '../env';
import {
  getRuntimeModelCredential,
  getRuntime,
  markRuntimeModelKeyRevoked,
  storeRuntimeModelCredential,
  type RuntimeModelCredential,
} from '../agent-runtime';
import { withTenant } from '../db';

const API = 'https://openrouter.ai/api/v1';
const LIMIT_USD = 5;
const LIFETIME_DAYS = 90;
const ROTATE_BEFORE_DAYS = 7;

interface CreateResponse {
  key?: unknown;
  data?: {
    hash?: unknown;
    expires_at?: unknown;
    limit?: unknown;
    limit_reset?: unknown;
    include_byok_in_limit?: unknown;
  };
  error?: { message?: unknown };
}

export class OpenRouterKeyManager {
  private readonly managementKey: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(managementKey: string, fetcher?: typeof globalThis.fetch) {
    if (managementKey.length < 32) throw new Error('OpenRouter management key is invalid');
    this.managementKey = managementKey;
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  async create(runtimeName: string, now = new Date()): Promise<RuntimeModelCredential> {
    if (!/^aisar-b-[0-9a-f]{20}$/.test(runtimeName)) {
      throw new Error('runtime name is invalid for model key issuance');
    }
    const expiresAt = new Date(now.getTime() + LIFETIME_DAYS * 24 * 60 * 60 * 1_000);
    const response = await this.fetcher(`${API}/keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.managementKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: runtimeName,
        limit: LIMIT_USD,
        limit_reset: 'monthly',
        include_byok_in_limit: true,
        expires_at: expiresAt.toISOString(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await boundedJson(response);
    if (response.status !== 201) throw apiError('create', response.status, body);
    const key = typeof body.key === 'string' ? body.key : '';
    const hash = typeof body.data?.hash === 'string' ? body.data.hash : '';
    const returnedExpiry = typeof body.data?.expires_at === 'string'
      ? new Date(body.data.expires_at)
      : new Date(Number.NaN);
    if (!key.startsWith('sk-or-') || key.length < 32 || !/^[0-9a-f]{64}$/i.test(hash) ||
        Number.isNaN(returnedExpiry.getTime()) || body.data?.limit !== LIMIT_USD ||
        body.data?.limit_reset !== 'monthly' || body.data?.include_byok_in_limit !== true ||
        returnedExpiry.getTime() < now.getTime() + 80 * 24 * 60 * 60 * 1_000 ||
        returnedExpiry.getTime() > expiresAt.getTime() + 60_000) {
      throw new Error('OpenRouter returned an invalid model credential');
    }
    return { key, hash, expiresAt: returnedExpiry };
  }

  async revoke(hash: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('OpenRouter key hash is invalid');
    const response = await this.fetcher(`${API}/keys/${encodeURIComponent(hash)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.managementKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return;
    const body = await boundedJson(response);
    if (!response.ok) throw apiError('revoke', response.status, body);
  }
}

export async function runtimeModelKey(
  env: Env,
  businessId: string,
  runtimeName: string,
  options: { manager?: OpenRouterKeyManager } = {},
): Promise<string> {
  const legacy = env.AISAR_MODEL_KEY?.trim() ?? '';
  const legacyCanaries = new Set((env.RUNTIME_SHARED_MODEL_KEY_BUSINESS_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean));
  /* The shared static inference key is the pin for listed businesses: it wins
     over any stored OpenRouter credential and disables managed rotation. */
  if (legacyCanaries.has(businessId) && legacy.length >= 20) return legacy;
  const current = await withTenant(env, businessId, (tx) =>
    getRuntimeModelCredential(env, tx, businessId));
  const rotateAt = Date.now() + ROTATE_BEFORE_DAYS * 24 * 60 * 60 * 1_000;

  const managementKey = env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim() ?? '';
  const manager = options.manager ?? (managementKey ? new OpenRouterKeyManager(managementKey) : null);
  /* A pending hash means the new current key is staged but has not yet been
     proven inside the Sprite. Keep the old key alive until bootstrap passes. */
  if (current?.pendingRevocationHash) return current.key;
  if (current && current.expiresAt.getTime() > rotateAt) return current.key;

  if (!manager) {
    throw new Error('per-runtime OpenRouter key issuance is unavailable');
  }

  const created = await manager.create(runtimeName);
  try {
    await withTenant(env, businessId, (tx) =>
      storeRuntimeModelCredential(env, tx, businessId, created));
  } catch (error) {
    await manager.revoke(created.hash).catch(() => {});
    throw error;
  }
  return created.key;
}

export async function runtimeModelKeyNeedsRotation(
  env: Env,
  businessId: string,
): Promise<boolean> {
  const legacy = env.AISAR_MODEL_KEY?.trim() ?? '';
  const legacyCanaries = new Set((env.RUNTIME_SHARED_MODEL_KEY_BUSINESS_IDS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean));
  if (legacyCanaries.has(businessId) && legacy.length >= 20) return false;
  if (!env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim()) return false;
  const { runtime, current } = await withTenant(env, businessId, async (tx) => ({
    runtime: await getRuntime(tx, businessId),
    current: await getRuntimeModelCredential(env, tx, businessId),
  }));
  if (!runtime) return false;
  if (!current || current.pendingRevocationHash) return true;
  return current.expiresAt.getTime() <=
    Date.now() + ROTATE_BEFORE_DAYS * 24 * 60 * 60 * 1_000;
}

export async function finalizeRuntimeModelKeyRotation(
  env: Env,
  businessId: string,
  options: { manager?: OpenRouterKeyManager } = {},
): Promise<void> {
  const current = await withTenant(env, businessId, (tx) =>
    getRuntimeModelCredential(env, tx, businessId));
  if (!current?.pendingRevocationHash) return;
  const managementKey = env.AISAR_OPENROUTER_MANAGEMENT_KEY?.trim() ?? '';
  const manager = options.manager ?? (managementKey ? new OpenRouterKeyManager(managementKey) : null);
  if (!manager) throw new Error('OpenRouter management key is required for pending revocation');
  await revokeAndForget(env, businessId, manager, current.pendingRevocationHash);
}

async function revokeAndForget(
  env: Env,
  businessId: string,
  manager: OpenRouterKeyManager,
  hash: string,
): Promise<void> {
  await manager.revoke(hash);
  await withTenant(env, businessId, (tx) => markRuntimeModelKeyRevoked(tx, businessId, hash));
}

async function boundedJson(response: Response): Promise<CreateResponse> {
  const text = await response.text();
  if (text.length > 64 * 1024) throw new Error('OpenRouter key response exceeded limit');
  try {
    return text ? JSON.parse(text) as CreateResponse : {};
  } catch {
    throw new Error(`OpenRouter key API returned invalid JSON (${response.status})`);
  }
}

function apiError(action: string, status: number, body: CreateResponse): Error {
  const detail = typeof body.error?.message === 'string' ? `: ${body.error.message.slice(0, 200)}` : '';
  return new Error(`OpenRouter key ${action} failed (${status})${detail}`);
}
