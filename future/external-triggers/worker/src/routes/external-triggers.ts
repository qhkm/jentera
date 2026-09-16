import type postgres from 'postgres';
import type { Env } from '../env';
import { withTenant, withUser } from '../db';
import { hasBusiness, resolveTenant } from '../tenancy';
import { can } from '../permissions';
import { businessHasAccess } from '../access';
import { seal, open, KEY_VERSION } from '../vault';
import { startRun, finishRun, recordWork } from '../runs';
import { createNotification } from '../notifications/store';
import { approvalReminder, summaryReport } from '../routines/jobs';
import { businessLang } from '../routines/store';
import { SUPPORTED_TIME_ZONES } from '../routines/schedule';
import { TRIGGER_TASKS, UUID, TRIGGER_BODY_CAP, MAX_ACTIVE_TRIGGERS, MAX_DAILY_EVENTS, MAX_TRIGGER_LIFETIME_MS,
  TriggerBodyError, hex, readTriggerBody, triggerPath, triggersEnabled, triggerTimestamp, verifyTriggerSignature, type TriggerTask } from '../external-triggers';

const MANAGEMENT = '/api/external-triggers';
const HOOK = /^\/api\/webhooks\/external\/([0-9a-f-]{36})$/;
interface TriggerRow {
  id: string; business_id: string; authorised_by: string; name: string; task: TriggerTask; time_zone: string;
  ciphertext: Uint8Array | null; key_version: number; expires_at: Date; revoked_at: Date | null; created_at: Date;
}
const present = (row: TriggerRow) => ({ id: row.id, name: row.name, task: row.task, timeZone: row.time_zone,
  expiresAt: row.expires_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null, createdAt: row.created_at.toISOString() });
function json(body: unknown, status = 200, cors: Record<string, string> = {}, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store', ...extra } });
}
const fail = (status: number, code: string, cors: Record<string, string> = {}) => json({ ok: false, code }, status, cors,
  status === 429 ? { 'Retry-After': '86400' } : {});
const lock = (tx: postgres.TransactionSql, businessId: string) => tx`select pg_advisory_xact_lock(hashtextextended(${`external-trigger:${businessId}`}, 0))`;
const ownerExists = async (tx: postgres.TransactionSql, row: Pick<TriggerRow, 'business_id' | 'authorised_by'>) => {
  const [owner] = await tx`select 1 from membership m join app_user u on u.id = m.user_id
    where m.business_id = ${row.business_id} and m.user_id = ${row.authorised_by} and m.role = 'owner' and u.email_verified = true for share of m, u`;
  return Boolean(owner);
};

