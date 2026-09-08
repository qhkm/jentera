import { describe, expect, it } from 'vitest';
import { admitPaidAgentRun, guardApiRequest, MAX_API_BODY_BYTES } from '../src/request-guard';
import { testEnv } from './harness';

const cors = { 'Access-Control-Allow-Origin': 'https://jentera.ai' };

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://api.jentera.ai${path}`, {
    method: 'GET',
    headers: { 'CF-Connecting-IP': '203.0.113.7', ...(init.headers ?? {}) },
    ...init,
  });
}

describe('pre-route API request guard', () => {
  it('refuses a general burst before route work', async () => {
    const env = testEnv({ API_BURST: { limit: async () => ({ success: false }) } });
    const req = request('/api/state');
    const response = await guardApiRequest(req, env, new URL(req.url), cors);

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('60');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('also throttles bot scans outside the documented API paths', async () => {
    let calls = 0;
    const env = testEnv({
      API_BURST: {
        limit: async () => {
          calls += 1;
          return { success: false };
        },
      },
    });
    const req = request('/wp-login.php');
    const response = await guardApiRequest(req, env, new URL(req.url), cors);

    expect(calls).toBe(2);
    expect(response?.status).toBe(429);
  });

  it('rejects oversized declared bodies without consulting a limiter', async () => {
    let calls = 0;
    const env = testEnv({
      API_BURST: { limit: async () => { calls += 1; return { success: true }; } },
    });
    const req = request('/api/runs/ingest', {
      method: 'POST',
      headers: { 'Content-Length': String(MAX_API_BODY_BYTES + 1) },
    });
    const response = await guardApiRequest(req, env, new URL(req.url), cors);

    expect(response?.status).toBe(413);
    expect(calls).toBe(0);
  });

  /* Bodies with no Content-Length (chunked uploads) skip the declared-length
     check and are measured through a clone of the stream. The cap must still
     fire, promptly, and an in-limit body must remain readable by the route. */
  function streamed(bytes: number, chunk = 16 * 1024): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunk, bytes - sent);
        controller.enqueue(new Uint8Array(size).fill(0x61));
        sent += size;
      },
    });
  }

  it('rejects an oversized body that declares no length, without hanging', async () => {
    let calls = 0;
    const env = testEnv({
      API_BURST: { limit: async () => { calls += 1; return { success: true }; } },
    });
    const req = request('/api/runs/ingest', {
      method: 'POST',
      body: streamed(MAX_API_BODY_BYTES + 1_024),
      duplex: 'half',
    } as RequestInit);
    expect(req.headers.get('Content-Length')).toBeNull();

    const outcome = await Promise.race([
      guardApiRequest(req, env, new URL(req.url), cors),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 4_000)),
    ]);
    expect(outcome).not.toBe('hung');
    expect((outcome as Response).status).toBe(413);
    expect(calls).toBe(0);
  });

  it('leaves an in-limit body with no declared length readable for the route', async () => {
    const env = testEnv();
    const payload = JSON.stringify({ hello: 'world' });
    const req = request('/api/state/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new Blob([payload]).stream(),
      duplex: 'half',
    } as RequestInit);
    expect(req.headers.get('Content-Length')).toBeNull();

    const response = await guardApiRequest(req, env, new URL(req.url), cors);
    expect(response).toBeNull();
    /* The probe read a clone; the original must still carry the body. */
    await expect(req.json()).resolves.toEqual({ hello: 'world' });
  });

  it('checks runtime mutation by both opaque identity and source address', async () => {
    const keys: string[] = [];
    const env = testEnv({
      RUNTIME_MUTATION_BURST: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: true };
        },
      },
    });
    const req = request('/api/runtime/provision', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '203.0.113.7',
        Cookie: `aisar_session=${'a'.repeat(64)}`,
      },
    });
    const response = await guardApiRequest(req, env, new URL(req.url), cors);

    expect(response).toBeNull();
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(keys.some((key) => key.includes('203.0.113.7') || key.includes('aaaa'))).toBe(false);
  });

  it.each([
    ['POST', '/api/state/onboarding/complete'],
    ['POST', '/api/runtime/reconcile'],
    ['POST', '/api/runtime/upgrade'],
    ['POST', '/api/runtime/tasks/11111111-1111-4111-8111-111111111111/cancel'],
    ['DELETE', '/api/runtime'],
  ])('applies the expensive-mutation brake to %s %s', async (method, path) => {
    let mutations = 0;
    const env = testEnv({
      RUNTIME_MUTATION_BURST: {
        limit: async () => {
          mutations += 1;
          return { success: true };
        },
      },
    });
    const req = request(path, { method });
    expect(await guardApiRequest(req, env, new URL(req.url), cors)).toBeNull();
    expect(mutations).toBe(2);
  });

  it('keeps ordinary API reads available when the broad limiter is unavailable', async () => {
    const env = testEnv({
      API_BURST: { limit: async () => { throw new Error('binding failed'); } },
    });
    const req = request('/api/runtime/provision', { method: 'POST' });
    const response = await guardApiRequest(req, env, new URL(req.url), cors);

    expect(response).toBeNull();
  });

  it('still fails closed when dedicated runtime protection is unavailable', async () => {
    const env = testEnv({
      RUNTIME_MUTATION_BURST: { limit: async () => { throw new Error('binding failed'); } },
    });
    const req = request('/api/runtime/provision', { method: 'POST' });
    const response = await guardApiRequest(req, env, new URL(req.url), cors);

    expect(response?.status).toBe(503);
  });

  it('rate limits agent runs by both opaque identity and source address', async () => {
    const keys: string[] = [];
    const env = testEnv({
      AGENT_RUN_BURST: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: true };
        },
      },
    });
    const req = request('/api/runs/ask', {
      method: 'POST',
      headers: { Cookie: `aisar_session=${'b'.repeat(64)}` },
    });

    expect(await guardApiRequest(req, env, new URL(req.url), cors)).toBeNull();
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it('fails closed when dedicated agent-run protection is unavailable', async () => {
    const env = testEnv({
      AGENT_RUN_BURST: { limit: async () => { throw new Error('binding failed'); } },
    });
    const req = request('/api/runs/ask', { method: 'POST' });

    expect((await guardApiRequest(req, env, new URL(req.url), cors))?.status).toBe(503);
  });

  it('puts onboarding website ingestion behind the paid-work brake', async () => {
    let admissions = 0;
    const env = testEnv({
      AGENT_RUN_BURST: {
        limit: async () => {
          admissions += 1;
          return { success: true };
        },
      },
    });
    const req = request('/api/runs/ingest', { method: 'POST' });
    expect(await guardApiRequest(req, env, new URL(req.url), cors)).toBeNull();
    expect(admissions).toBe(2);
  });

  it('admits authenticated connector work only when every opaque spend bucket allows it', async () => {
    const keys: string[] = [];
    const env = testEnv({
      AGENT_RUN_BURST: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: keys.length === 1 };
        },
      },
    });

    expect(await admitPaidAgentRun(env, ['telegram:connection', 'telegram:chat']))
      .toBe(false);
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it('fails closed for authenticated connector work when its limiter is unavailable', async () => {
    const env = testEnv({
      AGENT_RUN_BURST: { limit: async () => { throw new Error('binding failed'); } },
    });
    expect(await admitPaidAgentRun(env, ['telegram:connection'])).toBe(false);
  });

  it('rate limits run WebSocket admission by identity and source address', async () => {
    const keys: string[] = [];
    const env = testEnv({
      RUN_STREAM_BURST: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: true };
        },
      },
    });
    const req = request('/api/runs/11111111-1111-4111-8111-111111111111/events', {
      headers: { Cookie: `aisar_session=${'c'.repeat(64)}` },
    });

    expect(await guardApiRequest(req, env, new URL(req.url), cors)).toBeNull();
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  it('fails closed when WebSocket admission protection is unavailable', async () => {
    const env = testEnv({
      RUN_STREAM_BURST: { limit: async () => { throw new Error('binding failed'); } },
    });
    const req = request('/api/runs/11111111-1111-4111-8111-111111111111/events');

    expect((await guardApiRequest(req, env, new URL(req.url), cors))?.status).toBe(503);
  });
});
