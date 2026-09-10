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
import { handleModelProxy, sweepModelCalls } from '../src/routes/model';
import { asApp, asOwner, req, testEnv, truncateAll } from './harness';

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
    // 1M in × $0.60/M + 2M out × $2.40/M = $5.40 = 5,400,000 micro-USD, exactly.
    expect(await ledgerMicrousd()).toBe(5_400_000);
  });

  it('accumulates sub-cent completions exactly instead of rounding each up to a cent', async () => {
    /* 1,000 in × $0.60/M + 100 out × $2.40/M = 840 micro-USD. Two of them are
       1,680, not 20,000; the old cent ledger charged a full cent per call. */
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
    expect(await ledgerMicrousd()).toBe(1_680);
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
    // 500k in × $0.60/M + 1M out × $2.40/M = $2.70 = 2,700,000 micro-USD.
    expect(await ledgerMicrousd()).toBe(2_700_000);
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
    expect(await ledgerMicrousd()).toBe(2_700_000);
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

describe('per-call model accounting', () => {
  /* Read as aisar_app, the role the worker actually runs as. The owner
     bypasses RLS, so an owner-side assertion would pass while production
     could not see its own rows. */
  const calls = () => asApp((sql) => sql<Record<string, unknown>[]>`
    select * from model_call order by id`);

  it('has no column that could hold content', async () => {
    /* The invariant the whole table rests on: sizes, counts, token numbers
       and a model id — never a message, a prompt, a tool output or a page.
       Asserting the column list means a future migration that adds
       somewhere to put content fails here rather than in review. */
    const columns = await asOwner((sql) => sql<{ column_name: string; data_type: string }[]>`
      select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'model_call'
       order by ordinal_position`);
    expect(columns.map((c) => c.column_name)).toEqual([
      'id', 'rider_id', 'model', 'streamed', 'usage_seen',
      'prompt_tokens', 'completion_tokens', 'cached_tokens', 'cost_microusd',
      'request_bytes', 'message_count', 'tool_count',
      'system_chars', 'tools_chars', 'history_chars', 'last_user_chars',
      'upstream_status', 'latency_ms', 'created_at',
    ]);
    /* Only two columns can hold a string at all, and both are identifiers
       the proxy already holds. Everything describing the prompt is a
       number — `message_count` counts messages, it does not keep one. */
    const textual = columns.filter((c) => c.data_type === 'text' || c.data_type.includes('char'));
    expect(textual.map((c) => c.column_name)).toEqual(['rider_id', 'model']);
    expect(textual.some((c) => /content|message|prompt|body|text|input|output/.test(c.column_name)))
      .toBe(false);
  });

  it('records one row per non-streaming call, with the prompt broken into parts', async () => {
    const system = 'S'.repeat(300);
    const older = 'H'.repeat(120);
    const question = 'Q'.repeat(40);
    const tools = [{ type: 'function', function: { name: 'search', parameters: {} } }];
    const { fetcher } = stubUpstream(200, {
      id: 'cmpl-shape',
      usage: {
        prompt_tokens: 1_000, completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    });
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: {
          model: 'MiniMax-M3',
          tools,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: older },
            { role: 'assistant', content: older },
            { role: 'user', content: question },
          ],
        },
        options: { upstreamFetch: fetcher },
      });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const [row] = await calls();
    expect(row).toBeDefined();
    expect(row.rider_id).toBe(RID);
    expect(row.model).toBe('MiniMax-M3');
    expect(row.streamed).toBe(false);
    expect(row.usage_seen).toBe(true);
    expect(Number(row.prompt_tokens)).toBe(1_000);
    expect(Number(row.completion_tokens)).toBe(100);
    expect(Number(row.cached_tokens)).toBe(400);
    /* 1,000 in × $0.60/M + 100 out × $2.40/M = 840 micro-USD. */
    expect(Number(row.cost_microusd)).toBe(840);
    expect(Number(row.message_count)).toBe(4);
    expect(Number(row.tool_count)).toBe(1);
    expect(Number(row.system_chars)).toBe(300);
    expect(Number(row.tools_chars)).toBe(JSON.stringify(tools).length);
    /* Both non-system messages before the final user turn. */
    expect(Number(row.history_chars)).toBe(240);
    expect(Number(row.last_user_chars)).toBe(40);
    expect(Number(row.upstream_status)).toBe(200);
    expect(Number(row.request_bytes)).toBeGreaterThan(300);
  });

  it('marks a stream that closed without a usage chunk as unmetered', async () => {
    /* The gap the header comment describes: real spend the rider ledger
       never saw. It has to be a countable row, not a caveat. */
    const encoder = new TextEncoder();
    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
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
    await new Promise((resolve) => setTimeout(resolve, 80));

    const [row] = await calls();
    expect(row).toBeDefined();
    expect(row.streamed).toBe(true);
    expect(row.usage_seen).toBe(false);
    expect(row.prompt_tokens).toBeNull();
    expect(row.cost_microusd).toBeNull();
    /* Nothing reached the ledger either — that is the point of the row. */
    expect(await ledgerMicrousd()).toBeNull();
  });

  it('records a metered stream once, alongside the ledger write', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 80));

    const rows = await calls();
    expect(rows).toHaveLength(1);
    expect(rows[0].streamed).toBe(true);
    expect(rows[0].usage_seen).toBe(true);
    expect(Number(rows[0].prompt_tokens)).toBe(500_000);
    expect(await ledgerMicrousd()).toBe(2_700_000);
  });

  it('records the shape of an unpriced model even though it cannot cost it', async () => {
    /* modelCostMicrousd throws for a model with no reviewed pricing. The
       ledger skips those; the diagnostic must not, or a misconfigured
       route becomes invisible exactly when it is costing money. */
    const { fetcher } = stubUpstream(200, {
      id: 'cmpl-unpriced',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const env = proxyEnv();
    const response = await callModel('POST', `${RUNTIME_PROXY_PATH}/chat/completions`,
      env, {
        token: await derivedKey(),
        body: { model: 'some-unrouted-model', messages: [{ role: 'user', content: 'hi' }] },
        options: { upstreamFetch: fetcher },
      });
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const [row] = await calls();
    expect(row).toBeDefined();
    expect(row.model).toBe('some-unrouted-model');
    expect(row.usage_seen).toBe(true);
    expect(Number(row.prompt_tokens)).toBe(10);
    expect(row.cost_microusd).toBeNull();
    expect(await ledgerMicrousd()).toBeNull();
  });

  it('lets the app role append and sweep, but never rewrite a recorded call', async () => {
    /* 000_role.sql's default privileges hand every new table update as well,
       so the migration has to revoke it back. A recorded call is a fact
       about something that already happened. */
    await asOwner((sql) => sql`
      insert into model_call (
        rider_id, model, streamed, usage_seen, request_bytes, message_count,
        tool_count, system_chars, tools_chars, history_chars, last_user_chars,
        upstream_status, latency_ms
      ) values (${RID}, 'MiniMax-M3', false, true, 10, 1, 0, 0, 0, 0, 2, 200, 10)`);
    await expect(asApp((sql) => sql`
      update model_call set prompt_tokens = 1 where rider_id = ${RID}`))
      .rejects.toThrow(/permission denied/i);
    const [row] = await asApp((sql) => sql<{ granted: boolean }[]>`
      select has_table_privilege('aisar_app', 'public.model_call', 'update') as granted`);
    expect(row.granted).toBe(false);
  });

  it('sweeps rows past the retention window and leaves fresh ones', async () => {
    const env = proxyEnv();
    await asOwner((sql) => sql`
      insert into model_call (
        rider_id, model, streamed, usage_seen, request_bytes, message_count,
        tool_count, system_chars, tools_chars, history_chars, last_user_chars,
        upstream_status, latency_ms, created_at
      ) values
        (${RID}, 'MiniMax-M3', false, true, 10, 1, 0, 0, 0, 0, 2, 200, 10, now() - interval '120 days'),
        (${RID}, 'MiniMax-M3', false, true, 10, 1, 0, 0, 0, 0, 2, 200, 10, now())`);
    expect(await sweepModelCalls(env)).toBe(1);
    const rows = await calls();
    expect(rows).toHaveLength(1);
  });
});
