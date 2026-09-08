import { beforeEach, describe, expect, it } from 'vitest';
import { deriveJenteraRuntimeCredential } from '../src/runtime/openrouter-keys';
import {
  JenteraKeyUnavailableError,
  RUNTIME_PROXY_PATH,
  recordRiderSpend,
  riderMonthKey,
  verifyJenteraKey,
} from '../src/fmcv-verifier';
import type { ModelProxyOptions } from '../src/routes/model';
import { handleModelProxy } from '../src/routes/model';
import { asOwner, req, testEnv, truncateAll } from './harness';

const CONTROL_SECRET = 'fmcv-control-secret-'.padEnd(48, 's');
const UPSTREAM_KEY = 'f'.repeat(32);
const RID = 'aisar-b-0123456789abcdef0123';
/** testEnv API_ORIGIN is http://localhost:8787. */
const PROXY_BASE = 'http://localhost:8787/v1/model';

function proxyEnv(over: Record<string, unknown> = {}) {
  return testEnv({
    AISAR_MODEL_BASE: 'https://router.fmcv.my',
    AISAR_MODEL_KEY: CONTROL_SECRET,
    FMCV_UPSTREAM_KEY: UPSTREAM_KEY,
    ...over,
  });
}

async function derivedKey(secret = CONTROL_SECRET): Promise<string> {
  return (await deriveJenteraRuntimeCredential(secret, RID)).key;
}

async function callModel(
  method: string,
  path: string,
  env: ReturnType<typeof proxyEnv>,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    options?: ModelProxyOptions;
  } = {},
) {
  const { request, url } = req(method, path, { body: opts.body });
  if (opts.token) request.headers.set('Authorization', `Bearer ${opts.token}`);
  if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) request.headers.set(k, v);
  const response = await handleModelProxy(request, env, url, {
    'Access-Control-Allow-Origin': '*',
  }, opts.options ?? {});
  if (!response) throw new Error('model proxy did not match');
  return response;
}

/** A canned upstream that records what it was asked for. */
function stubUpstream(status = 200, body: unknown | (() => Response) = { id: 'ok' }) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    seen.push({ url: String(input), init });
    if (typeof body === 'function') return (body as () => Response)();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetcher, seen };
}

async function spendMicrousd(microusd: number): Promise<void> {
  await recordRiderSpend(proxyEnv(), RID, microusd, riderMonthKey(new Date()));
}

async function ledgerMicrousd(): Promise<number | null> {
  const [row] = await asOwner((sql) => sql<{ microusd: string | number }[]>`
    select spend_microusd as microusd from fmcv_rider_spend
     where rider_id = ${RID} and month = ${riderMonthKey(new Date())}`);
  return row ? Number(row.microusd) : null;
}

beforeEach(async () => {
  await truncateAll();
});

describe('worker-native jentera credential verification', () => {
  it('verifies a derived credential and rejects tampered or foreign ones', async () => {
    const key = await derivedKey();
    const claims = await verifyJenteraKey(key, CONTROL_SECRET);
    expect(claims.rid).toBe(RID);
    expect(claims.limitUsd).toBe(5);
    expect(claims.limitReset).toBe('monthly');

    const [payload, sig] = key.slice('sk-jentera-v1.'.length).split('.');
    const flipped = payload.slice(0, 2) + (payload[2] === 'A' ? 'B' : 'A') + payload.slice(3);
    await expect(verifyJenteraKey(`sk-jentera-v1.${flipped}.${sig}`, CONTROL_SECRET))
      .rejects.toThrow('model credential');
    await expect(verifyJenteraKey(key, 'x'.repeat(32)))
      .rejects.toThrow('model credential');
  });

  it('treats a missing or weak control secret as a 503-class misconfiguration', async () => {
    await expect(verifyJenteraKey('sk-jentera-v1.a.b', '')).rejects
      .toBeInstanceOf(JenteraKeyUnavailableError);
    await expect(verifyJenteraKey('sk-jentera-v1.a.b', 'short')).rejects
      .toBeInstanceOf(JenteraKeyUnavailableError);
  });
});