export async function handleExternalTriggers(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  const hook = url.pathname.match(HOOK);
  const management = url.pathname === MANAGEMENT || url.pathname.startsWith(MANAGEMENT + '/');
  if (!hook && !management && !url.pathname.startsWith('/api/webhooks/external/')) return null;
  // This surface is deliberately not a runtime tool or a browser sign-in flow.
  try {
    if (hook || !management) return await receiveEvent(request, env, url, hook?.[1]);
    const identity = await resolveTenant(env, request);
    if (!hasBusiness(identity)) return fail(401, 'SIGNED_IN_BUSINESS_REQUIRED', cors);
    if (!can(identity, 'connections.manage')) return fail(403, 'OWNER_REQUIRED', cors);
    const businessId = identity.businessId;
    if (url.search) return fail(400, 'INVALID_TARGET', cors);
    if (url.pathname === MANAGEMENT && request.method === 'GET') {
      const rows = await withTenant(env, businessId, tx => tx<TriggerRow[]>`select * from external_trigger order by created_at desc limit 100`);
      return json({ ok: true, apiVersion: 1, available: triggersEnabled(env, businessId), triggers: rows.map(present),
        limits: { maxActive: MAX_ACTIVE_TRIGGERS, dailyEvents: MAX_DAILY_EVENTS, bodyBytes: TRIGGER_BODY_CAP }, tasks: TRIGGER_TASKS }, 200, cors);
    }
    if (!['POST', 'DELETE'].includes(request.method)) return fail(405, 'METHOD_NOT_ALLOWED', cors);
    const origin = request.headers.get('Origin');
    if (!origin || !(env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).includes(origin)) return fail(403, 'ORIGIN_REQUIRED', cors);
    if (url.pathname === MANAGEMENT && request.method === 'POST') {
      if (!triggersEnabled(env, businessId) || !(await businessHasAccess(env, businessId))) return fail(403, 'TRIGGERS_DISABLED', cors);
      const base = new URL(env.API_ORIGIN);
      if (base.protocol !== 'https:') return fail(503, 'HTTPS_REQUIRED', cors);
      const body = JSON.parse(await readTriggerBody(request)) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['id', 'name', 'task', 'timeZone', 'expiresAt'].includes(key))) return fail(400, 'INVALID_CONFIG', cors);
      const { id, task, timeZone, expiresAt } = body;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
      if (typeof id !== 'string' || !UUID.test(id) || !name || name.length > 80 || typeof task !== 'string'
          || !TRIGGER_TASKS.includes(task as TriggerTask) || typeof timeZone !== 'string' || !SUPPORTED_TIME_ZONES.includes(timeZone)
          || !Number.isFinite(expiry) || expiry <= Date.now() || expiry - Date.now() > MAX_TRIGGER_LIFETIME_MS) return fail(400, 'INVALID_CONFIG', cors);
      const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
      const ciphertext = await seal(env, JSON.stringify({ version: 1, id, businessId, secret }));
      const result = await withTenant(env, businessId, async tx => {
        await lock(tx, businessId);
        if (!(await ownerExists(tx, { business_id: businessId, authorised_by: identity.userId }))) return null;
        const [counts] = await tx<{ active: number; total: number }[]>`select count(*)::int as total,
          count(*) filter (where revoked_at is null and expires_at > now())::int as active from external_trigger`;
        if (counts.active >= MAX_ACTIVE_TRIGGERS || counts.total >= 100) return null;
        const [row] = await tx<TriggerRow[]>`insert into external_trigger (id, business_id, authorised_by, name, task, time_zone, ciphertext, key_version, expires_at)
          values (${id}, ${businessId}, ${identity.userId}, ${name}, ${task}, ${timeZone}, ${ciphertext}, ${KEY_VERSION}, ${new Date(expiry).toISOString()})
          on conflict (id) do nothing returning *`;
        return row ?? null;
      });
      // A lost create response is NOT a secret-reveal endpoint. Revoke and create anew.
      if (!result) return fail(409, 'LIMIT_OR_ID_CONFLICT', cors);
      return json({ ok: true, trigger: present(result), url: base.origin + triggerPath(result.id), secret, shownOnce: true }, 201, cors);
    }
    const id = url.pathname.slice(MANAGEMENT.length + 1);
    if (request.method !== 'DELETE' || !UUID.test(id)) return fail(404, 'NOT_FOUND', cors);
    const revoked = await withTenant(env, businessId, async tx => {
      await lock(tx, businessId);
      const [row] = await tx<TriggerRow[]>`update external_trigger set revoked_at = coalesce(revoked_at, now()),
        revoked_by = coalesce(revoked_by, ${identity.userId}), ciphertext = null where id = ${id} returning *`;
      return row;
    });
    return revoked ? json({ ok: true, trigger: present(revoked) }, 200, cors) : fail(404, 'NOT_FOUND', cors);
  } catch (error) {
    if (error instanceof TriggerBodyError) return fail(error.status, 'INVALID_BODY', management ? cors : {});
    if (error instanceof SyntaxError || error instanceof TypeError) return fail(400, 'INVALID_BODY', management ? cors : {});
    // No incoming body, signature, credential, provider URL or SQL errors in logs.
    console.error('[external-trigger] request failed');
    return fail(503, 'TRIGGER_UNAVAILABLE', management ? cors : {});
  }
}

