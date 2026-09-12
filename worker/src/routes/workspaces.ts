/* ============================================================
   Workspaces: a named space inside a business with its own members,
   whose chats every member may read and continue.

   GET    /api/workspaces                         the ones this person is in;
                                                  the owner sees all, with
                                                  `member` saying which
   POST   /api/workspaces                         create, with members (owner, team plan)
   POST   /api/workspaces/:id/members             add a member of the business (owner, team plan)
   DELETE /api/workspaces/:id/members/:userId     remove (owner)

   Reading a workspace's chats is explicit membership for everyone, the
   owner included: the owner is added on creation and may leave. Deleting
   a workspace is not offered; its chats would have to go somewhere.
   ============================================================ */
import type postgres from 'postgres';
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { getBusinessPlan } from '../agent-runtime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

function originAllowed(request: Request, cors: Record<string, string>): boolean {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === cors['Access-Control-Allow-Origin'];
}

interface MemberRow { workspace_id: string; user_id: string; email: string }

async function membersOf(tx: postgres.TransactionSql, businessId: string): Promise<MemberRow[]> {
  return tx<MemberRow[]>`
    select m.workspace_id, m.user_id, u.email
      from workspace_member m join app_user u on u.id = m.user_id
     where m.business_id = ${businessId}
     order by u.email`;
}

export async function handleWorkspaces(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/workspaces')) return null;
  const identity = await resolveTenant(env, request);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
  const { businessId, userId } = identity;
  const manages = can(identity, 'workspaces.manage');

  if (url.pathname === '/api/workspaces' && request.method === 'GET') {
    const { rows, members } = await withTenant(env, businessId, async (tx) => ({
      rows: await tx<{ id: string; name: string; created_at: Date; member: boolean }[]>`
        select w.id, w.name, w.created_at,
               exists (select 1 from workspace_member m where m.workspace_id = w.id and m.user_id = ${userId}) as member
          from workspace w
         where w.business_id = ${businessId}
           and (${manages} or exists (select 1 from workspace_member m where m.workspace_id = w.id and m.user_id = ${userId}))
         order by w.created_at`,
      members: await membersOf(tx, businessId),
    }));
    return json({
      ok: true,
      canManage: manages,
      workspaces: rows.map((w) => ({
        id: w.id,
        name: w.name,
        createdAt: w.created_at.toISOString(),
        member: w.member,
        members: members.filter((m) => m.workspace_id === w.id)
          .map((m) => ({ userId: m.user_id, email: m.email, you: m.user_id === userId })),
      })),
    }, {}, { ...cors, 'Cache-Control': 'private, no-store' });
  }

  if (url.pathname === '/api/workspaces' && request.method === 'POST') {
    if (!manages) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    const body = await request.json().catch(() => null) as { name?: unknown; memberIds?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return json({ ok: false, err: 'a workspace needs a name of up to 80 characters' }, { status: 400 }, cors);
    const requested = Array.isArray(body?.memberIds) ? body!.memberIds.filter((v): v is string => typeof v === 'string' && UUID.test(v)) : [];
    const memberIds = [...new Set([userId, ...requested])];
    const result = await withTenant(env, businessId, async (tx) => {
      if (await getBusinessPlan(tx, businessId) !== 'team') return { status: 402 as const, err: 'This business is not on the Team plan.' };
      const known = await tx<{ user_id: string }[]>`
        select user_id from membership where business_id = ${businessId} and user_id in ${tx(memberIds)}`;
      if (known.length !== memberIds.length) return { status: 404 as const, err: 'Someone on that list is not a member of this business.' };
      const [workspace] = await tx<{ id: string; created_at: Date }[]>`
        insert into workspace (business_id, name, created_by) values (${businessId}, ${name}, ${userId})
        returning id, created_at`;
      for (const memberId of memberIds) {
        await tx`insert into workspace_member (business_id, workspace_id, user_id, added_by)
                 values (${businessId}, ${workspace.id}, ${memberId}, ${userId})`;
      }
      const members = (await membersOf(tx, businessId)).filter((m) => m.workspace_id === workspace.id);
      return { status: 201 as const, workspace, members };
    });
    if (result.status !== 201) return json({ ok: false, err: result.err }, { status: result.status }, cors);
    return json({
      ok: true,
      workspace: {
        id: result.workspace.id, name, createdAt: result.workspace.created_at.toISOString(), member: true,
        members: result.members.map((m) => ({ userId: m.user_id, email: m.email, you: m.user_id === userId })),
      },
    }, { status: 201 }, cors);
  }

  const addMember = url.pathname.match(/^\/api\/workspaces\/([0-9a-f-]{36})\/members$/i);
  if (addMember && request.method === 'POST') {
    if (!manages) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    if (!UUID.test(addMember[1])) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    const body = await request.json().catch(() => null) as { userId?: unknown } | null;
    const memberId = typeof body?.userId === 'string' && UUID.test(body.userId) ? body.userId : null;
    if (!memberId) return json({ ok: false, err: 'userId required' }, { status: 400 }, cors);
    const result = await withTenant(env, businessId, async (tx) => {
      if (await getBusinessPlan(tx, businessId) !== 'team') return { status: 402 as const, err: 'This business is not on the Team plan.' };
      const [workspace] = await tx<{ id: string }[]>`select id from workspace where business_id = ${businessId} and id = ${addMember[1]}`;
      const [member] = await tx<{ user_id: string }[]>`select user_id from membership where business_id = ${businessId} and user_id = ${memberId}`;
      if (!workspace || !member) return { status: 404 as const, err: 'not found' };
      await tx`insert into workspace_member (business_id, workspace_id, user_id, added_by)
               values (${businessId}, ${workspace.id}, ${memberId}, ${userId})
               on conflict (workspace_id, user_id) do nothing`;
      return { status: 200 as const };
    });
    if (result.status !== 200) return json({ ok: false, err: result.err }, { status: result.status }, cors);
    return json({ ok: true }, {}, cors);
  }

  const dropMember = url.pathname.match(/^\/api\/workspaces\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/i);
  if (dropMember && request.method === 'DELETE') {
    if (!manages) return json({ ok: false, err: 'owner access required' }, { status: 403 }, cors);
    if (!originAllowed(request, cors)) return json({ ok: false, err: 'origin not allowed' }, { status: 403 }, cors);
    if (!UUID.test(dropMember[1]) || !UUID.test(dropMember[2])) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    const removed = await withTenant(env, businessId, async (tx) => {
      const rows = await tx`delete from workspace_member
        where business_id = ${businessId} and workspace_id = ${dropMember[1]} and user_id = ${dropMember[2]} returning user_id`;
      return rows.length > 0;
    });
    return json({ ok: removed, ...(removed ? {} : { err: 'not found' }) }, { status: removed ? 200 : 404 }, cors);
  }

  return null;
}
