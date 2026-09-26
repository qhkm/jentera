import { beforeEach, describe, expect, it } from 'vitest';
import { handleReminders, dispatchDueReminders } from '../src/reminders';
import { asOwner, asTenant, signIn, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
let cookie: string;
let otherCookie: string;
let colleagueCookie: string;
let user: string;
let dueAt: string;
const env = testEnv();
async function call(method: string, body?: unknown, auth = cookie, path = '/api/reminders') {
  const url = new URL(`https://api.test${path}`);
  return (await handleReminders(new Request(url, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) }), env, url, {}))!;
}
const input = () => ({ id: ID, message: 'Call the supplier', dueAt, timeZone: 'Asia/Kuala_Lumpur' });
beforeEach(async () => {
  await truncateAll();
  dueAt = new Date(Date.now() + 3600_000).toISOString();
  await asOwner(async sql => {
    await sql`insert into business (id, name, playbook_key) values (${A}, 'A', 'restaurant'), (${B}, 'B', 'retail')`;
    const [a] = await sql`insert into app_user (email, email_verified) values ('reminder-a@example.com', true) returning id`;
    const [b] = await sql`insert into app_user (email, email_verified) values ('reminder-b@example.com', true) returning id`;
    const [c] = await sql`insert into app_user (email, email_verified) values ('reminder-c@example.com', true) returning id`;
    await sql`insert into membership (user_id, business_id, role) values (${a.id}, ${A}, 'owner'), (${b.id}, ${B}, 'owner'), (${c.id}, ${A}, 'owner')`;
    user = a.id;
    cookie = await signIn(a.id); otherCookie = await signIn(b.id); colleagueCookie = await signIn(c.id);
  });
});

describe('personal reminder scheduling', () => {
  it('persists only valid future reminders and retries idempotently', async () => {
    expect((await call('POST', { ...input(), dueAt: new Date(0).toISOString() })).status).toBe(400);
    expect((await call('POST', { ...input(), timeZone: 'UTC' })).status).toBe(400);
    expect((await call('POST', input(), '')).status).toBe(401);
    const first = await (await call('POST', input())).json();
    expect(first).toMatchObject({ ok: true, reminder: { id: ID, status: 'scheduled' }, push: 'not_enabled' });
    expect((await call('POST', input())).status).toBe(200);
    expect((await call('POST', { ...input(), message: 'Changed' })).status).toBe(409);
    await asTenant(A, async tx => { const [r] = await tx`select count(*)::int as n from reminder`; expect(r.n).toBe(1); });
  });
  it('does not let another tenant or colleague read or cancel it', async () => {
    await call('POST', input());
    for (const auth of [otherCookie, colleagueCookie]) {
      expect(await (await call('GET', undefined, auth)).json()).toMatchObject({ reminders: [] });
      expect((await call('GET', undefined, auth, `/api/reminders/${ID}`)).status).toBe(404);
      expect((await call('DELETE', undefined, auth, `/api/reminders/${ID}`)).status).toBe(404);
    }
    expect(await (await call('GET', undefined, cookie, `/api/reminders/${ID}`)).json()).toMatchObject({ reminder: { status: 'scheduled' } });
    expect(await (await call('GET')).json()).toMatchObject({ reminders: [{ id: ID }] });
  });
  it('enqueues exactly one inbox notification and push after the due time', async () => {
    await call('POST', input());
    expect((await dispatchDueReminders(env)).delivered).toBe(0);
    const now = new Date(Date.parse(dueAt) + 1000);
    await Promise.all([dispatchDueReminders(env, now), dispatchDueReminders(env, now)]);
    expect((await dispatchDueReminders(env, now)).delivered).toBe(0);
    await asTenant(A, async tx => {
      const rows = await tx`select kind, body, recipient_user_id from notification`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'reminder_due', body: 'Call the supplier', recipient_user_id: user });
      const outbox = await tx`select user_id from push_outbox`;
      expect(outbox).toHaveLength(1); expect(outbox[0].user_id).toBe(user);
    });
  });
  it('finishes the task that drafted it once the person who asked saves the reminder', async () => {
    const seed = async (requestedBy: string) => asOwner(async sql => {
      await sql`insert into run (id, business_id, kind, trigger_shape, runtime, model, status, ended_at, requested_by)
                values (${ID}, ${A}, 'ask', 'owner.ask', 'hermes-sprite', 'deepseek', 'completed', now(), ${requestedBy})`;
      await sql`insert into work_record (business_id, run_id, objective, status, kind)
                values (${A}, ${ID}, 'add reminder tomorrow 8am', 'needs_input', 'work')`;
    });
    const state = () => asTenant(A, async tx => {
      const [work] = await tx<{ status: string }[]>`select status from work_record where run_id = ${ID}`;
      const events = await tx<{ payload: { source?: string; status?: string } }[]>`
        select payload from run_event where run_id = ${ID} and type = 'outcome.observed'`;
      return { status: work.status, events: events.map(e => e.payload) };
    });

    await seed(user);
    expect((await call('POST', input())).status).toBe(200);
    expect(await state()).toEqual({ status: 'completed', events: [expect.objectContaining({ source: 'reminder.saved', status: 'completed' })] });
    // saving the same reminder again settles nothing twice
    expect((await call('POST', input())).status).toBe(200);
    expect((await state()).events).toHaveLength(1);
  });

  it('leaves a colleague\'s waiting task alone when someone else saves a reminder with its id', async () => {
    const [colleague] = await asOwner(sql => sql<{ id: string }[]>`select id from app_user where email = 'reminder-c@example.com'`);
    await asOwner(async sql => {
      await sql`insert into run (id, business_id, kind, trigger_shape, runtime, model, status, ended_at, requested_by)
                values (${ID}, ${A}, 'ask', 'owner.ask', 'hermes-sprite', 'deepseek', 'completed', now(), ${colleague.id})`;
      await sql`insert into work_record (business_id, run_id, objective, status, kind)
                values (${A}, ${ID}, 'add reminder tomorrow 8am', 'needs_input', 'work')`;
    });
    expect((await call('POST', input())).status).toBe(200);
    await asTenant(A, async tx => {
      const [work] = await tx`select status from work_record where run_id = ${ID}`;
      expect(work.status).toBe('needs_input');
    });
  });

  it('does not send cancelled reminders or reminders for removed members', async () => {
    await call('POST', input());
    const cancelled = await (await call('DELETE', undefined, cookie, `/api/reminders/${ID}`)).json();
    expect(cancelled).toMatchObject({ reminder: { status: 'cancelled' } });
    expect((await dispatchDueReminders(env, new Date(Date.parse(dueAt) + 1000))).delivered).toBe(0);
    await asOwner(async sql => { await sql`update reminder set status = 'scheduled'`; await sql`delete from membership where user_id = ${user}`; });
    expect((await dispatchDueReminders(env, new Date(Date.parse(dueAt) + 1000))).delivered).toBe(0);
  });
});
