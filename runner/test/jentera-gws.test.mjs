import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareRequest, run } from '../bin/jentera-gws.mjs';

const env = { OPENROUTER_BASE_URL: 'https://api.jentera.ai/v1/model', OPENROUTER_API_KEY: 'test-runtime-key' };
const params = { calendarId: 'primary', timeMin: '2026-09-18T00:00:00+08:00', timeMax: '2026-09-19T00:00:00+08:00' };
const event = { summary: 'Supplier call', start: { dateTime: '2026-09-18T10:00:00+08:00', timeZone: 'Asia/Kuala_Lumpur' },
  end: { dateTime: '2026-09-18T10:30:00+08:00', timeZone: 'Asia/Kuala_Lumpur' } };
const list = (over = {}) => ['calendar', 'events', 'list', '--params', JSON.stringify({ ...params, ...over })];
const insert = (over = {}) => ['calendar', 'events', 'insert', '--params', '{"calendarId":"primary"}', '--json', JSON.stringify({ ...event, ...over })];
const prepare = async (argv) => ({ dry_run: true, is_multipart_upload: false,
  url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events', method: argv[2] === 'list' ? 'GET' : 'POST' });

test('the real gws subprocess always receives dry-run and no provider or model secrets', async () => {
  await prepareRequest(['calendar', 'events', 'list'], { ...env, HOME: '/test/home',
    GOOGLE_WORKSPACE_CLI_TOKEN: 'must-not-inherit', GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: 'must-not-inherit',
    GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: '/test/google-secret.json' }, async (binary, args, opts) => {
    assert.equal(binary, '/test/home/.local/lib/jentera-gws/gws');
    assert.equal(args.at(-1), '--dry-run');
    assert.deepEqual(Object.keys(opts.env).sort(), ['GOOGLE_WORKSPACE_CLI_CONFIG_DIR', 'HOME', 'PATH']);
    assert.equal(opts.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, '/test/home/.cache/jentera-gws');
    assert.equal(opts.timeout, 20_000);
    return { stdout: JSON.stringify(await prepare(args)) };
  });
});

test('a CLI failure does not expose its stderr or credentials in the error', async () => {
  await assert.rejects(prepareRequest([], env, async () => { throw new Error('sensitive provider response'); }),
    (error) => error.message.includes('could not prepare') && !error.message.includes('sensitive'));
});

test('managed list prepares via gws and only sends a bounded read to Jentera', async () => {
  let prepared;
  const result = await run(list(), env, { prepare: async (args) => { prepared = args; return prepare(args); },
    fetch: async (url, init) => {
      assert.equal(new URL(url).pathname, '/v1/connectors/google-calendar/events');
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer test-runtime-key');
      return Response.json({ ok: true, events: [{ summary: 'Supplier call' }] });
    } });
  assert.deepEqual(prepared.slice(0, 3), ['calendar', 'events', 'list']);
  assert.equal(result.events[0].summary, 'Supplier call');
});

test('managed insert proposes an approval, never executes a Google mutation', async () => {
  const bodies = [];
  const deps = { prepare, fetch: async (url, init) => {
    assert.equal(url, 'https://api.jentera.ai/v1/connectors/google-calendar/proposals');
    bodies.push(JSON.parse(init.body));
    return Response.json({ ok: true, status: 'needs_approval', approvalId: 'a1' }, { status: 202 });
  } };
  assert.equal((await run(insert(), env, deps)).status, 'needs_approval');
  await run(insert(), env, deps);
  assert.equal(bodies[0].start, event.start.dateTime);
  assert.equal(bodies[0].timeZone, 'Asia/Kuala_Lumpur');
  assert.equal(bodies[0].requestId, bodies[1].requestId);
});

test('dry-run reports approval requirement without reading a connection or writing a proposal', async () => {
  const result = await run([...insert(), '--dry-run'], env, { prepare,
    fetch: async () => { throw new Error('must not execute'); } });
  assert.equal(result.execution, 'owner_approval_required');
});

test('login obtains a setup link and needs no gws OAuth store or local callback', async () => {
  const result = await run(['auth', 'login'], env, { prepare: async () => { throw new Error('must not start gws auth'); },
    fetch: async (url) => {
      assert.match(url, /\/setup$/);
      return Response.json({ ok: true, status: 'needs_owner_login', connectUrl: 'https://api.jentera.ai/api/connections/google-calendar/start' });
    } });
  assert.equal(result.status, 'needs_owner_login');
});

test('refuses unsupported services, destructive methods and raw authentication options', async () => {
  for (const args of [['gmail', 'users', 'messages', 'send'], ['calendar', 'events', 'delete'],
    ['auth', 'setup'], ['auth', 'login', '--full'], [...list(), '--upload', '/tmp/file'], [...list(), '--params', '{}']]) {
    await assert.rejects(run(args, env), /Usage:/);
  }
});

test('refuses non-primary calendars and unsupported parameters rather than silently dropping them', async () => {
  await assert.rejects(run(list({ calendarId: 'other' }), env), /primary/);
  await assert.rejects(run(list({ maxResults: 2 }), env), /not supported/);
  await assert.rejects(run(list({ singleEvents: false }), env), /Usage:/);
});

test('validates a bounded range before invoking gws', async () => {
  for (const over of [{ timeMax: '2027-01-01T00:00:00Z' }, { timeMin: 'invalid' }, { timeMax: params.timeMin }, { timeMin: 123 }]) {
    await assert.rejects(run(list(over), env, { prepare: async () => { throw new Error('must not prepare'); } }), /31 days/);
  }
});

test('unsupported event fields and timezone conversions are refused, not lost', async () => {
  for (const over of [{ attendees: [{ email: 'customer@example.com' }] }, { recurrence: ['RRULE:FREQ=DAILY'] },
    { start: { date: '2026-09-18' } }, { end: { ...event.end, timeZone: 'UTC' } }]) {
    await assert.rejects(run(insert(over), env), /not supported|timeZone/);
  }
});

test('discovery drift or a poisoned plan cannot redirect execution', async () => {
  for (const over of [{ url: 'https://evil.example/events' }, { method: 'DELETE' }, { dry_run: false }, { is_multipart_upload: true }]) {
    await assert.rejects(run(list(), env, { prepare: async (args) => ({ ...await prepare(args), ...over }),
      fetch: async () => { throw new Error('must not execute'); } }), /unexpected request/);
  }
});

test('connection failures are preserved instead of pretending login succeeded', async () => {
  await assert.rejects(run(list(), env, { prepare,
    fetch: async () => Response.json({ ok: false, code: 'NOT_CONNECTED', err: 'Google Calendar is not connected.' }, { status: 409 }) }), /not connected/);
});
