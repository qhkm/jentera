import { beforeEach, describe, expect, it } from 'vitest';
import {
  expireRuntimeApproval,
  pauseRuntimeTaskForApproval,
  runtimeApprovalFromTask,
} from '../src/runtime/tasks';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '44444444-4444-4444-8444-444444444444';
const CONNECTION = '55555555-5555-4555-8555-555555555555';
const REQUEST = 'a'.repeat(32);

async function seedLeasedResume(): Promise<{ taskId: string; leaseToken: string }> {
  const taskId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key)
              values (${A}, 'Approval Test', 'restaurant')`;
    await sql`
      insert into runtime_task (id, business_id, kind, status, payload, dedupe_key,
                                lease_token, lease_expires_at, lease_heartbeat_at, attempt)
      values (${taskId}, ${A}, 'run', 'leased', '{}'::jsonb, ${taskId},
              ${leaseToken}, now() + interval '5 minutes', now(), 1)`;
  });
  return { taskId, leaseToken };
}

const readApproval = (taskId: string) => asTenant(A, async (tx) => {
  const [row] = await tx<{ id: string; kind: string; status: string; result: unknown }[]>`
    select id, kind, status, result from runtime_task where id = ${taskId}`;
  return runtimeApprovalFromTask(row as never);
});

beforeEach(async () => {
  await truncateAll();
});

describe('parking an approval that has nowhere to put a bubble', () => {
  it('parks a web approval durably instead of destroying the run', async () => {
    /* This is the change. Before it, a run whose agent asked for approval on
       any surface but a private Telegram chat threw before anything was
       written: no approval row, five retries, run failed. A question should
       not be able to destroy the work it was asked about. */
    const { taskId, leaseToken } = await seedLeasedResume();
    const parked = await asTenant(A, (tx) => pauseRuntimeTaskForApproval(tx, A, taskId, leaseToken, {
      requestId: REQUEST,
      tool: 'terminal',
      message: 'npm install -g wrangler',
      remoteRunId: 'run-1',
      delaySeconds: 60,
    }));
    expect(parked).not.toBeNull();
    expect(parked!.surface).toBe('web');
    expect(parked!.telegram).toBeUndefined();

    const stored = await readApproval(taskId);
    expect(stored?.surface).toBe('web');
    expect(stored?.tool).toBe('terminal');
    expect(stored?.message).toBe('npm install -g wrangler');
    expect(stored?.status).toBe('pending');
  });

  it('keeps the Telegram surface addressable', async () => {
    const { taskId, leaseToken } = await seedLeasedResume();
    const parked = await asTenant(A, (tx) => pauseRuntimeTaskForApproval(tx, A, taskId, leaseToken, {
      requestId: REQUEST,
      tool: 'terminal',
      message: 'rm -rf /tmp/x',
      telegram: { connectionId: CONNECTION, chatId: 42, messageId: 7 },
      remoteRunId: 'run-1',
      delaySeconds: 60,
    }));
    expect(parked!.surface).toBe('telegram');
    expect(parked!.telegram).toEqual({ connectionId: CONNECTION, chatId: 42, messageId: 7 });
    expect((await readApproval(taskId))!.telegram?.chatId).toBe(42);
  });

  it('reads an approval written before the surface existed as a Telegram one', async () => {
    /* Rows already in production have the coordinates flat and no `surface`.
       They must keep working — the same rule CLAUDE.md applies to work-done
       indices, which is why this reads both shapes and writes only one. */
    const { taskId } = await seedLeasedResume();
    await asOwner((sql) => sql`
      update runtime_task
         set kind = 'resume', status = 'queued', lease_token = null,
             lease_expires_at = null, lease_heartbeat_at = null,
             result = ${sql.json({
               approval: {
                 id: crypto.randomUUID(),
                 requestId: REQUEST,
                 tool: 'terminal',
                 message: 'legacy row',
                 connectionId: CONNECTION,
                 chatId: 42,
                 messageId: 7,
                 status: 'pending',
                 expiresAt: new Date(Date.now() + 60_000).toISOString(),
               },
             } as never)}
       where id = ${taskId}`);
    const stored = await readApproval(taskId);
    expect(stored?.surface).toBe('telegram');
    expect(stored?.telegram).toEqual({ connectionId: CONNECTION, chatId: 42, messageId: 7 });
  });

  it('refuses a stored approval that names no surface anyone can answer', async () => {
    const { taskId } = await seedLeasedResume();
    await asOwner((sql) => sql`
      update runtime_task
         set kind = 'resume', status = 'queued', lease_token = null,
             lease_expires_at = null, lease_heartbeat_at = null,
             result = ${sql.json({
               approval: {
                 id: crypto.randomUUID(),
                 requestId: REQUEST,
                 tool: 'terminal',
                 message: 'no surface, no coordinates',
                 status: 'pending',
                 expiresAt: new Date(Date.now() + 60_000).toISOString(),
               },
             } as never)}
       where id = ${taskId}`);
    expect(await readApproval(taskId)).toBeNull();
  });
});

describe('a decision in flight beats the deadline', () => {
  it('refuses to expire an approval a surface has already claimed', async () => {
    /* The race that existed on Telegram too: expiring a `deciding` row wrote
       a deny over an answer already being relayed, and the runner could end
       up approved while the worker retried a deny into 409s. The owner
       answered; the timeout should find nothing to do. */
    const { taskId, leaseToken } = await seedLeasedResume();
    const parked = await asTenant(A, (tx) => pauseRuntimeTaskForApproval(tx, A, taskId, leaseToken, {
      requestId: REQUEST,
      tool: 'terminal',
      message: 'npm install -g wrangler',
      remoteRunId: 'run-1',
      delaySeconds: 60,
    }));
    /* Re-lease it as the resume path would, then mark it claimed. */
    await asOwner((sql) => sql`
      update runtime_task
         set status = 'leased', lease_token = ${leaseToken},
             lease_expires_at = now() + interval '5 minutes', lease_heartbeat_at = now(),
             result = jsonb_set(jsonb_set(result, '{approval,status}', '"deciding"'),
                                '{approval,decision}', '"approve"')
       where id = ${taskId}`);

    const expired = await asTenant(A, (tx) =>
      expireRuntimeApproval(tx, A, taskId, leaseToken, parked!.id));
    expect(expired).toBeNull();

    const stored = await readApproval(taskId);
    expect(stored?.status).toBe('deciding');
    expect(stored?.decision).toBe('approve');
  });

  it('still expires an approval nobody answered', async () => {
    const { taskId, leaseToken } = await seedLeasedResume();
    const parked = await asTenant(A, (tx) => pauseRuntimeTaskForApproval(tx, A, taskId, leaseToken, {
      requestId: REQUEST,
      tool: 'terminal',
      message: 'npm install -g wrangler',
      remoteRunId: 'run-1',
      delaySeconds: 60,
    }));
    await asOwner((sql) => sql`
      update runtime_task
         set status = 'leased', lease_token = ${leaseToken},
             lease_expires_at = now() + interval '5 minutes', lease_heartbeat_at = now()
       where id = ${taskId}`);
    const expired = await asTenant(A, (tx) =>
      expireRuntimeApproval(tx, A, taskId, leaseToken, parked!.id));
    expect(expired?.status).toBe('expired');
    expect(expired?.decision).toBe('deny');
  });
});
