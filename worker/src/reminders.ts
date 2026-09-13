import { connect, withTenant } from './db';
import type { Env } from './env';
import { businessHasAccess } from './access';
import { hasBusiness, resolveTenant } from './tenancy';
import { createNotification } from './notifications/store';
import { pushConfigured } from './push/send';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface ReminderRow { id: string; user_id: string; message: string; due_at: Date; time_zone: string; status: string }
const present = (r: ReminderRow) => ({ id: r.id, message: r.message, dueAt: r.due_at.toISOString(), timeZone: r.time_zone, status: r.status });

export async function handleReminders(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (url.pathname !== '/api/reminders' && !url.pathname.startsWith('/api/reminders/')) return null;
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...cors, 'Cache-Control': 'private, no-store' } });
  const identity = await resolveTenant(env, request);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'Sign in to schedule a reminder.' }, 401);
  const { businessId, userId } = identity;
  if (url.pathname === '/api/reminders' && request.method === 'GET') {
    const rows = await withTenant(env, businessId, tx => tx<ReminderRow[]>`select * from reminder
      where user_id = ${userId} and status = 'scheduled' order by due_at, id limit 100`);
    return json({ ok: true, reminders: rows.map(present) });
  }
  const single = url.pathname.match(/^\/api\/reminders\/([^/]+)$/)?.[1];
  if (single && !UUID.test(single)) return json({ ok: false, err: 'Not found.' }, 404);
  if (single && (request.method === 'GET' || request.method === 'DELETE')) {
    const row = await withTenant(env, businessId, async tx => {
      if (request.method === 'DELETE') await tx`update reminder set status = 'cancelled' where id = ${single} and user_id = ${userId} and status = 'scheduled'`;
      const [found] = await tx<ReminderRow[]>`select * from reminder where id = ${single} and user_id = ${userId}`;
      return found;
    });
    return row ? json({ ok: true, reminder: present(row) }) : json({ ok: false, err: 'Not found.' }, 404);
  }
  if (url.pathname !== '/api/reminders' || request.method !== 'POST') return json({ ok: false, err: 'Method not allowed.' }, 405);
  const raw: unknown = await request.json().catch(() => null);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!body || typeof body.id !== 'string' || !UUID.test(body.id) ||
      typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 500 ||
      body.timeZone !== 'Asia/Kuala_Lumpur' || typeof body.dueAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.dueAt) || !Number.isFinite(Date.parse(body.dueAt))) {
    return json({ ok: false, err: 'Choose a reminder message, date and time in Asia/Kuala_Lumpur.' }, 400);
  }
  const input = { id: body.id, message: body.message.trim(), dueAt: body.dueAt, timeZone: body.timeZone };
  const result = await withTenant(env, businessId, async tx => {
    // Serialize retries and enforce a per-person pending cap within the same lock.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`reminders:${businessId}:${userId}`}, 0))`;
    const [existing] = await tx<ReminderRow[]>`select * from reminder where id = ${input.id} and user_id = ${userId}`;
    if (existing) return existing.message === input.message && existing.due_at.toISOString() === input.dueAt
      ? { row: existing } : { error: 'This request was already saved with different details.', status: 409 };
    if (Date.parse(input.dueAt) <= Date.now() || Date.parse(input.dueAt) > Date.now() + 366 * 86400_000) return { error: 'Choose a future time within the next year.', status: 400 };
    const [count] = await tx<{ n: number }[]>`select count(*)::int as n from reminder where user_id = ${userId} and status = 'scheduled'`;
    if (count.n >= 100) return { error: 'You have 100 pending reminders. Cancel one first.', status: 409 };
    const [row] = await tx<ReminderRow[]>`insert into reminder (id, business_id, user_id, message, due_at, time_zone)
      values (${input.id}, ${businessId}, ${userId}, ${input.message}, ${input.dueAt}, ${input.timeZone})
      on conflict (id) do nothing returning *`;
    return row ? { row } : { error: 'Request identifier is unavailable.', status: 409 };
  });
  if (!result.row) return json({ ok: false, err: result.error }, result.status);
  const subscribed = await withTenant(env, businessId, async tx => {
    const [row] = await tx<{ n: number }[]>`select count(*)::int as n from push_subscription where user_id = ${userId}`;
    return row.n > 0;
  });
  return json({ ok: true, reminder: present(result.row), push: pushConfigured(env) && subscribed ? 'subscribed' : 'not_enabled' });
}

/** Claims, inbox insertion, push enqueue and completion are one transaction.
 * Late reminders are delivered once, not silently discarded. */
export async function dispatchDueReminders(env: Env, now = new Date()) {
  const sql = connect(env);
  let targets: { business_id: string; reminder_id: string }[];
  try { targets = await sql`select * from public.reminder_due_targets(${now.toISOString()}::timestamptz, 50)`; }
  finally { await sql.end(); }
  let delivered = 0;
  for (const target of targets) {
    try {
      if (!(await businessHasAccess(env, target.business_id))) continue;
      await withTenant(env, target.business_id, async tx => {
        const [row] = await tx<ReminderRow[]>`select * from reminder where id = ${target.reminder_id} and status = 'scheduled'
          and due_at <= ${now.toISOString()} for update skip locked`;
        if (!row) return;
        const [member] = await tx`select 1 from membership where business_id = ${target.business_id} and user_id = ${row.user_id}`;
        if (!member) { await tx`update reminder set status = 'cancelled' where id = ${row.id}`; return; }
        await createNotification(tx, target.business_id, { recipientUserId: row.user_id, kind: 'reminder_due',
          title: 'Jentera reminder', body: row.message, sourceKey: `reminder:${row.id}` });
        await tx`update reminder set status = 'sent' where id = ${row.id}`;
        delivered += 1;
      });
    } catch (error) { console.error('[reminders] dispatch failed', target.reminder_id, String(error)); }
  }
  return { delivered };
}
