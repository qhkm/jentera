import type { Env } from '../env';

export class VaultUnavailable extends Error {
  constructor(message = 'Secure credential service is not available') {
    super(message);
    this.name = 'VaultUnavailable';
  }
}

export interface VaultResponse<T> {
  status: number;
  body: T;
}

/**
 * Call one fixed vault route over the Cloudflare service binding.
 *
 * Callers supply a path assembled from locally validated ids, never a URL.
 * Keeping the origin constant makes this incapable of becoming an SSRF
 * primitive. Response and request bodies are deliberately never logged here:
 * future deposit routes may carry secret material even though today's do not.
 */
export async function callVault<T>(
  env: Env,
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: Record<string, unknown> } = {},
): Promise<VaultResponse<T>> {
  const token = env.VAULT_INTERNAL_TOKEN?.trim();
  if (!env.VAULT || !token) throw new VaultUnavailable();
  if (!path.startsWith('/v1/') || path.includes('://')) {
    throw new Error('invalid vault route');
  }

  let response: Response;
  try {
    response = await env.VAULT.fetch(new Request(`https://vault.internal${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'X-Vault-Internal': token,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }));
  } catch {
    throw new VaultUnavailable();
  }

  let body: T;
  try {
    body = await response.json() as T;
  } catch {
    throw new VaultUnavailable('Secure credential service returned an invalid response');
  }
  return { status: response.status, body };
}
