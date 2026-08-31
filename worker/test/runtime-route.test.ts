import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRuntime } from '../src/routes/runtime';
import type { Env } from '../src/env';
import { startRun } from '../src/runs';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import { reserveRuntimeUsage } from '../src/runtime/usage';
import { saveConnection } from '../src/connections';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
let ownerCookie: string;
let staffCookie: string;
let ownerId = '';
let staffId = '';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
              values (${A}, 'Alpha', 'restaurant', true)`;
    const [owner] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${owner.id}, ${A}, 'owner'), (${staff.id}, ${A}, 'staff')`;
    ownerId = owner.id;
    staffId = staff.id;
  });
  ownerCookie = await signIn(ownerId);
  staffCookie = await signIn(staffId);
});

afterEach(() => vi.unstubAllGlobals());

describe('runtime provisioning route', () => {
  it('shows no runtime without exposing provider identity', async () => {
    const response = await call('GET', '/api/runtime', testEnv(), ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      runtime: null,
      budget: {
        budget: {
          monthlyInputTokens: 2_000_000,
          monthlyOutputTokens: 500_000,
          monthlyRuntimeSeconds: 360_000,
          monthlyCostMicrousd: 5_000_000,
          maxRunSeconds: 900,
        },
        usage: { inputTokens: 0, outputTokens: 0, runtimeMs: 0, costMicrousd: 0 },
      },
    });
  });

  it('shows the latest attested Sprite region and a non-blocking placement warning', async () => {
    await asOwner(async (sql) => {
      await sql`
        insert into agent_runtime
          (business_id, provider, provider_name, status, desired_release, observed_release)
        values (${A}, 'local', 'runtime-alpha', 'ready', '2026.08.28-9', '2026.08.28-9')`;
      await sql`
        insert into runtime_task
          (business_id, kind, status, dedupe_key, result, completed_at)
        values
          (${A}, 'upgrade', 'completed', 'upgrade:region-test',
           ${sql.json({ region: 'fra' })}, now())`;
    });
    const response = await call('GET', '/api/runtime', testEnv({
      RUNTIME_EXPECTED_REGION: 'sin',
    }), ownerCookie);
    expect(response.status).toBe(200);
    expect((await response.json()).runtime).toMatchObject({
      observedRegion: 'fra',
      expectedRegion: 'sin',
      regionStatus: 'different',
    });
  });

  it('requires authentication and an owner', async () => {
    expect((await call('POST', '/api/runtime/provision', testEnv())).status).toBe(401);
    expect((await call('POST', '/api/runtime/provision', enabled(), staffCookie)).status).toBe(403);
  });

  it('does not create paid compute before onboarding is complete', async () => {
    await asOwner((sql) => sql`update business set onboarded = false where id = ${A}`);
    const response = await call('POST', '/api/runtime/provision', enabled(), ownerCookie);
    expect(response.status).toBe(409);
  });

  it('fails closed unless provisioning and secure transport are explicit', async () => {
    const disabled = await call('POST', '/api/runtime/provision', testEnv(), ownerCookie);
    expect(disabled.status).toBe(503);
    const insecure = await call('POST', '/api/runtime/provision', testEnv({
      RUNTIME_PROVISIONING_ENABLED: 'true',
    }), ownerCookie);
    expect(insecure.status).toBe(503);
    expect((await insecure.json()).err).toMatch(/secure model transport/);
    const noBootstrap = await call('POST', '/api/runtime/provision', testEnv({
      RUNTIME_PROVISIONING_ENABLED: 'true',
      MODEL_TRANSPORT_READY: 'true',
    }), ownerCookie);
    expect(noBootstrap.status).toBe(503);
    expect((await noBootstrap.json()).err).toMatch(/bootstrap is disabled/);
  });

  it('publishes one deduplicated provisioning task for any owner', async () => {
    const send = vi.fn(async () => {});
    const env = enabled(send);
    const first = await call('POST', '/api/runtime/provision', env, ownerCookie);
    const second = await call('POST', '/api/runtime/provision', env, ownerCookie);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((await second.json()).taskId).toBe((await first.json()).taskId);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ version: 1, businessId: A });
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from runtime_task where business_id = ${A}`);
    expect(count).toBe('1');
  });

  it('accepts the pinned production model gateway for a new account', async () => {
    const send = vi.fn(async () => {});
    const response = await call('POST', '/api/runtime/provision', enabled(send, {
      AISAR_MODEL_BASE: 'https://router.fmcv.my',
      AISAR_MODEL_NAME: 'MiniMax-M3',
    }), ownerCookie);

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, status: 'queued' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('cancels a durable run once and safely repeats its deduplicated stop signal', async () => {
    const send = vi.fn(async () => {});
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite',
      model: 'deepseek/deepseek-v4-flash-0731',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));
    await asTenant(A, (tx) => reserveRuntimeUsage(
      tx, A, task.id, 'deepseek/deepseek-v4-flash-0731'));
    await asOwner((sql) => sql`
      update runtime_task set remote_run_id = 'run-hermes-1', remote_status = 'running'
       where id = ${task.id}`);

    const first = await call(
      'POST', `/api/runtime/tasks/${task.id}/cancel`, enabled(send), ownerCookie,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, taskId: task.id, status: 'cancelled' });
    const second = await call(
      'POST', `/api/runtime/tasks/${task.id}/cancel`, enabled(send), ownerCookie,
    );
    expect(second.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);

    const [state] = await asOwner((sql) => sql<{
      task_status: string; run_status: string; usage_status: string;
      usage_input: string; usage_output: string;
    }[]>`
      select t.status as task_status, r.status as run_status, u.status as usage_status,
             u.input_tokens::text as usage_input, u.output_tokens::text as usage_output
        from runtime_task t join run r on r.id = t.run_id
        join runtime_usage u on u.runtime_task_id = t.id
       where t.id = ${task.id}`);
    expect(state).toEqual({
      task_status: 'cancelled', run_status: 'cancelled', usage_status: 'cancelled',
      usage_input: '0', usage_output: '0',
    });
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from runtime_task where kind = 'cancel'`);
    expect(count).toBe('1');
  });

  it('settles the admitted live bubble with a visible cancelled note for a queued Telegram run', async () => {
    const send = vi.fn(async () => {});
    const telegram = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', telegram);
    const env = enabled(send);

    const conn = await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '128',
      displayName: '@alpha_bot',
      secret: '123456789:AAtoken',
      connectedBy: ownerId,
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      dedupeKey: 'run:cancel-queued-telegram',
      payload: {
        input: 'hello',
        telegram: {
          connectionId: conn.id, chatId: 42, from: 'owner',
          text: 'hello', privateChat: true, liveMessageId: 55,
        },
        objective: 'Reply to the owner',
        function: 'assistant',
        channel: 'telegram',
      },
    }));

    const response = await call(
      'POST', `/api/runtime/tasks/${task.id}/cancel`, env, ownerCookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, taskId: task.id, status: 'cancelled' });

    /* The admission bubble (message 55) is edited in place with the
       cancelled note — never the input-field draft API. */
    const editCalls = telegram.mock.calls.filter(([input]) => {
      const url = String(input);
      return url.includes('/editMessageText');
    });
    expect(editCalls.length).toBe(1);
    const body = JSON.parse((editCalls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(42);
    expect(body.message_id).toBe(55);
    expect(body.text).toContain('⚠️ Cancelled');
    expect(body.text).toContain('stopped');
    expect(telegram.mock.calls.some(([input]) => String(input).includes('Draft'))).toBe(false);
  });
});

function enabled(
  send = vi.fn(async () => {}),
  overrides: Partial<Env> = {},
): Env {
  return testEnv({
    RUNTIME_RELEASE: '2026.08.27-1',
    RUNTIME_BUNDLE_COMMIT: 'a'.repeat(40),
    RUNTIME_PROVISIONING_ENABLED: 'true',
    MODEL_TRANSPORT_READY: 'true',
    RUNTIME_BOOTSTRAP_ENABLED: 'true',
    RUNTIME_EXECUTION_ENABLED: 'true',
    SPRITES_TOKEN: 'sprite-test-token',
    AISAR_OPENROUTER_MANAGEMENT_KEY: 'm'.repeat(32),
    AISAR_MODEL_PROVIDER: 'openrouter',
    AISAR_MODEL_BASE: 'https://openrouter.ai/api/v1',
    AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    RUNTIME_QUEUE: { send },
    ...overrides,
  });
}

async function call(method: string, path: string, env: Env, cookie?: string) {
  const { request, url } = req(method, path, { cookie });
  const response = await handleRuntime(request, env, url, {});
  if (!response) throw new Error('runtime route did not match');
  return response;
}