async function receiveEvent(request: Request, env: Env, url: URL, id?: string): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');
  if (!id || !UUID.test(id) || url.search || url.protocol !== 'https:' || url.origin !== new URL(env.API_ORIGIN).origin) return fail(400, 'INVALID_TARGET');
  if (request.headers.has('Cookie') || request.headers.has('Authorization') || request.headers.has('Origin')) return fail(401, 'SIGNATURE_REQUIRED');
  if (env.EXTERNAL_TRIGGERS_ENABLED !== 'true') return fail(403, 'TRIGGERS_DISABLED');
  const timestamp = triggerTimestamp(request.headers.get('X-Jentera-Timestamp'));
  const signature = request.headers.get('X-Jentera-Signature') ?? '';
  if (!timestamp || !/^v1=[0-9a-f]{64}$/.test(signature)) return fail(401, 'INVALID_SIGNATURE');
  const raw = await readTriggerBody(request);
  const body = JSON.parse(raw) as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
      || typeof body.eventId !== 'string' || !UUID.test(body.eventId)) return fail(400, 'INVALID_EVENT');
  const businessId = await withUser(env, async sql => {
    const [target] = await sql<{ business_id: string }[]>`select * from public.external_trigger_target(${id}::uuid)`;
    return target?.business_id;
  });
  if (!businessId || !triggersEnabled(env, businessId)) return fail(401, 'INVALID_SIGNATURE');
  const bodyHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))));
  const admitted = await withTenant(env, businessId, async tx => {
    await lock(tx, businessId);
    const [trigger] = await tx<TriggerRow[]>`select * from external_trigger where id = ${id} for update`;
    if (!trigger || trigger.revoked_at || trigger.expires_at.getTime() <= Date.now() || !trigger.ciphertext
        || !triggerTimestamp(timestamp) || !(await ownerExists(tx, trigger))) return fail(401, 'INVALID_SIGNATURE');
    const credential = JSON.parse(await open(env, trigger.ciphertext, trigger.key_version));
    if (credential.version !== 1 || credential.id !== id || credential.businessId !== businessId
        || !(await verifyTriggerSignature(credential.secret, url.pathname, timestamp, raw, signature))) return fail(401, 'INVALID_SIGNATURE');
    if (!(await businessHasAccess(env, businessId))) return fail(403, 'ACCESS_REQUIRED');
    const [existing] = await tx<{ body_hash: string }[]>`select body_hash from external_trigger_event where trigger_id = ${id} and event_id = ${body.eventId as string}`;
    if (existing) return existing.body_hash === bodyHash ? json({ ok: true, receipt: body.eventId, duplicate: true }) : fail(409, 'EVENT_CONFLICT');
    // Use one actual acceptance clock for quota AND receipt, not transaction
    // now(), which can precede a row-lock wait across UTC midnight.
    const [clock] = await tx<{ at: Date }[]>`select clock_timestamp() as at`;
    const at = clock.at;
    const dayStart = new Date(at);
    dayStart.setUTCHours(0, 0, 0, 0);
    const [quota] = await tx<{ n: number }[]>`select count(*)::int as n from external_trigger_event
      where created_at >= ${dayStart.toISOString()}::timestamptz`;
    if (quota.n >= MAX_DAILY_EVENTS) return fail(429, 'DAILY_LIMIT');
    const lang = await businessLang(tx, businessId);
    const report = trigger.task === 'approval_reminder' ? await approvalReminder(tx, at, trigger.time_zone, lang)
      : await summaryReport(tx, trigger.task, at, trigger.time_zone, lang);
    const text = 'skipped' in report ? lang === 'bm' ? 'Tiada kelulusan menunggu semakan.' : 'No approvals are waiting for review.' : report.text;
    const run = await startRun(tx, businessId, { kind: 'schedule', triggerShape: 'external.report',
      triggerRef: { triggerId: id, eventId: body.eventId }, requestedBy: trigger.authorised_by, runtime: 'deterministic', model: null });
    await recordWork(tx, businessId, { runId: run.id, objective: trigger.name, outcome: text,
      status: 'completed', function: 'routine', channel: 'workspace', risk: 'low', inputsUsed: { task: trigger.task, triggerId: id } });
    await finishRun(tx, businessId, run.id, 'completed', { triggerId: id, eventId: body.eventId, task: trigger.task });
    await tx`insert into external_trigger_event (business_id, trigger_id, event_id, body_hash, run_id, created_at)
      values (${businessId}, ${id}, ${body.eventId as string}, ${bodyHash}, ${run.id}, ${at.toISOString()})`;
    await createNotification(tx, businessId, { recipientUserId: trigger.authorised_by, kind: 'external_report',
      title: trigger.name, body: lang === 'bm' ? 'Laporan dalaman sedia untuk semakan dalam Aktiviti.' : 'Your internal report is ready to review in Activity.',
      sourceKey: `external:${id}:${body.eventId}`, runId: run.id, url: '/app?view=work&run=' + run.id });
    // Deliberately no run ID, report, customer data or credentials to the sender.
    return json({ ok: true, receipt: body.eventId, duplicate: false }, 202);
  });
  return admitted;
}
