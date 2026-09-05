import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import {
  ensureProviderRuntime,
  handleRuntimeMessage,
  handleRuntimeQueueMessage,
  LocalRuntimeProvider,
} from '../src/runtime';
import { enqueueRuntimeTask, leaseRuntimeTask, nextWaitingRuntimeTaskId, runtimeQueuePosition } from '../src/runtime/tasks';
import { telegramFloodDelaySeconds, wakeNextRuntimeTask } from '../src/runtime/consumer';
import type { DesiredRuntime, ObservedRuntime, RuntimeProvider } from '../src/runtime';
import { markRuntimeReady, storeRuntimeModelCredential } from '../src/agent-runtime';
import { startRun } from '../src/runs';
import { bindTelegramInternalChat, saveConnection } from '../src/connections';

const A = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`
    insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the runtime queue consumer', () => {
  it('leases, provisions, and completes one durable task', async () => {
    const task = await provisionTask();
    const result = await handleRuntimeMessage(
      testEnv({ RUNTIME_RELEASE: '2026.08.27-1' }),
      { version: 1, businessId: A, taskId: task.id },
      { provider: new LocalRuntimeProvider() },
    );
    expect(result).toEqual({ action: 'ack', reason: 'completed' });
    expect((await taskStatus(task.id)).status).toBe('completed');
    const [runtime] = await asOwner((sql) => sql<{ provider_id: string | null }[]>`
      select provider_id from agent_runtime where business_id = ${A}`);
    expect(runtime.provider_id).toBeTruthy();
  });

  it('acknowledges duplicate delivery without provisioning twice', async () => {
    const task = await provisionTask();
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provider = new LocalRuntimeProvider();
    const message = { version: 1 as const, businessId: A, taskId: task.id };
    await handleRuntimeMessage(env, message, { provider });
    expect(await handleRuntimeMessage(env, message, { provider }))
      .toEqual({ action: 'ack', reason: 'already_done' });
  });

  it('does not rerun a stale release repair after the current runtime is ready', async () => {
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.28-12' });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.28-12', 'v1'));
    const repair = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'upgrade',
      dedupeKey: 'upgrade:stale-release-repair',
      payload: { release: '2026.08.28-11', reason: 'release_drift' },
    }));
    const unavailable: RuntimeProvider = {
      id: 'local',
      create: async () => { throw new Error('stale repair touched provider compute'); },
      wake: async (runtime) => runtime,
      stop: async () => {},
      status: async (runtime) => runtime,
      checkpoint: async () => 'v1',
      restore: async () => {},
      destroy: async () => {},
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: repair.id },
      { provider: unavailable },
    )).resolves.toEqual({ action: 'ack', reason: 'completed' });
    expect((await taskStatus(repair.id)).status).toBe('completed');
  });

  it('releases a failed lease before asking Queue to retry', async () => {
    const task = await provisionTask();
    const broken: RuntimeProvider = {
      id: 'local',
      create: async (_runtime: DesiredRuntime) => { throw new Error('provider unavailable'); },
      wake: async (runtime: ObservedRuntime) => runtime,
      stop: async () => {},
      status: async (runtime: ObservedRuntime) => runtime,
      checkpoint: async () => 'v1',
      restore: async () => {},
      destroy: async () => {},
    };
    const result = await handleRuntimeMessage(
      testEnv({ RUNTIME_RELEASE: '2026.08.27-1' }),
      { version: 1, businessId: A, taskId: task.id },
      { provider: broken },
    );
    expect(result.action).toBe('requeue');
    const row = await taskStatus(task.id);
    expect(row.status).toBe('failed');
    expect(row.lease_token).toBeNull();
  });

  it('drops malformed messages without touching Postgres', async () => {
    expect(await handleRuntimeMessage(
      testEnv(),
      { version: 1, businessId: 'not-a-uuid', taskId: 'also-not' },
    )).toEqual({ action: 'ack', reason: 'missing' });
  });

  it('stops retrying a permanently broken provider after five attempts', async () => {
    const task = await provisionTask();
    const broken: RuntimeProvider = {
      id: 'local',
      create: async () => { throw new Error('still unavailable'); },
      wake: async (runtime) => runtime,
      stop: async () => {},
      status: async (runtime) => runtime,
      checkpoint: async () => 'v1',
      restore: async () => {},
      destroy: async () => {},
    };
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const message = { version: 1 as const, businessId: A, taskId: task.id };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await handleRuntimeMessage(env, message, { provider: broken });
      expect(result.action).toBe('requeue');
      await asOwner((sql) => sql`
        update runtime_task set available_at = now() where id = ${task.id}`);
    }
    expect(await handleRuntimeMessage(env, message, { provider: broken }))
      .toEqual({ action: 'ack', reason: 'failed' });
    expect((await taskStatus(task.id)).status).toBe('exhausted');
    expect(await handleRuntimeMessage(env, message, { provider: broken }))
      .toEqual({ action: 'ack', reason: 'already_done' });
  });

  it('durably deletes provider compute and encrypted runtime credentials', async () => {
    const provider = new LocalRuntimeProvider();
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provision = await provisionTask();
    await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: provision.id }, { provider });
    const deletion = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'delete', dedupeKey: 'delete:test',
    }));
    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: deletion.id },
      { provider },
    )).resolves.toEqual({ action: 'ack', reason: 'completed' });
    const [{ count }] = await asOwner((sql) => sql<{ count: string }[]>`
      select count(*)::text as count from agent_runtime where business_id = ${A}`);
    expect(count).toBe('0');
  });

  it('defers active work behind one on-demand model-key rotation', async () => {
    const sent: unknown[] = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_OPENROUTER_MANAGEMENT_KEY: 'm'.repeat(32),
      RUNTIME_QUEUE: { send: async (message: unknown) => { sent.push(message); } },
    });
    await ensureProviderRuntime(env, A, {
      provider: new LocalRuntimeProvider(),
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.27-1', 'v1'));
    await asTenant(A, (tx) => storeRuntimeModelCredential(env, tx, A, {
      key: `sk-or-${'k'.repeat(40)}`,
      hash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    }));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'test-model',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `run:${run.id}`, payload: { input: 'hello' },
    }));

    await expect(handleRuntimeMessage(env, {
      version: 1, businessId: A, taskId: task.id,
    })).resolves.toEqual({
      action: 'requeue', delaySeconds: 30, reason: 'runtime credential maintenance',
    });
    const rows = await asOwner((sql) => sql<{ kind: string; status: string }[]>`
      select kind, status from runtime_task where business_id = ${A} order by kind`);
    expect(rows).toEqual([
      { kind: 'run', status: 'queued' },
      { kind: 'upgrade', status: 'queued' },
    ]);
    expect(sent).toHaveLength(1);
  });

  it('parks a queued task behind an active run and schedules a lease-aligned watchdog', async () => {
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provider = new LocalRuntimeProvider();
    const active = await provisionTask();
    await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: active.id }, { provider });

    // Simulate an in-flight run: lease a fresh task by hand with a 300s horizon.
    const running = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'watchdog:running',
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, running.id, 'lease-token', 300))).outcome).toBe('leased');

    const waiting = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'watchdog:waiting',
    }));
    const result = await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: waiting.id }, { provider });
    expect(result.action).toBe('requeue');
    expect(result.reason).toContain('busy');
    // Fresh 300s sibling lease → watchdog aligned to its horizon, capped at 120s.
    expect(result.delaySeconds).toBe(120);
    // The task stays parked in the durable queue, untouched.
    expect((await taskStatus(waiting.id)).status).toBe('queued');
  });

  it('reclaims a stale sibling after the runner proves it terminal and wakes FIFO', async () => {
    const sent: { businessId: string; taskId: string }[] = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      RUNTIME_QUEUE: {
        send: async (message: { businessId: string; taskId: string }) => { sent.push(message); },
      },
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    const running = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', dedupeKey: 'orphan:terminal', payload: { input: 'old run' },
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, running.id, 'orphan-lease'))).outcome).toBe('leased');
    await asOwner((sql) => sql`
      update runtime_task
         set lease_expires_at = now() + interval '30 seconds',
             remote_run_id = 'hermes-orphan', remote_status = 'running'
       where id = ${running.id}`);
    const waiting = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'orphan:waiting',
    }));
    let probes = 0;
    const probeFetch: typeof fetch = async (input) => {
      expect(String(input)).toContain(`/v1/tasks/${running.id}`);
      probes += 1;
      return jsonResponse({ ok: true, status: 'completed' });
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: waiting.id },
      { provider, fetch: probeFetch },
    )).resolves.toEqual({
      action: 'requeue',
      delaySeconds: 65,
      reason: 'orphan_reclaimed — freed a dead lease',
    });
    expect(probes).toBe(1);
    const [orphan] = await asOwner((sql) => sql<{
      status: string;
      attempt: number;
      lease_token: string | null;
      lease_expires_at: Date | null;
      last_error: string | null;
    }[]>`
      select status, attempt, lease_token, lease_expires_at, last_error
        from runtime_task where id = ${running.id}`);
    expect(orphan).toEqual({
      status: 'failed',
      attempt: 1,
      lease_token: null,
      lease_expires_at: null,
      last_error: 'orphan_reclaimed',
    });
    expect(sent.map((message) => message.taskId)).toEqual([running.id]);
    expect((await taskStatus(waiting.id)).status).toBe('queued');
  });

  it('keeps a stale sibling lease when the runner reports it non-terminal', async () => {
    const sent: { businessId: string; taskId: string }[] = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      RUNTIME_QUEUE: {
        send: async (message: { businessId: string; taskId: string }) => { sent.push(message); },
      },
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    const running = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run', dedupeKey: 'orphan:active', payload: { input: 'live run' },
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, running.id, 'live-lease'))).outcome).toBe('leased');
    await asOwner((sql) => sql`
      update runtime_task set lease_expires_at = now() + interval '30 seconds'
       where id = ${running.id}`);
    const waiting = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'orphan:still-waiting',
    }));
    let probes = 0;
    const probeFetch: typeof fetch = async () => {
      probes += 1;
      return jsonResponse({ ok: true, status: 'running' });
    };

    await expect(handleRuntimeMessage(
      env,
      { version: 1, businessId: A, taskId: waiting.id },
      { provider, fetch: probeFetch },
    )).resolves.toEqual({
      action: 'requeue',
      delaySeconds: 65,
      reason: 'business runtime is busy — waiting to recheck a stale lease',
    });
    expect(probes).toBe(1);
    const [active] = await asOwner((sql) => sql<{
      status: string; attempt: number; lease_token: string | null;
    }[]>`
      select status, attempt, lease_token from runtime_task where id = ${running.id}`);
    expect(active).toEqual({ status: 'leased', attempt: 0, lease_token: 'live-lease' });
    expect(sent).toEqual([]);
    expect((await taskStatus(waiting.id)).status).toBe('queued');
  });

  it('acks a fresh duplicate intake self-lease but rechecks it once stale', async () => {
    const env = testEnv({ RUNTIME_RELEASE: '2026.08.27-1' });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('duplicate-lease@example.com', true) returning id`);
    const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123456789',
      displayName: '@duplicate_bot',
      secret: '123456789:AAtoken',
      connectedBy: owner.id,
    }));
    const message = {
      version: 2 as const,
      kind: 'telegram_intake' as const,
      businessId: A,
      connectionId: connection.id,
      requestedAtMs: Date.now(),
      incoming: {
        chatId: 42,
        messageId: 901,
        from: 'Owner',
        text: 'Duplicate delivery',
        privateChat: true as const,
      },
    };
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      dedupeKey: `telegram:${connection.id}:42:901`,
      payload: {
        input: 'Duplicate delivery',
        telegram: {
          connectionId: connection.id,
          chatId: 42,
          messageId: 901,
          from: 'Owner',
          question: 'Duplicate delivery',
          privateChat: true,
          liveMessageId: 77,
        },
      },
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, task.id, 'duplicate-owner'))).outcome).toBe('leased');

    await expect(handleRuntimeQueueMessage(env, message, { provider }))
      .resolves.toEqual({ action: 'ack', reason: 'already_done' });

    await asOwner((sql) => sql`
      update runtime_task set lease_expires_at = now() + interval '30 seconds'
       where id = ${task.id}`);
    let probes = 0;
    const probeFetch: typeof fetch = async () => {
      probes += 1;
      return jsonResponse({ ok: true, status: 'running' });
    };
    const stale = await handleRuntimeQueueMessage(env, message, { provider, fetch: probeFetch });
    expect(stale).toMatchObject({
      action: 'requeue',
      delaySeconds: 65,
      reason: 'business runtime is busy — waiting to recheck a stale lease',
      nextMessage: { version: 1, businessId: A, taskId: task.id },
    });
    expect(probes).toBe(1);
    expect(await taskStatus(task.id)).toEqual({ status: 'leased', lease_token: 'duplicate-owner' });
  });

  it('uses one stable Telegram session per business chat', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      AISAR_MODEL_NAME: 'MiniMax-M3',
      AISAR_DEEP_MODEL_NAME: 'deepseek-v4-flash',
    });
    const provider = new LocalRuntimeProvider();
    const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('session-owner@example.com', true) returning id`);
    const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123456789',
      displayName: '@session_bot',
      secret: '123456789:AAtoken',
      connectedBy: owner.id,
    }));
    const active = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'telegram-session:active',
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, active.id, 'active-owner', 300))).outcome).toBe('leased');
    let liveMessageId = 70;
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ ok: true, result: { message_id: liveMessageId++ } })));
    const intake = (chatId: number, messageId: number, text: string) => ({
      version: 2 as const,
      kind: 'telegram_intake' as const,
      businessId: A,
      connectionId: connection.id,
      requestedAtMs: Date.now(),
      incoming: {
        chatId,
        messageId,
        from: 'Owner',
        text,
        privateChat: true as const,
      },
    });

    await handleRuntimeQueueMessage(env, intake(42, 901, 'First message'), { provider });
    await handleRuntimeQueueMessage(env, intake(42, 902, 'yes'), { provider });
    await handleRuntimeQueueMessage(env, intake(43, 903, 'Other chat'), { provider });

    const tasks = await asTenant(A, (tx) => tx<{
      payload: { sessionId: string; telegram: { messageId: number } };
    }[]>`
      select payload from runtime_task
       where business_id = ${A} and kind = 'run'
       order by (payload->'telegram'->>'messageId')::int`);
    const sessionIds = tasks.map((task) => task.payload.sessionId);
    expect(sessionIds.slice(0, 2)).toEqual([
      `telegram:${A}:42`,
      `telegram:${A}:42`,
    ]);
    expect(sessionIds[2]).toBe(`telegram:${A}:43`);
    expect(sessionIds[2]).not.toBe(sessionIds[0]);
  });

  it('wakes the oldest waiting task when a task completes (Hermes-style FIFO)', async () => {
    const sent: { businessId: string; taskId: string }[] = [];
    const env = testEnv({
      RUNTIME_RELEASE: '2026.08.27-1',
      RUNTIME_QUEUE: { send: async (m: { businessId: string; taskId: string }) => { sent.push(m); } },
    });
    const provider = new LocalRuntimeProvider();
    const enqueue = (key: string) => asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: key,
    }));
    const first = await enqueue('fifo:first');
    await new Promise((r) => setTimeout(r, 10));
    const second = await enqueue('fifo:second');
    await new Promise((r) => setTimeout(r, 10));
    const third = await enqueue('fifo:third');

    // No one is running yet: a wake picks the oldest (first).
    await wakeNextRuntimeTask(env, A);
    expect(sent.map((m) => m.taskId)).toEqual([first.id]);

    // Completing the first must wake the next oldest (second), and so on.
    sent.length = 0;
    await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: first.id }, { provider });
    expect((await taskStatus(first.id)).status).toBe('completed');
    expect(sent.map((m) => m.taskId)).toEqual([second.id]);

    sent.length = 0;
    await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: second.id }, { provider });
    expect(sent.map((m) => m.taskId)).toEqual([third.id]);

    // Third completes: nothing left to wake.
    sent.length = 0;
    await handleRuntimeMessage(env, { version: 1, businessId: A, taskId: third.id }, { provider });
    expect(sent).toEqual([]);
  });

  it('reports how many tasks are ahead for queue acknowledgements', async () => {
    const active = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'provision', dedupeKey: 'pos:active',
    }));
    expect((await asTenant(A, (tx) =>
      leaseRuntimeTask(tx, A, active.id, 'lease-token', 300))).outcome).toBe('leased');
    await new Promise((r) => setTimeout(r, 10));
    const b = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, { kind: 'provision', dedupeKey: 'pos:b' }));
    await new Promise((r) => setTimeout(r, 10));
    const c = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, { kind: 'provision', dedupeKey: 'pos:c' }));

    const ahead = (id: string) => asTenant(A, (tx) => runtimeQueuePosition(tx, A, id));
    expect(await ahead(active.id)).toBe(0);
    expect(await ahead(b.id)).toBe(1);
    expect(await ahead(c.id)).toBe(2);

    // FIFO next-in-line is b (oldest waiting), not the most recent arrival.
    expect(await asTenant(A, (tx) => nextWaitingRuntimeTaskId(tx, A))).toBe(b.id);
  });

  it('backs off escalating Telegram floods, restores the terminal DB snapshot, and notifies once', async () => {
    const env = testEnv({
      RUNTIME_RELEASE: '2026.09.01-3',
      AISAR_MODEL_NAME: 'MiniMax-M3',
      AISAR_DEEP_MODEL_NAME: 'deepseek-v4-flash',
    });
    const provider = new LocalRuntimeProvider();
    await ensureProviderRuntime(env, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.09.01-3', 'v1'));
    const [owner] = await asOwner((sql) => sql<{ id: string }[]>`
      insert into app_user (email, email_verified)
      values ('flood-owner@example.com', true) returning id`);
    const connection = await asTenant(A, (tx) => saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123456789',
      displayName: '@alpha_bot',
      secret: '123456789:AAtoken',
      connectedBy: owner.id,
    }));
    await asTenant(A, (tx) => bindTelegramInternalChat(tx, connection.id, 42));
    const run = await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask',
      triggerShape: 'owner.message.telegram',
      runtime: 'hermes-sprite',
      model: 'deepseek-v4-flash',
    }));
    const task = await asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
      kind: 'run',
      runId: run.id,
      dedupeKey: `telegram:flood:${run.id}`,
      payload: {
        input: 'Prepare the final answer.',
        objective: 'Answer the owner',
        function: 'assistant',
        channel: 'telegram',
        responseMode: 'deep',
        model: 'deepseek-v4-flash',
        telegram: {
          connectionId: connection.id,
          chatId: 42,
          messageId: 7,
          from: 'Owner',
          question: 'What changed?',
          privateChat: true,
          liveMessageId: 77,
        },
      },
    }));

    let statusPolls = 0;
    const runnerFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return jsonResponse({
          ok: true,
          release: '2026.09.01-3',
          runner: { sourceAttested: true, sourceSha256: 'a'.repeat(64) },
          hermes: { jenteraPatch: 'jentera-runtime-2026-09-06' },
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          hermesRunId: 'run-hermes-flood',
          status: statusPolls === 0 ? 'started' : 'completed',
        }, statusPolls === 0 ? 202 : 200);
      }
      if (url.endsWith(`/v1/tasks/${task.id}/events`)) {
        return new Response('data: {"type":"done"}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (url.endsWith(`/v1/tasks/${task.id}`)) {
        statusPolls += 1;
        return statusPolls === 1
          ? jsonResponse({
              ok: true,
              status: 'completed',
              output: 'Final customer answer.',
              reasoning: 'Bounded reasoning.',
              usage: { input_tokens: 100, output_tokens: 20 },
            })
          : jsonResponse({ ok: false, error: 'Hermes status failed' }, 502);
      }
      return jsonResponse({ error: 'not found' }, 404);
    };

    const reportedWaits = [49, 129, 600];
    let answerAttempts = 0;
    let notices = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as {
        text?: string;
      } : {};
      if (url.endsWith('/editMessageText') && body.text?.includes('Final customer answer.')) {
        const wait = reportedWaits[answerAttempts++];
        return jsonResponse({
          ok: false,
          description: `Too Many Requests: retry after ${wait}`,
        }, 429);
      }
      if (url.endsWith('/sendMessage') && body.text?.includes('Telegram is rate-limiting')) {
        notices += 1;
        return jsonResponse({ ok: true, result: { message_id: 88 } });
      }
      return jsonResponse({ ok: true, result: { message_id: 77 } });
    }));

    const message = { version: 1 as const, businessId: A, taskId: task.id };
    const expectedDelays = [109, 258, 1_200];
    for (let index = 0; index < expectedDelays.length; index += 1) {
      await expect(handleRuntimeMessage(env, message, { provider, fetch: runnerFetch }))
        .resolves.toEqual({
          action: 'requeue',
          delaySeconds: expectedDelays[index],
          reason: `telegram flood-wait ${reportedWaits[index]}s`,
        });
      const [state] = await asOwner((sql) => sql<{
        status: string;
        attempt: number;
        available_at: Date;
        remote_status: string;
        result: Record<string, unknown>;
      }[]>`
        select status, attempt, available_at, remote_status, result
          from runtime_task where id = ${task.id}`);
      expect(state.status).toBe('queued');
      expect(state.attempt).toBe(0);
      expect(state.available_at.getTime() - Date.now())
        .toBeGreaterThan((expectedDelays[index] - 5) * 1_000);
      expect(state.remote_status).toBe('completed');
      expect(state.result).toMatchObject({
        flood_wait_seconds: reportedWaits[index],
        flood_owner_notified: index >= 1,
        terminal_outcome: {
          remoteStatus: 'completed',
          result: 'Final customer answer.',
          reasoning: 'Bounded reasoning.',
        },
      });
      if (index < expectedDelays.length - 1) {
        await asOwner((sql) => sql`
          update runtime_task set available_at = now() where id = ${task.id}`);
      }
    }
    expect(statusPolls).toBe(3);
    expect(answerAttempts).toBe(3);
    expect(notices).toBe(1);
    expect(telegramFloodDelaySeconds(5_000)).toBe(3_600);
  });
});

const provisionTask = () => asTenant(A, (tx) => enqueueRuntimeTask(tx, A, {
  kind: 'provision',
  dedupeKey: `provision:${A}`,
}));

const taskStatus = (id: string) => asOwner(async (sql) => {
  const [row] = await sql<{ status: string; lease_token: string | null }[]>`
    select status, lease_token from runtime_task where id = ${id}`;
  return row;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
