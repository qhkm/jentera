import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
  });
}

function originAllowed(request: Request, cors: Record<string, string>): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === cors['Access-Control-Allow-Origin'];
}

function input(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const successCriteria = typeof value.successCriteria === 'string' ? value.successCriteria.trim() : '';
  const targetDate = value.targetDate === null || value.targetDate === '' ? null
    : typeof value.targetDate === 'string' && validDate(value.targetDate) ? value.targetDate : undefined;
  if (!title || title.length > 120 || !successCriteria || successCriteria.length > 1000 || targetDate === undefined) return null;
  return { title, successCriteria, targetDate };
}

/** Shared goals, with progress derived only from linked runs and recorded outcomes. */
export async function handleGoals(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== '/api/goals' && !url.pathname.startsWith('/api/goals/')) return null;
  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);
  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }
  const manage = can(identity, 'goals.manage');

  if (url.pathname === '/api/goals' && request.method === 'GET') {
    const goals = await withTenant(env, identity.businessId, (tx) => tx<{
      id: string;
      title: string;
      successCriteria: string;
      targetDate: string | null;
      status: 'active' | 'completed';
      createdAt: Date;
      updatedAt: Date;
      completedAt: Date | null;
      taskCount: number;
      completedTaskCount: number;
      latestOutcome: string | null;
      latestWorkAt: Date | null;
    }[]>`select g.id, g.title, g.success_criteria as "successCriteria",
          g.target_date::text as "targetDate", g.status,
          g.created_at as "createdAt", g.updated_at as "updatedAt",
          g.completed_at as "completedAt",
          (select count(*)::int from run r
            where r.business_id = g.business_id and r.goal_id = g.id) as "taskCount",
          (select count(distinct r.id)::int from run r
            join work_record w on w.business_id = r.business_id and w.run_id = r.id
            where r.business_id = g.business_id and r.goal_id = g.id
              and w.kind = 'work' and w.status = 'completed') as "completedTaskCount",
          latest.outcome as "latestOutcome", latest.occurred_at as "latestWorkAt"
        from goal g
        left join lateral (
          select w.outcome, w.occurred_at from run r
          join work_record w on w.business_id = r.business_id and w.run_id = r.id
          where r.business_id = g.business_id and r.goal_id = g.id
            and w.kind = 'work' and w.outcome is not null
          order by w.occurred_at desc limit 1
        ) latest on true
        where g.business_id = ${identity.businessId} and g.status <> 'archived'
        order by (g.status = 'active') desc,
          g.target_date asc nulls last, g.updated_at desc`);
    return json({ ok: true, canManage: manage, goals }, {}, cors);
  }

  if (!manage) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
  if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);

  if (url.pathname === '/api/goals' && request.method === 'POST') {
    const fields = input(await request.json().catch(() => null));
    if (!fields) return json({ ok: false, err: 'check the goal details' }, { status: 400 }, cors);
    const [goal] = await withTenant(env, identity.businessId, (tx) => tx<{
      id: string; createdAt: Date; updatedAt: Date;
    }[]>`insert into goal (business_id, created_by, title, success_criteria, target_date)
      values (${identity.businessId}, ${identity.userId}, ${fields.title},
              ${fields.successCriteria}, ${fields.targetDate}::date)
      returning id, created_at as "createdAt", updated_at as "updatedAt"`);
    return json({
      ok: true,
      goal: {
        id: goal.id,
        ...fields,
        status: 'active',
        taskCount: 0,
        completedTaskCount: 0,
        latestOutcome: null,
        latestWorkAt: null,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
        completedAt: null,
      },
    }, { status: 201 }, cors);
  }

  const match = url.pathname.match(/^\/api\/goals\/([0-9a-f-]{36})$/i);
  if (!match || !UUID.test(match[1]) || request.method !== 'PUT') {
    return json({ ok: false, err: 'goal not found' }, { status: 404 }, cors);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fields = input(body);
  const status = body?.status;
  if (!fields || !['active', 'completed', 'archived'].includes(String(status))) {
    return json({ ok: false, err: 'check the goal details' }, { status: 400 }, cors);
  }
  const updated = await withTenant(env, identity.businessId, (tx) => tx`
    update goal set title = ${fields.title}, success_criteria = ${fields.successCriteria},
      target_date = ${fields.targetDate}::date, status = ${String(status)}, updated_at = now(),
      completed_at = case when ${String(status)} = 'completed'
        then coalesce(completed_at, now()) else null end
    where business_id = ${identity.businessId} and id = ${match[1]}
    returning id`);
  if (!updated.length) return json({ ok: false, err: 'goal not found' }, { status: 404 }, cors);
  return json({ ok: true }, {}, cors);
}
