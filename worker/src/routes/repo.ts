/* ============================================================
   The endpoints behind the client's Repository interface.

   The interface has 17 methods; `load()` is one round trip that returns
   the whole snapshot, and every setter is one POST. Routes stay thin —
   no business logic here, only tenant resolution, validation and a
   write inside withTenant.
   ============================================================ */

import type { Env } from '../env';
import { withTenant } from '../db';
import { sendAndRecord } from './connect';
import { append, updateWorkForRun } from '../runs';
import { hasBusiness, resolveTenant, type TenantIdentity } from '../tenancy';
import {
  SOURCES,
  confirmFact,
  factHistory,
  forgetFact,
  keyProblem,
  liveFacts,
  recordFact,
  type FactSource,
} from '../facts';

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

const noContent = (headers: Record<string, string>) =>
  new Response(null, { status: 204, headers });

/* The schema enforces these already, via CHECK constraints. Enforcing
   them here too is not redundancy for its own sake: without it a bad
   value reaches Postgres, the constraint fires, and the caller gets a
   500 for what is plainly a malformed request. A public API should not
   report the client's mistake as its own. */
const POLICIES = ['automatic', 'approval', 'blocked'] as const;
const RISKS = ['low', 'medium', 'high'] as const;
// No CHECK backs this one — the column is plain text. The client's
// CountryCode union is the real contract, so it is enforced here.
const COUNTRIES = ['MY', 'ID', 'SG', 'TH', 'VN', 'PH'] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Non-empty string, or null. `op` and `conn` are free text with no
    constraint behind them, so this is the only thing keeping '' out. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

