/* ============================================================
   Chats, read from the server.

   GET /api/chats?workspaceId=…   a workspace's chats, newest first, to
                                  its members
   GET /api/chats/:id             one chat's turns — each question, who
                                  asked it, the answer and its files — to
                                  whoever may read it (chat-sessions.ts)

   A person's own chats still live in their browser; this is how a
   workspace's chats reach the other members, who never saw them typed.
   Answers are read from the finished task the way the run detail reads
   them, so the transcript and the task page never disagree.
   ============================================================ */
import type { Env } from '../env';
import { withTenant } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { chatVisibleTo, isWorkspaceMember } from '../chat-sessions';
import { answerText } from '../runtime/answer-text';
import { artifactJson, type ArtifactRow } from '../artifacts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TURNS = 200;

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
  });
}

export async function handleChats(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/chats') || request.method !== 'GET') return null;
  const identity = await resolveTenant(env, request);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'unauthorized' }, { status: 401 }, cors);
  const { businessId, userId } = identity;
  const privateHeaders = { ...cors, 'Cache-Control': 'private, no-store' };

  if (url.pathname === '/api/chats') {
    const workspaceId = url.searchParams.get('workspaceId') ?? '';
    if (!UUID.test(workspaceId)) return json({ ok: false, err: 'workspaceId required' }, { status: 400 }, cors);
    const rows = await withTenant(env, businessId, async (tx) => {
      /* Not a member reads as not found: the id alone confirms nothing. */
      if (!await isWorkspaceMember(tx, businessId, workspaceId, userId)) return null;
      return tx<{ id: string; title: string | null; created_at: Date; last_at: Date; created_by: string; turns: number }[]>`
        select c.id, c.title, c.created_at, c.last_at, u.email as created_by,
               (select count(*) from run r where r.business_id = c.business_id and r.session_id = c.id)::int as turns
          from chat_session c join app_user u on u.id = c.created_by
         where c.business_id = ${businessId} and c.workspace_id = ${workspaceId}
         order by c.last_at desc limit 100`;
    });
    if (!rows) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    return json({
      ok: true,
      chats: rows.map((c) => ({
        id: c.id, title: c.title, createdBy: c.created_by, createdAt: c.created_at.toISOString(),
        lastAt: c.last_at.toISOString(), turns: c.turns,
      })),
    }, {}, privateHeaders);
  }

  const one = url.pathname.match(/^\/api\/chats\/([0-9a-f-]{36})$/i);
  if (one) {
    if (!UUID.test(one[1])) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    const chat = await withTenant(env, businessId, async (tx) => {
      if (!await chatVisibleTo(tx, businessId, one[1], userId)) return null;
      const [session] = await tx<{ id: string; title: string | null; workspace_id: string | null; created_by: string; created_at: Date; last_at: Date }[]>`
        select c.id, c.title, c.workspace_id, u.email as created_by, c.created_at, c.last_at
          from chat_session c join app_user u on u.id = c.created_by
         where c.business_id = ${businessId} and c.id = ${one[1]}`;
      if (!session) return null;
      const runs = await tx<{ id: string; status: string; created_at: Date; question: string | null; requested_by: string | null; result: unknown; outcome: string | null }[]>`
        select r.id, r.status, r.created_at, r.trigger_ref->>'question' as question, u.email as requested_by,
               (select t.result from runtime_task t where t.run_id = r.id and t.business_id = r.business_id
                 order by t.created_at desc limit 1) as result,
               (select w.outcome from work_record w where w.run_id = r.id order by w.occurred_at desc limit 1) as outcome
          from run r left join app_user u on u.id = r.requested_by
         where r.business_id = ${businessId} and r.session_id = ${session.id}
         order by r.created_at limit ${MAX_TURNS}`;
      const artifacts = runs.length ? await tx<ArtifactRow[]>`
        select id, run_id, name, content_type, size_bytes, r2_key, created_at from artifact
         where business_id = ${businessId} and run_id in ${tx(runs.map((r) => r.id))}
         order by created_at, id` : [];
      return {
        id: session.id,
        title: session.title,
        workspaceId: session.workspace_id,
        createdBy: session.created_by,
        createdAt: session.created_at.toISOString(),
        lastAt: session.last_at.toISOString(),
        turns: runs.map((r) => ({
          runId: r.id,
          question: r.question ?? '',
          status: r.status,
          requestedBy: r.requested_by,
          createdAt: r.created_at.toISOString(),
          text: r.status === 'completed' ? (r.result ? answerText(r.result) : r.outcome) : null,
          artifacts: artifacts.filter((a) => a.run_id === r.id).map(artifactJson),
        })),
      };
    });
    if (!chat) return json({ ok: false, err: 'not found' }, { status: 404 }, cors);
    return json({ ok: true, chat }, {}, privateHeaders);
  }

  return null;
}
