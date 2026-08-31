/* ============================================================
   What happens when the paired owner sends a message.

   The sequencing, not the pieces. Retrieval, drafting and sending each
   have their own tests; this asks whether they fire in the right order
   and whether the run and work record agree afterwards. Telegram is the
   paired owner's internal chat here, not a customer-facing channel.

   The database is real, and so is `withTenant`: Hyperdrive needs only
   a connection string, so the genuine transaction-and-RLS path runs.
   Only the model and the outbound HTTP are substituted, because those
   are the two things that would leave the machine.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';
import { handleIncoming } from '../src/routes/connect';
import { saveConnection } from '../src/connections';
import { recordFact } from '../src/facts';
import type { Env } from '../src/env';
import { markRuntimeReady } from '../src/agent-runtime';
import { ensureProviderRuntime } from '../src/runtime/provision';
import { handleRuntimeMessage, LocalRuntimeProvider } from '../src/runtime';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let connId: string;
let userId: string;
let sent: { chatId: unknown; text: unknown }[];
let typing: { chatId: unknown; action: unknown }[];
let edits: { chatId: unknown; messageId: unknown; text: unknown }[];
let deletions: { chatId: unknown; messageId: unknown }[];

const incoming = {
  chatId: 42,
  messageId: 501,
  from: 'Aminah',
  text: 'Are you open on Sunday?',
  privateChat: true,
};

/** Telegram, faked at the wire so sendMessage's real request-building
    still runs. Records what would have gone to the paired owner. */
function telegramAccepts() {
  sent = [];
  typing = [];
  edits = [];
  deletions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('editMessageText')) {
        const body = JSON.parse(String(init.body)) as {
          chat_id: unknown; message_id: unknown; text: unknown;
        };
        edits.push({ chatId: body.chat_id, messageId: body.message_id, text: body.text });
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      if (String(url).includes('deleteMessage')) {
        const body = JSON.parse(String(init.body)) as {
          chat_id: unknown; message_id: unknown;
        };
        deletions.push({ chatId: body.chat_id, messageId: body.message_id });
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      if (String(url).includes('sendRichMessage')) {
        const body = JSON.parse(String(init.body)) as {
          chat_id: unknown; rich_message?: { markdown?: unknown };
        };
        sent.push({ chatId: body.chat_id, text: body.rich_message?.markdown });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }));
      }
      if (String(url).includes('sendMessage')) {
        const body = JSON.parse(String(init.body)) as { chat_id: unknown; text: unknown };
        sent.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }));
      }
      if (String(url).includes('sendChatAction')) {
        const body = JSON.parse(String(init.body)) as { chat_id: unknown; action: unknown };
        typing.push({ chatId: body.chat_id, action: body.action });
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }),
  );
}

function telegramRefuses() {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 }),
    ),
  );
}

const setPolicy = (level: 'automatic' | 'approval' | 'blocked') =>
  asTenant(
    A,
    (tx) => tx`insert into action_policy (business_id, op, policy) values (${A}, 'send', ${level})
               on conflict (business_id, op) do update set policy = excluded.policy`,
  );

const trace = () =>
  asTenant(A, async (tx) => {
    const rows = await tx<{ type: string }[]>`
      select e.type from run_event e join run r on r.id = e.run_id order by e.seq`;
    return rows.map((r) => r.type);
  });

const runRow = () =>
  asTenant(A, async (tx) => {
    const [r] = await tx<{ kind: string; status: string }[]>`
      select kind, status from run limit 1`;
    return r;
  });

const workRow = () =>
  asTenant(A, async (tx) => {
    const [w] = await tx<{ status: string; outcome: string | null; approval_id: string | null }[]>`
      select status, outcome, approval_id from work_record limit 1`;
    return w;
  });

const approvals = () =>
  asTenant(A, (tx) => tx<{ id: string; status: string; args: Record<string, unknown> }[]>`
    select id, status, args from approval`);

