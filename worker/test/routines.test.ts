/**
 * Routines v1 backend: the acceptance gate in docs/plans/2026-09-09-routines-api-v1.md
 * as amended. Arranged as the owner, asserted as aisar_app through the real
 * routes and the real dispatcher, with two tenants throughout.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { handleRoutines } from '../src/routes/routines';
import { handleRuns } from '../src/routes/runs';
import { handleSession } from '../src/routes/session';
import { dispatchDueRoutines } from '../src/routines/dispatch';
import { asOwner, asTenant, req, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const KL = 'Asia/Kuala_Lumpur';
const cors = {};

let env: Env;
let ownerA = '';
let staffA = '';
let ownerB = '';
let cookieOwnerA = '';
let cookieStaffA = '';
let cookieOwnerB = '';

type Body = Record<string, any>;

async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
  useEnv: Env = env,
): Promise<{ status: number; body: Body }> {
  const { request, url } = req(method, path, { cookie, body });
  const res = await handleRoutines(request, useEnv, url, cors);
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Body) : {} };
}

const uuid = () => crypto.randomUUID();

function createBody(overrides: Body = {}): Body {
  return {
    requestId: uuid(),
    name: 'Morning summary',
    task: { kind: 'business_summary' },
    schedule: { frequency: 'daily', time: '08:00', timeZone: KL },
    delivery: 'workspace',
    enabled: true,
    ...overrides,
  };
}

async function create(overrides: Body = {}, cookie = cookieOwnerA): Promise<Body> {
  const res = await call('POST', '/api/routines', cookie, createBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.routine as Body;
}

async function seedWork(count: number, occurredAt: string, businessId = A): Promise<void> {
  await asOwner(async (sql) => {
    for (let i = 0; i < count; i += 1) {
      await sql`insert into work_record (business_id, objective, outcome, status, function, channel, occurred_at, minutes_saved)
                values (${businessId}, ${`Task ${i + 1}`}, ${`Done ${i + 1}`}, 'completed', 'assistant', 'telegram', ${occurredAt}::timestamptz, 3)`;
    }
  });
}

beforeEach(async () => {
  await truncateAll();
  await asOwner(async (sql) => {
    await sql`insert into business (id, name, playbook_key, lang)
              values (${A}, 'Alpha', 'restaurant', 'en'), (${B}, 'Beta', 'retail', 'en')`;
    const [a] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner-a@example.com', true) returning id`;
    const [s] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('staff-a@example.com', true) returning id`;
    const [b] = await sql<{ id: string }[]>`
      insert into app_user (email, email_verified) values ('owner-b@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role)
              values (${a.id}, ${A}, 'owner'), (${s.id}, ${A}, 'staff'), (${b.id}, ${B}, 'owner')`;
    ownerA = a.id;
    staffA = s.id;
    ownerB = b.id;
  });
  env = testEnv({ ROUTINES_ENABLED: 'true' });
  cookieOwnerA = await signIn(ownerA);
  cookieStaffA = await signIn(staffA);
  cookieOwnerB = await signIn(ownerB);
});

describe('discovery', () => {
  async function me(cookie: string, useEnv: Env): Promise<Body> {
    const { request, url } = req('GET', '/api/me', { cookie });
    const res = await handleSession(request, useEnv, url, cors);
    return (await res!.json()) as Body;
  }

  it('advertises routines on /api/me only when the flag is on and the business is allowed', async () => {
    expect((await me(cookieOwnerA, env)).features).toEqual({ routines: { apiVersion: 1 } });
    const allowB = testEnv({ ROUTINES_ENABLED: 'true', AISAR_ROUTINES_BUSINESS_IDS: B });
    expect((await me(cookieOwnerA, allowB)).features?.routines).toBeUndefined();
    expect((await me(cookieOwnerB, allowB)).features).toEqual({ routines: { apiVersion: 1 } });
    const off = testEnv({ ROUTINES_ENABLED: 'false' });
    expect((await me(cookieOwnerA, off)).features?.routines).toBeUndefined();
  });
});

describe('capabilities and permissions', () => {
  it('lists capabilities by role, with every response private and uncached', async () => {
    const { request, url } = req('GET', '/api/routines', { cookie: cookieOwnerA });
    const res = await handleRoutines(request, env, url, cors);
    expect(res!.headers.get('Cache-Control')).toBe('private, no-store');
    const owner = (await res!.json()) as Body;
    expect(owner).toMatchObject({
      ok: true,
      apiVersion: 1,
      capabilities: { canManage: true, canSchedule: true, canRunNow: true, timeZones: [KL], maxRoutines: 10 },
      routines: [],
    });
    expect(typeof owner.serverTime).toBe('string');
    const staff = await call('GET', '/api/routines', cookieStaffA);
    expect(staff.body.capabilities).toMatchObject({ canManage: false, canSchedule: false, canRunNow: false });
  });

  it('lets members read but not create, update, pause or run', async () => {
    const routine = await create();
    expect((await call('POST', '/api/routines', cookieStaffA, createBody())).status).toBe(403);
    expect((await call('POST', '/api/routines', cookieStaffA, createBody())).body.code).toBe('OWNER_REQUIRED');
    expect((await call('GET', `/api/routines/${routine.id}`, cookieStaffA)).status).toBe(200);
    expect((await call('POST', `/api/routines/${routine.id}/state`, cookieStaffA,
      { requestId: uuid(), expectedRevision: 1, status: 'paused' })).body.code).toBe('OWNER_REQUIRED');
    expect((await call('POST', `/api/routines/${routine.id}/run`, cookieStaffA,
      { requestId: uuid(), expectedRevision: 1 })).body.code).toBe('OWNER_REQUIRED');
  });

  it('keeps existing routines readable and pausable when scheduling is disabled for the tenant', async () => {
    const routine = await create();
    const disabled = testEnv({ ROUTINES_ENABLED: 'true', AISAR_ROUTINES_BUSINESS_IDS: B });
    const list = await call('GET', '/api/routines', cookieOwnerA, undefined, disabled);
    expect(list.body.capabilities).toMatchObject({ canManage: true, canSchedule: false, canRunNow: false });
    expect(list.body.routines).toHaveLength(1);
    expect((await call('POST', '/api/routines', cookieOwnerA, createBody(), disabled)).body.code).toBe('ROUTINES_DISABLED');
    expect((await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1 }, disabled)).body.code).toBe('ROUTINES_DISABLED');
    const paused = await call('POST', `/api/routines/${routine.id}/state`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1, status: 'paused' }, disabled);
    expect(paused.status).toBe(200);
    expect(paused.body.routine.status).toBe('paused');
    expect((await call('POST', `/api/routines/${routine.id}/state`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 2, status: 'active' }, disabled)).body.code).toBe('ROUTINES_DISABLED');
  });
});

describe('create', () => {
  it('validates the form and names the fields', async () => {
    const bad = await call('POST', '/api/routines', cookieOwnerA, createBody({
      schedule: { frequency: 'weekly', time: '8:00', timeZone: 'UTC' },
    }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SCHEDULE');
    expect(Object.keys(bad.body.fieldErrors)).toEqual(expect.arrayContaining(['schedule.time', 'schedule.timeZone', 'schedule.weekday']));

    expect((await call('POST', '/api/routines', cookieOwnerA, createBody({ name: '   ' }))).body.fieldErrors).toHaveProperty('name');
    expect((await call('POST', '/api/routines', cookieOwnerA, createBody({ task: { kind: 'send_invoices' } }))).body.fieldErrors).toHaveProperty('task.kind');
    expect((await call('POST', '/api/routines', cookieOwnerA, createBody({ delivery: 'telegram' }))).body.fieldErrors).toHaveProperty('delivery');
    expect((await call('POST', '/api/routines', cookieOwnerA, createBody({ enabled: undefined }))).body.fieldErrors).toHaveProperty('enabled');
    expect((await call('POST', '/api/routines', cookieOwnerA, createBody({ prompt: 'do things' }))).body.code).toBe('INVALID_ROUTINE');
    expect((await call('POST', '/api/routines', cookieOwnerA, createBody({ requestId: 'nope' }))).body.code).toBe('INVALID_REQUEST_ID');
  });

  it('creates an active routine with the next trigger strictly after now and runs nothing', async () => {
    const before = Date.now();
    const routine = await create();
    expect(routine).toMatchObject({
      revision: 1,
      name: 'Morning summary',
      task: { kind: 'business_summary' },
      schedule: { frequency: 'daily', time: '08:00', timeZone: KL },
      delivery: 'workspace',
      status: 'active',
      lastOccurrence: null,
    });
    expect(new Date(routine.nextRunAt).getTime()).toBeGreaterThan(before);
    expect(new Date(routine.nextRunAt).getTime()).toBeLessThanOrEqual(before + 25 * 3_600_000);
    const runs = await asTenant(A, (tx) => tx<{ n: string }[]>`select count(*)::text as n from run`);
    expect(runs[0].n).toBe('0');
    const occurrences = await call('GET', `/api/routines/${routine.id}/occurrences`, cookieOwnerA);
    expect(occurrences.body).toMatchObject({ ok: true, apiVersion: 1, occurrences: [], nextCursor: null });
  });

  it('creates a paused routine with no trigger when enabled is false', async () => {
    const routine = await create({ enabled: false });
    expect(routine.status).toBe('paused');
    expect(routine.nextRunAt).toBeNull();
  });

  it('replays the same requestId as the same routine and refuses a changed body', async () => {
    const body = createBody();
    const first = await call('POST', '/api/routines', cookieOwnerA, body);
    const again = await call('POST', '/api/routines', cookieOwnerA, body);
    expect(again.status).toBe(201);
    expect(again.body.routine.id).toBe(first.body.routine.id);
    const list = await call('GET', '/api/routines', cookieOwnerA);
    expect(list.body.routines).toHaveLength(1);
    const changed = await call('POST', '/api/routines', cookieOwnerA, { ...body, name: 'Different' });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('caps a business at ten routines', async () => {
    for (let i = 0; i < 10; i += 1) await create({ name: `Routine ${i + 1}` });
    const eleventh = await call('POST', '/api/routines', cookieOwnerA, createBody({ name: 'Eleventh' }));
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.code).toBe('ROUTINE_LIMIT');
  });
});

describe('tenancy', () => {
  it('gives the app role no way to delete a routine or rewrite its audit trail', async () => {
    const routine = await create();
    await expect(asTenant(A, (tx) => tx`delete from routine where id = ${routine.id}`))
      .rejects.toThrow(/permission denied/);
    await expect(asTenant(A, (tx) => tx`delete from routine_change where routine_id = ${routine.id}`))
      .rejects.toThrow(/permission denied/);
    await expect(asTenant(A, (tx) => tx`update routine_change set request_hash = 'x' where routine_id = ${routine.id}`))
      .rejects.toThrow(/permission denied/);
    // the row is still there
    expect((await call('GET', `/api/routines/${routine.id}`, cookieOwnerA)).status).toBe(200);
  });

  it('answers 404 for another tenant\'s routine on every operation', async () => {
    const routine = await create();
    const id = routine.id as string;
    expect((await call('GET', `/api/routines/${id}`, cookieOwnerB)).status).toBe(404);
    expect((await call('GET', `/api/routines/${id}`, cookieOwnerB)).body.code).toBe('ROUTINE_NOT_FOUND');
    expect((await call('GET', `/api/routines/${id}/occurrences`, cookieOwnerB)).status).toBe(404);
    expect((await call('POST', `/api/routines/${id}/state`, cookieOwnerB,
      { requestId: uuid(), expectedRevision: 1, status: 'paused' })).status).toBe(404);
    expect((await call('POST', `/api/routines/${id}/run`, cookieOwnerB,
      { requestId: uuid(), expectedRevision: 1 })).status).toBe(404);
    expect((await call('GET', '/api/routines', cookieOwnerB)).body.routines).toEqual([]);
    // and the row itself is invisible to the app role under B's tenant scope
    const seen = await asTenant(B, (tx) => tx<{ n: string }[]>`select count(*)::text as n from routine`);
    expect(seen[0].n).toBe('0');
  });
});

describe('update and state', () => {
  it('replaces the configuration, bumps the revision and recomputes the trigger', async () => {
    const routine = await create();
    const updated = await call('POST', `/api/routines/${routine.id}/update`, cookieOwnerA, {
      requestId: uuid(),
      expectedRevision: 1,
      name: 'Friday review',
      task: { kind: 'weekly_summary' },
      schedule: { frequency: 'weekly', weekday: 5, time: '17:00', timeZone: KL },
      delivery: 'workspace',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.routine).toMatchObject({
      revision: 2, name: 'Friday review', task: { kind: 'weekly_summary' }, status: 'active',
      schedule: { frequency: 'weekly', weekday: 5, time: '17:00', timeZone: KL },
    });
    // 17:00 in Kuala Lumpur is 09:00Z, on a Friday
    const next = new Date(updated.body.routine.nextRunAt);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCDay()).toBe(5);

    const stale = await call('POST', `/api/routines/${routine.id}/update`, cookieOwnerA, {
      requestId: uuid(), expectedRevision: 1, name: 'Stale', task: { kind: 'weekly_summary' },
      schedule: { frequency: 'weekly', weekday: 5, time: '17:00', timeZone: KL }, delivery: 'workspace',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('REVISION_CONFLICT');
  });

  it('pauses without a trigger and resumes strictly after now', async () => {
    const routine = await create();
    const paused = await call('POST', `/api/routines/${routine.id}/state`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1, status: 'paused' });
    expect(paused.body.routine).toMatchObject({ status: 'paused', nextRunAt: null, revision: 2 });
    const before = Date.now();
    const resumed = await call('POST', `/api/routines/${routine.id}/state`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 2, status: 'active' });
    expect(resumed.body.routine.status).toBe('active');
    expect(new Date(resumed.body.routine.nextRunAt).getTime()).toBeGreaterThan(before);
  });
});

describe('run now', () => {
  it('runs a business summary immediately as a deterministic run that run detail can read', async () => {
    await seedWork(3, new Date(Date.now() - 3_600_000).toISOString());
    await seedWork(2, new Date(Date.now() - 3 * 86_400_000).toISOString());
    const routine = await create();
    const res = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1 });
    expect(res.status).toBe(202);
    expect(res.body.occurrence).toMatchObject({
      routineId: routine.id, routineRevision: 1, trigger: 'manual', status: 'completed', reason: null,
    });
    expect(res.body.occurrence.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.occurrence.summary).toContain('3 pieces of work');

    const [run] = await asTenant(A, (tx) => tx<{ kind: string; runtime: string; trigger_shape: string; status: string }[]>`
      select kind, runtime, trigger_shape, status from run where id = ${res.body.occurrence.runId}`);
    expect(run).toEqual({ kind: 'schedule', runtime: 'deterministic', trigger_shape: 'routine.manual', status: 'completed' });

    const { request, url } = req('GET', `/api/runs/${res.body.occurrence.runId}`, { cookie: cookieOwnerA });
    const detail = (await (await handleRuns(request, env, url, cors))!.json()) as Body;
    expect(detail).toMatchObject({ ok: true, status: 'completed', pending: false });
    expect(detail.text).toContain('3 pieces of work');
    expect(detail.text).not.toContain('Task 4');

    const list = await call('GET', '/api/routines', cookieOwnerA);
    expect(list.body.routines[0].lastOccurrence.id).toBe(res.body.occurrence.id);
    // running now neither resumes nor moves the schedule
    expect(list.body.routines[0].nextRunAt).toBe(routine.nextRunAt);
  });

  it('records a reminder with nothing pending as skipped, and counts pending approvals otherwise', async () => {
    const routine = await create({ task: { kind: 'approval_reminder' } });
    const none = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1 });
    expect(none.status).toBe(202);
    expect(none.body.occurrence).toMatchObject({ status: 'skipped', reason: 'nothing_pending', runId: null });
    const runs = await asTenant(A, (tx) => tx<{ n: string }[]>`select count(*)::text as n from run`);
    expect(runs[0].n).toBe('0');

    await asOwner((sql) => sql`
      insert into approval (business_id, connector, op, args, risk, status, expires_at)
      values (${A}, 'telegram', 'send_message', '{}'::jsonb, 'medium', 'pending', now() + interval '1 day')`);
    const one = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1 });
    expect(one.body.occurrence.status).toBe('completed');
    expect(one.body.occurrence.summary).toMatch(/1 action/);
  });

  it('is idempotent per requestId, refuses while an occurrence is active, and works while paused', async () => {
    const routine = await create({ enabled: false });
    const body = { requestId: uuid(), expectedRevision: 1 };
    const first = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA, body);
    const again = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA, body);
    expect(first.status).toBe(202);
    expect(again.body.occurrence.id).toBe(first.body.occurrence.id);
    expect((await call('GET', `/api/routines/${routine.id}`, cookieOwnerA)).body.routine.status).toBe('paused');

    await asOwner((sql) => sql`
      insert into routine_occurrence (business_id, routine_id, routine_revision, trigger, scheduled_for, status, snapshot)
      values (${A}, ${routine.id}, 1, 'manual', now(), 'queued', '{}'::jsonb)`);
    const busy = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA,
      { requestId: uuid(), expectedRevision: 1 });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('RUN_ALREADY_ACTIVE');
  });
});

describe('occurrences', () => {
  it('lists newest first with a stable cursor', async () => {
    const routine = await create();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await call('POST', `/api/routines/${routine.id}/run`, cookieOwnerA,
        { requestId: uuid(), expectedRevision: 1 });
      ids.push(res.body.occurrence.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const page1 = await call('GET', `/api/routines/${routine.id}/occurrences?limit=2`, cookieOwnerA);
    expect(page1.body.occurrences.map((o: Body) => o.id)).toEqual([ids[2], ids[1]]);
    expect(typeof page1.body.nextCursor).toBe('string');
    const page2 = await call('GET',
      `/api/routines/${routine.id}/occurrences?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`, cookieOwnerA);
    expect(page2.body.occurrences.map((o: Body) => o.id)).toEqual([ids[0]]);
    expect(page2.body.nextCursor).toBeNull();
    expect((await call('GET', `/api/routines/${routine.id}/occurrences?limit=99`, cookieOwnerA)).status).toBe(400);
  });
});

describe('dispatcher', () => {
  async function setDue(routineId: string, at: Date): Promise<void> {
    await asOwner((sql) => sql`update routine set next_run_at = ${at.toISOString()}::timestamptz where id = ${routineId}`);
  }

  it('admits exactly one occurrence per due slot, even when two dispatchers race', async () => {
    await seedWork(60, new Date(Date.now() - 3_600_000).toISOString());
    const routine = await create();
    const slot = new Date(Date.now() - 60_000);
    await setDue(routine.id, slot);
    const now = new Date();
    const [first, second] = await Promise.all([dispatchDueRoutines(env, now), dispatchDueRoutines(env, now)]);
    expect(first.admitted + second.admitted).toBe(1);
    const third = await dispatchDueRoutines(env, now);
    expect(third.admitted).toBe(0);

    const occurrences = await call('GET', `/api/routines/${routine.id}/occurrences`, cookieOwnerA);
    expect(occurrences.body.occurrences).toHaveLength(1);
    expect(occurrences.body.occurrences[0]).toMatchObject({
      trigger: 'scheduled', scheduledFor: slot.toISOString(), status: 'completed',
    });
    // the report counted every record in the window, not the activity feed's fifty
    expect(occurrences.body.occurrences[0].summary).toContain('60 pieces of work');
    const after = await call('GET', `/api/routines/${routine.id}`, cookieOwnerA);
    expect(new Date(after.body.routine.nextRunAt).getTime()).toBeGreaterThan(now.getTime());
    const runs = await asTenant(A, (tx) => tx<{ trigger_shape: string }[]>`select trigger_shape from run`);
    expect(runs).toEqual([{ trigger_shape: 'routine.scheduled' }]);
  });

  it('skips a slot more than ten minutes late and moves on without a run', async () => {
    const routine = await create();
    const slot = new Date(Date.now() - 11 * 60_000);
    await setDue(routine.id, slot);
    const result = await dispatchDueRoutines(env, new Date());
    expect(result).toMatchObject({ admitted: 0, skipped: 1 });
    const occurrences = await call('GET', `/api/routines/${routine.id}/occurrences`, cookieOwnerA);
    expect(occurrences.body.occurrences[0]).toMatchObject({
      status: 'skipped', reason: 'missed_window', runId: null, scheduledFor: slot.toISOString(),
    });
    const after = await call('GET', `/api/routines/${routine.id}`, cookieOwnerA);
    expect(new Date(after.body.routine.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('never admits a paused routine', async () => {
    const routine = await create({ enabled: false });
    await setDue(routine.id, new Date(Date.now() - 60_000));
    expect(await dispatchDueRoutines(env, new Date())).toMatchObject({ admitted: 0, skipped: 0 });
    expect((await call('GET', `/api/routines/${routine.id}/occurrences`, cookieOwnerA)).body.occurrences).toEqual([]);
  });

  it('pauses a routine whose authorising owner is no longer an owner', async () => {
    const routine = await create();
    await asOwner((sql) => sql`update membership set role = 'staff' where user_id = ${ownerA} and business_id = ${A}`);
    await setDue(routine.id, new Date(Date.now() - 60_000));
    expect(await dispatchDueRoutines(env, new Date())).toMatchObject({ admitted: 0, skipped: 1 });
    const [row] = await asTenant(A, (tx) => tx<{ status: string; next_run_at: Date | null }[]>`
      select status, next_run_at from routine where id = ${routine.id}`);
    expect(row).toEqual({ status: 'paused', next_run_at: null });
    const occurrences = await asTenant(A, (tx) => tx<{ status: string; reason: string }[]>`
      select status, reason from routine_occurrence where routine_id = ${routine.id}`);
    expect(occurrences).toEqual([{ status: 'skipped', reason: 'permission_revoked' }]);
  });

  it('does not run scheduled work while an occurrence of the same routine is still active', async () => {
    const routine = await create();
    await asOwner((sql) => sql`
      insert into routine_occurrence (business_id, routine_id, routine_revision, trigger, scheduled_for, status, snapshot)
      values (${A}, ${routine.id}, 1, 'manual', now() - interval '5 minutes', 'queued', '{}'::jsonb)`);
    const slot = new Date(Date.now() - 60_000);
    await setDue(routine.id, slot);
    expect(await dispatchDueRoutines(env, new Date())).toMatchObject({ admitted: 0, skipped: 1 });
    const skipped = await asTenant(A, (tx) => tx<{ reason: string }[]>`
      select reason from routine_occurrence where routine_id = ${routine.id} and trigger = 'scheduled'`);
    expect(skipped).toEqual([{ reason: 'previous_run_active' }]);
  });
});