const badRequest = (cors: Record<string, string>, err: string) =>
  json({ ok: false, err }, { status: 400 }, cors);

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

    const facts = await liveFacts(tx);

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
      facts,
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

    /* lang is CHECK-constrained and country is the client's union, so
       both are validated here for the same reason as the setters: an
       unrecognised value must be a 400, not a constraint violation
       surfacing as a 500. */
    const name = text(b.name) ?? 'My business';
    const playbookKey = text(b.playbookKey) ?? 'generic';
    const country = oneOf(b.country ?? 'MY', COUNTRIES);
    const lang = oneOf(b.lang ?? 'en', ['en', 'bm'] as const);
    if (!country) return badRequest(cors, 'invalid country');
    if (!lang) return badRequest(cors, 'invalid lang');

    await withTenant(env, businessId, async (tx) => {
      await tx`
        insert into business (id, name, playbook_key, country, lang, locality)
        values (${businessId}, ${name}, ${playbookKey}, ${country}, ${lang},
                ${b.locality ? String(b.locality) : null})`;
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
  const scalar: Record<string, { col: string; value: () => unknown | null }> = {
    '/api/state/biz-type': { col: 'playbook_key', value: () => String(body.key ?? '') },
    '/api/state/onboarded': { col: 'onboarded', value: () => Boolean(body.value) },
    '/api/state/setup-done': { col: 'setup_done', value: () => Boolean(body.value) },
    '/api/state/country': { col: 'country', value: () => oneOf(body.code ?? 'MY', COUNTRIES) },
    '/api/state/lang': { col: 'lang', value: () => (body.lang === 'bm' ? 'bm' : 'en') },
    '/api/state/theme': { col: 'theme', value: () => (body.theme === 'light' ? 'light' : 'dark') },
  };

  const hit = scalar[url.pathname];
  if (hit) {
    // null means the value failed validation; no entry above returns
    // null for a legitimate input.
    const value = hit.value();
    if (value === null) return badRequest(cors, `invalid ${hit.col}`);
    await withTenant(env, id.businessId, async (tx) => {
      // Column name comes from the table above, never from the request.
      await tx.unsafe(`update business set ${hit.col} = $1 where id = $2`, [
        value as never,
        id.businessId as never,
      ]);
    });
    return noContent(cors);
  }

  /* channels and connections are jsonb, and jsonb is NOT a scalar.
     Passing JSON.stringify(...) here wrote the *text* as a jsonb string:
     postgres.js JSON-encodes the value it is given, so a string that
     already held JSON came back out as "[\"whatsapp\"]" rather than
     ["whatsapp"]. jsonb_typeof said `string` where the client expected
     `array`. sql.json states the intent explicitly rather than relying
     on postgres.js inferring jsonb from a bare JS array. */
  const list = url.pathname === '/api/state/channels'
    ? { col: 'channels', from: body.channels }
    : url.pathname === '/api/state/connections'
      ? { col: 'connections', from: body.connections }
      : null;

  if (list) {
    // The column no longer passes through String(), so nothing else
    // stops a caller storing an arbitrary object here.
    const values = Array.isArray(list.from)
      ? list.from.filter((v): v is string => typeof v === 'string')
      : [];
    await withTenant(env, id.businessId, async (tx) => {
      if (list.col === 'channels') {
        await tx`update business set channels = ${tx.json(values)} where id = ${id.businessId}`;
      } else {
        await tx`update business set connections = ${tx.json(values)} where id = ${id.businessId}`;
      }
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
    const op = text(body.op);
    const policy = oneOf(body.policy, POLICIES);
    if (!op) return badRequest(cors, 'invalid op');
    if (!policy) return badRequest(cors, 'invalid policy');
    await withTenant(env, id.businessId, async (tx) => {
      await tx`insert into action_policy (business_id, op, policy, updated_by)
               values (${id.businessId}, ${op}, ${policy}, ${id.userId})
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
    if (!text(body.playbookKey)) return badRequest(cors, 'invalid playbookKey');
    await withTenant(env, id.businessId, async (tx) => {
      await tx`insert into work_done (business_id, playbook_key, idx)
               values (${id.businessId}, ${String(body.playbookKey)}, ${String(body.index)})
               on conflict do nothing`;
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/learn') {
    if (!text(body.playbookKey) || !text(body.pick)) {
      return badRequest(cors, 'invalid playbookKey or pick');
    }
    await withTenant(env, id.businessId, async (tx) => {
      await tx`insert into learn (business_id, playbook_key, pick)
               values (${id.businessId}, ${String(body.playbookKey)}, ${String(body.pick)})
               on conflict (business_id, playbook_key, pick)
               do update set count = learn.count + 1`;
    });
    return noContent(cors);
  }

  if (url.pathname === '/api/state/approvals') {
    const conn = text(body.conn);
    const op = text(body.op);
    const risk = oneOf(body.risk ?? 'medium', RISKS);
    if (!conn || !op) return badRequest(cors, 'conn and op are required');
    if (!risk) return badRequest(cors, 'invalid risk');
    const created = await withTenant(env, id.businessId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into approval (business_id, connector, op, args, risk)
        values (${id.businessId}, ${conn}, ${op},
                ${tx.json((body.args ?? {}) as never)}, ${risk})
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
      const rows = await tx<
        { id: string; connector: string; op: string; args: unknown; run_id: string | null }[]
      >`
        update approval
           set status = ${approved ? 'approved' : 'rejected'},
               decided_at = now(), decided_by = ${id.userId}
         where id = ${decide[1]}::uuid
           and status = 'pending'
           and business_id = ${id.businessId}
        returning id, connector, op, args,
                  (select run_id from work_record w where w.approval_id = approval.id limit 1) as run_id`;
      return rows.length > 0
        ? { connector: rows[0].connector, op: rows[0].op, args: rows[0].args, runId: rows[0].run_id }
        : null;
    });
    if (!changed) return json({ ok: false, err: 'not pending' }, { status: 409 }, cors);

    /* Approving is not merely a status change: it is the moment the
       thing the owner approved actually happens. Doing it here rather
       than in a consumer keeps the guarantee simple — the conditional
       UPDATE above already ensured exactly one caller got here. */
    if (approved && changed.connector === 'telegram' && changed.op === 'send_message') {
      const a = changed.args as {
        chatId?: number;
        connectionId?: string;
        from?: string;
        question?: string;
        draft?: string;
      };
      /* The owner may have edited the draft before approving. What
         they send is what they saw, not what the model first wrote. */
      const edited = typeof body.text === 'string' && body.text.trim() !== '' &&
                     body.text.trim() !== (a.draft ?? '').trim();
      const text = edited ? String(body.text).trim() : a.draft;

      /* Recorded before the send, because it is true whether or not
         the send succeeds — and because later phases mine these to
         learn how this owner actually writes. */
      if (edited && changed.runId) {
        await withTenant(env, id.businessId, (tx) =>
          append(tx, id.businessId, changed.runId!, 'owner.edited', {
            was: (a.draft ?? '').slice(0, 2000),
            now: String(body.text).trim().slice(0, 2000),
          }),
        );
      }
      if (a.chatId && a.connectionId && text) {
        try {
          await sendAndRecord(
            env,
            id.businessId,
            a.connectionId,
            changed.runId ?? '',
            { chatId: a.chatId, from: a.from ?? 'Someone', text: a.question ?? '' },
            text,
            [],
          );
        } catch (e) {
          const why = e instanceof Error ? e.message : 'could not send';
          /* An approved reply that failed to send must not leave the
             screen saying it is still waiting for the owner. They
             already decided; what they need to know is that it did not
             go out, and why. */
          if (changed.runId) {
            await withTenant(env, id.businessId, async (tx) => {
              await append(tx, id.businessId, changed.runId!, 'work.failed', { error: why });
              await updateWorkForRun(tx, id.businessId, changed.runId!, {
                status: 'failed',
                outcome: `You approved this, but it could not be sent: ${why}`,
              });
              await tx`update run set status = 'failed', ended_at = now()
                        where id = ${changed.runId}`;
            });
          }
          return json({ ok: true, status: 'approved', sent: false, err: why }, {}, cors);
        }
        await withTenant(env, id.businessId, (tx) =>
          append(tx, id.businessId, changed.runId ?? '', 'approval.granted', {}),
        ).catch(() => {
          /* The send already happened and is recorded; a missing
             bookkeeping event must not turn a delivered message into
             an error the owner sees. */
        });
        return json({ ok: true, status: 'approved', sent: true }, {}, cors);
      }
    }

    return json({ ok: true, status: approved ? 'approved' : 'rejected' }, {}, cors);
  }

  /* ---- business memory ------------------------------------------------ */

  if (url.pathname === '/api/state/facts') {
    const problem = keyProblem(body.key);
    if (problem) return badRequest(cors, problem);
    if (body.value === undefined) return badRequest(cors, 'value is required');

    const source = oneOf(body.source ?? 'owner', SOURCES as readonly FactSource[]);
    if (!source) return badRequest(cors, 'invalid source');

    const confidence = body.confidence === undefined ? 1 : Number(body.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return badRequest(cors, 'confidence must be between 0 and 1');
    }

    const fact = await withTenant(env, id.businessId, (tx) =>
      recordFact(tx, id.businessId, {
        key: String(body.key),
        value: body.value,
        source,
        sourceRef: body.sourceRef === undefined ? null : String(body.sourceRef),
        confidence,
        /* An owner typing a value is simultaneously stating and
           vouching for it. Any other source has to be confirmed
           separately, by a person, later. */
        confirmedBy: source === 'owner' ? id.userId : null,
      }),
    );
    return json({ ok: true, fact }, {}, cors);
  }

  if (url.pathname === '/api/state/facts/confirm') {
    const problem = keyProblem(body.key);
    if (problem) return badRequest(cors, problem);
    const ok = await withTenant(env, id.businessId, (tx) =>
      confirmFact(tx, id.businessId, String(body.key), id.userId),
    );
    if (!ok) return json({ ok: false, err: 'no live fact for that key' }, { status: 404 }, cors);
    return noContent(cors);
  }

  if (url.pathname === '/api/state/facts/forget') {
    const problem = keyProblem(body.key);
    if (problem) return badRequest(cors, problem);
    const ok = await withTenant(env, id.businessId, (tx) =>
      forgetFact(tx, id.businessId, String(body.key)),
    );
    if (!ok) return json({ ok: false, err: 'no live fact for that key' }, { status: 404 }, cors);
    return noContent(cors);
  }

  if (url.pathname === '/api/state/facts/history') {
    const problem = keyProblem(body.key);
    if (problem) return badRequest(cors, problem);
    const history = await withTenant(env, id.businessId, (tx) =>
      factHistory(tx, id.businessId, String(body.key)),
    );
    return json({ ok: true, history }, {}, cors);
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
