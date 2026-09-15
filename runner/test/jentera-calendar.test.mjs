import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from '../bin/jentera-calendar.mjs';

const env = {
  OPENROUTER_BASE_URL: 'https://api.jentera.ai/v1/model',
  OPENROUTER_API_KEY: 'sk-jentera-v1.test',
};

test('lists a bounded calendar range through the Jentera control plane', async () => {
  let observed;
  const result = await run([
    'events',
    '2026-09-16T00:00:00+08:00',
    '2026-09-17T00:00:00+08:00',
  ], env, async (url, init) => {
    observed = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, events: [] }));
  });
  assert.deepEqual(result, { ok: true, events: [] });
  assert.match(observed.url, /^https:\/\/api\.jentera\.ai\/v1\/connectors\/google-calendar\/events\?/);
  assert.equal(observed.init.headers.Authorization, `Bearer ${env.OPENROUTER_API_KEY}`);
});

test('generates a stable request id and only proposes an event', async () => {
  const bodies = [];
  const fetcher = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, status: 'needs_approval', approvalId: 'a1' }), { status: 202 });
  };
  const event = JSON.stringify({
    summary: 'Supplier call',
    start: '2026-09-17T10:00:00+08:00',
    end: '2026-09-17T10:30:00+08:00',
    timeZone: 'Asia/Kuala_Lumpur',
  });
  await run(['propose', event], env, fetcher);
  await run(['propose', event], env, fetcher);
  assert.match(bodies[0].requestId, /^agent_[a-f0-9]{32}$/);
  assert.equal(bodies[0].requestId, bodies[1].requestId);
});

test('refuses to derive the Calendar endpoint from an unrelated model host', async () => {
  await assert.rejects(
    run(['events', '2026-09-16T00:00:00Z', '2026-09-17T00:00:00Z'], {
      ...env,
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    }),
    /unavailable/,
  );
});
