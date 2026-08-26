/* ============================================================
   The endpoints behind the client's Repository interface.

   The interface has 17 methods; `load()` is one round trip that returns
   the whole snapshot, and every setter is one POST. Routes stay thin —
   no business logic here, only tenant resolution, validation and a
   write inside withTenant.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant, type TenantIdentity } from '../tenancy';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

const noContent = (headers: Record<string, string>) =>
  new Response(null, { status: 204, headers });

/* ---------- load ---------------------------------------------------- */

async function loadSnapshot(env: Env, id: TenantIdentity) {
  return withTenant(env, id.businessId, async (tx) => {
    const [biz] = await tx<
      {
        name: string;
        playbook_key: string;
        country: string;
        lang: string;
        locality: string | null;
        onboarded: boolean;
        setup_done: boolean;
        channels: string[];
        connections: string[];
        theme: string;
      }[]
    >`select name, playbook_key, country, lang, locality, onboarded, setup_done,
             channels, connections, theme
        from business where id = ${id.businessId}`;

    const approvals = await tx<
      { id: string; connector: string; op: string; args: unknown; risk: string; status: string; created_at: Date; decided_at: Date | null }[]
    >`select id, connector, op, args, risk, status, created_at, decided_at
        from approval order by created_at desc limit 200`;

    const policies = await tx<{ op: string; policy: string }[]>`
      select op, policy from action_policy`;

    const work = await tx<{ playbook_key: string; idx: string }[]>`
      select playbook_key, idx from work_done`;

    const learned = await tx<{ playbook_key: string; pick: string; count: number }[]>`
      select playbook_key, pick, count from learn`;

    const workDone: Record<string, string[]> = {};
    for (const w of work) (workDone[w.playbook_key] ??= []).push(w.idx);

    const learn: Record<string, Record<string, number>> = {};
    for (const l of learned) (learn[l.playbook_key] ??= {})[l.pick] = l.count;

    const permissions: Record<string, string> = {};
    for (const p of policies) permissions[p.op] = p.policy;

    return {
      onboarded: biz.onboarded,
      setupDone: biz.setup_done,
      bizType: biz.playbook_key,
      bizName: biz.name,
      bizLoc: biz.locality ?? '',
      channels: biz.channels.length ? biz.channels : null,
      conns: biz.connections,
      country: biz.country,
      lang: biz.lang,
      theme: biz.theme,
      approvals: approvals.map((a) => ({
        // The client's Approval.id is numeric, a localStorage artefact.
        // The server mints uuids; remoteId carries it and the client maps.
        remoteId: a.id,
        conn: a.connector,
        op: a.op,
        args: a.args,
        risk: a.risk,
        status: a.status,
        ts: a.created_at,
        decided: a.decided_at,
      })),
      permissions,
      workDone,
      learn,
    };
  });
}

/* ---------- dispatch -------------------------------------------------- */

type Body = Record<string, unknown>;

