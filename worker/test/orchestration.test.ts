/* ============================================================
   What happens when a customer sends a message.

   The sequencing, not the pieces. Retrieval, drafting, the approval
   gate and the send each have their own tests; this asks whether they
   fire in the right order, whether the run and the work record agree
   with each other afterwards, and — the part that actually matters —
   whether anything reaches a customer that the owner did not allow.

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

const incoming = {
  chatId: 42,
  messageId: 501,
  from: 'Aminah',
  text: 'Are you open on Sunday?',
};

/** Telegram, faked at the wire so sendMessage's real request-building
    still runs. Records what would have gone to a customer. */
function telegramAccepts() {
  sent = [];
  typing = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
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

describe('the default: nothing goes out unasked', () => {
  it('drafts, stops, and sends nothing', async () => {
    /* No policy set at all. The default has to be the safe one,
       because most businesses will never open this screen. */
    await handleIncoming(env, A, connId, incoming);

    expect(sent, 'a customer was messaged without approval').toHaveLength(0);
    expect((await runRow()).status).toBe('needs_approval');
    expect((await approvals())[0].status).toBe('pending');
  });

  it('puts the question and the draft in front of the owner', async () => {
    await handleIncoming(env, A, connId, incoming);
    const [a] = await approvals();
    expect(a.args.question).toBe('Are you open on Sunday?');
    expect(a.args.from).toBe('Aminah');
    expect(a.args.draft).toBeTruthy();
    // The connection travels with it, or approving cannot find the bot.
    expect(a.args.connectionId).toBe(connId);
    expect(a.args.chatId).toBe(42);
  });

  it('leaves one work record, tied to the approval', async () => {
    /* The link the decision follows back: without it, approving finds
       no run to amend and the record stays "waiting for you" forever. */
    await handleIncoming(env, A, connId, incoming);
    const w = await workRow();
    const [a] = await approvals();
    expect(w.status).toBe('needs_approval');
    expect(w.approval_id).toBe(a.id);
  });

  it('records the sequence in order', async () => {
    await handleIncoming(env, A, connId, incoming);
    expect(await trace()).toEqual([
      'work.requested',
      'action.proposed',
      'approval.requested',
    ]);
  });
});

describe('when the owner has blocked sending', () => {
  it('stops before drafting is offered, and sends nothing', async () => {
    await setPolicy('blocked');
    await handleIncoming(env, A, connId, incoming);

    expect(sent).toHaveLength(0);
    expect(await approvals(), 'a blocked action must not queue for approval').toHaveLength(0);
    expect((await runRow()).status).toBe('cancelled');
  });

  it('says it was their setting, not a failure', async () => {
    /* An owner who blocked sending and then sees "failed" will think
       the product is broken rather than obedient. */
    await setPolicy('blocked');
    await handleIncoming(env, A, connId, incoming);
    const w = await workRow();
    expect(w.status).toBe('blocked');
    expect(w.outcome).toMatch(/your settings/i);
  });
});

describe('when the owner has allowed it', () => {
  it('sends without asking', async () => {
    await setPolicy('automatic');
    await handleIncoming(env, A, connId, incoming);

    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(42);
    expect(await approvals()).toHaveLength(0);
    expect((await runRow()).status).toBe('completed');
  });

  it('shows typing while composing an automatic reply', async () => {
    await setPolicy('automatic');
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
  it('deduplicates Telegram retries before they can buy a second Hermes run', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const queued: unknown[] = [];
    const durableEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_BUSINESS_IDS: A,
      AISAR_MODEL_NAME: 'deepseek/deepseek-v4-flash-0731',
      RUNTIME_QUEUE: { send: async (message: unknown) => { queued.push(message); } },
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
    expect(sent).toHaveLength(0);
    expect(typing).toContainEqual({ chatId: 42, action: 'typing' });
  });

  it('delivers the final Hermes answer and does not retain it on the runtime task', async () => {
    await setPolicy('automatic');
    const provider = new LocalRuntimeProvider();
    const queued: { version: 1; businessId: string; taskId: string }[] = [];
    const durableEnv = testEnv({
      RUNTIME_RELEASE: '2026.08.28-4',
      RUNTIME_EXECUTION_BUSINESS_IDS: A,
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

    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/readyz')) {
        return runnerResponse({
          ok: true,
          toolMode: 'no-tools',
          edgeAuthorizationForwarded: false,
        });
      }
      if (url.endsWith('/v1/tasks') && init?.method === 'POST') {
        return runnerResponse({ ok: true, hermesRunId: 'telegram-hermes-1', status: 'started' }, 202);
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

    expect(sent).toContainEqual({ chatId: 42, text: 'Yes, we are open on Sunday.' });
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

  it('reads the policy of that business only', async () => {
    /* B allowing automatic sending must not make A send without
       asking. */
    await asTenant(
      B,
      (tx) => tx`insert into action_policy (business_id, op, policy) values (${B}, 'send', 'automatic')`,
    );
    await handleIncoming(env, A, connId, incoming);
    expect(sent).toHaveLength(0);
    expect((await runRow()).status).toBe('needs_approval');
  });
});

function runnerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