let env: Env;

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`;
    await sql`insert into business (id, name, playbook_key) values (${B}, 'Beta', 'salon')`;
    const [u] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    userId = u.id;
  });
  env = testEnv();
  const c = await asTenant(A, (tx) =>
    saveConnection(env, tx, A, {
      connector: 'telegram',
      method: 'bot_token',
      externalId: '123',
      displayName: '@alpha_bot',
      secret: '123456789:AAtoken',
      connectedBy: userId,
    }),
  );
  connId = c.id;
  telegramAccepts();
});

afterEach(() => vi.unstubAllGlobals());

describe('the private owner chat', () => {
  it('does not apply the customer-send approval gate', async () => {
    await setPolicy('approval');
    await handleIncoming(env, A, connId, incoming);

    expect(sent).toHaveLength(1);
    expect(await approvals()).toHaveLength(0);
    expect((await runRow()).status).toBe('completed');
  });

  it('does not let a customer-send block disable the owner assistant', async () => {
    await setPolicy('blocked');
    await handleIncoming(env, A, connId, incoming);
    expect(sent).toHaveLength(1);
    expect(await approvals()).toHaveLength(0);
    expect((await runRow()).status).toBe('completed');
  });

  it('records the sequence in order', async () => {
    await handleIncoming(env, A, connId, incoming);
    expect(await trace()).toEqual([
      'work.requested',
      'action.proposed',
      'action.executed',
      'work.completed',
    ]);
  });
});

describe('the automatic default', () => {
  it('sends without requiring permission setup', async () => {
    await handleIncoming(env, A, connId, incoming);

    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(42);
    expect(await approvals()).toHaveLength(0);
    expect((await runRow()).status).toBe('completed');
  });

  it('shows typing while composing an automatic reply', async () => {
    await handleIncoming(env, A, connId, incoming);

    expect(typing).toContainEqual({ chatId: 42, action: 'typing' });
  });

  it('records that it executed, and what it saved', async () => {
    await setPolicy('automatic');
    await handleIncoming(env, A, connId, incoming);
    expect(await trace()).toContain('action.executed');
    const w = await workRow();
    expect(w.status).toBe('completed');
  });

  it('marks the connection as working', async () => {
    await setPolicy('automatic');
    await handleIncoming(env, A, connId, incoming);
    const [c] = await asTenant(A, (tx) => tx<{ ok: boolean }[]>`
      select last_ok_at is not null as ok from connection where id = ${connId}`);
    expect(c.ok).toBe(true);
  });
});

describe('durable Hermes Telegram replies', () => {
  it('preserves the Hermes request and upgrades before dispatching a stale runtime', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const oldEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-3',
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
    });
    await ensureProviderRuntime(oldEnv, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.28-3', 'v1'));

    const queued: { version: 1; businessId: string; taskId: string }[] = [];
    const currentEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
      RUNTIME_QUEUE: {
        send: async (message: { version: 1; businessId: string; taskId: string }) => {
          queued.push(message);
        },
      },
    });
    await handleIncoming(currentEnv, A, connId, incoming);

    /* The admission path acknowledges with a real bot-owned bubble (never an
       input-field draft), persisted on the task so the consumer streams into
       the same message. */
    expect(sent).toEqual([{ chatId: 42, text: '⏳ On it — waking the AI…' }]);
    expect(edits).toHaveLength(0);
    expect(deletions).toHaveLength(0);
    expect(queued).toHaveLength(1);

    await expect(handleRuntimeMessage(currentEnv, queued[0], { provider })).resolves.toEqual({
      action: 'requeue',
      delaySeconds: 30,
      reason: 'runtime release upgrade',
    });
    expect(queued).toHaveLength(2);
    const tasks = await asTenant(A, (tx) => tx<{
      kind: string; dedupe_key: string; payload: Record<string, unknown>;
    }[]>`select kind, dedupe_key, payload from runtime_task order by created_at`);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      kind: 'run',
      payload: {
        telegram: { connectionId: connId, chatId: 42, messageId: 501, liveMessageId: 99 },
      },
    });
    expect(tasks[1]).toMatchObject({
      kind: 'upgrade',
      dedupe_key: `upgrade:${A}:2026.08.28-4`,
      payload: { release: '2026.08.28-4', reason: 'release_drift' },
    });
  });

  it('deduplicates Telegram retries before they can buy a second Hermes run', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const queued: { version: 1; businessId: string; taskId: string }[] = [];
    const durableEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
      RUNTIME_QUEUE: {
        send: async (message: { version: 1; businessId: string; taskId: string }) => {
          queued.push(message);
        },
      },
    });
    await ensureProviderRuntime(durableEnv, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.28-4', 'v1'));

    await handleIncoming(durableEnv, A, connId, incoming);
    await handleIncoming(durableEnv, A, connId, incoming);

    const tasks = await asOwner((sql) => sql<{
      runtime: string; kind: string; payload: Record<string, unknown>;
    }[]>`
      select r.runtime, t.kind, t.payload
        from runtime_task t join run r on r.id = t.run_id
       where t.business_id = ${A}`);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].runtime).toBe('hermes-sprite');
    expect(tasks[0].kind).toBe('run');
    expect(tasks[0].payload.telegram).toMatchObject({
      connectionId: connId,
      chatId: 42,
      messageId: 501,
    });
    expect(queued).toHaveLength(2);
    /* One acknowledgment bubble despite two deliveries — the second is
       deduplicated before the placeholder fires (inserted=false). */
    expect(sent).toEqual([{ chatId: 42, text: '⏳ On it — waking the AI…' }]);
    expect(edits).toHaveLength(0);
  });

  it('delivers the final Hermes answer and does not retain it on the runtime task', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const queued: { version: 1; businessId: string; taskId: string }[] = [];
    const durableEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
      RUNTIME_QUEUE: {
        send: async (message: { version: 1; businessId: string; taskId: string }) => {
          queued.push(message);
        },
      },
    });
    await ensureProviderRuntime(durableEnv, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.28-4', 'v1'));
    await handleIncoming(durableEnv, A, connId, incoming);

    expect(typing).toContainEqual({ chatId: 42, action: 'typing' });

    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return runnerResponse({
          ok: true,
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return runnerResponse({ ok: true, hermesRunId: 'telegram-hermes-1', status: 'started' }, 202);
      }
      if (url.endsWith('/events')) {
        return new Response([
          'data: {"type":"tool.started","seq":1,"tool":"execute_code","preview":"import urllib.request"}',
          '',
          'data: {"type":"tool.completed","seq":2,"tool":"execute_code","duration":1.2,"error":false}',
          '',
          'data: {"type":"delta","seq":3,"delta":"Yes, "}',
          '',
          'data: {"type":"reasoning.available","text":"never show this"}',
          '',
          'data: {"type":"delta","seq":4,"delta":"we are open on Sunday."}',
          '',
          'data: {"type":"done"}',
          '',
        ].join('\n'), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.includes('/v1/tasks/')) {
        return runnerResponse({
          ok: true,
          status: 'completed',
          output: '<think>private final reasoning</think>Yes, we are open on Sunday.',
          usage: { input_tokens: 120, output_tokens: 9 },
        });
      }
      return runnerResponse({ error: 'not found' }, 404);
    };
    await expect(handleRuntimeMessage(durableEnv, queued[0], { provider, fetch: fetcher }))
      .resolves.toEqual({ action: 'ack', reason: 'completed' });

    expect(sent).toContainEqual({
      chatId: 42,
      text: '🐍 execute_code: "import urllib.request"',
    });
    expect(sent).toContainEqual({ chatId: 42, text: 'Yes, we are open on Sunday.' });
    /* The consumer reattaches to the admission bubble (message 99) and
       streams deltas into it by editing; the final combined text may stay
       coalesced inside the 24-char buffer when the run finishes fast, so
       the full sentence is asserted on the durable answer message instead.
       The bubble is deleted once the durable answer lands. */
    expect(edits).toContainEqual({ chatId: 42, messageId: 99, text: 'Yes, ' });
    expect(JSON.stringify(edits)).not.toContain('never show this');
    expect(JSON.stringify(sent)).not.toContain('private final reasoning');
    expect(deletions).toContainEqual({ chatId: 42, messageId: 99 });
    const [state] = await asOwner((sql) => sql<{
      task_result: unknown; task_payload: unknown; work_outcome: string; run_status: string;
    }[]>`
      select t.result as task_result, t.payload as task_payload,
             w.outcome as work_outcome, r.status as run_status
        from runtime_task t
        join run r on r.id = t.run_id
        join work_record w on w.run_id = r.id
       where t.id = ${queued[0].taskId}`);
    expect(state).toEqual({
      task_result: { delivery: 'sent' },
      task_payload: {},
      work_outcome: 'Yes, we are open on Sunday.',
      run_status: 'completed',
    });
  });

  it('streams @step narration as live bubble status and keeps it out of the answer', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const queued: { version: 1; businessId: string; taskId: string }[] = [];
    const durableEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_ENABLED: 'true',
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
      RUNTIME_QUEUE: {
        send: async (message: { version: 1; businessId: string; taskId: string }) => {
          queued.push(message);
        },
      },
    });
    await ensureProviderRuntime(durableEnv, A, {
      provider,
      runnerKey: 'r'.repeat(64),
      hermesApiKey: 'h'.repeat(64),
    });
    await asTenant(A, (tx) => markRuntimeReady(tx, A, '2026.08.28-4', 'v1'));
    await handleIncoming(durableEnv, A, connId, incoming);
    const stepLabel = 'Checking the MySQL docs…';

    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return runnerResponse({
          ok: true,
          toolMode: 'full-tools',
          webSearchBackend: 'ddgs',
          edgeAuthorizationForwarded: false,
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return runnerResponse({ ok: true, hermesRunId: 'step-hermes-1', status: 'started' }, 202);
      }
      if (url.endsWith('/events')) {
        /* The step label arrives split across two model deltas. The answer
           deltas start only after a real gap wider than the status cooldown,
           mirroring a real tool call: the held step gets flushed to the
           bubble before the answer replaces it. */
        const e = (line: string) => `${line}\n\n`;
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode(e('data: {"type":"delta","seq":1,"delta":"@step: Checking the "}')));
            controller.enqueue(enc.encode(e('data: {"type":"delta","seq":2,"delta":"MySQL docs…\\n"}')));
            await new Promise((resolve) => setTimeout(resolve, 650));
            controller.enqueue(enc.encode(e('data: {"type":"delta","seq":3,"delta":"Yes, "}')));
            controller.enqueue(enc.encode(e('data: {"type":"delta","seq":4,"delta":"we are open on Sunday."}')));
            controller.enqueue(enc.encode(e('data: {"type":"done"}')));
            controller.close();
          },
        });
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.includes('/v1/tasks/')) {
        return runnerResponse({
          ok: true,
          status: 'completed',
          output: 'Yes, we are open on Sunday.',
          usage: { input_tokens: 120, output_tokens: 9 },
        });
      }
      return runnerResponse({ error: 'not found' }, 404);
    };
    await expect(handleRuntimeMessage(durableEnv, queued[0], { provider, fetch: fetcher }))
      .resolves.toEqual({ action: 'ack', reason: 'completed' });

    /* The step label appears in the working bubble's status lane. */
    expect(edits.some((edit) =>
      typeof edit.text === 'string' && edit.text.includes(stepLabel))).toBe(true);
    /* Narration never leaks into the answer lane of the bubble nor into any
       sent message (tool lines, durable answer). */
    expect(JSON.stringify(edits)).not.toContain('@step:');
    expect(JSON.stringify(sent)).not.toContain('@step:');
    expect(JSON.stringify(sent)).not.toContain(stepLabel);
    /* The durable answer is still just the clean reply. */
    expect(sent).toContainEqual({ chatId: 42, text: 'Yes, we are open on Sunday.' });
    expect(deletions).toContainEqual({ chatId: 42, messageId: 99 });
  });
});

describe('when the send fails', () => {
  it('records the failure rather than claiming success', async () => {
    await setPolicy('automatic');
    telegramRefuses();
    await handleIncoming(env, A, connId, incoming);

    expect((await runRow()).status).toBe('failed');
    const w = await workRow();
    expect(w.status).toBe('failed');
    expect(w.outcome).toMatch(/chat not found/i);
  });

  it('does not leave the run looking like it is still working', async () => {
    /* A run stuck in 'working' is invisible to the owner and to any
       future reconciliation — it looks like something in flight
       forever. */
    await setPolicy('automatic');
    telegramRefuses();
    await handleIncoming(env, A, connId, incoming);
    expect((await runRow()).status).not.toBe('working');
  });
});

describe('what the draft is allowed to know', () => {
  it('draws on confirmed facts', async () => {
    await asTenant(A, (tx) =>
      recordFact(tx, A, {
        key: 'hours.sunday',
        value: '11am to 10pm',
        source: 'owner',
        confirmedBy: userId,
      }),
    );
    const seen: string[] = [];
    const spy = testEnv({
      AI: {
        run: async (_m: string, o: { messages: { content: string }[] }) => {
          seen.push(o.messages.map((m) => m.content).join('\n'));
          return { response: 'We open 11am Sunday.' };
        },
      },
    });
    await handleIncoming(spy, A, connId, incoming);
    expect(seen[0]).toContain('hours.sunday');
  });

  it('does not draw on an unconfirmed guess', async () => {
    /* The same rule as Ask, on the path where breaking it is worst:
       an unreviewed guess quoted straight to a customer. */
    await asTenant(A, (tx) =>
      recordFact(tx, A, { key: 'hours.sunday', value: 'closed', source: 'agent', confidence: 0.6 }),
    );
    const seen: string[] = [];
    const spy = testEnv({
      AI: {
        run: async (_m: string, o: { messages: { content: string }[] }) => {
          seen.push(o.messages.map((m) => m.content).join('\n'));
          return { response: 'x' };
        },
      },
    });
    await handleIncoming(spy, A, connId, incoming);
    expect(seen[0]).not.toContain('hours.sunday');
  });
});

describe('tenancy', () => {
  it('writes everything to the business that owns the connection', async () => {
    await handleIncoming(env, A, connId, incoming);
    // B sees none of it.
    expect(await asTenant(B, (tx) => tx`select id from run`)).toHaveLength(0);
    expect(await asTenant(B, (tx) => tx`select id from approval`)).toHaveLength(0);
    expect(await asTenant(B, (tx) => tx`select id from work_record`)).toHaveLength(0);
  });

  it('keeps another business’s policy irrelevant to this owner chat', async () => {
    await setPolicy('blocked');
    await asTenant(
      B,
      (tx) => tx`insert into action_policy (business_id, op, policy) values (${B}, 'send', 'automatic')`,
    );
    await handleIncoming(env, A, connId, incoming);
    expect(sent).toHaveLength(1);
    expect((await runRow()).status).toBe('completed');
  });
});

function runnerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