describe('model proxy route', () => {
  it('answers 401 for missing, malformed, or tampered credentials', async () => {
    const env = proxyEnv();

    const none = await callModel('GET', RUNTIME_PROXY_PATH, env);
    expect(none.status).toBe(401);

    const bad = await callModel('GET', RUNTIME_PROXY_PATH, env, { token: 'sk-jentera-v1.aaa.bbb' });
    expect(bad.status).toBe(401);

    const envWithoutSecret = proxyEnv({ AISAR_MODEL_KEY: undefined });
    const unconfigured = await callModel('GET', RUNTIME_PROXY_PATH, envWithoutSecret, {
      token: 'sk-jentera-v1.aaa.bbb',
    });
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json()).error.message).toMatch(/control secret/);

    const stray = await callModel('GET', RUNTIME_PROXY_PATH, env, { token: 'openrouter-fake' });
    expect(stray.status).toBe(401);
  });

  it('relays a models listing to the allowlisted upstream with the upstream key only', async () => {
    const { fetcher, seen } = stubUpstream(200, {
      data: [{ id: 'MiniMax-M3', object: 'model' }],
    });
    const env = proxyEnv();
    const response = await callModel('GET', `${RUNTIME_PROXY_PATH}/models`, env, {
      token: await derivedKey(),
      options: { upstreamFetch: fetcher },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].id).toBe('MiniMax-M3');
    expect(seen).toHaveLength(1);
    const auth = new Headers(seen[0].init.headers).get('Authorization');
    expect(auth).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(auth).not.toContain('sk-jentera');
    expect(seen[0].url).toBe('https://router.fmcv.my/v1/models');
  });

  it('fails closed when the upstream credential or base is not configured', async () => {
    const token = await derivedKey();
    const noUpstream = proxyEnv({ FMCV_UPSTREAM_KEY: undefined });
    expect((await callModel('GET', `${RUNTIME_PROXY_PATH}/models`, noUpstream, { token })).status)
      .toBe(503);
    const badBase = proxyEnv({ AISAR_MODEL_BASE: 'https://not-pinned.example' });
    expect((await callModel('GET', `${RUNTIME_PROXY_PATH}/models`, badBase, { token })).status)
      .toBe(503);
  });

  it('rejects malformed chat bodies before any upstream call', async () => {
    const env = proxyEnv();
    const token = await derivedKey();
    const noModel = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, { token, body: { messages: [] } });
    expect(noModel.status).toBe(400);

    const big = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, { token, body: { model: 'MiniMax-M3', data: 'x'.repeat(2 * 1024 * 1024) } });
    expect(big.status).toBe(413);
  });

  it('rejects a request from a rider whose monthly spend ceiling is exhausted', async () => {
    const env = proxyEnv();
    await spendMicrousd(5_000_000); /* the signed $5 monthly ceiling */
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] },
      });
    expect(response.status).toBe(429);
    expect((await response.json()).error.type).toBe('budget_exceeded');
  });

  it('meters a non-streaming completion into the rider spend ledger', async () => {
    const { fetcher, seen } = stubUpstream(200, {
      id: 'cmpl-1',
      usage: { prompt_tokens: 1_000_000, completion_tokens: 2_000_000 },
    });
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] },
        options: { upstreamFetch: fetcher },
      });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'cmpl-1' });
    expect(seen).toHaveLength(1);
    /* recordUsage is awaited inside the route; give the ledger a beat. */
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 1M in × $0.30/M + 2M out × $1.20/M = $2.70 = 2,700,000 micro-USD, exactly.
    expect(await ledgerMicrousd()).toBe(2_700_000);
  });

  it('accumulates sub-cent completions exactly instead of rounding each up to a cent', async () => {
    /* 1,000 in × $0.30/M + 100 out × $1.20/M = 420 micro-USD. Two of them are
       840, not 20,000; the old cent ledger charged a full cent per call. */
    const { fetcher } = stubUpstream(200, {
      id: 'cmpl-small',
      usage: { prompt_tokens: 1_000, completion_tokens: 100 },
    });
    const env = proxyEnv();
    for (let i = 0; i < 2; i++) {
      const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
        env, {
          token: await derivedKey(),
          body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] },
          options: { upstreamFetch: fetcher },
        });
      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await ledgerMicrousd()).toBe(840);
  });

  it('meters a stream whose earlier chunks carry "usage": null', async () => {
    /* OpenAI-style streams with include_usage emit "usage": null on every
       content chunk and the object only on the last. The scanner must not
       latch onto the first null (or the word inside a delta) and miss it. */
    const encoder = new TextEncoder();
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"he"}}],"usage":null}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":" usage of"}}],"usage":null}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"choices":[],"usage":{"prompt_tokens":500000,"completion_tokens":1000000}}\n\n',
        ));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const { fetcher } = stubUpstream(200, () => new Response(sse, {
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }], stream: true },
        options: { upstreamFetch: fetcher },
      });
    expect(response.status).toBe(200);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 500k in × $0.30/M + 1M out × $1.20/M = $1.35 = 1,350,000 micro-USD.
    expect(await ledgerMicrousd()).toBe(1_350_000);
  });

  it('meters a streaming completion from the final usage chunk', async () => {
    const encoder = new TextEncoder();
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"he"}}]}\n\n'));
        controller.enqueue(encoder.encode(
          'data: {"usage":{"prompt_tokens":500000,"completion_tokens":1000000}}\n\n',
        ));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const upstream = () => new Response(sse, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const { fetcher } = stubUpstream(200, upstream);
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }], stream: true },
        options: { upstreamFetch: fetcher },
      });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('[DONE]');
    expect(text).toContain('"usage"');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await ledgerMicrousd()).toBe(1_350_000);
  });

  it('injects stream_options.include_usage so streaming requests are metered', async () => {
    const { fetcher, seen } = stubUpstream(200, { id: 'streamed' });
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [], stream: true },
        options: { upstreamFetch: fetcher },
      });
    expect(response.status).toBe(200);
    expect(JSON.parse(String(seen[0].init.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('returns 502 when the upstream is unreachable', async () => {
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [] },
        options: {
          upstreamFetch: (async () => { throw new Error('boom'); }) as unknown as typeof fetch,
        },
      });
    expect(response.status).toBe(502);
  });

  it('passes through upstream error responses with their status', async () => {
    const env = proxyEnv();
    const upstream = async () => new Response('{"error":"gateway refused"}', {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'MiniMax-M3', messages: [] },
        options: { upstreamFetch: upstream as unknown as typeof fetch },
      });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'gateway refused' });
  });

  it('answers 404 for paths outside the supported proxy tree', async () => {
    const env = proxyEnv();
    const response = await callModel('GET', `${RUNTIME_PROXY_PATH}/embeddings`, env, {
      token: await derivedKey(),
    });
    expect(response.status).toBe(404);
  });
});
