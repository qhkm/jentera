import { beforeEach, describe, expect, it } from 'vitest';
import { handleGoals } from '../src/routes/goals';
import { finishRun, recordWork, startRun } from '../src/runs';
import { asOwner, asTenant, jsonOf, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173' };
let ownerCookie = '';
let staffCookie = '';
let ownerId = '';

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, onboarded)
      values (${A}, 'Alpha', 'restaurant', true), (${B}, 'Beta', 'salon', true)`;
    await sql`update business set plan = 'team' where id = ${A}`;
    const [owner] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner@example.com', true) returning id`;
    const [staff] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('staff@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
      values (${owner.id}, ${A}, 'owner'), (${staff.id}, ${A}, 'staff')`;
    ownerId = owner.id;
  });
  ownerCookie = await signIn(ownerId);
  const [staff] = await asOwner((sql) => sql<{ id: string }[]>`
    select id from app_user where email = 'staff@example.com'`);
  staffCookie = await signIn(staff.id);
});

async function call(
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
  origin = true,
): Promise<Response> {
  const shaped = req(method, path, { cookie, body });
  const headers = new Headers(shaped.request.headers);
  if (origin) headers.set('Origin', CORS['Access-Control-Allow-Origin']);
  const request = new Request(shaped.request, { headers });
  const response = await handleGoals(request, testEnv(), shaped.url, CORS);
  if (!response) throw new Error('Goals route did not handle the request');
  return response;
}

async function createGoal() {
  const response = await call('POST', '/api/goals', ownerCookie, {
    title: 'Reach 100 monthly orders',
    successCriteria: '100 paid orders in one calendar month',
    targetDate: '2026-12-31',
  });
  expect(response.status).toBe(201);
  return (await jsonOf<{ goal: { id: string } }>(response)).goal.id;
}

describe('business goals', () => {
  it('is private to signed-in members and owner-managed', async () => {
    expect((await call('GET', '/api/goals')).status).toBe(401);
    expect((await call('POST', '/api/goals', ownerCookie, {
      title: 'No origin', successCriteria: '', targetDate: null,
    }, false)).status).toBe(403);

    await createGoal();
    const staffView = await call('GET', '/api/goals', staffCookie);
    expect(staffView.status).toBe(200);
    expect(await staffView.json()).toMatchObject({
      ok: true,
      canManage: false,
      goals: [{ title: 'Reach 100 monthly orders', taskCount: 0, completedTaskCount: 0 }],
    });
    expect((await call('POST', '/api/goals', staffCookie, {
      title: 'Staff edit', successCriteria: '', targetDate: null,
    })).status).toBe(403);
  });

  it('rejects malformed details instead of letting the database fail', async () => {
    expect((await call('POST', '/api/goals', ownerCookie, {
      title: 'Invalid date', successCriteria: '', targetDate: '2026-02-31',
    })).status).toBe(400);
    expect((await call('POST', '/api/goals', ownerCookie, {
      title: '', successCriteria: '', targetDate: null,
    })).status).toBe(400);
    expect((await call('POST', '/api/goals', ownerCookie, {
      title: 'No measurable result', successCriteria: '', targetDate: null,
    })).status).toBe(400);
  });

  it('reports progress only from linked runs and their recorded outcomes', async () => {
    const goalId = await createGoal();
    const checkpointResponse = await call('POST', `/api/goals/${goalId}/checkpoints`, ownerCookie, {
      title: 'Prepare the sales campaign',
    });
    const checkpointId = (await jsonOf<{ checkpoint: { id: string } }>(checkpointResponse)).checkpoint.id;
    const completed = await asTenant(A, async (tx) => {
      const run = await startRun(tx, A, {
        kind: 'ask', triggerShape: 'owner.ask', requestedBy: ownerId,
        runtime: 'hermes-sprite', goalId, goalCheckpointId: checkpointId,
      });
      await recordWork(tx, A, {
        runId: run.id,
        kind: 'work',
        objective: 'Prepare sales campaign',
        outcome: 'Campaign brief ready for review',
        status: 'completed',
      });
      await finishRun(tx, A, run.id, 'completed');
      return run;
    });
    await asTenant(A, (tx) => startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', requestedBy: ownerId,
      runtime: 'hermes-sprite', goalId, goalCheckpointId: checkpointId,
    }));
    await asTenant(A, async (tx) => {
      const unrelated = await startRun(tx, A, {
        kind: 'ask', triggerShape: 'owner.ask', requestedBy: ownerId,
        runtime: 'hermes-sprite',
      });
      await finishRun(tx, A, unrelated.id, 'completed');
    });

    const view = await jsonOf<{ goals: Array<Record<string, unknown>> }>(
      await call('GET', '/api/goals', ownerCookie),
    );
    expect(view.goals[0]).toMatchObject({
      id: goalId,
      taskCount: 2,
      completedTaskCount: 1,
      latestOutcome: 'Campaign brief ready for review',
      checkpoints: [{
        id: checkpointId,
        status: 'todo',
        taskCount: 2,
        completedTaskCount: 1,
        latestOutcome: 'Campaign brief ready for review',
      }],
    });
    expect(completed.id).toBeTruthy();
  });

  it('lets the owner build and update an ordered checkpoint plan', async () => {
    const goalId = await createGoal();
    const first = await call('POST', `/api/goals/${goalId}/checkpoints`, ownerCookie, {
      title: 'Confirm the launch offer',
    });
    expect(first.status).toBe(201);
    const firstCheckpoint = (await jsonOf<{ checkpoint: { id: string; position: number } }>(first)).checkpoint;
    const second = await call('POST', `/api/goals/${goalId}/checkpoints`, ownerCookie, {
      title: 'Prepare the sales campaign',
    });
    const secondCheckpoint = (await jsonOf<{ checkpoint: { id: string; position: number } }>(second)).checkpoint;
    expect([firstCheckpoint.position, secondCheckpoint.position]).toEqual([0, 1]);
    expect((await call('POST', `/api/goals/${goalId}/checkpoints`, staffCookie, {
      title: 'Staff cannot change the plan',
    })).status).toBe(403);

    const updated = await call(
      'PUT',
      `/api/goals/${goalId}/checkpoints/${firstCheckpoint.id}`,
      ownerCookie,
      { title: 'Confirm and approve the launch offer', status: 'completed' },
    );
    expect(updated.status).toBe(200);
    const view = await jsonOf<{ goals: Array<{ checkpoints: Array<Record<string, unknown>> }> }>(
      await call('GET', '/api/goals', staffCookie),
    );
    expect(view.goals[0].checkpoints).toMatchObject([
      { id: firstCheckpoint.id, title: 'Confirm and approve the launch offer', status: 'completed', position: 0 },
      { id: secondCheckpoint.id, title: 'Prepare the sales campaign', status: 'todo', position: 1 },
    ]);
  });

  it('completes and reopens a goal without losing its evidence', async () => {
    const goalId = await createGoal();
    const details = {
      title: 'Reach 100 monthly orders',
      successCriteria: '100 paid orders in one calendar month',
      targetDate: '2026-12-31',
    };
    expect((await call('PUT', `/api/goals/${goalId}`, ownerCookie, {
      ...details, status: 'completed',
    })).status).toBe(200);
    let view = await jsonOf<{ goals: Array<{ status: string; completedAt: string | null }> }>(
      await call('GET', '/api/goals', ownerCookie),
    );
    expect(view.goals[0].status).toBe('completed');
    expect(view.goals[0].completedAt).toBeTruthy();

    expect((await call('PUT', `/api/goals/${goalId}`, ownerCookie, {
      ...details, status: 'active',
    })).status).toBe(200);
    view = await jsonOf<{ goals: Array<{ status: string; completedAt: string | null }> }>(
      await call('GET', '/api/goals', ownerCookie),
    );
    expect(view.goals[0]).toMatchObject({ status: 'active', completedAt: null });
  });

  it('cannot attach another business run to this business goal', async () => {
    const goalId = await createGoal();
    await expect(asTenant(B, (tx) => startRun(tx, B, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', goalId,
    }))).rejects.toThrow();
  });
});