export async function handleRepo(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/state')) return null;

  const identity = await resolveTenant(env, request);
  if (!identity) return json({ ok: false, err: 'not signed in' }, { status: 401 }, cors);

  /* Creating the business is the one route that runs without one. */
  if (url.pathname === '/api/state/business' && request.method === 'POST') {
    if (hasBusiness(identity)) {
      return json({ ok: false, err: 'already has a business' }, { status: 409 }, cors);
    }
    const b = (await request.json().catch(() => ({}))) as Body;

    /* Mint the id here rather than letting the database default it.
       `business`'s RLS policy covers ALL commands and has no WITH CHECK,
       so Postgres reuses its USING expression as the insert check —
       meaning a row is only insertable when app.business_id already
       equals its id. Creating a business looks pre-tenant, but it cannot
       be: the row being inserted is the thing that defines the tenant.
       Generating the id first lets the transaction be scoped to it, so
       the insert satisfies its own policy instead of being rejected by
       it. Found by the first real insert against the deployed Worker;
       every prior test wrote rows that already existed. */
    const businessId = crypto.randomUUID();

    await withTenant(env, businessId, async (tx) => {
      await tx`
        insert into business (id, name, playbook_key, country, lang, locality)
        values (${businessId}, ${String(b.name ?? 'My business')},
                ${String(b.playbookKey ?? 'generic')}, ${String(b.country ?? 'MY')},
                ${String(b.lang ?? 'en')}, ${b.locality ? String(b.locality) : null})`;
      /* membership carries no policy — resolveTenant reads it before a
         tenant is known — so it is written inside the same transaction
         purely so a failure leaves neither row. */
      await tx`insert into membership (user_id, business_id, role)
               values (${identity.userId}, ${businessId}, 'owner')`;
    });

    return json({ ok: true, businessId }, {}, cors);
  }

  if (!hasBusiness(identity)) {
    return json({ ok: false, err: 'no business', code: 'NO_BUSINESS' }, { status: 404 }, cors);
  }
  const id = identity;

  if (url.pathname === '/api/state' && request.method === 'GET') {
    return json({ ok: true, snapshot: await loadSnapshot(env, id) }, {}, cors);
  }

  if (request.method !== 'POST') return null;
  const body = (await request.json().catch(() => ({}))) as Body;

  /* Scalars that live on the business row. Each is one guarded UPDATE. */
  const scalar: Record<string, { col: string; value: () => unknown }> = {
    '/api/state/biz-type': { col: 'playbook_key', value: () => String(body.key ?? '') },
    '/api/state/onboarded': { col: 'onboarded', value: () => Boolean(body.value) },
    '/api/state/setup-done': { col: 'setup_done', value: () => Boolean(body.value) },
    '/api/state/country': { col: 'country', value: () => String(body.code ?? 'MY') },
    '/api/state/lang': { col: 'lang', value: () => (body.lang === 'bm' ? 'bm' : 'en') },
    '/api/state/theme': { col: 'theme', value: () => (body.theme === 'light' ? 'light' : 'dark') },
    '/api/state/channels': { col: 'channels', value: () => JSON.stringify(body.channels ?? []) },
    '/api/state/connections': {
      col: 'connections',
      value: () => JSON.stringify(body.connections ?? []),
    },
  };

  const hit = scalar[url.pathname];
  if (hit) {
    await withTenant(env, id.businessId, async (tx) => {
      // Column name comes from the table above, never from the request.
      await tx.unsafe(`update business set ${hit.col} = $1 where id = $2`, [
        hit.value() as never,
        id.businessId as never,
      ]);
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/biz-profile') {
    await withTenant(env, id.businessId, async (tx) => {
      if (body.name !== undefined) {
        await tx`update business set name = ${String(body.name)} where id = ${id.businessId}`;
      }
      if (body.loc !== undefined) {
        await tx`update business set locality = ${String(body.loc)} where id = ${id.businessId}`;
      }
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/policy') {
    await withTenant(env, id.businessId, async (tx) => {
      await tx`insert into action_policy (business_id, op, policy, updated_by)
               values (${id.businessId}, ${String(body.op)}, ${String(body.policy)}, ${id.userId})
               on conflict (business_id, op)
               do update set policy = excluded.policy, updated_by = excluded.updated_by,
                             updated_at = now()`;
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/policies/reset') {
    await withTenant(env, id.businessId, async (tx) => {
      await tx`delete from action_policy where business_id = ${id.businessId}`;
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/work-done') {
    await withTenant(env, id.businessId, async (tx) => {
      await tx`insert into work_done (business_id, playbook_key, idx)
               values (${id.businessId}, ${String(body.playbookKey)}, ${String(body.index)})
               on conflict do nothing`;
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/learn') {
    await withTenant(env, id.businessId, async (tx) => {
      await tx`insert into learn (business_id, playbook_key, pick)
               values (${id.businessId}, ${String(body.playbookKey)}, ${String(body.pick)})
               on conflict (business_id, playbook_key, pick)
               do update set count = learn.count + 1`;
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/approvals') {
    const created = await withTenant(env, id.businessId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into approval (business_id, connector, op, args, risk)
        values (${id.businessId}, ${String(body.conn)}, ${String(body.op)},
                ${JSON.stringify(body.args ?? {})}, ${String(body.risk ?? 'medium')})
        returning id`;
      return row.id;
    });
    return json({ ok: true, remoteId: created }, {}, cors);
  }

  const decide = url.pathname.match(/^\/api\/state\/approvals\/([^/]+)\/decide$/);
  if (decide) {
    const approved = Boolean(body.approved);
    /* The same shape as the D1 guarantee this replaces: one conditional
       UPDATE carrying both single-execution and tenant scoping. RLS makes
       the business_id predicate redundant — belt and braces, deliberately. */
    const changed = await withTenant(env, id.businessId, async (tx) => {
      const rows = await tx`
        update approval
           set status = ${approved ? 'approved' : 'rejected'},
               decided_at = now(), decided_by = ${id.userId}
         where id = ${decide[1]}::uuid
           and status = 'pending'
           and business_id = ${id.businessId}
        returning id`;
      return rows.length > 0;
    });
    if (!changed) return json({ ok: false, err: 'not pending' }, { status: 409 }, cors);
    return json({ ok: true, status: approved ? 'approved' : 'rejected' }, {}, cors);
  }

  if (url.pathname === '/api/state/reset') {
    await withTenant(env, id.businessId, async (tx) => {
      await tx`delete from approval where business_id = ${id.businessId}`;
      await tx`delete from action_policy where business_id = ${id.businessId}`;
      await tx`delete from work_done where business_id = ${id.businessId}`;
      await tx`delete from learn where business_id = ${id.businessId}`;
    });
    return noContent(cors);
  }

  return null;
}
